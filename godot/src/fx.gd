class_name Fx
extends RefCounted
## 程序化纹理（辉光 / 雾 / 夜色暗角）、阻尼弹簧（SNKRX 手感）与零分配粒子池

static var _cache: Dictionary = {}
static var _unit_quad: ArrayMesh = null

const DIGIT_CELL_W := 16
const DIGIT_CELL_H := 20
const DIGIT_COUNT := 13
# 5x7 位图字形（每行 5 bit，从左到右高位到低位）：0-9, +, -, !
const _DIGIT_GLYPHS := [
	[0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E], # 0
	[0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E], # 1
	[0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F], # 2
	[0x1E, 0x01, 0x01, 0x0E, 0x01, 0x01, 0x1E], # 3
	[0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02], # 4
	[0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E], # 5
	[0x0E, 0x10, 0x1E, 0x11, 0x11, 0x11, 0x0E], # 6
	[0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08], # 7
	[0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E], # 8
	[0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C], # 9
	[0x00, 0x04, 0x04, 0x1F, 0x04, 0x04, 0x00], # +
	[0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00], # -
	[0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04], # !
]


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


## 程序化径向圆环贴图（1 个四边形 4 顶点替代 28 段 56 顶点圆环，14x 降顶点）
static func ring_tex() -> Texture2D:
	return radial("ring_tex", 128, [
		[0.0, Color(1, 1, 1, 0.0)],
		[0.74, Color(1, 1, 1, 0.0)],
		[0.84, Color(1, 1, 1, 0.72)],
		[0.90, Color(1, 1, 1, 1.0)],
		[0.95, Color(1, 1, 1, 0.55)],
		[1.0, Color(1, 1, 1, 0.0)],
	])


## MultiMesh 2D 专用单位四边形 [0..1]x[0..1]（UV 无 Y 翻转歧义）
static func unit_quad() -> ArrayMesh:
	if _unit_quad != null:
		return _unit_quad
	var m := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector2Array([
		Vector2(0.0, 0.0),
		Vector2(1.0, 0.0),
		Vector2(1.0, 1.0),
		Vector2(0.0, 1.0),
	])
	arrays[Mesh.ARRAY_TEX_UV] = PackedVector2Array([
		Vector2(0.0, 0.0),
		Vector2(1.0, 0.0),
		Vector2(1.0, 1.0),
		Vector2(0.0, 1.0),
	])
	arrays[Mesh.ARRAY_INDEX] = PackedInt32Array([0, 1, 2, 0, 2, 3])
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	_unit_quad = m
	return _unit_quad


## 伤害飘字位图数字/符号条（0-9, +, -, !），内置 1px 深墨描边（零阴影 pass，1 DC 合批全部数字飘字）
static func digit_strip_tex() -> Texture2D:
	if _cache.has("digit_strip"):
		return _cache["digit_strip"]
	var w := DIGIT_CELL_W * DIGIT_COUNT
	var h := DIGIT_CELL_H
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var outline := Color(0.05, 0.04, 0.08, 0.94)
	for gi in range(DIGIT_COUNT):
		var rows: Array = _DIGIT_GLYPHS[gi]
		var ox := gi * DIGIT_CELL_W + 3
		var oy := 3
		# 先绘 1px 8 邻域深色描边，再绘 2x2 高亮前景
		for ry in range(7):
			var bits := int(rows[ry])
			for rx in range(5):
				if ((bits >> (4 - rx)) & 1) == 0:
					continue
				var bx := ox + rx * 2
				var by := oy + ry * 2
				for dy in range(-1, 3):
					for dx in range(-1, 3):
						var px := bx + dx
						var py := by + dy
						if px >= gi * DIGIT_CELL_W and px < (gi + 1) * DIGIT_CELL_W and py >= 0 and py < h:
							img.set_pixel(px, py, outline)
		for ry in range(7):
			var bits := int(rows[ry])
			var shade := 1.0 - float(ry) * 0.018
			var fg := Color(shade, shade, shade, 1.0)
			for rx in range(5):
				if ((bits >> (4 - rx)) & 1) == 0:
					continue
				var bx := ox + rx * 2
				var by := oy + ry * 2
				img.set_pixel(bx, by, fg)
				img.set_pixel(bx + 1, by, fg)
				img.set_pixel(bx, by + 1, fg)
				img.set_pixel(bx + 1, by + 1, fg)
	var t := ImageTexture.create_from_image(img)
	_cache["digit_strip"] = t
	return t


static func digit_cell(code: int) -> int:
	if code >= 48 and code <= 57:
		return code - 48
	if code == 43: # '+'
		return 10
	if code == 45: # '-'
		return 11
	if code == 33: # '!'
		return 12
	return -1


static func is_digit_str(s: String) -> bool:
	var n := s.length()
	if n == 0:
		return false
	for i in range(n):
		if digit_cell(s.unicode_at(i)) < 0:
			return false
	return true


static func night() -> Texture2D:
	return radial("night", 256, [[0.0, Color(0.02, 0.03, 0.1, 0.0)], [0.32, Color(0.02, 0.03, 0.1, 0.0)], [0.62, Color(0.02, 0.03, 0.1, 0.45)], [1.0, Color(0.015, 0.02, 0.06, 0.88)]])


static func tex(path: String) -> Texture2D:
	if _cache.has(path):
		return _cache[path]
	var t: Texture2D = load(path)
	_cache[path] = t
	return t


## 阻尼弹簧（参考 SNKRX spring 弹性缩放/受击回弹，零每帧分配）
class Spring extends RefCounted:
	var x: float = 1.0
	var v: float = 0.0
	var target: float = 1.0
	var stiffness: float = 280.0
	var damping: float = 18.0

	func _init(p_rest: float = 1.0, p_stiffness: float = 280.0, p_damping: float = 18.0) -> void:
		x = p_rest
		target = p_rest
		stiffness = p_stiffness
		damping = p_damping

	func impulse(dv: float) -> void:
		v += dv

	func pull(dx: float) -> void:
		x += dx

	func step(dt: float) -> float:
		var sdt := minf(dt, 0.05)
		if sdt <= 0.0:
			return x
		var a := -stiffness * (x - target) - damping * v
		v += a * sdt
		x += v * sdt
		return x


## 零分配粒子池（SoA PackedArray + O(1) 交换删除；无逐帧 Dictionary 分配与 remove_at 搬移）
class ParticlePool extends RefCounted:
	var cap: int = 320
	var count: int = 0
	var px := PackedFloat32Array()
	var py := PackedFloat32Array()
	var vx := PackedFloat32Array()
	var vy := PackedFloat32Array()
	var life := PackedFloat32Array()
	var max_life := PackedFloat32Array()
	var size := PackedFloat32Array()
	var grav := PackedFloat32Array()
	var col := PackedColorArray()

	func _init(p_cap: int = 320) -> void:
		cap = maxi(32, p_cap)
		px.resize(cap)
		py.resize(cap)
		vx.resize(cap)
		vy.resize(cap)
		life.resize(cap)
		max_life.resize(cap)
		size.resize(cap)
		grav.resize(cap)
		col.resize(cap)

	func clear() -> void:
		count = 0

	func burst(x: float, y: float, n: int, c: Color, speed: float = 220.0, sz: float = 0.4, p_life: float = 0.5, p_grav: float = 0.0) -> void:
		var m := mini(n, cap - count)
		if m <= 0:
			return
		var idx := count
		for _i in range(m):
			var a := randf() * TAU
			var s := speed * (0.35 + randf() * 0.65)
			var l := p_life * (0.6 + randf() * 0.6)
			px[idx] = x
			py[idx] = y
			vx[idx] = cos(a) * s
			vy[idx] = sin(a) * s
			life[idx] = l
			max_life[idx] = maxf(0.01, p_life)
			size[idx] = sz * (0.7 + randf() * 0.6)
			grav[idx] = p_grav
			col[idx] = c
			idx += 1
		count = idx

	## 挑灯爆焰专用粒子爆发（金焰 + 青白火花，零分配）
	func burst_flare(x: float, y: float, n: int = 44) -> void:
		var half := n / 2
		burst(x, y, half, Color(1.0, 0.82, 0.35, 1.0), 420.0, 0.65, 0.65, -40.0)
		burst(x, y, n - half, Color(1.0, 0.96, 0.78, 1.0), 540.0, 0.42, 0.42, 0.0)

	func tick(dt: float) -> void:
		var i := count - 1
		while i >= 0:
			var l := life[i] - dt
			if l <= 0.0:
				count -= 1
				if i < count:
					px[i] = px[count]
					py[i] = py[count]
					vx[i] = vx[count]
					vy[i] = vy[count]
					life[i] = life[count]
					max_life[i] = max_life[count]
					size[i] = size[count]
					grav[i] = grav[count]
					col[i] = col[count]
			else:
				life[i] = l
				var nvy := vy[i] + grav[i] * dt
				vy[i] = nvy
				px[i] += vx[i] * dt
				py[i] += nvy * dt
			i -= 1

	func draw_into(batch: TriBatch) -> void:
		for i in range(count):
			var k := clampf(life[i] / max_life[i], 0.0, 1.0)
			var c := col[i]
			c.a = k
			var s := 64.0 * size[i] * (0.4 + 0.6 * k)
			var hs := s * 0.5
			batch.full(px[i] - hs, py[i] - hs, s, s, c)

	## 直接写入 MultiMesh 2D 缓冲区（stride = 12 floats: 8 transform2d + 4 color），按相机视口裁剪并返回可见实例数
	func fill_multimesh(buf: PackedFloat32Array, vx0: float = -1e9, vy0: float = -1e9, vx1: float = 1e9, vy1: float = 1e9, max_out: int = -1) -> int:
		var cnt := count
		var lim := buf.size() / 12
		if max_out >= 0 and max_out < lim:
			lim = max_out
		var o := 0
		var vis := 0
		for i in range(cnt):
			var x := px[i]
			var y := py[i]
			if x < vx0 or x > vx1 or y < vy0 or y > vy1:
				continue
			if vis >= lim:
				break
			var k := clampf(life[i] / max_life[i], 0.0, 1.0)
			var s := 64.0 * size[i] * (0.4 + 0.6 * k)
			var hs := s * 0.5
			var c := col[i]
			buf[o] = s
			buf[o + 3] = x - hs
			buf[o + 5] = s
			buf[o + 7] = y - hs
			buf[o + 8] = c.r
			buf[o + 9] = c.g
			buf[o + 10] = c.b
			buf[o + 11] = k
			o += 12
			vis += 1
		return vis
