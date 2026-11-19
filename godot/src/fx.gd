class_name Fx
extends RefCounted
## 程序化纹理（辉光 / 雾 / 夜色暗角）与通用常量

static var _cache: Dictionary = {}


static func radial(key: String, size: int, stops: Array) -> Texture2D:
	if _cache.has(key):
		return _cache[key]
	var g := Gradient.new()
	var offs := PackedFloat32Array()
	var cols := PackedColorArray()
	for s in stops:
		offs.append(s[0])
		cols.append(s[1])
	g.offsets = offs
	g.colors = cols
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	t.width = size
	t.height = size
	_cache[key] = t
	return t


static func glow() -> Texture2D:
	return radial("glow", 64, [[0.0, Color(1, 1, 1, 1)], [0.35, Color(1, 1, 1, 0.5)], [1.0, Color(1, 1, 1, 0)]])


static func night() -> Texture2D:
	return radial("night", 256, [[0.0, Color(0.02, 0.03, 0.1, 0.0)], [0.32, Color(0.02, 0.03, 0.1, 0.0)], [0.62, Color(0.02, 0.03, 0.1, 0.45)], [1.0, Color(0.015, 0.02, 0.06, 0.88)]])


static func tex(path: String) -> Texture2D:
	if _cache.has(path):
		return _cache[path]
	var t: Texture2D = load(path)
	_cache[path] = t
	return t
