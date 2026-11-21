class_name Hud
extends CanvasLayer
## 对局界面：HUD（自绘）+ 三选一 / 游商 / 暂停 / 结算 面板（节点）+ 提示条。
## HUD 贴屏幕边并避开安全区；触屏下字号放大。

var game: Node
var sim: Sim
var root: Control
var hud_vp: SubViewport
var hud_rect: TextureRect
var canvas: Control
var _vp_last_phys := Vector2i.ZERO
var _vp_last_log := Vector2i.ZERO
var inset := Vector4.ZERO
var touch_mode := false
var font: Font
var banner: Label
var banner_tw: Tween
var choice_panel: Control
var shop_panel: Control
var pause_panel: Control
var result_panel: Control
var extract_panel: Control
var shown_choice := -1
var shown_shop := -1
var hurt_flash := 0.0
var t := 0.0
var wick_tex: Texture2D
var icon_cache: Dictionary = {}
var hint_t := 0.0
var last_hp := 0.0
var rift_banner_shown := false

# HUD 脏检查与缓存（避免每帧 60Hz 全量文本重排与字符串拼接）
var _redraw_t := 0.0
var _dirty := true
var _last_state_sig := -1
var _mm_rect := Rect2()
var _mm_draw := false
var _arrow_pts := PackedVector2Array([Vector2.ZERO, Vector2.ZERO, Vector2.ZERO])

var _c_lv := -1
var _c_depth := -1
var _s_lv := ""
var _c_hp := -1
var _c_maxhp := -1
var _s_hp := ""
var _c_oil := -1
var _c_lstate := ""
var _c_flare_ds := -99
var _s_oil := ""
var _s_lstate := ""
var _s_flare := ""
var _c_wound_ds := 0
var _c_slow_ds := 0
var _s_wound := ""
var _s_slow := ""
var _c_kills := -1
var _s_kills := ""
var _c_soul := -1
var _s_soul := ""
var _c_coins := -1
var _s_coins := ""
var _c_clock := -1
var _s_clock := ""
var _c_sets_sig := ""
var _s_sets := ""
var _c_rules_serial := -1
var _rules_disp: Array = []
var _c_schools_serial := -1
var _schools_disp: Array = []

var _rules_by_id: Dictionary = {}
var _schools_by_id: Dictionary = {}
var _sets_by_id: Dictionary = {}
var _beacons_by_id: Dictionary = {}

const GCOLS := {"red": Color("ff4a3a"), "orange": Color("ff9a3c"), "yellow": Color("ffe04a"), "green": Color("5ade6a"), "cyan": Color("4adfe0"), "blue": Color("4a7aff"), "purple": Color("b05aff")}
const POI_COLS := {"sword": Color(0.8, 0.45, 1.0), "merchant": Color(1.0, 0.8, 0.3), "vine": Color(0.4, 1.0, 0.5), "gourd": Color(0.5, 1.0, 0.8), "vault": Color(1.0, 0.4, 0.3), "altar": Color(0.6, 0.8, 1.0), "arch": Color(1.0, 0.7, 0.4), "tomb": Color(0.8, 0.6, 1.0), "incense": Color(1.0, 0.5, 0.4), "coinfarm": Color(1.0, 0.9, 0.2), "soulfarm": Color(0.4, 0.8, 1.0)}
const SCHOOL_ICONS := {
	"符": "school_fu", "fu": "school_fu",
	"阵": "school_zhen", "zhen": "school_zhen",
	"蛊": "school_gu", "gu": "school_gu",
	"煞": "school_sha", "sha": "school_sha",
	"魂": "school_hun", "hun": "school_hun",
}
const OPT_HUD_ICONS := [
	"flare",
	"school_fu", "school_zhen", "school_gu", "school_sha", "school_hun",
	"oil", "lotus", "flame", "frenzy", "ward", "echo",
]


func setup(p_game: Node, p_sim: Sim, p_touch: bool) -> void:
	game = p_game
	sim = p_sim
	touch_mode = p_touch
	font = UI.font()
	layer = 10
	_load_ui_data()
	hud_vp = SubViewport.new()
	hud_vp.name = "HudSubViewport"
	hud_vp.transparent_bg = true
	hud_vp.handle_input_locally = false
	hud_vp.disable_3d = true
	hud_vp.gui_disable_input = true
	hud_vp.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	hud_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	hud_vp.size_2d_override_stretch = true
	add_child(hud_vp)
	canvas = Control.new()
	canvas.name = "HudCanvas"
	canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.draw.connect(_draw_hud)
	hud_vp.add_child(canvas)
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = UI.theme()
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	hud_rect = TextureRect.new()
	hud_rect.name = "HudCanvasRect"
	hud_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	hud_rect.stretch_mode = TextureRect.STRETCH_SCALE
	hud_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud_rect.texture = hud_vp.get_texture()
	root.add_child(hud_rect)
	wick_tex = load("res://assets/icons/wick.png")
	_build_hud_batch()
	banner = UI.label("", 26, UI.GOLD, 6)
	banner.set_anchors_preset(Control.PRESET_CENTER_TOP)
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.custom_minimum_size = Vector2(560, 50)
	banner.position = Vector2(-280, 128)
	banner.modulate.a = 0.0
	banner.visible = false
	root.add_child(banner)
	refresh_inset()
	get_viewport().size_changed.connect(refresh_inset)


func _load_ui_data() -> void:
	_rules_by_id.clear()
	_schools_by_id.clear()
	_sets_by_id.clear()
	_beacons_by_id.clear()
	var rraw: Variant = UI.load_json_safe("res://data/rules.json")
	if rraw is Dictionary:
		for r in (rraw as Dictionary).get("rules", []):
			if r is Dictionary and r.has("id"):
				_rules_by_id[String(r.id)] = r
	var sraw: Variant = UI.load_json_safe("res://data/sets.json")
	if sraw is Dictionary:
		for st in (sraw as Dictionary).get("sets", []):
			if st is Dictionary and st.has("id"):
				_sets_by_id[String(st.id)] = st
		for sc in (sraw as Dictionary).get("schools", []):
			if sc is Dictionary and sc.has("id"):
				_schools_by_id[String(sc.id)] = sc
	elif sraw is Array:
		for st in sraw:
			if st is Dictionary and st.has("id"):
				_sets_by_id[String(st.id)] = st
	if _sets_by_id.is_empty():
		for k in GameData.SET_BY_ID:
			_sets_by_id[String(k)] = GameData.SET_BY_ID[k]
	var braw: Variant = UI.load_json_safe("res://data/beacons.json")
	if braw is Dictionary:
		for b in (braw as Dictionary).get("beacons", []):
			if b is Dictionary and b.has("id"):
				_beacons_by_id[String(b.id)] = b


func force_redraw() -> void:
	_dirty = true


func _sync_hud_viewport() -> void:
	if hud_vp == null:
		return
	var vp := get_viewport()
	if vp == null:
		return
	var vw := vp.get_visible_rect().size
	var log_sz := Vector2i(maxi(1, int(round(vw.x))), maxi(1, int(round(vw.y))))
	var sc := vp.get_final_transform().get_scale()
	var sx := clampf(absf(sc.x), 0.5, 2.0)
	var sy := clampf(absf(sc.y), 0.5, 2.0)
	var phys_sz := Vector2i(maxi(1, int(round(vw.x * sx))), maxi(1, int(round(vw.y * sy))))
	if phys_sz != _vp_last_phys or log_sz != _vp_last_log:
		_vp_last_phys = phys_sz
		_vp_last_log = log_sz
		hud_vp.size = phys_sz
		hud_vp.size_2d_override = log_sz
		if canvas != null:
			canvas.position = Vector2.ZERO
			canvas.size = Vector2(log_sz)
		_dirty = true


func _request_hud_redraw() -> void:
	if not visible:
		return
	_sync_hud_viewport()
	if hud_vp != null:
		hud_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	if canvas != null:
		canvas.queue_redraw()


func refresh_inset() -> void:
	inset = SafeArea.insets(get_viewport())
	# 防止异常大值把界面挤没
	inset = Vector4(minf(inset.x, 120), minf(inset.y, 60), minf(inset.z, 120), minf(inset.w, 60))
	_sync_hud_viewport()
	_dirty = true
	_request_hud_redraw()


func show_banner(text: String, color: String = "#ffc977", big: bool = false) -> void:
	banner.text = text
	banner.add_theme_color_override("font_color", Color(color))
	banner.add_theme_font_size_override("font_size", 26)
	banner.visible = true
	banner.modulate.a = 0.0
	var target_scale := Vector2(1.3, 1.3) if big else Vector2.ONE
	banner.scale = target_scale * 0.9
	banner.pivot_offset = banner.size / 2.0
	var vw := get_viewport().get_visible_rect().size
	banner.position = Vector2(vw.x / 2.0 - 360.0, 220.0 + inset.y)
	if banner_tw != null:
		banner_tw.kill()
	banner_tw = create_tween()
	banner_tw.tween_property(banner, "modulate:a", 1.0, 0.2)
	banner_tw.parallel().tween_property(banner, "scale", target_scale, 0.25).set_trans(Tween.TRANS_BACK)
	banner_tw.tween_interval(1.6)
	banner_tw.tween_property(banner, "modulate:a", 0.0, 0.5)
	banner_tw.tween_callback(func() -> void: banner.visible = false)


func flash_hurt() -> void:
	hurt_flash = 0.35
	_dirty = true


# ======================================================================
# 每帧
# ======================================================================
func tick(delta: float) -> void:
	t += delta
	var prev_flash := hurt_flash
	hurt_flash = maxf(0.0, hurt_flash - delta)
	if sim.hp < last_hp - 0.01:
		hurt_flash = 0.3
		_dirty = true
	last_hp = sim.hp
	if banner != null and banner.visible:
		if banner.modulate.a <= 0.001 and (banner_tw == null or not banner_tw.is_running()):
			banner.visible = false
		else:
			var vw := get_viewport().get_visible_rect().size
			banner.position = Vector2(vw.x / 2.0 - 360.0, 220.0 + inset.y)
	# 幽冥抉择（Boss 战后撤离/深入）
	var ext_open := bool(sim.get("extract_choice_open"))
	if ext_open:
		if extract_panel == null or not extract_panel.visible:
			_build_extract_modal()
			_dirty = true
	elif extract_panel != null and extract_panel.visible:
		extract_panel.visible = false
		_dirty = true
	# 三选一
	if not sim.choice.is_empty():
		if shown_choice != sim.choice_serial:
			_build_choice()
			shown_choice = sim.choice_serial
			_dirty = true
	elif choice_panel != null and choice_panel.visible:
		choice_panel.visible = false
		shown_choice = -1
		_dirty = true
	# 游商
	if sim.shop_open:
		if shown_shop != sim.shop_serial:
			_build_shop()
			shown_shop = sim.shop_serial
			_dirty = true
	elif shop_panel != null and shop_panel.visible:
		shop_panel.visible = false
		shown_shop = -1
		_dirty = true
	var mopen := modal_open()
	if mopen and hurt_flash <= 0.0 and prev_flash <= 0.0:
		if _dirty:
			_dirty = false
			_request_hud_redraw()
		return
	_redraw_t += delta
	var sig := sim.level + (sim.phase << 10) + (sim.seg << 14) + (sim.wicks << 18) + (sim.relics.size() << 24) + (sim.gourds.size() << 32)
	if sig != _last_state_sig:
		_last_state_sig = sig
		_dirty = true
	if _sync_debuff_cache():
		_dirty = true
	var interval := 0.04 if (hurt_flash > 0.0 or prev_flash > 0.0) else 0.10
	if _dirty or _redraw_t >= interval:
		_dirty = false
		_redraw_t = 0.0
		_request_hud_redraw()


func _sync_debuff_cache() -> bool:
	var wound_v: Variant = sim.get("player_wound_t")
	var wound_t: float = float(wound_v) if wound_v != null else 0.0
	var slow_v: Variant = sim.get("player_slow_t")
	var slow_t: float = float(slow_v) if slow_v != null else 0.0
	var wound_ds := int(ceil(wound_t * 10.0)) if wound_t > 0.0 else 0
	var slow_ds := int(ceil(slow_t * 10.0)) if slow_t > 0.0 else 0
	if wound_ds == _c_wound_ds and slow_ds == _c_slow_ds:
		return false
	_c_wound_ds = wound_ds
	_c_slow_ds = slow_ds
	_s_wound = ("重伤禁疗 %.1fs" % (float(wound_ds) / 10.0)) if wound_ds > 0 else ""
	_s_slow = ("寒滞减速 %.1fs" % (float(slow_ds) / 10.0)) if slow_ds > 0 else ""
	return true


func modal_open() -> bool:
	return (choice_panel != null and choice_panel.visible) or (shop_panel != null and shop_panel.visible) or (pause_panel != null and pause_panel.visible) or (result_panel != null and result_panel.visible) or (extract_panel != null and extract_panel.visible)


# ======================================================================
# 自绘 HUD
# ======================================================================
func _fs(base: int) -> int:
	return int(base * (1.25 if touch_mode else 1.0))


func _bar(rect: Rect2, k: float, fill: Color, back: Color = Color(0.05, 0.06, 0.14, 0.9)) -> void:
	_rect(Rect2(rect.position - Vector2(3, 3), rect.size + Vector2(6, 6)), UI.INK)
	_rect(rect, back)
	_rect(Rect2(rect.position, Vector2(rect.size.x * clampf(k, 0.0, 1.0), rect.size.y)), fill)
	_rect(Rect2(rect.position, Vector2(rect.size.x * clampf(k, 0.0, 1.0), rect.size.y * 0.4)), Color(1, 1, 1, 0.16))


var _qt16: Array = []
var _qt20: Array = []
var _qt26: Array = []


## 文字按 3 档字号分桶入队，避免每帧 sort_custom 排序与闭包分配
func _text(pos: Vector2, s: String, size: int, col: Color, w: float = -1.0, align: int = HORIZONTAL_ALIGNMENT_LEFT, shadow: bool = true) -> void:
	var sz := _snap(size)
	var item := [pos, s, col, w, align, shadow]
	if sz == 16:
		_qt16.append(item)
	elif sz == 20:
		_qt20.append(item)
	else:
		_qt26.append(item)


func _snap(size: int) -> int:
	return UI.snap_size(size)


func _flush_bucket(bucket: Array, sz: int) -> void:
	var off := Vector2(1.5, 1.5)
	for q in bucket:
		if q[5]:
			canvas.draw_string(font, q[0] + off, q[1], q[4], q[3], sz, UI.INK)
	for q in bucket:
		canvas.draw_string(font, q[0], q[1], q[4], q[3], sz, q[2])
	bucket.clear()


func _flush_texts() -> void:
	var cci := canvas.get_canvas_item()
	hb_back.flush(cci, white_tex)
	if _mm_draw and mm_tex != null:
		canvas.draw_texture_rect(mm_tex, _mm_rect, false)
	_mm_draw = false
	hb_icon.flush(cci, icon_atlas)
	hb_front.flush(cci, white_tex)
	if Playtest.hide.contains("htext"):
		_qt16.clear()
		_qt20.clear()
		_qt26.clear()
		return
	if not _qt16.is_empty():
		_flush_bucket(_qt16, 16)
	if not _qt20.is_empty():
		_flush_bucket(_qt20, 20)
	if not _qt26.is_empty():
		_flush_bucket(_qt26, 26)


var hb_back := TriBatch.new()
var hb_icon := TriBatch.new()
var hb_front := TriBatch.new()
var white_tex: Texture2D
var icon_atlas: Texture2D
var icon_uv: Dictionary = {}


## 把 HUD 用到的图标合成一张 64×64 格的图集（一次提交），白色 1×1 贴图承载所有纯色图形
func _build_hud_batch() -> void:
	var wi := Image.create(2, 2, false, Image.FORMAT_RGBA8)
	wi.fill(Color.WHITE)
	white_tex = ImageTexture.create_from_image(wi)
	var ids: Array = ["wick", "sword", "portrait"]
	for u in GameData.UPS.values():
		ids.append(String(u.icon))
	for e in GameData.EVOS.values():
		ids.append(String(e.icon))
	for r in GameData.RELIC_BY_ID.values():
		ids.append(String(r.icon))
	for opt_id in OPT_HUD_ICONS:
		if ResourceLoader.exists("res://assets/icons/%s.png" % opt_id):
			ids.append(opt_id)
	var uniq: Array = []
	for i in ids:
		if not uniq.has(i):
			uniq.append(i)
	var cols := 8
	var rows := maxi(1, int(ceil(float(uniq.size()) / float(cols))))
	var img := Image.create(cols * 64, rows * 64, false, Image.FORMAT_RGBA8)
	for n in range(uniq.size()):
		var id: String = uniq[n]
		var src: Image = null
		if id == "portrait":
			if ResourceLoader.exists("res://assets/hero.png"):
				var htex := load("res://assets/hero.png") as Texture2D
				if htex != null:
					src = htex.get_image().get_region(Rect2i(60, 8, 232, 232))
		else:
			var ipath := "res://assets/icons/%s.png" % id
			if ResourceLoader.exists(ipath):
				var itex := load(ipath) as Texture2D
				if itex != null:
					src = itex.get_image()
		if src == null:
			continue
		src.convert(Image.FORMAT_RGBA8)
		src.resize(64, 64, Image.INTERPOLATE_LANCZOS)
		img.blit_rect(src, Rect2i(0, 0, 64, 64), Vector2i((n % cols) * 64, (n / cols) * 64))
		icon_uv[id] = Rect2(float(n % cols) / cols, float(n / cols) / rows, 1.0 / cols, 1.0 / rows)
	icon_atlas = ImageTexture.create_from_image(img)


func _rect(r: Rect2, col: Color, front: bool = false) -> void:
	(hb_front if front else hb_back).full(r.position.x, r.position.y, r.size.x, r.size.y, col)


func _frame(r: Rect2, col: Color, w: float, front: bool = true) -> void:
	var b := hb_front if front else hb_back
	b.full(r.position.x, r.position.y, r.size.x, w, col)
	b.full(r.position.x, r.end.y - w, r.size.x, w, col)
	b.full(r.position.x, r.position.y + w, w, r.size.y - 2.0 * w, col)
	b.full(r.end.x - w, r.position.y + w, w, r.size.y - 2.0 * w, col)


func _icon_q(id: String, r: Rect2) -> void:
	var uv: Rect2 = icon_uv.get(id, Rect2())
	if uv.size.x > 0.0:
		hb_icon.rect(r.position.x, r.position.y, r.size.x, r.size.y, uv.position.x, uv.position.y, uv.end.x, uv.end.y, Color.WHITE)


var mm_tex: ImageTexture = null
var _mm_img: Image = null
var mm_n := -1
var owned_cache: Array = []
var owned_hash := -1
var portrait: Texture2D


func _draw_hud() -> void:
	var t_hd := Time.get_ticks_usec()
	_qt16.clear()
	_qt20.clear()
	_qt26.clear()
	_mm_draw = false
	_draw_hud_inner()
	_flush_texts()
	PerfStat.add("hud_draw", t_hd)


func _draw_hud_inner() -> void:
	var vw := get_viewport().get_visible_rect().size
	if hurt_flash > 0.0:
		var a := clampf(hurt_flash / 0.3, 0.0, 1.0) * 0.28
		_rect(Rect2(Vector2.ZERO, vw), Color(0.85, 0.1, 0.1, a))
	if sim.hp < sim.maxhp * 0.3 and not sim.over:
		var a2 := 0.08 + 0.06 * sin(t * 6.0)
		_rect(Rect2(Vector2.ZERO, vw), Color(0.85, 0.1, 0.1, a2))
	var L := inset.x + 16.0
	var T := inset.y + 16.0
	var k := 1.0 if not touch_mode else 1.12
	# 顶部经验条（整幅）
	_bar(Rect2(inset.x, inset.y, vw.x - inset.x - inset.z, 8), float(sim.xp) / maxf(1.0, sim.need), Color("7fe3ff"))
	T += 12.0
	# 头像 + 生命 + 灯油
	var ps := 78.0 * k
	_rect(Rect2(L - 3, T - 3, ps + 6, ps + 6), UI.INK)
	_rect(Rect2(L, T, ps, ps), Color(0.1, 0.12, 0.3))
	_icon_q("portrait", Rect2(L, T, ps, ps))
	_frame(Rect2(L - 1, T - 1, ps + 2, ps + 2), UI.ORANGE, 3.0)
	var bx := L + ps + 14.0
	var barw := 300.0 * k
	var depth: int = int(sim.get("abyss_depth")) if sim.get("abyss_depth") != null else 1
	if sim.level != _c_lv or depth != _c_depth:
		_c_lv = sim.level
		_c_depth = depth
		_s_lv = ("Lv %d • 阿烛 • 幽冥第%d层" % [sim.level, depth]) if depth > 1 else ("Lv %d • 阿烛" % sim.level)
	_text(Vector2(bx, T + 20 * k), _s_lv, _fs(22), UI.GHOST)
	_sync_debuff_cache()
	var hp_rect := Rect2(bx, T + 26 * k, barw, 22 * k)
	var hp_col := Color(0.58, 0.10, 0.34) if _c_wound_ds > 0 else (Color("e0463a") if sim.hp > sim.maxhp * 0.3 else Color("ff3a2a"))
	_bar(hp_rect, sim.hp / maxf(1.0, sim.maxhp), hp_col)
	if _c_wound_ds > 0:
		_frame(hp_rect, Color("d83a7a"), 2.0)
	var hp_i := int(ceil(sim.hp))
	var mhp_i := int(sim.maxhp)
	if hp_i != _c_hp or mhp_i != _c_maxhp:
		_c_hp = hp_i
		_c_maxhp = mhp_i
		_s_hp = "%d / %d" % [hp_i, mhp_i]
	_text(Vector2(bx + 8, T + 44 * k), _s_hp, _fs(18), UI.PAPER, -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
	if _c_wound_ds > 0 or _c_slow_ds > 0:
		var db_x := bx + barw + 10.0
		var db_w := 116.0 * k
		var db_h := 22.0 * k
		var db_y := T + 26.0 * k
		if _c_wound_ds > 0:
			_rect(Rect2(db_x, db_y, db_w, db_h), Color(0.24, 0.04, 0.16, 0.94))
			_frame(Rect2(db_x, db_y, db_w, db_h), Color("d83a7a"), 1.5)
			_text(Vector2(db_x, db_y + 16.0 * k), _s_wound, _fs(15), Color("ff8cc6"), db_w, HORIZONTAL_ALIGNMENT_CENTER, false)
			db_y -= 24.0 * k
		if _c_slow_ds > 0:
			_rect(Rect2(db_x, db_y, db_w, db_h), Color(0.04, 0.16, 0.24, 0.94))
			_frame(Rect2(db_x, db_y, db_w, db_h), Color(0.45, 0.92, 1.0), 1.5)
			_text(Vector2(db_x, db_y + 16.0 * k), _s_slow, _fs(15), Color(0.72, 0.96, 1.0), db_w, HORIZONTAL_ALIGNMENT_CENTER, false)
	# 灯油槽 + 盛灯/残灯状态 + [Q] 挑灯爆焰指示
	var oil_v: Variant = sim.get("lantern_oil")
	var oil: float = float(oil_v) if oil_v != null else 80.0
	var lstate: String = String(sim.call("lantern_state")) if sim.has_method("lantern_state") else ("high" if oil > 70.0 else ("low" if oil < 30.0 else "mid"))
	var ft_v: Variant = sim.get("flare_t")
	var ft: float = float(ft_v) if ft_v != null else 0.0
	var oil_i := int(round(clampf(oil, 0.0, 100.0)))
	var ft_ds := int(ceil(ft * 10.0)) if ft > 0.0 else 0
	if oil_i != _c_oil or lstate != _c_lstate or ft_ds != _c_flare_ds:
		_c_oil = oil_i
		_c_lstate = lstate
		_c_flare_ds = ft_ds
		_s_oil = "灯油 %d%%" % oil_i
		_s_lstate = "盛灯" if lstate == "high" else ("残灯" if lstate == "low" else "常明")
		if ft > 0.0:
			_s_flare = "爆焰 %.1fs" % (float(ft_ds) / 10.0)
		elif oil >= 25.0:
			_s_flare = "挑灯就绪" if touch_mode else "[Q/右键]挑灯"
		else:
			_s_flare = "缺油" if touch_mode else "[Q]缺油"
	var oil_y := T + 54.0 * k
	var oil_w := 178.0 * k
	var oil_col := UI.GOLD if (ft > 0.0 or lstate == "high") else (UI.BLOOD if lstate == "low" else UI.ORANGE)
	_bar(Rect2(bx, oil_y, oil_w, 16 * k), oil / 100.0, oil_col)
	_text(Vector2(bx + 6, oil_y + 14 * k), _s_oil, _fs(15), UI.PAPER, -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
	var badge_x := bx + oil_w + 8.0
	var st_col := UI.GOLD if lstate == "high" else (UI.BLOOD if lstate == "low" else UI.ORANGE)
	_rect(Rect2(badge_x, oil_y - 2, 46 * k, 20 * k), Color(0.08, 0.09, 0.2, 0.92))
	_frame(Rect2(badge_x, oil_y - 2, 46 * k, 20 * k), st_col, 1.5)
	_text(Vector2(badge_x, oil_y + 14 * k), _s_lstate, _fs(15), st_col, 46 * k, HORIZONTAL_ALIGNMENT_CENTER, false)
	var fl_x := badge_x + 52.0 * k
	var has_fl_ic := icon_uv.has("flare")
	var fl_ic_sz := 16.0 * k
	var fl_w := ((78.0 if touch_mode else 104.0) + (20.0 if has_fl_ic else 0.0)) * k
	var fl_col := UI.GOLD if (ft > 0.0 or oil >= 25.0) else Color(0.55, 0.56, 0.68)
	_rect(Rect2(fl_x, oil_y - 2, fl_w, 20 * k), Color(0.18, 0.12, 0.05, 0.92) if ft > 0.0 else Color(0.08, 0.09, 0.2, 0.9))
	_frame(Rect2(fl_x, oil_y - 2, fl_w, 20 * k), fl_col, 1.5)
	if has_fl_ic:
		_icon_q("flare", Rect2(fl_x + 3.0 * k, oil_y, fl_ic_sz, fl_ic_sz))
		_text(Vector2(fl_x + fl_ic_sz + 4.0 * k, oil_y + 14 * k), _s_flare, _fs(15), fl_col, fl_w - fl_ic_sz - 6.0 * k, HORIZONTAL_ALIGNMENT_CENTER, false)
	else:
		_text(Vector2(fl_x, oil_y + 14 * k), _s_flare, _fs(15), fl_col, fl_w, HORIZONTAL_ALIGNMENT_CENTER, false)
	# 构筑图标行
	var hsh := sim.levels.hash() + sim.evo.hash()
	if hsh != owned_hash:
		owned_hash = hsh
		owned_cache = sim.owned()
	var ox := bx
	var oy := T + 80.0 * k
	var isz := 34.0 * k
	for o in ([] if Playtest.hide.contains("hbuild") else owned_cache):
		_rect(Rect2(ox - 2, oy - 2, isz + 4, isz + 4), UI.INK)
		_icon_q(o.icon, Rect2(ox, oy, isz, isz))
		_text(Vector2(ox + isz - 14, oy + isz + 1), str(o.lv), _fs(15), UI.GOLD, -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
		ox += isz + 7.0
	# 灯芯 / 遗物 / 法宝
	var rx := bx
	var ry := oy + isz + 12.0
	_icon_q("wick", Rect2(rx, ry, 28 * k, 28 * k))
	_text(Vector2(rx + 32 * k, ry + 22 * k), "×%d" % sim.wicks, _fs(22), UI.GOLD)
	rx += 88.0 * k
	for rid in sim.relics:
		var r: Dictionary = GameData.RELIC_BY_ID[rid]
		_icon_q(r.icon, Rect2(rx, ry, 28 * k, 28 * k))
		rx += 32.0 * k
	if sim.artifact == "sword":
		_icon_q("sword", Rect2(rx + 4, ry - 2, 32 * k, 32 * k))
		rx += 42.0 * k
	# 活跃双阴律 + 2/4/6 灯派羁绊徽章行
	_refresh_rules_schools_cache()
	var tag_y := ry + 34.0 * k
	var tag_x := L
	if not Playtest.hide.contains("hbuild"):
		for rd in _rules_disp:
			var r_ic := String(rd.get("icon", ""))
			var has_r_ic := r_ic != "" and icon_uv.has(r_ic)
			var pw := (maxf(76.0, float(String(rd.name).length()) * 16.0 + 26.0) + (18.0 if has_r_ic else 0.0)) * k
			_rect(Rect2(tag_x, tag_y, pw, 22 * k), Color(0.14, 0.08, 0.24, 0.92))
			_frame(Rect2(tag_x, tag_y, pw, 22 * k), Color("c08cff"), 1.5)
			if has_r_ic:
				var risz := 16.0 * k
				_icon_q(r_ic, Rect2(tag_x + 4.0 * k, tag_y + 3.0 * k, risz, risz))
				_text(Vector2(tag_x + risz + 7.0 * k, tag_y + 16 * k), "律•" + String(rd.name), _fs(15), Color("e6ccff"), -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
			else:
				_text(Vector2(tag_x + 6, tag_y + 16 * k), "律•" + String(rd.name), _fs(15), Color("e6ccff"), -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
			tag_x += pw + 6.0
		for sd2 in _schools_disp:
			var sc_ic := String(sd2.get("icon", ""))
			var has_sc_ic := sc_ic != "" and icon_uv.has(sc_ic)
			var sw := (74.0 if has_sc_ic else 58.0) * k
			var scol: Color = sd2.col
			_rect(Rect2(tag_x, tag_y, sw, 22 * k), Color(0.08, 0.1, 0.2, 0.92))
			_frame(Rect2(tag_x, tag_y, sw, 22 * k), scol, 1.5)
			if has_sc_ic:
				var sisz := 16.0 * k
				_icon_q(sc_ic, Rect2(tag_x + 4.0 * k, tag_y + 3.0 * k, sisz, sisz))
				_text(Vector2(tag_x + sisz + 5.0 * k, tag_y + 16 * k), String(sd2.label), _fs(15), scol, sw - sisz - 7.0 * k, HORIZONTAL_ALIGNMENT_CENTER, false)
			else:
				_text(Vector2(tag_x, tag_y + 16 * k), String(sd2.label), _fs(15), scol, sw, HORIZONTAL_ALIGNMENT_CENTER, false)
			tag_x += sw + 6.0
	var extra_row_h := 28.0 * k if (not _rules_disp.is_empty() or not _schools_disp.is_empty()) else 4.0 * k
	# 飞剑状态
	var cur_y := tag_y + extra_row_h
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
		_text(Vector2(rx, ry + 22 * k), st, _fs(16), UI.GHOST if sim.sw_state != Sim.SW_DROP else UI.BLOOD, -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
		var SS: Dictionary = GameData.DG.sword.stages
		var nms: Array = SS.names
		var line := "飞剑 第 %d / 5 阶 • 已解锁：%s" % [sim.sw_stage, " / ".join(PackedStringArray(sim.sword_unlocked()))]
		_text(Vector2(L, cur_y + 16 * k), line, _fs(16), UI.GOLD, -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
		if sim.sw_stage < 5:
			var nxt := "下一阶「%s」：剑意 %d / %d（击杀）或击败守关者" % [nms[sim.sw_stage], sim.sw_kills, int(SS.kills[sim.sw_stage - 1])]
			_text(Vector2(L, cur_y + 36 * k), nxt, _fs(15), Color(0.8, 0.9, 1.0), -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
		else:
			_text(Vector2(L, cur_y + 36 * k), "飞剑已臻圆满 • 精通 %d / 5（+%d%% 伤害）" % [sim.sw_master, 8 * sim.sw_master], _fs(15), Color(0.8, 0.9, 1.0), -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
		cur_y += 48.0 * k
	if sim.fusion != "":
		_text(Vector2(L, cur_y + 16 * k), "融合 • %s" % GameData.DG.fusion.names[sim.fusion], _fs(16), Color(1.0, 0.85, 0.4), -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
		cur_y += 24.0 * k
	# 彩虹葫芦进度珠 / 小金刚 / 套装
	var gy := cur_y + 18.0 * k
	_text(Vector2(L, gy), "彩虹葫芦 %d/7" % sim.gourds.size(), _fs(18), Color("ffcf5a"))
	var bx2 := L + 148.0 * k
	var by2 := gy - 6.0
	for gp in ([] if Playtest.hide.contains("hbuild") else GameData.GD.pieces):
		var got: bool = sim.gourds.has(gp.id)
		hb_front.circle(Vector2(bx2 + 10, by2), 11.0, UI.INK)
		if got:
			hb_front.circle(Vector2(bx2 + 10, by2), 14.0, Color(GCOLS[gp.id], 0.35))
			hb_front.circle(Vector2(bx2 + 10, by2), 8.0, GCOLS[gp.id])
		else:
			hb_front.circle(Vector2(bx2 + 10, by2), 8.0, Color(GCOLS[gp.id], 0.55))
			hb_front.circle(Vector2(bx2 + 10, by2), 6.0, Color(0.12, 0.12, 0.2))
		bx2 += 25.0
	if sim.pet_on:
		var pdmg := int(sim.dmg_by.get("pet", 0.0))
		var ptxt := "小金刚 复活 %ds" % int(ceil(sim.pet_dead_t)) if sim.pet_dead_t > 0.0 else "小金刚 %d/%d 印%d 伤%s R合击:%s" % [int(sim.pet_hp), int(sim.pet_maxhp()), sim.pet_marks, UI.fmt_int(pdmg), "就绪" if sim.combo_cd <= 0.0 else "%ds" % int(ceil(sim.combo_cd))]
		_text(Vector2(bx2 + 6, by2 + 6), ptxt, _fs(15), Color("ffcf5a") if sim.pet_dead_t <= 0.0 else UI.BLOOD, -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
	elif sim.gourds.size() < 7:
		var gl := sim.gourd_guarantee_left()
		var gtxt := "灵藤 / BOSS / 秘境 / 游商" + (" • 保底 %s" % UI.fmt_time(gl) if gl >= 0.0 else "")
		_text(Vector2(L, gy + 20), gtxt, _fs(15), Color(1.0, 0.85, 0.5, 0.88), -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
	var asets := sim.active_sets()
	var sets_sig := str(asets.size()) + ":" + (String(asets[0]) if asets.size() > 0 else "")
	if sets_sig != _c_sets_sig:
		_c_sets_sig = sets_sig
		if asets.size() > 0:
			var nms2: Array = []
			for sid in asets:
				var sd3: Dictionary = _sets_by_id.get(String(sid), GameData.SET_BY_ID.get(sid, {}))
				nms2.append(String(sd3.get("name", sid)))
			_s_sets = "套装：" + " / ".join(PackedStringArray(nms2))
		else:
			_s_sets = ""
	if _s_sets != "":
		_text(Vector2(L, gy + (40 if sim.gourds.size() < 7 and not sim.pet_on else 22)), _s_sets, _fs(15), Color("9fe8ff"), -1.0, HORIZONTAL_ALIGNMENT_LEFT, false)
	# 右上：击杀 / 魂火 / 铜钱（脏检查缓存字符串）
	var rr := vw.x - inset.z - (110.0 if touch_mode else 24.0)
	if sim.kills != _c_kills:
		_c_kills = sim.kills
		_s_kills = "击杀  %d" % sim.kills
	var spay := sim.soul_payout()
	if spay != _c_soul:
		_c_soul = spay
		_s_soul = "魂火  %d" % spay
	if sim.coins != _c_coins:
		_c_coins = sim.coins
		_s_coins = "铜钱  %d" % sim.coins
	_text(Vector2(rr - 240, T + 24 * k), _s_kills, _fs(22), UI.PAPER, 240.0, HORIZONTAL_ALIGNMENT_RIGHT)
	_text(Vector2(rr - 240, T + 52 * k), _s_soul, _fs(22), UI.GHOST, 240.0, HORIZONTAL_ALIGNMENT_RIGHT)
	_text(Vector2(rr - 240, T + 80 * k), _s_coins, _fs(22), Color("ffd36a"), 240.0, HORIZONTAL_ALIGNMENT_RIGHT)
	# 顶部中央：大计时 + 段名
	var cx := vw.x / 2.0
	var tt := sim.clock if sim.phase != Sim.PH_RIFT else sim.rift_t
	var tt_i := int(tt)
	if tt_i != _c_clock:
		_c_clock = tt_i
		_s_clock = UI.fmt_time(tt)
	_text(Vector2(cx - 200, T + 40 * k), _s_clock, _fs(46), UI.PAPER, 400.0, HORIZONTAL_ALIGNMENT_CENTER)
	var title := ""
	match sim.phase:
		Sim.PH_SEG:
			title = "%s  •  第 %d / %d 段  •  清场 %s 后" % [sim.seg_theme(sim.seg).name, sim.seg + 1, sim.seg_n(), UI.fmt_time(maxf(0.0, (sim.seg_to(sim.seg) - sim.t) * sim.stretch))]
		Sim.PH_BREAK:
			title = "段间 • 清场  •  %s 后自动启程" % UI.fmt_time(maxf(0.0, float(GameData.SEG["break"].max) - sim.break_t))
		Sim.PH_RIFT:
			title = {"sword": "灯骸裂隙 • 剑灵", "gourd": "葫芦藤秘境 • 第 %d 劫" % sim.vine_runs, "vault": "镇魂宝库", "coinfarm": "练级点 • 聚宝鬼市", "soulfarm": "练级点 • 炼魂坑"}.get(sim.rift_kind, "秘境")
		Sim.PH_BOSS:
			title = ("终局 • 灯骸老祖 • 幽冥第%d层" % depth) if depth > 1 else "终局 • 灯骸老祖"
	_text(Vector2(cx - 300, T + 68 * k), title, _fs(20), UI.GOLD, 600.0, HORIZONTAL_ALIGNMENT_CENTER)
	var yb := T + 80.0 * k
	if sim.phase == Sim.PH_RIFT:
		var rem := maxf(0.0, sim.rift_limit - sim.rift_t)
		var warn := rem < 15.0
		var rline := "限时 %s • 目标 %d 秒内击杀 • 限时 %d 秒" % [UI.fmt_time(rem), int(sim.rift_target), int(sim.rift_limit)]
		if Sim.FARM_KINDS.has(sim.rift_kind):
			rline = "坚持 %s • 击杀 %d • 铜钱 +%d • 魂火 +%d" % [UI.fmt_time(rem), int(sim.farm_gain.kills), int(sim.farm_gain.coins), int(sim.farm_gain.xp)]
			warn = false
		elif sim.rift_kind != "sword":
			rline = "限时 %s" % UI.fmt_time(rem)
		_text(Vector2(cx - 320, yb + 18), rline, _fs(17), UI.BLOOD if warn else UI.PAPER, 640.0, HORIZONTAL_ALIGNMENT_CENTER, false)
		if sim.rift_kind == "gourd" and sim.vine_boss != null and sim.vine_boss.alive:
			_bar(Rect2(cx - 240, yb + 28, 480, 16), sim.vine_boss.hp / maxf(1.0, sim.vine_boss.maxhp), Color("6fdc7a"))
		if sim.rift_warden != null:
			var w := sim.rift_warden
			_bar(Rect2(cx - 240, yb + 28, 480, 16), w.hp / maxf(1.0, w.maxhp), Color("b36bff"))
			_text(Vector2(cx - 300, yb + 62), "剑冢守关者「剑灵」• 御剑环身 • 回鞘突刺 • 剑雨", _fs(17), Color("d9b8ff"), 600.0, HORIZONTAL_ALIGNMENT_CENTER, false)
		if sim.rift_kind == "sword":
			_text(Vector2(cx - 340, yb + 84), "无补给 • 无三选一 • 骨灯全熄 • 冲刺冷却×1.25 • 受击硬直×1.2", _fs(15), Color("ff9a8a"), 680.0, HORIZONTAL_ALIGNMENT_CENTER, false)
	elif sim.boss != null and sim.boss.alive:
		var b := sim.boss
		_bar(Rect2(cx - 280, yb + 12, 560, 18), b.hp / maxf(1.0, b.maxhp), Color("b36bff"))
		_text(Vector2(cx - 300, yb + 50), "灯骸老祖  %s / %s%s" % [UI.fmt_int(int(ceil(maxf(0.0, b.hp)))), UI.fmt_int(int(b.maxhp)), "  • 回光返照" if sim.boss_enraged else ""], _fs(20), Color("d9b8ff"), 600.0, HORIZONTAL_ALIGNMENT_CENTER)
	elif sim.phase == Sim.PH_BREAK:
		_text(Vector2(cx - 420, yb + 22), "站定「启程」领三选一馈赠；站定「灯骸裂隙」则放弃它 • 游商用铜钱换遗物", _fs(17), UI.PAPER, 840.0, HORIZONTAL_ALIGNMENT_CENTER, false)
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
			_arrow_pts[0] = ap + dn * 26.0 * pul
			_arrow_pts[1] = ap - dn * 12.0 + perp * 20.0
			_arrow_pts[2] = ap - dn * 12.0 - perp * 20.0
			hb_front.poly(_arrow_pts, Color(0.85, 0.6, 1.0, 0.95))
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
		if best >= 0 and bdist > 520.0 and not modal_open():
			var dn := Vector2(float(sim.pois[best].x) - sim.px, float(sim.pois[best].y) - sim.py).normalized()
			var ctr2 := Vector2(vw.x / 2.0, vw.y / 2.0)
			var ap2 := ctr2 + Vector2(dn.x * (vw.x * 0.5 - 70.0), dn.y * (vw.y * 0.5 - 60.0))
			if ap2.x > vw.x - inset.z - 260.0:
				var mm_h := (170.0 if touch_mode else 190.0) * Sim.H / Sim.W
				ap2.y = maxf(ap2.y, inset.y + (100.0 if touch_mode else 112.0) + mm_h + 56.0)
			var perp2 := Vector2(-dn.y, dn.x)
			_arrow_pts[0] = ap2 + dn * 20.0
			_arrow_pts[1] = ap2 - dn * 10.0 + perp2 * 14.0
			_arrow_pts[2] = ap2 - dn * 10.0 - perp2 * 14.0
			hb_front.poly(_arrow_pts, Color(0.85, 0.6, 1.0, 0.9))
			_text(ap2 - Vector2(70, -34) if dn.y > 0 else ap2 - Vector2(70, 20), "剑冢裂隙 %dm" % int(bdist / 10.0), 16, Color(0.9, 0.75, 1.0), 140.0, HORIZONTAL_ALIGNMENT_CENTER, false)
	# 底部提示（桌面）
	if not touch_mode:
		var tip2 := "WASD 移动 • 空格 冲刺 • Q/右键 挑灯爆焰 • Esc 暂停"
		if sim.has_sword():
			tip2 = "WASD 移动 • 空格 冲刺 • Q/右键 挑灯 • E/J 飞剑" + (" • R 小金刚合击" if sim.pet_on else "") + " • Esc 暂停"
		elif sim.pet_on:
			tip2 = "WASD 移动 • 空格 冲刺 • Q/右键 挑灯 • R 小金刚七彩神光斩 • Esc 暂停"
		_text(Vector2(cx - 460, vw.y - 18.0 - inset.w), tip2, 16, Color(0.8, 0.82, 0.95, 0.75), 920.0, HORIZONTAL_ALIGNMENT_CENTER, false)


func _refresh_rules_schools_cache() -> void:
	var rser_v: Variant = sim.get("rules_serial")
	var rv: Variant = sim.get("active_rules")
	var ar: Array = rv if rv is Array else []
	var rser: int = int(rser_v) if rser_v != null else ar.size()
	if rser != _c_rules_serial:
		_c_rules_serial = rser
		_rules_disp.clear()
		for item in ar:
			if item is Dictionary:
				var rid_d := String(item.get("id", ""))
				var rdef_d: Dictionary = _rules_by_id.get(rid_d, {})
				var ricon_d := String(item.get("icon_tag", item.get("icon", rdef_d.get("icon_tag", ""))))
				_rules_disp.append({"id": rid_d, "name": String(item.get("name", rid_d)), "icon": ricon_d})
			else:
				var rid := String(item)
				var rd: Dictionary = _rules_by_id.get(rid, {})
				_rules_disp.append({"id": rid, "name": String(rd.get("name", rid)), "icon": String(rd.get("icon_tag", ""))})
	var sser_v: Variant = sim.get("schools_serial")
	var scv: Variant = sim.get("school_counts")
	var scd: Dictionary = scv if scv is Dictionary else {}
	var sser: int
	if sser_v != null:
		sser = int(sser_v)
	else:
		sser = scd.size()
		for sid in scd:
			sser = sser * 31 + int(scd[sid])
	if sser != _c_schools_serial:
		_c_schools_serial = sser
		_schools_disp.clear()
		for sid in scd:
			var cnt := int(scd[sid])
			if cnt >= 2:
				var tier := 6 if cnt >= 6 else (4 if cnt >= 4 else 2)
				var key := String(sid)
				var sname: String = UI.SCHOOL_NAME.get(key, key)
				var scol: Color = UI.SCHOOL.get(key, UI.GOLD)
				if _schools_by_id.has(key) and _schools_by_id[key].has("color"):
					scol = Color(String(_schools_by_id[key].color))
				_schools_disp.append({"id": key, "label": "%s %d" % [sname, tier], "cnt": cnt, "tier": tier, "col": scol, "icon": String(SCHOOL_ICONS.get(key, ""))})


func _draw_minimap(vw: Vector2) -> void:
	if Playtest.hide.contains("hmini"):
		return
	var mw := 190.0 if not touch_mode else 170.0
	var mh := mw * Sim.H / Sim.W
	var x0 := vw.x - inset.z - mw - 14.0
	var y0 := inset.y + (100.0 if touch_mode else 112.0)
	_rect(Rect2(x0 - 3, y0 - 3, mw + 6, mh + 6), Color(0.04, 0.05, 0.12, 0.7))
	if sim.explored.size() == 864:
		if mm_tex == null or mm_n != sim.explored_n:
			mm_n = sim.explored_n
			if _mm_img == null:
				_mm_img = Image.create(36, 24, false, Image.FORMAT_RGBA8)
			var c_exp := Color(0.35, 0.45, 0.75, 0.35)
			var c_unexp := Color(0, 0, 0, 0)
			for gy in range(24):
				var row_off := gy * 36
				for gx in range(36):
					_mm_img.set_pixel(gx, gy, c_exp if sim.explored[row_off + gx] == 1 else c_unexp)
			if mm_tex == null:
				mm_tex = ImageTexture.create_from_image(_mm_img)
			else:
				mm_tex.update(_mm_img)
		_mm_rect = Rect2(x0, y0, mw, mh)
		_mm_draw = true
	_frame(Rect2(x0, y0, mw, mh), UI.ORANGE, 2.0)
	for pp in sim.pois:
		var st_: Color = POI_COLS.get(pp.kind, Color.WHITE)
		hb_front.circle(Vector2(x0 + float(pp.x) / Sim.W * mw, y0 + float(pp.y) / Sim.H * mh), 5.0, st_, 10)
	for k in sim.pickups:
		if k.kind == "chest":
			_rect(Rect2(x0 + k.x / Sim.W * mw - 3, y0 + k.y / Sim.H * mh - 3, 6, 6), Color(1.0, 0.85, 0.3), true)
	var objs_v: Variant = sim.get("objectives")
	if objs_v is Array:
		var opulse := 1.0 + sin(t * 6.0) * 0.22
		for obj in (objs_v as Array):
			if not (obj is Dictionary) or bool(obj.get("done", false)):
				continue
			var omx := x0 + float(obj.x) / Sim.W * mw
			var omy := y0 + float(obj.y) / Sim.H * mh
			var is_lamp := String(obj.get("kind", "")) == "shrine_lamp"
			var ocol := Color(1.0, 0.84, 0.25) if is_lamp else Color(0.38, 0.94, 1.0)
			hb_front.ring(Vector2(omx, omy), 7.5 * opulse, 2.0, Color(ocol.r, ocol.g, ocol.b, 0.85), 14)
			hb_front.circle(Vector2(omx, omy), 4.5, ocol, 10)
	hb_front.circle(Vector2(x0 + sim.px / Sim.W * mw, y0 + sim.py / Sim.H * mh), 4.0, Color(0.5, 1.0, 1.0), 10)
	_text(Vector2(x0, y0 + mh + 16), "紫剑 绿藤 金龛 青碑 + 4 地标", 16, Color(0.85, 0.85, 0.95), mw, HORIZONTAL_ALIGNMENT_CENTER, false)
	_frame(Rect2(x0 + sim.px / Sim.W * mw - 7, y0 + sim.py / Sim.H * mh - 4, 14, 8), Color(1, 1, 1, 0.5), 1.0)


func _icon(id: String) -> Texture2D:
	if icon_cache.has(id):
		return icon_cache[id]
	var path := "res://assets/icons/%s.png" % id
	var t_: Texture2D = load(path) if ResourceLoader.exists(path) else null
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


func _card(icon_id: String, name_: String, sub: String, desc: String, edge: Color, size: Vector2, cost: String = "", compact: bool = false) -> Button:
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
	v.offset_left = 12 if compact else 14
	v.offset_right = -12 if compact else -14
	v.offset_top = 8 if compact else 14
	v.offset_bottom = -8 if compact else -12
	v.add_theme_constant_override("separation", 3 if compact else 5)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(v)
	var ic := UI.icon(icon_id, 52.0 if compact else 80.0)
	ic.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	v.add_child(ic)
	var n := UI.label(name_, 20 if compact else 26, UI.PAPER, 5)
	n.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(n)
	var sl := UI.label(sub, 16 if compact else 20, edge, 4)
	sl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(sl)
	var d := UI.label(desc, 16, Color("d8d2f5"), 3)
	d.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	d.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(d)
	if cost != "":
		var c := UI.label(cost, 20 if compact else 26, UI.GOLD, 5)
		c.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(c)
	return b


func _evo_recipe_line(uid: String, existing_desc: String) -> String:
	for ev in GameData.UP.evolutions:
		if String(ev.weapon) == uid:
			if existing_desc.contains(String(ev.name)):
				return ""
			var nd: Dictionary = GameData.UPS.get(ev.needs, {})
			var has_nd := sim.lv(String(ev.needs)) > 0
			return "进化配方：满级+「%s」%s →「%s」" % [String(nd.get("name", ev.needs)), "✓" if has_nd else "(缺)", String(ev.name)]
		if String(ev.needs) == uid:
			if existing_desc.contains(String(ev.name)):
				return ""
			var wp: Dictionary = GameData.UPS.get(ev.weapon, {})
			var wlv := sim.lv(String(ev.weapon))
			return "进化配方：配对「%s」(%d/%d) →「%s」" % [String(wp.get("name", ev.weapon)), wlv, int(wp.get("max", 5)), String(ev.name)]
	return ""


func _school_bonus_line(tags: Array) -> String:
	if tags.is_empty():
		return ""
	var scv: Variant = sim.get("school_counts")
	var scd: Dictionary = scv if scv is Dictionary else {}
	var parts: Array = []
	for raw_tag in tags:
		var tid := String(raw_tag)
		if tid == "" or not _schools_by_id.has(tid):
			continue
		var sc: Dictionary = _schools_by_id[tid]
		var cur := int(scd.get(tid, 0))
		var tlist: Array = sc.get("tiers", [])
		var tstrs: Array = []
		for tr in tlist:
			if tr is Dictionary:
				tstrs.append("%d:%s" % [int(tr.get("count", 2)), String(tr.get("desc", ""))])
		parts.append("【%s %d】%s" % [String(sc.get("name", tid)), cur, " / ".join(PackedStringArray(tstrs))])
	return "\n".join(PackedStringArray(parts))


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
	col.add_theme_constant_override("separation", 14)
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
	elif ch.kind == "rule":
		var rv: Variant = sim.get("active_rules")
		var rcnt := (rv as Array).size() if rv is Array else 0
		title = "阴 律 降 世"
		sub = "选择一条局内规则修改器 • 阴律槽 %d / 2" % rcnt
	var tl := UI.label(title, 26, UI.GOLD, 6)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	var sl := UI.label(sub, 20, Color("d6d0f0"), 4)
	sl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sl)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 20)
	col.add_child(row)
	var vh := get_viewport().get_visible_rect().size.y
	var card_h := minf(390.0, vh - 220.0)
	var i := 0
	for o in ch.options:
		var edge: Color = UI.RARITY.get(o.get("rarity", "white"), UI.PAPER)
		var desc_s := String(o.get("desc", ""))
		var oid := String(o.get("id", ""))
		var okind := String(o.get("kind", ""))
		if okind == "rule" or ch.kind == "rule" or _rules_by_id.has(oid):
			edge = Color("c08cff")
		elif GameData.UPS.has(oid):
			var u: Dictionary = GameData.UPS[oid]
			var evo_ln := _evo_recipe_line(oid, desc_s)
			if evo_ln != "":
				desc_s += "\n" + evo_ln
			var tags: Array = u.get("school_tags", [])
			if tags.is_empty() and String(u.get("school_tag", "")) != "":
				tags = [String(u.get("school_tag", ""))]
			var sc_ln := _school_bonus_line(tags)
			if sc_ln != "" and not desc_s.contains("【"):
				desc_s += "\n" + sc_ln
		var icon_s := String(o.get("icon", ""))
		if icon_s == "":
			icon_s = String(o.get("icon_tag", ""))
		if (okind == "rule" or ch.kind == "rule" or _rules_by_id.has(oid)) and _rules_by_id.has(oid):
			var r_tag := String(_rules_by_id[oid].get("icon_tag", ""))
			if r_tag != "":
				icon_s = r_tag
		if icon_s == "":
			icon_s = "fu"
		var cardb := _card(icon_s, String(o.get("name", "")), String(o.get("lvText", "")), desc_s, edge, Vector2(320, card_h))
		var idx := i
		cardb.pressed.connect(func(): game.on_choose(idx))
		var kl := UI.label(str(i + 1), 20, UI.GOLD, 4)
		kl.position = Vector2(12, 8)
		cardb.add_child(kl)
		row.add_child(cardb)
		UI.pop_in(cardb, 0.06 * i)
		i += 1
	var rr := UI.button("换一批（剩 %d 次）" % sim.rerolls, Vector2(280, 50), false, 20)
	rr.disabled = sim.rerolls <= 0
	rr.pressed.connect(func(): game.on_reroll())
	rr.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(rr)
	var hint := UI.label("" if touch_mode else "按 1 / 2 / 3 选择", 16, Color(0.8, 0.82, 0.95, 0.8), 3)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(hint)


func _build_shop() -> void:
	if shop_panel != null:
		shop_panel.queue_free()
	shop_panel = _modal_shell("shop")
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 10)
	shop_panel.add_child(col)
	var tl := UI.label("游 商 • 铜钱换遗物", 26, UI.GOLD, 6)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	var sl := UI.label("铜钱 %d  •  灯芯 %d（进裂隙/刷新商品要灯芯）" % [sim.coins, sim.wicks], 20, Color("d6d0f0"), 4)
	sl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sl)
	var n_items := sim.shop.size()
	var two_rows := n_items > 3
	var vh := get_viewport().get_visible_rect().size.y
	var vw2 := get_viewport().get_visible_rect().size.x
	var top_n := int(ceil(float(n_items) / 2.0)) if two_rows else maxi(1, n_items)
	var card_w := clampf((vw2 - 140.0) / float(top_n) - 18.0, 260.0, 320.0)
	var card_h := clampf((vh - 220.0) * 0.5 - 10.0, 198.0, 236.0) if two_rows else minf(340.0, vh - 250.0)
	var row1 := HBoxContainer.new()
	row1.alignment = BoxContainer.ALIGNMENT_CENTER
	row1.add_theme_constant_override("separation", 18)
	col.add_child(row1)
	var row2: HBoxContainer = null
	if two_rows:
		row2 = HBoxContainer.new()
		row2.alignment = BoxContainer.ALIGNMENT_CENTER
		row2.add_theme_constant_override("separation", 18)
		col.add_child(row2)
	var i := 0
	for rid in sim.shop:
		var target_row := row1 if (not two_rows or i < top_n) else row2
		var card_btn: Button
		if rid == "forge":
			var F: Dictionary = GameData.DG.forge
			card_btn = _card("tianyou", "灯油淬火", "已淬 %d 次 • 可重复" % sim.forge_n, "伤害 +%d%%（加算）• 生命上限 +%d\n每次涨价 %d" % [int(round(float(F.dmg) * 100.0)), int(F.hp), int(F.step)], Color("ff9a5a"), Vector2(card_w, card_h), "铜钱 %d" % sim.forge_price(), two_rows)
			card_btn.disabled = sim.coins < sim.forge_price()
		elif rid == "gourd_piece":
			card_btn = _card("hundai", "彩虹葫芦散件", "葫芦 %d / 7" % sim.gourds.size(), "随机一件未得的七色散件\n集齐 7 件合成葫芦小金刚", Color("ffcf5a"), Vector2(card_w, card_h), "铜钱 %d" % sim.gourd_price(), two_rows)
			card_btn.disabled = sim.coins < sim.gourd_price() or sim.gourds.size() >= 7
		else:
			var r: Dictionary = GameData.RELIC_BY_ID[rid]
			var tier_col: Color = UI.RARITY.get(String(r.get("tier", "white")), UI.PAPER)
			var sub := "进化配件" if r.has("part") else "遗物"
			var extra := ""
			if String(r.get("set", "")) != "":
				var sid := String(r.set)
				var sd: Dictionary = _sets_by_id.get(sid, GameData.SET_BY_ID.get(sid, {}))
				var cnt := int(sim.set_counts().get(sid, 0))
				var bonus := UI.fmt_set_bonus(sd)
				extra += "\n【%s %d/2%s】2件：%s" % [String(sd.get("name", sid)), mini(2, cnt + 1), " 激活" if cnt >= 1 else "", bonus]
			elif r.has("part"):
				extra += "\n满级可购金件"
			var rtags: Array = r.get("school_tags", [])
			if rtags.is_empty() and String(r.get("school", "")) != "":
				rtags = [String(r.get("school", ""))]
			var rsc := _school_bonus_line(rtags)
			if rsc != "":
				extra += "\n" + rsc
			card_btn = _card(r.icon, r.name, sub, String(r.desc) + extra, tier_col, Vector2(card_w, card_h), "铜钱 %d" % sim.price_of(r.id), two_rows)
			card_btn.disabled = sim.coins < sim.price_of(r.id)
		var idx := i
		card_btn.pressed.connect(func(): game.on_buy(idx))
		var kl2 := UI.label(str(i + 1), 20, UI.GOLD, 4)
		kl2.position = Vector2(10, 6)
		card_btn.add_child(kl2)
		target_row.add_child(card_btn)
		UI.pop_in(card_btn, 0.05 * i)
		i += 1
	if sim.shop.is_empty():
		col.add_child(UI.label("游商的货卖光了", 26, UI.PAPER, 4))
	var act_row := HBoxContainer.new()
	act_row.alignment = BoxContainer.ALIGNMENT_CENTER
	act_row.add_theme_constant_override("separation", 18)
	col.add_child(act_row)
	var rr2 := UI.button("刷新（灯芯×%d）" % int(GameData.GD.rerollWicks), Vector2(230, 48), false, 20)
	rr2.disabled = sim.wicks < int(GameData.GD.rerollWicks)
	rr2.pressed.connect(func(): game.on_reroll_shop())
	act_row.add_child(rr2)
	var leave := UI.button("离开", Vector2(220, 48), true, 26)
	leave.pressed.connect(func(): game.on_close_shop())
	act_row.add_child(leave)


func _build_extract_modal() -> void:
	if extract_panel != null:
		extract_panel.queue_free()
	extract_panel = _modal_shell("extract")
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 18)
	extract_panel.add_child(col)
	var depth: int = int(sim.get("abyss_depth")) if sim.get("abyss_depth") != null else 1
	var tl := UI.label("灯 骸 伏 诛 • 幽 冥 抉 择", 26, UI.GOLD, 6)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	var sl := UI.label("当前幽冥第 %d 层  •  已获魂火 %d  •  抉择去留" % [depth, sim.soul_payout()], 20, Color("d6d0f0"), 4)
	sl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(sl)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 28)
	col.add_child(row)
	var c1 := _card("wick", "[E] 归灯保骸", "撤离结算 • 保住全部魂火", "立即携当前魂火与战利品归村\n安全结束本局并计为通关胜利", UI.GOLD, Vector2(360, 290))
	c1.pressed.connect(func(): game.on_extract())
	row.add_child(c1)
	UI.pop_in(c1, 0.0)
	var c2 := _card("huanhuo", "[F] 深入幽冥", "进入第 %d 层 • +45%% 魂魄" % (depth + 1), "立即恢复 40% 生命与 50% 灯油\n妖物更凶险，魂火收益大幅提升！", Color("ff5a5a"), Vector2(360, 290))
	c2.pressed.connect(func(): game.on_push_deeper())
	row.add_child(c2)
	UI.pop_in(c2, 0.08)
	var hint := UI.label("" if touch_mode else "按 E 归灯保骸  •  按 F 深入幽冥", 20, Color(0.88, 0.85, 0.98, 0.9), 4)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(hint)


func _weapon_label(wid: String) -> String:
	if GameData.UPS.has(wid):
		return String(GameData.UPS[wid].name)
	return {"fu": "驱邪符", "huanhuo": "灯火环", "lei": "引雷诀", "sword": "飞剑术", "pet": "葫芦小金刚", "burn": "灼烧", "mark": "印记", "flare": "挑灯爆焰", "rule": "阴律", "ail": "异常反应"}.get(wid, wid)


func show_pause(on: bool) -> void:
	if pause_panel != null:
		pause_panel.queue_free()
		pause_panel = null
	_dirty = true
	if not on:
		return
	pause_panel = _modal_shell("pause")
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.offset_left = 40.0
	col.offset_right = -40.0
	col.offset_top = 24.0
	col.offset_bottom = -24.0
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 10)
	pause_panel.add_child(col)
	var depth: int = int(sim.get("abyss_depth")) if sim.get("abyss_depth") != null else 1
	var bid: String = String(sim.get("beacon_id")) if sim.get("beacon_id") != null else "beacon_default"
	var bname := String(_beacons_by_id.get(bid, {}).get("name", "安夜签"))
	var tl := UI.label("暂 停 • 构 筑 检 视", 26, UI.GOLD, 6)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	var oil_v: Variant = sim.get("lantern_oil")
	var oil_i := int(round(float(oil_v))) if oil_v != null else 80
	var info := UI.label("灯签：%s • 幽冥第%d层 • 灯油 %d%% • 灯芯 ×%d • 裂隙 %d 次%s" % [bname, depth, oil_i, sim.wicks, sim.rift_entries, " • 飞剑术" if sim.artifact == "sword" else ""], 20, UI.GOLD, 4)
	info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(info)
	# 可滚动检视面板（构筑 + 实时武器 DPS + 阴律/五派羁绊 + 进化进度）
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(sc)
	var body := VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 10)
	sc.add_child(body)
	body.add_child(_build_row(sim.owned(), "构筑"))
	if sim.relics.size() > 0:
		var rl: Array = []
		for rid in sim.relics:
			var r: Dictionary = GameData.RELIC_BY_ID[rid]
			rl.append({"icon": r.icon, "lv": "", "name": r.name})
		body.add_child(_build_row(rl, "遗物"))
	# 实时武器 DPS 统计
	var dps_box := PanelContainer.new()
	dps_box.add_theme_stylebox_override("panel", UI.box(Color(0.05, 0.06, 0.15, 0.92), UI.ORANGE, 10, 2))
	body.add_child(dps_box)
	var dps_v := VBoxContainer.new()
	dps_v.add_theme_constant_override("separation", 4)
	dps_box.add_child(dps_v)
	dps_v.add_child(UI.label("实时武器 DPS 统计", 20, UI.GOLD, 4))
	var bd_v: Variant = sim.get("dps_breakdown")
	var bd: Dictionary = bd_v if (bd_v is Dictionary and not (bd_v as Dictionary).is_empty()) else sim.dmg_by
	var entries: Array = []
	var grand_total := 0.0
	for wid in bd:
		var v = bd[wid]
		var tot := 0.0
		var recent := -1.0
		if v is Dictionary:
			tot = float(v.get("total", v.get("dmg", 0.0)))
			if v.has("dps"):
				recent = float(v.get("dps", 0.0))
			elif v.has("recent_dps"):
				recent = float(v.get("recent_dps", 0.0))
		else:
			tot = float(v)
		if tot <= 0.0 and recent <= 0.0:
			continue
		grand_total += tot
		entries.append({"id": String(wid), "total": tot, "dps": recent})
	entries.sort_custom(func(a, b): return float(a.total) > float(b.total))
	if entries.is_empty():
		dps_v.add_child(UI.label("暂无伤害记录", 16, Color("a6a8c8"), 3))
	else:
		var elapsed := maxf(1.0, sim.real_t)
		for en in entries:
			var share := (float(en.total) / maxf(1.0, grand_total)) * 100.0
			var dps_val := float(en.dps) if float(en.dps) >= 0.0 else (float(en.total) / elapsed)
			var row_d := HBoxContainer.new()
			row_d.add_theme_constant_override("separation", 10)
			dps_v.add_child(row_d)
			var nm_l := UI.label(_weapon_label(String(en.id)), 16, UI.PAPER, 3)
			nm_l.custom_minimum_size = Vector2(130, 0)
			row_d.add_child(nm_l)
			var pb := ProgressBar.new()
			pb.min_value = 0.0
			pb.max_value = 100.0
			pb.value = share
			pb.show_percentage = false
			pb.custom_minimum_size = Vector2(260, 16)
			pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row_d.add_child(pb)
			var stat_l := UI.label("总伤 %s (%.0f%%)  •  DPS %.0f" % [UI.fmt_int(int(en.total)), share, dps_val], 16, UI.GHOST, 3)
			stat_l.custom_minimum_size = Vector2(300, 0)
			stat_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			row_d.add_child(stat_l)
	# 阴律 & 五派羁绊 & 套装
	var syn_box := PanelContainer.new()
	syn_box.add_theme_stylebox_override("panel", UI.box(Color(0.05, 0.06, 0.15, 0.92), Color("7fe3ff"), 10, 2))
	body.add_child(syn_box)
	var syn_v := VBoxContainer.new()
	syn_v.add_theme_constant_override("separation", 4)
	syn_box.add_child(syn_v)
	var rv2: Variant = sim.get("active_rules")
	var ar2: Array = rv2 if rv2 is Array else []
	syn_v.add_child(UI.label("双阴律（%d / 2）" % ar2.size(), 20, Color("d9b8ff"), 4))
	if ar2.is_empty():
		syn_v.add_child(UI.label("尚未铭刻阴律（升级或灯龛事件有几率获得）", 16, Color("a6a8c8"), 3))
	else:
		for item in ar2:
			var rid := String(item.get("id", "")) if item is Dictionary else String(item)
			var rd: Dictionary = item if (item is Dictionary and item.has("desc")) else _rules_by_id.get(rid, {})
			var r_ic := String(rd.get("icon_tag", _rules_by_id.get(rid, {}).get("icon_tag", "")))
			var r_row := HBoxContainer.new()
			r_row.add_theme_constant_override("separation", 6)
			if r_ic != "" and ResourceLoader.exists("res://assets/icons/%s.png" % r_ic):
				r_row.add_child(UI.icon(r_ic, 22.0))
			r_row.add_child(UI.label("• %s：%s" % [String(rd.get("name", rid)), String(rd.get("desc", ""))], 16, Color("e6ccff"), 3))
			syn_v.add_child(r_row)
	var scv2: Variant = sim.get("school_counts")
	var scd2: Dictionary = scv2 if scv2 is Dictionary else {}
	syn_v.add_child(UI.label("灯派羁绊（2 / 4 / 6）", 20, UI.GOLD, 4))
	var sc_flow := HFlowContainer.new()
	sc_flow.add_theme_constant_override("h_separation", 14)
	sc_flow.add_theme_constant_override("v_separation", 6)
	var sc_any := false
	for sid in scd2:
		var cnt := int(scd2[sid])
		if cnt <= 0:
			continue
		sc_any = true
		var skey := String(sid)
		var sc_def: Dictionary = _schools_by_id.get(skey, {})
		var sname := String(sc_def.get("name", skey))
		var scol: Color = Color(String(sc_def.get("color", "#ffe0a8"))) if sc_def.has("color") else UI.SCHOOL.get(skey, Color("ffe0a8"))
		var tier_desc := "未激活"
		for tr in sc_def.get("tiers", []):
			if tr is Dictionary and cnt >= int(tr.get("count", 99)):
				tier_desc = "%d件生效：%s" % [int(tr.get("count", 2)), String(tr.get("desc", ""))]
		var s_row := HBoxContainer.new()
		s_row.add_theme_constant_override("separation", 5)
		var sc_ic := String(SCHOOL_ICONS.get(skey, ""))
		if sc_ic != "" and ResourceLoader.exists("res://assets/icons/%s.png" % sc_ic):
			s_row.add_child(UI.icon(sc_ic, 22.0))
		s_row.add_child(UI.label("%s ×%d（%s）" % [sname, cnt, tier_desc], 16, scol, 3))
		sc_flow.add_child(s_row)
	if sc_any:
		syn_v.add_child(sc_flow)
	else:
		sc_flow.free()
		syn_v.add_child(UI.label("暂无灯派计数", 16, Color("ffe0a8"), 3))
	var sc_sets := sim.set_counts()
	var sparts: Array = []
	for sid in _sets_by_id:
		var st: Dictionary = _sets_by_id[sid]
		var n := int(sc_sets.get(sid, 0))
		if n >= 2:
			sparts.append("%s 2/2 激活（%s）" % [String(st.get("name", sid)), UI.fmt_set_bonus(st)])
		elif n == 1:
			sparts.append("%s 1/2（2件：%s）" % [String(st.get("name", sid)), UI.fmt_set_bonus(st)])
	syn_v.add_child(UI.label("2件套装：" + (" • ".join(PackedStringArray(sparts)) if not sparts.is_empty() else "暂无"), 16, Color("9fe8ff"), 3))
	# 进化进度 & 局内明细
	var guide: Array = []
	for ev in GameData.UP.evolutions:
		var w: Dictionary = GameData.UPS[ev.weapon]
		var nd: Dictionary = GameData.UPS[ev.needs]
		var wl := sim.lv(ev.weapon)
		if wl > 0:
			var done: bool = sim.evo.has(ev.weapon)
			guide.append("%s Lv%d/%d + 「%s」%s →「%s」%s" % [w.name, wl, int(w.max), nd.name, "（已持有）" if sim.lv(ev.needs) > 0 else "（缺）", ev.name, "（已进化）" if done else ""])
	if sim.has_sword():
		var nms: Array = GameData.DG.sword.stages.names
		var nxt := ("已圆满 • 精通 %d/5" % sim.sw_master) if sim.sw_stage >= 5 else "下一阶「%s」：剑意 %d/%d 或击败守关者" % [nms[sim.sw_stage], sim.sw_kills, sim._sw_thr(sim.sw_stage - 1)]
		guide.append("飞剑 第 %d/5 阶 • %s" % [sim.sw_stage, nxt])
	guide.append("彩虹葫芦 %d/7%s" % [sim.gourds.size(), "  • 小金刚助战中（累计输出 %s）" % UI.fmt_int(int(sim.dmg_by.get("pet", 0.0))) if sim.pet_on else ""])
	if sim.ail_on:
		var lg: Dictionary = sim.ail_log
		guide.append("异常反应：雷火爆 %d • 焚符 %d • 镇雷 %d • 百邪崩 %d" % [int(lg.get("leihuo", 0)), int(lg.get("fenfu", 0)), int(lg.get("zhenlei", 0)), int(lg.get("collapse", 0))])
	for gl in guide:
		var gx := UI.label(gl, 16, Color("c9e8ff"), 3)
		gx.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		body.add_child(gx)
	var bc := CenterContainer.new()
	col.add_child(bc)
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 16)
	bc.add_child(hb)
	var b1 := UI.button("继续", Vector2(200, 54), true, 26)
	b1.pressed.connect(func(): game.toggle_pause())
	hb.add_child(b1)
	var b2 := UI.button("声音：%s" % ("关" if Audio.muted else "开"), Vector2(200, 54), false, 26)
	b2.pressed.connect(func():
		game.toggle_mute()
		b2.text = "声音：%s" % ("关" if Audio.muted else "开"))
	hb.add_child(b2)
	var b2s := UI.button("手动存档", Vector2(200, 54), false, 26)
	b2s.pressed.connect(func(): game.manual_save())
	hb.add_child(b2s)
	var b2g := UI.button("结算本局 (X)", Vector2(200, 54), false, 26)
	b2g.pressed.connect(func(): game.give_up())
	hb.add_child(b2g)
	var b3 := UI.button("回标题", Vector2(200, 54), false, 26)
	b3.pressed.connect(func(): game.to_title())
	hb.add_child(b3)
	var hint := UI.label("" if touch_mode else "Esc 继续", 16, Color(0.8, 0.82, 0.95, 0.8), 3)
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
		var l := UI.label("%s %s" % [it.name, it.lv] if it.lv != "" else it.name, 16, UI.PAPER, 3)
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
	var tl := UI.label("灯骸伏诛 • 天明" if win else "灯 灭 了", 26, UI.GOLD if win else UI.BLOOD, 6)
	tl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(tl)
	var cause := ""
	if not win and r.cause != "":
		cause = ("  •  主动撤离" if r.cause == "abandon" else "  •  倒在 %s" % _cause_name(r.cause))
	var l1 := UI.label("守夜 %s  •  等级 %d  •  击杀 %d%s" % [UI.fmt_time(r.time), r.level, r.kills, cause], 26, UI.PAPER, 5)
	l1.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(l1)
	var rifts := 0
	var clears := 0
	for e in r.rift:
		rifts += 1
		if e.ok:
			clears += 1
	rifts = maxi(rifts, int(r.get("rift_entries", 0)))
	clears = maxi(clears, int(r.get("rift_clears", 0)))
	var pet_s := ("  •  小金刚输出 %s" % UI.fmt_int(int(r.get("pet_dmg", 0)))) if int(r.get("pet_dmg", 0)) > 0 else ""
	var l2 := UI.label("输出最高：%s%s  •  入裂隙 %d 次（通关 %d）%s" % [r.top, pet_s, rifts, clears, "  •  法宝：飞剑术" if r.artifact == "sword" else ""], 20, Color("d6d0f0"), 4)
	l2.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(l2)
	col.add_child(_build_row(r.build, "本局构筑"))
	var l3 := UI.label("获得魂火 +%d" % r.soul, 26, UI.GHOST, 6)
	l3.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(l3)
	var bc := CenterContainer.new()
	col.add_child(bc)
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 22)
	bc.add_child(hb)
	var b1 := UI.button("再来一局", Vector2(250, 62), true, 26)
	b1.pressed.connect(func(): game.restart())
	hb.add_child(b1)
	var b2 := UI.button("回标题", Vector2(220, 62), false, 26)
	b2.pressed.connect(func(): game.to_title())
	hb.add_child(b2)
	var hint := UI.label("种子 %d%s" % [r.seed, "" if touch_mode else "  •  Enter / R 再来一局"], 16, Color(0.8, 0.82, 0.95, 0.8), 3)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(hint)
	UI.pop_in(col)


func _cause_name(c: String) -> String:
	var names := {"paperman": "纸扎人", "foxfire": "狐火", "lantern": "破灯笼妖", "jiangshi": "跳尸", "firecracker": "爆竹鬼", "boss": "灯骸老祖", "warden": "剑灵", "elite_jiangshi": "跳尸王", "elite_lantern": "破灯笼王", "swordlord": "剑冢真主", "sedan": "纸轿冥娘", "lamps": "百灯鬼王", "x": "未知"}
	var hows := {"contact": "撞击", "bullet": "鬼火", "slam": "震击", "blast": "爆炸", "blade": "灵剑", "lunge": "突刺", "rain": "剑雨", "ring": "剑阵", "charge": "冲锋", "paper": "纸钱", "lamp": "鬼灯", "beam": "鬼火射线"}
	if c == "abandon":
		return "主动撤离"
	var p := c.split(":")
	var base: String = names.get(p[0], "妖物")
	var how: String = hows.get(p[1] if p.size() > 1 else "", "")
	return base + how
