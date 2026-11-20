class_name DpsTracker
extends RefCounted
## 实时伤害与近 5 秒滑动窗口 DPS 统计（供暂停构筑面板读取，零逐命中数组分配）。

const BUCKETS := 10
const BUCKET_SEC := 0.5
const WINDOW_SEC := BUCKETS * BUCKET_SEC

var _totals: Dictionary = {}
var _rings: Dictionary = {}      # key -> PackedFloat32Array(BUCKETS)
var _cur_idx := 0
var _acc_t := 0.0
var breakdown: Dictionary = {}   # key -> {"total": float, "dps": float, "name": String}


func clear() -> void:
	_totals.clear()
	_rings.clear()
	breakdown.clear()
	_cur_idx = 0
	_acc_t = 0.0


func record(key: String, dmg: float) -> void:
	if dmg <= 0.0:
		return
	_totals[key] = float(_totals.get(key, 0.0)) + dmg
	var ring: Variant = _rings.get(key)
	if ring == null:
		var arr := PackedFloat32Array()
		arr.resize(BUCKETS)
		arr[_cur_idx] = dmg
		_rings[key] = arr
	else:
		var a: PackedFloat32Array = ring
		a[_cur_idx] += dmg
		_rings[key] = a


func tick(dt: float, evo: Dictionary) -> void:
	_acc_t += dt
	if _acc_t < BUCKET_SEC:
		return
	var steps := mini(BUCKETS, int(_acc_t / BUCKET_SEC))
	_acc_t -= float(steps) * BUCKET_SEC
	for _s in range(steps):
		_cur_idx = (_cur_idx + 1) % BUCKETS
		for k in _rings:
			var a: PackedFloat32Array = _rings[k]
			a[_cur_idx] = 0.0
			_rings[k] = a
	refresh(evo)


func refresh(evo: Dictionary) -> void:
	for k in _totals:
		var tot := float(_totals[k])
		var sum5 := 0.0
		var ring: Variant = _rings.get(k)
		if ring != null:
			var a: PackedFloat32Array = ring
			for i in range(BUCKETS):
				sum5 += a[i]
		var entry: Variant = breakdown.get(k)
		var nm := _label_for(k, evo)
		if entry is Dictionary:
			entry["total"] = tot
			entry["dps"] = sum5 / WINDOW_SEC
			entry["name"] = nm
		else:
			breakdown[k] = {"total": tot, "dps": sum5 / WINDOW_SEC, "name": nm}


static func _label_for(k: String, evo: Dictionary) -> String:
	if evo.has(k) and GameData.EVOS.has(k):
		return String(GameData.EVOS[k].name)
	if GameData.UPS.has(k):
		return String(GameData.UPS[k].name)
	match k:
		"sword", "sw_thrust2", "sw_wheel", "sw_qi", "sw_array":
			return "飞剑术"
		"pet":
			return "葫芦小金刚"
		"ail":
			return "异常反应"
		"flare":
			return "挑灯爆焰"
		"rule":
			return "阴律秘法"
		"setsplash":
			return "套装共鸣"
		"blast":
			return "妖爆连锁"
	return k
