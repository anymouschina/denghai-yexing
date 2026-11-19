class_name WorldView
extends Node2D
## 渲染层：只读 Sim 状态，用 _draw 画世界（背景/实体按 y 排序/弹幕/特效），并把 Sim 事件翻译成飘字、粒子、震屏与音效。

const LayerScript := preload("res://src/layer.gd")

var sim: Sim
var cam: Camera2D
var bg_layer: Node2D
var ground_add: Node2D
var fx_add: Node2D
var white_layer: Node2D
var T: Dictionary = {}
var t_anim := 0.0
var floaters: Array = []
var parts: Array = []
var rings: Array = []
var fx_sprites: Array = []
var ghosts: Array = []
var shake_amp := 0.0
var shake_t := 0.0
var hit_stop := 0.0
var slowmo := 1.0
var zoom_t := 0.0
var cam_pos := Vector2.ZERO
var flash_list: Array = []
var ghost_t := 0.0
var last_phase := -1
var last_seg := -1
var fade := 0.0
var fade_color := Color(0.02, 0.02, 0.07)
var low_perf := false
var items: Array = []
var font: Font
var banner_cb: Callable
var drop_ring := 0.0

const SHEETS := {
	"boss_idle": {"tex": "res://assets/anim/boss_idle.png", "w": 236, "h": 384, "n": 8},
	"jiangshi_hop": {"tex": "res://assets/anim/jiangshi_hop.png", "w": 119, "h": 200, "n": 8},
}


func setup(p_sim: Sim) -> void:
	sim = p_sim
	font = UI.font()
	for n in ["hero_run", "enemy_atlas", "boss", "proj_talisman", "proj_flame",
			"proj_ghostfire", "proj_sword", "boss_swordwarden", "fx_thunder", "fx_boom", "drop_soul", "drop_coin", "drop_oil", "drop_chest", "field_lantern", "rift_portal", "merchant"]:
		T[n] = load("res://assets/%s.png" % n)
	for k in SHEETS:
		T[k] = load(SHEETS[k].tex)
	T.glow = Fx.glow()
	var ar: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/enemy_atlas.json"))
	for k in ar:
		var r: Array = ar[k]
		_enemy_cache[k] = [T.enemy_atlas, Rect2(r[0], r[1], r[2], r[3]), float(r[2]), float(r[3]), 1.0]
	cam = Camera2D.new()
	cam.position_smoothing_enabled = false
	add_child(cam)
	cam.make_current()
	bg_layer = _mk_layer(-3, false, _draw_bg)
	ground_add = _mk_layer(-2, true, _draw_ground_add)
	fx_add = _mk_layer(1, true, _draw_fx_add)
	white_layer = _mk_layer(2, false, _draw_white)
	var sh := Shader.new()
	sh.code = FileAccess.get_file_as_string("res://src/flash.gdshader")
	var mat := ShaderMaterial.new()
	mat.shader = sh
	white_layer.material = mat
	cam_pos = Vector2(sim.px, sim.py)


func _mk_layer(z: int, additive: bool, cb: Callable) -> Node2D:
	var n := Node2D.new()
	n.set_script(LayerScript)
	n.cb = cb
	n.z_index = z
	if additive:
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		n.material = m
	add_child(n)
	return n


# ======================================================================
# 帧更新
# ======================================================================
func tick(delta: float) -> void:
	t_anim += delta
	_consume_events()
	var vis := get_viewport_rect().size
	var target := Vector2(sim.px, sim.py - 30.0)
	var arena := sim.phase == Sim.PH_RIFT
	cam_pos = cam_pos.lerp(target, 1.0 - exp(-delta * float(GameData.MV.camFollow)))
	var half := vis / 2.0
	var lo := Vector2(half.x, half.y)
	var hi := Vector2(Sim.W - half.x, Sim.H - half.y)
	if arena:
		cam_pos = cam_pos.lerp(Vector2(Sim.W / 2.0, Sim.H / 2.0), clampf(delta * 3.0, 0, 1))
	var c := Vector2(clampf(cam_pos.x, lo.x, maxf(lo.x, hi.x)), clampf(cam_pos.y, lo.y, maxf(lo.y, hi.y)))
	var off := Vector2.ZERO
	if shake_t > 0.0:
		shake_t -= delta
		off = Vector2(randf() - 0.5, randf() - 0.5) * 2.0 * shake_amp * 1280.0
	cam.position = c
	cam.offset = off
	var zt := 1.0
	if sim.over and not sim.victory:
		zoom_t = minf(zoom_t + delta, 1.1)
		zt = 1.0 + 0.25 * (zoom_t / 1.1)
	else:
		zoom_t = 0.0
	cam.zoom = Vector2(zt, zt)
	# 粒子 / 飘字 / 圆环
	for i in range(parts.size() - 1, -1, -1):
		var p: Dictionary = parts[i]
		p.life -= delta
		if p.life <= 0.0:
			parts.remove_at(i)
			continue
		p.vy += p.grav * delta
		p.x += p.vx * delta
		p.y += p.vy * delta
	for i in range(floaters.size() - 1, -1, -1):
		var f: Dictionary = floaters[i]
		f.life -= delta
		f.y -= 46.0 * delta
		if f.life <= 0.0:
			floaters.remove_at(i)
	for i in range(rings.size() - 1, -1, -1):
		rings[i].life -= delta
		if rings[i].life <= 0.0:
			rings.remove_at(i)
	for i in range(fx_sprites.size() - 1, -1, -1):
		fx_sprites[i].life -= delta
		if fx_sprites[i].life <= 0.0:
			fx_sprites.remove_at(i)
	for i in range(ghosts.size() - 1, -1, -1):
		ghosts[i].life -= delta
		if ghosts[i].life <= 0.0:
			ghosts.remove_at(i)
	for i in range(sim.bolts.size() - 1, -1, -1):
		sim.bolts[i].life -= delta
		if sim.bolts[i].life <= 0.0:
			sim.bolts.remove_at(i)
	if sim.dash_t > 0.0:
		ghost_t -= delta
		if ghost_t <= 0.0:
			ghost_t = 0.03
			ghosts.append({"x": sim.px, "y": sim.py, "fr": _player_frame(), "flip": sim.face_x < 0, "life": 0.32})
	if fade > 0.0:
		fade = maxf(0.0, fade - delta * 1.6)
	if sim.phase != last_phase or sim.seg != last_seg:
		if last_phase != -1:
			fade = 1.0
			if sim.phase == Sim.PH_RIFT or last_phase == Sim.PH_RIFT:
				cam_pos = Vector2(sim.px, sim.py - 30.0)
		last_phase = sim.phase
		last_seg = sim.seg
	queue_redraw()
	bg_layer.queue_redraw()
	ground_add.queue_redraw()
	fx_add.queue_redraw()
	white_layer.queue_redraw()


func _shake(ms: float, amp: float) -> void:
	if shake_t > 0.0 and shake_amp > amp:
		return
	shake_t = ms / 1000.0
	shake_amp = amp


func burst(x: float, y: float, n: int, col: Color, speed: float = 220.0, size: float = 0.4, life: float = 0.5, grav: float = 0.0) -> void:
	if low_perf:
		n = int(n * 0.5)
	for i in range(n):
		if parts.size() > 320:
			return
		var a := randf() * TAU
		var s := speed * (0.35 + randf() * 0.65)
		parts.append({"x": x, "y": y, "vx": cos(a) * s, "vy": sin(a) * s, "life": life * (0.6 + randf() * 0.6), "max": life, "size": size * (0.7 + randf() * 0.6), "col": col, "grav": grav})


func ring(x: float, y: float, r: float, col: Color) -> void:
	rings.append({"x": x, "y": y, "r": r, "life": 0.38, "max": 0.38, "col": col})


func _float(x: float, y: float, text: String, col: Color, size: int = 22) -> void:
	if floaters.size() > 44:
		floaters.pop_front()
	floaters.append({"x": x, "y": y, "text": text, "col": col, "size": size, "life": 0.85})


func _consume_events() -> void:
	for ev in sim.events:
		match ev[0]:
			"dmg":
				var e: SimEnemy = ev[1]
				var d: float = ev[2]
				var crit: bool = ev[3]
				_float(e.x + (randf() - 0.5) * 20.0, e.y - e.h * 0.75, ("%d!" % int(d)) if crit else str(int(d)), Color("ffc977") if crit else (Color("c9a6ff") if ev[4] else Color.WHITE), 32 if crit else 22)
				if crit:
					Audio.play("crit")
					hit_stop = maxf(hit_stop, 0.04)
				else:
					Audio.play("hit", 0.7)
				burst(e.x, e.y - e.h * 0.5, 2, Color("ffe9a8"), 160.0, 0.25, 0.3)
			"kill":
				var e2: SimEnemy = ev[1]
				var big := e2.boss or e2.elite
				var fxn: String = e2.def.get("fx", "spark")
				var col := Color("f3e6c8") if fxn == "paper" else (Color("7fe3ff") if fxn == "wisp" else Color("ffa040"))
				burst(e2.x, e2.y - e2.h * 0.45, 40 if big else 9, col, 300.0 if big else 220.0, 0.5, 0.7, 260.0 if fxn == "paper" else 0.0)
				Audio.play("kill", 0.8)
				if big:
					hit_stop = maxf(hit_stop, 0.08)
					_shake(400, 0.006)
					burst(e2.x, e2.y - 60.0, 50, Color("ffd36a"), 420.0, 0.6, 0.9)
					fx_sprites.append({"tex": "fx_boom", "x": e2.x, "y": e2.y - 40.0, "life": 0.5, "max": 0.5, "scale": 1.6})
					Audio.play("boom")
			"hurt":
				_shake(160, 0.003)
				Audio.play("hurt")
				_float(sim.px, sim.py - 80.0, "-%d" % int(ev[1]), Color("ff6a5a"), 26)
			"dash":
				Audio.play("dash")
				_shake(90, 0.002)
				ring(sim.px, sim.py - 6.0, 46.0, Color("7fe3ff"))
			"shock":
				ring(ev[1], ev[2], ev[3], Color("ff7a6a"))
				fx_sprites.append({"tex": "fx_boom", "x": ev[1], "y": ev[2] - 10.0, "life": 0.45, "max": 0.45, "scale": ev[3] / 140.0})
				Audio.play("boom", 0.8)
				_shake(200, 0.005)
			"boom":
				fx_sprites.append({"tex": "fx_boom", "x": ev[1], "y": ev[2], "life": 0.45, "max": 0.45, "scale": 0.85})
				Audio.play("boom")
				_shake(180, 0.005)
			"ring":
				ring(ev[1], ev[2], ev[3], Color("ffd36a"))
				Audio.play("shoot", 0.8)
			"thunder":
				fx_sprites.append({"tex": "fx_thunder", "x": ev[1], "y": ev[2] + 6.0, "life": 0.26, "max": 0.26, "scale": 0.95, "thunder": true})
				burst(ev[1], ev[2], 6, Color("7fe3ff"), 200.0, 0.35, 0.4)
				Audio.play("thunder", 0.7)
				_shake(70, 0.0015)
			"sfx":
				Audio.play(ev[1])
			"banner":
				if banner_cb.is_valid():
					banner_cb.call(ev[1], ev[2])
			"pickup":
				Audio.play("pickup", 0.6)
			"heal":
				Audio.play("heal")
				_float(sim.px, sim.py - 90.0, "+%d" % int(ev[1]), Color("7dff9a"), 24)
				burst(sim.px, sim.py - 40.0, 8, Color("7dff9a"), 160.0, 0.3, 0.5)
			"levelup":
				Audio.play("levelup")
				ring(sim.px, sim.py - 30.0, 160.0, Color("7fe3ff"))
				burst(sim.px, sim.py - 40.0, 30, Color("ffd36a"), 420.0, 0.5, 0.8)
			"die":
				Audio.play("death")
				slowmo = 0.22
				_shake(400, 0.008)
				burst(sim.px, sim.py - 40.0, 30, Color("ffa040"), 300.0, 0.5, 0.8)
			"boss_start":
				Audio.music("boss")
				_shake(700, 0.006)
			"revive":
				ring(sim.px, sim.py - 30.0, 320.0, Color("ffd36a"))
				Audio.play("levelup")
			"sword_out":
				Audio.play("dash", 0.8)
				ring(sim.px, sim.py - 30.0, 120.0, Color("7fe3ff"))
			"sword_recall":
				Audio.play("warn", 0.8)
			"sword_thrust":
				Audio.play("thunder", 0.9)
				_shake(120, 0.003)
				burst(ev[1] + ev[3].x * 200.0, ev[2] + ev[3].y * 200.0, 14, Color("7fe3ff"), 360.0, 0.45, 0.5)
			"clash":
				burst(ev[1], ev[2], 16, Color("bfeaff"), 320.0, 0.4, 0.4)
				Audio.play("crit")
				_float(ev[1], ev[2] - 30.0, "击落灵剑", Color("9fe8ff"), 24)
			"stagger":
				_shake(150, 0.003)
				Audio.play("boom", 0.6)
			"gourd":
				Audio.play("chest")
				ring(sim.px, sim.py - 30.0, 200.0, Color("ffcf5a"))
			"pet_born":
				Audio.play("levelup")
				hit_stop = maxf(hit_stop, 0.12)
				fade = 0.5
				burst(sim.px, sim.py - 40.0, 70, Color("ffcf5a"), 520.0, 0.7, 1.0)
			"pet_combo":
				Audio.play("boom")
				_shake(220, 0.006)
			"pet_dead":
				Audio.play("hurt")
			"sword_stage":
				Audio.play("levelup")
				ring(sim.px, sim.py - 30.0, 260.0, Color("7fe3ff"))
				burst(sim.px, sim.py - 40.0, 40, Color("9fe8ff"), 420.0, 0.6, 0.9)
				if banner_cb.is_valid():
					var nm: Array = GameData.DG.sword.stages.names
					banner_cb.call("飞剑升至第 %d 阶 • 解锁「%s」（%s）" % [ev[1], nm[int(ev[1]) - 1], ev[2]], "#7fe3ff")
			"sword_qi":
				Audio.play("shoot", 0.7)
			"sword_array":
				Audio.play("thunder", 0.9)
				_shake(160, 0.004)
				ring(sim.px, sim.py - 30.0, 300.0, Color("bfeaff"))
			"sword_drop":
				Audio.play("hurt", 0.8)
				_float(sim.px, sim.py - 110.0, "飞剑坠地", Color("ff9a8a"), 26)
			"artifact":
				Audio.play("chest")
				fade = 0.0
				burst(sim.px, sim.py - 40.0, 60, Color("7fe3ff"), 480.0, 0.7, 1.0)
				ring(sim.px, sim.py - 30.0, 300.0, Color("7fe3ff"))
			"rift_enter":
				Audio.play("roar", 0.7)
				_shake(500, 0.005)
			"rift_exit":
				Audio.play("levelup" if ev[1] else "hurt")
			"relic":
				Audio.play("coin")
			"break_start":
				Audio.play("chest", 0.8)
			"elite":
				_shake(300, 0.004)
			"choice":
				pass
	sim.events.clear()


# ======================================================================
# 绘制
# ======================================================================
## 背景按当前段/秘境按需加载（其余卸载），1280×720 一张，镜像无缝平铺铺满整图
func _bg_tex() -> Texture2D:
	var key: String = "field_rift" if sim.phase == Sim.PH_RIFT else String(["field", "field2", "field3"][mini(sim.seg, 2)])
	if not T.has(key):
		for k in ["field", "field2", "field3", "field_rift"]:
			T.erase(k)
		T[key] = load("res://assets/%s.jpg" % key)
	return T[key]


func _draw_bg(c: Node2D) -> void:
	var tint := Color(0.82, 0.76, 0.95)
	if sim.phase != Sim.PH_RIFT:
		var tt: Array = GameData.SEG.segments[mini(sim.seg, 2)].tint
		tint = Color(tt[0], tt[1], tt[2])
	else:
		tint = Color(0.9, 0.82, 1.0)
	var bt := _bg_tex()
	var tw := float(bt.get_width())
	var th := float(bt.get_height())
	var tx_n := int(ceil(Sim.W / tw))
	var ty_n := int(ceil(Sim.H / th))
	for iy in range(ty_n):
		for ix in range(tx_n):
			# 奇数格镜像（负尺寸 = 翻转，位置不变），相邻瓦片边缘连续
			c.draw_texture_rect(bt, Rect2(ix * tw, iy * th, -tw if ix % 2 == 1 else tw, -th if iy % 2 == 1 else th), false, tint)
	c.draw_rect(Rect2(0, 0, Sim.W, Sim.H), Color(0.23, 0.16, 0.36, 0.16))
	if sim.phase != Sim.PH_RIFT:
		var lm := [[Vector2(Sim.W / 2.0, 260.0), "古井祭坛", Color(0.5, 0.7, 1.0)], [Vector2(Sim.W - 300.0, Sim.H / 2.0), "破败牌坊", Color(1.0, 0.7, 0.4)], [Vector2(300.0, Sim.H / 2.0), "灯冢废墟", Color(0.8, 0.6, 1.0)], [Vector2(Sim.W / 2.0, Sim.H - 260.0), "荒庙香炉", Color(1.0, 0.5, 0.4)]]
		for m in lm:
			var mp: Vector2 = m[0]
			var mc: Color = m[2]
			c.draw_arc(mp, 120.0, 0, TAU, 40, Color(mc, 0.35), 4.0, true)
			c.draw_rect(Rect2(mp.x - 14, mp.y - 80, 28, 80), Color(mc, 0.3))
			c.draw_rect(Rect2(mp.x - 50, mp.y - 90, 100, 14), Color(mc, 0.3))
			c.draw_string(font, mp + Vector2(-100, 40), String(m[1]), HORIZONTAL_ALIGNMENT_CENTER, 200.0, 26, Color(mc, 0.6))
	if sim.phase == Sim.PH_RIFT:
		var cc := Vector2(Sim.W / 2.0, Sim.H / 2.0)
		var R: float = GameData.DG.rift.arenaRadius
		c.draw_arc(cc, R + 14.0, 0, TAU, 96, Color(0.8, 0.3, 0.9, 0.5), 8.0, true)
		c.draw_arc(cc, R + 14.0, 0, TAU, 96, Color(1.0, 0.8, 0.5, 0.35), 2.0, true)


func _lamp_positions() -> Array:
	var out: Array = []
	var cc := Vector2(Sim.W / 2.0, Sim.H / 2.0)
	for lp in GameData.SEG.segments[mini(sim.seg, 2)].lamps:
		out.append(cc + Vector2(lp[0], lp[1]))
	return out


func _lamps_lit() -> bool:
	return sim.phase == Sim.PH_SEG or sim.phase == Sim.PH_BOSS


func _draw_ground_add(c: Node2D) -> void:
	var t_fx := Time.get_ticks_usec()
	defer__draw_ground_add(c)
	PerfStat.add("ground_add_draw", t_fx)


func defer__draw_ground_add(c: Node2D) -> void:
	var g: Texture2D = T.glow
	# 主角脚下灯光
	var lit := 0.26 + sin(t_anim * 3.1) * 0.03
	c.draw_texture_rect(g, Rect2(sim.px - 270, sim.py - 20 - 220, 540, 440), false, Color(1.0, 0.66, 0.31, lit))
	# 骨灯光池
	for lp in _lamp_positions():
		if _lamps_lit():
			var fl := 0.34 + sin(t_anim * 2.4 + lp.x) * 0.06
			c.draw_texture_rect(g, Rect2(lp.x - 190, lp.y - 120, 380, 240), false, Color(1.0, 0.6, 0.24, fl))
	# 火路
	for tr in sim.trails:
		var a: float = clampf(tr.life / 1.4, 0.0, 1.0)
		c.draw_texture_rect(g, Rect2(tr.x - 34, tr.y - 34, 68, 68), false, Color(1.0, 0.5, 0.15, 0.7 * a))
	# 段间：裂隙与游商的光
	if sim.phase == Sim.PH_BREAK:
		var rp := sim.break_pos("rift")
		var pulse := 0.5 + sin(t_anim * 3.0) * 0.12
		c.draw_texture_rect(g, Rect2(rp.x - 260, rp.y - 200, 520, 400), false, Color(0.75, 0.3, 1.0, pulse))
		c.draw_texture_rect(g, Rect2(rp.x - 90, rp.y - 900, 180, 960), false, Color(0.7, 0.3, 1.0, 0.55 if sim.rift_state() == "ok" else 0.2))
		var mp := sim.break_pos("merchant")
		c.draw_texture_rect(g, Rect2(mp.x - 160, mp.y - 110, 320, 220), false, Color(1.0, 0.7, 0.3, 0.45))
		var gp := sim.break_pos("gate")
		c.draw_texture_rect(g, Rect2(gp.x - 120, gp.y - 330, 240, 420), false, Color(1.0, 0.85, 0.5, 0.45 + sin(t_anim * 2.2) * 0.08))


func _player_frame() -> int:
	if sim.moving or sim.dash_t > 0.0:
		var ratio := 1.0
		return int(t_anim * 12.0 * ratio) % 12
	return 0


func _draw_shadow(x: float, y: float, rx: float, ry: float, a: float = 0.4) -> void:
	draw_texture_rect(T.glow, Rect2(x - rx, y - ry * 0.5, rx * 2.0, ry), false, Color(0, 0, 0, a))


var _keys := PackedInt64Array()
var _objs: Array = []
var _cull := Rect2()
var _vis_enemies: Array = []
var _enemy_cache: Dictionary = {}   # 小怪 → [图集, 区域, w, h, 1.0]，常量查表，无逐帧分配


func _visible(x: float, y: float, margin: float) -> bool:
	return x > _cull.position.x - margin and x < _cull.end.x + margin and y > _cull.position.y - margin and y < _cull.end.y + margin + 160.0


func _push(y: float, kind: int, obj: Variant) -> void:
	# 按 y 排序：key = (y*4 取整 + 偏移) << 20 | (kind << 16... 下标)，用原生 PackedInt64Array.sort（无闭包、无逐帧数组分配）
	_keys.append((int(y * 4.0) + 40000) << 20 | _objs.size())
	_objs.append(obj)
	_kinds.append(kind)


var _kinds := PackedInt32Array()


func _draw() -> void:
	var t_draw := Time.get_ticks_usec()
	# 视口裁剪：只处理镜头范围内（含边距）的实体，屏外不提交绘制
	var vis := get_viewport_rect().size / maxf(0.01, cam.zoom.x)
	_cull = Rect2(cam.position - vis / 2.0, vis)
	_keys.resize(0)
	_vis_enemies.clear()
	_objs.clear()
	_kinds.resize(0)
	for lp in _lamp_positions():
		if _visible(lp.x, lp.y, 200.0):
			_push(lp.y, 0, lp)
	for e: SimEnemy in sim.enemies:
		if e.boss or e.elite or _visible(e.x, e.y, 130.0):
			_push(e.y, 1, e)
			_vis_enemies.append(e)
	_push(sim.py, 2, null)
	if sim.phase == Sim.PH_SEG:
		for i in range(sim.pois.size()):
			if _visible(float(sim.pois[i].x), float(sim.pois[i].y), 260.0):
				_push(float(sim.pois[i].y), 5, i)
	if sim.phase == Sim.PH_BREAK:
		_push(sim.break_pos("rift").y, 4, "rift")
		_push(sim.break_pos("merchant").y, 4, "merchant")
		_push(sim.break_pos("gate").y, 4, "gate")
	_keys.sort()
	_draw_teles()
	# 掉落物在地面：不参与 y 排序，按贴图种类分批画（同贴图连续提交，批次不再被妖物打断）
	var t_pk := Time.get_ticks_usec()
	for kind in ["soul", "coin", "oil", "chest"]:
		for k: SimPickup in sim.pickups:
			if k.kind == kind and _visible(k.x, k.y, 60.0):
				_draw_pickup(k)
	PerfStat.add("d_pickup", t_pk)
	# 阴影单独一遍：同一张贴图连续提交，Godot 自动合批（原先“阴影-精灵”交替提交，每只妖物打断两次批次，绘制调用 1142@300 只）
	var t_s := Time.get_ticks_usec()
	_draw_shadow(sim.px, sim.py, 28.0, 14.0)
	for e: SimEnemy in sim.enemies:
		if e.boss or e.elite or _visible(e.x, e.y, 130.0):
			_draw_shadow(e.x, e.y, e.r * 1.3, e.r * 0.6)
	PerfStat.add("d_shadow", t_s)
	for key in _keys:
		var idx := int(key & 0xFFFFF)
		var o: Variant = _objs[idx]
		match _kinds[idx]:
			0: _draw_lamp(o)
			1:
				var t_e := Time.get_ticks_usec()
				_draw_enemy(o)
				PerfStat.add("d_enemy", t_e)
			2: _draw_player()
			3:
				var t_k := Time.get_ticks_usec()
				_draw_pickup(o)
				PerfStat.add("d_pickup", t_k)
			4: _draw_zone(o)
			5: _draw_poi(o)
	for e2: SimEnemy in _vis_enemies:
		if e2.mark_t > 0.0 or e2.marks > 0 or e2.elite or e2.boss:
			_draw_enemy_overlays(e2)
	var t_p := Time.get_ticks_usec()
	_draw_projectiles()
	PerfStat.add("d_proj", t_p)
	var t_f := Time.get_ticks_usec()
	_draw_floaters()
	PerfStat.add("d_float", t_f)
	PerfStat.add("world_draw", t_draw)


func _draw_lamp(p: Vector2) -> void:
	var tx: Texture2D = T.field_lantern
	var lit := _lamps_lit()
	var s := 1.0
	var sz := Vector2(tx.get_width(), tx.get_height()) * s
	var col := Color.WHITE if lit else Color(0.35, 0.36, 0.5)
	draw_texture_rect(tx, Rect2(p.x - sz.x / 2.0, p.y - sz.y, sz.x, sz.y), false, col)
	if not lit and sim.phase == Sim.PH_RIFT:
		pass


func _draw_teles() -> void:
	for tl: SimTele in sim.teles:
		if tl.r <= 0.0:
			continue
		var k := clampf(tl.t / maxf(0.01, tl.dur), 0.0, 1.0)
		draw_circle(Vector2(tl.x, tl.y), tl.r, Color(0.88, 0.27, 0.23, 0.12 + 0.18 * k))
		draw_arc(Vector2(tl.x, tl.y), tl.r, 0, TAU, 48, Color(1.0, 0.45, 0.35, 0.8), 3.0, true)
		draw_arc(Vector2(tl.x, tl.y), tl.r * k, 0, TAU, 48, Color(1.0, 0.7, 0.5, 0.7), 2.0, true)


func _draw_player() -> void:
	var tx: Texture2D = T.hero_run
	var fr := _player_frame()
	var col := Color.WHITE
	if sim.invuln > 0.0:
		col.a = 0.3 if int(t_anim * 20.0) % 2 == 1 else 1.0
	elif sim.dash_inv > 0.0:
		col.a = 0.75
	if sim.hurt_flash > 0.0:
		col = Color(1.0, 0.45, 0.45, col.a)
	var sc := 0.44
	var fw := 152.0
	var fh := 192.0
	var wob := 1.0
	var rot := 0.0
	if sim.moving or sim.dash_t > 0.0:
		rot = sin(t_anim * 18.0) * 0.04 + sim.in_move.x * 0.06
	else:
		wob = 1.0 + sin(t_anim * 4.0) * 0.025
	var w := fw * sc
	var h := fh * sc * wob
	draw_set_transform(Vector2(sim.px, sim.py), rot, Vector2.ONE)
	var src := Rect2((fr % 6) * fw, (fr / 6) * fh, fw, fh)
	var dst := Anchors.rect(0.0, -h * 0.92, w, h, "hero_run", sim.face_x < 0)
	draw_texture_rect_region(tx, dst, src, col)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# 冲刺残影在加色层画


func _anchor_key(e: SimEnemy) -> String:
	if e.warden:
		return "boss_swordwarden"
	if e.boss:
		return "boss_idle"
	if e.elite and e.type == "jiangshi":
		return "jiangshi_hop"
	return String(e.def.tex)


func _enemy_tex(e: SimEnemy) -> Array:
	## 返回 [texture, src_rect(or null), frame_w, frame_h, sheet_scale]
	if e.warden:
		var wt: Texture2D = T.boss_swordwarden
		return [wt, null, float(wt.get_width()), float(wt.get_height()), 1.0]
	if e.boss:
		var n := int(t_anim * 8.0) % 8
		return [T.boss_idle, Rect2(n * 236, 0, 236, 384), 236.0, 384.0, 1.05]
	if e.elite and e.type == "jiangshi":
		var ph := fmod(e.hop, 1.0)
		var fr := 0
		if ph < 0.6:
			fr = 1 + mini(5, int(ph / 0.6 * 6.0))
		elif ph < 0.8:
			fr = 7
		return [T.jiangshi_hop, Rect2(fr * 119, 0, 119, 200), 119.0, 200.0, 1.35]
	return _enemy_cache[e.def.tex]


func _draw_enemy(e: SimEnemy) -> void:
	var info := _enemy_tex(e)
	var tx: Texture2D = info[0]
	var hh: float = e.def.h * e.scale_mul * info[4]
	var ww: float = hh * float(info[2]) / float(info[3])
	var sq := e.squash
	var wob := 1.0
	if e.ai != "hop":
		wob = 1.0 + sin(t_anim * 9.0 + e.phase) * 0.05
	var sx := (2.0 - sq) / wob if e.ai != "hop" else (2.0 - sq)
	var sy := sq * wob
	var w := ww * sx
	var h := hh * sy
	var flip: bool = e.flip
	var col := Color.WHITE
	if e.burn_t > 0.0:
		col = Color(1.0, 0.78, 0.6)
	if e.state == "charge" or e.warn_t > 0.0:
		col = Color(1.0, 0.45, 0.45)
	if e.state == "fuse":
		col = Color(1.0, 0.3, 0.3) if int(e.timer * 14.0) % 2 == 0 else Color(1.0, 0.85, 0.85)
	if e.warden and e.stagger_t > 0.0:
		col = Color(1.0, 0.95, 0.5) if int(t_anim * 12.0) % 2 == 0 else Color(1.0, 0.8, 0.3)
	if e.warden:
		_draw_warden_fx(e)
	var y0 := e.y - h * 0.95 - e.lift
	var dst := Anchors.rect(e.x, y0, w, h, _anchor_key(e), flip)
	if info[1] != null:
		draw_texture_rect_region(tx, dst, info[1], col)
	else:
		draw_texture_rect(tx, dst, false, col)
	if e.flash > 0.0:
		flash_list.append([tx, dst, info[1]])


## 叠加循环：血条/剑痕/符印在所有实体画完之后统一提交（线条/圆弧与贴图混排会不断打断合批）
func _draw_enemy_overlays(e: SimEnemy) -> void:
	if e.mark_t > 0.0:
		var k: float = 1.0 - e.mark_t / float(GameData.EVOS.fu.stats.markDelay)
		var cy := e.y - e.h * 0.45
		var rr := 16.0 + e.r * 0.4
		draw_arc(Vector2(e.x, cy), rr, 0, TAU, 24, Color(1, 0.83, 0.42, 0.5), 2.0, true)
		draw_arc(Vector2(e.x, cy), rr, -PI / 2.0, -PI / 2.0 + k * TAU, 24, Color(1, 0.9, 0.66, 0.95), 4.0, true)
	if e.marks > 0:
		# 剑痕：头顶青色斜痕，层数 = 痕数
		var cx := e.x - (e.marks - 1) * 6.0
		for i in range(e.marks):
			var px := cx + i * 12.0
			var py := e.y - e.h - 6.0 - e.lift
			draw_line(Vector2(px - 4, py + 7), Vector2(px + 4, py - 7), Color(0.5, 0.92, 1.0), 3.0, true)
	if e.elite or e.boss:
		_draw_bar(e)


func _draw_warden_fx(e: SimEnemy) -> void:
	var C: Dictionary = GameData.DG.warden
	var sw: Texture2D = T.proj_sword
	if e.blades_t > 0.0:
		for i in range(int(C.blades)):
			if float(e.blade_down[i]) > 0.0:
				continue
			var bp := sim.warden_blade_pos(e, i)
			var a := e.blade_ang + float(i) / float(C.blades) * TAU
			var tang := atan2(cos(a) * float(C.bladeRy), -sin(a) * float(C.bladeRx))
			draw_set_transform(bp, tang, Vector2.ONE)
			draw_texture_rect(sw, Rect2(-sw.get_width() * 0.3, -sw.get_height() * 0.3, sw.get_width() * 0.6, sw.get_height() * 0.6), false, Color(0.75, 0.55, 1.0))
			draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if e.warn_t > 0.0:
		var L: Dictionary = C.lunge
		var o := Vector2(e.x, e.y - 20.0)
		var k := 1.0 - e.warn_t / float(L.warn)
		draw_line(o, o + e.lunge_dir * float(L.len), Color(1.0, 0.3, 0.25, 0.25 + 0.45 * k), float(L.width) * (0.5 + 0.5 * k), true)
		draw_line(o, o + e.lunge_dir * float(L.len), Color(1.0, 0.8, 0.7, 0.9), 3.0, true)
	if e.stagger_t > 0.0:
		draw_string_outline(font, Vector2(e.x - 100, e.y - e.h - 40.0), "破绽！承伤+%d%%" % int((float(C.lunge.staggerTakenMul) - 1.0) * 100.0), HORIZONTAL_ALIGNMENT_CENTER, 200.0, 24, 6, UI.INK)
		draw_string(font, Vector2(e.x - 100, e.y - e.h - 40.0), "破绽！承伤+%d%%" % int((float(C.lunge.staggerTakenMul) - 1.0) * 100.0), HORIZONTAL_ALIGNMENT_CENTER, 200.0, 24, Color(1.0, 0.9, 0.4))


func _draw_bar(e: SimEnemy) -> void:
	# 精英/守关者头顶血条（Boss 的大血条在 HUD）
	if e.boss:
		return
	var w := 90.0
	var x := e.x - w / 2.0
	var y := e.y - e.h - 22.0 - e.lift
	draw_rect(Rect2(x - 2, y - 2, w + 4, 10), UI.INK)
	draw_rect(Rect2(x, y, w * clampf(e.hp / e.maxhp, 0.0, 1.0), 6), Color("ff5a4a") if e.warden else Color("ff9a3c"))


const PICKUP_TEX := {"soul": "drop_soul", "coin": "drop_coin", "oil": "drop_oil", "chest": "drop_chest"}


func _draw_pickup(k: SimPickup) -> void:
	var tx: Texture2D = T[PICKUP_TEX[k.kind]]
	var sc := 0.42
	var col := Color.WHITE
	match k.kind:
		"soul":
			sc = 0.7 if k.val >= 25 else (0.6 if k.val >= 10 else (0.52 if k.val >= 4 else 0.42))
			if k.val >= 10:
				col = Color(1.0, 0.83, 0.42)
		"oil":
			sc = 0.62
		"chest":
			sc = 0.75
	var born := minf(1.0, (sim.real_t - k.born) / 0.3)
	sc *= born
	var w := tx.get_width() * sc
	var h := tx.get_height() * sc
	var bob := sin(k.bob) * 3.0
	draw_texture_rect(tx, Rect2(k.x - w / 2.0, k.y - h / 2.0 + bob, w, h), false, col)


func _draw_poi(i: int) -> void:
	if sim.pois[i].kind == "vine":
		if sim.vine_taken.has(i):
			return
		var vp := Vector2(float(sim.pois[i].x), float(sim.pois[i].y))
		draw_texture_rect(T.glow, Rect2(vp.x - 110, vp.y - 110, 220, 220), false, Color(0.3, 1.0, 0.5, 0.45))
		for a in range(3):
			draw_line(vp, vp + Vector2(sin(t_anim + a * 2.1) * 40.0, -70.0 - a * 14.0), Color(0.3, 0.8, 0.3), 5.0, true)
		draw_circle(vp + Vector2(0, -80), 16.0, Color(1.0, 0.7, 0.2))
		_draw_zone_text(vp + Vector2(0, -110.0), "葫芦灵藤", "站定 1 秒采集彩虹葫芦散件", Color("9fffb0"))
		var vh: float = float(sim.poi_hold.get(i, 0.0))
		if vh > 0.0:
			draw_arc(vp, 78.0, -PI / 2.0, -PI / 2.0 + clampf(vh / float(GameData.DG.rift.hold), 0.0, 1.0) * TAU, 48, Color(1.0, 0.9, 0.5, 0.95), 7.0, true)
		return
	if sim.pois[i].kind == "merchant":
		var mp2 := Vector2(float(sim.pois[i].x), float(sim.pois[i].y))
		var mt: Texture2D = T.merchant
		var mh := 150.0
		var mw := mt.get_width() * mh / mt.get_height()
		draw_texture_rect(mt, Rect2(mp2.x - mw / 2.0, mp2.y - mh * 0.95, mw, mh), false, Color.WHITE)
		_draw_zone_text(mp2 + Vector2(0, -mh - 4.0), String(sim.pois[i].name), "站定 1 秒打开商店（灯芯换遗物）", UI.GOLD)
		return
	var pp := Vector2(float(sim.pois[i].x), float(sim.pois[i].y))
	var tx: Texture2D = T.rift_portal
	var st := sim.poi_state(i)
	var sc := 1.0 + sin(t_anim * 3.0) * 0.03
	var w := tx.get_width() * sc
	var h := tx.get_height() * sc
	draw_texture_rect(T.glow, Rect2(pp.x - 200, pp.y - 260, 400, 300), false, Color(0.7, 0.3, 1.0, 0.45 if st == "ok" else 0.15))
	draw_texture_rect(tx, Rect2(pp.x - w / 2.0, pp.y - h * 0.75, w, h), false, Color.WHITE if st == "ok" else Color(0.55, 0.5, 0.62))
	var sub: String = "站定进入 • 消耗灯芯×1" if st == "ok" else {"weak": "灯弱，不可入", "nowick": "灯芯不足", "sealed": "裂隙已闭合", "max": "本局已入两次"}.get(st, "")
	_draw_zone_text(pp + Vector2(0, -h * 0.75 - 10.0), String(sim.pois[i].name), sub, UI.GOLD if st == "ok" else Color("ff8a7a"))
	var zr: float = GameData.SEG["break"].zoneR
	var hv: float = float(sim.poi_hold.get(i, 0.0))
	draw_arc(pp, zr, 0, TAU, 48, Color(1, 0.8, 0.4, 0.35), 3.0, true)
	if hv > 0.0:
		draw_arc(pp, zr, -PI / 2.0, -PI / 2.0 + clampf(hv / float(GameData.DG.rift.hold), 0.0, 1.0) * TAU, 48, Color(1.0, 0.9, 0.5, 0.95), 7.0, true)


func _draw_zone(which: String) -> void:
	var p := sim.break_pos(which)
	var zr: float = GameData.SEG["break"].zoneR
	var label := ""
	var sub := ""
	var col := UI.GOLD
	match which:
		"rift":
			var tx: Texture2D = T.rift_portal
			var s := 1.0 + sin(t_anim * 3.0) * 0.03
			var w := tx.get_width() * s
			var h := tx.get_height() * s
			draw_texture_rect(tx, Rect2(p.x - w / 2.0, p.y - h * 0.75, w, h), false, Color.WHITE if sim.rift_state() == "ok" else Color(0.55, 0.5, 0.62))
			label = "灯骸裂隙"
			match sim.rift_state():
				"ok": sub = "站定进入 • 消耗灯芯×1 • 放弃本段三选一"
				"weak": sub = "灯弱，不可入"; col = Color("ff8a7a")
				"nowick": sub = "灯芯不足"; col = Color("ff8a7a")
				"sealed": sub = "裂隙已闭合"; col = Color("9aa3cf")
				"max": sub = "本局已入两次"; col = Color("9aa3cf")
			_draw_zone_text(p + Vector2(0, -h * 0.75 - 10.0), label, sub, col)
		"merchant":
			var tx2: Texture2D = T.merchant
			var h2 := 150.0
			var w2 := tx2.get_width() * h2 / tx2.get_height()
			_draw_shadow(p.x, p.y, 44.0, 20.0)
			draw_texture_rect(tx2, Rect2(p.x - w2 / 2.0, p.y - h2 * 0.95 + sin(t_anim * 2.0) * 2.0, w2, h2), false, Color.WHITE)
			_draw_zone_text(p + Vector2(0, -h2 - 4.0), "游商", "站定交易 • 灯芯换遗物", UI.GOLD)
		"gate":
			var tx3: Texture2D = T.field_lantern
			for sx in [-70.0, 70.0]:
				draw_texture_rect(tx3, Rect2(p.x + sx - tx3.get_width() / 2.0, p.y - tx3.get_height() + 30.0, tx3.get_width(), tx3.get_height()), false, Color.WHITE)
			var sub3 := "站定启程 • 领取馈赠三选一" if sim.gift_pending else "站定启程（馈赠已放弃）"
			_draw_zone_text(p + Vector2(0, -tx3.get_height() - 4.0), "启程", sub3, UI.GOLD)
	# 站定进度环
	var hv: float = float(sim.hold.get(which, 0.0))
	var need: float = GameData.DG.rift.hold
	draw_arc(p, zr, 0, TAU, 48, Color(1, 0.8, 0.4, 0.35), 3.0, true)
	if hv > 0.0:
		draw_arc(p, zr, -PI / 2.0, -PI / 2.0 + clampf(hv / need, 0.0, 1.0) * TAU, 48, Color(1.0, 0.9, 0.5, 0.95), 7.0, true)


func _draw_zone_text(p: Vector2, title: String, sub: String, col: Color) -> void:
	draw_string_outline(font, p + Vector2(-200, -22), title, HORIZONTAL_ALIGNMENT_CENTER, 400.0, 34, 6, UI.INK)
	draw_string(font, p + Vector2(-200, -22), title, HORIZONTAL_ALIGNMENT_CENTER, 400.0, 34, UI.PAPER)
	draw_string_outline(font, p + Vector2(-260, 6), sub, HORIZONTAL_ALIGNMENT_CENTER, 520.0, 20, 5, UI.INK)
	draw_string(font, p + Vector2(-260, 6), sub, HORIZONTAL_ALIGNMENT_CENTER, 520.0, 20, col)


func _draw_projectiles() -> void:
	var tx: Texture2D = T.proj_talisman
	for b: SimBullet in sim.bullets:
		var w := tx.get_width() * 0.48
		var h := tx.get_height() * 0.48
		draw_set_transform(Vector2(b.x, b.y), b.ang, Vector2.ONE)
		draw_texture_rect(tx, Rect2(-w / 2.0, -h / 2.0, w, h), false, Color.WHITE)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	var eg: Texture2D = T.proj_ghostfire
	for b: SimBullet in sim.ebullets:
		var w2 := eg.get_width() * 0.42
		var h2 := eg.get_height() * 0.42
		draw_set_transform(Vector2(b.x, b.y), t_anim * 6.0, Vector2.ONE)
		draw_texture_rect(eg, Rect2(-w2 / 2.0, -h2 / 2.0, w2, h2), false, Color.WHITE)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if sim.pet_on and sim.pet_dead_t <= 0.0:
		var pp := sim.pet_pos
		draw_circle(pp + Vector2(0, 4), 22.0, UI.INK)
		draw_circle(pp, 19.0, Color(1.0, 0.75, 0.2))
		draw_circle(pp + Vector2(0, -24), 12.0, Color(1.0, 0.6, 0.15))
		draw_circle(pp + Vector2(-6, -2), 3.0, UI.INK)
		draw_circle(pp + Vector2(6, -2), 3.0, UI.INK)
	# 剑轮 / 剑气（阶段3-5）
	var swt: Texture2D = T.proj_sword
	for wp: Vector2 in sim.sw_wheel_pos:
		var wa := atan2(wp.y - (sim.py - 30.0), wp.x - sim.px) + PI / 2.0
		draw_set_transform(wp, wa, Vector2.ONE)
		draw_texture_rect(swt, Rect2(-swt.get_width() * 0.2, -swt.get_height() * 0.2, swt.get_width() * 0.4, swt.get_height() * 0.4), false, Color(0.8, 1.0, 1.0))
	for qb: SimBullet in sim.sw_qi:
		draw_set_transform(Vector2(qb.x, qb.y), qb.ang, Vector2.ONE)
		var big: float = 0.42 if qb.hits.key == "sw_array" else 0.32
		draw_texture_rect(swt, Rect2(-swt.get_width() * big / 2.0, -swt.get_height() * big / 2.0, swt.get_width() * big, swt.get_height() * big), false, Color(1.0, 0.9, 0.6) if qb.hits.key == "sw_array" else Color(0.6, 1.0, 1.0))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	var fl: Texture2D = T.proj_flame
	for o in sim.orb_pos:
		var s := 0.5 + sin(t_anim * 14.0) * 0.05
		draw_texture_rect(fl, Rect2(o.x - fl.get_width() * s / 2.0, o.y - fl.get_height() * s / 2.0, fl.get_width() * s, fl.get_height() * s), false, Color.WHITE)
	# 飞剑
	if sim.has_sword() and (sim.sw_state == Sim.SW_ORBIT or sim.sw_state == Sim.SW_RECALL):
		var sw: Texture2D = T.proj_sword
		var sc := 0.62
		var ang := 0.0
		if sim.sw_state == Sim.SW_ORBIT:
			ang = sim.sw_ang + PI / 2.0 + 0.4
			ang = atan2(cos(sim.sw_ang) * GameData.DG.sword.orbitRy, -sin(sim.sw_ang) * GameData.DG.sword.orbitRx)
		else:
			ang = atan2(sim.sw_dir.y, sim.sw_dir.x)
		draw_set_transform(Vector2(sim.sw_x, sim.sw_y), ang, Vector2.ONE)
		draw_texture_rect(sw, Rect2(-sw.get_width() * sc / 2.0, -sw.get_height() * sc / 2.0, sw.get_width() * sc, sw.get_height() * sc), false, Color.WHITE)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	elif sim.has_sword() and sim.sw_state == Sim.SW_DROP:
		var sw2: Texture2D = T.proj_sword
		draw_set_transform(Vector2(sim.px + 40.0, sim.py + 6.0), 0.5, Vector2.ONE)
		draw_texture_rect(sw2, Rect2(-sw2.get_width() * 0.25, -sw2.get_height() * 0.25, sw2.get_width() * 0.5, sw2.get_height() * 0.5), false, Color(0.6, 0.6, 0.65))
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_floaters() -> void:
	for f in floaters:
		var a := clampf(f.life / 0.4, 0.0, 1.0)
		var col: Color = f.col
		col.a = a
		var pos := Vector2(f.x - 100.0, f.y)
		draw_string_outline(font, pos, f.text, HORIZONTAL_ALIGNMENT_CENTER, 200.0, f.size, 6, Color(UI.INK, a))
		draw_string(font, pos, f.text, HORIZONTAL_ALIGNMENT_CENTER, 200.0, f.size, col)


func _draw_fx_add(c: Node2D) -> void:
	var t_fx := Time.get_ticks_usec()
	defer__draw_fx_add(c)
	PerfStat.add("fx_add_draw", t_fx)


func defer__draw_fx_add(c: Node2D) -> void:
	var g: Texture2D = T.glow
	for gh in ghosts:
		var a: float = clampf(gh.life / 0.32, 0.0, 1.0) * 0.55
		var tx: Texture2D = T.hero_run
		var fw := 152.0
		var fh := 192.0
		var w := fw * 0.44
		var h := fh * 0.44
		var fr: int = gh.fr
		var src := Rect2((fr % 6) * fw, (fr / 6) * fh, fw, fh)
		var dst := Anchors.rect(gh.x, gh.y - h * 0.92, w, h, "hero_run", gh.flip)
		c.draw_texture_rect_region(tx, dst, src, Color(0.5, 0.89, 1.0, a))
	# 子弹辉光
	for b: SimBullet in sim.bullets:
		c.draw_texture_rect(g, Rect2(b.x - 26, b.y - 26, 52, 52), false, Color(1.0, 0.85, 0.4, 0.55))
	for b: SimBullet in sim.ebullets:
		c.draw_texture_rect(g, Rect2(b.x - 30, b.y - 30, 60, 60), false, Color(0.5, 1.0, 0.7, 0.55))
	for o in sim.orb_pos:
		c.draw_texture_rect(g, Rect2(o.x - 44, o.y - 44, 88, 88), false, Color(1.0, 0.55, 0.2, 0.8))
	if sim.pet_on and sim.pet_dead_t <= 0.0:
		var rb := [Color("ff4a3a"), Color("ff9a3c"), Color("ffe04a"), Color("5ade6a"), Color("4adfe0"), Color("4a7aff"), Color("b05aff")]
		for ri in range(7):
			var ra := t_anim * 3.0 + ri * TAU / 7.0
			c.draw_circle(sim.pet_pos + Vector2(cos(ra) * 30.0, sin(ra) * 22.0 - 10.0), 5.0, rb[ri])
		c.draw_texture_rect(g, Rect2(sim.pet_pos.x - 50, sim.pet_pos.y - 50, 100, 100), false, Color(1.0, 0.8, 0.4, 0.5))
	for fx in sim.pet_fx:
		var fk: float = float(fx[3]) / 0.4
		var fp := Vector2(fx[1], fx[2])
		var fc: Color = [Color(1.0, 0.45, 0.15), Color(0.6, 0.9, 1.0), Color(1.0, 0.85, 0.4)][int(fx[0])]
		c.draw_arc(fp, 40.0 + 120.0 * (1.0 - fk), 0, TAU, 32, Color(fc, fk), 6.0, true)
	if sim.combo_fx > 0.0:
		var ck := sim.combo_fx / 0.7
		c.draw_arc(Vector2(sim.px, sim.py - 30.0), float(GameData.GD.pet.comboR) * (1.1 - ck), 0, TAU, 64, Color(1.0, 0.9, 0.5, ck), 12.0 * ck + 2.0, true)
	# 剑轮/剑气光 + 剑阵环
	for wp2: Vector2 in sim.sw_wheel_pos:
		c.draw_texture_rect(g, Rect2(wp2.x - 40, wp2.y - 40, 80, 80), false, Color(0.4, 0.9, 1.0, 0.55))
	for qb2: SimBullet in sim.sw_qi:
		c.draw_texture_rect(g, Rect2(qb2.x - 32, qb2.y - 32, 64, 64), false, Color(1.0, 0.85, 0.4, 0.7) if qb2.hits.key == "sw_array" else Color(0.4, 0.95, 1.0, 0.6))
	if sim.sw_array_fx > 0.0:
		var ka := sim.sw_array_fx / 0.6
		c.draw_arc(Vector2(sim.px, sim.py - 30.0), 340.0 * (1.2 - ka), 0, TAU, 64, Color(1.0, 0.9, 0.5, ka), 8.0 * ka + 2.0, true)
	# 飞剑光
	if sim.has_sword() and (sim.sw_state == Sim.SW_ORBIT or sim.sw_state == Sim.SW_RECALL):
		c.draw_texture_rect(g, Rect2(sim.sw_x - 56, sim.sw_y - 56, 112, 112), false, Color(0.4, 0.9, 1.0, 0.7))
		if sim.sw_state == Sim.SW_ORBIT:
			# 椭圆轨迹淡线
			var pts := PackedVector2Array()
			for i in range(41):
				var a2 := float(i) / 40.0 * TAU
				pts.append(Vector2(sim.px + cos(a2) * GameData.DG.sword.orbitRx, sim.py - 30.0 + sin(a2) * GameData.DG.sword.orbitRy))
			c.draw_polyline(pts, Color(0.5, 0.9, 1.0, 0.22), 3.0, true)
	if sim.sw_thrust_fx > 0.0:
		var k := sim.sw_thrust_fx / 0.25
		var d := sim.sw_dir.normalized()
		var o := Vector2(sim.px, sim.py - 30.0)
		var hw: float = GameData.DG.sword.thrustHalfW
		var L: float = GameData.DG.sword.thrustLen
		c.draw_line(o, o + d * L, Color(0.6, 0.95, 1.0, 0.9 * k), hw * 0.7 * k + 4.0, true)
		c.draw_line(o, o + d * L, Color(1, 1, 1, k), 6.0 * k + 1.0, true)
	# 圆环 / 闪电 / 爆炸图
	for r in rings:
		var k2: float = 1.0 - float(r.life) / float(r.max)
		var col: Color = r.col
		col.a = (1.0 - k2) * 0.9
		c.draw_arc(Vector2(r.x, r.y), r.r * (0.3 + 0.7 * k2), 0, TAU, 40, col, 5.0 * (1.0 - k2) + 1.0, true)
	for f in fx_sprites:
		var tx2: Texture2D = T[f.tex]
		var k3: float = float(f.life) / float(f.max)
		var sc: float = f.scale
		if f.get("thunder", false):
			var w3: float = tx2.get_width() * sc * (0.5 + 0.5 * k3)
			var h3: float = tx2.get_height() * sc
			c.draw_texture_rect(tx2, Rect2(f.x - w3 / 2.0, f.y - h3, w3, h3), false, Color(1, 1, 1, k3))
		else:
			var w4: float = tx2.get_width() * sc * (1.2 - 0.4 * k3)
			var h4: float = tx2.get_height() * sc * (1.2 - 0.4 * k3)
			c.draw_texture_rect(tx2, Rect2(f.x - w4 / 2.0, f.y - h4 / 2.0, w4, h4), false, Color(1, 1, 1, k3))
	for bl in sim.bolts:
		var p1 := Vector2(bl.x1, bl.y1)
		var p2 := Vector2(bl.x2, bl.y2)
		var mid := (p1 + p2) / 2.0 + Vector2(-(p2 - p1).y, (p2 - p1).x).normalized() * (float(bl.seed) - 0.5) * 40.0
		c.draw_polyline(PackedVector2Array([p1, mid, p2]), Color(0.7, 0.95, 1.0, clampf(bl.life / 0.18, 0, 1)), 4.0, true)
	for p in parts:
		var k4: float = float(p.life) / float(p.max)
		var col2: Color = p.col
		col2.a = k4
		var s: float = 64.0 * float(p.size) * (0.4 + 0.6 * k4)
		c.draw_texture_rect(g, Rect2(p.x - s / 2.0, p.y - s / 2.0, s, s), false, col2)


func _draw_white(c: Node2D) -> void:
	for f in flash_list:
		if f[2] != null:
			c.draw_texture_rect_region(f[0], f[1], f[2], Color(1, 1, 1, 0.8))
		else:
			c.draw_texture_rect(f[0], f[1], false, Color(1, 1, 1, 0.8))
	flash_list.clear()
