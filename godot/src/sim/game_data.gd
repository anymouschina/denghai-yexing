class_name GameData
extends RefCounted
## 数据外置：所有数值来自 res://data/*.json（沿用 H5 版，v1.5 新增 dungeon/relics/segments）

static var loaded := false
static var BAL: Dictionary
static var WV: Dictionary
static var EN: Dictionary
static var UP: Dictionary
static var META: Array
static var DG: Dictionary
static var RELICS: Array
static var SEG: Dictionary
static var MV: Dictionary
static var UPS: Dictionary = {}
static var EVOS: Dictionary = {}
static var RELIC_BY_ID: Dictionary = {}
static var POOLS_REV: Array = []


static func _read(name: String) -> Variant:
	var f := FileAccess.open("res://data/%s.json" % name, FileAccess.READ)
	assert(f != null, "缺少数据文件 " + name)
	var v: Variant = JSON.parse_string(f.get_as_text())
	assert(v != null, "JSON 解析失败 " + name)
	return v


static func load_all() -> void:
	if loaded:
		return
	BAL = _read("balance")
	WV = _read("waves")
	EN = _read("enemies")
	UP = _read("upgrades")
	META = _read("meta")
	DG = _read("dungeon")
	RELICS = _read("relics")
	SEG = _read("segments")
	MV = _read("movement")
	for u in UP.list:
		UPS[u.id] = u
	for e in UP.evolutions:
		EVOS[e.weapon] = e
	for r in RELICS:
		RELIC_BY_ID[r.id] = r
	POOLS_REV = WV.pools.duplicate()
	POOLS_REV.reverse()
	loaded = true
