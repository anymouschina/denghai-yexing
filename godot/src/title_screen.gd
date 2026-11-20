class_name TitleScreen
extends CanvasLayer
## 标题页：主视觉 + Logo + 开始 / 灯坊强化 / 声音；点画面或 Enter / 空格 开始。

signal start_pressed
signal continue_pressed

var touch_mode := false
var root: Control
var shop: Control = null
var save: Dictionary
var rec_labels: Array = []
var started := false
var press: Label
var t := 0.0
var logo2: Label
var snd_btn: Button
var beacon_btn: Button
var beacon_desc: Label
var beacons: Array = []
var beacon_idx := 0
var run_exists := false


var art: TextureRect


func _ready() -> void:
	layer = 1
	save = SaveData.load_save()
	Audio.set_muted(bool(save.mute))
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = UI.theme()
	add_child(root)
	art = TextureRect.new()
	art.texture = load("res://assets/title_keyart.jpg")
	art.set_anchors_preset(Control.PRESET_FULL_RECT)
	art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(art)
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.36, 0.62, 1.0])
	g.colors = PackedColorArray([Color(0.04, 0.05, 0.12, 0.94), Color(0.04, 0.05, 0.12, 0.66), Color(0.04, 0.05, 0.12, 0.0), Color(0.04, 0.05, 0.12, 0.0)])
	var gt := GradientTexture2D.new()
	gt.gradient = g
	gt.fill_from = Vector2(0, 0.5)
	gt.fill_to = Vector2(1, 0.5)
	gt.width = 512
	gt.height = 8
	var shade := TextureRect.new()
	shade.texture = gt
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	shade.stretch_mode = TextureRect.STRETCH_SCALE
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(shade)
	_load_beacons()
	_build_left()
	_build_record()
	Audio.music("title")
	Playtest.publish({"scene": "title", "has_run": run_exists, "beacon": _cur_beacon_id()})


func _build_left() -> void:
	var inset := SafeArea.insets(get_viewport())
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	col.offset_left = 70.0 + minf(inset.x, 100.0)
	col.offset_right = 520.0
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 10)
	root.add_child(col)
	var logo := HBoxContainer.new()
	logo.add_theme_constant_override("separation", 0)
	col.add_child(logo)
	var sz := 104 if not touch_mode else 96
	var l1 := _logo("灯", sz, UI.PAPER)
	logo2 = _logo("骸", sz, UI.ORANGE)
	var l3 := _logo("夜行", sz, UI.PAPER)
	logo.add_child(l1)
	logo.add_child(logo2)
	logo.add_child(l3)
	var sub := UI.label("提 一 盏 灯 ，守 一 夜 村", 24, Color("d6d0f0"), 5)
	col.add_child(sub)
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 14)
	col.add_child(gap)
	var has_run: bool = save.has("run") and save.run is Dictionary and not (save.run as Dictionary).is_empty()
	run_exists = has_run
	if has_run:
		var bc := UI.button("继续本局（第 %d 段 • Lv %d）" % [int(save.run.get("seg", 0)) + 1, int(save.run.get("level", 1))], Vector2(320, 62), true, 26)
		bc.pressed.connect(_continue)
		col.add_child(bc)
	var bm := UI.button(_mode_label(), Vector2(320, 44), false, 21)
	bm.pressed.connect(func():
		save["mode"] = "quick" if String(save.get("mode", "full")) == "full" else "full"
		SaveData.write_save(save)
		bm.text = _mode_label())
	col.add_child(bm)
	beacon_btn = UI.button("", Vector2(320, 48), false, 21)
	beacon_btn.pressed.connect(_cycle_beacon)
	col.add_child(beacon_btn)
	beacon_desc = UI.label("", 16, UI.GOLD, 4)
	beacon_desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	beacon_desc.custom_minimum_size = Vector2(390, 0)
	col.add_child(beacon_desc)
	_refresh_beacon()
	var b1 := UI.button("开始夜行" if not has_run else "新开一局", Vector2(320, 58), not has_run, 30)
	b1.pressed.connect(_start)
	col.add_child(b1)
	var b2 := UI.button("灯坊 • 强化", Vector2(320, 54), false, 28)
	b2.pressed.connect(_open_shop)
	col.add_child(b2)
	snd_btn = UI.button(_snd_label(), Vector2(320, 54), false, 28)
	snd_btn.pressed.connect(_toggle_sound)
	col.add_child(snd_btn)
	var hr := HBoxContainer.new()
	hr.add_theme_constant_override("separation", 10)
	var bclr := UI.button("清空存档", Vector2(155, 44), false, 21)
	bclr.pressed.connect(_clear_save)
	hr.add_child(bclr)
	var bhelp := UI.button("怎么玩 / 存档", Vector2(155, 44), false, 21)
	bhelp.pressed.connect(_open_help)
	hr.add_child(bhelp)
	col.add_child(hr)
	press = UI.label("— 轻点画面开始 —" if touch_mode else "— 点击画面或按 Enter / 空格 开始 —", 19, UI.GOLD, 5)
	col.add_child(press)
	if touch_mode:
		col.add_child(UI.label("左侧拖动摇杆移动 • 右下「闪」冲刺 /「灯」挑灯爆焰 • 右上暂停", 17, Color("c9cdf0"), 4))
		col.add_child(UI.label("攻击全自动 • 升级点卡片选择 • 拿到飞剑后右下出现「剑」键", 17, Color("c9cdf0"), 4))
	else:
		col.add_child(UI.label("WASD 移动 • 空格 冲刺 • Q / 右键 挑灯爆焰 • Esc 暂停 • M 静音", 17, Color("c9cdf0"), 4))
		col.add_child(UI.label("攻击全自动 • 1 / 2 / 3 选卡 • E / J 飞剑 • R 小金刚合击", 17, Color("c9cdf0"), 4))
	col.add_child(UI.label("v2.2 • 引魂灯签 • 双阴律 • 五派羁绊 • 百万血终局 BOSS", 15, Color("8d93c4"), 3))


func _logo(text: String, size: int, color: Color) -> Label:
	var l := UI.label(text, size, color, 12)
	l.add_theme_color_override("font_shadow_color", Color(1.0, 0.54, 0.16, 0.65))
	l.add_theme_constant_override("shadow_offset_y", 6)
	l.add_theme_constant_override("shadow_outline_size", 16)
	return l


func _build_record() -> void:
	var inset := SafeArea.insets(get_viewport())
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UI.box(Color(0.06, 0.07, 0.17, 0.85), UI.INK, 12, 3))
	p.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	p.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	p.grow_vertical = Control.GROW_DIRECTION_BEGIN
	p.offset_right = -24.0 - minf(inset.z, 100.0)
	p.offset_bottom = -22.0 - minf(inset.w, 60.0)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(p)
	var gc := GridContainer.new()
	gc.columns = 2
	gc.add_theme_constant_override("h_separation", 26)
	p.add_child(gc)
	rec_labels.clear()
	for name in ["最久守夜", "持有魂火", "通关 / 出征"]:
		gc.add_child(UI.label(name, 19, Color("d8d2f5"), 3))
		var v := UI.label("", 20, UI.GOLD, 4)
		v.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		gc.add_child(v)
		rec_labels.append(v)
	_refresh_record()


func _refresh_record() -> void:
	rec_labels[0].text = UI.fmt_time(float(save.best))
	rec_labels[1].text = str(int(save.soul))
	rec_labels[2].text = "%d / %d" % [int(save.wins), int(save.runs)]


func _mode_label() -> String:
	return "模式：完整夜行 • 约18分钟" if String(save.get("mode", "full")) == "full" else "模式：疾速试炼 • 约15分钟"


func _load_beacons() -> void:
	beacons.clear()
	var raw: Variant = UI.load_json_safe("res://data/beacons.json")
	var default_id := "beacon_default"
	if raw is Dictionary:
		default_id = String((raw as Dictionary).get("defaultId", default_id))
		var arr: Variant = (raw as Dictionary).get("beacons", [])
		if arr is Array:
			beacons = arr
	elif raw is Array:
		beacons = raw
	if beacons.is_empty():
		beacons = [
			{"id": "beacon_default", "name": "安夜签", "subtitle": "常夜无劫", "desc": "标准难度，魂火 ×1.0", "danger": 0, "soul_mul": 1.0, "color": "#ffc977"},
			{"id": "beacon_mist", "name": "重雾签", "subtitle": "浓雾压灯", "desc": "妖物更强，魂火 ×1.35", "danger": 2, "soul_mul": 1.35, "color": "#7fe3ff"},
			{"id": "beacon_crimson", "name": "血月签", "subtitle": "血月临村", "desc": "精英频出，魂火 ×1.75", "danger": 4, "soul_mul": 1.75, "color": "#ff6a5a"},
			{"id": "beacon_abyss", "name": "幽冥签", "subtitle": "百鬼夜行", "desc": "极险幽冥，魂火 ×2.3", "danger": 7, "soul_mul": 2.3, "color": "#c08cff"},
		]
	var saved_id := String(save.get("beacon", default_id))
	beacon_idx = 0
	for i in range(beacons.size()):
		if String(beacons[i].get("id", "")) == saved_id:
			beacon_idx = i
			break
	save["beacon"] = _cur_beacon_id()


func _cur_beacon_id() -> String:
	if beacons.is_empty():
		return "beacon_default"
	return String(beacons[beacon_idx % beacons.size()].get("id", "beacon_default"))


func _cycle_beacon() -> void:
	if beacons.is_empty():
		return
	beacon_idx = (beacon_idx + 1) % beacons.size()
	save["beacon"] = _cur_beacon_id()
	SaveData.write_save(save)
	Audio.play("click")
	_refresh_beacon()


func _refresh_beacon() -> void:
	if beacons.is_empty() or beacon_btn == null:
		return
	var b: Dictionary = beacons[beacon_idx % beacons.size()]
	var bname := String(b.get("name", "安夜签"))
	var danger := int(b.get("danger", 0))
	var smul := float(b.get("soul_mul", 1.0))
	var col := Color(String(b.get("color", "#ffc977")))
	var d_txt := "险度+%d" % danger if danger > 0 else "标准"
	beacon_btn.text = "灯签：%s（%s • 魂×%s）" % [bname, d_txt, String.num(smul, 2)]
	beacon_btn.add_theme_stylebox_override("normal", UI.box(Color(0.1, 0.12, 0.26, 0.95), col, 14, 3))
	if beacon_desc != null:
		var sub := String(b.get("subtitle", ""))
		var desc := String(b.get("desc", ""))
		beacon_desc.text = ("%s • %s" % [sub, desc]) if (sub != "" and desc != "") else (desc if desc != "" else sub)
		beacon_desc.add_theme_color_override("font_color", col)


func _snd_label() -> String:
	return "声音：关" if Audio.muted else "声音：开"


func _toggle_sound() -> void:
	Audio.set_muted(not Audio.muted)
	save.mute = Audio.muted
	SaveData.write_save(save)
	snd_btn.text = _snd_label()
	Audio.play("click")


func _primary() -> void:
	_start()   # Enter / 点空白处 永远新开一局；「继续本局」是单独按钮


func _continue() -> void:
	if started:
		return
	started = true
	art.texture = null   # 进局内立即释放主视觉贴图显存
	Audio.play("click")
	continue_pressed.emit()


func _clear_save() -> void:
	Audio.play("click")
	SaveData.clear_all()
	save = SaveData.defaults()
	Audio.set_muted(false)
	get_tree().reload_current_scene()


func _open_help() -> void:
	Audio.play("click")
	if shop != null:
		return
	shop = Control.new()
	shop.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(shop)
	var dim := ColorRect.new()
	dim.color = Color(0.02, 0.03, 0.09, 0.9)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	shop.add_child(dim)
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 8)
	shop.add_child(col)
	var lines := [
		["怎 么 玩 / 存 档", 46, UI.GOLD],
		["移动：WASD/方向键（触屏：左半屏摇杆）  •  冲刺：空格（触屏「闪」）  •  飞剑：E/J（触屏「剑」）", 20, UI.PAPER],
		["每段 160 秒，段末清场；场地中央出现紫色光柱的「灯骸裂隙」，站定 1 秒进入（耗 1 灯芯、放弃本段三选一）", 20, UI.PAPER],
		["游商用灯芯换遗物；右侧「启程」领三选一馈赠后进入下一段；3 段之后是 BOSS", 20, UI.PAPER],
		["怎么存档：每段开场/进出裂隙/升级选择后自动存档；暂停菜单有「手动存档」", 22, UI.GHOST],
		["存在哪：Web 版存在浏览器 localStorage 键 denghai_yexing_save_v15（同时写 Godot 的 user://save.json）", 22, UI.GHOST],
		["怎么续档：刷新或重开页面后，标题页点「继续本局」；从最近的检查点继续", 22, UI.GHOST],
		["怎么清档：标题页点「清空存档」（会同时清掉魂火与强化，不可恢复）", 22, UI.GHOST],
	]
	for ln in lines:
		var l := UI.label(ln[0], ln[1], ln[2], 5)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size = Vector2(1000, 0)
		col.add_child(l)
	var back := UI.button("返回", Vector2(240, 54), true, 26)
	back.pressed.connect(_close_shop)
	back.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(back)


func _start() -> void:
	if started:
		return
	started = true
	Audio.play("click")
	start_pressed.emit()


func _process(delta: float) -> void:
	t += delta
	if press != null:
		press.modulate.a = 0.55 + 0.45 * sin(t * 4.0)
	if logo2 != null:
		logo2.modulate.a = 0.82 + 0.18 * sin(t * 2.4)


func _input(ev: InputEvent) -> void:
	if started:
		return
	if ev is InputEventKey and ev.pressed and not ev.echo:
		var k := (ev as InputEventKey).keycode
		if k == KEY_ESCAPE and shop != null:
			_close_shop()
		elif (k == KEY_ENTER or k == KEY_KP_ENTER or k == KEY_SPACE) and shop == null:
			_primary()
		elif k == KEY_M:
			_toggle_sound()
	elif ev is InputEventMouseButton and ev.pressed and shop == null:
		# 点在空白处（没有被按钮等控件接住）才算“点击画面开始”
		var hov := root.get_viewport().gui_get_hovered_control()
		if not (hov is Button):
			_primary()


# ---------------- 灯坊（局外强化）----------------
func _open_shop() -> void:
	Audio.play("click")
	if shop != null:
		return
	shop = Control.new()
	shop.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(shop)
	var dim := ColorRect.new()
	dim.color = Color(0.02, 0.03, 0.09, 0.86)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	shop.add_child(dim)
	_fill_shop()


func _fill_shop() -> void:
	for c in shop.get_children():
		if c is ColorRect:
			continue
		c.queue_free()
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 10)
	shop.add_child(col)
	var tl := UI.label("灯 坊 • 强 化", 52, UI.GOLD, 9)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	var sl := UI.label("持有魂火：%d" % int(save.soul), 26, UI.GHOST, 5)
	sl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sl)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 16)
	grid.add_theme_constant_override("v_separation", 12)
	var gc := CenterContainer.new()
	gc.add_child(grid)
	col.add_child(gc)
	for m in GameData.META:
		var lv := int(save.meta.get(m.id, 0))
		var maxed: bool = lv >= int(m.max)
		var cost: int = 0 if maxed else int(m.cost[lv])
		var b := Button.new()
		b.custom_minimum_size = Vector2(330, 96)
		b.focus_mode = Control.FOCUS_NONE
		var edge := UI.GOLD if maxed else UI.ORANGE
		b.add_theme_stylebox_override("normal", UI.box(Color(0.08, 0.1, 0.24, 0.97), edge, 12, 3))
		b.add_theme_stylebox_override("hover", UI.box(Color(0.12, 0.15, 0.32, 0.97), UI.GOLD, 12, 3))
		b.add_theme_stylebox_override("pressed", UI.box(Color(0.06, 0.08, 0.2, 0.97), UI.GOLD, 12, 3))
		b.add_theme_stylebox_override("disabled", UI.box(Color(0.08, 0.09, 0.16, 0.9), Color(0.3, 0.3, 0.4), 12, 3))
		b.disabled = maxed or int(save.soul) < cost
		var h := HBoxContainer.new()
		h.set_anchors_preset(Control.PRESET_FULL_RECT)
		h.offset_left = 10
		h.offset_right = -10
		h.add_theme_constant_override("separation", 10)
		h.mouse_filter = Control.MOUSE_FILTER_IGNORE
		b.add_child(h)
		var ic := UI.icon(m.icon, 64.0)
		h.add_child(ic)
		var v := VBoxContainer.new()
		v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		v.alignment = BoxContainer.ALIGNMENT_CENTER
		v.mouse_filter = Control.MOUSE_FILTER_IGNORE
		h.add_child(v)
		v.add_child(UI.label("%s  %d/%d" % [m.name, lv, int(m.max)], 24, UI.PAPER, 4))
		v.add_child(UI.label(m.desc, 17, Color("c9cdf0"), 3))
		v.add_child(UI.label("已满级" if maxed else "魂火 %d" % cost, 18, UI.GOLD if not maxed else UI.GHOST, 3))
		var mid: String = m.id
		b.pressed.connect(func():
			var cur := int(save.meta.get(mid, 0))
			var mm: Dictionary = {}
			for x in GameData.META:
				if x.id == mid:
					mm = x
			if cur < int(mm.max) and int(save.soul) >= int(mm.cost[cur]):
				save.soul = int(save.soul) - int(mm.cost[cur])
				save.meta[mid] = cur + 1
				SaveData.write_save(save)
				Audio.play("coin")
				_refresh_record()
				_fill_shop())
		grid.add_child(b)
	var back := UI.button("返回", Vector2(240, 58), true, 28)
	back.pressed.connect(_close_shop)
	back.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(back)


func _close_shop() -> void:
	Audio.play("click")
	if shop != null:
		shop.queue_free()
		shop = null
