class_name TriBatch
extends RefCounted
## 三角形批：同一张贴图的所有四边形/圆/线条累积到预分配缓冲区，flush 时用 RenderingServer.canvas_item_add_triangle_array 一次提交（1 个绘制调用）。
## 仅扩容不缩容 + 整数写游标（零逐帧 resize(0) 与 append 扩容风暴）；圆/环使用静态单位圆查找表（零逐帧 PackedVector2Array 分配）。
## 水平翻转通过交换 UV 的 u0/u1 实现，旋转直接算四顶点，不依赖 draw_set_transform。

const INIT_VCAP := 256
const INIT_ICAP := 384
const UV00 := Vector2(0.0, 0.0)
const UV10 := Vector2(1.0, 0.0)
const UV11 := Vector2(1.0, 1.0)
const UV01 := Vector2(0.0, 1.0)
const UV_MID := Vector2(0.5, 0.5)

static var _circle_lut: Dictionary = {}
static var _EMPTY_INT := PackedInt32Array()
static var _EMPTY_FLOAT := PackedFloat32Array()

var pts := PackedVector2Array()
var uvs := PackedVector2Array()
var cols := PackedColorArray()
var idx := PackedInt32Array()
var _vc := 0
var _ic := 0
var _vcap := 0
var _icap := 0
var n := 0


func _init(init_quads: int = 64) -> void:
	_vcap = maxi(INIT_VCAP, init_quads * 4)
	_icap = maxi(INIT_ICAP, init_quads * 6)
	pts.resize(_vcap)
	uvs.resize(_vcap)
	cols.resize(_vcap)
	idx.resize(_icap)


static func _get_lut(segs: int) -> PackedVector2Array:
	var cached: Variant = _circle_lut.get(segs)
	if cached != null:
		return cached
	var arr := PackedVector2Array()
	arr.resize(segs)
	var step := TAU / float(segs)
	for i in range(segs):
		var a := float(i) * step
		arr[i] = Vector2(cos(a), sin(a))
	_circle_lut[segs] = arr
	return arr


static func _next_pow2(v: int) -> int:
	if v <= 64:
		return 64
	var p := v - 1
	p |= p >> 1
	p |= p >> 2
	p |= p >> 4
	p |= p >> 8
	p |= p >> 16
	return p + 1


func _ensure(add_v: int, add_i: int) -> void:
	var need_v := _vc + add_v
	if need_v > _vcap:
		var nv := _next_pow2(need_v)
		_vcap = nv
		pts.resize(nv)
		uvs.resize(nv)
		cols.resize(nv)
	var need_i := _ic + add_i
	if need_i > _icap:
		var ni := _next_pow2(need_i)
		_icap = ni
		idx.resize(ni)


func clear() -> void:
	_vc = 0
	_ic = 0
	n = 0


## 轴对齐矩形；翻转用 u0>u1 表达
func rect(x: float, y: float, w: float, h: float, u0: float, v0: float, u1: float, v1: float, col: Color) -> void:
	_ensure(4, 6)
	var v := _vc
	var ii := _ic
	pts[v] = Vector2(x, y)
	pts[v + 1] = Vector2(x + w, y)
	pts[v + 2] = Vector2(x + w, y + h)
	pts[v + 3] = Vector2(x, y + h)
	uvs[v] = Vector2(u0, v0)
	uvs[v + 1] = Vector2(u1, v0)
	uvs[v + 2] = Vector2(u1, v1)
	uvs[v + 3] = Vector2(u0, v1)
	cols[v] = col
	cols[v + 1] = col
	cols[v + 2] = col
	cols[v + 3] = col
	idx[ii] = v
	idx[ii + 1] = v + 1
	idx[ii + 2] = v + 2
	idx[ii + 3] = v
	idx[ii + 4] = v + 2
	idx[ii + 5] = v + 3
	_vc = v + 4
	_ic = ii + 6
	n += 1


## 整图矩形（UV 0..1）
func full(x: float, y: float, w: float, h: float, col: Color) -> void:
	_ensure(4, 6)
	var v := _vc
	var ii := _ic
	pts[v] = Vector2(x, y)
	pts[v + 1] = Vector2(x + w, y)
	pts[v + 2] = Vector2(x + w, y + h)
	pts[v + 3] = Vector2(x, y + h)
	uvs[v] = UV00
	uvs[v + 1] = UV10
	uvs[v + 2] = UV11
	uvs[v + 3] = UV01
	cols[v] = col
	cols[v + 1] = col
	cols[v + 2] = col
	cols[v + 3] = col
	idx[ii] = v
	idx[ii + 1] = v + 1
	idx[ii + 2] = v + 2
	idx[ii + 3] = v
	idx[ii + 4] = v + 2
	idx[ii + 5] = v + 3
	_vc = v + 4
	_ic = ii + 6
	n += 1


## Anchors.rect 的结果（负宽 = 水平翻转）+ 图集区域 uv=(u0,v0,u1,v1) 归一化
func anchored(r: Rect2, uv: Rect2, col: Color) -> void:
	if r.size.x < 0.0:
		rect(r.position.x, r.position.y, -r.size.x, r.size.y, uv.end.x, uv.position.y, uv.position.x, uv.end.y, col)
	else:
		rect(r.position.x, r.position.y, r.size.x, r.size.y, uv.position.x, uv.position.y, uv.end.x, uv.end.y, col)


## 绕中心旋转的整图四边形
func rot(c: Vector2, ang: float, w: float, h: float, col: Color) -> void:
	_ensure(4, 6)
	var ca := cos(ang)
	var sa := sin(ang)
	var hwx := ca * (w * 0.5)
	var hwy := sa * (w * 0.5)
	var hhx := -sa * (h * 0.5)
	var hhy := ca * (h * 0.5)
	var cx := c.x
	var cy := c.y
	var v := _vc
	var ii := _ic
	pts[v] = Vector2(cx - hwx - hhx, cy - hwy - hhy)
	pts[v + 1] = Vector2(cx + hwx - hhx, cy + hwy - hhy)
	pts[v + 2] = Vector2(cx + hwx + hhx, cy + hwy + hhy)
	pts[v + 3] = Vector2(cx - hwx + hhx, cy - hwy + hhy)
	uvs[v] = UV00
	uvs[v + 1] = UV10
	uvs[v + 2] = UV11
	uvs[v + 3] = UV01
	cols[v] = col
	cols[v + 1] = col
	cols[v + 2] = col
	cols[v + 3] = col
	idx[ii] = v
	idx[ii + 1] = v + 1
	idx[ii + 2] = v + 2
	idx[ii + 3] = v
	idx[ii + 4] = v + 2
	idx[ii + 5] = v + 3
	_vc = v + 4
	_ic = ii + 6
	n += 1


func flush(ci: RID, tex: Texture2D) -> void:
	var npts := _vc
	var nidx := _ic
	if npts > 0 and nidx > 0:
		var rid := tex.get_rid()
		if npts <= 60000:
			# 原地调整逻辑长度（同 2 的幂桶内零分配零拷贝），彻底消除逐 flush .slice() 拷贝
			if _vcap != npts:
				pts.resize(npts)
				uvs.resize(npts)
				cols.resize(npts)
				_vcap = npts
			if _icap != nidx:
				idx.resize(nidx)
				_icap = nidx
			RenderingServer.canvas_item_add_triangle_array(ci, idx, pts, cols, uvs, _EMPTY_INT, _EMPTY_FLOAT, rid)
		else:
			# WebGL 顶点安全分段提交：防止极端同屏特效撑破单次绘制缓冲区
			var i := 0
			var cpts := PackedVector2Array()
			var cuvs := PackedVector2Array()
			var ccols := PackedColorArray()
			var cidx := PackedInt32Array()
			var remap: Dictionary = {}
			while i + 2 < nidx:
				if cpts.size() >= 54000:
					RenderingServer.canvas_item_add_triangle_array(ci, cidx, cpts, ccols, cuvs, _EMPTY_INT, _EMPTY_FLOAT, rid)
					cpts.resize(0); cuvs.resize(0); ccols.resize(0); cidx.resize(0); remap.clear()
				for k in range(3):
					var oi := idx[i + k]
					var ni: int
					if remap.has(oi):
						ni = int(remap[oi])
					else:
						ni = cpts.size()
						remap[oi] = ni
						cpts.append(pts[oi])
						cuvs.append(uvs[oi])
						ccols.append(cols[oi])
					cidx.append(ni)
				i += 3
			if cpts.size() > 0:
				RenderingServer.canvas_item_add_triangle_array(ci, cidx, cpts, ccols, cuvs, _EMPTY_INT, _EMPTY_FLOAT, rid)
	clear()


## 凸多边形（三角扇），用于圆、箭头；uv 取贴图中心（配合 1×1 白图使用）
func poly(points: PackedVector2Array, col: Color) -> void:
	var cnt := points.size()
	if cnt < 3:
		return
	var tris := cnt - 2
	_ensure(cnt, tris * 3)
	var base := _vc
	var ii := _ic
	var uv_mid := Vector2(0.5, 0.5)
	for i in range(cnt):
		var vi := base + i
		pts[vi] = points[i]
		uvs[vi] = uv_mid
		cols[vi] = col
	for i in range(1, cnt - 1):
		idx[ii] = base
		idx[ii + 1] = base + i
		idx[ii + 2] = base + i + 1
		ii += 3
	_vc = base + cnt
	_ic = ii
	n += 1


## 实心圆（零分配：使用静态单位圆查找表直接写入顶点缓冲）
func circle(c: Vector2, r: float, col: Color, segs: int = 14) -> void:
	if segs < 3 or r <= 0.0:
		return
	var lut := _get_lut(segs)
	var tris := segs - 2
	_ensure(segs, tris * 3)
	var base := _vc
	var ii := _ic
	var uv_mid := Vector2(0.5, 0.5)
	var cx := c.x
	var cy := c.y
	for i in range(segs):
		var u := lut[i]
		var vi := base + i
		pts[vi] = Vector2(cx + u.x * r, cy + u.y * r)
		uvs[vi] = uv_mid
		cols[vi] = col
	for i in range(1, segs - 1):
		idx[ii] = base
		idx[ii + 1] = base + i
		idx[ii + 2] = base + i + 1
		ii += 3
	_vc = base + segs
	_ic = ii
	n += 1


## 整圆环（零分配：基于单位圆 LUT 直接生成内外圈三角带，顶点数仅为 line 循环的一半）
func ring(c: Vector2, r: float, w: float, col: Color, segs: int = 28) -> void:
	if segs < 3 or r <= 0.0:
		return
	var lut := _get_lut(segs)
	var r0 := maxf(0.0, r - w * 0.5)
	var r1 := r + w * 0.5
	_ensure(segs * 2, segs * 6)
	var base := _vc
	var ii := _ic
	var uv_mid := Vector2(0.5, 0.5)
	var cx := c.x
	var cy := c.y
	for i in range(segs):
		var u := lut[i]
		var v0 := base + i * 2
		pts[v0] = Vector2(cx + u.x * r0, cy + u.y * r0)
		pts[v0 + 1] = Vector2(cx + u.x * r1, cy + u.y * r1)
		uvs[v0] = uv_mid
		uvs[v0 + 1] = uv_mid
		cols[v0] = col
		cols[v0 + 1] = col
	for i in range(segs):
		var ni := (i + 1) % segs
		var a0 := base + i * 2
		var b0 := base + ni * 2
		idx[ii] = a0
		idx[ii + 1] = a0 + 1
		idx[ii + 2] = b0 + 1
		idx[ii + 3] = a0
		idx[ii + 4] = b0 + 1
		idx[ii + 5] = b0
		ii += 6
	_vc = base + segs * 2
	_ic = ii
	n += 1


## 椭圆环（零分配，用于飞剑轨道等）
func ellipse_ring(c: Vector2, rx: float, ry: float, w: float, col: Color, segs: int = 36) -> void:
	if segs < 3:
		return
	var lut := _get_lut(segs)
	var hw := w * 0.5
	var rx0 := maxf(0.0, rx - hw)
	var ry0 := maxf(0.0, ry - hw)
	var rx1 := rx + hw
	var ry1 := ry + hw
	_ensure(segs * 2, segs * 6)
	var base := _vc
	var ii := _ic
	var uv_mid := Vector2(0.5, 0.5)
	var cx := c.x
	var cy := c.y
	for i in range(segs):
		var u := lut[i]
		var v0 := base + i * 2
		pts[v0] = Vector2(cx + u.x * rx0, cy + u.y * ry0)
		pts[v0 + 1] = Vector2(cx + u.x * rx1, cy + u.y * ry1)
		uvs[v0] = uv_mid
		uvs[v0 + 1] = uv_mid
		cols[v0] = col
		cols[v0 + 1] = col
	for i in range(segs):
		var ni := (i + 1) % segs
		var a0 := base + i * 2
		var b0 := base + ni * 2
		idx[ii] = a0
		idx[ii + 1] = a0 + 1
		idx[ii + 2] = b0 + 1
		idx[ii + 3] = a0
		idx[ii + 4] = b0 + 1
		idx[ii + 5] = b0
		ii += 6
	_vc = base + segs * 2
	_ic = ii
	n += 1


func quad4(a: Vector2, b: Vector2, c: Vector2, d: Vector2, col: Color) -> void:
	_ensure(4, 6)
	var v := _vc
	var ii := _ic
	var uv_mid := Vector2(0.5, 0.5)
	pts[v] = a
	pts[v + 1] = b
	pts[v + 2] = c
	pts[v + 3] = d
	uvs[v] = uv_mid
	uvs[v + 1] = uv_mid
	uvs[v + 2] = uv_mid
	uvs[v + 3] = uv_mid
	cols[v] = col
	cols[v + 1] = col
	cols[v + 2] = col
	cols[v + 3] = col
	idx[ii] = v
	idx[ii + 1] = v + 1
	idx[ii + 2] = v + 2
	idx[ii + 3] = v
	idx[ii + 4] = v + 2
	idx[ii + 5] = v + 3
	_vc = v + 4
	_ic = ii + 6
	n += 1


func line(a: Vector2, b: Vector2, w: float, col: Color) -> void:
	var dx := b.x - a.x
	var dy := b.y - a.y
	var len2 := dx * dx + dy * dy
	if len2 < 0.0001:
		return
	var inv := (w * 0.5) / sqrt(len2)
	var nx := -dy * inv
	var ny := dx * inv
	quad4(Vector2(a.x - nx, a.y - ny), Vector2(a.x + nx, a.y + ny), Vector2(b.x + nx, b.y + ny), Vector2(b.x - nx, b.y - ny), col)


func polyline(pl: PackedVector2Array, w: float, col: Color) -> void:
	for i in range(pl.size() - 1):
		line(pl[i], pl[i + 1], w, col)


func arc(c: Vector2, r: float, w: float, a0: float, a1: float, col: Color, segs: int = 28) -> void:
	var span := absf(a1 - a0)
	if span >= TAU - 0.001:
		ring(c, r, w, col, segs)
		return
	if segs < 1 or span < 0.0001:
		return
	var r0 := maxf(0.0, r - w * 0.5)
	var r1 := r + w * 0.5
	var vcnt := (segs + 1) * 2
	_ensure(vcnt, segs * 6)
	var base := _vc
	var ii := _ic
	var uv_mid := Vector2(0.5, 0.5)
	var cx := c.x
	var cy := c.y
	var step := (a1 - a0) / float(segs)
	for i in range(segs + 1):
		var a := a0 + step * float(i)
		var ca := cos(a)
		var sa := sin(a)
		var v0 := base + i * 2
		pts[v0] = Vector2(cx + ca * r0, cy + sa * r0)
		pts[v0 + 1] = Vector2(cx + ca * r1, cy + sa * r1)
		uvs[v0] = uv_mid
		uvs[v0 + 1] = uv_mid
		cols[v0] = col
		cols[v0 + 1] = col
	for i in range(segs):
		var a_i := base + i * 2
		var b_i := a_i + 2
		idx[ii] = a_i
		idx[ii + 1] = a_i + 1
		idx[ii + 2] = b_i + 1
		idx[ii + 3] = a_i
		idx[ii + 4] = b_i + 1
		idx[ii + 5] = b_i
		ii += 6
	_vc = base + vcnt
	_ic = ii
	n += 1


## 矩形空心框（4 条边，用于预警框/UI 框）
func rect_frame(x: float, y: float, w: float, h: float, bw: float, col: Color) -> void:
	full(x, y, w, bw, col)
	full(x, y + h - bw, w, bw, col)
	full(x, y + bw, bw, maxf(0.0, h - 2.0 * bw), col)
	full(x + w - bw, y + bw, bw, maxf(0.0, h - 2.0 * bw), col)


## 图集精灵：uv=(u0,v0,宽,高) 归一化区域；flip 时交换左右 UV（等价于水平镜像）
func sprite(x: float, y: float, w: float, h: float, flip: bool, uv: Rect2, col: Color) -> void:
	var u0 := uv.position.x
	var u1 := u0 + uv.size.x
	if flip:
		var t := u0
		u0 = u1
		u1 = t
	var v0 := uv.position.y
	var v1 := v0 + uv.size.y
	_ensure(4, 6)
	var v := _vc
	var ii := _ic
	pts[v] = Vector2(x, y)
	pts[v + 1] = Vector2(x + w, y)
	pts[v + 2] = Vector2(x + w, y + h)
	pts[v + 3] = Vector2(x, y + h)
	uvs[v] = Vector2(u0, v0)
	uvs[v + 1] = Vector2(u1, v0)
	uvs[v + 2] = Vector2(u1, v1)
	uvs[v + 3] = Vector2(u0, v1)
	cols[v] = col
	cols[v + 1] = col
	cols[v + 2] = col
	cols[v + 3] = col
	idx[ii] = v
	idx[ii + 1] = v + 1
	idx[ii + 2] = v + 2
	idx[ii + 3] = v
	idx[ii + 4] = v + 2
	idx[ii + 5] = v + 3
	_vc = v + 4
	_ic = ii + 6
	n += 1
