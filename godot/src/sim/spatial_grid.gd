class_name SpatialGrid
extends RefCounted
## 零分配扁平空间网格：预分配 45×30=1350 个桶数组 + 紧凑占用索引表，零 Dictionary 哈希探测与 GC 抖动。

const CELL := 80.0
const INV_CELL := 1.0 / CELL
const COLS := 45
const ROWS := 30
const CELL_COUNT := COLS * ROWS
const MAX_SEP_NEIGHBORS := 8

var _cells: Dictionary = {}              # 保留空表兼容外部只读引用
var _buckets: Array = []                 # 长度 CELL_COUNT，每格预分配 Array
var _occupied := PackedInt32Array()      # 紧凑记录本帧非空桶索引
var _occ_count := 0


func _init() -> void:
	_buckets.resize(CELL_COUNT)
	for i in range(CELL_COUNT):
		_buckets[i] = []
	_occupied.resize(CELL_COUNT)


func rebuild(enemies: Array) -> void:
	var buckets := _buckets
	var occ := _occupied
	var oc := _occ_count
	for i in range(oc):
		(buckets[occ[i]] as Array).clear()
	oc = 0
	var n := enemies.size()
	for i in range(n):
		var e: SimEnemy = enemies[i]
		if not e.alive:
			continue
		var cx := int(e.x * INV_CELL)
		if cx < 0:
			cx = 0
		elif cx >= COLS:
			cx = COLS - 1
		var cy := int(e.y * INV_CELL)
		if cy < 0:
			cy = 0
		elif cy >= ROWS:
			cy = ROWS - 1
		var idx := cx + cy * COLS
		e.grid_idx = idx
		var bucket: Array = buckets[idx]
		if bucket.is_empty():
			occ[oc] = idx
			oc += 1
		bucket.append(e)
	_occ_count = oc


func get_cell_at(x: float, y: float) -> Array:
	var cx := clampi(int(x * INV_CELL), 0, COLS - 1)
	var cy := clampi(int(y * INV_CELL), 0, ROWS - 1)
	return _buckets[cx + cy * COLS]


func query_into(x: float, y: float, r: float, out: Array) -> Array:
	out.clear()
	var x0 := int((x - r) * INV_CELL)
	var x1 := int((x + r) * INV_CELL)
	var y0 := int((y - r) * INV_CELL)
	var y1 := int((y + r) * INV_CELL)
	if x1 < 0 or x0 >= COLS or y1 < 0 or y0 >= ROWS:
		return out
	if x0 < 0:
		x0 = 0
	if x1 >= COLS:
		x1 = COLS - 1
	if y0 < 0:
		y0 = 0
	if y1 >= ROWS:
		y1 = ROWS - 1
	for cy in range(y0, y1 + 1):
		var row := cy * COLS
		for cx in range(x0, x1 + 1):
			var a: Array = _buckets[row + cx]
			var sz := a.size()
			for j in range(sz):
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
	if x1 < 0 or x0 >= COLS or y1 < 0 or y0 >= ROWS:
		return out
	if x0 < 0:
		x0 = 0
	if x1 >= COLS:
		x1 = COLS - 1
	if y0 < 0:
		y0 = 0
	if y1 >= ROWS:
		y1 = ROWS - 1
	for cy in range(y0, y1 + 1):
		var row := cy * COLS
		for cx in range(x0, x1 + 1):
			var a: Array = _buckets[row + cx]
			var sz := a.size()
			for j in range(sz):
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
	if x1 < 0 or x0 >= COLS or y1 < 0 or y0 >= ROWS:
		return null
	if x0 < 0:
		x0 = 0
	if x1 >= COLS:
		x1 = COLS - 1
	if y0 < 0:
		y0 = 0
	if y1 >= ROWS:
		y1 = ROWS - 1
	for cy in range(y0, y1 + 1):
		var row := cy * COLS
		for cx in range(x0, x1 + 1):
			var a: Array = _buckets[row + cx]
			var sz := a.size()
			for j in range(sz):
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
