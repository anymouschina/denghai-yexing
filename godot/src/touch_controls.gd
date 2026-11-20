class_name TouchControls
extends CanvasLayer
## 触屏控件：左侧浮动虚拟摇杆（死区 14% + 加速曲线）、右下「闪」与「剑」键、右上暂停。
## 全部按 touch index 各自追踪（可多点同时按），位置自动避开安全区。

var DEAD: float = GameData.MV.joystick.deadzone
var R: float = GameData.MV.joystick.radius

var active := false          # 对局中且无弹窗时才响应
var enabled := false
var move := Vector2.ZERO
var mag := 0.0
var dash_q := false
var skill_q := false
var combo_q := false
var flare_q := false
var has_pet := false
var combo_k := 1.0
var oil_k := 0.8
var flare_ready := true
var flare_active := false
var pause_q := false
var stick_id := -1
var origin := Vector2.ZERO
var knob := Vector2.ZERO
var btn_ids: Dictionary = {}   # index -> "dash"/"flare"/"skill"/"gourd"/"pause"
var inset := Vector4.ZERO
var dash_k := 1.0              # 冲刺冷却 0..1（1 = 就绪）
var has_sword := false
var sword_state := 0
var ctl: Control
var font: Font
var sim: Sim


func setup(p_sim: Sim, p_enabled: bool) -> void:
	sim = p_sim
	enabled = p_enabled
	layer = 9
	font = UI.font()
	ctl = Control.new()
	ctl.set_anchors_preset(Control.PRESET_FULL_RECT)
	ctl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ctl.draw.connect(_draw_ctl)
	add_child(ctl)
	visible = enabled


func vsize() -> Vector2:
	return get_viewport().get_visible_rect().size


func _btn_scale() -> float:
	var vy := vsize().y
	return clampf(vy / 720.0, 0.55, 1.0) if vy < 520.0 else 1.0


func btn_pos(which: String) -> Vector2:
	var v := vsize()
	var sc := _btn_scale()
	var rx := v.x - inset.z
	var by := v.y - inset.w
	match which:
		"dash":
			return Vector2(rx - 105.0 * sc, by - 105.0 * sc)
		"flare":
			return Vector2(rx - 105.0 * sc, by - 285.0 * sc)
		"skill":
			return Vector2(rx - 285.0 * sc, by - 105.0 * sc)
		"gourd":
			return Vector2(rx - 285.0 * sc, by - 285.0 * sc)
		"pause":
			return Vector2(rx - 54.0, inset.y + 54.0)
	return Vector2.ZERO


func btn_r(which: String) -> float:
	var sc := _btn_scale()
	var base: float = {"dash": 68.0, "flare": 56.0, "skill": 56.0, "gourd": 52.0, "pause": 34.0}[which]
	return base if which == "pause" else base * sc


func consume_dash() -> bool:
	var v := dash_q
	dash_q = false
	return v


func consume_flare() -> bool:
	var v := flare_q
	flare_q = false
	return v


func consume_combo() -> bool:
	var v := combo_q
	combo_q = false
	return v


func consume_skill() -> bool:
	var v := skill_q
	skill_q = false
	return v


func consume_pause() -> bool:
	var v := pause_q
	pause_q = false
	return v


func release_all() -> void:
	stick_id = -1
	move = Vector2.ZERO
	mag = 0.0
	btn_ids.clear()


func _curve(n: float) -> float:
	if n <= 0.0:
		return 0.0
	var J: Dictionary = GameData.MV.joystick
	return minf(1.0, float(J.curveBase) + (1.0 - float(J.curveBase)) * pow(n, float(J.curvePow)))


func _hit(which: String, p: Vector2) -> bool:
	return p.distance_to(btn_pos(which)) <= btn_r(which) + 12.0 * _btn_scale()


func _input(ev: InputEvent) -> void:
	if not enabled or not active:
		return
	if ev is InputEventScreenTouch:
		var st := ev as InputEventScreenTouch
		if st.pressed:
			for b in ["pause", "dash", "flare", "skill", "gourd"]:
				if (b == "gourd" and not has_pet):
					continue
				if (b == "skill" and not has_sword):
					continue
				if _hit(b, st.position):
					btn_ids[st.index] = b
					if b == "dash":
						dash_q = true
					elif b == "flare":
						flare_q = true
					elif b == "skill":
						skill_q = true
					elif b == "gourd":
						combo_q = true
					else:
						pause_q = true
					return
			var v := vsize()
			if stick_id == -1 and st.position.x < v.x * 0.5 and st.position.y > v.y * 0.14:
				stick_id = st.index
				origin = Vector2(clampf(st.position.x, inset.x + R * 0.7, v.x * 0.5), clampf(st.position.y, v.y * 0.3, v.y - inset.w - R * 0.5))
				knob = st.position
				_update_stick(st.position)
		else:
			if btn_ids.has(st.index):
				btn_ids.erase(st.index)
			if st.index == stick_id:
				stick_id = -1
				move = Vector2.ZERO
				mag = 0.0
	elif ev is InputEventScreenDrag:
		var sd := ev as InputEventScreenDrag
		if sd.index == stick_id:
			_update_stick(sd.position)


func _update_stick(p: Vector2) -> void:
	var d := p - origin
	var len := d.length()
	if len > R:
		d = d / len * R
		len = R
	knob = origin + d
	var n := minf(1.0, len / R)
	if n < DEAD:
		move = Vector2.ZERO
		mag = 0.0
		return
	mag = _curve((n - DEAD) / (1.0 - DEAD))
	move = d.normalized() * mag


func _process(_delta: float) -> void:
	if not enabled:
		return
	visible = active
	if not active and (stick_id != -1 or not btn_ids.is_empty()):
		release_all()
	has_sword = sim.has_sword()
	has_pet = sim.pet_on and sim.pet_dead_t <= 0.0
	combo_k = 1.0 - clampf(sim.combo_cd / float(GameData.GD.pet.comboCd), 0.0, 1.0)
	sword_state = sim.sw_state
	dash_k = 1.0 - clampf(sim.dash_cd / maxf(0.01, sim.s_dash_cd), 0.0, 1.0)
	var oil_v: Variant = sim.get("lantern_oil")
	var oil: float = float(oil_v) if oil_v != null else 80.0
	var ft_v: Variant = sim.get("flare_t")
	var ft: float = float(ft_v) if ft_v != null else 0.0
	oil_k = clampf(oil / 100.0, 0.0, 1.0)
	flare_active = ft > 0.0
	flare_ready = oil >= 25.0 and not flare_active
	inset = SafeArea.insets(get_viewport())
	inset = Vector4(minf(inset.x, 120), minf(inset.y, 60), minf(inset.z, 120), minf(inset.w, 60))
	if active:
		ctl.queue_redraw()


func _draw_ctl() -> void:
	var v := vsize()
	# 摇杆
	var base := origin if stick_id != -1 else Vector2(inset.x + 170.0, v.y - inset.w - 140.0)
	var kp := knob if stick_id != -1 else base
	ctl.draw_circle(base, R, Color(0.15, 0.17, 0.37, 0.28))
	ctl.draw_arc(base, R, 0, TAU, 48, Color(1.0, 0.6, 0.24, 0.6 if stick_id != -1 else 0.35), 4.0, true)
	ctl.draw_circle(kp, 44.0, Color(0.95, 0.55, 0.17, 0.78 if stick_id != -1 else 0.45))
	ctl.draw_arc(kp, 44.0, 0, TAU, 32, UI.INK, 3.0, true)
	# 闪
	var dp := btn_pos("dash")
	var pressed := btn_ids.values().has("dash")
	var rr := btn_r("dash") * (0.92 if pressed else 1.0)
	ctl.draw_circle(dp, rr, Color(0.1, 0.13, 0.28, 0.82))
	ctl.draw_arc(dp, rr - 2.0, -PI / 2.0, -PI / 2.0 + dash_k * TAU, 48, UI.GHOST, 8.0, true)
	if dash_k >= 1.0:
		ctl.draw_arc(dp, rr + 4.0, 0, TAU, 48, Color(0.5, 0.9, 1.0, 0.55), 4.0, true)
	ctl.draw_string(font, dp + Vector2(-38.5, 17.5), "闪", HORIZONTAL_ALIGNMENT_CENTER, 80.0, 44, UI.INK)
	ctl.draw_string(font, dp + Vector2(-40, 16), "闪", HORIZONTAL_ALIGNMENT_CENTER, 80.0, 44, UI.PAPER)
	# 挑灯（爆焰）
	var fp := btn_pos("flare")
	var prf := btn_ids.values().has("flare")
	var rf := btn_r("flare") * (0.92 if prf else 1.0)
	var fbg := Color(0.28, 0.17, 0.06, 0.88) if (flare_ready or flare_active) else Color(0.12, 0.11, 0.18, 0.78)
	ctl.draw_circle(fp, rf, fbg)
	var fcol := UI.GOLD if flare_active else (UI.ORANGE if flare_ready else Color(0.55, 0.42, 0.35))
	ctl.draw_arc(fp, rf - 2.0, -PI / 2.0, -PI / 2.0 + oil_k * TAU, 40, fcol, 7.0, true)
	if flare_ready or flare_active:
		ctl.draw_arc(fp, rf + 3.0, 0, TAU, 40, Color(1.0, 0.82, 0.42, 0.65 if flare_active else 0.42), 3.0, true)
	var flab := "焰" if flare_active else "灯"
	ctl.draw_string(font, fp + Vector2(-38.5, 16.5), flab, HORIZONTAL_ALIGNMENT_CENTER, 80.0, 40, UI.INK)
	ctl.draw_string(font, fp + Vector2(-40, 15), flab, HORIZONTAL_ALIGNMENT_CENTER, 80.0, 40, UI.GOLD if (flare_ready or flare_active) else Color(0.7, 0.7, 0.75))
	# 剑
	if has_sword:
		var sp := btn_pos("skill")
		var ready := sword_state == Sim.SW_STOW and sim.sw_cd <= 0.0
		var pr2 := btn_ids.values().has("skill")
		var r2 := btn_r("skill") * (0.92 if pr2 else 1.0)
		ctl.draw_circle(sp, r2, Color(0.1, 0.2, 0.3, 0.85))
		var col := UI.GHOST if (ready or sword_state == Sim.SW_ORBIT) else Color(0.5, 0.55, 0.7)
		if sword_state == Sim.SW_DROP:
			col = UI.BLOOD
		ctl.draw_arc(sp, r2, 0, TAU, 40, col, 6.0 if sword_state == Sim.SW_ORBIT else 4.0, true)
		var label := "剑" if sword_state != Sim.SW_ORBIT else "收"
		ctl.draw_string(font, sp + Vector2(-38.5, 16.5), label, HORIZONTAL_ALIGNMENT_CENTER, 80.0, 40, UI.INK)
		ctl.draw_string(font, sp + Vector2(-40, 15), label, HORIZONTAL_ALIGNMENT_CENTER, 80.0, 40, UI.PAPER)
	if has_pet:
		var gp := btn_pos("gourd")
		var prg := btn_ids.values().has("gourd")
		var rg := btn_r("gourd") * (0.92 if prg else 1.0)
		ctl.draw_circle(gp, rg, Color(0.25, 0.12, 0.3, 0.85))
		ctl.draw_arc(gp, rg - 2.0, -PI / 2.0, -PI / 2.0 + combo_k * TAU, 40, Color(1.0, 0.8, 0.3), 7.0, true)
		ctl.draw_string(font, gp + Vector2(-38.5, 16.5), "葫", HORIZONTAL_ALIGNMENT_CENTER, 80.0, 40, UI.INK)
		ctl.draw_string(font, gp + Vector2(-40, 15), "葫", HORIZONTAL_ALIGNMENT_CENTER, 80.0, 40, UI.PAPER)
	# 暂停
	var pp := btn_pos("pause")
	ctl.draw_circle(pp, btn_r("pause"), Color(0.1, 0.13, 0.28, 0.8))
	ctl.draw_arc(pp, btn_r("pause"), 0, TAU, 32, Color(1.0, 0.6, 0.24, 0.7), 3.0, true)
	ctl.draw_rect(Rect2(pp + Vector2(-10, -12), Vector2(7, 24)), UI.PAPER)
	ctl.draw_rect(Rect2(pp + Vector2(3, -12), Vector2(7, 24)), UI.PAPER)
