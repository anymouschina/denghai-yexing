class_name Sim
extends RefCounted
## 《灯骸夜行》对局模拟核心（v1.5）。
## 纯数据、无节点：游戏渲染层与 headless 平衡脚本共用这一份规则，避免“测的不是玩的”。
## 一局：3 段场地（S1/S2/S3）〉 每段后「段间」（裂隙 / 游商 / 启程三选一）〉 BOSS。

const W := 3600.0
const H := 2400.0
const MARGIN := 170.0
const CELL := 80.0
const PH_SEG := 0
const PH_BREAK := 1
const PH_RIFT := 2
const PH_BOSS := 3
const PH_END := 4
const SW_NONE := 0
const SW_STOW := 1
const SW_ORBIT := 2
const SW_RECALL := 3
const SW_DROP := 4
const SW_CD := 5

var rng := RandomNumberGenerator.new()
var seed_v := 0
var emit := false
var events: Array = []
var touch := false

# ---- 输入（每步由外部写入；dash/skill 为边沿，step 消耗）----
var in_move := Vector2.ZERO
var in_dash := false
var in_skill := false

# ---- 全局状态 ----
var phase := PH_SEG
var t := 0.0
var real_t := 0.0
var seg := 0
var kills := 0
var coins := 0
var level := 1
var xp := 0
var need := 5
var pending_lv := 0
var pending_chest := 0
var over := false
var ended := false
var victory := false
var end_timer := -1.0
var bonus_soul := 0
var gem_count := 0
var dmg_by: Dictionary = {}
var uid_n := 0
var spawn_t := 0.6
var pack_t := 35.0
var event_idx := 0
var boss: SimEnemy = null
var boss_phase := false
var boss_t0 := -1.0
var boss_time := -1.0
var max_en := 220
var levels: Dictionary = {"fu": 1}
var evo: Dictionary = {}
var relics: Array = []
var meta: Dictionary = {"maxHp": 0.0, "dmg": 0.0, "speed": 0.0, "pickup": 0.0, "rerolls": 0, "revive": 0}
var rerolls := 2
var choice: Dictionary = {}
var choice_serial := 0
var cp_serial := 0
var announced: Dictionary = {}
var shop_serial := 0
var death_cause := ""
var last_src := ""

# ---- 玩家 ----
var px := W / 2.0
var py := H / 2.0
var hp := 100.0
var maxhp := 100.0
var invuln := 0.0
var dash_cd := 0.0
var dash_t := 0.0
var dash_inv := 0.0
var dash_dx := 1.0
var dash_dy := 0.0
var face := Vector2.RIGHT
var face_x := 1
var moving := false
var stun := 0.0
var revive := 0
var hurt_flash := 0.0
var vel := Vector2.ZERO

# ---- 汇总数值 ----
var s_speed := 215.0
var s_pickup := 75.0
var s_dmg_add := 0.0
var s_crit := 0.05
var s_crit_mul := 1.6
var s_dash_cd := 2.5
var s_fu_cd_mul := 1.0
var s_fu_speed_mul := 1.0
var s_fu_count := 0
var s_burn_dps := 0.0
var s_ignite := 0.0
var s_orb_r_mul := 1.0
var s_orb_spin_mul := 1.0
var s_chain := 0
var s_soul_mul := 1.0
var s_coin_chance := 0.04
var s_dmg_taken := 1.0
var s_invuln_add := 0.0

# ---- 实体 ----
var enemies: Array = []
var bullets: Array = []
var ebullets: Array = []
var pickups: Array = []
var teles: Array = []
var bolts: Array = []
var trails: Array = []
var grid: Dictionary = {}
var w_fu := 0.4
var w_fu_ring := 1.0
var w_lei := 1.2
var w_trail := 0.0
var orb_angle := 0.0
var orb_count := 0
var orb_pos: Array = []
var lei_queue: Array = []

# ---- v1.5：灯芯 / 副本 / 法宝 / 遗物 ----
var wicks := 2
var wick_spent_rift := 0
var wick_spent_shop := 0
var stretch := 1.0            # 模式拉伸：战斗节奏钟(t)每走 1 秒需要 stretch 个真实战斗秒；30 分钟=3.75，10 分钟=1.25，测试默认 1
var mode := "classic"
var clock := 0.0              # 玩家看到的战斗时钟（真实秒，不含段间/裂隙）
var gourds: Array = []          # 已得彩虹葫芦散件（颜色 id，不重复）
var pet_on := false
var pet_hp := 0.0
var pet_dead_t := 0.0
var pet_marks := 3
var pet_atk_t := 1.0
var pet_idx := 0
var pet_ang := 0.0
var pet_pos := Vector2.ZERO
var combo_cd := 0.0
var combo_fx := 0.0
var pet_fx: Array = []          # 渲染用的攻击特效 [type,x,y,life]
var in_combo := false
var mini_idx := 0
var vine_taken: Dictionary = {}
var rerolled := 0
var rift_from := 1
var rift_kind := "sword"       # sword / gourd / vault
var arena_spawned := 0
var arena_total := 0
var arena_next := 0.0
var set_depth := 0
var set_move_acc := 0.0
var set_kills := 0
var set_ward_cd := 0.0
var set_army_n := 0
var rift_poi := -1
var pois: Array = []          # 大地图上的“剑冢裂隙”入口：{x,y,name}
var poi_hold: Dictionary = {}
var explored := PackedByteArray()   # 36×24 格探索足迹（小地图）
var break_idx := -1          # 当前段间序号 0/1/2
var break_t := 0.0
var gift_pending := false
var rift_entries := 0
var rift_clears := 0
var rift_sealed: Dictionary = {}
var threat_next := 0
var threat_cur := 0
var hold: Dictionary = {}
var shop: Array = []
var shop_open := false
var shop_inside := false
var rift_t := 0.0
var rift_limit := 70.0
var rift_target := 55.0
var rift_warden: SimEnemy = null
var rift_hp_before := 0.0
var rift_dps_est := 0.0
var rift_dmg_dealt := 0.0
var rift_by: Dictionary = {}
var rift_parts: Dictionary = {}
var rift_ret := Vector2.ZERO
var artifact := ""           # 法宝（一局最多 1 件）
var sw_state := SW_NONE
var sw_t := 0.0
var sw_ang := 0.0
var sw_x := 0.0
var sw_y := 0.0
var sw_cd := 0.0
var sw_dir := Vector2.RIGHT
var sw_hit: Dictionary = {}
var sw_thrust_fx := 0.0
var sw_drops := 0
var sw_stage := 1
var sw_kills := 0
var sw_br: Dictionary = {"count": 0, "radius": 0, "cd": 0}
var sw_log: Array = []
var pending_sw := 0
var pending_fusion := 0
var fusion := ""
var fusion_t := -1.0
var sw_thrust2_t := -1.0
var sw_thrust2_dir := Vector2.LEFT
var sw_wheel_ang := 0.0
var sw_wheel_pos: Array = []
var sw_wheel_hit: Dictionary = {}
var sw_qi: Array = []
var sw_qi_t := 1.0
var sw_array_t := 4.0
var sw_array_fx := 0.0
var sw_unlock_seen := 1
var rift_log: Array = []     # 每次入副本的记录（供平衡统计）
var rift_deaths := 0
var rift_fails := 0
var banner_text := ""


func _init(p_seed: int = 1, opts: Dictionary = {}) -> void:
	GameData.load_all()
	seed_v = p_seed
	rng.seed = p_seed
	emit = opts.get("emit", false)
	touch = opts.get("touch", false)
	mode = String(opts.get("mode", "classic"))
	stretch = {"full": 3.75, "quick": 1.25}.get(mode, 1.0)
	var m: Dictionary = opts.get("meta", {})
	var saved: Dictionary = m
	for mm in GameData.META:
		var lvl: int = int(saved.get(mm.id, 0))
		match mm.stat:
			"maxHp": meta.maxHp += lvl * mm.per
			"dmg": meta.dmg += lvl * mm.per
			"speed": meta.speed += lvl * mm.per
			"pickup": meta.pickup += lvl * mm.per
			"rerolls": meta.rerolls += int(lvl * mm.per)
			"revive": meta.revive += int(lvl * mm.per)
	revive = int(meta.revive)
	rerolls = int(GameData.BAL.rerolls) + int(meta.rerolls)
	max_en = int(GameData.WV.maxEnemies)
	pack_t = GameData.WV.packs.from
	wicks = int(GameData.DG.wick.start)
	_recalc()
	hp = maxhp
	need = req_for(1)
	_gen_pois()
	_ev("start")


func _ev(name: String, a: Variant = null, b: Variant = null, c: Variant = null, d: Variant = null) -> void:
	if emit:
		events.append([name, a, b, c, d])


# ======================================================================
# 数值
# ======================================================================
func seg_n() -> int:
	return 6 if mode == "full" else 3


func seg_to(k: int) -> float:
	return 480.0 * float(k + 1) / float(seg_n())


func seg_from(k: int) -> float:
	return 480.0 * float(k) / float(seg_n())


func seg_theme(k: int) -> Dictionary:
	if seg_n() == 6:
		return GameData.SEG.themes[mini(k, 5)]
	return GameData.SEG.segments[mini(k, 2)]


func lv(id: String) -> int:
	return int(levels.get(id, 0))


func wstat(id: String) -> Dictionary:
	return GameData.UPS[id].stats[lv(id) - 1]


func req_for(level_: int) -> int:
	var first: Array = GameData.BAL.xp.first
	if level_ <= first.size():
		return int(first[level_ - 1])
	return int(round(first[first.size() - 1] * pow(GameData.BAL.xp.growth, level_ - first.size())))


func _per(id: String, k: String) -> float:
	var u: Dictionary = GameData.UPS[id]
	return lv(id) * float(u.per.get(k, 0.0))


func set_counts() -> Dictionary:
	var c: Dictionary = {}
	for rid in relics:
		var st: String = GameData.RELIC_BY_ID[rid].get("set", "")
		if st != "":
			c[st] = int(c.get(st, 0)) + 1
	return c


func active_sets() -> Array:
	var out: Array = []
	var c := set_counts()
	for st in GameData.SETS:
		if int(c.get(st.id, 0)) >= 2:
			out.append(st.id)
	return out


func _relic_sum(stat: String) -> float:
	var s := 0.0
	for rid in relics:
		var r: Dictionary = GameData.RELIC_BY_ID[rid]
		if r.stat == stat:
			s += float(r.per)
	for sid in active_sets():
		var st: Dictionary = GameData.SET_BY_ID[sid]
		if st.stat == stat:
			s += float(st.per)
	for gid in gourds:
		var gp: Dictionary = GameData.GP_BY_ID[gid]
		if gp.stat == stat:
			s += float(gp.per) * (1.0 + 0.1 * pet_marks if pet_on else 1.0)
	return s


var _sets_cache: Array = []
var _sets_dirty := true


func has_set(id: String) -> bool:
	if _sets_dirty:
		_sets_cache = active_sets()
		_sets_dirty = false
	return _sets_cache.has(id)


func _on_kill_sets(e: SimEnemy) -> void:
	if set_depth >= 2:
		return
	if has_set("flame") and e.burn_t > 0.0:
		set_depth += 1
		_ev("ring", e.x, e.y - 30.0, 100.0)
		for o: SimEnemy in _near(e.x, e.y, 130.0):
			if o != e and o.alive:
				_fusion_ignite(o)
		_aoe(e.x, e.y - 30.0, 100.0, 25.0, "setsplash")
		set_depth -= 1
	if has_set("wealth") and rng.randf() < 0.12:
		for i in range(3):
			_spawn_pickup("coin", e.x + (rng.randf() - 0.5) * 80.0, e.y + (rng.randf() - 0.5) * 50.0, 2)
	if has_set("soul"):
		set_kills += 1
		if set_kills % 12 == 0:
			hp = minf(maxhp, hp + 6.0)
			combo_cd = maxf(0.0, combo_cd - 3.0)
			_ev("heal", 6.0)


func has_part(id: String) -> bool:
	return relics.has(id)


func _recalc() -> void:
	_sets_dirty = true
	var P: Dictionary = GameData.BAL.player
	var T: Dictionary = GameData.BAL.touch
	maxhp = P.hp + meta.maxHp + _per("yupei", "maxHp") + _relic_sum("maxHp")
	s_speed = P.speed * (1.0 + meta.speed + _per("caolv", "speed") + _relic_sum("speed")) * (T.speedMul if touch else 1.0)
	s_pickup = P.pickup * (1.0 + meta.pickup + _per("hundai", "pickup") + _relic_sum("pickup")) * (T.pickupMul if touch else 1.0)
	# 加算：桃木心 / 局外强化 / 遗物 同一个加算池；武器进化与剑痕另加（见 _dmg_mul）
	s_dmg_add = meta.dmg + _per("taomu", "dmg") + _relic_sum("dmg")
	s_crit = P.crit + _per("tiangang", "crit") + _relic_sum("crit")
	s_crit_mul = P.critMul + _per("tiangang", "critMul")
	s_dash_cd = P.dashCd * (1.0 - _per("jingxin", "dashCd") - _relic_sum("dashCd")) * (T.dashCdMul if touch else 1.0)
	s_fu_cd_mul = 1.0 - _per("jishu", "fuCd")
	s_fu_speed_mul = 1.0 + _per("jishu", "fuSpeed")
	s_fu_count = int(_per("zhongfu", "fuCount"))
	s_burn_dps = GameData.BAL.burn.baseDps + _per("zhuohun", "burnDps")
	s_ignite = _per("zhuohun", "igniteChance")
	s_orb_r_mul = 1.0 + _per("tianyou", "orbRadius")
	s_orb_spin_mul = 1.0 + _per("tianyou", "orbSpin")
	s_chain = int(_per("leiyin", "chain")) + (2 if has_part("part_lei") else 0)
	s_soul_mul = 1.0 + _per("tongqian", "soulGain")
	s_coin_chance = GameData.BAL.drops.coin + _per("tongqian", "coinChance")
	s_dmg_taken = 1.0 + _relic_sum("dmgTaken")
	s_invuln_add = _relic_sum("invulnAdd")
	hp = minf(hp, maxhp)
	_sync_orbs()


func _sync_orbs() -> void:
	var want := 0
	if evo.has("huanhuo"):
		want = int(GameData.EVOS.huanhuo.stats.orbs)
	elif lv("huanhuo") > 0:
		want = int(wstat("huanhuo").orbs)
	orb_count = want + (2 if has_part("part_huanhuo") and want > 0 else 0)


## 伤害乘区（加算）：1 + 局外 + 桃木心 + 遗物 + 进化增伤 + 目标身上的剑痕 × 6%。法宝与进化不相乘。
func _dmg_mul(e: SimEnemy, weapon: String) -> float:
	var m := 1.0
	var dg: Dictionary = GameData.DG
	if weapon != "burn" and weapon != "blast":
		m += s_dmg_add
		var evo_key := weapon
		if weapon == "mark":
			evo_key = "fu"
		if evo.has(evo_key):
			m += GameData.BAL.evoAdd
	m += e.marks * float(dg.sword.markPer)
	return m


func in_rift() -> bool:
	return phase == PH_RIFT


## 各武器对单体的名义 DPS（已含加算乘区与暴击期望，未乘“实战效率”）
func dps_parts() -> Dictionary:
	var parts: Dictionary = {}
	var crit_f := 1.0 + clampf(s_crit, 0.0, 1.0) * (s_crit_mul - 1.0)
	if lv("fu") > 0:
		var st := wstat("fu")
		# 扇形发射：单个目标一般只吃到中间 ~3 张
		var n: float = minf(float(st.count + s_fu_count), 3.0)
		var d: float = st.dmg * n / (st.cd * s_fu_cd_mul)
		var m: float = 1.0 + s_dmg_add + (float(GameData.BAL.evoAdd) if evo.has("fu") else 0.0)
		if evo.has("fu"):
			var ev: Dictionary = GameData.EVOS.fu.stats
			d += st.dmg * 1.0 / (ev.ringCd * s_fu_cd_mul)
		parts["fu"] = d * m * crit_f
	if orb_count > 0:
		var st2: Dictionary = GameData.EVOS.huanhuo.stats if evo.has("huanhuo") else wstat("huanhuo")
		var d2: float = st2.dmg * orb_count / GameData.BAL.huanhuo.hitInterval
		var m2: float = 1.0 + s_dmg_add + (float(GameData.BAL.evoAdd) if evo.has("huanhuo") else 0.0)
		parts["huanhuo"] = d2 * m2 * crit_f + s_burn_dps * 0.8
	if lv("lei") > 0:
		var st3: Dictionary = wstat("lei")
		var cd3: float = st3.cd
		# 单体：每次劈落的多道天雷分给不同妖物，单个目标一次只吃 1 道
		if evo.has("lei"):
			cd3 = GameData.EVOS.lei.stats.cd
		var m3: float = 1.0 + s_dmg_add + (float(GameData.BAL.evoAdd) if evo.has("lei") else 0.0)
		parts["lei"] = st3.dmg / cd3 * m3 * (crit_f if not evo.has("lei") else s_crit_mul)
	if artifact == "sword":
		var sw: Dictionary = GameData.DG.sword
		var per_hit: float = sw.dmg * (1.0 + s_dmg_add + sw.markPer * 3.0) * crit_f
		parts["sword"] = per_hit / sw.hitInterval * 0.55
	return parts


## 玩家当前 DPS（对单体、按实战效率折算）：守关者血量 = 本值 × 目标击杀秒数。
## 效率系数 warden.eff 由真人代理在守关者战里的实测输出标定（含护甲、位移损失），见 README。
func build_dps() -> float:
	var eff: Dictionary = GameData.DG.warden.eff
	var d := 0.0
	var parts := dps_parts()
	for k in parts:
		d += parts[k] * float(eff.get(k, 0.5))
	return maxf(d, GameData.DG.warden.minDps)


# ======================================================================
# 主循环
# ======================================================================
func step(dt: float) -> void:
	if ended:
		return
	if over:
		if end_timer >= 0.0:
			end_timer -= dt
			if end_timer <= 0.0:
				_finish()
		return
	if not choice.is_empty() or shop_open:
		return
	real_t += dt
	match phase:
		PH_SEG, PH_BOSS:
			_step_combat(dt)
		PH_RIFT:
			_step_combat(dt)
			_step_rift(dt)
		PH_BREAK:
			_step_break(dt)
	in_dash = false
	in_skill = false
	in_combo = false
	if not over and choice.is_empty():
		if pending_fusion > 0 and phase != PH_RIFT:
			pending_fusion -= 1
			_open_choice("fusion")
		elif pending_sw > 0 and phase != PH_RIFT:
			pending_sw -= 1
			_open_choice("swb")
		elif pending_chest > 0 and phase != PH_RIFT:
			pending_chest -= 1
			_open_choice("chest")
		elif pending_lv > 0 and phase != PH_RIFT:
			pending_lv -= 1
			_ev("levelup")
			_open_choice("level")


func _step_combat(dt: float) -> void:
	if phase != PH_RIFT and clock >= float(GameData.DG.fusion.atRealSec):
		_trigger_fusion()
	if phase != PH_RIFT:
		t += dt / stretch
		clock += dt
	_rebuild_grid()
	_update_player(dt)
	if phase == PH_SEG:
		_update_spawns(dt)
	_update_weapons(dt)
	_update_sword(dt)
	_update_enemies(dt)
	_update_bullets(dt)
	_update_ebullets(dt)
	_update_pickups(dt)
	_update_teles(dt)
	_update_lamps(dt)
	_update_pois(dt)
	_update_pet(dt)
	_update_minis()
	if phase == PH_SEG and t >= seg_to(seg) - 20.0 / stretch and not announced.has(seg):
		announced[seg] = true
		_ev("banner", "20 秒后清场 · 场地中央将裂开「灯骸裂隙」", "#d9b8ff")
	if phase == PH_SEG and t >= seg_to(seg):
		_start_break(seg)


func _rebuild_grid() -> void:
	grid.clear()
	for e: SimEnemy in enemies:
		var k := int(e.x / CELL) * 4096 + int(e.y / CELL)
		var arr: Variant = grid.get(k)
		if arr == null:
			grid[k] = [e]
		else:
			(arr as Array).append(e)


func _near(x: float, y: float, r: float) -> Array:
	var out: Array = []
	var x0 := int((x - r) / CELL)
	var x1 := int((x + r) / CELL)
	var y0 := int((y - r) / CELL)
	var y1 := int((y + r) / CELL)
	for cx in range(x0, x1 + 1):
		for cy in range(y0, y1 + 1):
			var arr: Variant = grid.get(cx * 4096 + cy)
			if arr != null:
				for e: SimEnemy in arr:
					if e.alive:
						out.append(e)
	return out


func nearest_enemy(x: float, y: float, rng_: float) -> SimEnemy:
	var best: SimEnemy = null
	var bd := rng_ * rng_
	for e: SimEnemy in enemies:
		if not e.alive:
			continue
		var d := (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y)
		if d < bd:
			bd = d
			best = e
	return best


# ======================================================================
# 玩家
# ======================================================================
func _clamp_player() -> void:
	if phase == PH_RIFT:
		var c := Vector2(W / 2.0, H / 2.0)
		var v := Vector2(px, py) - c
		var R: float = GameData.DG.rift.arenaRadius
		if v.length() > R:
			v = v.normalized() * R
			px = c.x + v.x
			py = c.y + v.y
	else:
		px = clampf(px, MARGIN, W - MARGIN)
		py = clampf(py, MARGIN, H - MARGIN)


func _update_player(dt: float) -> void:
	var P: Dictionary = GameData.BAL.player
	var T: Dictionary = GameData.BAL.touch
	var mv := in_move
	var ln := mv.length()
	if ln > 1.0:
		mv = mv / ln
		ln = 1.0
	moving = ln > 0.001
	if moving:
		face = mv.normalized()
		if absf(mv.x) > 0.001:
			face_x = 1 if mv.x > 0.0 else -1
	dash_cd = maxf(0.0, dash_cd - dt)
	invuln = maxf(0.0, invuln - dt)
	dash_inv = maxf(0.0, dash_inv - dt)
	stun = maxf(0.0, stun - dt)
	hurt_flash = maxf(0.0, hurt_flash - dt)
	if in_dash and dash_cd <= 0.0 and dash_t <= 0.0:
		var d := mv.normalized() if moving else Vector2(face_x, 0)
		dash_dx = d.x
		dash_dy = d.y
		dash_t = P.dashTime
		dash_inv = P.dashInvuln + (T.dashInvulnAdd if touch else 0.0)
		var mulc := float(GameData.DG.rift.dashCdMul) if phase == PH_RIFT else 1.0
		dash_cd = s_dash_cd * mulc
		_ev("dash")
	var M: Dictionary = GameData.MV
	if dash_t > 0.0:
		dash_t -= dt
		var dn := Vector2(dash_dx, dash_dy).normalized()
		vel = dn * s_speed * P.dashSpeed
	else:
		# 目标速度 = 摇杆/按键向量(已限长 1) × 速度；向目标做线性加减速（accelTime / decelTime 外置）
		var tv := mv * s_speed
		if stun > 0.0:
			tv *= P.stunSlow
		var rate_t: float = float(M.accelTime) if tv.length() > vel.length() - 0.01 and moving else float(M.decelTime)
		if rate_t <= 0.0:
			vel = tv
		else:
			vel = vel.move_toward(tv, s_speed / rate_t * dt)
	if vel.length_squared() > 0.0001:
		px += vel.x * dt
		py += vel.y * dt
		_clamp_player()
		if has_set("swift") and phase == PH_SEG:
			set_move_acc += vel.length() * dt
			if set_move_acc >= 400.0:
				set_move_acc = 0.0
				_spawn_qi(760.0, atan2(vel.y, vel.x), 40.0 * (1.0 + s_dmg_add), 0.8, 3, false, "sw_array", null)


func hurt_player(dmg_in: float, fx: float, fy: float, src: String) -> void:
	var P: Dictionary = GameData.BAL.player
	var T: Dictionary = GameData.BAL.touch
	if over or invuln > 0.0 or dash_inv > 0.0:
		return
	var dmg := dmg_in * s_dmg_taken
	if touch:
		dmg *= T.dmgMul
	dmg = _pet_hurt(dmg)
	set_ward_cd = maxf(0.0, set_ward_cd)
	if has_set("ward") and set_ward_cd <= 0.0:
		set_ward_cd = 6.0
		ebullets.clear()
		_ev("ring", px, py - 30.0, 220.0)
		_aoe(px, py - 30.0, 200.0, 30.0, "setsplash")
	var hp_before := hp
	hp -= dmg
	invuln = P.invuln + (T.invulnAdd if touch else 0.0) + s_invuln_add
	var sm := float(GameData.DG.rift.stunMul) if phase == PH_RIFT else 1.0
	stun = P.stun * sm
	if src == "sedan:paper":
		stun = maxf(stun, float(GameData.MB.sedan.slow))
	hurt_flash = 0.12
	last_src = src
	if sw_state == SW_RECALL:
		_sword_drop()
	_ev("hurt", dmg)
	if fx > -1e8:
		var a := atan2(py - fy, px - fx)
		px += cos(a) * P.hurtPush
		py += sin(a) * P.hurtPush
		_clamp_player()
	if hp <= 0.0:
		if phase == PH_RIFT:
			rift_deaths += 1
			_rift_end(false, "death", hp_before)
		elif revive > 0:
			revive -= 1
			hp = round(maxhp * 0.5)
			invuln = 2.0
			_ev("revive")
		else:
			hp = 0.0
			death_cause = src
			over = true
			victory = false
			end_timer = 1.1 if emit else 0.0
			_ev("die")
			if end_timer <= 0.0:
				_finish()


func _update_lamps(dt: float) -> void:
	# 骨灯：对局中站在亮着的灯旁缓慢回血；副本内全熄，段间不生效（不做战斗间回血）
	if phase == PH_RIFT or phase == PH_BREAK or hp >= maxhp:
		return
	var L: Dictionary = GameData.BAL.lamp
	var c := Vector2(W / 2.0, H / 2.0)
	var sg: Dictionary = seg_theme(seg)
	for lp in sg.lamps:
		var dx: float = c.x + lp[0] - px
		var dy: float = c.y + lp[1] - py
		if dx * dx + dy * dy < L.radius * L.radius:
			hp = minf(maxhp, hp + L.heal * dt)
			return


# ======================================================================
# 刷怪 / 事件
# ======================================================================
func _threat_tier() -> int:
	return threat_cur


func _update_spawns(dt: float) -> void:
	var WV: Dictionary = GameData.WV
	var T: Dictionary = GameData.BAL.touch
	var minute := t / 60.0
	while event_idx < WV.events.size() and t >= float(WV.events[event_idx].at) and WV.events[event_idx].kind != "boss":
		_fire_event(WV.events[event_idx])
		event_idx += 1
	spawn_t -= dt
	if spawn_t <= 0.0:
		var tier := _threat_tier()
		var late := maxf(0.0, (t - float(WV.late.from)) / 60.0)
		var iv := maxf(WV.minInterval, WV.baseInterval * pow(WV.intervalMulPerMin, minute) * pow(WV.late.intervalMulPerMin, late))
		iv *= pow(GameData.DG.threat.intervalMul, tier)
		if touch:
			iv *= T.spawnIntervalMul
		spawn_t = iv
		var batch := 1 + int(minute * WV.batchPerMin + late * WV.late.batchPerMin)
		var pool: Dictionary = {}
		for pl in GameData.POOLS_REV:
			if t >= float(pl.from):
				pool = pl.weights
				break
		var bias: Dictionary = seg_theme(seg).get("bias", {}) if seg_n() == 6 else {}
		if not bias.is_empty():
			var np: Dictionary = {}
			for kk in pool:
				np[kk] = float(pool[kk]) * float(bias.get(kk, 1.0))
			pool = np
		var i := 0
		while i < batch and enemies.size() < max_en:
			spawn_enemy(_pick_weighted(pool))
			i += 1
	if t >= float(WV.packs.from):
		pack_t -= dt
		if pack_t <= 0.0:
			pack_t = WV.packs.every
			var a: int = WV.packs.size[0]
			var b: int = WV.packs.size[1]
			var n := a + int(rng.randf() * (b - a + 1)) + int(minute)
			var ang := rng.randf() * TAU
			var i2 := 0
			while i2 < n and enemies.size() < max_en:
				spawn_enemy(WV.packs.type, ang + (rng.randf() - 0.5) * 0.4, WV.spawnDist + rng.randf() * 80.0)
				i2 += 1


func _pick_weighted(weights: Dictionary) -> String:
	var total := 0.0
	for k in weights:
		total += weights[k]
	var r := rng.randf() * total
	var last := ""
	for k in weights:
		last = k
		r -= weights[k]
		if r <= 0.0:
			return k
	return last


func _fire_event(ev: Dictionary) -> void:
	if ev.kind == "banner":
		_ev("banner", ev.text, "#ffc977")
	elif ev.kind == "elite":
		_ev("banner", "%s 来袭" % ev.text, "#ff7a6a")
		_ev("sfx", "roar")
		spawn_enemy(ev.type, -1.0, -1.0, {"elite": true})
	elif ev.kind == "boss":
		_ev("banner", ev.text, "#ff7a6a")
		_ev("sfx", "roar")
		_ev("boss_start")
		spawn_enemy("boss", -1.0, 620.0, {"boss": true})
		for o: SimEnemy in enemies:
			if not o.alive or o.boss or o.elite:
				continue
			if Vector2(o.x - px, o.y - py).length() > 260.0:
				o.alive = false


func _spawn_point(angle: float, dist: float) -> Vector2:
	for i in range(6):
		var a := angle if (angle > -0.5 and i == 0) else rng.randf() * TAU
		var x := clampf(px + cos(a) * dist, MARGIN - 60.0, W - MARGIN + 60.0)
		var y := clampf(py + sin(a) * dist, MARGIN - 60.0, H - MARGIN + 60.0)
		if (x - px) * (x - px) + (y - py) * (y - py) > 520.0 * 520.0 or i == 5:
			return Vector2(x, y)
	return Vector2(px + dist, py)


func spawn_enemy(type: String, angle: float = -1.0, dist: float = -1.0, opts: Dictionary = {}) -> SimEnemy:
	var WV: Dictionary = GameData.WV
	var EN: Dictionary = GameData.EN
	if dist < 0.0:
		dist = WV.spawnDist
	var is_boss: bool = opts.get("boss", false)
	var def: Dictionary = EN.boss if is_boss else (opts.def if opts.has("def") else EN[type])
	var el: Dictionary = EN.elites[type] if opts.get("elite", false) else {}
	if opts.has("el"):
		el = opts.el
	var sp := _spawn_point(angle, dist)
	var e := SimEnemy.new()
	if opts.has("pos"):
		sp = opts.pos
	var tier := _threat_tier()
	var hp_mul := pow(WV.hpMulPerMin, t / 60.0) * pow(WV.late.hpPerMin, maxf(0.0, (t - float(WV.late.from)) / 60.0)) * pow(GameData.DG.threat.hpMul, tier)
	var scale_mul: float = el.scale if not el.is_empty() else 1.0
	e.uid = uid_n
	uid_n += 1
	e.type = type
	e.def = def
	e.el = el
	e.boss = is_boss
	e.elite = not el.is_empty()
	e.scale_mul = scale_mul
	e.x = sp.x
	e.y = sp.y
	if is_boss:
		e.hp = def.hp * pow(GameData.DG.threat.bossHpMul, tier)
		e.armor = def.get("armor", 0.0)
	elif e.elite:
		e.hp = el.hp
		e.armor = el.get("armor", 0.0)
	else:
		e.hp = def.hp * hp_mul
	e.speed = (el.speed if e.elite else def.speed) * (0.9 + rng.randf() * 0.2)
	e.dmg = el.dmg if e.elite else def.dmg
	e.xpv = int(el.xp if e.elite else def.xp)
	e.r = def.r * scale_mul
	e.h = def.h * scale_mul
	e.face_right = def.get("faceRight", true)
	e.phase = rng.randf() * TAU
	e.hop = rng.randf()
	e.ai = "boss" if is_boss else def.ai
	e.shoot_t = (el.shootCd if e.elite and el.has("shootCd") else def.get("shootCd", 0.0)) * (0.5 + rng.randf() * 0.5)
	e.slam_t = el.slamCd if e.elite and el.has("slamCd") else 0.0
	e.atk_t = 2.5 if is_boss else 0.0
	e.ring_t = el.ringCd * 0.6 if e.elite and el.has("ringCd") else 0.0
	e.maxhp = e.hp
	if is_boss:
		boss = e
		boss_t0 = real_t
	enemies.append(e)
	if e.elite and not opts.get("warden", false):
		_ev("elite", e)
	return e


# ======================================================================
# 伤害 / 击杀
# ======================================================================
func damage(e: SimEnemy, base: float, weapon: String, o: Dictionary = {}) -> void:
	if not e.alive:
		return
	var dmg := base * _dmg_mul(e, weapon)
	var crit := false
	if not o.has("noCrit") and (o.has("forceCrit") or rng.randf() < s_crit):
		crit = true
		dmg *= s_crit_mul
	var synergy := weapon == "lei" and e.burn_t > 0.0 and lv("leiyin") > 0
	if synergy:
		dmg *= 1.0 + GameData.BAL.lei.burnBonus
	if e.stagger_t > 0.0:
		dmg *= float(GameData.DG.warden.lunge.staggerTakenMul)
	if e.armor > 0.0 and not o.has("pierce"):
		dmg *= 1.0 - e.armor
	e.hp -= dmg
	if phase == PH_RIFT and e.warden:
		rift_dmg_dealt += dmg
		var rk := "huanhuo" if weapon == "burn" else ("fu" if weapon == "mark" else weapon)
		rift_by[rk] = float(rift_by.get(rk, 0.0)) + dmg
	var key := weapon
	if weapon == "burn":
		key = "huanhuo" if lv("huanhuo") > 0 else "fu"
	elif weapon == "mark":
		key = "fu"
	dmg_by[key] = float(dmg_by.get(key, 0.0)) + dmg
	if o.has("kx") and not e.boss:
		var l := maxf(0.001, Vector2(o.kx, o.ky).length())
		var kb: float = o.get("kb", GameData.BAL.knockback)
		var kk := 0.15 if e.elite else float(e.def.get("knock", 1.0))
		e.kvx += o.kx / l * kb * kk
		e.kvy += o.ky / l * kb * kk
	if not o.has("noFlash"):
		e.flash = 0.08
	if emit:
		_ev("dmg", e, dmg, crit, synergy)
	if weapon != "burn" and weapon != "huanhuo" and s_ignite > 0.0 and rng.randf() < s_ignite:
		_ignite(e)
	if crit and has_set("burst") and set_depth < 2 and weapon != "setsplash":
		set_depth += 1
		_aoe(e.x, e.y - e.h * 0.4, 90.0, base * 0.3, "setsplash")
		set_depth -= 1
	if weapon == "sword" and has_set("army"):
		set_army_n += 1
		if set_army_n % 8 == 0 and set_depth < 2:
			set_depth += 1
			_ev("ring", px, py - 30.0, 140.0)
			_aoe(px, py - 30.0, 140.0, 30.0, "setsplash")
			set_depth -= 1
	if e.hp <= 0.0:
		_kill(e, weapon)


func _ignite(e: SimEnemy) -> void:
	if s_burn_dps <= 0.0:
		return
	if e.burn_t <= 0.0:
		e.burn_tick = GameData.BAL.burn.tick
	e.burn_t = GameData.BAL.burn.time
	e.burn_dps = s_burn_dps


func _kill(e: SimEnemy, _weapon: String) -> void:
	if not e.alive:
		return
	e.alive = false
	kills += 1
	_on_kill_sets(e)
	if has_part("part_huanhuo"):
		hp = minf(maxhp, hp + 1.0)
	if e.el.has("mini"):
		_mini_drop(e)
	if has_sword() and sw_stage < 5:
		sw_kills += 1
		if sw_kills >= int(GameData.DG.sword.stages.kills[sw_stage - 1]):
			_sword_advance("剑意(击杀)")
	e.mark_t = 0.0
	_ev("kill", e)
	if e.warden:
		return
	if e.elite:
		_spawn_pickup("chest", e.x, e.y, 1)
	if e.xpv > 0:
		if e.elite:
			for i in range(8):
				_spawn_pickup("soul", e.x + (rng.randf() - 0.5) * 80.0, e.y + (rng.randf() - 0.5) * 60.0, int(ceil(e.xpv / 8.0)))
		else:
			_spawn_pickup("soul", e.x, e.y, e.xpv)
	var r := rng.randf()
	var D: Dictionary = GameData.BAL.drops
	if r < D.oil:
		_spawn_pickup("oil", e.x + 10.0, e.y, 1)
	elif r < D.oil + s_coin_chance:
		_spawn_pickup("coin", e.x - 10.0, e.y, 1 + int(t / 120.0))
	if e == boss:
		boss_time = real_t - boss_t0
		_ev("boss_dead")
		over = true
		victory = true
		end_timer = 0.75 if emit else 0.0
		if end_timer <= 0.0:
			_finish()


# ======================================================================
# 武器（驱邪符 / 灯火环 / 掌心雷 + 进化）
# ======================================================================
func _update_weapons(dt: float) -> void:
	var BAL: Dictionary = GameData.BAL
	_update_marks()
	if lv("fu") > 0:
		w_fu -= dt
		var st := wstat("fu")
		if w_fu <= 0.0:
			var tgt := nearest_enemy(px, py - 30.0, BAL.fu.range)
			if tgt != null:
				w_fu = st.cd * s_fu_cd_mul
				var n: int = int(st.count) + s_fu_count
				var base := atan2(tgt.y - tgt.h * 0.4 - (py - 40.0), tgt.x - px)
				for i in range(n):
					_fire_talisman(base + (i - (n - 1) / 2.0) * BAL.fu.spread, st)
				_ev("sfx", "shoot")
			else:
				w_fu = 0.1
		if evo.has("fu"):
			w_fu_ring -= dt
			var ev: Dictionary = GameData.EVOS.fu.stats
			if w_fu_ring <= 0.0:
				w_fu_ring = ev.ringCd * s_fu_cd_mul
				var rc := int(ev.ringCount)
				for i in range(rc):
					_fire_talisman(float(i) / rc * TAU + t, st)
				_ev("ring", px, py - 40.0, 90.0)
	# 灯火环
	if orb_count > 0:
		var st2: Dictionary = GameData.EVOS.huanhuo.stats if evo.has("huanhuo") else wstat("huanhuo")
		var radius: float = st2.radius * s_orb_r_mul
		orb_angle += BAL.huanhuo.spin * s_orb_spin_mul * dt
		var evo_h := evo.has("huanhuo")
		if evo_h:
			w_trail -= dt
		orb_pos.resize(orb_count)
		for i in range(orb_count):
			var a := orb_angle + float(i) / orb_count * TAU
			var ox := px + cos(a) * radius
			var oy := py - 30.0 + sin(a) * radius * 0.8
			orb_pos[i] = Vector2(ox, oy)
			for e: SimEnemy in _near(ox, oy + 20.0, 60.0):
				if real_t - e.orb_hit < BAL.huanhuo.hitInterval:
					continue
				if Vector2(e.x - ox, e.y - e.h * 0.4 - oy).length() > e.r + 26.0:
					continue
				e.orb_hit = real_t
				if e.mark_t > 0.0:
					_detonate_mark(e)
				if not e.alive:
					continue
				damage(e, st2.dmg, "huanhuo", {"kx": e.x - px, "ky": e.y - py, "kb": BAL.huanhuo.knock})
				if e.alive and lv("zhuohun") > 0:
					_ignite(e)
			if evo_h and w_trail <= 0.0:
				trails.append({"x": ox, "y": oy + 20.0, "life": GameData.EVOS.huanhuo.stats.trailLife, "tick": 0.0})
		if evo_h and w_trail <= 0.0:
			w_trail = GameData.EVOS.huanhuo.stats.trailEvery
	# 火路
	for i in range(trails.size() - 1, -1, -1):
		var tr: Dictionary = trails[i]
		tr.life -= dt
		if tr.life <= 0.0:
			trails.remove_at(i)
			continue
		tr.tick -= dt
		if tr.tick <= 0.0:
			tr.tick = 0.5
			for e: SimEnemy in _near(tr.x, tr.y, 70.0):
				if Vector2(e.x - tr.x, e.y - tr.y).length() >= 30.0 + e.r:
					continue
				if e.mark_t > 0.0:
					_detonate_mark(e)
				if not e.alive:
					continue
				damage(e, GameData.EVOS.huanhuo.stats.trailDmg, "huanhuo", {"noFlash": true, "noCrit": true})
				if e.alive and lv("zhuohun") > 0:
					_ignite(e)
	# 掌心雷
	if lv("lei") > 0:
		w_lei -= dt
		if w_lei <= 0.0:
			var st3 := wstat("lei")
			var evl := evo.has("lei")
			var cands: Array = []
			for e: SimEnemy in _near(px, py, BAL.lei.range):
				if Vector2(e.x - px, e.y - py).length() < BAL.lei.range:
					cands.append(e)
			if cands.size() > 0:
				var evs: Dictionary = GameData.EVOS.lei.stats
				w_lei = evs.cd if evl else st3.cd
				var strikes: int = int(evs.strikes if evl else st3.strikes) + (1 if has_part("part_lei") else 0)
				var chain: int = int(st3.chain) + s_chain + (int(evs.chainBonus) if evl else 0)
				var hit_set: Dictionary = {}
				var k := 0
				while k < strikes and cands.size() > 0:
					var idx := int(rng.randf() * cands.size())
					var tgt2: SimEnemy = cands[idx]
					cands.remove_at(idx)
					lei_queue.append({"t": k * BAL.lei.strikeGap, "tgt": tgt2, "dmg": st3.dmg, "chain": chain, "set": hit_set, "evo": evl})
					k += 1
			else:
				w_lei = 0.2
	# 落雷排队（等价于原版 delayedCall）
	for i in range(lei_queue.size() - 1, -1, -1):
		var q: Dictionary = lei_queue[i]
		q.t -= dt
		if q.t <= 0.0:
			lei_queue.remove_at(i)
			_thunder(q.tgt, q.dmg, q.chain, q.set, q.evo)


func _fire_talisman(angle: float, st: Dictionary) -> void:
	var b := SimBullet.new()
	var sp: float = GameData.BAL.fu.speed * s_fu_speed_mul
	b.x = px
	b.y = py - 40.0
	b.vx = cos(angle) * sp
	b.vy = sin(angle) * sp
	b.ang = angle
	b.life = GameData.BAL.fu.life
	b.dmg = st.dmg
	b.pierce = int(st.pierce) + (int(GameData.EVOS.fu.stats.pierceBonus) if evo.has("fu") else 0)
	b.mark = evo.has("fu")
	bullets.append(b)


func _update_bullets(dt: float) -> void:
	for i in range(bullets.size() - 1, -1, -1):
		var b: SimBullet = bullets[i]
		b.x += b.vx * dt
		b.y += b.vy * dt
		b.life -= dt
		var dead := b.life <= 0.0
		if not dead:
			for e: SimEnemy in _near(b.x, b.y, 70.0):
				if b.hits.has(e.uid):
					continue
				var cy := e.y - e.h * 0.45
				if absf(e.x - b.x) > e.r + 16.0 or absf(cy - b.y) > e.h * 0.5 + 6.0:
					continue
				b.hits[e.uid] = true
				if b.mark and not (e.mark_t > 0.0):
					e.mark_t = GameData.EVOS.fu.stats.markDelay
					e.mark_dmg = b.dmg
				damage(e, b.dmg, "fu", {"kx": b.vx, "ky": b.vy})
				if has_part("part_fu") and rng.randf() < 0.35:
					_aoe(b.x, b.y, 80.0, b.dmg * 0.5, "mark")
				b.pierce -= 1
				if b.pierce < 0:
					dead = true
					break
		if dead:
			bullets.remove_at(i)


func _update_marks() -> void:
	pass


func _detonate_mark(e: SimEnemy) -> void:
	var ev: Dictionary = GameData.EVOS.fu.stats
	var dmg: float = (e.mark_dmg if e.mark_dmg > 0.0 else 10.0) * ev.markRatio
	e.mark_t = 0.0
	var x := e.x
	var y := e.y - e.h * 0.4
	_ev("ring", x, y, ev.markRadius)
	var hits: Array = []
	for o: SimEnemy in _near(x, y + 40.0, ev.markRadius + 80.0):
		if Vector2(o.x - x, o.y - o.h * 0.4 - y).length() < ev.markRadius + o.r:
			hits.append(o)
	for o: SimEnemy in hits:
		damage(o, dmg, "mark", {"noCrit": true, "kx": o.x - x, "ky": o.y - y, "kb": GameData.BAL.knockback * 0.6})


func _thunder(tgt: SimEnemy, dmg: float, chain: int, hit_set: Dictionary, evl: bool) -> void:
	if not tgt.alive or over:
		return
	var L: Dictionary = GameData.BAL.lei
	_ev("thunder", tgt.x, tgt.y)
	hit_set[tgt.uid] = true
	var o1 := {"kx": tgt.x - px, "ky": tgt.y - py, "kb": L.knock}
	if evl:
		o1["forceCrit"] = true
	var was_burn := tgt.burn_t > 0.0
	damage(tgt, dmg, "lei", o1)
	if was_burn and has_set("thunder") and set_depth < 2:
		set_depth += 1
		_aoe(tgt.x, tgt.y - 40.0, 130.0, dmg * 0.5, "setsplash")
		set_depth -= 1
	var from := tgt
	var d := dmg
	for c in range(chain):
		var nxt: SimEnemy = null
		var bd: float = L.chainRange * L.chainRange
		for e: SimEnemy in _near(from.x, from.y, L.chainRange):
			if hit_set.has(e.uid):
				continue
			var dd := (e.x - from.x) * (e.x - from.x) + (e.y - from.y) * (e.y - from.y)
			if dd < bd:
				bd = dd
				nxt = e
		if nxt == null:
			break
		hit_set[nxt.uid] = true
		d *= L.chainRatio
		if emit:
			bolts.append({"x1": from.x, "y1": from.y - 40.0, "x2": nxt.x, "y2": nxt.y - 40.0, "life": 0.18, "seed": rng.randf()})
		var o2 := {}
		if evl:
			o2["forceCrit"] = true
		damage(nxt, d, "lei", o2)
		from = nxt


# ======================================================================
# 法宝：飞剑术
# ======================================================================
func has_sword() -> bool:
	return artifact == "sword"


func _sword_drop() -> void:
	var sw: Dictionary = GameData.DG.sword
	sw_state = SW_DROP
	sw_t = sw.dropTime
	sw_drops += 1
	_ev("sword_drop")


func _sword_hit_mul_dmg() -> float:
	return GameData.DG.sword.dmg


func _update_sword(dt: float) -> void:
	if not has_sword():
		return
	var sw: Dictionary = GameData.DG.sword
	# 剑痕衰减
	for e: SimEnemy in enemies:
		if e.marks > 0:
			e.marks_t -= dt
			if e.marks_t <= 0.0:
				e.marks = 0
	var want := in_skill
	match sw_state:
		SW_STOW:
			sw_cd = maxf(0.0, sw_cd - dt)
			sw_x = px
			sw_y = py - 30.0
			if want and sw_cd <= 0.0:
				sw_state = SW_ORBIT
				sw_t = sw.orbitTime
				sw_ang = 0.0
				sw_hit.clear()
				_ev("sword_out")
		SW_ORBIT:
			sw_t -= dt
			sw_ang += sw.orbitW * dt
			sw_x = px + cos(sw_ang) * sw.orbitRx * sw_rm()
			sw_y = py - 30.0 + sin(sw_ang) * sw.orbitRy * sw_rm()
			for e: SimEnemy in _near(sw_x, sw_y + 20.0, 80.0):
				var last: float = sw_hit.get(e.uid, -10.0)
				if real_t - last < sw.hitInterval:
					continue
				if Vector2(e.x - sw_x, e.y - e.h * 0.4 - sw_y).length() > e.r + sw.hitR:
					continue
				sw_hit[e.uid] = real_t
				_sword_strike(e, sw.dmg, false)
			if want:
				sw_state = SW_RECALL
				sw_t = sw.recallWindow
				sw_dir = face
				_ev("sword_recall")
			elif sw_t <= 0.0:
				sw_state = SW_CD
				sw_t = sw.cd * sw_cdm()
				_ev("sword_back")
		SW_RECALL:
			sw_t -= dt
			var k := clampf(1.0 - sw_t / sw.recallWindow, 0.0, 1.0)
			sw_x = lerpf(sw_x, px, k)
			sw_y = lerpf(sw_y, py - 30.0, k)
			if sw_t <= 0.0:
				_sword_thrust()
				sw_state = SW_CD
				sw_t = sw.cd * sw_cdm()
		SW_DROP:
			sw_t -= dt
			if sw_t <= 0.0:
				sw_state = SW_STOW
				sw_cd = 0.0
		SW_CD:
			sw_t -= dt
			sw_x = px
			sw_y = py - 30.0
			if sw_t <= 0.0:
				sw_state = SW_STOW
				sw_cd = 0.0
	sw_thrust_fx = maxf(0.0, sw_thrust_fx - dt)
	_update_sword_stages(dt)


func _sword_strike(e: SimEnemy, base: float, thrust: bool, key: String = "sword", crit: bool = false) -> void:
	var sw: Dictionary = GameData.DG.sword
	# 先叠剑痕再结算：本次伤害就吃到新层（+6%/层，5 层封顶）
	e.marks = mini(int(sw.markMax), e.marks + 1)
	e.marks_t = sw.markLife
	var o := {"pierce": true, "kx": e.x - px, "ky": e.y - py, "kb": 60.0}
	if crit:
		o["forceCrit"] = true
	# 阶段与剑冢通关带来的剑意增益（加算，随飞剑成长）：+30%/阶 +25%/次剑冢通关
	var grow := 1.0 + 0.3 * float(sw_stage - 1) + 0.25 * float(rift_clears)
	damage(e, base * grow * (sw.thrustMul if thrust else 1.0), key, o)


func _sword_thrust(dir_override: Vector2 = Vector2.ZERO, key: String = "sword") -> void:
	var sw: Dictionary = GameData.DG.sword
	sw_thrust_fx = 0.25
	var d := (dir_override if dir_override != Vector2.ZERO else sw_dir).normalized()
	if key == "sword":
		sw_thrust2_dir = -d
		if sw_stage >= 2:
			sw_thrust2_t = float(sw.stages.thrust2.delay)
	var first := true
	_ev("sword_thrust", px, py - 30.0, d)
	var ox := px
	var oy := py - 30.0
	for e: SimEnemy in enemies.duplicate():
		if not e.alive:
			continue
		var vx := e.x - ox
		var vy := e.y - e.h * 0.4 - oy
		var proj := vx * d.x + vy * d.y
		if proj < -20.0 or proj > sw.thrustLen:
			continue
		var perp := absf(vx * d.y - vy * d.x)
		if perp > sw.thrustHalfW + e.r:
			continue
		_sword_strike(e, sw.dmg * (float(sw.stages.thrust2.mul) if key != "sword" else 1.0), true, key)
		if first and fusion == "lei" and e.alive:
			first = false
			_thunder(e, sw.dmg * 0.9, 2, {}, false)


# ======================================================================
# 妖物 AI
# ======================================================================
func _update_enemies(dt: float) -> void:
	var BAL: Dictionary = GameData.BAL
	var tx := px
	var ty := py - 20.0
	var alive_list: Array = []
	for e: SimEnemy in enemies:
		if not e.alive:
			continue
		var dx := tx - e.x
		var dy := ty - e.y
		var dist := maxf(0.001, sqrt(dx * dx + dy * dy))
		var ux := dx / dist
		var uy := dy / dist
		var vx := 0.0
		var vy := 0.0
		e.squash = 1.0
		e.lift = 0.0
		if e.flash > 0.0:
			e.flash -= dt
		if e.burn_t > 0.0:
			e.burn_t -= dt
			e.burn_tick -= dt
			if e.burn_tick <= 0.0:
				e.burn_tick = BAL.burn.tick
				damage(e, e.burn_dps * BAL.burn.tick, "burn", {"noFlash": true, "noCrit": true})
				if not e.alive:
					continue
		if e.mark_t > 0.0:
			e.mark_t -= dt
			if e.mark_t <= 0.0:
				_detonate_mark(e)
			if not e.alive:
				continue
		match e.ai:
			"chase":
				vx = ux * e.speed
				vy = uy * e.speed
			"hop":
				var per: float = e.def.hopPeriod
				e.hop += dt / per
				var ph := fmod(e.hop, 1.0)
				if ph < 0.6:
					var s := sin(ph / 0.6 * PI)
					vx = ux * e.speed * 2.2 * s
					vy = uy * e.speed * 2.2 * s
					e.lift = s * 16.0
				else:
					e.squash = 1.0 - sin((ph - 0.6) / 0.4 * PI) * 0.12
				if e.elite:
					_elite_slam(e, dt, dist)
					if e.ember:
						_warden_ember(e, dt)
			"ranged":
				var keep: float = e.def.keep
				var sp := e.speed
				if e.state == "charge":
					e.timer -= dt
					e.squash = 1.15
					if e.timer <= 0.0:
						_enemy_shoot(e, ux, uy)
						e.state = "move"
				else:
					if dist > keep + 40.0:
						vx = ux * sp
						vy = uy * sp
					elif dist < keep - 40.0:
						vx = -ux * sp
						vy = -uy * sp
					else:
						vx = -uy * sp * 0.5
						vy = ux * sp * 0.5
					e.shoot_t -= dt
					if e.elite and e.el.has("ringCd"):
						_elite_ring(e, dt)
					if e.shoot_t <= 0.0 and dist < 620.0:
						e.shoot_t = e.el.shootCd if e.elite else e.def.shootCd
						e.state = "charge"
						e.timer = e.el.charge if e.elite else e.def.charge
				if e.warn_t > 0.0:
					e.warn_t -= dt
					vx *= 0.2
					vy *= 0.2
				e.lift = sin(real_t * 3.0 + e.phase) * 6.0
			"bomber":
				if e.state == "fuse":
					e.timer -= dt
					e.squash = 1.0 + (1.0 - e.timer / e.def.fuse) * 0.3
					if e.timer <= 0.0:
						_explode_bomber(e)
						continue
				else:
					vx = ux * e.speed
					vy = uy * e.speed
					if dist < e.def.trigger:
						e.state = "fuse"
						e.timer = e.def.fuse
						_add_tele(e.x, e.y, e.def.blastR, e.def.fuse, Callable(), e)
						_ev("sfx", "warn")
			"swordwarden":
				var wv := _swordwarden_ai(e, dt, ux, uy, dist)
				vx = wv.x
				vy = wv.y
				e.lift = sin(real_t * 2.0) * 8.0
			"swordlord", "sedan", "lamps":
				var mvv := _mini_ai(e, dt, ux, uy, dist)
				vx = mvv.x
				vy = mvv.y
				e.lift = sin(real_t * 2.0) * 8.0
			"boss":
				_boss_ai(e, dt)
				if e.warn_t > 0.0:
					e.warn_t -= dt
				var f := 0.2 if e.warn_t > 0.0 else 1.0
				vx = ux * e.speed * f
				vy = uy * e.speed * f
				e.lift = sin(real_t * 1.6) * 10.0
		# 击退衰减 + 同格分离
		var decay := pow(0.0015, dt)
		e.kvx *= decay
		e.kvy *= decay
		var sx := 0.0
		var sy := 0.0
		var arr: Variant = grid.get(int(e.x / CELL) * 4096 + int(e.y / CELL))
		if arr != null and (arr as Array).size() > 1:
			for o: SimEnemy in arr:
				if o == e:
					continue
				var ox := e.x - o.x
				var oy := e.y - o.y
				var d2 := ox * ox + oy * oy
				var rr := e.r + o.r
				if d2 < rr * rr and d2 > 0.01:
					var d := sqrt(d2)
					var push := (rr - d) / rr
					sx += ox / d * push * 90.0
					sy += oy / d * push * 90.0
		e.x += (vx + e.kvx + sx) * dt
		e.y += (vy + e.kvy + sy) * dt
		e.vx = vx
		e.vy = vy
		if absf(vx) > 4.0:
			e.flip = (vx > 0.0) != e.face_right
		if e.boss or e.elite:
			if phase == PH_RIFT:
				var c := Vector2(W / 2.0, H / 2.0)
				var v := Vector2(e.x, e.y) - c
				var R: float = GameData.DG.rift.arenaRadius + 30.0
				if v.length() > R:
					v = v.normalized() * R
					e.x = c.x + v.x
					e.y = c.y + v.y
			else:
				e.x = clampf(e.x, MARGIN - 40.0, W - MARGIN + 40.0)
				e.y = clampf(e.y, MARGIN - 40.0, H - MARGIN + 40.0)
		# 接触伤害
		e.contact_cd -= dt
		if not over and e.contact_cd <= 0.0 and dist < e.r + BAL.player.radius + 6.0:
			hurt_player(e.dmg, e.x, e.y, ("warden" if e.warden else ("boss" if e.boss else e.type)) + ":contact")
			e.contact_cd = 0.5
		# 离太远的普通妖物回收
		if not e.alive:
			continue
		if not e.boss and not e.elite and dist > 1500.0:
			e.alive = false
			continue
		alive_list.append(e)
	enemies = alive_list


func warden_blade_pos(e: SimEnemy, i: int) -> Vector2:
	var C: Dictionary = GameData.DG.warden
	var a := e.blade_ang + float(i) / float(C.blades) * TAU
	return Vector2(e.x + cos(a) * float(C.bladeRx), e.y - e.h * 0.45 + sin(a) * float(C.bladeRy))


func _swordwarden_ai(e: SimEnemy, dt: float, ux: float, uy: float, dist: float) -> Vector2:
	var C: Dictionary = GameData.DG.warden
	var L: Dictionary = C.lunge
	e.stagger_t = maxf(0.0, e.stagger_t - dt)
	e.blade_hit_cd = maxf(0.0, e.blade_hit_cd - dt)
	for i in range(int(C.blades)):
		e.blade_down[i] = maxf(0.0, float(e.blade_down[i]) - dt)
	# 御剑环身：三把灵剑绕它回旋，触碰受伤；玩家的飞剑回旋碰到灵剑会把它击落一阵（剑碰剑）
	if e.blades_t > 0.0:
		e.blades_t -= dt
		e.blade_ang += float(C.bladeW) * dt
		for i in range(int(C.blades)):
			if float(e.blade_down[i]) > 0.0:
				continue
			var bp := warden_blade_pos(e, i)
			if has_sword() and sw_state == SW_ORBIT and Vector2(sw_x, sw_y).distance_to(bp) < float(C.clashR):
				e.blade_down[i] = float(C.clashDown)
				_ev("clash", bp.x, bp.y)
				continue
			if e.blade_hit_cd <= 0.0 and not over and bp.distance_to(Vector2(px, py - 34.0)) < float(C.bladeHitR):
				hurt_player(float(C.bladeDmg), bp.x, bp.y, "warden:blade")
				e.blade_hit_cd = float(C.bladeHitCd)
	# 回鞘突刺：红线预警 → 沿锁定方向冲撞 → 冲完露出破绽（承伤 ×staggerTakenMul）
	if e.state == "lunge":
		e.timer -= dt
		if not e.lunge_hit and not over and Vector2(px, py - 20.0).distance_to(Vector2(e.x, e.y - 20.0)) < e.r + 22.0 + float(L.width) * 0.5:
			e.lunge_hit = true
			hurt_player(float(L.dmg), e.x, e.y, "warden:lunge")
		if e.timer <= 0.0:
			e.state = "move"
			e.stagger_t = float(L.stagger)
			_ev("stagger", e.x, e.y)
		return e.lunge_dir * float(L.speed)
	if e.warn_t > 0.0:
		e.warn_t -= dt
		if e.warn_t <= 0.0:
			e.state = "lunge"
			e.timer = float(L.len) / float(L.speed)
			e.lunge_hit = false
		return Vector2.ZERO
	if e.stagger_t > 0.0:
		return Vector2.ZERO
	var dirp := Vector2(ux, uy)
	var v := dirp * e.speed
	if dist < 170.0:
		v = -dirp * e.speed * 0.5
	elif dist < 280.0:
		v = Vector2(-uy, ux) * e.speed * 0.6
	e.atk_t -= dt
	if e.atk_t <= 0.0:
		e.atk_t = float(C.cycleGap)
		match e.atk_idx % 3:
			0:
				e.blades_t = float(C.orbitTime)
				e.blade_down = [0.0, 0.0, 0.0]
				_ev("sfx", "warn")
			1:
				e.lunge_dir = Vector2(px - e.x, py - 20.0 - (e.y - 20.0)).normalized()
				e.warn_t = float(L.warn)
				_ev("sfx", "warn")
			2:
				var R: Dictionary = C.rain
				for k in range(int(R.count)):
					var rx := px + (0.0 if k == 0 else (rng.randf() - 0.5) * 2.0 * float(R.spread))
					var ry := py + (0.0 if k == 0 else (rng.randf() - 0.5) * 2.0 * float(R.spread) * 0.7)
					var rcb := func() -> void:
						_ev("shock", rx, ry, float(R.r))
						if Vector2(px - rx, py - ry).length() < float(R.r) + 8.0:
							hurt_player(float(R.dmg), rx, ry, "warden:rain")
					_add_tele(rx, ry, float(R.r), float(R.warn) + k * 0.1, rcb, null)
				_ev("sfx", "warn")
		e.atk_idx += 1
	return v


func _elite_slam(e: SimEnemy, dt: float, dist: float) -> void:
	e.slam_t -= dt
	if e.slam_t <= 0.0 and dist < 420.0:
		var cdm := 0.7 if e.quake else 1.0
		var rm := 1.15 if e.quake else 1.0
		e.slam_t = e.el.slamCd * cdm
		var x := e.x
		var y := e.y
		var rad: float = e.el.slamR * rm
		var dmg: float = e.el.slamDmg
		var src := ("warden" if e.warden else "elite_" + e.type) + ":slam"
		var cb := func() -> void:
			if not e.alive:
				return
			_ev("shock", x, y, rad)
			if Vector2(px - x, py - y).length() < rad + 10.0:
				hurt_player(dmg, x, y, src)
		_add_tele(x, y, rad, e.el.slamWarn, cb, null)


func _warden_ember(e: SimEnemy, dt: float) -> void:
	e.ember_t -= dt
	if e.ember_t > 0.0:
		return
	var af: Dictionary = GameData.DG.warden.affixes[2]
	e.ember_t = af.ringCd
	var cb := func() -> void:
		if not e.alive:
			return
		_ev("sfx", "eshot")
		var n := int(af.ringCount)
		for i in range(n):
			var a := float(i) / n * TAU + real_t
			_spawn_ebullet(e.x, e.y - e.h * 0.5, cos(a) * af.bulletSpeed, sin(a) * af.bulletSpeed, af.bulletDmg, "warden:bullet")
	_add_tele(e.x, e.y, 120.0, af.ringWarn, cb, e)


func _elite_ring(e: SimEnemy, dt: float) -> void:
	if e.warn_t > 0.0:
		return
	e.ring_t -= dt
	if e.ring_t > 0.0:
		return
	e.ring_t = e.el.ringCd
	e.warn_t = e.el.ringWarn
	_ev("sfx", "warn")
	var cb := func() -> void:
		if not e.alive:
			return
		_ev("sfx", "eshot")
		var n := int(e.el.ringCount)
		for i in range(n):
			var a := float(i) / n * TAU + real_t
			_spawn_ebullet(e.x, e.y - e.h * 0.5, cos(a) * e.el.bulletSpeed * 0.8, sin(a) * e.el.bulletSpeed * 0.8, e.el.bulletDmg, "elite_lantern:bullet")
	_add_tele(e.x, e.y, e.el.ringTeleR, e.el.ringWarn, cb, e)


func _boss_ai(e: SimEnemy, dt: float) -> void:
	var B: Dictionary = GameData.EN.boss
	var ph := 1 if boss_phase else 0
	if not boss_phase and e.hp < e.maxhp * 0.5:
		boss_phase = true
		_ev("banner", "灯骸老祖 • 灯火尽燃", "#ff7a6a")
		_ev("sfx", "roar")
		e.speed *= 1.3
	e.atk_t -= dt
	if e.atk_t > 0.0:
		return
	e.atk_t = B.cd[ph]
	var move := e.atk_idx % 3
	e.atk_idx += 1
	if move == 0:
		var n := int(B.ringCount[ph])
		var rings := 2 if boss_phase else 1
		e.warn_t = B.ringWarn
		_ev("sfx", "warn")
		for r in range(rings):
			var rr := r
			var cb := func() -> void:
				if not e.alive:
					return
				_ev("sfx", "eshot")
				var sp: float = B.ringSpeed * (1.0 if rr == 0 else 0.78)
				for i in range(n):
					var a := float(i) / n * TAU + rr * (PI / n) + real_t * 0.3
					_spawn_ebullet(e.x, e.y - 120.0, cos(a) * sp, sin(a) * sp, B.bulletDmg, "boss:bullet")
			_add_tele(e.x, e.y, B.ringTeleR if r == 0 else 0.0, B.ringWarn + r * 0.32, cb, e)
	elif move == 1:
		for i in range(int(B.slamCount[ph])):
			var x := px + (0.0 if i == 0 else (rng.randf() - 0.5) * 360.0)
			var y := py + (0.0 if i == 0 else (rng.randf() - 0.5) * 260.0)
			var cb2 := func() -> void:
				_ev("shock", x, y, B.slamR)
				if Vector2(px - x, py - y).length() < B.slamR + 8.0:
					hurt_player(B.slamDmg, x, y, "boss:slam")
			_add_tele(x, y, B.slamR, B.slamWarn[ph] + i * 0.12, cb2, null)
		_ev("sfx", "warn")
	elif enemies.size() < B.summonCap:
		var cnt := int(B.summon) + (4 if boss_phase else 0) + int(GameData.DG.threat.bossSummonAdd) * _threat_tier()
		for i in range(cnt):
			var a := float(i) / cnt * TAU
			var m := spawn_enemy("paperman", 0.0, 0.0)
			m.x = e.x + cos(a) * 140.0
			m.y = e.y + sin(a) * 100.0


func _enemy_shoot(e: SimEnemy, ux: float, uy: float) -> void:
	var s: Dictionary = e.el if e.elite else e.def
	var n: int = int(e.el.fan) if e.elite else 1
	var base := atan2(uy, ux)
	_ev("sfx", "eshot")
	for i in range(n):
		var a: float = base + (i - (n - 1) / 2.0) * (float(e.el.fanSpread) if e.elite else 0.0)
		_spawn_ebullet(e.x, e.y - e.h * 0.5, cos(a) * s.bulletSpeed, sin(a) * s.bulletSpeed, s.bulletDmg, ("elite_" if e.elite else "") + e.type + ":bullet")


func _explode_bomber(e: SimEnemy) -> void:
	var d: Dictionary = e.def
	_ev("boom", e.x, e.y - 20.0)
	if Vector2(px - e.x, py - e.y).length() < d.blastR + 10.0:
		hurt_player(d.blastDmg, e.x, e.y, "firecracker:blast")
	var x := e.x
	var y := e.y
	_kill(e, "blast")
	for o: SimEnemy in _near(x, y, d.blastR + 30.0):
		if Vector2(o.x - x, o.y - y).length() < d.blastR + o.r:
			damage(o, d.blastEnemyDmg, "blast", {"kx": o.x - x, "ky": o.y - y, "noCrit": true})


func _spawn_ebullet(x: float, y: float, vx: float, vy: float, dmg: float, src: String) -> void:
	var b := SimBullet.new()
	b.x = x
	b.y = y
	b.vx = vx
	b.vy = vy
	b.dmg = dmg
	b.life = 5.0
	b.mark = false
	b.hits = {"src": src}
	ebullets.append(b)


func _update_ebullets(dt: float) -> void:
	for i in range(ebullets.size() - 1, -1, -1):
		var b: SimBullet = ebullets[i]
		b.x += b.vx * dt
		b.y += b.vy * dt
		b.life -= dt
		var dead := b.life <= 0.0
		if not dead and not over and Vector2(b.x - px, b.y - (py - 34.0)).length() < 26.0:
			hurt_player(b.dmg, b.x, b.y, b.hits.src)
			dead = true
		if dead:
			ebullets.remove_at(i)


func _add_tele(x: float, y: float, r: float, dur: float, cb: Callable, follow: SimEnemy) -> void:
	var tl := SimTele.new()
	tl.x = x
	tl.y = y
	tl.r = r
	tl.dur = dur
	tl.cb = cb
	tl.follow = follow
	teles.append(tl)


func _update_teles(dt: float) -> void:
	for i in range(teles.size() - 1, -1, -1):
		if i >= teles.size():
			continue
		var tl: SimTele = teles[i]
		tl.t += dt
		if tl.follow != null:
			if not tl.follow.alive:
				teles.remove_at(i)
				continue
			tl.x = tl.follow.x
			tl.y = tl.follow.y
		if tl.t >= tl.dur:
			teles.remove_at(i)
			if tl.cb.is_valid():
				tl.cb.call()


# ======================================================================
# 掉落与拾取
# ======================================================================
func _spawn_pickup(kind: String, x: float, y: float, val: int) -> void:
	var D: Dictionary = GameData.BAL.drops
	if kind == "soul" and gem_count >= int(D.maxGems):
		var best: SimPickup = null
		var bd := 1e18
		for k: SimPickup in pickups:
			if k.kind != "soul" or k.mag:
				continue
			var d := (k.x - x) * (k.x - x) + (k.y - y) * (k.y - y)
			if d < bd:
				bd = d
				best = k
		if best != null:
			best.val += val
			return
	var k2 := SimPickup.new()
	k2.kind = kind
	k2.x = x
	k2.y = y - 18.0
	k2.val = val
	k2.bob = rng.randf() * TAU
	k2.born = real_t
	if kind == "soul":
		gem_count += 1
	pickups.append(k2)


func _update_pickups(dt: float) -> void:
	var B: Dictionary = GameData.BAL.player
	var D: Dictionary = GameData.BAL.drops
	var tx := px
	var ty := py - 30.0
	for i in range(pickups.size() - 1, -1, -1):
		var k: SimPickup = pickups[i]
		var dx := tx - k.x
		var dy := ty - k.y
		var d := maxf(0.001, sqrt(dx * dx + dy * dy))
		if not over:
			if not k.mag and d < s_pickup:
				k.mag = true
				k.spd = -D.magnetPop
			if k.mag:
				k.spd = minf(B.magnetSpeed, k.spd + 1600.0 * dt)
				k.x += dx / d * k.spd * dt
				k.y += dy / d * k.spd * dt
			elif k.kind == "soul" and d < B.lightPull:
				k.x += dx / d * B.lightPullSpeed * dt
				k.y += dy / d * B.lightPullSpeed * dt
			if d < 22.0 and k.spd >= 0.0:
				pickups.remove_at(i)
				_collect(k)
				continue
		k.bob += dt * 4.0


func _collect(k: SimPickup) -> void:
	var D: Dictionary = GameData.BAL.drops
	match k.kind:
		"soul":
			gem_count = maxi(0, gem_count - 1)
			_ev("pickup", k.val)
			_gain_xp(k.val)
		"coin":
			_ev("sfx", "coin")
			coins += k.val
		"oil":
			if phase != PH_RIFT:
				var h := minf(D.oilHeal, maxhp - hp)
				hp += h
				_ev("heal", h)
		"chest":
			_ev("sfx", "chest")
			pending_chest += 1


func _gain_xp(v: int) -> void:
	xp += v
	while xp >= need:
		xp -= need
		level += 1
		need = req_for(level)
		pending_lv += 1


# ======================================================================
# 三选一 / 宝箱 / 馈赠
# ======================================================================
const RARITY := ["white", "blue", "purple", "gold"]


func _school_weapon(school: String) -> String:
	for u in GameData.UP.list:
		if u.type == "weapon" and u.school == school:
			return u.id
	return ""


func _open_choice(kind: String) -> void:
	var opts := roll_choices(kind == "chest")
	if kind == "swb":
		opts = swb_options()
	elif kind == "fusion":
		opts = fusion_options()
	if kind == "gift":
		opts = opts.filter(func(o): return o.kind != "heal")
		if opts.size() < 3:
			opts.append({"kind": "soul", "id": "soul", "icon": "huanhun", "name": "守夜魂火", "school": "gen", "rarity": "white", "lvText": "补给", "desc": "结算魂火 +%d" % int(GameData.BAL.soul.fillerSoul)})
	choice = {"kind": kind, "options": opts}
	choice_serial += 1
	_ev("choice", kind)


func _card_hint(u: Dictionary) -> String:
	for ev in GameData.UP.evolutions:
		if ev.weapon == u.id:
			return "\n满级 + %s → 进化「%s」" % [GameData.UPS[ev.needs].name, ev.name]
		if ev.needs == u.id:
			return "\n配合满级%s → 进化「%s」" % [GameData.UPS[ev.weapon].name, ev.name]
	for r in GameData.RELICS:
		if r.has("part") and r.part == u.id:
			return "\n满级可购金件：%s" % r.name
	return ""


func roll_choices(is_chest: bool) -> Array:
	var UPL: Array = GameData.UP.list
	var out: Array = []
	for ev in GameData.UP.evolutions:
		if not evo.has(ev.weapon) and lv(ev.weapon) >= int(GameData.UPS[ev.weapon].max) and lv(ev.needs) >= 1:
			out.append({"kind": "evo", "id": ev.id, "weapon": ev.weapon, "icon": ev.icon, "name": ev.name, "school": ev.school, "rarity": "gold",
				"lvText": "%s Lv%d + %s 〉 进化" % [GameData.UPS[ev.weapon].name, int(GameData.UPS[ev.weapon].max), GameData.UPS[ev.needs].name], "desc": Cards.fill(ev.desc, ev.stats) if emit else ""})
	var cand: Array = []
	for u in UPL:
		if lv(u.id) < int(u.max) and not (u.type == "weapon" and evo.has(u.id)):
			cand.append(u)
	var weights: Array = []
	for u in cand:
		var l := lv(u.id)
		var w := (1.3 if l == 0 else 1.6) if u.type == "weapon" else 1.0
		if l > 0:
			w *= 3.0 if is_chest else 1.4
		for ev in GameData.UP.evolutions:
			if ev.needs == u.id and not evo.has(ev.weapon) and lv(ev.weapon) >= 3 and l == 0:
				w *= 2.0
				break
		if u.type == "passive":
			var sw_ := _school_weapon(u.school)
			if sw_ != "" and lv(sw_) == 0:
				w *= 0.4
		weights.append(w)
	var picked: Array = []
	while out.size() + picked.size() < 3 and cand.size() > 0:
		var owned_only := is_chest and picked.size() == 0 and cand.any(func(u): return lv(u.id) > 0)
		var w2: Array = []
		for j in range(cand.size()):
			w2.append(weights[j] if (not owned_only or lv(cand[j].id) > 0) else 0.0)
		var total := 0.0
		for x in w2:
			total += x
		var r := rng.randf() * total
		var idx := 0
		while idx < cand.size() - 1:
			r -= w2[idx]
			if r <= 0.0 and w2[idx] > 0.0:
				break
			idx += 1
		if not (w2[idx] > 0.0):
			for j in range(w2.size() - 1, -1, -1):
				if w2[j] > 0.0:
					idx = j
					break
		var u2: Dictionary = cand[idx]
		cand.remove_at(idx)
		weights.remove_at(idx)
		var from := lv(u2.id)
		var to := mini(int(u2.max), from + (int(GameData.BAL.drops.chestLevels) if (is_chest and from > 0) else 1))
		var rarity := "blue" if (u2.type == "weapon" and from == 0) else ("purple" if to >= int(u2.max) else ("blue" if to >= 3 else "white"))
		if is_chest:
			rarity = RARITY[mini(2, RARITY.find(rarity) + 1)]
		var lvt := ""
		if emit:
			lvt = ("新武器 • Lv 1" if u2.type == "weapon" else "新被动 • Lv 1") if from == 0 else "Lv %d 〉 %d%s" % [from, to, "（满级）" if to >= int(u2.max) else ""]
		picked.append({"kind": "up", "id": u2.id, "icon": u2.icon, "name": u2.name, "school": u2.school, "rarity": rarity, "from": from, "to": to,
			"lvText": lvt, "desc": (Cards.describe(u2, from, to) + _card_hint(u2)) if emit else ""})
	if is_chest:
		picked.sort_custom(func(a, b): return RARITY.find(a.rarity) > RARITY.find(b.rarity))
	out.append_array(picked)
	var D: Dictionary = GameData.BAL.drops
	var fillers: Array = [
		{"kind": "heal", "id": "heal", "icon": "yupei", "name": "灯火续命", "school": "gen", "rarity": "white", "lvText": "补给", "desc": "回复 %d 生命" % int(D.fillerHeal)},
		{"kind": "soul", "id": "soul", "icon": "huanhun", "name": "守夜魂火", "school": "gen", "rarity": "white", "lvText": "补给", "desc": "结算魂火 +%d" % int(GameData.BAL.soul.fillerSoul)},
		{"kind": "coin", "id": "coin", "icon": "tongqian", "name": "铜钱满袋", "school": "gen", "rarity": "white", "lvText": "补给", "desc": "铜钱 +%d\n（每枚结算魂火 +%d）" % [int(D.fillerCoins), int(GameData.BAL.soul.perCoin)]},
	]
	for f in fillers:
		if out.size() < 3:
			out.append(f)
	return out.slice(0, 3)


func choose(i: int) -> void:
	if choice.is_empty():
		return
	var kind: String = choice.kind
	var c: Dictionary = choice.options[clampi(i, 0, choice.options.size() - 1)]
	if c.kind == "up":
		var u: Dictionary = GameData.UPS[c.id]
		var from := lv(c.id)
		var to := mini(int(u.max), int(c.get("to", from + 1)))
		levels[c.id] = to
		if u.has("per") and u.per.has("maxHp"):
			hp += u.per.maxHp * (to - from)
		if c.id == "lei" and from == 0:
			w_lei = 0.3
	elif c.kind == "swb":
		sw_br[c.id] = int(sw_br.get(c.id, 0)) + 1
		sw_log.append({"t": snappedf(real_t, 0.1), "branch": c.id})
	elif c.kind == "fus":
		fusion = c.id
		fusion_t = real_t
		sw_log.append({"t": snappedf(real_t, 0.1), "fusion": c.id})
		_ev("banner", "融合 • %s" % GameData.DG.fusion.names[c.id], "#ffcf5a")
	elif c.kind == "evo":
		evo[c.weapon] = true
		_ev("banner", "进化 • %s" % c.name, "#ffcf5a")
	elif c.kind == "heal":
		hp += GameData.BAL.drops.fillerHeal
	elif c.kind == "soul":
		bonus_soul += int(GameData.BAL.soul.fillerSoul)
	elif c.kind == "coin":
		coins += int(GameData.BAL.drops.fillerCoins)
	_recalc()
	hp = minf(hp, maxhp)
	invuln = maxf(invuln, 0.5)
	choice = {}
	_ev("choice_done", kind)
	if kind != "gift":
		checkpoint()
	if kind == "gift":
		gift_pending = false
		_advance()


func reroll() -> bool:
	if choice.is_empty() or rerolls <= 0 or choice.kind == "swb" or choice.kind == "fusion":
		return false
	rerolls -= 1
	choice_serial += 1
	choice.options = roll_choices(choice.kind == "chest")
	if choice.kind == "gift":
		choice.options = choice.options.filter(func(o): return o.kind != "heal")
		if choice.options.size() < 3:
			choice.options.append({"kind": "soul", "id": "soul", "icon": "huanhun", "name": "守夜魂火", "school": "gen", "rarity": "white", "lvText": "补给", "desc": "结算魂火 +%d" % int(GameData.BAL.soul.fillerSoul)})
	return true


func owned() -> Array:
	var list: Array = []
	for u in GameData.UP.list:
		var l := lv(u.id)
		if l == 0:
			continue
		var ev: bool = u.type == "weapon" and evo.has(u.id)
		list.append({"icon": GameData.EVOS[u.id].icon if ev else u.icon, "lv": "进" if ev else str(l), "weapon": u.type == "weapon", "name": GameData.EVOS[u.id].name if ev else u.name})
	list.sort_custom(func(a, b): return int(a.weapon) > int(b.weapon))
	return list


# ======================================================================
# 段间：清场 〉 裂隙 / 游商 / 启程
# ======================================================================
func break_pos(zone: String) -> Vector2:
	var B: Dictionary = GameData.SEG["break"]
	var c := Vector2(W / 2.0, H / 2.0)
	var o: Array = B[zone]
	return c + Vector2(o[0], o[1])


func _start_break(k: int) -> void:
	phase = PH_BREAK
	break_idx = k
	break_t = 0.0
	gift_pending = true
	hold.clear()
	shop_open = false
	shop_inside = false
	# 清场：妖物散去；精英留宝箱；掉落全部吸向主角
	for e: SimEnemy in enemies:
		if e.alive and e.elite:
			_spawn_pickup("chest", e.x, e.y, 1)
			for i in range(6):
				_spawn_pickup("soul", e.x + (rng.randf() - 0.5) * 60.0, e.y, int(ceil(e.xpv / 6.0)))
		e.alive = false
	enemies.clear()
	ebullets.clear()
	bullets.clear()
	teles.clear()
	trails.clear()
	lei_queue.clear()
	for p in pickups:
		p.mag = true
		p.spd = 120.0
	boss = null
	# BOSS 前额外 1 枚灯芯
	if k == seg_n() - 1:
		wicks += int(GameData.DG.wick.beforeBoss)
		_ev("banner", "灯芯 +1 • 决战在即", "#ffc977")
	_ev("break_start", k)
	if k >= int(GameData.DG.fusion.atBreak):
		_trigger_fusion()
	_roll_shop()
	_ev("banner", "灯骸裂隙已开启 · 走到场地中央的紫色光柱站定进入" if rift_state() == "ok" else ("灯弱，不可入裂隙（生命需不低于 60%）" if rift_state() == "weak" else "裂隙不可进入"), "#d9b8ff")
	checkpoint()
	if sw_state == SW_ORBIT or sw_state == SW_RECALL:
		sw_state = SW_CD
		sw_t = 0.5


func part_ready(pid: String) -> bool:
	var w: String = GameData.RELIC_BY_ID[pid].part
	if w == "sword":
		return has_sword() and sw_stage >= 5
	return lv(w) >= int(GameData.UPS[w].max)


func price_of(rid: String) -> int:
	return int(GameData.GD.prices[GameData.RELIC_BY_ID[rid].tier])


func _roll_shop() -> void:
	var pool: Array = []
	var parts: Array = []
	for r in GameData.RELICS:
		if relics.has(r.id):
			continue
		if r.has("part"):
			if part_ready(r.id):
				parts.append(r.id)
		else:
			pool.append(r.id)
	shop.clear()
	if parts.size() > 0:
		shop.append(parts[int(rng.randf() * parts.size())])   # 满级进化件优先上架
	while shop.size() < 3 and pool.size() > 0:
		var i := int(rng.randf() * pool.size())
		shop.append(pool[i])
		pool.remove_at(i)


func reroll_shop() -> bool:
	if wicks < int(GameData.GD.rerollWicks):
		return false
	wicks -= int(GameData.GD.rerollWicks)
	_roll_shop()
	shop_serial += 1
	return true


func rift_gate(sealed_key: int) -> String:
	## 进入裂隙的通用条件（段间与大地图入口共用）：返回 "ok" 或原因
	if rift_sealed.has(sealed_key):
		return "sealed"
	if rift_entries >= int(GameData.DG.rift.maxEntries):
		return "max"
	if hp < maxhp * float(GameData.DG.rift.hpGate):
		return "weak"
	if wicks < int(GameData.DG.wick.riftCost):
		return "nowick"
	return "ok"


func rift_state() -> String:
	## "ok" 可进；否则返回不可进的原因
	if phase != PH_BREAK:
		return "none"
	return rift_gate(break_idx)


func poi_state(i: int) -> String:
	if phase == PH_SEG and (pois[i].kind == "gourd" or pois[i].kind == "vault"):
		return "sealed" if rift_sealed.has(100 + i) else "ok"
	if phase != PH_SEG or pois[i].kind != "sword":
		return "none"
	return rift_gate(100 + i)


func _gen_pois() -> void:
	# 大地图上两处剑冢裂隙入口（东北 / 西南），战斗中靠近站定即可进入；出生点旁刷一只古灯宝箱
	var c := Vector2(W / 2.0, H / 2.0)
	pois = [{"kind": "sword", "x": c.x + 450.0, "y": c.y - 300.0, "name": "剑冢裂隙 • 东北"}, {"kind": "sword", "x": c.x - 1100.0, "y": c.y + 720.0, "name": "剑冢裂隙 • 西南"},
		{"kind": "merchant", "x": c.x - 300.0, "y": c.y - 200.0, "name": "游商灯摊"},
		{"kind": "vine", "x": c.x + 300.0, "y": c.y + 250.0, "name": "葫芦灵藤"}, {"kind": "vine", "x": c.x - 1300.0, "y": c.y - 300.0, "name": "葫芦灵藤"},
		{"kind": "gourd", "x": c.x + 1300.0, "y": c.y + 650.0, "name": "古药葫芦秘境"}, {"kind": "vault", "x": c.x - 400.0, "y": c.y - 950.0, "name": "镇魂宝库"}]
	explored.resize(36 * 24)
	_spawn_pickup("chest", c.x + 160.0, c.y + 90.0, 1)


func _mark_explored() -> void:
	if phase == PH_RIFT:
		return
	var gx := int(px / (W / 36.0))
	var gy := int(py / (H / 24.0))
	for dy in range(-1, 2):
		for dx in range(-1, 2):
			var x := gx + dx
			var y := gy + dy
			if x >= 0 and x < 36 and y >= 0 and y < 24:
				explored[y * 36 + x] = 1


func _update_pois(dt: float) -> void:
	_mark_explored()
	if phase != PH_SEG:
		return
	var zr: float = GameData.SEG["break"].zoneR
	for i in range(pois.size()):
		var pp := Vector2(float(pois[i].x), float(pois[i].y))
		if pois[i].kind == "vine":
			if vine_taken.has(i):
				continue
			if Vector2(px, py).distance_to(pp) < zr:
				poi_hold[i] = float(poi_hold.get(i, 0.0)) + dt
				if float(poi_hold[i]) >= float(GameData.DG.rift.hold):
					vine_taken[i] = true
					if not grant_gourd():
						coins += 80
			else:
				poi_hold[i] = 0.0
			continue
		if pois[i].kind == "merchant":
			if Vector2(px, py).distance_to(pp) < zr:
				poi_hold[i] = float(poi_hold.get(i, 0.0)) + dt
				if float(poi_hold[i]) >= float(GameData.DG.rift.hold) and not shop_inside:
					poi_hold[i] = 0.0
					shop_inside = true
					_roll_shop()
					shop_open = true
					shop_serial += 1
					_ev("shop_open")
			else:
				poi_hold[i] = 0.0
				shop_inside = false
			continue
		if Vector2(px, py).distance_to(pp) < zr and poi_state(i) == "ok":
			var is_arena: bool = pois[i].kind == "gourd" or pois[i].kind == "vault"
			poi_hold[i] = float(poi_hold.get(i, 0.0)) + dt
			if float(poi_hold[i]) >= float(GameData.DG.rift.hold):
				poi_hold[i] = 0.0
				if is_arena:
					enter_arena(i, String(pois[i].kind))
				else:
					enter_rift(i)
				return
		else:
			poi_hold[i] = 0.0


func _step_break(dt: float) -> void:
	break_t += dt
	_rebuild_grid()
	_update_player(dt)
	_update_bullets(dt)
	_update_pickups(dt)
	_update_sword(dt)
	var zr: float = GameData.SEG["break"].zoneR
	var here := Vector2(px, py)
	var hold_t: float = GameData.DG.rift.hold
	for z in ["rift", "merchant", "gate"]:
		var inside := here.distance_to(break_pos(z)) < zr
		if z == "rift" and rift_state() != "ok":
			inside = false
		if inside:
			hold[z] = float(hold.get(z, 0.0)) + dt
			if hold[z] >= hold_t:
				hold[z] = 0.0
				match z:
					"rift":
						enter_rift()
						return
					"merchant":
						if not shop_inside:
							shop_inside = true
							shop_open = true
							shop_serial += 1
							_ev("shop_open")
					"gate":
						leave_break()
						return
		else:
			hold[z] = 0.0
			if z == "merchant":
				shop_inside = false
	if break_t >= float(GameData.SEG["break"].max):
		leave_break()


func leave_break() -> void:
	if phase != PH_BREAK:
		return
	if gift_pending:
		_open_choice("gift")
	else:
		_advance()


func _advance() -> void:
	var k := break_idx
	hold.clear()
	shop_open = false
	if k >= seg_n() - 1:
		phase = PH_BOSS
		t = float(GameData.WV.events[GameData.WV.events.size() - 1].at)
		_ev("banner", "灯骸老祖 降临", "#ff7a6a")
		_ev("sfx", "roar")
		_ev("boss_start")
		threat_cur = threat_next
		threat_next = 0
		for ev in GameData.WV.events:
			if ev.kind == "boss":
				_fire_event(ev)
		event_idx = GameData.WV.events.size()
	else:
		seg = k + 1
		phase = PH_SEG
		t = seg_from(seg)
		threat_cur = threat_next
		threat_next = 0
		spawn_t = 1.0
		_ev("seg_start", seg)
	break_idx = -1
	checkpoint()


func buy_relic(i: int) -> bool:
	if i < 0 or i >= shop.size():
		return false
	var rid: String = shop[i]
	var price := price_of(rid)
	if coins < price:
		return false
	coins -= price
	wick_spent_shop += 1
	relics.append(rid)
	shop_serial += 1
	shop.remove_at(i)
	_recalc()
	_ev("relic", rid)
	return true


func close_shop() -> void:
	shop_open = false


# ======================================================================
# 灯骸裂隙（副本）
# ======================================================================
func enter_rift(poi: int = -1) -> bool:
	if poi < 0 and rift_state() != "ok":
		return false
	if poi >= 0 and poi_state(poi) != "ok":
		return false
	rift_from = phase
	rift_poi = poi
	checkpoint()   # 进副本前存档（存的是进入前的状态：灯芯未扣）
	var dg: Dictionary = GameData.DG
	wicks -= int(dg.wick.riftCost)
	wick_spent_rift += 1
	rift_entries += 1
	var entry_no := rift_entries
	if poi < 0:
		gift_pending = false       # 进入即放弃本段段间的三选一
	shop_open = false
	rift_ret = Vector2(px, py)
	rift_hp_before = hp
	phase = PH_RIFT
	rift_t = 0.0
	rift_dmg_dealt = 0.0
	var tcfg: Dictionary = dg.rift.entries[mini(entry_no, 2) - 1]
	rift_target = tcfg.target
	rift_limit = tcfg.limit
	pickups.clear()
	gem_count = 0
	bullets.clear()
	ebullets.clear()
	var c := Vector2(W / 2.0, H / 2.0)
	px = c.x - 260.0
	py = c.y
	face = Vector2.RIGHT
	invuln = 1.0
	dash_cd = 0.0
	rift_dps_est = build_dps()
	rift_parts = dps_parts()
	rift_by = {}
	# 守关者：剑冢「剑灵」——专属机制（御剑环身 / 回鞘突刺 / 剑雨），血量 = 当前 DPS × 目标击杀秒数
	var wd: Dictionary = dg.warden
	var wdef := {"name": wd.name, "tex": wd.tex, "h": wd.h, "r": wd.r, "hp": 1, "speed": wd.speed, "dmg": wd.dmg, "xp": 0, "ai": "swordwarden", "faceRight": true, "knock": 0.0, "fx": "spark"}
	var base_el := {"name": wd.name, "scale": wd.scale, "hp": rift_dps_est * rift_target, "dmg": wd.dmg, "speed": wd.speed, "xp": 0, "armor": wd.armor, "glow": 0}
	var w := spawn_enemy("swordwarden", -1.0, -1.0, {"el": base_el, "def": wdef, "pos": c + Vector2(float(dg.rift.spawnDist), 0.0), "warden": true})
	w.warden = true
	w.atk_t = 1.5
	w.maxhp = w.hp
	rift_warden = w
	_ev("rift_enter", entry_no)
	_ev("banner", "剑灵现身 • 御剑环身 / 回鞘突刺（之后露破绽）/ 剑雨", "#9fe8ff")
	return true


func enter_arena(poi: int, kind: String) -> void:
	rift_from = phase
	rift_poi = poi
	rift_kind = kind
	checkpoint()
	rift_ret = Vector2(px, py)
	phase = PH_RIFT
	rift_t = 0.0
	rift_limit = 75.0 if kind == "vault" else 60.0
	pickups.clear()
	gem_count = 0
	bullets.clear()
	ebullets.clear()
	var c := Vector2(W / 2.0, H / 2.0)
	px = c.x - 260.0
	py = c.y
	invuln = 1.0
	arena_spawned = 0
	arena_total = 4 if kind == "vault" else 30
	arena_next = 1.0
	rift_warden = null
	_ev("rift_enter", 9)
	_ev("banner", "镇魂宝库 • 限时清空精英潮" if kind == "vault" else "古药葫芦秘境 • 清除守护妖藤与小怪", "#ffcf5a")


func _arena_step(dt: float) -> void:
	arena_next -= dt
	if arena_spawned < arena_total and arena_next <= 0.0:
		var c := Vector2(W / 2.0, H / 2.0)
		if rift_kind == "vault":
			arena_next = 7.0
			var base: Dictionary = GameData.EN.elites["jiangshi" if arena_spawned % 2 == 0 else "lantern"].duplicate()
			base.hp = float(base.hp) * 0.3
			base.xp = 0
			base.name = "镇魂守卫"
			var a := rng.randf() * TAU
			spawn_enemy("jiangshi" if arena_spawned % 2 == 0 else "lantern", -1.0, -1.0, {"elite": true, "el": base, "pos": c + Vector2(cos(a), sin(a)) * 330.0})
			arena_spawned += 1
		else:
			arena_next = 5.0
			for i in range(10):
				var a2 := rng.randf() * TAU
				spawn_enemy("paperman" if i % 3 != 0 else "foxfire", -1.0, -1.0, {"pos": c + Vector2(cos(a2), sin(a2)) * 380.0})
				arena_spawned += 1
	var alive := 0
	for e: SimEnemy in enemies:
		if e.alive:
			alive += 1
	if arena_spawned >= arena_total and alive == 0:
		_arena_end(true)
	elif rift_t >= rift_limit:
		_arena_end(false)


func _arena_end(ok: bool) -> void:
	for e2: SimEnemy in enemies:
		e2.alive = false
	enemies.clear()
	ebullets.clear()
	teles.clear()
	bullets.clear()
	phase = rift_from
	px = rift_ret.x
	py = rift_ret.y
	invuln = 2.0
	rift_sealed[100 + rift_poi] = true
	var kind := rift_kind
	rift_kind = "sword"
	if ok:
		if kind == "vault":
			var amt := 240 + int(rng.randf() * 121.0)
			for i in range(6):
				_spawn_pickup("coin", px + (rng.randf() - 0.5) * 120.0, py + (rng.randf() - 0.5) * 80.0, amt / 6)
			var pool: Array = []
			for r in GameData.RELICS:
				if not relics.has(r.id) and not r.has("part") and r.tier != "white":
					pool.append(r.id)
			if pool.size() > 0:
				var rid: String = pool[int(rng.randf() * pool.size())]
				relics.append(rid)
				_recalc()
				_ev("relic", rid)
			_ev("banner", "镇魂宝库通关 • 铜钱 %d + 高阶遗物" % amt, "#ffcf5a")
		else:
			if not grant_gourd():
				coins += 80
			for i in range(3):
				_spawn_pickup("coin", px + (rng.randf() - 0.5) * 100.0, py + (rng.randf() - 0.5) * 80.0, 20)
			_ev("banner", "古药葫芦秘境通关 • 葫芦散件 + 铜钱", "#ffcf5a")
	else:
		_ev("banner", "秘境超时 • 未获奖励", "#ff8a7a")
	rift_log.append({"poi": rift_poi, "kind": kind, "ok": ok, "t": rift_t, "how": "clear" if ok else "timeout"})
	_ev("rift_exit", ok, "clear" if ok else "timeout")
	checkpoint()


func _step_rift(dt: float) -> void:
	if phase != PH_RIFT:
		return
	rift_t += dt
	if rift_kind != "sword":
		_arena_step(dt)
		return
	if rift_warden != null and not rift_warden.alive:
		_rift_end(true, "clear", hp)
	elif rift_t >= rift_limit:
		_rift_end(false, "timeout", hp)


func _rift_end(ok: bool, how: String, hp_ref: float) -> void:
	var dg: Dictionary = GameData.DG
	var entry_no := rift_entries
	var rec := {"break": break_idx, "poi": rift_poi, "entry": entry_no, "ok": ok, "how": how, "t": rift_t, "target": rift_target, "limit": rift_limit,
		"dps_est": rift_dps_est, "warden_hp": (rift_warden.maxhp if rift_warden != null else 0.0), "dealt": rift_dmg_dealt, "hp_in": rift_hp_before, "hp_out": 0.0, "artifact": "", "levels": levels.duplicate(), "evo": evo.duplicate(), "by": rift_by.duplicate(), "parts": rift_parts.duplicate()}
	for e2: SimEnemy in enemies:
		e2.alive = false
	enemies.clear()
	ebullets.clear()
	teles.clear()
	bullets.clear()
	trails.clear()
	lei_queue.clear()
	rift_warden = null
	phase = rift_from
	px = rift_ret.x
	py = rift_ret.y
	invuln = dg.rift.exitInvuln
	if sw_state == SW_ORBIT or sw_state == SW_RECALL:
		sw_state = SW_CD
		sw_t = 0.5
	if ok:
		rift_clears += 1
		if artifact == "":
			artifact = "sword"
			sw_state = SW_STOW
			sw_cd = 0.0
			rec.artifact = "sword"
			_ev("artifact", "sword")
			_sword_advance("副本守关者")
		else:
			# 法宝一局最多 1 件 〉 第二次通关改发：宝箱 + 一件免费遗物
			_sword_advance("副本守关者")
			pending_chest += 1
			rec.artifact = "chest"
			var pool: Array = []
			for r in GameData.RELICS:
				if not relics.has(r.id):
					pool.append(r.id)
			if pool.size() > 0:
				var rid: String = pool[int(rng.randf() * pool.size())]
				relics.append(rid)
				_recalc()
				rec.artifact = "chest+relic"
				_ev("relic", rid)
				_ev("banner", "遗宝 • %s" % GameData.RELIC_BY_ID[rid].name, "#ffc977")
	else:
		rift_fails += 1
		rift_sealed[100 + rift_poi if rift_poi >= 0 else break_idx] = true
		var base := hp_ref
		hp = maxf(1.0, base * (1.0 - float(dg.rift.failHpLoss)))
	threat_next += 1   # 出副本后下一段威胁预算 +1 档
	rec.hp_out = hp
	rift_log.append(rec)
	hold.clear()
	_ev("rift_exit", ok, how)
	checkpoint()


# ======================================================================
# 结算
# ======================================================================
func soul_payout() -> int:
	var S: Dictionary = GameData.BAL.soul
	var soul: float = t * S.perSecond + kills * S.perKill + coins * S.perCoin + bonus_soul
	if victory:
		soul = (soul + S.bossBonus) * S.winMul
	return int(round(soul * s_soul_mul))


func _finish() -> void:
	if ended:
		return
	ended = true
	over = true
	phase = PH_END
	var top := "fu"
	for k in dmg_by:
		if GameData.UPS.has(k) and float(dmg_by[k]) > float(dmg_by.get(top, 0.0)):
			top = k
	var top_name: String = GameData.EVOS[top].name if evo.has(top) else (GameData.UPS[top].name if GameData.UPS.has(top) else "驱邪符")
	if sw_drops >= 0 and float(dmg_by.get("sword", 0.0)) > float(dmg_by.get(top, 0.0)):
		top_name = "飞剑术"
	_ev("result")
	result = {"victory": victory, "time": t, "level": level, "kills": kills, "top": top_name, "soul": soul_payout(), "build": owned(), "seed": seed_v,
		"cause": death_cause, "rift": rift_log, "relics": relics.duplicate(), "artifact": artifact, "boss_time": boss_time}


var result: Dictionary = {}


## 供瞄准机器人：克隆当前战斗状态（妖物、玩家、飞剑），不含掉落与预警；用于逐发试射多角度
func fork() -> Sim:
	var f := Sim.new(seed_v + 7919 + int(real_t * 1000.0))
	for pr in get_property_list():
		if pr.usage & PROPERTY_USAGE_SCRIPT_VARIABLE:
			var n: String = pr.name
			if n in ["rng", "enemies", "bullets", "ebullets", "pickups", "teles", "bolts", "trails", "grid", "events", "lei_queue", "boss", "rift_warden", "orb_pos", "choice"]:
				continue
			var v: Variant = get(n)
			if v is Dictionary or v is Array:
				v = v.duplicate(true)
			f.set(n, v)
	var cp: Array = []
	for e: SimEnemy in enemies:
		var c := e.copy()
		cp.append(c)
		if e == boss:
			f.boss = c
		if e == rift_warden:
			f.rift_warden = c
	f.enemies = cp
	f.emit = false
	f.choice = {}
	return f


## 仅供 tests/duel.gd 构造“单挑”场景：以固定构筑直接开打终局 BOSS（满血、无段间灯芯/遗物），其余规则不变
func duel_boss(build: Dictionary, with_sword: bool) -> void:
	levels = build.levels.duplicate()
	evo = build.get("evo", {}).duplicate()
	_recalc()
	hp = maxhp
	seg = 2
	phase = PH_BOSS
	t = 480.0
	event_idx = GameData.WV.events.size()
	if with_sword:
		artifact = "sword"
		sw_state = SW_STOW
	for ev in GameData.WV.events:
		if ev.kind == "boss":
			_fire_event(ev)


## 仅供 tests/duel.gd：以固定构筑从段间直接进入第 entry 次裂隙（满血）
func duel_warden(build: Dictionary, entry: int, with_sword: bool) -> void:
	levels = build.levels.duplicate()
	evo = build.get("evo", {}).duplicate()
	_recalc()
	hp = maxhp
	seg = 0 if entry == 1 else 1
	t = seg_to(seg)
	_start_break(seg)
	rift_entries = entry - 1
	if with_sword:
		artifact = "sword"
		sw_state = SW_STOW
	enter_rift()


const SAVE_KEYS := ["seed_v", "phase", "t", "real_t", "seg", "kills", "coins", "level", "xp", "need", "pending_lv", "hp", "px", "py", "levels", "evo", "relics",
	"wicks", "artifact", "rift_entries", "rift_clears", "rift_sealed", "threat_next", "threat_cur", "rerolls", "revive", "bonus_soul", "break_idx", "gift_pending", "shop",
	"break_t", "rift_log", "rift_fails", "rift_deaths", "wick_spent_rift", "wick_spent_shop", "announced", "sw_stage", "sw_kills", "sw_br", "sw_log", "fusion", "fusion_t", "pending_fusion", "pending_sw", "mode", "stretch", "clock", "gourds", "pet_on", "pet_hp", "pet_marks", "pet_dead_t", "mini_idx", "vine_taken", "set_kills"]


## 检查点存档：只在「段/段间」两种阶段落档；恢复时妖物/弹幕清空，从该点继续（局内中断续档）
func checkpoint() -> void:
	if phase != PH_SEG and phase != PH_BREAK:
		return
	if over or ended:
		return
	cp_serial += 1


func to_save() -> Dictionary:
	var d := {}
	for k in SAVE_KEYS:
		var v: Variant = get(k)
		d[k] = v.duplicate(true) if (v is Dictionary or v is Array) else v
	d["ver"] = 2
	return d


func from_save(d: Dictionary) -> void:
	for k in SAVE_KEYS:
		if not d.has(k):
			continue
		var cur: Variant = get(k)
		var v: Variant = d[k]
		if cur is int:
			v = int(v)
		elif cur is float:
			v = float(v)
		elif cur is Dictionary and k in ["rift_sealed", "announced", "vine_taken"]:
			var nd := {}
			for kk in v:
				nd[int(kk)] = true
			v = nd
		elif cur is Dictionary:
			var nd2 := {}
			for kk in v:
				nd2[kk] = (int(v[kk]) if k == "levels" else v[kk])
			v = nd2
		set(k, v)
	if not d.has("clock") and float(d.get("t", 0.0)) > 0.0:
		clock = float(d.t) * stretch   # 旧存档无 clock：由节奏钟回推
	rng.seed = seed_v + int(real_t * 10.0)
	_recalc()
	hp = minf(float(d.get("hp", maxhp)), maxhp)
	enemies.clear(); ebullets.clear(); bullets.clear(); pickups.clear(); teles.clear(); trails.clear(); lei_queue.clear()
	boss = null
	var events: Array = GameData.WV.events
	event_idx = 0
	while event_idx < events.size() and float(events[event_idx].at) <= t and events[event_idx].kind != "boss":
		event_idx += 1
	spawn_t = 1.0
	invuln = 2.0
	vel = Vector2.ZERO
	if artifact == "sword":
		sw_state = SW_STOW
		sw_cd = 0.0
	hold.clear()
	shop_open = false
	choice = {}


func _aoe(x: float, y: float, r: float, dmg: float, key: String) -> void:
	for e: SimEnemy in _near(x, y, r + 40.0):
		if Vector2(e.x - x, e.y - e.h * 0.4 - y).length() < r + e.r:
			damage(e, dmg, key, {"noCrit": true, "kx": e.x - x, "ky": e.y - y, "kb": 90.0})


func grant_gourd() -> bool:
	var left: Array = []
	for gp in GameData.GD.pieces:
		if not gourds.has(gp.id):
			left.append(gp.id)
	if left.is_empty():
		return false
	var gid: String = left[int(rng.randf() * left.size())]
	gourds.append(gid)
	_ev("gourd", gid)
	_ev("banner", "彩虹葫芦 • %s（%d/7）" % [GameData.GP_BY_ID[gid].name, gourds.size()], "#ffcf5a")
	if gourds.size() >= 7 and not pet_on:
		pet_on = true
		pet_hp = float(GameData.GD.pet.hp) * (1.0 + 0.1 * pet_marks)
		_ev("pet_born")
		_ev("banner", "七色合一 • 葫芦小金刚现身", "#ffcf5a")
	_recalc()
	return true


func pet_maxhp() -> float:
	return float(GameData.GD.pet.hp) * (1.0 + 0.1 * pet_marks)


func abandon() -> void:
	## 放弃本局：按当前进度结算（暂停菜单「结算本局」/ X 键）
	if over or ended:
		return
	death_cause = "abandon"
	hp = 0.0
	over = true
	victory = false
	end_timer = 0.0
	_finish()


func _pet_hurt(dmg: float) -> float:
	## 小金刚替玩家挡一部分伤害；返回玩家实际承受的伤害
	if not pet_on or pet_dead_t > 0.0:
		return dmg
	var ab := dmg * float(GameData.GD.pet.absorb)
	pet_hp -= ab
	if pet_hp <= 0.0:
		pet_hp = 0.0
		pet_dead_t = float(GameData.GD.pet.revive)
		pet_marks = maxi(0, pet_marks - 1)    # 死亡惩罚：掉 1 层强化印记 + 45s 复活冷却
		_ev("pet_dead")
		_recalc()
	return dmg - ab


func _update_pet(dt: float) -> void:
	set_ward_cd = maxf(0.0, set_ward_cd - dt)
	combo_cd = maxf(0.0, combo_cd - dt)
	combo_fx = maxf(0.0, combo_fx - dt)
	for i in range(pet_fx.size() - 1, -1, -1):
		pet_fx[i][3] -= dt
		if pet_fx[i][3] <= 0.0:
			pet_fx.remove_at(i)
	if not pet_on:
		return
	var G: Dictionary = GameData.GD.pet
	pet_ang += 2.2 * dt
	pet_pos = Vector2(px + cos(pet_ang) * float(G.orbitR), py - 40.0 + sin(pet_ang) * float(G.orbitR) * 0.6)
	if pet_dead_t > 0.0:
		pet_dead_t -= dt
		if pet_dead_t <= 0.0:
			pet_dead_t = 0.0
			pet_hp = pet_maxhp()
			_ev("pet_revive")
		return
	if in_combo and combo_cd <= 0.0 and phase != PH_BREAK:
		combo_cd = float(G.comboCd)
		combo_fx = 0.7
		var cdmg := float(G.comboDmg) * (1.0 + s_dmg_add) * (1.0 + 0.1 * pet_marks)
		_aoe(px, py - 30.0, float(G.comboR), cdmg, "pet")
		var kept: Array = []
		for b in ebullets:
			if Vector2(b.x - px, b.y - py).length() > float(G.comboR):
				kept.append(b)
		ebullets = kept
		_ev("pet_combo")
	pet_atk_t -= dt
	if pet_atk_t <= 0.0:
		var tgt := nearest_enemy(pet_pos.x, pet_pos.y, float(G.range))
		if tgt == null:
			pet_atk_t = 0.3
			return
		pet_atk_t = float(G.atkGap)
		var d := float(G.dmg) * (1.0 + s_dmg_add) * (1.0 + 0.1 * pet_marks)
		match pet_idx % 3:
			0:   # 喷火：朝目标锥形
				pet_fx.append([0, tgt.x, tgt.y, 0.4])
				_aoe(tgt.x, tgt.y, 90.0, d, "pet")
			1:   # 落雷
				pet_fx.append([1, tgt.x, tgt.y, 0.3])
				damage(tgt, d * 1.6, "pet", {"noCrit": true})
			2:   # 冲击波
				pet_fx.append([2, pet_pos.x, pet_pos.y, 0.4])
				_aoe(pet_pos.x, pet_pos.y, 150.0, d * 0.8, "pet")
		pet_idx += 1


func _mini_drop(e: SimEnemy) -> void:
	var G: Dictionary = GameData.GD
	var k := clampi(int(e.el.mini), 0, 4)
	for i in range(4):
		_spawn_pickup("coin", e.x + (rng.randf() - 0.5) * 120.0, e.y + (rng.randf() - 0.5) * 80.0, int(int(G.miniCoins[k]) / 4))
	_spawn_pickup("chest", e.x, e.y, 1)
	wicks += 1
	grant_gourd()
	if pet_on and pet_marks < int(G.pet.marks):
		pet_marks += 1
		_recalc()
	_ev("banner", "击败 %s • 铜钱 + 灯芯 + 葫芦散件" % e.el.name, "#ffcf5a")


func _spawn_mini_special(k: int) -> void:
	var key: String = ["swordlord", "sedan", "lamps"][k - 2]
	var C: Dictionary = GameData.MB[key]
	var def := {"name": GameData.GD.miniNames[k], "tex": C.tex, "h": C.h, "r": C.r, "hp": 1, "speed": C.speed, "dmg": C.dmg, "xp": 0, "ai": key, "faceRight": true, "knock": 0.0, "fx": "spark"}
	var el := {"name": GameData.GD.miniNames[k], "scale": 1.0, "hp": C.hp, "dmg": C.dmg, "speed": C.speed, "xp": 20, "armor": 0.1, "glow": 0, "mini": k}
	var e := spawn_enemy(key, -1.0, -1.0, {"el": el, "def": def})
	e.atk_t = 1.5
	e.blade_down = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
	e.blades_t = 1e9 if key == "lamps" else 0.0
	_ev("banner", "小 BOSS • %s 现身" % GameData.GD.miniNames[k], "#ff7a6a")


func lamp_pos(e: SimEnemy, i: int) -> Vector2:
	var C: Dictionary = GameData.MB.lamps
	var a := e.blade_ang + float(i) / float(C.lamps) * TAU
	return Vector2(e.x + cos(a) * float(C.lampR), e.y - e.h * 0.45 + sin(a) * float(C.lampR) * 0.7)


func _mini_ai(e: SimEnemy, dt: float, ux: float, uy: float, dist: float) -> Vector2:
	var C: Dictionary = GameData.MB[e.ai]
	var dirp := Vector2(ux, uy)
	e.blade_hit_cd = maxf(0.0, e.blade_hit_cd - dt)
	if e.ai == "lamps":
		e.blade_ang += float(C.lampW) * dt
		for i in range(int(C.lamps)):
			var lp := lamp_pos(e, i)
			if e.blade_hit_cd <= 0.0 and not over and lp.distance_to(Vector2(px, py - 34.0)) < float(C.lampHitR):
				hurt_player(float(C.lampDmg), lp.x, lp.y, "lamps:lamp")
				e.blade_hit_cd = float(C.lampHitCd)
	if e.state == "lunge":
		e.timer -= dt
		if not e.lunge_hit and not over and Vector2(px, py - 20.0).distance_to(Vector2(e.x, e.y - 20.0)) < e.r + 30.0:
			e.lunge_hit = true
			hurt_player(float(C.chargeDmg), e.x, e.y, "sedan:charge")
		if e.timer <= 0.0:
			e.state = "move"
			e.stagger_t = 1.2
			_spawn_paper(e)
		return e.lunge_dir * float(C.chargeSpeed)
	if e.warn_t > 0.0:
		e.warn_t -= dt
		if e.warn_t <= 0.0 and e.ai == "sedan" and e.state == "aim":
			e.state = "lunge"
			e.timer = float(C.chargeLen) / float(C.chargeSpeed)
			e.lunge_hit = false
		return Vector2.ZERO
	e.stagger_t = maxf(0.0, e.stagger_t - dt)
	var v := dirp * e.speed
	if dist < 200.0:
		v = -dirp * e.speed * 0.4
	e.atk_t -= dt
	if e.atk_t <= 0.0:
		e.atk_t = float(C.gap)
		var phase_i := e.atk_idx % 3
		e.atk_idx += 1
		match e.ai:
			"swordlord":
				if phase_i != 1:
					# 环形飞剑阵：预警圈 → 一圈飞剑
					var cb := func() -> void:
						if not e.alive:
							return
						var n := int(C.ringCount)
						for i in range(n):
							var a := float(i) / n * TAU + real_t
							_spawn_ebullet(e.x, e.y - e.h * 0.5, cos(a) * float(C.ringSpeed), sin(a) * float(C.ringSpeed), float(C.ringDmg), "swordlord:ring")
					_add_tele(e.x, e.y, 200.0, float(C.warn), cb, e)
				else:
					# 蓄力扇形剑雨：锁定方向，两轮齐射
					var base := atan2(py - e.y, px - e.x)
					for wave in range(2):
						var cb2 := func() -> void:
							if not e.alive:
								return
							var nn := int(C.fan)
							for i in range(nn):
								var a2 := base + (i - (nn - 1) / 2.0) * float(C.fanSpread) / nn
								_spawn_ebullet(e.x, e.y - e.h * 0.5, cos(a2) * float(C.fanSpeed), sin(a2) * float(C.fanSpeed), float(C.fanDmg), "swordlord:rain")
						_add_tele(e.x, e.y, 0.0, float(C.warn) + wave * 0.35, cb2, e)
				_ev("sfx", "warn")
			"sedan":
				if phase_i == 0:
					e.lunge_dir = Vector2(px - e.x, py - 20.0 - (e.y - 20.0)).normalized()
					e.state = "aim"
					e.warn_t = float(C.chargeWarn)
					_ev("sfx", "warn")
				elif phase_i == 1:
					_spawn_paper(e)
				else:
					for i in range(int(C.guards)):
						var a3 := float(i) / int(C.guards) * TAU
						var g := spawn_enemy("paperman", 0.0, 0.0, {"pos": Vector2(e.x + cos(a3) * 120.0, e.y + sin(a3) * 80.0)})
						g.speed *= 1.3
					_ev("sfx", "roar")
			"lamps":
				if phase_i != 2:
					var a0 := atan2(py - e.y, px - e.x) - 0.9
					for i in range(int(C.beamBullets)):
						var ai := a0 + i * 0.12
						var cb3 := func() -> void:
							if not e.alive:
								return
							_spawn_ebullet(e.x, e.y - e.h * 0.5, cos(ai) * float(C.beamSpeed), sin(ai) * float(C.beamSpeed), float(C.beamDmg), "lamps:beam")
						_add_tele(e.x, e.y, 0.0, float(C.beamStart) + i * float(C.beamStep), cb3, e)
					_ev("sfx", "warn")
				else:
					for i in range(2):
						var a4 := rng.randf() * TAU
						spawn_enemy("foxfire", 0.0, 0.0, {"pos": Vector2(e.x + cos(a4) * 140.0, e.y + sin(a4) * 90.0)})
	return v


func _spawn_paper(e: SimEnemy) -> void:
	var C: Dictionary = GameData.MB.sedan
	var n := int(C.paperCount)
	for i in range(n):
		var a := float(i) / n * TAU
		_spawn_ebullet(e.x, e.y - e.h * 0.5, cos(a) * float(C.paperSpeed), sin(a) * float(C.paperSpeed), float(C.paperDmg), "sedan:paper")


func _update_minis() -> void:
	if phase != PH_SEG and phase != PH_BOSS:
		return
	var sched: Array = GameData.GD.minis.full if mode == "full" else (GameData.GD.minis.quick if mode == "quick" else [])
	if mini_idx >= sched.size() or clock < float(sched[mini_idx]):
		return
	var k := mini_idx
	mini_idx += 1
	if mode == "full" and k >= 2:
		_spawn_mini_special(k)
		return
	var base: Dictionary = GameData.EN.elites["jiangshi" if k % 2 == 0 else "lantern"].duplicate()
	base.name = String(GameData.GD.miniNames[mini(k, 4)])
	base.hp = float(base.hp) * (1.0 + 0.5 * k)
	base["mini"] = k
	base.xp = 20
	spawn_enemy("jiangshi" if k % 2 == 0 else "lantern", -1.0, -1.0, {"elite": true, "el": base})
	_ev("banner", "小 BOSS • %s 现身" % base.name, "#ff7a6a")


func sw_rm() -> float:
	return 1.0 + float(GameData.DG.sword.stages.branch.radius) * float(sw_br.get("radius", 0))


func sw_cdm() -> float:
	return maxf(0.4, 1.0 - float(GameData.DG.sword.stages.branch.cd) * float(sw_br.get("cd", 0)))


func sword_unlocked() -> Array:
	var names: Array = GameData.DG.sword.stages.names
	return names.slice(0, sw_stage)


func swb_options() -> Array:
	var B: Dictionary = GameData.DG.sword.stages.branch
	var mx := int(B.maxLv)
	var opts: Array = []
	for o in [["count", "剑数 +1", "剑气与剑轮各多一把剑"], ["radius", "回旋扩阔", "回旋/剑轮半径 +%d%%" % int(float(B.radius) * 100.0)], ["cd", "剑意疾速", "飞剑各冷却 -%d%%" % int(float(B.cd) * 100.0)]]:
		if int(sw_br.get(o[0], 0)) < mx:
			opts.append({"kind": "swb", "id": o[0], "icon": "sword", "name": o[1], "school": "gen", "rarity": "blue", "lvText": "飞剑分叉增益 Lv %d" % (int(sw_br.get(o[0], 0)) + 1), "desc": o[2]})
	if opts.is_empty():
		opts.append({"kind": "swb", "id": "count", "icon": "sword", "name": "剑数 +1", "school": "gen", "rarity": "blue", "lvText": "飞剑分叉增益", "desc": "剑气与剑轮各多一把剑"})
	return opts


func fusion_options() -> Array:
	var opts: Array = []
	for w in ["fu", "huanhuo", "lei"]:
		if lv(w) >= 1 or opts.is_empty() and w == "lei":
			var F: Dictionary = GameData.DG.fusion
			opts.append({"kind": "fus", "id": w, "icon": GameData.UPS[w].icon, "name": F.names[w], "school": GameData.UPS[w].school, "rarity": "gold", "lvText": "飞剑 × %s 融合" % GameData.UPS[w].name, "desc": F.desc[w]})
	if opts.is_empty():
		var F2: Dictionary = GameData.DG.fusion
		opts.append({"kind": "fus", "id": "fu", "icon": "fu", "name": F2.names.fu, "school": "fu", "rarity": "gold", "lvText": "飞剑 × 驱邪符 融合", "desc": F2.desc.fu})
	return opts


## 融合触发：局内 5:30（atRealSec）起，在战斗段/段间第一时间出现；缺飞剑则剑冢遗赠第 N 阶保底。每局只触发一次。
func _trigger_fusion() -> void:
	if fusion != "" or pending_fusion > 0 or fusion_t >= 0.0:
		return
	if artifact == "":
		artifact = "sword"
		sw_state = SW_STOW
		sw_cd = 0.0
		sw_stage = int(GameData.DG.fusion.guaranteeSwordStage)
		sw_log.append({"t": snappedf(real_t, 0.1), "stage": sw_stage, "src": "融合保底(剑冢遗赠)"})
		_ev("artifact", "sword")
		_ev("banner", "剑冢遗赠 • 飞剑术（第 %d 阶）" % sw_stage, "#7fe3ff")
	pending_fusion = 1


func _sword_advance(src: String) -> void:
	if not has_sword() or sw_stage >= 5:
		return
	sw_stage += 1
	sw_log.append({"t": snappedf(real_t, 0.1), "stage": sw_stage, "src": src})
	pending_sw += 1
	_ev("sword_stage", sw_stage, src)


func _update_sword_stages(dt: float) -> void:
	var sw: Dictionary = GameData.DG.sword
	var ST: Dictionary = sw.stages
	sw_array_fx = maxf(0.0, sw_array_fx - dt)
	# 阶段2：双剑交替——召回刺出后另一把剑反向再刺一次
	if sw_thrust2_t > 0.0:
		sw_thrust2_t -= dt
		if sw_thrust2_t <= 0.0:
			sw_thrust2_t = -1.0
			_sword_thrust(sw_thrust2_dir, "sw_thrust2")
	sw_wheel_pos.clear()
	if sw_state == SW_DROP or phase == PH_BREAK:
		return
	# 阶段3：环身剑轮（贴身持续切割）
	if sw_stage >= 3:
		var W: Dictionary = ST.wheel
		var n := int(W.blades) + int(sw_br.get("count", 0)) + (3 if has_part("part_sword") else 0)
		var rad: float = float(W.radius) * sw_rm()
		sw_wheel_ang += float(W.spin) * dt
		for i in range(n):
			var a := sw_wheel_ang + float(i) / n * TAU
			var wp := Vector2(px + cos(a) * rad, py - 30.0 + sin(a) * rad * 0.8)
			sw_wheel_pos.append(wp)
			for e: SimEnemy in _near(wp.x, wp.y + 20.0, 70.0):
				var hk := e.uid * 16 + i
				if real_t - float(sw_wheel_hit.get(hk, -10.0)) < float(W.hitCd):
					continue
				if Vector2(e.x - wp.x, e.y - e.h * 0.4 - wp.y).length() > e.r + float(W.hitR):
					continue
				sw_wheel_hit[hk] = real_t
				_sword_strike(e, float(sw.dmg) * float(W.mul), false, "sw_wheel")
				if fusion == "huanhuo" and e.alive:
					_fusion_ignite(e)
		if sw_wheel_hit.size() > 600:
			sw_wheel_hit.clear()
	# 阶段4：追踪剑气（自动锁定最近目标、穿透）
	if sw_stage >= 4:
		var Q: Dictionary = ST.qi
		sw_qi_t -= dt
		if sw_qi_t <= 0.0 and enemies.size() > 0:
			var picked: Dictionary = {}
			var fired := 0
			for k in range(int(Q.count) + int(sw_br.get("count", 0)) + (2 if has_part("part_sword") else 0)):
				var best: SimEnemy = null
				var bd := float(Q.range) * float(Q.range)
				for e: SimEnemy in enemies:
					if not e.alive or picked.has(e.uid):
						continue
					var d2 := (e.x - px) * (e.x - px) + (e.y - py) * (e.y - py)
					if d2 < bd:
						bd = d2
						best = e
				if best == null:
					break
				picked[best.uid] = true
				_spawn_qi(float(Q.speed), atan2(best.y - best.h * 0.4 - (py - 30.0), best.x - px) + (rng.randf() - 0.5) * 0.5, float(sw.dmg) * float(Q.mul), float(Q.life), int(Q.pierce), false, "sw_qi", best)
				fired += 1
			if fired > 0:
				sw_qi_t = float(Q.cd) * sw_cdm()
				_ev("sword_qi")
			else:
				sw_qi_t = 0.3
	# 阶段5：剑阵爆发（多剑齐射、必定暴击）
	if sw_stage >= 5:
		var A: Dictionary = ST.array
		sw_array_t -= dt
		if sw_array_t <= 0.0:
			if nearest_enemy(px, py, float(A.range)) != null:
				sw_array_t = float(A.cd) * sw_cdm()
				sw_array_fx = 0.6
				var n2 := int(A.count) + int(sw_br.get("count", 0)) * 2
				for i in range(n2):
					_spawn_qi(float(A.speed), float(i) / n2 * TAU, float(sw.dmg) * float(A.mul), float(A.life), 4, true, "sw_array", null)
				_ev("sword_array")
			else:
				sw_array_t = 0.5
	_update_qi(dt)


func _spawn_qi(speed: float, ang: float, dmg: float, life: float, pierce: int, crit: bool, key: String, tgt: SimEnemy) -> void:
	if sw_qi.size() >= int(GameData.DG.sword.stages.qi.cap) + 20:
		return
	var b := SimBullet.new()
	b.x = px
	b.y = py - 30.0
	b.vx = cos(ang) * speed
	b.vy = sin(ang) * speed
	b.dmg = dmg
	b.life = life
	b.pierce = pierce
	b.mark = crit
	b.ang = ang
	b.hits = {"key": key}
	if tgt != null:
		b.hits["e"] = tgt
	sw_qi.append(b)


func _update_qi(dt: float) -> void:
	var Q: Dictionary = GameData.DG.sword.stages.qi
	for i in range(sw_qi.size() - 1, -1, -1):
		var b: SimBullet = sw_qi[i]
		var key: String = b.hits.key
		if key == "sw_qi":
			var tgt: Variant = b.hits.get("e")
			if tgt == null or not (tgt as SimEnemy).alive:
				tgt = nearest_enemy(b.x, b.y, float(Q.range))
				b.hits["e"] = tgt
			if tgt != null:
				var te: SimEnemy = tgt
				var want := Vector2(te.x - b.x, te.y - te.h * 0.4 - b.y).normalized()
				var cur := Vector2(b.vx, b.vy)
				var nd := cur.normalized().lerp(want, clampf(float(Q.turn) * dt, 0.0, 1.0)).normalized() * cur.length()
				b.vx = nd.x
				b.vy = nd.y
				b.ang = nd.angle()
		b.x += b.vx * dt
		b.y += b.vy * dt
		b.life -= dt
		var dead := b.life <= 0.0
		if not dead:
			for e: SimEnemy in _near(b.x, b.y, 70.0):
				if b.hits.has(e.uid):
					continue
				if Vector2(e.x - b.x, e.y - e.h * 0.4 - b.y).length() > e.r + float(Q.hitR):
					continue
				b.hits[e.uid] = true
				_sword_strike(e, b.dmg, false, key, b.mark)
				if fusion == "fu" and e.alive and e.mark_t <= 0.0:
					e.mark_t = GameData.EVOS.fu.stats.markDelay
					e.mark_dmg = b.dmg
				elif fusion == "huanhuo" and e.alive:
					_fusion_ignite(e)
				b.pierce -= 1
				if b.pierce < 0:
					dead = true
					break
		if dead:
			sw_qi.remove_at(i)


func _fusion_ignite(e: SimEnemy) -> void:
	if e.burn_t <= 0.0:
		e.burn_tick = GameData.BAL.burn.tick
	e.burn_t = GameData.BAL.burn.time
	e.burn_dps = maxf(s_burn_dps, 10.0)


func snapshot() -> Dictionary:
	return {
		"phase": phase, "hp": int(round(hp)), "maxHp": int(maxhp), "level": level, "kills": kills, "t": snappedf(t, 0.1), "enemies": enemies.size(),
		"wicks": wicks, "seg": seg, "rift": rift_entries, "artifact": artifact, "x": int(px), "y": int(py),
	}
