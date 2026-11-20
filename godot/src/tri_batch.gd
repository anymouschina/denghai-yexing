class_name TriBatch
extends RefCounted
## 三角形批：同一张贴图的所有四边形累积到一组数组里，flush 时用 RenderingServer.canvas_item_add_triangle_array 一次提交（1 个绘制调用）。
## 水平翻转通过交换 UV 的 u0/u1 实现，旋转直接算四顶点，不依赖 draw_set_transform。
var pts := PackedVector2Array()
var uvs := PackedVector2Array()
var cols := PackedColorArray()
var idx := PackedInt32Array()
var n := 0


func clear() -> void:
	pts.resize(0)
	uvs.resize(0)
	cols.resize(0)
	idx.resize(0)
	n = 0


func _idx() -> void:
	var b := pts.size() - 4
	idx.append(b)
	idx.append(b + 1)
	idx.append(b + 2)
	idx.append(b)
	idx.append(b + 2)
	idx.append(b + 3)
	n += 1


## 轴对齐矩形；翻转用 u0>u1 表达
func rect(x: float, y: float, w: float, h: float, u0: float, v0: float, u1: float, v1: float, col: Color) -> void:
	pts.append(Vector2(x, y))
	pts.append(Vector2(x + w, y))
	pts.append(Vector2(x + w, y + h))
	pts.append(Vector2(x, y + h))
	uvs.append(Vector2(u0, v0))
	uvs.append(Vector2(u1, v0))
	uvs.append(Vector2(u1, v1))
	uvs.append(Vector2(u0, v1))
	cols.append(col)
	cols.append(col)
	cols.append(col)
	cols.append(col)
	_idx()


## 整图矩形（UV 0..1）
func full(x: float, y: float, w: float, h: float, col: Color) -> void:
	rect(x, y, w, h, 0.0, 0.0, 1.0, 1.0, col)


## Anchors.rect 的结果（负宽 = 水平翻转）+ 图集区域 uv=(u0,v0,u1,v1) 归一化
func anchored(r: Rect2, uv: Rect2, col: Color) -> void:
	if r.size.x < 0.0:
		rect(r.position.x, r.position.y, -r.size.x, r.size.y, uv.end.x, uv.position.y, uv.position.x, uv.end.y, col)
	else:
		rect(r.position.x, r.position.y, r.size.x, r.size.y, uv.position.x, uv.position.y, uv.end.x, uv.end.y, col)


## 绕中心旋转的整图四边形
func rot(c: Vector2, ang: float, w: float, h: float, col: Color) -> void:
	var ca := cos(ang)
	var sa := sin(ang)
	var hx := Vector2(ca, sa) * (w * 0.5)
	var hy := Vector2(-sa, ca) * (h * 0.5)
	pts.append(c - hx - hy)
	pts.append(c + hx - hy)
	pts.append(c + hx + hy)
	pts.append(c - hx + hy)
	uvs.append(Vector2(0, 0))
	uvs.append(Vector2(1, 0))
	uvs.append(Vector2(1, 1))
	uvs.append(Vector2(0, 1))
	cols.append(col)
	cols.append(col)
	cols.append(col)
	cols.append(col)
	_idx()


func flush(ci: RID, tex: Texture2D) -> void:
	if pts.size() > 0:
		RenderingServer.canvas_item_add_triangle_array(ci, idx, pts, cols, uvs, PackedInt32Array(), PackedFloat32Array(), tex.get_rid())
	clear()


## 凸多边形（三角扇），用于圆、箭头；uv 取贴图中心（配合 1×1 白图使用）
func poly(points: PackedVector2Array, col: Color) -> void:
	var c0 := pts.size()
	var base := c0
	for q in points:
		pts.append(q)
		uvs.append(Vector2(0.5, 0.5))
		cols.append(col)
	for i in range(1, points.size() - 1):
		idx.append(base)
		idx.append(base + i)
		idx.append(base + i + 1)


func circle(c: Vector2, r: float, col: Color, segs: int = 14) -> void:
	var q := PackedVector2Array()
	for i in range(segs):
		var a := float(i) / float(segs) * TAU
		q.append(c + Vector2(cos(a), sin(a)) * r)
	poly(q, col)


func quad4(a: Vector2, b: Vector2, c: Vector2, d: Vector2, col: Color) -> void:
	pts.append(a)
	pts.append(b)
	pts.append(c)
	pts.append(d)
	for i in range(4):
		uvs.append(Vector2(0.5, 0.5))
		cols.append(col)
	_idx()


func line(a: Vector2, b: Vector2, w: float, col: Color) -> void:
	var d := b - a
	if d.length_squared() < 0.0001:
		return
	var nrm := Vector2(-d.y, d.x).normalized() * (w * 0.5)
	quad4(a - nrm, a + nrm, b + nrm, b - nrm, col)


func polyline(pl: PackedVector2Array, w: float, col: Color) -> void:
	for i in range(pl.size() - 1):
		line(pl[i], pl[i + 1], w, col)


func arc(c: Vector2, r: float, w: float, a0: float, a1: float, col: Color, segs: int = 28) -> void:
	var prev := c + Vector2(cos(a0), sin(a0)) * r
	for i in range(1, segs + 1):
		var a := a0 + (a1 - a0) * float(i) / float(segs)
		var cur := c + Vector2(cos(a), sin(a)) * r
		line(prev, cur, w, col)
		prev = cur


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
	var b := pts.size()
	pts.append(Vector2(x, y))
	pts.append(Vector2(x + w, y))
	pts.append(Vector2(x + w, y + h))
	pts.append(Vector2(x, y + h))
	uvs.append(Vector2(u0, v0))
	uvs.append(Vector2(u1, v0))
	uvs.append(Vector2(u1, v1))
	uvs.append(Vector2(u0, v1))
	cols.append(col)
	cols.append(col)
	cols.append(col)
	cols.append(col)
	idx.append(b)
	idx.append(b + 1)
	idx.append(b + 2)
	idx.append(b)
	idx.append(b + 2)
	idx.append(b + 3)
