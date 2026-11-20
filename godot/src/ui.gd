class_name UI
extends RefCounted
## 界面小工具：字体、描边、面板与按钮样式（暗夜灯笼国风：墨蓝底 + 灯笼橙描边）

const INK := Color("0b0d18")
const ORANGE := Color("ff9a3c")
const GOLD := Color("ffc977")
const PAPER := Color("f3e6c8")
const GHOST := Color("7fe3ff")
const BLOOD := Color("e0463a")
const PANEL := Color(0.06, 0.07, 0.16, 0.92)
const RARITY := {"white": Color("e8e6f5"), "blue": Color("6fb6ff"), "purple": Color("c08cff"), "gold": Color("ffcf5a")}
const SCHOOL := {
	"fu": Color("f2c14b"), "符": Color("f2c14b"),
	"huo": Color("ff9a3c"),
	"lei": Color("7fd6ff"),
	"zhen": Color("7fd6ff"), "阵": Color("7fd6ff"),
	"gu": Color("6fdc7a"), "蛊": Color("6fdc7a"),
	"sha": Color("ff5a5a"), "煞": Color("ff5a5a"),
	"hun": Color("c08cff"), "魂": Color("c08cff"),
	"gen": Color("b39cff"),
}
const SCHOOL_NAME := {
	"fu": "符", "符": "符",
	"zhen": "阵", "阵": "阵",
	"gu": "蛊", "蛊": "蛊",
	"sha": "煞", "煞": "煞",
	"hun": "魂", "魂": "魂",
	"huo": "火", "lei": "雷", "gen": "通",
}

static var _font: Font = null
static var _theme: Theme = null


## 画布文字字号收敛为 3 档（16/20/26），字形图集页数最少
static func snap_size(size: int) -> int:
	if size <= 17:
		return 16
	if size <= 22:
		return 20
	return 26


static func font() -> Font:
	if _font == null:
		_font = load("res://fonts/MaShanZheng-subset.ttf")
	return _font


static func theme() -> Theme:
	if _theme == null:
		_theme = Theme.new()
		_theme.default_font = font()
		_theme.default_font_size = 22
	return _theme


static func box(bg: Color, border: Color, radius: int = 12, bw: int = 3) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(bw)
	s.set_corner_radius_all(radius)
	s.shadow_color = Color(0, 0, 0, 0.45)
	s.shadow_size = 6
	s.content_margin_left = 14
	s.content_margin_right = 14
	s.content_margin_top = 8
	s.content_margin_bottom = 8
	return s


static func label(text: String, size: int = 22, color: Color = PAPER, outline: int = 5) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font())
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if outline > 0:
		l.add_theme_color_override("font_outline_color", INK)
		l.add_theme_constant_override("outline_size", outline)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


static func button(text: String, size: Vector2, primary: bool = false, font_size: int = 28) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = size
	b.add_theme_font_override("font", font())
	b.add_theme_font_size_override("font_size", font_size)
	b.add_theme_color_override("font_color", INK if primary else PAPER)
	b.add_theme_color_override("font_hover_color", INK if primary else Color.WHITE)
	b.add_theme_color_override("font_pressed_color", INK if primary else GOLD)
	b.add_theme_color_override("font_focus_color", INK if primary else PAPER)
	var base := ORANGE if primary else Color(0.1, 0.12, 0.26, 0.95)
	var edge := INK if primary else ORANGE
	b.add_theme_stylebox_override("normal", box(base, edge, 14, 3))
	b.add_theme_stylebox_override("hover", box(base.lightened(0.18), GOLD, 14, 3))
	b.add_theme_stylebox_override("pressed", box(base.darkened(0.2), GOLD, 14, 3))
	b.add_theme_stylebox_override("focus", box(base, GOLD, 14, 3))
	b.add_theme_stylebox_override("disabled", box(Color(0.12, 0.12, 0.18, 0.8), Color(0.3, 0.3, 0.4), 14, 3))
	b.pivot_offset = size / 2.0
	b.focus_mode = Control.FOCUS_NONE
	b.button_down.connect(func(): b.scale = Vector2(0.94, 0.94))
	b.button_up.connect(func(): b.scale = Vector2.ONE)
	b.mouse_entered.connect(func(): b.pivot_offset = b.size / 2.0)
	return b


static func icon(id: String, size: float = 56.0) -> TextureRect:
	var tr := TextureRect.new()
	var path := "res://assets/icons/%s.png" % id
	if ResourceLoader.exists(path):
		tr.texture = load(path)
	tr.custom_minimum_size = Vector2(size, size)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return tr


## 千分位：1000000 -> "1,000,000"（Boss 百万血条用）
static func fmt_int(n: int) -> String:
	var neg := n < 0
	var d := str(absi(n))
	var out := ""
	while d.length() > 3:
		out = "," + d.substr(d.length() - 3) + out
		d = d.substr(0, d.length() - 3)
	return ("-" if neg else "") + d + out


static func fmt_time(sec: float) -> String:
	var s := int(sec)
	return "%d:%02d" % [s / 60, s % 60]


static func load_json_safe(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	return JSON.parse_string(f.get_as_text())


static func fmt_set_bonus(sd: Dictionary) -> String:
	if sd.has("desc") and String(sd.get("desc", "")) != "":
		return String(sd.get("desc", ""))
	var st := String(sd.get("stat", ""))
	var per := float(sd.get("per", 0.0))
	match st:
		"dmg":
			return "伤害 +%d%%" % int(round(per * 100.0))
		"crit":
			return "暴击 +%d%%" % int(round(per * 100.0))
		"speed":
			return "移速 +%d%%" % int(round(per * 100.0))
		"pickup":
			return "拾取范围 +%d%%" % int(round(per * 100.0))
		"dmgTaken":
			return "减伤 +%d%%" % int(round(absf(per) * 100.0))
		"maxHp":
			return "生命上限 +%d" % int(round(per))
		"cd":
			return "冷却 -%d%%" % int(round(absf(per) * 100.0))
		"oil":
			return "灯油效率 +%d%%" % int(round(per * 100.0))
	return ""


static func pop_in(c: Control, delay: float = 0.0) -> void:
	c.pivot_offset = c.size / 2.0
	c.scale = Vector2(0.86, 0.86)
	c.modulate.a = 0.0
	var tw := c.create_tween().set_parallel(true).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)
	tw.tween_property(c, "scale", Vector2.ONE, 0.28).set_delay(delay)
	tw.tween_property(c, "modulate:a", 1.0, 0.2).set_delay(delay)
