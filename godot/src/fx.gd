class_name Fx
extends RefCounted
## 程序化纹理（辉光 / 雾 / 夜色暗角）、阻尼弹簧（SNKRX 手感）与零分配粒子池

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
