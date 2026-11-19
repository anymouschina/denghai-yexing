class_name Bot
extends RefCounted
## 平衡验证用机器人（不作弊：只通过 Sim 的输入口与选择口操作，不改血量/倍率/不回血）。
##   RANDOM：随机下限（随机走位、随机选卡、随机用飞剑）
##   PROXY ：“真人代理”：聪明决策（威胁评估+吸魂+躲预警+绕战），先选最优方向，再叠加 σ=0.05 rad 的高斯瞄准误差
##   AIM   ：同 PROXY 但无误差，且飞剑召回用 Sim.fork() 克隆战斗状态逐角度试射，取收益最大的方向（上限）

enum Kind { RANDOM, PROXY, AIM }

var kind: int = Kind.PROXY
var sigma := 0.05
var rng := RandomNumberGenerator.new()
var plan: Array = []            # 计划进副本的段间序号，如 [0] / [0, 1]
var cur_dir := Vector2.ZERO
var decide_t := 0.0
var react := 0.22               # 决策间隔（秒），模拟人的反应
var want_dash := false
var rnd_t := 0.0
var sword_press_t := 0.0
var shop_wait := 0.0
var done_shop: Dictionary = {}
var entered: Dictionary = {}
var target_zone := ""

const PRIORITY := {
	"fu": 62.0, "huanhuo": 58.0, "lei": 60.0, "taomu": 52.0, "zhongfu": 48.0, "jishu": 47.0, "zhuohun": 46.0, "tianyou": 45.0,
	"tiangang": 46.0, "leiyin": 44.0, "yupei": 42.0, "caolv": 34.0, "hundai": 28.0, "jingxin": 30.0, "tongqian": 20.0,
}
const RELIC_ORDER := ["talisman", "mirror", "coin", "shade", "bell", "horse"]


func _init(p_kind: int = Kind.PROXY, p_seed: int = 1, p_plan: Array = []) -> void:
	kind = p_kind
	rng.seed = p_seed * 2654435761 + 17
	plan = p_plan
	if kind == Kind.AIM:
		sigma = 0.0
	if kind == Kind.RANDOM:
		sigma = 0.0


func gauss() -> float:
	return rng.randfn(0.0, 1.0)


# ----------------------------------------------------------------------
func act(s: Sim, dt: float) -> void:
	if s.ended or s.over:
		return
	if not s.choice.is_empty():
		_pick(s)
		return
	if s.shop_open:
		_shop(s)
		return
	match s.phase:
		Sim.PH_BREAK:
			_break(s, dt)
		_:
			_combat(s, dt)


# ---------------- 三选一 ----------------
func _pick(s: Sim) -> void:
	var opts: Array = s.choice.options
	if kind == Kind.RANDOM:
		s.choose(rng.randi() % opts.size())
		return
	var best := 0
	var bs := -1e9
	var nweap := 0
	for u in GameData.UP.list:
		if u.type == "weapon" and s.lv(u.id) > 0:
			nweap += 1
	for i in range(opts.size()):
		var o: Dictionary = opts[i]
		var sc := 0.0
		if o.kind == "evo":
			sc = 100.0
		elif o.kind == "up":
			sc = PRIORITY.get(o.id, 20.0)
			var u: Dictionary = GameData.UPS[o.id]
			if u.type == "weapon":
				if s.lv(o.id) == 0:
					sc += 8.0 if nweap < 3 else -30.0
				else:
					sc += 6.0
			else:
				var sw := s._school_weapon(u.school)
				if sw != "" and s.lv(sw) == 0:
					sc -= 25.0
			sc += (int(o.to) - int(o.from)) * 3.0
		elif o.kind == "heal":
			sc = 70.0 if s.hp < s.maxhp * 0.45 else 3.0
		else:
			sc = 5.0
		if sc > bs:
			bs = sc
			best = i
	s.choose(best)


# ---------------- 游商 ----------------
func _shop(s: Sim) -> void:
	var reserve := _reserve(s)
	var bought := false
	if kind == Kind.RANDOM:
		if s.wicks > reserve and s.shop.size() > 0 and rng.randf() < 0.7:
			s.buy_relic(rng.randi() % s.shop.size())
			bought = true
	else:
		while s.wicks > reserve and s.shop.size() > 0:
			var bi := -1
			var br := 99
			for i in range(s.shop.size()):
				var rk := RELIC_ORDER.find(s.shop[i])
				if rk < br:
					br = rk
					bi = i
			s.buy_relic(bi)
			bought = true
	s.close_shop()
	done_shop[s.break_idx] = true


func _reserve(s: Sim) -> int:
	var n := 0
	for k in plan:
		if int(k) >= s.break_idx and not entered.has(int(k)) and not s.rift_sealed.has(int(k)) and s.rift_entries + n < int(GameData.DG.rift.maxEntries):
			n += 1
	return n


# ---------------- 段间 ----------------
func _break(s: Sim, _dt: float) -> void:
	var zone := "gate"
	var k := s.break_idx
	if plan.has(k) and not entered.has(k) and s.rift_state() == "ok":
		zone = "rift"
	elif not done_shop.has(k) and s.wicks > _reserve(s) and s.shop.size() > 0:
		zone = "merchant"
	target_zone = zone
	var tp := s.break_pos(zone)
	var d := tp - Vector2(s.px, s.py)
	if d.length() < 20.0:
		s.in_move = Vector2.ZERO
	else:
		s.in_move = d.normalized()


# ---------------- 战斗 ----------------
func _combat(s: Sim, dt: float) -> void:
	if s.phase == Sim.PH_RIFT:
		entered[s.break_idx] = true
	decide_t -= dt
	var px := s.px
	var py := s.py
	if decide_t <= 0.0:
		decide_t = react
		want_dash = false
		if kind == Kind.RANDOM:
			rnd_t -= react
			if rnd_t <= 0.0:
				rnd_t = 0.5 + rng.randf() * 1.0
				var a := rng.randf() * TAU
				cur_dir = Vector2(cos(a), sin(a))
				# 随机下限也不会傻到往墙里撞：靠墙时朝中心
				if px < Sim.MARGIN + 80.0 or px > Sim.W - Sim.MARGIN - 80.0 or py < Sim.MARGIN + 80.0 or py > Sim.H - Sim.MARGIN - 80.0:
					cur_dir = (Vector2(Sim.W / 2.0, Sim.H / 2.0) - Vector2(px, py)).normalized()
			want_dash = rng.randf() < 0.06
		else:
			_think(s)
	var dir := cur_dir
	if sigma > 0.0 and dir.length() > 0.0:
		dir = dir.rotated(gauss() * sigma)
	s.in_move = dir
	s.in_dash = want_dash
	want_dash = false
	_sword(s, dt)


func _think(s: Sim) -> void:
	var p := Vector2(s.px, s.py)
	var spd := s.s_speed
	# 只关心近处的妖物
	var near: Array = []
	var focus: SimEnemy = null
	for e: SimEnemy in s.enemies:
		var dx := e.x - p.x
		var dy := e.y - p.y
		if dx * dx + dy * dy < 420.0 * 420.0:
			near.append(e)
		if (e.boss or e.warden) and focus == null:
			focus = e
	var engage := 250.0
	var engage_w := 1.2
	if s.orb_count > 0:
		var ost: Dictionary = GameData.EVOS.huanhuo.stats if s.evo.has("huanhuo") else s.wstat("huanhuo")
		engage = float(ost.radius) * s.s_orb_r_mul * 0.85 + 30.0
		engage_w = 2.4
	if s.has_sword() and (s.sw_state == Sim.SW_ORBIT or s.sw_state == Sim.SW_STOW):
		engage = minf(engage, 175.0)   # 带飞剑时贴近目标，让回旋椭圆够得着
	var best_dir := cur_dir
	var best_sc := -1e9
	var threat_now := 0.0
	var n_dir := 14
	var center := Vector2(Sim.W / 2.0, Sim.H / 2.0)
	var rift := s.phase == Sim.PH_RIFT
	var gem: SimPickup = null
	var gd := 480.0
	for k in s.pickups:
		var dd := p.distance_to(Vector2(k.x, k.y))
		var w := dd
		if k.kind == "chest":
			w *= 0.5
		elif k.kind == "oil" and s.hp > s.maxhp * 0.75:
			continue
		if w < gd:
			gd = w
			gem = k
	for di in range(n_dir + 1):
		var d: Vector2
		if di == n_dir:
			d = Vector2.ZERO
		else:
			var a := float(di) / n_dir * TAU
			d = Vector2(cos(a), sin(a))
		var c1 := p + d * spd * 0.45
		var c2 := p + d * spd * 0.7
		var thr := 0.0
		for e: SimEnemy in near:
			var ep := Vector2(e.x + e.vx * 0.45, e.y + e.vy * 0.45)
			var dist := c1.distance_to(ep)
			var rr := e.r + 34.0
			var span := 130.0 + (60.0 if (e.boss or e.warden) else 0.0)
			if dist < rr + span:
				var w2 := e.dmg * 0.12 + (1.4 if (e.boss or e.elite) else 0.0)
				if e.ai == "bomber":
					w2 += 1.0
				var f := 1.0 - maxf(0.0, dist - rr) / span
				thr += w2 * f * f
		for b: SimBullet in s.ebullets:
			var ddx := b.x - p.x
			var ddy := b.y - (p.y - 34.0)
			if ddx * ddx + ddy * ddy > 420.0 * 420.0:
				continue
			for ti: float in [0.1, 0.25, 0.4, 0.55]:
				var cx2: float = p.x + d.x * spd * ti
				var cy2: float = p.y - 34.0 + d.y * spd * ti
				var bx: float = b.x + b.vx * ti
				var by: float = b.y + b.vy * ti
				if (cx2 - bx) * (cx2 - bx) + (cy2 - by) * (cy2 - by) < 42.0 * 42.0:
					thr += b.dmg * 0.4
		for tl: SimTele in s.teles:
			if tl.r > 0.0:
				var td := c2.distance_to(Vector2(tl.x, tl.y))
				if td < tl.r + 36.0:
					thr += 5.0 + 6.0 * clampf(tl.t / tl.dur, 0.0, 1.0)
		# 墙
		var wall := 0.0
		if rift:
			var rr2 := c1.distance_to(center)
			var R: float = GameData.DG.rift.arenaRadius
			if rr2 > R - 90.0:
				wall += (rr2 - (R - 90.0)) / 90.0 * 3.0
		else:
			var lo := Sim.MARGIN + 110.0
			wall += maxf(0.0, lo - c1.x) / 110.0 + maxf(0.0, c1.x - (Sim.W - lo)) / 110.0
			wall += maxf(0.0, lo - c1.y) / 110.0 + maxf(0.0, c1.y - (Sim.H - lo)) / 110.0
			wall *= 3.0
		var sc := -thr * 2.2 - wall
		if di == n_dir:
			threat_now = thr
			sc -= 0.15
		else:
			sc += 0.28 * d.dot(cur_dir) if cur_dir.length() > 0.0 else 0.0
			sc += 0.12 * d.dot((center - p).normalized())
			if gem != null and thr < 2.5:
				var tg := Vector2(gem.x, gem.y - 30.0) - p
				sc += 1.1 * d.dot(tg.normalized()) * (1.0 - clampf(gd / 520.0, 0.0, 0.7))
			if focus != null:
				var fd := c1.distance_to(Vector2(focus.x, focus.y))
				sc -= absf(fd - engage) / 260.0 * engage_w
		if sc > best_sc:
			best_sc = sc
			best_dir = d
	cur_dir = best_dir
	# 闪避：危险较大时冲出去；预警圈快炸且人在里面时必闪
	var in_tele := false
	for tl: SimTele in s.teles:
		if tl.r > 0.0 and p.distance_to(Vector2(tl.x, tl.y)) < tl.r + 6.0 and tl.dur - tl.t < 0.45:
			in_tele = true
	if s.dash_cd <= 0.0 and (threat_now > 5.5 or in_tele):
		want_dash = true
		if best_dir.length() < 0.1:
			cur_dir = Vector2(s.face_x, 0)


# ---------------- 飞剑 ----------------
func _sword(s: Sim, dt: float) -> void:
	if not s.has_sword():
		return
	if kind == Kind.RANDOM:
		if rng.randf() < dt * 0.35:
			s.in_skill = true
		return
	match s.sw_state:
		Sim.SW_STOW:
			if s.sw_cd <= 0.0 and s.enemies.size() > 0:
				for e: SimEnemy in s.enemies:
					if Vector2(e.x - s.px, e.y - s.py).length() < 360.0:
						s.in_skill = true
						sword_press_t = 0.0
						break
		Sim.SW_ORBIT:
			sword_press_t += dt
			var sw: Dictionary = GameData.DG.sword
			# 有目标进入刺击线 / 快到时限 〉 召回；方向朝最优目标
			var want := sword_press_t > 1.6 and (s.sw_t < 1.6 or _line_count(s) >= 3 or _focus_in_range(s))
			if want or s.sw_t < 0.5:
				var dir := _best_thrust_dir(s)
				if dir != Vector2.ZERO:
					s.in_move = dir
					if sigma > 0.0:
						s.in_move = dir.rotated(gauss() * sigma)
					s.in_skill = true


func _focus_in_range(s: Sim) -> bool:
	for e: SimEnemy in s.enemies:
		if (e.boss or e.warden) and Vector2(e.x - s.px, e.y - s.py).length() < GameData.DG.sword.thrustLen - 60.0:
			return true
	return false


func _line_count(s: Sim) -> int:
	var best := 0
	for e: SimEnemy in s.enemies:
		var d := Vector2(e.x - s.px, e.y - s.py)
		if d.length() < 400.0 and d.length() > 1.0:
			best = maxi(best, _count_dir(s, d.normalized()))
	return best


func _count_dir(s: Sim, dir: Vector2) -> int:
	var sw: Dictionary = GameData.DG.sword
	var n := 0
	for e: SimEnemy in s.enemies:
		var v := Vector2(e.x - s.px, e.y - e.h * 0.4 - (s.py - 30.0))
		var proj := v.dot(dir)
		if proj < -20.0 or proj > sw.thrustLen:
			continue
		if absf(v.x * dir.y - v.y * dir.x) <= sw.thrustHalfW + e.r:
			n += 1 + (4 if (e.boss or e.warden) else 0)
	return n


func _best_thrust_dir(s: Sim) -> Vector2:
	var best := Vector2.ZERO
	var bs := -1.0
	var cands: Array = []
	for e: SimEnemy in s.enemies:
		var d := Vector2(e.x - s.px, e.y - s.py)
		if d.length() > 1.0 and d.length() < 450.0:
			cands.append(d.normalized())
		if cands.size() >= 24:
			break
	for i in range(8):
		var a := float(i) / 8.0 * TAU
		cands.append(Vector2(cos(a), sin(a)))
	if cands.is_empty():
		return Vector2.ZERO
	if kind == Kind.AIM:
		# 克隆战斗状态，逐角度试射：收益 = 刺击期间的飞剑伤害
		var scored: Array = []
		for d in cands:
			scored.append([_count_dir(s, d), d])
		scored.sort_custom(func(a, b): return a[0] > b[0])
		var top: int = mini(6, scored.size())
		for i in range(top):
			var d2: Vector2 = scored[i][1]
			var f := s.fork()
			f.in_move = d2
			f.in_skill = true
			var before: float = float(f.dmg_by.get("sword", 0.0))
			f.step(1.0 / 30.0)
			f.sw_state = Sim.SW_RECALL
			f.sw_t = 0.02
			f.sw_dir = d2
			f.in_skill = false
			f.step(1.0 / 30.0)
			var gain: float = float(f.dmg_by.get("sword", 0.0)) - before
			if gain > bs:
				bs = gain
				best = d2
		return best
	for d in cands:
		var c := float(_count_dir(s, d))
		if c > bs:
			bs = c
			best = d
	return best
