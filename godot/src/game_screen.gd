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
var ember_batch := TriBatch.new()
var ember_tex: Texture2D
var hit_stop := 0.0
var bot: Bot = null
var flare_q := false
var _was_running := true
var _idle_redraws := 2
var _ended_redraws := 0
var _ember_t := 0.0


var last_cp := 0
var toast: Label
var toast_t := 0.0


func start(p_touch: bool, resume: Dictionary = {}) -> void:
	touch_mode = p_touch
	var sv := SaveData.load_save()
	var seed_v: int = Playtest.seed_value if Playtest.seed_value != 0 else int(Time.get_ticks_usec() & 0x7fffffff)
	if not resume.is_empty():
		seed_v = int(resume.get("seed_v", seed_v))
	var mode_id := String(resume.get("mode", sv.get("mode", "full")))
	var beacon_id := String(resume.get("beacon_id", resume.get("beacon", sv.get("beacon", "beacon_default"))))
	sim = Sim.new(seed_v, {"emit": true, "touch": touch_mode, "meta": sv.meta, "mode": mode_id, "beacon_id": beacon_id})
	if not resume.is_empty():
		sim.from_save(resume)
	elif sim.has_method("start_run"):
		sim.call("start_run", mode_id, beacon_id)
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
		ember_tex = Fx.glow()
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
	toast = UI.label("", 20, UI.GOLD, 5)
	toast.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast.offset_left = -320.0
	toast.offset_right = 320.0
	toast.offset_top = -96.0
	toast.offset_bottom = -56.0
	toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toast.modulate.a = 0.0
	toast.visible = false
	hud.root.add_child(toast)
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
	if ember_tex == null or embers.is_empty():
		return
	var v := get_viewport().get_visible_rect().size
	var t_sec := float(Time.get_ticks_msec()) / 1500.0
	var col := Color(1.0, 0.7, 0.3, 0.55)
	for e in embers:
		var s: float = 64.0 * float(e.s)
		var px: float = fmod(float(e.x) + sin(float(e.p) + t_sec) * 0.01, 1.0) * v.x
		var py: float = float(e.y) * v.y
		ember_batch.full(px - s * 0.5, py - s * 0.5, s, s, col)
	ember_batch.flush(c.get_canvas_item(), ember_tex)


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
	if toast == null:
		return
	toast.text = msg
	toast.modulate.a = 1.0
	toast.visible = true
	toast_t = 2.2


func _process(delta: float) -> void:
	if sim == null:
		return
	if bot == null and Playtest.autobot:
		bot = Bot.new(Bot.Kind.PROXY, sim.seed_v, [0, 1])
	if bot != null and not paused and (not sim.choice.is_empty() or sim.shop_open):
		bot.act(sim, 0.0)   # 三选一 / 商店：机器人做选择；战斗中的操作在下面每个子步里做（与 tests 的驱动方式一致）
	elif Playtest.enabled and Playtest.bench == 0 and not sim.choice.is_empty() and ((sim.choice.kind == "level" and sim.level > 2) or sim.choice.kind in ["chest", "swb", "fusion", "gift"]):
		on_choose(0)
	PerfStat.frame_done()
	if toast != null and toast_t > 0.0:
		toast_t -= delta
		var ta := clampf(toast_t / 0.5, 0.0, 1.0)
		toast.modulate.a = ta
		if ta <= 0.001:
			toast.visible = false
	elif toast != null and toast.visible and toast.modulate.a <= 0.001:
		toast.visible = false
	if sim.cp_serial != last_cp:
		last_cp = sim.cp_serial
		save_run()
	var extract_open := bool(sim.get("extract_choice_open"))
	var run := not paused and sim.choice.is_empty() and not sim.shop_open and not extract_open
	if run != _was_running:
		_was_running = run
		_idle_redraws = 2
	var modal := hud.modal_open() or extract_open
	# 余烬上飘（游玩时 30Hz 节流，暂停或弹窗打开时 0Hz 停止重绘）
	if run and not modal and ember_layer != null:
		_ember_t += delta
		if _ember_t >= 0.0333:
			var edt := _ember_t
			_ember_t = 0.0
			for e in embers:
				e.y -= float(e.v) * edt
				if e.y < -0.05:
					e.y = 1.05
					e.x = randf()
			ember_layer.queue_redraw()
	touch.active = touch_mode and not modal and not paused and not sim.over
	if touch_mode:
		if touch.consume_pause() and not sim.over and sim.choice.is_empty() and not sim.shop_open and not extract_open:
			toggle_pause()
	# 结算
	if sim.ended:
		if not saved_result:
			saved_result = true
			_ended_redraws = 2
			_save_result()
			hud.show_result(sim.result)
			Audio.music("title")
		if _ended_redraws > 0:
			_ended_redraws -= 1
			view.tick(delta)
		hud.tick(delta)
		_publish()
		return
	if run:
		var mv := Vector2.ZERO
		if touch_mode and touch.mag > 0.0:
			mv = touch.move
		else:
			mv = Input.get_vector("move_left", "move_right", "move_up", "move_down")
		if bot == null:
			sim.in_move = mv
		if Input.is_action_just_pressed("dash") or (touch_mode and touch.consume_dash()):
			sim.in_dash = true
		if (Input.is_action_just_pressed("skill") and not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT)) or (touch_mode and touch.consume_skill()):
			sim.in_skill = true
		if (Input.is_action_just_pressed("combo") and not Input.is_key_pressed(KEY_Q)) or (touch_mode and touch.consume_combo()):
			sim.in_combo = true
		if flare_q or (touch_mode and touch.consume_flare()):
			flare_q = false
			_trigger_flare()
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
				var sub := dt * (ts / steps) if ts > 1.0 else dt
				if bot != null:
					bot.act(sim, sub)
				sim.step(sub)
		PerfStat.add("sim_step", t_sim)
		if sim.phase == Sim.PH_BOSS and Audio.music_cur != "boss":
			Audio.music("boss")
	else:
		sim.in_dash = false
		sim.in_skill = false
		flare_q = false
	var need_view := run or _idle_redraws > 0 or view.fade > 0.01 or (sim.over and not sim.ended)
	if need_view:
		if not run and _idle_redraws > 0:
			_idle_redraws -= 1
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
	sim.xp = 0   # 压测不升级：小金刚吸魂会让三选一频繁弹出，挡住采样
	sim.hp = sim.maxhp
	if sim.t > 140.0:
		sim.t = 60.0
	if sim.lv("lei") < 5:
		sim.levels = {"fu": 5, "huanhuo": 5, "lei": 5, "jishu": 5, "zhongfu": 3, "zhuohun": 5, "tianyou": 3, "leiyin": 3, "tiangang": 5, "taomu": 5}
		sim.evo = {"fu": true, "huanhuo": true, "lei": true}
		sim.artifact = "sword"
		sim.sw_state = Sim.SW_STOW
		sim._recalc()
	if not sim.pet_on:
		for i in range(7):
			sim.grant_gourd("压测")   # 压测同时覆盖葫芦小金刚的弹体/特效渲染
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
	elif bool(sim.get("extract_choice_open")):
		scene = "extract"
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
	if sim.get("lantern_oil") != null:
		snap["oil"] = snappedf(float(sim.get("lantern_oil")), 0.1)
	if sim.get("abyss_depth") != null:
		snap["abyss_depth"] = int(sim.get("abyss_depth"))
	if sim.get("beacon_id") != null:
		snap["beacon_id"] = String(sim.get("beacon_id"))
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
	if sim.pet_on:
		snap["pet_rel"] = [int(sim.pet_pos.x - sim.px), int(sim.pet_pos.y - sim.py)]
		snap["pet_shots"] = sim.pet_shots.size()
		snap["pet_dmg"] = int(sim.dmg_by.get("pet", 0.0))
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
	if Playtest.bench > 0 or Playtest.autobot:
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
		snap["phase"] = sim.phase
		snap["lv"] = sim.level
	Playtest.publish(snap)


func _unhandled_input(ev: InputEvent) -> void:
	if sim == null:
		return
	var extract_open := bool(sim.get("extract_choice_open"))
	if ev is InputEventMouseButton and ev.pressed:
		var mb := ev as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			if not paused and sim.choice.is_empty() and not sim.shop_open and not extract_open and not sim.over and not sim.ended:
				flare_q = true
			return
	if ev is InputEventKey and ev.pressed and not ev.echo:
		var k := (ev as InputEventKey).keycode
		if extract_open:
			if k == KEY_E:
				on_extract()
			elif k == KEY_F:
				on_push_deeper()
			return
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
			elif k == KEY_4:
				on_buy(3)
			elif k == KEY_5:
				on_buy(4)
			return
		if sim.ended:
			if k == KEY_ENTER or k == KEY_KP_ENTER or k == KEY_R or k == KEY_SPACE:
				restart()
			return
		if k == KEY_X and paused:
			give_up()
			return
		if k == KEY_Q and not paused and not sim.over:
			flare_q = true
			return
		if k == KEY_ESCAPE or k == KEY_P:
			if not sim.over:
				toggle_pause()
		elif k == KEY_M:
			toggle_mute()


func _trigger_flare() -> void:
	if sim.has_method("trigger_flare"):
		var ok: Variant = sim.call("trigger_flare")
		if ok is bool and ok:
			view.ring(sim.px, sim.py - 20.0, 260.0, Color("ffd36a"))
			hud.force_redraw()


func on_extract() -> void:
	Audio.play("click")
	if sim.has_method("choose_extract"):
		sim.call("choose_extract")
	hud.force_redraw()


func on_push_deeper() -> void:
	Audio.play("click")
	if sim.has_method("choose_push_deeper"):
		sim.call("choose_push_deeper")
	var depth := int(sim.get("abyss_depth")) if sim.get("abyss_depth") != null else 2
	hud.show_banner("深入幽冥 • 第 %d 层（魂火 +45%%）" % depth, "#ff9a3c", true)
	hud.force_redraw()


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
