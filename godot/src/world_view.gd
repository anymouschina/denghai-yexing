class_name WorldView
extends Node2D
## 渲染层：只读 Sim 状态，用 _draw 画世界（背景/实体按 y 排序/弹幕/特效），并把 Sim 事件翻译成飘字、粒子、震屏与音效。
## 性能架构：TriBatch 零扩容合批 + 零分配 SoA 粒子池 + 预警/地标/血条统一白图合批 + 地标文字后置统一提交 + SNKRX 阻尼弹簧/创伤平方震屏/动态灯油光晕。

const LayerScript := preload("res://src/layer.gd")
const FLASH_SHADER: Shader = preload("res://src/flash.gdshader")
const MM_ATLAS_SHADER: Shader = preload("res://src/mm_atlas.gdshader")

const FL_MERGE := 0.45
const HIT_STOP_MAX := 0.035
const HIT_STOP_COOLDOWN := 1.5
const MM_BASE_CAP := 128
const MM_MAX_CAP := 384
const MM_SHRINK_IDLE_FRAMES := 180
const MAX_TEXT_FLOATERS := 6
const PICKUP_KINDS := ["soul", "coin", "oil", "chest"]
const PICKUP_TEX := {"soul": "drop_soul", "coin": "drop_coin", "oil": "drop_oil", "chest": "drop_chest"}
const PRELOAD_COMBAT := ["boss_swordwarden", "boss_swordlord", "boss_sedan", "boss_hundredlamps", "pet_huluwa"]
const PRELOAD_BGS := ["field", "field2", "field3", "field_rift"]
const FLOATER_SIZES := [20, 26]
const AIL_COL := [Color(1.0, 0.6, 0.24), Color(0.5, 0.84, 1.0), Color(0.95, 0.76, 0.3), Color(0.62, 0.91, 1.0)]
const PET_SHOT_COLS := [Color(1.0, 0.45, 0.2), Color(1.0, 0.85, 0.35), Color(0.55, 0.95, 1.0)]
const RAINBOW_COLS := [Color("ff4a3a"), Color("ff9a3c"), Color("ffe04a"), Color("5ade6a"), Color("4adfe0"), Color("4a7aff"), Color("b05aff")]
const PET_FX_COLS := [Color(1.0, 0.45, 0.15), Color(0.7, 0.85, 1.0), Color(1.0, 0.88, 0.35)]
const POI_TINTS := {
	"gourd": Color(0.6, 1.0, 0.6),
	"vault": Color(1.0, 0.7, 0.4),
	"coinfarm": Color(1.0, 0.88, 0.35),
	"soulfarm": Color(0.55, 0.85, 1.0),
}
const LM_HEIGHTS := {
	"altar": 156.0,
	"arch": 186.0,
	"tomb": 156.0,
	"incense": 142.0,
}
const OPT_ASSETS := [
	"obj_shrine_lamp", "obj_stele_soul",
	"poi_vine", "poi_altar", "poi_arch", "poi_tomb", "poi_incense",
]
const SHEETS := {
	"jiangshi_hop": {"tex": "res://assets/anim/jiangshi_hop.png", "w": 119, "h": 200, "n": 8},
}
const REACT_FX := {
	"leihuo": ["雷火爆", "ffd36a", 110.0],
	"fenfu": ["焚符", "ff7a3c", 70.0],
	"zhenlei": ["镇雷", "bfeaff", 80.0],
	"bind": ["定身", "f2c14b", 54.0],
	"collapse": ["百邪崩", "d9b8ff", 120.0],
}

var sim: Sim
var cam: Camera2D
var bg_layer: Node2D
var ground_add: Node2D
var ground_props: Node2D
var proj_layer: Node2D
var fx_add: Node2D
var white_layer: Node2D
var mm_shadow: MultiMesh
var mm_shadow_node: MultiMeshInstance2D
var mm_enemy_back: MultiMesh
var mm_enemy_back_node: MultiMeshInstance2D
var mm_enemy_front: MultiMesh
var mm_enemy_front_node: MultiMeshInstance2D
var mm_particles: MultiMesh
var mm_particles_node: MultiMeshInstance2D
var _mm_sh_rid: RID
var _mm_eb_rid: RID
var _mm_ef_rid: RID
var _mm_pt_rid: RID
var _mm_sh_cap := MM_BASE_CAP
var _mm_eb_cap := MM_BASE_CAP
var _mm_ef_cap := MM_BASE_CAP
var _mm_pt_cap := MM_BASE_CAP
var _mm_sh_idle := 0
var _mm_eb_idle := 0
var _mm_ef_idle := 0
var _mm_pt_idle := 0
var _mm_sh_n := 0
var _mm_eb_n := 0
var _mm_ef_n := 0
var _mm_sh_buf := PackedFloat32Array()
var _mm_eb_buf := PackedFloat32Array()
var _mm_ef_buf := PackedFloat32Array()
var _mm_pt_buf := PackedFloat32Array()
var T: Dictionary = {}
var t_anim := 0.0
var floaters: Array = []
var part_pool := Fx.ParticlePool.new(320)
var rings: Array = []
var fx_sprites: Array = []
var ghosts: Array = []
var trauma := 0.0
var shake_amp := 0.0
var shake_t := 0.0
var hit_stop := 0.0
var _hit_stop_cd := 0.0
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
var _fl_by_uid: Dictionary = {}
var _react_t: Dictionary = {}
var _local_flare_wave := 0.0

# SNKRX 阻尼弹簧：主角受击/冲刺/爆焰回弹 + 灯笼光晕脉动回弹
var player_spring := Fx.Spring.new(1.0, 320.0, 18.0)
var lantern_spring := Fx.Spring.new(1.0, 220.0, 14.0)

var _keys := PackedInt64Array()
var _objs: Array = []
var _kinds := PackedInt32Array()
var _cull := Rect2()
var _vx0 := 0.0
var _vy0 := 0.0
var _vx1 := 0.0
var _vy1 := 0.0
var _vis_enemies: Array = []
var _enemy_cache: Dictionary = {}
var _enemy_type_cache: Dictionary = {}
var _pk_cache: Dictionary = {}
var _lamp_cache_seg := -999
var _lamp_pos_cache := PackedVector2Array()
var _poi_labels: Array = []

var b_lamps := TriBatch.new(32)
var b_teles := TriBatch.new(64)
var b_pick := {"soul": TriBatch.new(256), "coin": TriBatch.new(128), "oil": TriBatch.new(32), "chest": TriBatch.new(16)}
var b_talisman := TriBatch.new(256)
var b_ghostfire := TriBatch.new(128)
var b_sword := TriBatch.new(64)
var b_flame := TriBatch.new(64)
var b_digits := TriBatch.new(128)
var b_glow_ground := TriBatch.new(128)
var b_glow_fx := TriBatch.new(256)
var b_ring_fx := TriBatch.new(128)
var b_ghosts := TriBatch.new(32)
var b_white_fx := TriBatch.new(128)
var b_world_white := TriBatch.new(256)
var b_bg := TriBatch.new(32)
var b_flash := TriBatch.new(128)
var b_fxs := {}
var _ekeys := PackedInt64Array()
var _eobjs: Array = []


func setup(p_sim: Sim) -> void:
	sim = p_sim
	font = UI.font()
	for n in ["hero_run", "enemy_atlas", "proj_talisman", "proj_flame",
			"proj_ghostfire", "proj_sword", "fx_thunder", "fx_boom", "drop_soul", "drop_coin", "drop_oil", "drop_chest", "field_lantern", "rift_portal", "merchant"]:
		T[n] = load("res://assets/%s.png" % n)
	# 启动时预加载战斗贴图（Boss / 小 Boss / 葫芦娃 / 全部场地背景），消除战斗中同步 load() 卡顿
	T["boss_idle"] = load("res://assets/anim/boss_idle.png")
	for cn in PRELOAD_COMBAT:
		T[cn] = load("res://assets/%s.png" % cn)
	for bn in PRELOAD_BGS:
		T[bn] = load("res://assets/%s.jpg" % bn)
	for opt_n in OPT_ASSETS:
		var opt_path := "res://assets/%s.png" % opt_n
		T[opt_n] = load(opt_path) if ResourceLoader.exists(opt_path) else null
	for k in SHEETS:
		T[k] = load(SHEETS[k].tex)
	for pk in PICKUP_KINDS:
		var ptx: Texture2D = T[PICKUP_TEX[pk]]
		_pk_cache[pk] = [b_pick[pk], float(ptx.get_width()), float(ptx.get_height()), {"soul": 0.42, "coin": 0.42, "oil": 0.62, "chest": 0.75}[pk]]
	T.glow = Fx.glow()
	T.ring = Fx.ring_tex()
	T.digits = Fx.digit_strip_tex()
	var wi := Image.create(2, 2, false, Image.FORMAT_RGBA8)
	wi.fill(Color.WHITE)
	T.white = ImageTexture.create_from_image(wi)
	var ar: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/enemy_atlas.json"))
	var aw := float(T.enemy_atlas.get_width())
	var ah := float(T.enemy_atlas.get_height())
	for k in ar:
		var r: Array = ar[k]
		_enemy_cache[k] = [T.enemy_atlas, Rect2(r[0], r[1], r[2], r[3]), float(r[2]), float(r[3]), 1.0, Rect2(r[0] / aw, r[1] / ah, r[2] / aw, r[3] / ah), float(GameData.ANCH.get(k, 0.5)), float(r[2]) / float(r[3])]
	# 预缓存每种普通怪的扁平 PackedFloat32Array：[u0, v0, du, dv, anchor_x, aspect, def_h, is_hop, u1]
	for et in GameData.EN:
		var ed: Dictionary = GameData.EN[et]
		var txk := String(ed.get("tex", ""))
		if not _enemy_cache.has(txk):
			if _enemy_cache.has(et):
				txk = String(et)
			elif _enemy_cache.has("enemy_" + String(et)):
				txk = "enemy_" + String(et)
		if _enemy_cache.has(txk):
			var info: Array = _enemy_cache[txk]
			var uv: Rect2 = info[5]
			_enemy_type_cache[et] = PackedFloat32Array([
				uv.position.x, uv.position.y, uv.size.x, uv.size.y,
				float(info[6]), float(info[7]), float(ed.get("h", 66.0)),
				1.0 if String(ed.get("ai", "")) == "hop" else 0.0,
				uv.position.x + uv.size.x,
			])
	cam = Camera2D.new()
	cam.position_smoothing_enabled = false
	add_child(cam)
	cam.make_current()
	bg_layer = _mk_layer(-5, false, _draw_bg)
	ground_add = _mk_layer(-4, true, _draw_ground_add)
	ground_props = _mk_layer(-3, false, _draw_ground_props)
	var mm_atlas_mat := ShaderMaterial.new()
	mm_atlas_mat.shader = MM_ATLAS_SHADER
	var sh_pair := _mk_mm(-2, T.glow, null, false, _mm_sh_cap, false)
	mm_shadow_node = sh_pair[0]
	mm_shadow = sh_pair[1]
	_mm_sh_rid = mm_shadow.get_rid()
	_mm_sh_buf.resize(_mm_sh_cap * 12)
	var eb_pair := _mk_mm(-1, T.enemy_atlas, mm_atlas_mat, true, _mm_eb_cap, false)
	mm_enemy_back_node = eb_pair[0]
	mm_enemy_back = eb_pair[1]
	_mm_eb_rid = mm_enemy_back.get_rid()
	_mm_eb_buf.resize(_mm_eb_cap * 16)
	var ef_pair := _mk_mm(1, T.enemy_atlas, mm_atlas_mat, true, _mm_ef_cap, false)
	mm_enemy_front_node = ef_pair[0]
	mm_enemy_front = ef_pair[1]
	_mm_ef_rid = mm_enemy_front.get_rid()
	_mm_ef_buf.resize(_mm_ef_cap * 16)
	proj_layer = _mk_layer(2, false, _draw_proj_layer)
	fx_add = _mk_layer(3, true, _draw_fx_add)
	var pt_pair := _mk_mm(3, T.glow, null, false, _mm_pt_cap, true)
	mm_particles_node = pt_pair[0]
	mm_particles = pt_pair[1]
	_mm_pt_rid = mm_particles.get_rid()
	_mm_pt_buf.resize(_mm_pt_cap * 12)
	white_layer = _mk_layer(4, false, _draw_white)
	var mat := ShaderMaterial.new()
	mat.shader = FLASH_SHADER
	white_layer.material = mat
	cam_pos = Vector2(sim.px, sim.py)
	cam.position = cam_pos
	_update_view_bounds()


func _mk_mm(z: int, tex: Texture2D, mat: Material, use_custom: bool, cap: int, additive: bool) -> Array:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_2D
	mm.use_colors = true
	mm.use_custom_data = use_custom
	mm.mesh = Fx.unit_quad()
	mm.custom_aabb = AABB(Vector3(-1000.0, -1000.0, -10.0), Vector3(Sim.W + 2000.0, Sim.H + 2000.0, 20.0))
	mm.instance_count = cap
	mm.visible_instance_count = 0
	var node := MultiMeshInstance2D.new()
	node.multimesh = mm
	node.texture = tex
	node.z_index = z
	if mat != null:
		node.material = mat
	elif additive:
		var am := CanvasItemMaterial.new()
		am.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		node.material = am
	add_child(node)
	return [node, mm]


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


func _sim_float(prop: String, fallback: float) -> float:
	var v: Variant = sim.get(prop)
	return float(v) if v != null else fallback


func _sim_int(prop: String, fallback: int) -> int:
	var v: Variant = sim.get(prop)
	return int(v) if v != null else fallback


func _swap_remove(arr: Array, idx: int) -> void:
	var last := arr.size() - 1
	if idx < last:
		arr[idx] = arr[last]
	arr.resize(last)


func _update_view_bounds() -> void:
	var vis := get_viewport_rect().size / maxf(0.01, cam.zoom.x)
	var half := vis * 0.5
	_cull = Rect2(cam.position - half, vis)
	_vx0 = _cull.position.x - 72.0
	_vy0 = _cull.position.y - 72.0
	_vx1 = _cull.end.x + 72.0
	_vy1 = _cull.end.y + 110.0


func _in_view(x: float, y: float) -> bool:
	return x >= _vx0 and x <= _vx1 and y >= _vy0 and y <= _vy1


func _in_view_pad(x: float, y: float, pad: float) -> bool:
	return x >= _vx0 - pad and x <= _vx1 + pad and y >= _vy0 - pad and y <= _vy1 + pad


func _trigger_hit_stop(dur: float) -> void:
	if _hit_stop_cd > 0.0:
		return
	hit_stop = maxf(hit_stop, minf(dur, HIT_STOP_MAX))
	_hit_stop_cd = HIT_STOP_COOLDOWN


# ======================================================================
# 帧更新
# ======================================================================
func tick(delta: float) -> void:
	t_anim += delta
	if _hit_stop_cd > 0.0:
		_hit_stop_cd = maxf(0.0, _hit_stop_cd - delta)
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
	cam.position = c
	var zt := 1.0
	if sim.over and not sim.victory:
		zoom_t = minf(zoom_t + delta, 1.1)
		zt = 1.0 + 0.25 * (zoom_t / 1.1)
	else:
		zoom_t = 0.0
	cam.zoom = Vector2(zt, zt)
	_update_view_bounds()
	_consume_events()
	player_spring.step(delta)
	lantern_spring.step(delta)
	if _local_flare_wave > 0.0:
		_local_flare_wave = maxf(0.0, _local_flare_wave - delta)
	# SNKRX 创伤平方震屏：兼容 sim.shake_trauma 与传统 _shake()
	var sim_tr := _sim_float("shake_trauma", 0.0)
	if sim_tr > trauma:
		trauma = clampf(sim_tr, 0.0, 1.0)
	if shake_t > 0.0:
		shake_t -= delta
	var off := Vector2.ZERO
	if trauma > 0.001:
		var mag := trauma * trauma * 24.0
		off = Vector2(
			sin(t_anim * 71.0) * 0.6 + (randf() - 0.5) * 0.8,
			cos(t_anim * 83.0) * 0.6 + (randf() - 0.5) * 0.8
		) * mag
		trauma = maxf(0.0, trauma - delta * 1.85)
	elif shake_t > 0.0:
		off = Vector2(randf() - 0.5, randf() - 0.5) * 2.0 * shake_amp * 1280.0
	cam.offset = off
	# 粒子 / 飘字 / 圆环 / 残影 / 闪电（O(1) 交换删除）
	part_pool.tick(delta)
	for i in range(floaters.size() - 1, -1, -1):
		var f: Dictionary = floaters[i]
		f.life -= delta
		f.y -= 46.0 * delta
		if f.life <= 0.0:
			_swap_remove(floaters, i)
	for i in range(rings.size() - 1, -1, -1):
		rings[i].life -= delta
		if rings[i].life <= 0.0:
			_swap_remove(rings, i)
	for i in range(fx_sprites.size() - 1, -1, -1):
		fx_sprites[i].life -= delta
		if fx_sprites[i].life <= 0.0:
			_swap_remove(fx_sprites, i)
	for i in range(ghosts.size() - 1, -1, -1):
		ghosts[i].life -= delta
		if ghosts[i].life <= 0.0:
			_swap_remove(ghosts, i)
	for i in range(sim.bolts.size() - 1, -1, -1):
		sim.bolts[i].life -= delta
		if sim.bolts[i].life <= 0.0:
			_swap_remove(sim.bolts, i)
	if sim.dash_t > 0.0:
		ghost_t -= delta
		if ghost_t <= 0.0:
			ghost_t = 0.03
			if ghosts.size() >= 32:
				_swap_remove(ghosts, 0)
			ghosts.append({"x": sim.px, "y": sim.py, "fr": _player_frame(), "flip": sim.face_x < 0, "life": 0.32})
	if fade > 0.0:
		fade = maxf(0.0, fade - delta * 1.6)
	var phase_changed := sim.phase != last_phase or sim.seg != last_seg
	if phase_changed:
		if last_phase != -1:
			fade = 1.0
			if sim.phase == Sim.PH_RIFT or last_phase == Sim.PH_RIFT:
				cam_pos = Vector2(sim.px, sim.py - 30.0)
		last_phase = sim.phase
		last_seg = sim.seg
	# 暂停/弹窗期间（delta == 0 且无转场/震屏）跳过重绘，降低空转 GPU/CPU 消耗
	if delta > 0.0 or phase_changed or fade > 0.0 or trauma > 0.001:
		queue_redraw()
		bg_layer.queue_redraw()
		ground_add.queue_redraw()
		ground_props.queue_redraw()
		proj_layer.queue_redraw()
		fx_add.queue_redraw()
		white_layer.queue_redraw()


func _shake(ms: float, amp: float) -> void:
	var add_tr := clampf(amp * 95.0, 0.12, 0.85)
	trauma = clampf(maxf(trauma, add_tr), 0.0, 1.0)
	if shake_t > 0.0 and shake_amp > amp:
		return
	shake_t = ms / 1000.0
	shake_amp = amp


func burst(x: float, y: float, n: int, col: Color, speed: float = 220.0, size: float = 0.4, life: float = 0.5, grav: float = 0.0) -> void:
	if low_perf:
		n = int(n * 0.5)
	part_pool.burst(x, y, n, col, speed, size, life, grav)


func ring(x: float, y: float, r: float, col: Color) -> void:
	if rings.size() >= 64:
		_swap_remove(rings, 0)
	rings.append({"x": x, "y": y, "r": r, "life": 0.38, "max": 0.38, "col": col})


func _push_fx_sprite(d: Dictionary) -> void:
	if fx_sprites.size() >= 80:
		_swap_remove(fx_sprites, 0)
	fx_sprites.append(d)


func _float(x: float, y: float, text: String, col: Color, size: int = 22) -> Dictionary:
	var is_num := Fx.is_digit_str(text)
	if not is_num:
		var text_cnt := 0
		var oldest_idx := -1
		var oldest_t := 1e18
		for i in range(floaters.size()):
			var fl: Dictionary = floaters[i]
			if not bool(fl.get("is_num", false)):
				text_cnt += 1
				var ft := float(fl.get("t0", 0.0))
				if ft < oldest_t:
					oldest_t = ft
					oldest_idx = i
		if text_cnt >= MAX_TEXT_FLOATERS and oldest_idx >= 0:
			_swap_remove(floaters, oldest_idx)
	if floaters.size() > 44:
		_swap_remove(floaters, 0)
	var f := {"x": x, "y": y, "text": text, "col": col, "size": size, "life": 0.85, "t0": t_anim, "amt": 0.0, "is_num": is_num}
	floaters.append(f)
	return f


func _on_dmg(e: SimEnemy, d: float, crit: bool, synergy: bool) -> void:
	var f: Variant = _fl_by_uid.get(e.uid)
	if f != null and float(f.life) > 0.0 and t_anim - float(f.t0) < FL_MERGE:
		f.amt = float(f.amt) + d
		f.crit = bool(f.get("crit", false)) or crit
		f.text = ("%d!" % int(f.amt)) if f.crit else str(int(f.amt))
		if crit:
			f.col = Color("ffc977")
			f.size = 32
		return
	var col := Color("ffc977") if crit else (Color("c9a6ff") if synergy else Color.WHITE)
	if not crit and e.ail_kinds >= 2:
		col = Color("e6c8ff")
	var nf := _float(e.x + (randf() - 0.5) * 20.0, e.y - e.h * 0.75, ("%d!" % int(d)) if crit else str(int(d)), col, 32 if crit else 22)
	nf.amt = d
	nf.crit = crit
	_fl_by_uid[e.uid] = nf
	if _fl_by_uid.size() > 96:
		_fl_by_uid.clear()
	if crit:
		Audio.play("crit")
	else:
		Audio.play("hit", 0.7)
	burst(e.x, e.y - e.h * 0.5, 2, Color("ffe9a8"), 160.0, 0.25, 0.3)


func _on_react(id: String, x: float, y: float) -> void:
	var fx: Array = REACT_FX.get(id, [])
	if fx.is_empty():
		return
	var col := Color(String(fx[1]))
	ring(x, y, float(fx[2]), col)
	if t_anim - float(_react_t.get(id, -9.0)) < 0.3:
		return
	_react_t[id] = t_anim
	_float(x, y - 24.0, String(fx[0]), col, 26)
	if id == "leihuo" or id == "collapse":
		burst(x, y, 12, col, 300.0, 0.45, 0.5)
		Audio.play("boom", 0.7)
		_shake(120, 0.003)


func _consume_events() -> void:
	var streak := _sim_int("kill_streak", 0)
	for ev in sim.events:
		match ev[0]:
			"dmg":
				var e_dmg: SimEnemy = ev[1]
				if not _in_view(e_dmg.x, e_dmg.y):
					continue
				_on_dmg(e_dmg, ev[2], ev[3], ev[4])
			"react":
				var rx := float(ev[2])
				var ry := float(ev[3])
				if not _in_view(rx, ry):
					continue
				_on_react(String(ev[1]), rx, ry)
			"kill":
				var e2: SimEnemy = ev[1]
				var big := e2.boss or e2.elite
				if not _in_view(e2.x, e2.y):
					if e2.boss:
						Audio.play("boom")
					continue
				var fxn: String = e2.def.get("fx", "spark")
				var col := Color("f3e6c8") if fxn == "paper" else (Color("7fe3ff") if fxn == "wisp" else Color("ffa040"))
				burst(e2.x, e2.y - e2.h * 0.45, 40 if big else 9, col, 300.0 if big else 220.0, 0.5, 0.7, 260.0 if fxn == "paper" else 0.0)
				Audio.play_kill(streak, 0.8)
				lantern_spring.impulse(0.6)
				if big:
					_trigger_hit_stop(0.035)
					_shake(400, 0.006)
					burst(e2.x, e2.y - 60.0, 50, Color("ffd36a"), 420.0, 0.6, 0.9)
					_push_fx_sprite({"tex": "fx_boom", "x": e2.x, "y": e2.y - 40.0, "life": 0.5, "max": 0.5, "scale": 1.6})
					Audio.play("boom")
			"hurt":
				_shake(160, 0.004)
				player_spring.impulse(-3.2)
				Audio.play("hurt")
				_float(sim.px, sim.py - 80.0, "-%d" % int(ev[1]), Color("ff6a5a"), 26)
			"debuff":
				var dk := String(ev[1])
				if dk == "slow":
					ring(sim.px, sim.py - 16.0, 52.0, Color(0.45, 0.92, 1.0))
					_float(sim.px, sim.py - 96.0, "寒滞减速!", Color(0.45, 0.92, 1.0), 22)
				elif dk == "wound":
					ring(sim.px, sim.py - 16.0, 56.0, Color(0.85, 0.18, 0.48))
					_float(sim.px, sim.py - 96.0, "重伤禁疗!", Color(1.0, 0.48, 0.72), 22)
			"dash":
				Audio.play("dash")
				_shake(90, 0.002)
				player_spring.impulse(2.6)
				ring(sim.px, sim.py - 6.0, 46.0, Color("7fe3ff"))
			"perfect_dash":
				Audio.play_perfect_dash()
				player_spring.impulse(3.2)
				lantern_spring.impulse(2.8)
				ring(sim.px, sim.py - 20.0, 110.0, Color("7fe3ff"))
				_float(sim.px, sim.py - 92.0, "擦弹!", Color("7fe3ff"), 26)
			"flare":
				Audio.play_flare()
				_trigger_hit_stop(0.035)
				_local_flare_wave = 0.55
				_shake(260, 0.0075)
				player_spring.impulse(3.4)
				lantern_spring.impulse(4.8)
				part_pool.burst_flare(sim.px, sim.py - 30.0, 48 if not low_perf else 24)
				ring(sim.px, sim.py - 30.0, 320.0, Color("ffd36a"))
				_float(sim.px, sim.py - 104.0, "挑灯爆焰!", Color("ffd36a"), 26)
			"shock":
				var shx := float(ev[1])
				var shy := float(ev[2])
				if not _in_view(shx, shy):
					continue
				ring(shx, shy, ev[3], Color("ff7a6a"))
				_push_fx_sprite({"tex": "fx_boom", "x": shx, "y": shy - 10.0, "life": 0.45, "max": 0.45, "scale": ev[3] / 140.0})
				Audio.play("boom", 0.8)
				_shake(200, 0.005)
			"sweep":
				var sx: float = ev[1]
				var sy: float = ev[2]
				var sw2: float = ev[3]
				var sh2: float = ev[4]
				for gx in range(4):
					for gy in range(4):
						_push_fx_sprite({"tex": "fx_boom", "x": sx - sw2 * 0.5 + sw2 * (gx + 0.5) / 4.0, "y": sy - sh2 * 0.5 + sh2 * (gy + 0.5) / 4.0, "life": 0.5, "max": 0.5, "scale": 1.3})
				Audio.play("boom")
				_shake(320, 0.007)
			"boom":
				var bmx := float(ev[1])
				var bmy := float(ev[2])
				if not _in_view(bmx, bmy):
					continue
				_push_fx_sprite({"tex": "fx_boom", "x": bmx, "y": bmy, "life": 0.45, "max": 0.45, "scale": 0.85})
				Audio.play("boom")
				_shake(180, 0.005)
			"ring":
				var rgx := float(ev[1])
				var rgy := float(ev[2])
				if not _in_view(rgx, rgy):
					continue
				ring(rgx, rgy, ev[3], Color("ffd36a"))
				Audio.play("shoot", 0.8)
			"thunder":
				var thx := float(ev[1])
				var thy := float(ev[2])
				if not _in_view(thx, thy):
					continue
				_push_fx_sprite({"tex": "fx_thunder", "x": thx, "y": thy + 6.0, "life": 0.26, "max": 0.26, "scale": 0.95, "thunder": true})
				burst(thx, thy, 6, Color("7fe3ff"), 200.0, 0.35, 0.4)
				Audio.play("thunder", 0.7)
				_shake(70, 0.0015)
			"sfx":
				Audio.play(ev[1])
			"banner":
				if banner_cb.is_valid():
					banner_cb.call(ev[1], ev[2])
			"pickup":
				Audio.play("pickup", 0.6)
				lantern_spring.impulse(0.35)
			"heal":
				Audio.play("heal")
				_float(sim.px, sim.py - 90.0, "+%d" % int(ev[1]), Color("7dff9a"), 24)
				burst(sim.px, sim.py - 40.0, 8, Color("7dff9a"), 160.0, 0.3, 0.5)
			"levelup":
				Audio.play("levelup")
				player_spring.impulse(2.8)
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
				_trigger_hit_stop(0.035)
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
func _bg_tex() -> Texture2D:
	var key: String = "field_rift" if sim.phase == Sim.PH_RIFT else String(sim.seg_theme(sim.seg).field)
	if not T.has(key):
		T[key] = load("res://assets/%s.jpg" % key)
	return T[key]


func _draw_bg(c: Node2D) -> void:
	var tint := Color(0.82, 0.76, 0.95)
	if sim.phase != Sim.PH_RIFT:
		var tt: Array = sim.seg_theme(sim.seg).tint
		tint = Color(tt[0], tt[1], tt[2])
	else:
		tint = Color(0.9, 0.82, 1.0)
	tint = tint.lerp(Color(0.23, 0.16, 0.36), 0.16)
	var bt := _bg_tex()
	var tw := float(bt.get_width())
	var th := float(bt.get_height())
	var tx_n := int(ceil(Sim.W / tw))
	var ty_n := int(ceil(Sim.H / th))
	for iy in range(ty_n):
		for ix in range(tx_n):
			var trc := Rect2(ix * tw, iy * th, tw, th)
			if _cull.size.x > 0.0 and not trc.intersects(_cull.grow(120.0)):
				continue
			var u0 := 1.0 if ix % 2 == 1 else 0.0
			var v0 := 1.0 if iy % 2 == 1 else 0.0
			b_bg.rect(trc.position.x, trc.position.y, tw, th, u0, v0, 1.0 - u0, 1.0 - v0, tint)
	b_bg.flush(c.get_canvas_item(), bt)
	if sim.phase == Sim.PH_RIFT:
		var cc := Vector2(Sim.W / 2.0, Sim.H / 2.0)
		var R: float = GameData.DG.rift.arenaRadius
		c.draw_arc(cc, R + 14.0, 0, TAU, 96, Color(0.8, 0.3, 0.9, 0.5), 8.0, true)
		c.draw_arc(cc, R + 14.0, 0, TAU, 96, Color(1.0, 0.8, 0.5, 0.35), 2.0, true)


func _lamp_positions() -> PackedVector2Array:
	if _lamp_cache_seg != sim.seg:
		_lamp_cache_seg = sim.seg
		var lamps: Array = sim.seg_theme(sim.seg).lamps
		_lamp_pos_cache.resize(lamps.size())
		var cc := Vector2(Sim.W / 2.0, Sim.H / 2.0)
		for i in range(lamps.size()):
			var lp: Array = lamps[i]
			_lamp_pos_cache[i] = cc + Vector2(float(lp[0]), float(lp[1]))
	return _lamp_pos_cache


func _lamps_lit() -> bool:
	return sim.phase == Sim.PH_SEG or sim.phase == Sim.PH_BOSS


func _draw_ground_add(c: Node2D) -> void:
	var t_fx := Time.get_ticks_usec()
	defer__draw_ground_add(c)
	PerfStat.add("ground_add_draw", t_fx)


func defer__draw_ground_add(c: Node2D) -> void:
	var g: Texture2D = T.glow
	# 主角脚下动态灯油光晕：盛灯(>70%)暖金扩域，残灯(<30%)赤红收缩心跳，爆焰期(flare_t>0)耀金增幅
	var oil := clampf(_sim_float("lantern_oil", 100.0), 0.0, 100.0)
	var flare_t := _sim_float("flare_t", 0.0)
	var sp := clampf(lantern_spring.x, 0.85, 1.3)
	var rad_mul := 1.0
	var lit := 0.26 + sin(t_anim * 3.1) * 0.03
	var lcol := Color(1.0, 0.66, 0.31, lit)
	if flare_t > 0.0:
		rad_mul = 1.35 * sp
		lcol = Color(1.0, 0.84, 0.42, clampf(lit * 1.45, 0.0, 0.6))
	elif oil > 70.0:
		var k_hi := (oil - 70.0) / 30.0
		rad_mul = (1.0 + 0.18 * k_hi) * sp
		lcol = Color(1.0, 0.66 + 0.12 * k_hi, 0.31 + 0.07 * k_hi, lit * (1.0 + 0.2 * k_hi))
	elif oil < 30.0:
		var k_lo := oil / 30.0
		var beat := sin(t_anim * 10.5) * 0.06
		rad_mul = (0.58 + 0.42 * k_lo + beat) * sp
		lcol = Color(1.0, 0.3 + 0.36 * k_lo, 0.18 + 0.13 * k_lo, maxf(0.14, lit * (0.95 + beat * 2.0)))
	else:
		rad_mul = sp
	var lw := 540.0 * rad_mul
	var lh := 440.0 * rad_mul
	b_glow_ground.full(sim.px - lw * 0.5, sim.py - 20.0 - lh * 0.5, lw, lh, lcol)
	# 骨灯光池
	if _lamps_lit():
		for lp in _lamp_positions():
			if not _in_view_pad(lp.x, lp.y, 190.0):
				continue
			var fl := 0.34 + sin(t_anim * 2.4 + lp.x) * 0.06
			b_glow_ground.full(lp.x - 190.0, lp.y - 120.0, 380.0, 240.0, Color(1.0, 0.6, 0.24, fl))
	# 火路
	for tr in sim.trails:
		var trx: float = tr.x
		var try: float = tr.y
		if trx < _vx0 or trx > _vx1 or try < _vy0 or try > _vy1:
			continue
		var a: float = clampf(tr.life / 1.4, 0.0, 1.0)
		b_glow_ground.full(trx - 34.0, try - 34.0, 68.0, 68.0, Color(1.0, 0.5, 0.15, 0.7 * a))
	# 大地图 POI 地面光池（全部在 ground_add 统一合批，彻底消除跨层 b_glow_ground 泄漏）
	if sim.phase == Sim.PH_SEG:
		for i in range(sim.pois.size()):
			var poi: Dictionary = sim.pois[i]
			var px2 := float(poi.x)
			var py2 := float(poi.y)
			if _cull.size.x > 0.0 and not _visible(px2, py2, 300.0):
				continue
			var pk: String = poi.kind
			if pk == "vine":
				if not sim.vine_taken.has(i):
					b_glow_ground.full(px2 - 110.0, py2 - 110.0, 220.0, 220.0, Color(0.3, 1.0, 0.5, 0.45))
			elif Sim.LM_KINDS.has(pk):
				var lst := sim.lm_state(i)
				b_glow_ground.full(px2 - 150.0, py2 - 110.0, 300.0, 220.0, Color(0.5, 0.8, 1.0, 0.35 if lst == "ok" else 0.12))
			elif pk != "merchant":
				var st := sim.poi_state(i)
				b_glow_ground.full(px2 - 200.0, py2 - 260.0, 400.0, 300.0, Color(0.7, 0.3, 1.0, 0.45 if st == "ok" else 0.15))
		# 荒野互动目标（破庙灯龛 / 镇魂断碑）地面光晕（合批进 b_glow_ground）
		for obj in sim.objectives:
			if not (obj is Dictionary) or bool(obj.get("done", false)):
				continue
			var ox := float(obj.x)
			var oy := float(obj.y)
			if _cull.size.x > 0.0 and not _visible(ox, oy, 300.0):
				continue
			var is_lamp := String(obj.get("kind", "")) == "shrine_lamp"
			var opulse := 0.44 + sin(t_anim * 3.4 + ox * 0.01) * 0.10
			var ocol := Color(1.0, 0.72, 0.25, opulse) if is_lamp else Color(0.42, 0.88, 1.0, opulse)
			b_glow_ground.full(ox - 165.0, oy - 125.0, 330.0, 250.0, ocol)
	# 段间：裂隙与游商的光
	if sim.phase == Sim.PH_BREAK:
		var rp := sim.break_pos("rift")
		var pulse := 0.5 + sin(t_anim * 3.0) * 0.12
		b_glow_ground.full(rp.x - 260.0, rp.y - 200.0, 520.0, 400.0, Color(0.75, 0.3, 1.0, pulse))
		b_glow_ground.full(rp.x - 90.0, rp.y - 900.0, 180.0, 960.0, Color(0.7, 0.3, 1.0, 0.55 if sim.rift_state() == "ok" else 0.2))
		var mp := sim.break_pos("merchant")
		b_glow_ground.full(mp.x - 160.0, mp.y - 110.0, 320.0, 220.0, Color(1.0, 0.7, 0.3, 0.45))
		var gp := sim.break_pos("gate")
		b_glow_ground.full(gp.x - 120.0, gp.y - 330.0, 240.0, 420.0, Color(1.0, 0.85, 0.5, 0.45 + sin(t_anim * 2.2) * 0.08))
	b_glow_ground.flush(c.get_canvas_item(), g)


func _player_frame() -> int:
	if sim.moving or sim.dash_t > 0.0:
		return int(t_anim * 12.0) % 12
	return 0


func _visible(x: float, y: float, margin: float) -> bool:
	return x >= _cull.position.x - margin and x <= _cull.end.x + margin and y >= _cull.position.y - margin and y <= _cull.end.y + margin + 80.0


func _push(y: float, kind: int, obj: Variant) -> void:
	_keys.append((int(y * 4.0) + 40000) << 20 | _objs.size())
	_objs.append(obj)
	_kinds.append(kind)


func _is_special(e: SimEnemy) -> bool:
	return e.boss or e.elite or e.warden or e.ai == "swordlord" or e.ai == "sedan" or e.ai == "lamps"


func _push_shadow(x: float, y: float, w: float, h: float, alpha: float) -> void:
	if _mm_sh_n >= _mm_sh_cap:
		if _mm_sh_cap >= MM_MAX_CAP:
			return
		_mm_sh_cap = mini(MM_MAX_CAP, _mm_sh_cap * 2)
		mm_shadow.instance_count = _mm_sh_cap
		_mm_sh_buf.resize(_mm_sh_cap * 12)
		_mm_sh_idle = 0
	var o := _mm_sh_n * 12
	_mm_sh_buf[o] = w
	_mm_sh_buf[o + 3] = x
	_mm_sh_buf[o + 5] = h
	_mm_sh_buf[o + 7] = y
	_mm_sh_buf[o + 11] = alpha
	_mm_sh_n += 1


func _get_enemy_info(e: SimEnemy) -> PackedFloat32Array:
	var cached: Variant = _enemy_type_cache.get(e.type)
	if cached != null:
		return cached
	var d: Dictionary = e.def
	var txk := String(d.get("tex", ""))
	if not _enemy_cache.has(txk):
		if _enemy_cache.has(e.type):
			txk = e.type
		elif _enemy_cache.has("enemy_" + e.type):
			txk = "enemy_" + e.type
	var info: Array = _enemy_cache[txk]
	var uv: Rect2 = info[5]
	var arr := PackedFloat32Array([
		uv.position.x, uv.position.y, uv.size.x, uv.size.y,
		float(info[6]), float(info[7]), float(d.h),
		1.0 if e.ai == "hop" else 0.0,
		uv.position.x + uv.size.x,
	])
	_enemy_type_cache[e.type] = arr
	return arr


func _draw() -> void:
	var t_draw := Time.get_ticks_usec()
	if _cull.size.x <= 0.0:
		_update_view_bounds()
	if _mm_sh_cap > MM_BASE_CAP and _mm_sh_idle >= MM_SHRINK_IDLE_FRAMES:
		_mm_sh_cap = maxi(MM_BASE_CAP, _mm_sh_cap >> 1)
		mm_shadow.instance_count = _mm_sh_cap
		_mm_sh_buf.resize(_mm_sh_cap * 12)
		_mm_sh_idle = 0
	if _mm_eb_cap > MM_BASE_CAP and _mm_eb_idle >= MM_SHRINK_IDLE_FRAMES:
		_mm_eb_cap = maxi(MM_BASE_CAP, _mm_eb_cap >> 1)
		mm_enemy_back.instance_count = _mm_eb_cap
		_mm_eb_buf.resize(_mm_eb_cap * 16)
		_mm_eb_idle = 0
	if _mm_ef_cap > MM_BASE_CAP and _mm_ef_idle >= MM_SHRINK_IDLE_FRAMES:
		_mm_ef_cap = maxi(MM_BASE_CAP, _mm_ef_cap >> 1)
		mm_enemy_front.instance_count = _mm_ef_cap
		_mm_ef_buf.resize(_mm_ef_cap * 16)
		_mm_ef_idle = 0
	_keys.resize(0)
	_ekeys.resize(0)
	_eobjs.clear()
	_vis_enemies.clear()
	_objs.clear()
	_kinds.resize(0)
	_poi_labels.clear()
	_mm_sh_n = 0
	_mm_eb_n = 0
	_mm_ef_n = 0
	var t_s := Time.get_ticks_usec()
	_push_shadow(sim.px - 28.0, sim.py - 7.0, 56.0, 14.0, 0.4)
	if sim.pet_on and sim.pet_dead_t <= 0.0:
		_push_shadow(sim.pet_pos.x - 28.0, sim.pet_pos.y + 8.0, 56.0, 14.0, 0.42)
	if sim.phase == Sim.PH_BREAK:
		var mp_sh := sim.break_pos("merchant")
		_push_shadow(mp_sh.x - 44.0, mp_sh.y - 10.0, 88.0, 20.0, 0.4)
	var vx0 := _vx0
	var vx1 := _vx1
	var vy0 := _vy0
	var vy1 := _vy1
	for e: SimEnemy in sim.enemies:
		var ex := e.x
		var ey := e.y
		var vis_e := ex >= vx0 and ex <= vx1 and ey >= vy0 and ey <= vy1
		if not vis_e and e.boss:
			vis_e = ex >= vx0 - 120.0 and ex <= vx1 + 120.0 and ey >= vy0 - 120.0 and ey <= vy1 + 120.0
		if vis_e:
			if e.boss or e.elite or e.warden or e.ai == "swordlord" or e.ai == "sedan" or e.ai == "lamps":
				var er := e.r
				_push_shadow(ex - er * 1.3, ey - er * 0.3, er * 2.6, er * 0.6, 0.4)
				_push(ey, 1, e)
				_vis_enemies.append(e)
			else:
				_ekeys.append((int(ey * 4.0) + 40000) << 20 | _eobjs.size())
				_eobjs.append(e)
	var skip_fodder_sh := (_eobjs.size() + _vis_enemies.size()) > 120
	for e_norm: SimEnemy in _eobjs:
		if skip_fodder_sh and (e_norm.type == "paperman" or e_norm.type == "foxfire"):
			continue
		var er := e_norm.r
		_push_shadow(e_norm.x - er * 1.3, e_norm.y - er * 0.3, er * 2.6, er * 0.6, 0.4)
	_push(sim.py, 2, null)
	if sim.phase == Sim.PH_SEG:
		for i in range(sim.pois.size()):
			var poi_x := float(sim.pois[i].x)
			var poi_y := float(sim.pois[i].y)
			if _visible(poi_x, poi_y, 260.0):
				var pkind := String(sim.pois[i].kind)
				if (pkind == "vine" and not sim.vine_taken.has(i)) or Sim.LM_KINDS.has(pkind):
					_push_shadow(poi_x - 52.0, poi_y - 12.0, 104.0, 24.0, 0.4)
				_push(poi_y, 5, i)
		for obj in sim.objectives:
			if not (obj is Dictionary) or bool(obj.get("done", false)):
				continue
			var ox := float(obj.x)
			var oy := float(obj.y)
			if _visible(ox, oy, 260.0):
				_push_shadow(ox - 52.0, oy - 12.0, 104.0, 24.0, 0.4)
				_push(oy, 6, obj)
	if sim.phase == Sim.PH_BREAK:
		_push(sim.break_pos("rift").y, 4, "rift")
		_push(sim.break_pos("merchant").y, 4, "merchant")
		_push(sim.break_pos("gate").y, 4, "gate")
	if _mm_sh_n > 0:
		RenderingServer.multimesh_set_buffer(_mm_sh_rid, _mm_sh_buf)
	mm_shadow.visible_instance_count = _mm_sh_n
	if _mm_sh_cap > MM_BASE_CAP:
		_mm_sh_idle = (_mm_sh_idle + 1) if _mm_sh_n <= (_mm_sh_cap >> 1) else 0
	PerfStat.add("d_shadow", t_s)
	_keys.sort()
	_ekeys.sort()
	# 普通小怪：直接写入 MultiMeshInstance2D 扁平缓冲（身后 z=-1 / 身前 z=1，各 1 次绘制调用）
	var t_e := Time.get_ticks_usec()
	var py_key := (int(sim.py * 4.0) + 40000)
	for key in _ekeys:
		var ee: SimEnemy = _eobjs[int(key & 0xFFFFF)]
		_batch_enemy_mm(ee, (key >> 20) <= py_key)
	if _mm_eb_n > 0:
		RenderingServer.multimesh_set_buffer(_mm_eb_rid, _mm_eb_buf)
	mm_enemy_back.visible_instance_count = _mm_eb_n
	if _mm_eb_cap > MM_BASE_CAP:
		_mm_eb_idle = (_mm_eb_idle + 1) if _mm_eb_n <= (_mm_eb_cap >> 1) else 0
	if _mm_ef_n > 0:
		RenderingServer.multimesh_set_buffer(_mm_ef_rid, _mm_ef_buf)
	mm_enemy_front.visible_instance_count = _mm_ef_n
	if _mm_ef_cap > MM_BASE_CAP:
		_mm_ef_idle = (_mm_ef_idle + 1) if _mm_ef_n <= (_mm_ef_cap >> 1) else 0
	PerfStat.add("d_enemy", t_e)
	# 主角 / 特殊怪 / 地标 / 荒野目标（z=0，夹在 mm_enemy_back 与 mm_enemy_front 之间）
	for key in _keys:
		var idx := int(key & 0xFFFFF)
		var o: Variant = _objs[idx]
		match _kinds[idx]:
			1: _draw_enemy(o)
			2: _draw_player()
			4: _draw_zone(o)
			5: _draw_poi(o)
			6: _draw_objective(o)
	PerfStat.add("world_draw", t_draw)


func _draw_ground_props(c: Node2D) -> void:
	var t_draw := Time.get_ticks_usec()
	var ci := c.get_canvas_item()
	# 骨灯合批（1 DC）
	var ltx: Texture2D = T.field_lantern
	var lw := float(ltx.get_width())
	var lh := float(ltx.get_height())
	var lcol := Color.WHITE if _lamps_lit() else Color(0.35, 0.36, 0.5)
	for lp in _lamp_positions():
		if _visible(lp.x, lp.y, 200.0):
			b_lamps.full(lp.x - lw * 0.5, lp.y - lh, lw, lh, lcol)
	b_lamps.flush(ci, ltx)
	# 预警圈统一进白图批（1 DC）
	_batch_teles()
	b_teles.flush(ci, T.white)
	# 掉落物：每种贴图一个批
	var t_pk := Time.get_ticks_usec()
	for k: SimPickup in sim.pickups:
		if k.x >= _vx0 and k.x <= _vx1 and k.y >= _vy0 and k.y <= _vy1:
			_batch_pickup(k)
	for kind in PICKUP_KINDS:
		(b_pick[kind] as TriBatch).flush(ci, T[PICKUP_TEX[kind]])
	PerfStat.add("d_pickup", t_pk)
	PerfStat.add("world_draw", t_draw)


func _draw_proj_layer(c: Node2D) -> void:
	var t_draw := Time.get_ticks_usec()
	var ci := c.get_canvas_item()
	# 叠加层：血条 / 符印 / 剑痕 / 异常色点 / POI 环 / 文字底框 → 统一进 b_world_white 一次提交
	for e2: SimEnemy in _vis_enemies:
		if e2.mark_t > 0.0 or e2.marks > 0 or e2.elite or e2.boss or e2.ail_kinds > 0:
			_batch_enemy_overlays(e2)
	var t_p := Time.get_ticks_usec()
	_draw_projectiles(c)
	PerfStat.add("d_proj", t_p)
	b_world_white.flush(ci, T.white)
	# 所有世界文字（POI 标牌 + 位图数字飘字）在所有实体/弹幕之后统一提交
	var t_f := Time.get_ticks_usec()
	_draw_poi_labels(c)
	_draw_floaters(c)
	PerfStat.add("d_float", t_f)
	PerfStat.add("world_draw", t_draw)


func _batch_teles() -> void:
	for tl: SimTele in sim.teles:
		var kind_v: Variant = tl.get("kind")
		var kind := String(kind_v) if kind_v != null else ""
		var k := clampf(tl.t / maxf(0.01, tl.dur), 0.0, 1.0)
		if kind == "blink":
			var br := tl.r if tl.r > 0.0 else 42.0
			if tl.x + br < _vx0 or tl.x - br > _vx1 or tl.y + br < _vy0 or tl.y - br > _vy1:
				continue
			var bcc := Vector2(tl.x, tl.y)
			b_teles.circle(bcc, br * (0.35 + 0.65 * (1.0 - k * 0.5)), Color(0.68, 0.18, 0.88, 0.14 + 0.22 * k), 24)
			b_teles.ring(bcc, br, 2.5, Color(0.82, 0.28, 1.0, 0.55 + 0.3 * k), 24)
			var cr := maxf(6.0, br * (1.15 - 0.93 * k))
			b_teles.ring(bcc, cr, 3.5, Color(1.0, 0.35, 0.92, 0.92), 24)
			var ch := minf(br * 0.42, 18.0)
			b_teles.line(Vector2(tl.x - ch, tl.y), Vector2(tl.x + ch, tl.y), 2.5, Color(1.0, 0.68, 1.0, 0.9))
			b_teles.line(Vector2(tl.x, tl.y - ch), Vector2(tl.x, tl.y + ch), 2.5, Color(1.0, 0.68, 1.0, 0.9))
			b_teles.circle(bcc, 5.0 + 3.0 * k, Color(1.0, 0.82, 1.0, 0.95), 10)
			continue
		if kind == "charge":
			var p0 := Vector2(tl.x, tl.y)
			var p1 := p0
			var tx_v: Variant = tl.get("tx")
			var ty_v: Variant = tl.get("ty")
			if tx_v != null and ty_v != null and (absf(float(tx_v) - tl.x) > 0.5 or absf(float(ty_v) - tl.y) > 0.5):
				p1 = Vector2(float(tx_v), float(ty_v))
			else:
				var ang_v: Variant = tl.get("ang")
				var ang_c := float(ang_v) if ang_v != null else 0.0
				var len_v: Variant = tl.get("length")
				if len_v == null:
					len_v = tl.get("len")
				var clen := float(len_v) if (len_v != null and float(len_v) > 0.0) else (tl.rw if tl.rw > 0.0 else (tl.r if tl.r > 0.0 else 260.0))
				p1 = p0 + Vector2(cos(ang_c), sin(ang_c)) * clen
			var w_v: Variant = tl.get("w")
			var bw := float(w_v) if (w_v != null and float(w_v) > 0.0) else (tl.rh if tl.rh > 0.0 else (tl.r * 2.0 if (tl.r > 0.0 and tl.r <= 80.0) else 42.0))
			var hw := bw * 0.5
			var minx := minf(p0.x, p1.x) - hw
			var maxx := maxf(p0.x, p1.x) + hw
			var miny := minf(p0.y, p1.y) - hw
			var maxy := maxf(p0.y, p1.y) + hw
			if maxx < _vx0 or minx > _vx1 or maxy < _vy0 or miny > _vy1:
				continue
			var dv := p1 - p0
			var dlen := dv.length()
			if dlen < 1.0:
				continue
			var dir := dv / dlen
			var perp := Vector2(-dir.y, dir.x)
			b_teles.line(p0, p1, bw, Color(0.95, 0.24, 0.14, 0.14 + 0.18 * k))
			if k > 0.01:
				b_teles.line(p0, p0.lerp(p1, k), bw * 0.86, Color(1.0, 0.42, 0.18, 0.28 + 0.34 * k))
			var c0 := p0 + perp * hw
			var c1 := p1 + perp * hw
			var c2 := p1 - perp * hw
			var c3 := p0 - perp * hw
			var bcol := Color(1.0, 0.46, 0.24, 0.92)
			b_teles.line(c0, c1, 3.0, bcol)
			b_teles.line(c3, c2, 3.0, bcol)
			b_teles.line(c0, c3, 3.0, bcol)
			b_teles.line(c1, c2, 3.0, bcol)
			b_teles.line(p0, p1, 2.5, Color(1.0, 0.78, 0.52, 0.75))
			var tip_back := p1 - dir * minf(22.0, dlen * 0.35)
			b_teles.line(p1, tip_back + perp * (hw * 0.55), 3.0, Color(1.0, 0.82, 0.55, 0.95))
			b_teles.line(p1, tip_back - perp * (hw * 0.55), 3.0, Color(1.0, 0.82, 0.55, 0.95))
			continue
		if kind == "aoe_big":
			var ar := tl.r if tl.r > 0.0 else 125.0
			if tl.x + ar < _vx0 or tl.x - ar > _vx1 or tl.y + ar < _vy0 or tl.y - ar > _vy1:
				continue
			var acc := Vector2(tl.x, tl.y)
			b_teles.circle(acc, ar, Color(0.82, 0.12, 0.16, 0.10 + 0.14 * k), 36)
			if k > 0.02:
				b_teles.circle(acc, ar * k, Color(1.0, 0.34, 0.18, 0.14 + 0.24 * k), 32)
				b_teles.ring(acc, ar * k, 3.5, Color(1.0, 0.82, 0.36, 0.92), 32)
			b_teles.ring(acc, ar, 4.5, Color(1.0, 0.28, 0.22, 0.92), 36)
			b_teles.ring(acc, ar * 0.88, 2.0, Color(1.0, 0.78, 0.32, 0.58 + 0.28 * k), 32)
			var r_in := ar * 0.84
			var rcol := Color(1.0, 0.76, 0.32, 0.78)
			b_teles.line(Vector2(tl.x - ar, tl.y), Vector2(tl.x - r_in, tl.y), 2.5, rcol)
			b_teles.line(Vector2(tl.x + r_in, tl.y), Vector2(tl.x + ar, tl.y), 2.5, rcol)
			b_teles.line(Vector2(tl.x, tl.y - ar), Vector2(tl.x, tl.y - r_in), 2.5, rcol)
			b_teles.line(Vector2(tl.x, tl.y + r_in), Vector2(tl.x, tl.y + ar), 2.5, rcol)
			continue
		if tl.is_rect():
			var rx := tl.x - tl.rw * 0.5
			var ry := tl.y - tl.rh * 0.5
			if rx + tl.rw < _vx0 or rx > _vx1 or ry + tl.rh < _vy0 or ry > _vy1:
				continue
			b_teles.full(rx, ry, tl.rw, tl.rh, Color(0.95, 0.25, 0.18, 0.10 + 0.22 * k))
			b_teles.rect_frame(rx, ry, tl.rw, tl.rh, 4.0, Color(1.0, 0.45, 0.35, 0.9))
			var inset := minf(tl.rw, tl.rh) * 0.5 * (1.0 - k)
			var iw := tl.rw - inset * 2.0
			var ih := tl.rh - inset * 2.0
			if iw > 0.0 and ih > 0.0:
				b_teles.full(rx + inset, ry + inset, iw, ih, Color(1.0, 0.7, 0.45, 0.22))
			continue
		if tl.r <= 0.0:
			continue
		if tl.x + tl.r < _vx0 or tl.x - tl.r > _vx1 or tl.y + tl.r < _vy0 or tl.y - tl.r > _vy1:
			continue
		var cc := Vector2(tl.x, tl.y)
		b_teles.circle(cc, tl.r, Color(0.88, 0.27, 0.23, 0.12 + 0.18 * k), 28)
		b_teles.ring(cc, tl.r, 3.0, Color(1.0, 0.45, 0.35, 0.8), 28)
		if k > 0.02:
			b_teles.ring(cc, tl.r * k, 2.0, Color(1.0, 0.7, 0.5, 0.7), 24)


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
	var sp := clampf(player_spring.x, 0.82, 1.22)
	var w := fw * sc / sp
	var h := fh * sc * wob * sp
	draw_set_transform(Vector2(sim.px, sim.py), rot, Vector2.ONE)
	var src := Rect2((fr % 6) * fw, (fr / 6) * fh, fw, fh)
	var dst := Anchors.rect(0.0, -h * 0.92, w, h, "hero_run", sim.face_x < 0)
	draw_texture_rect_region(tx, dst, src, col)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	var slow_t := _sim_float("player_slow_t", 0.0)
	var wound_t := _sim_float("player_wound_t", 0.0)
	if slow_t > 0.0 or wound_t > 0.0:
		var aura_c := Vector2(sim.px, sim.py - 10.0)
		if slow_t > 0.0:
			var sr := 34.0 + sin(t_anim * 7.0) * 2.5
			b_world_white.ring(aura_c, sr, 3.0, Color(0.45, 0.92, 1.0, 0.78), 24)
			b_world_white.ring(aura_c, sr - 6.0, 1.5, Color(0.75, 0.98, 1.0, 0.45), 20)
		if wound_t > 0.0:
			b_world_white.ring(aura_c, 36.0, 2.0, Color(0.55, 0.06, 0.24, 0.65), 24)
			var wcol := Color(0.72, 0.10, 0.42, 0.88)
			var teeth := 12
			var step := TAU / float(teeth * 2)
			var rot0 := t_anim * 2.2
			var r_in := 36.0
			var r_out := 46.0 + sin(t_anim * 10.0) * 2.0
			var prev_p := aura_c + Vector2(cos(rot0), sin(rot0)) * r_out
			for ti in range(1, teeth * 2 + 1):
				var ang_t := rot0 + float(ti) * step
				var rad_t := r_out if (ti % 2 == 0) else r_in
				var cur_p := aura_c + Vector2(cos(ang_t), sin(ang_t)) * rad_t
				b_world_white.line(prev_p, cur_p, 2.5, wcol)
				prev_p = cur_p


func _anchor_key(e: SimEnemy) -> String:
	if e.warden:
		return "boss_swordwarden"
	if e.boss:
		return "boss_idle"
	if e.elite and e.type == "jiangshi":
		return "jiangshi_hop"
	return String(e.def.tex)


func _tex(name: String) -> Texture2D:
	if not T.has(name):
		T[name] = load("res://assets/%s.png" % name)
	return T[name]


func _opt_tex(name: String) -> Texture2D:
	if not T.has(name):
		var path := "res://assets/%s.png" % name
		T[name] = load(path) if ResourceLoader.exists(path) else null
	var v: Variant = T[name]
	return v as Texture2D if v is Texture2D else null


func _enemy_tex(e: SimEnemy) -> Array:
	if e.warden:
		var wt: Texture2D = _tex("boss_swordwarden")
		return [wt, null, float(wt.get_width()), float(wt.get_height()), 1.0]
	if e.ai == "swordlord" or e.ai == "sedan" or e.ai == "lamps":
		var mt: Texture2D = _tex(String(e.def.tex))
		return [mt, null, float(mt.get_width()), float(mt.get_height()), 1.0]
	if e.boss:
		var n := int(t_anim * 8.0) % 8
		if not T.has("boss_idle"):
			T.boss_idle = load("res://assets/anim/boss_idle.png")
		return [T.boss_idle, Rect2(n * 118, 0, 118, 192), 118.0, 192.0, 1.05]
	if e.elite and e.type == "jiangshi":
		var ph := fmod(e.hop, 1.0)
		var fr := 0
		if ph < 0.6:
			fr = 1 + mini(5, int(ph / 0.6 * 6.0))
		elif ph < 0.8:
			fr = 7
		return [T.jiangshi_hop, Rect2(fr * 119, 0, 119, 200), 119.0, 200.0, 1.35]
	return _enemy_cache[e.def.tex]


func _batch_enemy_mm(e: SimEnemy, is_back: bool) -> void:
	var ec := _get_enemy_info(e)
	var hh: float = ec[6] * e.scale_mul
	var sq := e.squash
	var wob := 1.0
	var sx := 2.0 - sq
	if ec[7] == 0.0:
		wob = 1.0 + sin(t_anim * 9.0 + e.phase) * 0.05
		sx /= wob
	var w: float = hh * ec[5] * sx
	var h := hh * sq * wob
	var col := Color.WHITE
	var st := e.state
	if st != "move":
		if st == "charge":
			col = Color(1.0, 0.45, 0.45)
		elif st == "fuse":
			col = Color(1.0, 0.3, 0.3) if int(e.timer * 14.0) % 2 == 0 else Color(1.0, 0.85, 0.85)
	if e.warn_t > 0.0:
		col = Color(1.0, 0.45, 0.45)
	elif e.ail_kinds > 0 and st != "fuse" and st != "charge":
		col = _ail_tint(e)
	elif e.burn_t > 0.0 and st != "fuse" and st != "charge":
		col = Color(1.0, 0.78, 0.6)
	var ax: float = ec[4]
	var flip: bool = e.flip
	var px := e.x - ((1.0 - ax) if flip else ax) * w
	var py := e.y - h * 0.95 - e.lift
	var u0 := ec[8] if flip else ec[0]
	var du := -ec[2] if flip else ec[2]
	var v0 := ec[1]
	var dv := ec[3]
	if is_back:
		if _mm_eb_n >= _mm_eb_cap:
			if _mm_eb_cap >= MM_MAX_CAP:
				return
			_mm_eb_cap = mini(MM_MAX_CAP, _mm_eb_cap * 2)
			mm_enemy_back.instance_count = _mm_eb_cap
			_mm_eb_buf.resize(_mm_eb_cap * 16)
			_mm_eb_idle = 0
		var o := _mm_eb_n * 16
		_mm_eb_buf[o] = w
		_mm_eb_buf[o + 3] = px
		_mm_eb_buf[o + 5] = h
		_mm_eb_buf[o + 7] = py
		_mm_eb_buf[o + 8] = col.r
		_mm_eb_buf[o + 9] = col.g
		_mm_eb_buf[o + 10] = col.b
		_mm_eb_buf[o + 11] = col.a
		_mm_eb_buf[o + 12] = u0
		_mm_eb_buf[o + 13] = v0
		_mm_eb_buf[o + 14] = du
		_mm_eb_buf[o + 15] = dv
		_mm_eb_n += 1
	else:
		if _mm_ef_n >= _mm_ef_cap:
			if _mm_ef_cap >= MM_MAX_CAP:
				return
			_mm_ef_cap = mini(MM_MAX_CAP, _mm_ef_cap * 2)
			mm_enemy_front.instance_count = _mm_ef_cap
			_mm_ef_buf.resize(_mm_ef_cap * 16)
			_mm_ef_idle = 0
		var o := _mm_ef_n * 16
		_mm_ef_buf[o] = w
		_mm_ef_buf[o + 3] = px
		_mm_ef_buf[o + 5] = h
		_mm_ef_buf[o + 7] = py
		_mm_ef_buf[o + 8] = col.r
		_mm_ef_buf[o + 9] = col.g
		_mm_ef_buf[o + 10] = col.b
		_mm_ef_buf[o + 11] = col.a
		_mm_ef_buf[o + 12] = u0
		_mm_ef_buf[o + 13] = v0
		_mm_ef_buf[o + 14] = du
		_mm_ef_buf[o + 15] = dv
		_mm_ef_n += 1
	if e.flash > 0.0:
		b_flash.rect(px, py, w, h, u0, v0, u0 + du, v0 + dv, Color(1, 1, 1, 0.8))
	if e.ail_kinds >= 2:
		_ail_pips(e, e.x, py - 6.0)


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
	if e.ail_kinds > 0:
		col = _ail_tint(e)
	elif e.burn_t > 0.0:
		col = Color(1.0, 0.78, 0.6)
	if e.state == "charge" or e.warn_t > 0.0:
		col = Color(1.0, 0.45, 0.45)
	if e.state == "fuse":
		col = Color(1.0, 0.3, 0.3) if int(e.timer * 14.0) % 2 == 0 else Color(1.0, 0.85, 0.85)
	if e.warden and e.stagger_t > 0.0:
		col = Color(1.0, 0.95, 0.5) if int(t_anim * 12.0) % 2 == 0 else Color(1.0, 0.8, 0.3)
	if e.warden:
		_draw_warden_fx(e)
	if e.ai == "sedan" and e.warn_t > 0.0:
		var CS: Dictionary = GameData.MB.sedan
		var o2 := Vector2(e.x, e.y - 20.0)
		b_world_white.line(o2, o2 + e.lunge_dir * float(CS.chargeLen), 50.0, Color(1.0, 0.2, 0.2, 0.6))
	if e.ai == "lamps":
		for li in range(int(GameData.MB.lamps.lamps)):
			var lp := sim.lamp_pos(e, li)
			b_glow_fx.full(lp.x - 36.0, lp.y - 36.0, 72.0, 72.0, Color(0.5, 1.0, 0.6, 0.8))
			b_world_white.circle(lp, 11.0, Color(0.7, 1.0, 0.7), 10)
	var y0 := e.y - h * 0.95 - e.lift
	var dst := Anchors.rect(e.x, y0, w, h, _anchor_key(e), flip)
	if info[1] != null:
		draw_texture_rect_region(tx, dst, info[1], col)
	else:
		draw_texture_rect(tx, dst, false, col)
	if e.flash > 0.0:
		flash_list.append([tx, dst, info[1]])


func _batch_enemy_overlays(e: SimEnemy) -> void:
	if e.mark_t > 0.0:
		var k: float = 1.0 - e.mark_t / float(GameData.EVOS.fu.stats.markDelay)
		var cy := e.y - e.h * 0.45
		var rr := 16.0 + e.r * 0.4
		b_world_white.ring(Vector2(e.x, cy), rr, 2.0, Color(1, 0.83, 0.42, 0.5), 24)
		b_world_white.arc(Vector2(e.x, cy), rr, 4.0, -PI / 2.0, -PI / 2.0 + k * TAU, Color(1, 0.9, 0.66, 0.95), 24)
	if e.marks > 0:
		var cx := e.x - (e.marks - 1) * 6.0
		var py := e.y - e.h - 6.0 - e.lift
		for i in range(e.marks):
			var px := cx + i * 12.0
			b_world_white.line(Vector2(px - 4.0, py + 7.0), Vector2(px + 4.0, py - 7.0), 3.0, Color(0.5, 0.92, 1.0))
	if e.elite or e.boss:
		_batch_bar(e)
	if e.ail_kinds > 0:
		_ail_pips(e, e.x, e.y - e.h - (34.0 if not e.boss else 70.0) - e.lift)


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
			b_sword.rot(bp, tang, sw.get_width() * 0.6, sw.get_height() * 0.6, Color(0.75, 0.55, 1.0))
	if e.warn_t > 0.0:
		var L: Dictionary = C.lunge
		var o := Vector2(e.x, e.y - 20.0)
		var k := 1.0 - e.warn_t / float(L.warn)
		b_world_white.line(o, o + e.lunge_dir * float(L.len), float(L.width) * (0.5 + 0.5 * k), Color(1.0, 0.3, 0.25, 0.25 + 0.45 * k))
		b_world_white.line(o, o + e.lunge_dir * float(L.len), 3.0, Color(1.0, 0.8, 0.7, 0.9))
	if e.stagger_t > 0.0:
		_queue_label(Vector2(e.x - 100.0, e.y - e.h - 40.0), "破绽！承伤+%d%%" % int((float(C.lunge.staggerTakenMul) - 1.0) * 100.0), 200.0, 26, Color(1.0, 0.9, 0.4))


func _batch_bar(e: SimEnemy) -> void:
	if e.boss:
		return
	var w := 90.0
	var x := e.x - w * 0.5
	var y := e.y - e.h - 22.0 - e.lift
	b_world_white.full(x - 2.0, y - 2.0, w + 4.0, 10.0, UI.INK)
	b_world_white.full(x, y, w * clampf(e.hp / maxf(1.0, e.maxhp), 0.0, 1.0), 6.0, Color("ff5a4a") if e.warden else Color("ff9a3c"))


func _batch_pickup(k: SimPickup) -> void:
	var kind: String = k.kind
	var inf: Array = _pk_cache[kind]
	var sc: float = inf[3]
	var col := Color.WHITE
	if kind == "soul":
		var v := k.val
		sc = 0.7 if v >= 25 else (0.6 if v >= 10 else (0.52 if v >= 4 else 0.42))
		if v >= 10:
			col = Color(1.0, 0.83, 0.42)
	var born := (sim.real_t - k.born) / 0.3
	if born < 1.0:
		sc *= born
	var w: float = inf[1] * sc
	var h: float = inf[2] * sc
	(inf[0] as TriBatch).full(k.x - w * 0.5, k.y - h * 0.5 + sin(t_anim * 4.0 + k.x * 0.03) * 3.0, w, h, col)


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
	var bob := sin(t_anim * 4.0 + k.x * 0.03) * 3.0
	draw_texture_rect(tx, Rect2(k.x - w / 2.0, k.y - h / 2.0 + bob, w, h), false, col)


func _draw_poi(i: int) -> void:
	var poi: Dictionary = sim.pois[i]
	var pk: String = poi.kind
	if pk == "vine":
		if sim.vine_taken.has(i):
			return
		var vp := Vector2(float(poi.x), float(poi.y))
		var vtx := _opt_tex("poi_vine")
		var label_y := -110.0
		if vtx != null:
			var vh_px := 148.0
			var vw_px := float(vtx.get_width()) * vh_px / maxf(1.0, float(vtx.get_height()))
			var sway := sin(t_anim * 2.2 + vp.x * 0.01) * 2.0
			draw_texture_rect(vtx, Rect2(vp.x - vw_px * 0.5, vp.y - vh_px * 0.9 + sway, vw_px, vh_px), false, Color.WHITE)
			b_world_white.ring(vp, 78.0, 2.5, Color(0.55, 1.0, 0.65, 0.42), 28)
			label_y = -vh_px - 8.0
		else:
			for a in range(3):
				b_world_white.line(vp, vp + Vector2(sin(t_anim + a * 2.1) * 40.0, -70.0 - a * 14.0), 5.0, Color(0.3, 0.8, 0.3))
			b_world_white.circle(vp + Vector2(0.0, -80.0), 16.0, Color(1.0, 0.7, 0.2), 14)
		_queue_zone_text(vp + Vector2(0.0, label_y), "葫芦灵藤", "站定 1 秒采集彩虹葫芦散件", Color("9fffb0"))
		var vh: float = float(sim.poi_hold.get(i, 0.0))
		if vh > 0.0:
			b_world_white.arc(vp, 78.0, 7.0, -PI / 2.0, -PI / 2.0 + clampf(vh / float(GameData.DG.rift.hold), 0.0, 1.0) * TAU, Color(1.0, 0.9, 0.5, 0.95), 28)
		return
	if pk == "merchant":
		var mp2 := Vector2(float(poi.x), float(poi.y))
		var mt: Texture2D = T.merchant
		var mh := 150.0
		var mw := mt.get_width() * mh / mt.get_height()
		draw_texture_rect(mt, Rect2(mp2.x - mw / 2.0, mp2.y - mh * 0.95, mw, mh), false, Color.WHITE)
		var sgn := mp2 + Vector2(0.0, 56.0) - cam.position + get_viewport_rect().size / 2.0
		if mp2.distance_to(Vector2(sim.px, sim.py)) <= 380.0 and not (sgn.x - 130.0 < 430.0 and sgn.y - 36.0 < 340.0):
			_queue_zone_text(mp2 + Vector2(0.0, 56.0), String(poi.name), "站定 1 秒打开商店（铜钱换遗物）", UI.GOLD)
		return
	if Sim.LM_KINDS.has(pk):
		var lp := Vector2(float(poi.x), float(poi.y))
		var lst := sim.lm_state(i)
		var zr_lm := float(GameData.SEG["break"].zoneR)
		var lmtx := _opt_tex("poi_" + pk)
		var lm_label_y := -70.0
		if lmtx != null:
			var lmh: float = float(LM_HEIGHTS.get(pk, 156.0))
			var lmw: float = float(lmtx.get_width()) * lmh / maxf(1.0, float(lmtx.get_height()))
			var lm_tint := Color.WHITE if lst == "ok" else Color(0.58, 0.58, 0.68)
			draw_texture_rect(lmtx, Rect2(lp.x - lmw * 0.5, lp.y - lmh * 0.88, lmw, lmh), false, lm_tint)
			lm_label_y = -lmh * 0.92 - 12.0
		b_world_white.ring(lp, zr_lm, 3.0, Color(1.0, 0.8, 0.4, 0.5 if lst == "ok" else 0.2), 28)
		if lp.distance_to(Vector2(sim.px, sim.py)) < 420.0:
			_queue_zone_text(lp + Vector2(0.0, lm_label_y), String(poi.name), sim.lm_hint(i), UI.GOLD if lst == "ok" else Color("ff8a7a"))
		var lh: float = float(sim.poi_hold.get(i, 0.0))
		if lh > 0.0:
			b_world_white.arc(lp, zr_lm, 7.0, -PI / 2.0, -PI / 2.0 + clampf(lh / float(GameData.DG.rift.hold), 0.0, 1.0) * TAU, Color(1.0, 0.9, 0.5, 0.95), 28)
		return
	var pp := Vector2(float(poi.x), float(poi.y))
	var tx: Texture2D = T.rift_portal
	var st := sim.poi_state(i)
	var sc := 1.0 + sin(t_anim * 3.0) * 0.03
	var w := tx.get_width() * sc
	var h := tx.get_height() * sc
	var is_ar: bool = Sim.ARENA_KINDS.has(pk)
	var tint2: Color = POI_TINTS.get(pk, Color.WHITE)
	draw_texture_rect(tx, Rect2(pp.x - w / 2.0, pp.y - h * 0.75, w, h), false, tint2 if st == "ok" else Color(0.55, 0.5, 0.62))
	var sub: String = ("站定进入 • 限时挑战" if is_ar else "站定进入 • 消耗灯芯×1") if st == "ok" else ""
	if st != "ok":
		match st:
			"weak": sub = "灯弱，不可入"
			"nowick": sub = "灯芯不足"
			"sealed": sub = "裂隙已闭合"
			"cooldown": sub = "冷却中 %d 秒（第 3 次起每次间隔 90 秒）" % int(ceil(sim.rift_cd_left()))
			"noticket": sub = "门票 %d 铜钱（现有 %d）" % [sim.vine_ticket(), sim.coins]
	if pk == "gourd" and st == "ok":
		sub = "站定入内 • 门票 %d 铜钱 • 第 %d 劫（超时返还）" % [sim.vine_ticket(), sim.vine_runs + 1]
	if Sim.FARM_KINDS.has(pk):
		var FM: Dictionary = GameData.DG.farms[pk]
		if st == "ok":
			sub = ("站定入内 • 坚持 %d 秒 • 每只妖物必掉铜钱" if pk == "coinfarm" else "站定入内 • 坚持 %d 秒 • 魂火×3 通关直升 1 级") % int(FM.dur)
		elif st == "cd":
			sub = "冷却中 %d 秒（可反复刷）" % int(ceil(sim.lm_cd_left(i)))
		elif st == "weak":
			sub = "生命需高于 %d%%" % int(float(FM.hpGate) * 100.0)
	_queue_zone_text(pp + Vector2(0.0, -h * 0.75 - 10.0), String(poi.name), sub, UI.GOLD if st == "ok" else Color("ff8a7a"))
	var zr: float = GameData.SEG["break"].zoneR
	var hv: float = float(sim.poi_hold.get(i, 0.0))
	b_world_white.ring(pp, zr, 3.0, Color(1.0, 0.8, 0.4, 0.35), 28)
	if hv > 0.0:
		b_world_white.arc(pp, zr, 7.0, -PI / 2.0, -PI / 2.0 + clampf(hv / float(GameData.DG.rift.hold), 0.0, 1.0) * TAU, Color(1.0, 0.9, 0.5, 0.95), 28)


func _draw_objective(obj: Dictionary) -> void:
	var is_lamp := String(obj.get("kind", "")) == "shrine_lamp"
	var op := Vector2(float(obj.x), float(obj.y))
	var orad := float(obj.get("r", 115.0))
	var need := maxf(0.01, float(obj.get("need", 3.0)))
	var prog := clampf(float(obj.get("progress", 0.0)) / need, 0.0, 1.0)
	var base_col := Color(1.0, 0.82, 0.34, 0.65) if is_lamp else Color(0.45, 0.90, 1.0, 0.65)
	var accent_col := UI.GOLD if is_lamp else UI.GHOST
	var tx := _opt_tex("obj_shrine_lamp" if is_lamp else "obj_stele_soul")
	var label_y := -162.0
	if tx != null:
		var oh := 156.0
		var ow := float(tx.get_width()) * oh / maxf(1.0, float(tx.get_height()))
		var bob := sin(t_anim * 2.6 + op.x * 0.01) * 2.0
		draw_texture_rect(tx, Rect2(op.x - ow * 0.5, op.y - oh * 0.92 + bob, ow, oh), false, Color.WHITE)
		label_y = -oh - 12.0
	else:
		# 贴图未导入前的合批几何回退，确保荒野目标永远可见
		if is_lamp:
			b_world_white.full(op.x - 20.0, op.y - 86.0, 40.0, 86.0, Color(0.28, 0.22, 0.18, 0.95))
			b_world_white.circle(op + Vector2(0.0, -78.0), 14.0, Color(1.0, 0.84, 0.36, 0.95), 14)
		else:
			b_world_white.full(op.x - 18.0, op.y - 98.0, 36.0, 98.0, Color(0.22, 0.32, 0.42, 0.95))
			b_world_white.line(op + Vector2(-8.0, -76.0), op + Vector2(8.0, -48.0), 3.0, Color(0.55, 0.94, 1.0, 0.95))
		label_y = -114.0
	# 荒野目标光环 + 脉动信标环 + 进度/镇魂环（全部合批进 b_world_white）
	b_world_white.ring(op, orad, 3.0, base_col, 32)
	var bp := fmod(t_anim * 0.55, 1.0)
	b_world_white.ring(op, orad * (0.45 + 0.55 * bp), 2.5, Color(accent_col.r, accent_col.g, accent_col.b, (1.0 - bp) * 0.55), 28)
	if is_lamp:
		if prog > 0.0:
			b_world_white.arc(op, orad, 7.0, -PI / 2.0, -PI / 2.0 + prog * TAU, Color(1.0, 0.90, 0.45, 0.95), 32)
	else:
		# 镇魂断碑：内圈残余完整度（HP 环）+ 外圈震碎进度弧
		var hp_left := 1.0 - prog
		if hp_left > 0.01:
			b_world_white.arc(op, orad - 7.0, 4.0, -PI / 2.0, -PI / 2.0 + hp_left * TAU, Color(0.45, 0.88, 1.0, 0.78), 32)
		if prog > 0.0:
			b_world_white.arc(op, orad, 7.0, -PI / 2.0, -PI / 2.0 + prog * TAU, Color(0.86, 0.98, 1.0, 0.95), 32)
	var title := String(obj.get("name", "破庙灯龛" if is_lamp else "镇魂断碑"))
	var sub := ""
	if is_lamp:
		sub = ("点亮中 %d%% • 保持圈内" % int(round(prog * 100.0))) if prog > 0.0 else "站定圈内点亮 • 灯油+护罩+阴律"
	else:
		sub = ("震碎中 %d%% • 保持圈内" % int(round(prog * 100.0))) if prog > 0.0 else "站定圈内震碎 • 清弹+葫芦/铜钱"
	_queue_zone_text(op + Vector2(0.0, label_y), title, sub, accent_col)


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
				"cooldown": sub = "冷却中 %d 秒" % int(ceil(sim.rift_cd_left())); col = Color("9aa3cf")
			_queue_zone_text(p + Vector2(0.0, -h * 0.75 - 10.0), label, sub, col)
		"merchant":
			var tx2: Texture2D = T.merchant
			var h2 := 150.0
			var w2 := tx2.get_width() * h2 / tx2.get_height()
			draw_texture_rect(tx2, Rect2(p.x - w2 / 2.0, p.y - h2 * 0.95 + sin(t_anim * 2.0) * 2.0, w2, h2), false, Color.WHITE)
			_queue_zone_text(p + Vector2(0.0, 56.0), "游商", "站定交易 • 铜钱换遗物", UI.GOLD)
		"gate":
			var tx3: Texture2D = T.field_lantern
			for sx in [-70.0, 70.0]:
				draw_texture_rect(tx3, Rect2(p.x + sx - tx3.get_width() / 2.0, p.y - tx3.get_height() + 30.0, tx3.get_width(), tx3.get_height()), false, Color.WHITE)
			var sub3 := "站定启程 • 领取馈赠三选一" if sim.gift_pending else "站定启程（馈赠已放弃）"
			_queue_zone_text(p + Vector2(0.0, -tx3.get_height() - 4.0), "启程", sub3, UI.GOLD)
	var hv: float = float(sim.hold.get(which, 0.0))
	var need: float = GameData.DG.rift.hold
	b_world_white.ring(p, zr, 3.0, Color(1.0, 0.8, 0.4, 0.35), 28)
	if hv > 0.0:
		b_world_white.arc(p, zr, 7.0, -PI / 2.0, -PI / 2.0 + clampf(hv / need, 0.0, 1.0) * TAU, Color(1.0, 0.9, 0.5, 0.95), 28)


func _queue_label(pos: Vector2, text: String, w: float, size: int, col: Color) -> void:
	_poi_labels.append([pos, text, w, UI.snap_size(size), col])


func _queue_zone_text(p: Vector2, title: String, sub: String, col: Color) -> void:
	b_world_white.full(p.x - 130.0, p.y - 36.0, 260.0, 48.0, Color(0.03, 0.04, 0.1, 0.6))
	_queue_label(p + Vector2(-200.0, -14.0), title, 400.0, 20, UI.PAPER)
	_queue_label(p + Vector2(-260.0, 6.0), sub, 520.0, 16, col)


func _draw_poi_labels(c: Node2D) -> void:
	if _poi_labels.is_empty():
		return
	for pass_i in range(2):
		for sz in [16, 20, 26]:
			for item in _poi_labels:
				if int(item[3]) != sz:
					continue
				var pos: Vector2 = item[0]
				if pass_i == 0:
					c.draw_string(font, pos + Vector2(1.5, 1.5), String(item[1]), HORIZONTAL_ALIGNMENT_CENTER, float(item[2]), sz, UI.INK)
				else:
					c.draw_string(font, pos, String(item[1]), HORIZONTAL_ALIGNMENT_CENTER, float(item[2]), sz, item[4])


func _draw_projectiles(c: Node2D) -> void:
	var ci := c.get_canvas_item()
	var vx0 := _vx0
	var vx1 := _vx1
	var vy0 := _vy0
	var vy1 := _vy1
	var tx: Texture2D = T.proj_talisman
	var tw := tx.get_width() * 0.48
	var th := tx.get_height() * 0.48
	for b: SimBullet in sim.bullets:
		if b.x < vx0 or b.x > vx1 or b.y < vy0 or b.y > vy1:
			continue
		b_talisman.rot(Vector2(b.x, b.y), b.ang, tw, th, Color.WHITE)
	var eg: Texture2D = T.proj_ghostfire
	var ew := eg.get_width() * 0.42
	var eh := eg.get_height() * 0.42
	for b: SimBullet in sim.ebullets:
		if b.x < vx0 or b.x > vx1 or b.y < vy0 or b.y > vy1:
			continue
		var is_frost := bool(b.get("frost"))
		b_ghostfire.rot(Vector2(b.x, b.y), t_anim * 6.0, ew, eh, Color(0.45, 0.92, 1.0) if is_frost else Color.WHITE)
	if sim.pet_on and sim.pet_dead_t <= 0.0:
		var pp := sim.pet_pos
		var pt: Texture2D = _tex("pet_huluwa")
		var ph := 94.0
		var pw := pt.get_width() * ph / pt.get_height()
		var bob := sin(t_anim * 6.5) * 6.0
		c.draw_texture_rect(pt, Anchors.rect(pp.x, pp.y - ph * 0.72 + bob, pw, ph, "pet_huluwa", sim.pet_flip), false, Color.WHITE)
		var bw := 54.0
		var bx := pp.x - bw * 0.5
		var by := pp.y - ph * 0.78 + bob - 10.0
		b_world_white.full(bx - 1.5, by - 1.5, bw + 3.0, 8.0, UI.INK)
		b_world_white.full(bx, by, bw, 5.0, Color(0.12, 0.12, 0.2))
		b_world_white.full(bx, by, bw * clampf(sim.pet_hp / maxf(1.0, sim.pet_maxhp()), 0.0, 1.0), 5.0, Color("ffcf5a"))
	var fl2: Texture2D = T.proj_flame
	var fl2_w := fl2.get_width() * 0.52
	var fl2_h := fl2.get_height() * 0.52
	for sh in sim.pet_shots:
		var shx := float(sh.x)
		var shy := float(sh.y)
		if shx < vx0 or shx > vx1 or shy < vy0 or shy > vy1:
			continue
		var col_s: Color = PET_SHOT_COLS[int(sh.get("col", 0)) % 3]
		var ang_s := atan2(float(sh.vy), float(sh.vx))
		b_flame.rot(Vector2(shx, shy), ang_s, fl2_w, fl2_h, col_s)
	var swt: Texture2D = T.proj_sword
	var sw_w := float(swt.get_width())
	var sw_h := float(swt.get_height())
	for wp: Vector2 in sim.sw_wheel_pos:
		var wa := atan2(wp.y - (sim.py - 30.0), wp.x - sim.px) + PI / 2.0
		b_sword.rot(wp, wa, sw_w * 0.4, sw_h * 0.4, Color(0.8, 1.0, 1.0))
	for qb: SimBullet in sim.sw_qi:
		if qb.x < vx0 or qb.x > vx1 or qb.y < vy0 or qb.y > vy1:
			continue
		var big: float = 0.42 if qb.hits.key == "sw_array" else 0.32
		b_sword.rot(Vector2(qb.x, qb.y), qb.ang, sw_w * big, sw_h * big, Color(1.0, 0.9, 0.6) if qb.hits.key == "sw_array" else Color(0.6, 1.0, 1.0))
	var fl: Texture2D = T.proj_flame
	var fl_s := 0.5 + sin(t_anim * 14.0) * 0.05
	var fl_ow := fl.get_width() * fl_s
	var fl_oh := fl.get_height() * fl_s
	for o in sim.orb_pos:
		b_flame.full(o.x - fl_ow * 0.5, o.y - fl_oh * 0.5, fl_ow, fl_oh, Color.WHITE)
	if sim.has_sword() and (sim.sw_state == Sim.SW_ORBIT or sim.sw_state == Sim.SW_RECALL):
		var ang := 0.0
		if sim.sw_state == Sim.SW_ORBIT:
			ang = atan2(cos(sim.sw_ang) * GameData.DG.sword.orbitRy, -sin(sim.sw_ang) * GameData.DG.sword.orbitRx)
		else:
			ang = atan2(sim.sw_dir.y, sim.sw_dir.x)
		b_sword.rot(Vector2(sim.sw_x, sim.sw_y), ang, sw_w * 0.62, sw_h * 0.62, Color.WHITE)
	elif sim.has_sword() and sim.sw_state == Sim.SW_DROP:
		b_sword.rot(Vector2(sim.px + 40.0, sim.py + 6.0), 0.5, sw_w * 0.5, sw_h * 0.5, Color(0.6, 0.6, 0.65))
	b_talisman.flush(ci, tx)
	b_ghostfire.flush(ci, eg)
	b_sword.flush(ci, swt)
	b_flame.flush(ci, fl)


func _draw_floaters(c: Node2D) -> void:
	if floaters.is_empty():
		return
	var vx0 := _vx0
	var vx1 := _vx1
	var vy0 := _vy0
	var vy1 := _vy1
	var from_i := maxi(0, floaters.size() - 16)
	var has_text := false
	var inv_cnt := 1.0 / float(Fx.DIGIT_COUNT)
	var aspect := float(Fx.DIGIT_CELL_W) / float(Fx.DIGIT_CELL_H)
	# 数字/符号伤害飘字统一进位图条 TriBatch（1 DC、零 draw_string 字体图集切换、零阴影 pass）
	for fi in range(from_i, floaters.size()):
		var f: Dictionary = floaters[fi]
		var fx := float(f.x)
		var fy := float(f.y)
		if fx < vx0 or fx > vx1 or fy < vy0 or fy > vy1:
			continue
		if not bool(f.get("is_num", false)):
			has_text = true
			continue
		var txt: String = f.text
		var ln := txt.length()
		if ln == 0:
			continue
		var a := clampf(float(f.life) / 0.4, 0.0, 1.0)
		var col: Color = f.col
		col.a = a
		var gh := float(f.size) * 1.1
		var gw := gh * aspect
		var step := gw * 0.78
		var x0 := fx - (float(ln - 1) * step + gw) * 0.5
		var y0 := fy - gh * 0.82
		for ci_i in range(ln):
			var cell := Fx.digit_cell(txt.unicode_at(ci_i))
			if cell < 0:
				continue
			var u0 := float(cell) * inv_cnt
			b_digits.rect(x0 + float(ci_i) * step, y0, gw, gh, u0, 0.0, u0 + inv_cnt, 1.0, col)
	b_digits.flush(c.get_canvas_item(), T.digits)
	if not has_text:
		return
	# 反应/提示文字飘字：无阴影单 pass，最多同时绘制 MAX_TEXT_FLOATERS (6) 条
	var text_drawn := 0
	for sz in FLOATER_SIZES:
		for fi in range(floaters.size() - 1, from_i - 1, -1):
			if text_drawn >= MAX_TEXT_FLOATERS:
				return
			var f: Dictionary = floaters[fi]
			if bool(f.get("is_num", false)):
				continue
			var fx := float(f.x)
			var fy := float(f.y)
			if fx < vx0 or fx > vx1 or fy < vy0 or fy > vy1:
				continue
			if UI.snap_size(int(f.size)) != sz:
				continue
			var a := clampf(float(f.life) / 0.4, 0.0, 1.0)
			var pos := Vector2(fx - 100.0, fy)
			var col: Color = f.col
			col.a = a
			c.draw_string(font, pos, String(f.text), HORIZONTAL_ALIGNMENT_CENTER, 200.0, sz, col)
			text_drawn += 1


func _draw_fx_add(c: Node2D) -> void:
	var t_fx := Time.get_ticks_usec()
	defer__draw_fx_add(c)
	PerfStat.add("fx_add_draw", t_fx)


func _fx_ring(cx: float, cy: float, r: float, w: float, col: Color) -> void:
	if r <= 0.0:
		return
	var half := (r + w * 0.5) / 0.90
	b_ring_fx.full(cx - half, cy - half, half * 2.0, half * 2.0, col)


func defer__draw_fx_add(c: Node2D) -> void:
	var g: Texture2D = T.glow
	var fci := c.get_canvas_item()
	if not ghosts.is_empty():
		var htx: Texture2D = T.hero_run
		var htw := float(htx.get_width())
		var hth := float(htx.get_height())
		var fw := 152.0
		var fh := 192.0
		var w := fw * 0.44
		var h := fh * 0.44
		var du := fw / htw
		var dv := fh / hth
		for gh in ghosts:
			var a: float = clampf(float(gh.life) / 0.32, 0.0, 1.0) * 0.55
			var fr: int = gh.fr
			var u0 := float(fr % 6) * du
			var v0 := float(fr / 6) * dv
			var dst := Anchors.rect(float(gh.x), float(gh.y) - h * 0.92, w, h, "hero_run", bool(gh.flip))
			if dst.size.x < 0.0:
				b_ghosts.rect(dst.position.x, dst.position.y, -dst.size.x, dst.size.y, u0 + du, v0, u0, v0 + dv, Color(0.5, 0.89, 1.0, a))
			else:
				b_ghosts.rect(dst.position.x, dst.position.y, dst.size.x, dst.size.y, u0, v0, u0 + du, v0 + dv, Color(0.5, 0.89, 1.0, a))
		b_ghosts.flush(fci, htx)
	# 挑灯爆焰：金色清弹冲击波 + 爆发光环（单四边形程序化圆环）
	var fw_t := maxf(_sim_float("flare_wave_t", 0.0), _local_flare_wave)
	var fl_t := _sim_float("flare_t", 0.0)
	var pctr := Vector2(sim.px, sim.py - 30.0)
	if fw_t > 0.0:
		var k_fw := clampf(1.0 - fw_t / 0.55, 0.0, 1.0)
		var rad_fw := 40.0 + 360.0 * (1.0 - (1.0 - k_fw) * (1.0 - k_fw))
		var al_fw := (1.0 - k_fw) * 0.95
		_fx_ring(pctr.x, pctr.y, rad_fw, 12.0 * (1.0 - k_fw) + 3.0, Color(1.0, 0.84, 0.38, al_fw))
		_fx_ring(pctr.x, pctr.y, rad_fw * 0.78, 5.0 * (1.0 - k_fw) + 1.5, Color(1.0, 0.96, 0.82, al_fw * 0.85))
		b_glow_fx.full(pctr.x - rad_fw * 0.8, pctr.y - rad_fw * 0.8, rad_fw * 1.6, rad_fw * 1.6, Color(1.0, 0.78, 0.3, al_fw * 0.38))
	if fl_t > 0.0:
		var pulse_fl := 0.72 + 0.28 * sin(t_anim * 16.0)
		_fx_ring(pctr.x, pctr.y, 56.0 + sin(t_anim * 12.0) * 5.0, 3.5, Color(1.0, 0.86, 0.42, 0.65 * pulse_fl))
		b_glow_fx.full(pctr.x - 110.0, pctr.y - 110.0, 220.0, 220.0, Color(1.0, 0.82, 0.35, 0.32 * pulse_fl))
	# 子弹辉光（严格相机视口裁剪）
	var vx0 := _vx0
	var vx1 := _vx1
	var vy0 := _vy0
	var vy1 := _vy1
	for b: SimBullet in sim.bullets:
		if b.x < vx0 or b.x > vx1 or b.y < vy0 or b.y > vy1:
			continue
		b_glow_fx.full(b.x - 26.0, b.y - 26.0, 52.0, 52.0, Color(1.0, 0.85, 0.4, 0.55))
	for b: SimBullet in sim.ebullets:
		if b.x < vx0 or b.x > vx1 or b.y < vy0 or b.y > vy1:
			continue
		var is_frost := bool(b.get("frost"))
		b_glow_fx.full(b.x - 30.0, b.y - 30.0, 60.0, 60.0, Color(0.45, 0.92, 1.0, 0.72) if is_frost else Color(0.5, 1.0, 0.7, 0.55))
	for o in sim.orb_pos:
		b_glow_fx.full(o.x - 44.0, o.y - 44.0, 88.0, 88.0, Color(1.0, 0.55, 0.2, 0.8))
	if sim.pet_on and sim.pet_dead_t <= 0.0:
		for ri in range(7):
			var ra := t_anim * 3.8 + ri * TAU / 7.0
			b_white_fx.circle(sim.pet_pos + Vector2(cos(ra) * 38.0, sin(ra) * 26.0 - 16.0), 5.5, RAINBOW_COLS[ri], 8)
		b_glow_fx.full(sim.pet_pos.x - 64.0, sim.pet_pos.y - 64.0, 128.0, 128.0, Color(1.0, 0.85, 0.42, 0.58))
	for sh in sim.pet_shots:
		var shx := float(sh.x)
		var shy := float(sh.y)
		if shx < vx0 or shx > vx1 or shy < vy0 or shy > vy1:
			continue
		b_glow_fx.full(shx - 34.0, shy - 34.0, 68.0, 68.0, Color(1.0, 0.65, 0.25, 0.75))
	for fx in sim.pet_fx:
		var frad: float = float(fx[5]) if fx.size() > 5 else 140.0
		var fpx := float(fx[1])
		var fpy := float(fx[2])
		if fpx + frad < vx0 or fpx - frad > vx1 or fpy + frad < vy0 or fpy - frad > vy1:
			continue
		var fmax: float = maxf(0.01, float(fx[4]) if fx.size() > 4 else 0.4)
		var fk: float = clampf(float(fx[3]) / fmax, 0.0, 1.0)
		var ftype := int(fx[0])
		var fc: Color = PET_FX_COLS[ftype % 3]
		var rcur := frad * (0.28 + 0.72 * (1.0 - fk))
		_fx_ring(fpx, fpy, rcur, 8.0 * fk + 2.0, Color(fc, fk))
		b_glow_fx.full(fpx - rcur * 0.7, fpy - rcur * 0.7, rcur * 1.4, rcur * 1.4, Color(fc, fk * 0.42))
		if ftype == 2:
			_fx_ring(fpx, fpy, rcur * 0.68, 5.0 * fk + 1.0, Color(0.55, 0.95, 1.0, fk * 0.85))
	if sim.combo_fx > 0.0:
		var ck := clampf(sim.combo_fx / 0.85, 0.0, 1.0)
		var cr_base := float(GameData.GD.pet.comboR) * (1.12 - ck * 0.85)
		for ci2 in range(7):
			var cr2 := cr_base * (0.52 + 0.08 * float(ci2))
			_fx_ring(pctr.x, pctr.y, cr2, 8.0 * ck + 2.0, Color(RAINBOW_COLS[ci2], ck * 0.9))
	# 剑轮/剑气光 + 剑阵环
	for wp2: Vector2 in sim.sw_wheel_pos:
		b_glow_fx.full(wp2.x - 40.0, wp2.y - 40.0, 80.0, 80.0, Color(0.4, 0.9, 1.0, 0.55))
	for qb2: SimBullet in sim.sw_qi:
		if qb2.x < vx0 or qb2.x > vx1 or qb2.y < vy0 or qb2.y > vy1:
			continue
		b_glow_fx.full(qb2.x - 32.0, qb2.y - 32.0, 64.0, 64.0, Color(1.0, 0.85, 0.4, 0.7) if qb2.hits.key == "sw_array" else Color(0.4, 0.95, 1.0, 0.6))
	if sim.sw_array_fx > 0.0:
		var ka := sim.sw_array_fx / 0.6
		_fx_ring(pctr.x, pctr.y, 340.0 * (1.2 - ka), 8.0 * ka + 2.0, Color(1.0, 0.9, 0.5, ka))
	# 飞剑光（椭圆轨道单四边形圆环贴图）
	if sim.has_sword() and (sim.sw_state == Sim.SW_ORBIT or sim.sw_state == Sim.SW_RECALL):
		b_glow_fx.full(sim.sw_x - 56.0, sim.sw_y - 56.0, 112.0, 112.0, Color(0.4, 0.9, 1.0, 0.7))
		if sim.sw_state == Sim.SW_ORBIT:
			var hx := float(GameData.DG.sword.orbitRx) / 0.90
			var hy := float(GameData.DG.sword.orbitRy) / 0.90
			b_ring_fx.full(pctr.x - hx, pctr.y - hy, hx * 2.0, hy * 2.0, Color(0.5, 0.9, 1.0, 0.22))
	if sim.sw_thrust_fx > 0.0:
		var k := sim.sw_thrust_fx / 0.25
		var d := sim.sw_dir.normalized()
		var hw: float = GameData.DG.sword.thrustHalfW
		var L: float = GameData.DG.sword.thrustLen
		b_white_fx.line(pctr, pctr + d * L, hw * 0.7 * k + 4.0, Color(0.6, 0.95, 1.0, 0.9 * k))
		b_white_fx.line(pctr, pctr + d * L, 6.0 * k + 1.0, Color(1, 1, 1, k))
	# 圆环（单四边形程序化圆环）/ 闪电 / 爆炸图 / MultiMesh 粒子池
	for r in rings:
		var rx := float(r.x)
		var ry := float(r.y)
		var rr := float(r.r)
		if rx + rr < vx0 or rx - rr > vx1 or ry + rr < vy0 or ry - rr > vy1:
			continue
		var k2: float = 1.0 - float(r.life) / float(r.max)
		var col: Color = r.col
		col.a = (1.0 - k2) * 0.9
		_fx_ring(rx, ry, rr * (0.3 + 0.7 * k2), 5.0 * (1.0 - k2) + 1.0, col)
	for f in fx_sprites:
		var fx_x := float(f.x)
		var fx_y := float(f.y)
		if fx_x < vx0 - 120.0 or fx_x > vx1 + 120.0 or fx_y < vy0 - 160.0 or fx_y > vy1 + 120.0:
			continue
		var tx2: Texture2D = T[f.tex]
		var k3: float = float(f.life) / float(f.max)
		var sc: float = f.scale
		if f.get("thunder", false):
			var w3: float = tx2.get_width() * sc * (0.5 + 0.5 * k3)
			var h3: float = tx2.get_height() * sc
			_fxs_batch(f.tex).full(fx_x - w3 / 2.0, fx_y - h3, w3, h3, Color(1, 1, 1, k3))
		else:
			var w4: float = tx2.get_width() * sc * (1.2 - 0.4 * k3)
			var h4: float = tx2.get_height() * sc * (1.2 - 0.4 * k3)
			_fxs_batch(f.tex).full(fx_x - w4 / 2.0, fx_y - h4 / 2.0, w4, h4, Color(1, 1, 1, k3))
	for bl in sim.bolts:
		var bx1: float = bl.x1
		var by1: float = bl.y1
		var bx2: float = bl.x2
		var by2: float = bl.y2
		if (bx1 < vx0 and bx2 < vx0) or (bx1 > vx1 and bx2 > vx1) or (by1 < vy0 and by2 < vy0) or (by1 > vy1 and by2 > vy1):
			continue
		var p1 := Vector2(bx1, by1)
		var p2 := Vector2(bx2, by2)
		var d_bl := p2 - p1
		var mid := (p1 + p2) * 0.5 + Vector2(-d_bl.y, d_bl.x).normalized() * (float(bl.seed) - 0.5) * 40.0
		var bcol := Color(0.7, 0.95, 1.0, clampf(bl.life / 0.18, 0.0, 1.0))
		b_white_fx.line(p1, mid, 4.0, bcol)
		b_white_fx.line(mid, p2, 4.0, bcol)
	if _mm_pt_cap > MM_BASE_CAP and _mm_pt_idle >= MM_SHRINK_IDLE_FRAMES:
		_mm_pt_cap = maxi(MM_BASE_CAP, _mm_pt_cap >> 1)
		mm_particles.instance_count = _mm_pt_cap
		_mm_pt_buf.resize(_mm_pt_cap * 12)
		_mm_pt_idle = 0
	if part_pool.count > _mm_pt_cap:
		while _mm_pt_cap < part_pool.count:
			_mm_pt_cap *= 2
		mm_particles.instance_count = _mm_pt_cap
		_mm_pt_buf.resize(_mm_pt_cap * 12)
		_mm_pt_idle = 0
	var pcnt := part_pool.fill_multimesh(_mm_pt_buf, vx0, vy0, vx1, vy1, _mm_pt_cap)
	if pcnt > 0:
		RenderingServer.multimesh_set_buffer(_mm_pt_rid, _mm_pt_buf)
	mm_particles.visible_instance_count = pcnt
	if _mm_pt_cap > MM_BASE_CAP:
		_mm_pt_idle = (_mm_pt_idle + 1) if pcnt <= (_mm_pt_cap >> 1) else 0
	b_white_fx.flush(fci, T.white)
	b_ring_fx.flush(fci, T.ring)
	for fk2 in b_fxs:
		(b_fxs[fk2] as TriBatch).flush(fci, T[fk2])
	b_glow_fx.flush(fci, g)


func _fxs_batch(tex_name: String) -> TriBatch:
	if not b_fxs.has(tex_name):
		b_fxs[tex_name] = TriBatch.new(64)
	return b_fxs[tex_name]


func _draw_white(c: Node2D) -> void:
	b_flash.flush(c.get_canvas_item(), T.enemy_atlas)
	for f in flash_list:
		if f[2] != null:
			c.draw_texture_rect_region(f[0], f[1], f[2], Color(1, 1, 1, 0.8))
		else:
			c.draw_texture_rect(f[0], f[1], false, Color(1, 1, 1, 0.8))
	flash_list.clear()


# ----------------------------------------------------------------------
# 异常显示：身上颜色取最“醒目”的一种；2 种以上在头顶画小色点（零数组分配）
# ----------------------------------------------------------------------
func _ail_tint(e: SimEnemy) -> Color:
	if e.bind_t > 0.0:
		return Color(1.0, 0.92, 0.55)
	if e.shock_n > 0:
		return Color(0.72, 0.9, 1.0)
	if e.burn_n > 0:
		return Color(1.0, 0.74, 0.55)
	if e.seal_n > 0:
		return Color(1.0, 0.95, 0.75)
	return Color.WHITE


func _ail_pips(e: SimEnemy, x: float, y: float) -> void:
	var n := e.ail_kinds
	var x0 := x - float(n - 1) * 5.0
	var py := y - 3.5
	var i := 0
	if e.burn_n > 0:
		b_world_white.full(x0 + float(i) * 10.0 - 3.5, py, 7.0, 7.0, AIL_COL[0])
		i += 1
	if e.shock_n > 0:
		b_world_white.full(x0 + float(i) * 10.0 - 3.5, py, 7.0, 7.0, AIL_COL[1])
		i += 1
	if e.seal_n > 0 or e.bind_t > 0.0:
		b_world_white.full(x0 + float(i) * 10.0 - 3.5, py, 7.0, 7.0, AIL_COL[2])
		i += 1
	if e.marks > 0:
		b_world_white.full(x0 + float(i) * 10.0 - 3.5, py, 7.0, 7.0, AIL_COL[3])
