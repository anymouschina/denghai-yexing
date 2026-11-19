class_name Hud
extends CanvasLayer
## 对局界面：HUD（自绘）+ 三选一 / 游商 / 暂停 / 结算 面板（节点）+ 提示条。
## HUD 贴屏幕边并避开安全区；触屏下字号放大。

var game: Node
var sim: Sim
var root: Control
var canvas: Control
var inset := Vector4.ZERO
var touch_mode := false
var font: Font
var banner: Label
var banner_tw: Tween
var choice_panel: Control
var shop_panel: Control
var pause_panel: Control
var result_panel: Control
var shown_choice := -1
var shown_shop := -1
var hurt_flash := 0.0
var t := 0.0
var wick_tex: Texture2D
var icon_cache: Dictionary = {}
var hint_t := 0.0
var last_hp := 0.0
var rift_banner_shown := false


func setup(p_game: Node, p_sim: Sim, p_touch: bool) -> void:
	game = p_game
	sim = p_sim
	touch_mode = p_touch
	font = UI.font()
	layer = 10
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = UI.theme()
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	canvas = Control.new()
	canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.draw.connect(_draw_hud)
	root.add_child(canvas)
	wick_tex = load("res://assets/icons/wick.png")
	banner = UI.label("", 44, UI.GOLD, 8)
	banner.set_anchors_preset(Control.PRESET_CENTER_TOP)
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.custom_minimum_size = Vector2(900, 60)
	banner.position = Vector2(-450, 120)
	banner.modulate.a = 0.0
	root.add_child(banner)
	refresh_inset()
	get_viewport().size_changed.connect(refresh_inset)


func refresh_inset() -> void:
	inset = SafeArea.insets(get_viewport())
	# 防止异常大值把界面挤没
	inset = Vector4(minf(inset.x, 120), minf(inset.y, 60), minf(inset.z, 120), minf(inset.w, 60))


func show_banner(text: String, color: String = "#ffc977", big: bool = false) -> void:
	banner.text = text
	banner.add_theme_color_override("font_color", Color(color))
	banner.add_theme_font_size_override("font_size", 56 if big else 42)
	banner.modulate.a = 0.0
	banner.scale = Vector2(0.9, 0.9)
	banner.pivot_offset = banner.size / 2.0
	if banner_tw != null:
		banner_tw.kill()
	banner_tw = create_tween()
	banner_tw.tween_property(banner, "modulate:a", 1.0, 0.2)
	banner_tw.parallel().tween_property(banner, "scale", Vector2.ONE, 0.25).set_trans(Tween.TRANS_BACK)
	banner_tw.tween_interval(1.6)
	banner_tw.tween_property(banner, "modulate:a", 0.0, 0.5)


func flash_hurt() -> void:
	hurt_flash = 0.35


# ======================================================================
# 每帧
# ======================================================================
func tick(delta: float) -> void:
	t += delta
	hurt_flash = maxf(0.0, hurt_flash - delta)
	if sim.hp < last_hp - 0.01:
		hurt_flash = 0.3
	last_hp = sim.hp
	var vw := get_viewport().get_visible_rect().size
	banner.position = Vector2(vw.x / 2.0 - 450.0, 110.0 + inset.y)
	# 三选一
	if not sim.choice.is_empty():
		if shown_choice != sim.choice_serial:
			_build_choice()
			shown_choice = sim.choice_serial
	elif choice_panel != null and choice_panel.visible:
		choice_panel.visible = false
		shown_choice = -1
	# 游商
	if sim.shop_open:
		if shown_shop != sim.shop_serial:
			_build_shop()
			shown_shop = sim.shop_serial
	elif shop_panel != null and shop_panel.visible:
		shop_panel.visible = false
		shown_shop = -1
	canvas.queue_redraw()


func modal_open() -> bool:
	return (choice_panel != null and choice_panel.visible) or (shop_panel != null and shop_panel.visible) or (pause_panel != null and pause_panel.visible) or (result_panel != null and result_panel.visible)


# ======================================================================
# 自绘 HUD
# ======================================================================
func _fs(base: int) -> int:
	return int(base * (1.25 if touch_mode else 1.0))


func _bar(rect: Rect2, k: float, fill: Color, back: Color = Color(0.05, 0.06, 0.14, 0.9)) -> void:
	canvas.draw_rect(Rect2(rect.position - Vector2(3, 3), rect.size + Vector2(6, 6)), UI.INK)
	canvas.draw_rect(rect, back)
	canvas.draw_rect(Rect2(rect.position, Vector2(rect.size.x * clampf(k, 0.0, 1.0), rect.size.y)), fill)
	canvas.draw_rect(Rect2(rect.position, Vector2(rect.size.x * clampf(k, 0.0, 1.0), rect.size.y * 0.4)), Color(1, 1, 1, 0.16))


func _text(pos: Vector2, s: String, size: int, col: Color, w: float = -1.0, align: int = HORIZONTAL_ALIGNMENT_LEFT) -> void:
	canvas.draw_string_outline(font, pos, s, align, w, size, 6, UI.INK)
	canvas.draw_string(font, pos, s, align, w, size, col)


var owned_cache: Array = []
var owned_hash := -1
var portrait: Texture2D


func _draw_hud() -> void:
	var t_hd := Time.get_ticks_usec()
	_draw_hud_inner()
	PerfStat.add("hud_draw", t_hd)


func _draw_hud_inner() -> void:
	var vw := get_viewport().get_visible_rect().size
	if hurt_flash > 0.0:
		var a := clampf(hurt_flash / 0.3, 0.0, 1.0) * 0.28
		canvas.draw_rect(Rect2(Vector2.ZERO, vw), Color(0.85, 0.1, 0.1, a))
	if sim.hp < sim.maxhp * 0.3 and not sim.over:
		var a2 := 0.08 + 0.06 * sin(t * 6.0)
		canvas.draw_rect(Rect2(Vector2.ZERO, vw), Color(0.85, 0.1, 0.1, a2))
	var L := inset.x + 16.0
	var T := inset.y + 16.0
	var k := 1.0 if not touch_mode else 1.12
	# 顶部经验条（整幅）
	_bar(Rect2(inset.x, inset.y, vw.x - inset.x - inset.z, 8), float(sim.xp) / maxf(1.0, sim.need), Color("7fe3ff"))
	T += 12.0
	# 头像 + 生命
	if portrait == null:
		var at := AtlasTexture.new()
		at.atlas = load("res://assets/hero.png")
		at.region = Rect2(60, 8, 232, 232)
		portrait = at
	var ps := 78.0 * k
	canvas.draw_rect(Rect2(L - 3, T - 3, ps + 6, ps + 6), UI.INK)
	canvas.draw_rect(Rect2(L, T, ps, ps), Color(0.1, 0.12, 0.3))
	canvas.draw_texture_rect(portrait, Rect2(L, T, ps, ps), false)
	canvas.draw_rect(Rect2(L - 1, T - 1, ps + 2, ps + 2), UI.ORANGE, false, 3.0)
	var bx := L + ps + 14.0
	var barw := 300.0 * k
	_text(Vector2(bx, T + 20 * k), "Lv %d • 阿烛" % sim.level, _fs(22), UI.GHOST)
	_bar(Rect2(bx, T + 28 * k, barw, 24 * k), sim.hp / maxf(1.0, sim.maxhp), Color("e0463a") if sim.hp > sim.maxhp * 0.3 else Color("ff3a2a"))
	_text(Vector2(bx + 8, T + 47 * k), "%d / %d" % [int(ceil(sim.hp)), int(sim.maxhp)], _fs(20), UI.PAPER)
	# 构筑图标行
	var hsh := sim.levels.hash() + sim.evo.hash()
	if hsh != owned_hash:
		owned_hash = hsh
		owned_cache = sim.owned()
	var ox := bx
	var oy := T + 60.0 * k
	var isz := 38.0 * k
	for o in owned_cache:
		canvas.draw_rect(Rect2(ox - 2, oy - 2, isz + 4, isz + 4), UI.INK)
		canvas.draw_texture_rect(_icon(o.icon), Rect2(ox, oy, isz, isz), false)
		_text(Vector2(ox + isz - 14, oy + isz + 1), str(o.lv), _fs(16), UI.GOLD)
		ox += isz + 8.0
	# 灯芯 / 遗物 / 法宝
	var rx := bx
	var ry := oy + isz + 16.0
	canvas.draw_texture_rect(wick_tex, Rect2(rx, ry, 30 * k, 30 * k), false)
	_text(Vector2(rx + 34 * k, ry + 24 * k), "×%d" % sim.wicks, _fs(24), UI.GOLD)
	rx += 96.0 * k
	for rid in sim.relics:
		var r: Dictionary = GameData.RELIC_BY_ID[rid]
		canvas.draw_texture_rect(_icon(r.icon), Rect2(rx, ry, 30 * k, 30 * k), false)
		rx += 34.0 * k
	if sim.artifact == "sword":
		canvas.draw_texture_rect(_icon("sword"), Rect2(rx + 6, ry - 2, 34 * k, 34 * k), false)
		rx += 46.0 * k
	# 右上：击杀 / 魂火
	var rr := vw.x - inset.z - (110.0 if touch_mode else 24.0)
	_text(Vector2(rr - 240, T + 24 * k), "击杀  %d" % sim.kills, _fs(22), UI.PAPER, 240.0, HORIZONTAL_ALIGNMENT_RIGHT)
	_text(Vector2(rr - 240, T + 52 * k), "魂火  %d" % sim.soul_payout(), _fs(22), UI.GHOST, 240.0, HORIZONTAL_ALIGNMENT_RIGHT)
	# 顶部中央：大计时 + 段名
	var cx := vw.x / 2.0
	var tt := sim.clock if sim.phase != Sim.PH_RIFT else sim.rift_t
	_text(Vector2(cx - 200, T + 40 * k), UI.fmt_time(tt), _fs(46), UI.PAPER, 400.0, HORIZONTAL_ALIGNMENT_CENTER)
	var title := ""
	match sim.phase:
		Sim.PH_SEG:
			title = "%s  •  第 %d / 3 段  •  裂隙 %s 后开启" % [GameData.SEG.segments[sim.seg].name, sim.seg + 1, UI.fmt_time(maxf(0.0, (float(GameData.SEG.segments[sim.seg].to) - sim.t) * sim.stretch))]
		Sim.PH_BREAK:
			title = "段间 • 清场  •  %s 后自动启程" % UI.fmt_time(maxf(0.0, float(GameData.SEG["break"].max) - sim.break_t))
		Sim.PH_RIFT:
			title = "灯骸裂隙 • 剑灵"
		Sim.PH_BOSS:
			title = "终局 • 灯骸老祖"
	_text(Vector2(cx - 300, T + 68 * k), title, _fs(20), UI.GOLD, 600.0, HORIZONTAL_ALIGNMENT_CENTER)
	var yb := T + 80.0 * k
	if sim.phase == Sim.PH_RIFT:
		var rem := maxf(0.0, sim.rift_limit - sim.rift_t)
		var warn := rem < 15.0
		_text(Vector2(cx - 320, yb + 18), "限时 %s • 目标 %d 秒内击杀 • 限时 %d 秒" % [UI.fmt_time(rem), int(sim.rift_target), int(sim.rift_limit)], _fs(17), UI.BLOOD if warn else UI.PAPER, 640.0, HORIZONTAL_ALIGNMENT_CENTER)
		if sim.rift_warden != null:
			var w := sim.rift_warden
			_bar(Rect2(cx - 240, yb + 28, 480, 16), w.hp / maxf(1.0, w.maxhp), Color("b36bff"))
			_text(Vector2(cx - 300, yb + 62), "剑冢守关者「剑灵」• 御剑环身 • 回鞘突刺 • 剑雨", _fs(17), Color("d9b8ff"), 600.0, HORIZONTAL_ALIGNMENT_CENTER)
		_text(Vector2(cx - 340, yb + 84), "无补给 • 无三选一 • 骨灯全熄 • 冲刺冷却×1.25 • 受击硬直×1.2", _fs(15), Color("ff9a8a"), 680.0, HORIZONTAL_ALIGNMENT_CENTER)
	elif sim.boss != null and sim.boss.alive:
		var b := sim.boss
		_bar(Rect2(cx - 280, yb + 12, 560, 18), b.hp / maxf(1.0, b.maxhp), Color("b36bff"))
		_text(Vector2(cx - 300, yb + 50), "灯骸老祖", _fs(20), Color("d9b8ff"), 600.0, HORIZONTAL_ALIGNMENT_CENTER)
	elif sim.phase == Sim.PH_BREAK:
		_text(Vector2(cx - 420, yb + 22), "站定「启程」领三选一馈赠；站定「灯骸裂隙」则放弃它 • 游商用灯芯换遗物", _fs(17), UI.PAPER, 840.0, HORIZONTAL_ALIGNMENT_CENTER)
	# 段间：指向裂隙的箭头（离得远时）+ 状态牌
	if sim.phase == Sim.PH_BREAK:
		var rp := sim.break_pos("rift")
		var dv := rp - Vector2(sim.px, sim.py)
		var st_ := sim.rift_state()
		var lab := "灯骸裂隙" if st_ == "ok" else ("灯弱，不可入" if st_ == "weak" else ("灯芯不足" if st_ == "nowick" else "裂隙已封"))
		if dv.length() > 220.0:
			var dn := dv.normalized()
			var ctr := Vector2(vw.x / 2.0, vw.y / 2.0 + 20.0)
			var ap := ctr + dn * minf(vw.y * 0.34, 230.0)
			var pul := 1.0 + sin(t * 6.0) * 0.12
			var perp := Vector2(-dn.y, dn.x)
			canvas.draw_colored_polygon(PackedVector2Array([ap + dn * 26.0 * pul, ap - dn * 12.0 + perp * 20.0, ap - dn * 12.0 - perp * 20.0]), Color(0.85, 0.6, 1.0, 0.95))
			_text(ap - dn * 34.0 - Vector2(60, -8), "%s %dm" % [lab, int(dv.length() / 10.0)], _fs(18), Color(0.9, 0.75, 1.0), 120.0, HORIZONTAL_ALIGNMENT_CENTER)
	_draw_minimap(vw)
	# 大地图：指向最近剑冢裂隙的边缘箭头（离得远时）
	if sim.phase == Sim.PH_SEG:
		var best := -1
		var bdist := 1e9
		for i in range(sim.pois.size()):
			if sim.pois[i].kind != "sword":
				continue
			var dd := Vector2(float(sim.pois[i].x) - sim.px, float(sim.pois[i].y) - sim.py).length()
			if dd < bdist:
				bdist = dd
				best = i
		if best >= 0 and bdist > 520.0:
			var dn := Vector2(float(sim.pois[best].x) - sim.px, float(sim.pois[best].y) - sim.py).normalized()
			var ctr2 := Vector2(vw.x / 2.0, vw.y / 2.0)
			var ap2 := ctr2 + Vector2(dn.x * (vw.x * 0.5 - 70.0), dn.y * (vw.y * 0.5 - 60.0))
			var perp2 := Vector2(-dn.y, dn.x)
			canvas.draw_colored_polygon(PackedVector2Array([ap2 + dn * 20.0, ap2 - dn * 10.0 + perp2 * 14.0, ap2 - dn * 10.0 - perp2 * 14.0]), Color(0.85, 0.6, 1.0, 0.9))
			_text(ap2 - Vector2(70, -34) if dn.y > 0 else ap2 - Vector2(70, 20), "剑冢裂隙 %dm" % int(bdist / 10.0), 15, Color(0.9, 0.75, 1.0), 140.0, HORIZONTAL_ALIGNMENT_CENTER)
	# 底部提示（桌面）
	if not touch_mode:
		var tip2 := "WASD / 方向键 移动 • 空格 冲刺 • Esc 暂停"
		if sim.has_sword():
			tip2 = "WASD 移动 • 空格 冲刺 • E / J 飞剑（出鞘 〉 再按召回刺出）• Esc 暂停"
		_text(Vector2(cx - 450, vw.y * 0.0 + get_viewport().get_visible_rect().size.y - 18.0 - inset.w), tip2, 16, Color(0.8, 0.82, 0.95, 0.75), 900.0, HORIZONTAL_ALIGNMENT_CENTER)
	# 飞剑状态
	if sim.has_sword():
		var st := ""
		match sim.sw_state:
			Sim.SW_STOW: st = "飞剑 • 就绪（E / J 出鞘）" if sim.sw_cd <= 0.0 else "飞剑 • 收鞘 %.1f" % sim.sw_cd
			Sim.SW_ORBIT: st = "飞剑 • 回旋中 %.1fs（再按召回刺出）" % maxf(0.0, sim.sw_t)
			Sim.SW_RECALL: st = "飞剑 • 召回！"
			Sim.SW_DROP: st = "飞剑坠地 %.1fs" % maxf(0.0, sim.sw_t)
			Sim.SW_CD: st = "飞剑 • 归鞘 %.1f" % maxf(0.0, sim.sw_t)
		if touch_mode:
			st = st.replace("（E / J 出鞘）", "").replace("（再按召回刺出）", "")
		_text(Vector2(rx, ry + 24 * k), st, _fs(17), UI.GHOST if sim.sw_state != Sim.SW_DROP else UI.BLOOD)
		# 阶段：第 N 阶 + 已解锁攻击方式 + 下一阶需求
		var SS: Dictionary = GameData.DG.sword.stages
		var nms: Array = SS.names
		var line := "飞剑 第 %d / 5 阶 • 已解锁：%s" % [sim.sw_stage, " / ".join(PackedStringArray(sim.sword_unlocked()))]
		_text(Vector2(L, ry + 52 * k), line, _fs(16), UI.GOLD)
		if sim.sw_stage < 5:
			var nxt := "下一阶「%s」：剑意 %d / %d（击杀）或击败副本守关者" % [nms[sim.sw_stage], sim.sw_kills, int(SS.kills[sim.sw_stage - 1])]
			_text(Vector2(L, ry + 74 * k), nxt, _fs(15), Color(0.8, 0.9, 1.0))
		else:
			_text(Vector2(L, ry + 74 * k), "飞剑已臻圆满", _fs(15), Color(0.8, 0.9, 1.0))
	if sim.fusion != "":
		_text(Vector2(L, T + 190 * k), "融合 • %s" % GameData.DG.fusion.names[sim.fusion], _fs(17), Color(1.0, 0.85, 0.4))


func _draw_minimap(vw: Vector2) -> void:
	# 右上小地图：全图缩略 + 探索足迹 + 玩家 + 剑冢裂隙入口 + 宝箱；触屏时下移避开暂停键
	var mw := 190.0 if not touch_mode else 170.0
	var mh := mw * Sim.H / Sim.W
	var x0 := vw.x - inset.z - mw - 14.0
	var y0 := inset.y + (84.0 if touch_mode else 96.0)
	canvas.draw_rect(Rect2(x0 - 3, y0 - 3, mw + 6, mh + 6), Color(0.04, 0.05, 0.12, 0.7))
	var cw := mw / 36.0
	var ch := mh / 24.0
	for gy in range(24):
		for gx in range(36):
			if sim.explored.size() == 864 and sim.explored[gy * 36 + gx] == 1:
				canvas.draw_rect(Rect2(x0 + gx * cw, y0 + gy * ch, cw, ch), Color(0.35, 0.45, 0.75, 0.35))
	canvas.draw_rect(Rect2(x0, y0, mw, mh), UI.ORANGE, false, 2.0)
	for pp in sim.pois:
		var st_ := Color(0.8, 0.45, 1.0) if pp.kind == "sword" else Color(1.0, 0.8, 0.3)
		canvas.draw_circle(Vector2(x0 + float(pp.x) / Sim.W * mw, y0 + float(pp.y) / Sim.H * mh), 5.0, st_)
	for k in sim.pickups:
		if k.kind == "chest":
			canvas.draw_rect(Rect2(x0 + k.x / Sim.W * mw - 3, y0 + k.y / Sim.H * mh - 3, 6, 6), Color(1.0, 0.85, 0.3))
	canvas.draw_circle(Vector2(x0 + sim.px / Sim.W * mw, y0 + sim.py / Sim.H * mh), 4.0, Color(0.5, 1.0, 1.0))
	canvas.draw_rect(Rect2(x0 + sim.px / Sim.W * mw - 7, y0 + sim.py / Sim.H * mh - 4, 14, 8), Color(1, 1, 1, 0.5), false, 1.0)


func _icon(id: String) -> Texture2D:
	if icon_cache.has(id):
		return icon_cache[id]
	var t_: Texture2D = load("res://assets/icons/%s.png" % id)
	icon_cache[id] = t_
	return t_


# ======================================================================
# 面板
# ======================================================================
func _dim(parent: Control) -> ColorRect:
	var d := ColorRect.new()
	d.color = Color(0.02, 0.03, 0.09, 0.78)
	d.set_anchors_preset(Control.PRESET_FULL_RECT)
	d.mouse_filter = Control.MOUSE_FILTER_STOP
	parent.add_child(d)
	return d


func _clear(c: Control) -> void:
	for ch in c.get_children():
		ch.queue_free()


func _card(icon_id: String, name_: String, sub: String, desc: String, edge: Color, size: Vector2, cost: String = "") -> Button:
	var b := Button.new()
	b.custom_minimum_size = size
	b.focus_mode = Control.FOCUS_NONE
	var base := Color(0.08, 0.1, 0.24, 0.97)
	b.add_theme_stylebox_override("normal", UI.box(base, edge, 14, 4))
	b.add_theme_stylebox_override("hover", UI.box(base.lightened(0.14), edge.lightened(0.3), 14, 5))
	b.add_theme_stylebox_override("pressed", UI.box(base.darkened(0.2), edge, 14, 4))
	b.add_theme_stylebox_override("disabled", UI.box(Color(0.1, 0.1, 0.16, 0.9), Color(0.3, 0.3, 0.4), 14, 4))
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.offset_left = 14
	v.offset_right = -14
	v.offset_top = 14
	v.offset_bottom = -12
	v.add_theme_constant_override("separation", 6)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(v)
	var ic := UI.icon(icon_id, 92.0)
	ic.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	v.add_child(ic)
	var n := UI.label(name_, 32, UI.PAPER, 5)
	n.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(n)
	var sl := UI.label(sub, 19, edge, 4)
	sl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(sl)
	var d := UI.label(desc, 19, Color("d8d2f5"), 3)
	d.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	d.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(d)
	if cost != "":
		var c := UI.label(cost, 24, UI.GOLD, 5)
		c.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(c)
	return b


func _modal_shell(kind: String) -> Control:
	var c := Control.new()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_STOP
	c.name = kind
	root.add_child(c)
	_dim(c)
	return c


func _build_choice() -> void:
	if choice_panel != null:
		choice_panel.queue_free()
	choice_panel = _modal_shell("choice")
	var ch: Dictionary = sim.choice
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 18)
	choice_panel.add_child(col)
	var title := "灯 火 渐 盛"
	var sub := "Lv %d • 选择一项" % (sim.level - sim.pending_lv)
	if ch.kind == "chest":
		title = "宝 箱 开 启"
		sub = "精英遗宝 • 已有构筑一次 +%d 级 • 选择一项" % int(GameData.BAL.drops.chestLevels)
	elif ch.kind == "swb":
		title = "剑 意 分 叉"
		sub = "飞剑进阶 • 选择一项可选增益（不影响主干）"
	elif ch.kind == "fusion":
		title = "融 合"
		sub = "飞剑与武器合璧 • 选择一种融合效果"
	elif ch.kind == "gift":
		title = "启 程 馈 赠"
		sub = "段间馈赠 • 选择一项后出发（进裂隙则放弃它）"
	var tl := UI.label(title, 56 if not touch_mode else 50, UI.GOLD, 9)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	var sl := UI.label(sub, 22, Color("d6d0f0"), 4)
	sl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sl)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 22)
	col.add_child(row)
	var vh := get_viewport().get_visible_rect().size.y
	var card_h := minf(340.0, vh - 250.0)
	var i := 0
	for o in ch.options:
		var edge: Color = UI.RARITY.get(o.get("rarity", "white"), UI.PAPER)
		var cardb := _card(o.icon, o.name, o.get("lvText", ""), o.get("desc", ""), edge, Vector2(300, card_h))
		var idx := i
		cardb.pressed.connect(func(): game.on_choose(idx))
		var kl := UI.label(str(i + 1), 22, UI.GOLD, 4)
		kl.position = Vector2(12, 8)
		cardb.add_child(kl)
		row.add_child(cardb)
		UI.pop_in(cardb, 0.06 * i)
		i += 1
	var rr := UI.button("换一批（剩 %d 次）" % sim.rerolls, Vector2(280, 54), false, 24)
	rr.disabled = sim.rerolls <= 0
	rr.pressed.connect(func(): game.on_reroll())
	rr.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(rr)
	var hint := UI.label("" if touch_mode else "按 1 / 2 / 3 选择", 18, Color(0.8, 0.82, 0.95, 0.8), 3)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(hint)


func _build_shop() -> void:
	if shop_panel != null:
		shop_panel.queue_free()
	shop_panel = _modal_shell("shop")
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 16)
	shop_panel.add_child(col)
	var tl := UI.label("游 商 • 灯芯换遗物", 50, UI.GOLD, 9)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	var sl := UI.label("手里的灯芯：%d 枚（进裂隙也要灯芯，别花光）" % sim.wicks, 22, Color("d6d0f0"), 4)
	sl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sl)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 22)
	col.add_child(row)
	var vh := get_viewport().get_visible_rect().size.y
	var card_h := minf(340.0, vh - 260.0)
	var i := 0
	for rid in sim.shop:
		var r: Dictionary = GameData.RELIC_BY_ID[rid]
		var cb := _card(r.icon, r.name, "遗物", r.desc, UI.GOLD, Vector2(280, card_h), "灯芯 ×%d" % int(GameData.DG.wick.relicCost))
		cb.disabled = sim.wicks < int(GameData.DG.wick.relicCost)
		var idx := i
		cb.pressed.connect(func(): game.on_buy(idx))
		row.add_child(cb)
		UI.pop_in(cb, 0.06 * i)
		i += 1
	if sim.shop.is_empty():
		col.add_child(UI.label("游商的货卖光了", 26, UI.PAPER, 4))
	var leave := UI.button("离开", Vector2(240, 56), true, 28)
	leave.pressed.connect(func(): game.on_close_shop())
	leave.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(leave)


func show_pause(on: bool) -> void:
	if pause_panel != null:
		pause_panel.queue_free()
		pause_panel = null
	if not on:
		return
	pause_panel = _modal_shell("pause")
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 14)
	pause_panel.add_child(col)
	var tl := UI.label("暂 停", 56, UI.GOLD, 9)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	col.add_child(_build_row(sim.owned(), "构筑"))
	if sim.relics.size() > 0:
		var rl: Array = []
		for rid in sim.relics:
			var r: Dictionary = GameData.RELIC_BY_ID[rid]
			rl.append({"icon": r.icon, "lv": "", "name": r.name})
		col.add_child(_build_row(rl, "遗物"))
	var info := UI.label("灯芯 ×%d  •  已入裂隙 %d / %d 次%s" % [sim.wicks, sim.rift_entries, int(GameData.DG.rift.maxEntries), "  •  法宝：飞剑术" if sim.artifact == "sword" else ""], 22, UI.GOLD, 4)
	info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(info)
	var bc := CenterContainer.new()
	col.add_child(bc)
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 20)
	bc.add_child(hb)
	var b1 := UI.button("继续", Vector2(220, 58), true)
	b1.pressed.connect(func(): game.toggle_pause())
	hb.add_child(b1)
	var b2 := UI.button("声音：%s" % ("关" if Audio.muted else "开"), Vector2(220, 58))
	b2.pressed.connect(func():
		game.toggle_mute()
		b2.text = "声音：%s" % ("关" if Audio.muted else "开"))
	hb.add_child(b2)
	var b2s := UI.button("手动存档", Vector2(220, 58))
	b2s.pressed.connect(func(): game.manual_save())
	hb.add_child(b2s)
	var b3 := UI.button("回标题", Vector2(220, 58))
	b3.pressed.connect(func(): game.to_title())
	hb.add_child(b3)
	var hint := UI.label("" if touch_mode else "Esc 继续", 18, Color(0.8, 0.82, 0.95, 0.8), 3)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(hint)
	UI.pop_in(col)


func _build_row(list: Array, title: String) -> Control:
	var v := VBoxContainer.new()
	var tl := UI.label(title, 20, Color("d6d0f0"), 3)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(tl)
	var h := HBoxContainer.new()
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_theme_constant_override("separation", 10)
	v.add_child(h)
	for it in list:
		var cell := VBoxContainer.new()
		var ic := UI.icon(it.icon, 56.0)
		cell.add_child(ic)
		var l := UI.label("%s %s" % [it.name, it.lv] if it.lv != "" else it.name, 15, UI.PAPER, 3)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cell.add_child(l)
		h.add_child(cell)
	return v


func show_result(r: Dictionary) -> void:
	if result_panel != null:
		result_panel.queue_free()
	result_panel = _modal_shell("result")
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 12)
	result_panel.add_child(col)
	var win: bool = r.victory
	var tl := UI.label("灯骸伏诛 • 天明" if win else "灯 灭 了", 64, UI.GOLD if win else UI.BLOOD, 10)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	var cause := ""
	if not win and r.cause != "":
		cause = "  •  倒在 %s" % _cause_name(r.cause)
	var l1 := UI.label("守夜 %s  •  等级 %d  •  击杀 %d%s" % [UI.fmt_time(r.time), r.level, r.kills, cause], 26, UI.PAPER, 5)
	l1.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(l1)
	var rifts := 0
	var clears := 0
	for e in r.rift:
		rifts += 1
		if e.ok:
			clears += 1
	var l2 := UI.label("输出最高：%s  •  入裂隙 %d 次（通关 %d）%s" % [r.top, rifts, clears, "  •  法宝：飞剑术" if r.artifact == "sword" else ""], 22, Color("d6d0f0"), 4)
	l2.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(l2)
	col.add_child(_build_row(r.build, "本局构筑"))
	var l3 := UI.label("获得魂火 +%d" % r.soul, 34, UI.GHOST, 6)
	l3.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(l3)
	var bc := CenterContainer.new()
	col.add_child(bc)
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 22)
	bc.add_child(hb)
	var b1 := UI.button("再来一局", Vector2(250, 62), true)
	b1.pressed.connect(func(): game.restart())
	hb.add_child(b1)
	var b2 := UI.button("回标题", Vector2(220, 62))
	b2.pressed.connect(func(): game.to_title())
	hb.add_child(b2)
	var hint := UI.label("种子 %d%s" % [r.seed, "" if touch_mode else "  •  Enter / R 再来一局"], 18, Color(0.8, 0.82, 0.95, 0.8), 3)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(hint)
	UI.pop_in(col)


func _cause_name(c: String) -> String:
	var names := {"paperman": "纸扎人", "foxfire": "狐火", "lantern": "破灯笼妖", "jiangshi": "跳尸", "firecracker": "爆竹鬼", "boss": "灯骸老祖", "warden": "守关者", "elite_jiangshi": "跳尸王", "elite_lantern": "破灯笼王"}
	var p := c.split(":")
	var base: String = names.get(p[0], p[0])
	var how: String = {"contact": "撞击", "bullet": "鬼火", "slam": "震击", "blast": "爆炸"}.get(p[1] if p.size() > 1 else "", "")
	return base + how
