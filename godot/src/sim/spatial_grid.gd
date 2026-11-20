class_name SpatialGrid
extends RefCounted
## 零分配空间哈希网格：复用格子 Array 池与调用方输出缓冲，避免每帧 GC 抖动。

const CELL := 80.0
const INV_CELL := 1.0 / CELL
const KEY_STRIDE := 4096
const MAX_SEP_NEIGHBORS := 8

var _cells: Dictionary = {}
var _used_keys: Array[int] = []
var _pool: Array = []


func rebuild(enemies: Array) -> void:
	# 回收上一帧占用的格子数组到池中（仅 clear，不释放）
	for i in range(_used_keys.size()):
		var k: int = _used_keys[i]
		var arr: Array = _cells[k]
		arr.clear()
		_pool.append(arr)
	_cells.clear()
	_used_keys.clear()
	for i in range(enemies.size()):
		var e: SimEnemy = enemies[i]
		if not e.alive:
			continue
		var k: int = int(e.x * INV_CELL) * KEY_STRIDE + int(e.y * INV_CELL)
		var arr_v: Variant = _cells.get(k)
		if arr_v == null:
			var bucket: Array = _pool.pop_back() if _pool.size() > 0 else []
			bucket.append(e)
			_cells[k] = bucket
			_used_keys.append(k)
		else:
			(arr_v as Array).append(e)


func get_cell_at(x: float, y: float) -> Variant:
	return _cells.get(int(x * INV_CELL) * KEY_STRIDE + int(y * INV_CELL))


func query_into(x: float, y: float, r: float, out: Array) -> Array:
	out.clear()
	var x0 := int((x - r) * INV_CELL)
	var x1 := int((x + r) * INV_CELL)
	var y0 := int((y - r) * INV_CELL)
	var y1 := int((y + r) * INV_CELL)
	for cx in range(x0, x1 + 1):
		var base_k := cx * KEY_STRIDE
		for cy in range(y0, y1 + 1):
			var arr: Variant = _cells.get(base_k + cy)
			if arr != null:
				var a: Array = arr
				for j in range(a.size()):
					var e: SimEnemy = a[j]
					if e.alive:
						out.append(e)
	return out


func query_ellipse_into(x: float, y: float, rx: float, ry: float, out: Array) -> Array:
	out.clear()
	var x0 := int((x - rx) * INV_CELL)
	var x1 := int((x + rx) * INV_CELL)
	var y0 := int((y - ry) * INV_CELL)
	var y1 := int((y + ry) * INV_CELL)
	for cx in range(x0, x1 + 1):
		var base_k := cx * KEY_STRIDE
		for cy in range(y0, y1 + 1):
			var arr: Variant = _cells.get(base_k + cy)
			if arr != null:
				var a: Array = arr
				for j in range(a.size()):
					var e: SimEnemy = a[j]
					if e.alive:
						out.append(e)
	return out


func nearest(x: float, y: float, r: float, skip_uids: Dictionary = {}) -> SimEnemy:
	var best: SimEnemy = null
	var bd := r * r
	var has_skip := not skip_uids.is_empty()
	var x0 := int((x - r) * INV_CELL)
	var x1 := int((x + r) * INV_CELL)
	var y0 := int((y - r) * INV_CELL)
	var y1 := int((y + r) * INV_CELL)
	for cx in range(x0, x1 + 1):
		var base_k := cx * KEY_STRIDE
		for cy in range(y0, y1 + 1):
			var arr: Variant = _cells.get(base_k + cy)
			if arr == null:
				continue
			var a: Array = arr
			for j in range(a.size()):
				var e: SimEnemy = a[j]
				if not e.alive:
					continue
				if has_skip and skip_uids.has(e.uid):
					continue
				var dx := e.x - x
				var dy := e.y - y
				var d := dx * dx + dy * dy
				if d < bd or (d == bd and best != null and e.uid < best.uid):
					bd = d
					best = e
	return best
