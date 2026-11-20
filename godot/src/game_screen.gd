class_name GameScreen
extends Node
## 一局游戏：把 Sim（规则）、WorldView（渲染）、Hud（界面）、TouchControls（触屏）接起来。

signal request_title
signal request_restart

var sim: Sim
var view: WorldView
var hud: Hud
var touch: TouchControls
var paused := false
var touch_mode := false
var saved_result := false
var night: CanvasLayer
var embers: Array = []
var ember_layer: Node2D
var hit_stop := 0.0


var last_cp := 0
var toast: Label
var toast_t := 0.0


func start(p_touch: bool, resume: Dictionary = {}) -> void:
	touch_mode = p_touch
	var sv := SaveData.load_save()
	var seed_v: int = Playtest.seed_value if Playtest.seed_value != 0 else int(Time.get_ticks_usec() & 0x7fffffff)
	if not resume.is_empty():
		seed_v = int(resume.get("seed_v", seed_v))
	sim = Sim.new(seed_v, {"emit": true, "touch": touch_mode, "meta": sv.meta, "mode": String(resume.get("mode", sv.get("mode", "full")))})
	if not resume.is_empty():
		sim.from_save(resume)
	if Playtest.enabled and Playtest.bench == 0 and resume.is_empty():
		sim.coins = 120   # 试玩桥：起始 120 铜钱（仅用于让剧本能在 3 分钟内演示商店购买；正常游玩为 0）
	view = WorldView.new()
	view.name = "World"
	add_child(view)
	view.setup(sim)
	view.low_perf = OS.has_feature("web") and touch_mode
	if view.low_perf:
		sim.max_en = mini(sim.max_en, 150)
	# 夜色暗角 + 余烬
	night = CanvasLayer.new()
	night.layer = 5
	add_child(night)
	var nt := TextureRect.new()
	nt.texture = Fx.night()
	nt.set_anchors_preset(Control.PRESET_FULL_RECT)
	nt.stretch_mode = TextureRect.STRETCH_SCALE
	nt.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	nt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	night.add_child(nt)
	if not view.low_perf:
		ember_layer = Node2D.new()
		ember_layer.set_script(preload("res://src/layer.gd"))
		ember_layer.cb = _draw_embers
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		ember_layer.material = m
		night.add_child(ember_layer)
		for i in range(26):
			embers.append({"x": randf(), "y": randf(), "v": 0.02 + randf() * 0.04, "s": 0.12 + randf() * 0.18, "p": randf() * 6.0})
	hud = Hud.new()
	hud.name = "Hud"
	add_child(hud)
	hud.setup(self, sim, touch_mode)
	view.banner_cb = hud.show_banner
	touch = TouchControls.new()
	touch.name = "Touch"
	add_child(touch)
	touch.setup(sim, touch_mode)
	if Playtest.hide != "":
		var hs := Playtest.hide.split(",")
		if "hud" in hs: hud.visible = false
		if "night" in hs: night.visible = false
		if "world" in hs: view.visible = false
		if "bg" in hs: view.bg_layer.visible = false
		if "ground" in hs: view.ground_add.visible = false
		if "fx" in hs: view.fx_add.visible = false
		if "touch" in hs: touch.visible = false
	Audio.music("battle")
	hud.show_banner("提灯夜行 • 守住这一夜", "#ffc977")


func _draw_embers(c: Node2D) -> void:
	var v := get_viewport().get_visible_rect().size
	var g: Texture2D = Fx.glow()
	for e in embers:
		var s: float = 64.0 * float(e.s)
		var px: float = fmod(float(e.x) + sin(float(e.p) + Time.get_ticks_msec() / 1500.0) * 0.01, 1.0) * v.x
		var py: float = float(e.y) * v.y
		c.draw_texture_rect(g, Rect2(px - s / 2.0, py - s / 2.0, s, s), false, Color(1.0, 0.7, 0.3, 0.55))


func save_run(manual: bool = false) -> bool:
	if sim.phase != Sim.PH_SEG and sim.phase != Sim.PH_BREAK or sim.over:
		if manual:
			_toast("此处不可存档（副本/BOSS 战中），请在战斗段或段间存档")
		return false
	var sv := SaveData.load_save()
	sv["run"] = sim.to_save()
	SaveData.write_save(sv)
	_toast("已存档" if manual else "自动存档")
	return true


func _toast(msg: String) -> void:
	toast.text = msg
	toast_t = 2.2


func _process(delta: float) -> void:
	if sim == null:
		return
	if Playtest.enabled and Playtest.bench == 0 and not sim.choice.is_empty() and ((sim.choice.kind == "level" and sim.level > 2) or sim.choice.kind in ["chest", "swb", "fusion", "gift"]):
		on_choose(0)
	PerfStat.frame_done()
	if toast != null and toast_t > 0.0:
		toast_t -= delta
		toast.modulate.a = clampf(toast_t / 0.5, 0.0, 1.0)
	if sim.cp_serial != last_cp:
		last_cp = sim.cp_serial
		save_run()
	# 余烬上飘
	for e in embers:
		e.y -= e.v * delta
		if e.y < -0.05:
			e.y = 1.05
			e.x = randf()
	if ember_layer != null:
		ember_layer.queue_redraw()
	var modal := hud.modal_open()
	touch.active = touch_mode and not modal and not paused and not sim.over
	if touch_mode:
		if touch.consume_pause() and not sim.over and sim.choice.is_empty() and not sim.shop_open:
			toggle_pause()
	# 结算
	if sim.ended:
		if not saved_result:
			saved_result = true
			_save_result()
			hud.show_result(sim.result)
			Audio.music("title")
		view.tick(delta)
		hud.tick(delta)
		_publish()
		return
	var run := not paused and sim.choice.is_empty() and not sim.shop_open
	if run:
		var mv := Vector2.ZERO
		if touch_mode and touch.mag > 0.0:
			mv = touch.move
		else:
			mv = Input.get_vector("move_left", "move_right", "move_up", "move_down")
		sim.in_move = mv
		if Input.is_action_just_pressed("dash") or (touch_mode and touch.consume_dash()):
			sim.in_dash = true
		if Input.is_action_just_pressed("skill") or (touch_mode and touch.consume_skill()):
			sim.in_skill = true
		if Input.is_action_just_pressed("combo") or (touch_mode and touch.consume_combo()):
			sim.in_combo = true
		var dt := minf(delta, 0.05)
		if view.hit_stop > 0.0:
			view.hit_stop -= delta
			dt = 0.0
		if sim.over:
			dt = delta
		if Playtest.bench > 0:
			_bench_keepalive()
		var ts := Playtest.time_scale
		var steps := 1
		if ts > 1.0:
			steps = int(ceil(ts))
		var t_sim := Time.get_ticks_usec()
		for i in range(steps):
			if dt > 0.0:
				sim.step(dt * (ts / steps) if ts > 1.0 else dt)
		PerfStat.add("sim_step", t_sim)
		if sim.phase == Sim.PH_BOSS and Audio.music_cur != "boss":
			Audio.music("boss")
	else:
		sim.in_dash = false
		sim.in_skill = false
	var t_v := Time.get_ticks_usec()
	view.tick(delta if run else 0.0)
	PerfStat.add("view_tick", t_v)
	var t_h := Time.get_ticks_usec()
	hud.tick(delta)
	PerfStat.add("hud_tick", t_h)
	_publish()


## 压测：同屏妖物恒为 N（混合种类，含远程/自爆），满级三武器+进化+飞剑，玩家无敌且不升级。只在 ?bench=N 且试玩桥开启时生效。
func _bench_keepalive() -> void:
	sim.max_en = Playtest.bench + 40
	sim.invuln = 1e9
	sim.pending_lv = 0
	sim.pending_chest = 0
	sim.hp = sim.maxhp
	if sim.t > 140.0:
		sim.t = 60.0
	if sim.lv("lei") < 5:
		sim.levels = {"fu": 5, "huanhuo": 5, "lei": 5, "jishu": 5, "zhongfu": 3, "zhuohun": 5, "tianyou": 3, "leiyin": 3, "tiangang": 5, "taomu": 5}
		sim.evo = {"fu": true, "huanhuo": true, "lei": true}
		sim.artifact = "sword"
		sim.sw_state = Sim.SW_STOW
		sim._recalc()
	if sim.t > 20.0 or sim.real_t > 20.0:
		sim.in_move = Vector2(cos(sim.real_t * 0.5), sin(sim.real_t * 0.7))
	var types := ["paperman", "foxfire", "paperman", "lantern", "jiangshi", "firecracker", "paperman", "foxfire"]
	var n := 0
	while sim.enemies.size() < Playtest.bench and n < 12:
		sim.spawn_enemy(types[sim.uid_n % types.size()], -1.0, 520.0 + float(sim.uid_n % 7) * 40.0)
		n += 1
	# 玩家的无敌不影响敌弹的生成/碰撞逻辑，只是 hurt_player 直接返回（与正常对局同一份更新代码）


func _save_result() -> void:
	var sv := SaveData.load_save()
	var r: Dictionary = sim.result
	sv.soul = int(sv.soul) + int(r.soul)
	sv.best = maxi(int(sv.best), int(r.time))
	sv.runs = int(sv.runs) + 1
	sv["run"] = {}
	if r.victory:
		sv.wins = int(sv.wins) + 1
	SaveData.write_save(sv)


var _pub_t := 0.0


func _publish() -> void:
	if not Playtest.enabled:
		return
	var now := Time.get_ticks_msec()
	if now - _pub_t < 150.0 and Playtest.bench == 0 and sim.choice.is_empty():
		pass
	elif now - _pub_t < 150.0:
		return
	_pub_t = now
	var scene := "play"
	if sim.ended:
		scene = "result"
	elif sim.over:
		scene = "dying"
	elif paused:
		scene = "paused"
	elif not sim.choice.is_empty():
		scene = "gift" if sim.choice.kind == "gift" else "levelup"
	elif sim.shop_open:
		scene = "shop"
	elif sim.phase == Sim.PH_BREAK:
		scene = "break"
	elif sim.phase == Sim.PH_RIFT:
		scene = "rift"
	var snap := sim.snapshot()
	snap["scene"] = scene
	snap["touch"] = touch_mode
	snap["stick"] = snappedf(touch.mag, 0.01)
	snap["rift_state"] = sim.rift_state()
	snap["sword"] = sim.sw_state
	snap["wardenHp"] = int(sim.rift_warden.hp) if sim.rift_warden != null else 0
	snap["rift_log"] = sim.rift_log.size()
	var lvs := 0
	for k in sim.levels:
		lvs += int(sim.levels[k])
	snap["lvsum"] = lvs
	snap["relics"] = sim.relics.size()
	snap["threat"] = sim.threat_next + sim.threat_cur
	snap["break_idx"] = sim.break_idx
	snap["coins"] = sim.coins
	snap["gourds"] = sim.gourds.size()
	snap["pet"] = sim.pet_on
	snap["sets"] = sim.active_sets().size()
	snap["clock"] = int(sim.clock)
	snap["poi0"] = sim.poi_state(0)
	snap["poi_x"] = int(sim.pois[0].x)
	snap["poi_y"] = int(sim.pois[0].y)
	snap["breakT"] = snappedf(sim.break_t, 0.1)
	snap["choices"] = sim.choice.options.size() if not sim.choice.is_empty() else 0
	if Playtest.enabled:
		# 只读信息：离主角最近的几只妖物 / 敌弹相对位置（试玩脚本据此“看”局面，不改变任何状态）
		var near: Array = []
		for e: SimEnemy in sim.enemies:
			var dx := e.x - sim.px
			var dy := e.y - sim.py
			var d2 := dx * dx + dy * dy
			if d2 < 400.0 * 400.0:
				near.append([int(dx), int(dy), int(sqrt(d2))])
		near.sort_custom(func(a, b): return a[2] < b[2])
		snap["near"] = near.slice(0, 10)
		var bl: Array = []
		for b: SimBullet in sim.ebullets:
			var bx := b.x - sim.px
			var by := b.y - sim.py
			if bx * bx + by * by < 300.0 * 300.0:
				bl.append([int(bx), int(by)])
		snap["bul"] = bl.slice(0, 8)
	if Playtest.bench > 0:
		var pm := {}
		pm["draw_calls"] = int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
		pm["objects"] = int(Performance.get_monitor(Performance.OBJECT_COUNT))
		pm["nodes"] = int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT))
		pm["mem_mb"] = snappedf(Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, 0.1)
		pm["tex_mb"] = snappedf(Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / 1048576.0, 0.1)
		pm["process_ms"] = snappedf(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, 0.01)
		pm["fps"] = int(Performance.get_monitor(Performance.TIME_FPS))
		pm["parts"] = PerfStat.avg
		snap["perf"] = pm
		snap["bench_en"] = sim.enemies.size()
		snap["bench_bul"] = sim.bullets.size()
		snap["bench_ebul"] = sim.ebullets.size()
		snap["bench_pk"] = sim.pickups.size()
	Playtest.publish(snap)


func _unhandled_input(ev: InputEvent) -> void:
	if sim == null:
		return
	if ev is InputEventKey and ev.pressed and not ev.echo:
		var k := (ev as InputEventKey).keycode
		if not sim.choice.is_empty():
			if k == KEY_1 or k == KEY_KP_1:
				on_choose(0)
			elif k == KEY_2 or k == KEY_KP_2:
				on_choose(1)
			elif k == KEY_3 or k == KEY_KP_3:
				on_choose(2)
			elif k == KEY_R and sim.rerolls > 0:
				on_reroll()
			return
		if sim.shop_open:
			if k == KEY_ESCAPE or k == KEY_ENTER:
				on_close_shop()
			elif k == KEY_1:
				on_buy(0)
			elif k == KEY_2:
				on_buy(1)
			elif k == KEY_3:
				on_buy(2)
			return
		if sim.ended:
			if k == KEY_ENTER or k == KEY_KP_ENTER or k == KEY_R or k == KEY_SPACE:
				restart()
			return
		if k == KEY_X and paused:
			give_up()
			return
		if k == KEY_ESCAPE or k == KEY_P:
			if not sim.over:
				toggle_pause()
		elif k == KEY_M:
			toggle_mute()


func on_choose(i: int) -> void:
	Audio.play("click")
	sim.choose(i)
	view.ring(sim.px, sim.py - 30.0, 120.0, Color("ffd36a"))


func on_reroll() -> void:
	Audio.play("click")
	sim.reroll()


func on_reroll_shop() -> void:
	if sim.reroll_shop():
		Audio.play("coin")


func on_buy(i: int) -> void:
	if sim.buy_relic(i):
		Audio.play("coin")


func on_close_shop() -> void:
	Audio.play("click")
	sim.close_shop()


func toggle_pause() -> void:
	paused = not paused
	Audio.play("click")
	hud.show_pause(paused)
	if touch_mode:
		touch.release_all()


func toggle_mute() -> void:
	Audio.set_muted(not Audio.muted)
	var sv := SaveData.load_save()
	sv.mute = Audio.muted
	SaveData.write_save(sv)


func give_up() -> void:
	if paused:
		paused = false
		hud.show_pause(false)
	sim.abandon()


func manual_save() -> void:
	save_run(true)


func to_title() -> void:
	request_title.emit()


func restart() -> void:
	request_restart.emit()
