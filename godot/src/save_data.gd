class_name SaveData
extends RefCounted
## 存档：user://save.json（Web 上落在浏览器 IndexedDB）。写失败时降级为内存存档，不让游戏崩。

const PATH := "user://save.json"
const LS_KEY := "denghai_yexing_save_v15"   # Web：localStorage 键名（与 user://save.json 同内容双写）
static var mem: Dictionary = {}


static func defaults() -> Dictionary:
	return {"soul": 0, "best": 0, "wins": 0, "runs": 0, "meta": {}, "mute": false, "run": {}, "unlocked_artifacts": [], "seen_rift_hint": false}


static func load_save() -> Dictionary:
	if not mem.is_empty():
		return mem.duplicate(true)
	var d := defaults()
	var raw := ""
	if OS.has_feature("web"):
		raw = str(JavaScriptBridge.eval("localStorage.getItem('%s')||''" % LS_KEY, true))
	if raw != "":
		var lv: Variant = JSON.parse_string(raw)
		if lv is Dictionary:
			for k in lv:
				d[k] = lv[k]
	elif FileAccess.file_exists(PATH):
		var f := FileAccess.open(PATH, FileAccess.READ)
		if f != null:
			var v: Variant = JSON.parse_string(f.get_as_text())
			if v is Dictionary:
				for k in v:
					d[k] = v[k]
	if not (d.meta is Dictionary):
		d.meta = {}
	return d


static func write_save(d: Dictionary) -> void:
	mem = d.duplicate(true)
	if OS.has_feature("web"):
		JavaScriptBridge.eval("try{localStorage.setItem('%s',%s)}catch(e){}" % [LS_KEY, JSON.stringify(JSON.stringify(d))], true)
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(d))
		f.close()


static func clear_all() -> void:
	mem = {}
	if OS.has_feature("web"):
		JavaScriptBridge.eval("try{localStorage.removeItem('%s')}catch(e){}" % LS_KEY, true)
	if FileAccess.file_exists(PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(PATH))
