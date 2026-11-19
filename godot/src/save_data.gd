class_name SaveData
extends RefCounted
## 存档：user://save.json（Web 上落在浏览器 IndexedDB）。写失败时降级为内存存档，不让游戏崩。

const PATH := "user://save.json"
static var mem: Dictionary = {}


static func defaults() -> Dictionary:
	return {"soul": 0, "best": 0, "wins": 0, "runs": 0, "meta": {}, "mute": false}


static func load_save() -> Dictionary:
	if not mem.is_empty():
		return mem.duplicate(true)
	var d := defaults()
	if FileAccess.file_exists(PATH):
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
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(d))
		f.close()
