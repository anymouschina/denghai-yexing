class_name GameData
extends RefCounted
## 数据外置：所有数值来自 res://data/*.json（v2.2 融合 rules / beacons / schools / ailments）

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
static var SETS: Array = []
static var SET_BY_ID: Dictionary = {}
static var SCHOOLS: Array = []
static var SCHOOL_BY_ID: Dictionary = {}
static var RULES_CFG: Dictionary = {}
static var RULES: Array = []
static var RULE_BY_ID: Dictionary = {}
static var BEACONS_CFG: Dictionary = {}
static var BEACONS: Array = []
static var BEACON_BY_ID: Dictionary = {}
static var GD: Dictionary
static var MB: Dictionary
static var GP_BY_ID: Dictionary = {}
static var ANCH: Dictionary
static var UPS: Dictionary = {}
static var EVOS: Dictionary = {}
static var RELIC_BY_ID: Dictionary = {}
static var POOLS_REV: Array = []
static var AIL: Dictionary


static func _read(name: String) -> Variant:
	var f := FileAccess.open("res://data/%s.json" % name, FileAccess.READ)
	assert(f != null, "缺少数据文件 " + name)
	var v: Variant = JSON.parse_string(f.get_as_text())
	assert(v != null, "JSON 解析失败 " + name)
	return v


static func _read_opt(name: String, fallback: Variant) -> Variant:
	var p := "res://data/%s.json" % name
	if not FileAccess.file_exists(p):
		return fallback
	var f := FileAccess.open(p, FileAccess.READ)
	if f == null:
		return fallback
	var v: Variant = JSON.parse_string(f.get_as_text())
	return v if v != null else fallback


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
	var sets_raw: Variant = _read("sets")
	if sets_raw is Dictionary:
		SETS = sets_raw.get("sets", [])
		SCHOOLS = sets_raw.get("schools", [])
	elif sets_raw is Array:
		SETS = sets_raw
		SCHOOLS = []
	SET_BY_ID.clear()
	for st in SETS:
		SET_BY_ID[st.id] = st
	SCHOOL_BY_ID.clear()
	for sc in SCHOOLS:
		SCHOOL_BY_ID[sc.id] = sc
	RULES_CFG = _read_opt("rules", {"maxEquipped": 2, "rules": []})
	RULES = RULES_CFG.get("rules", [])
	RULE_BY_ID.clear()
	for rl in RULES:
		RULE_BY_ID[rl.id] = rl
	BEACONS_CFG = _read_opt("beacons", {"defaultId": "beacon_default", "extractBonus": {}, "beacons": []})
	BEACONS = BEACONS_CFG.get("beacons", [])
	BEACON_BY_ID.clear()
	for bc in BEACONS:
		BEACON_BY_ID[bc.id] = bc
	GD = _read("gourds")
	MB = _read("minibosses")
	AIL = _read("ailments")
	GP_BY_ID.clear()
	for gp in GD.pieces:
		GP_BY_ID[gp.id] = gp
	ANCH = _read("anchors")
	UPS.clear()
	for u in UP.list:
		UPS[u.id] = u
	EVOS.clear()
	for e in UP.evolutions:
		EVOS[e.weapon] = e
	RELIC_BY_ID.clear()
	for r in RELICS:
		RELIC_BY_ID[r.id] = r
	POOLS_REV = WV.pools.duplicate()
	POOLS_REV.reverse()
	loaded = true
