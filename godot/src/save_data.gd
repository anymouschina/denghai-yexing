class_name SaveData
extends RefCounted
## 存档：Web 端仅写浏览器 localStorage（主/备双键，避免 IndexedDB 同步读写与 .tmp/.bak 重命名导致主线程卡顿）；
## 桌面端落盘 user://save.json，采用原子写入（.tmp -> 轮转 .bak -> 重命名 .json），损坏时自动从 .bak 恢复；写失败时降级为内存存档。

const PATH := "user://save.json"
const TMP_PATH := "user://save.json.tmp"
const BAK_PATH := "user://save.json.bak"
const LS_KEY := "denghai_yexing_save_v15"
const LS_BAK_KEY := "denghai_yexing_save_v15_bak"
static var mem: Dictionary = {}


static func defaults() -> Dictionary:
	return {
		"soul": 0,
		"best": 0,
		"wins": 0,
		"runs": 0,
		"meta": {},
		"mute": false,
		"run": {},
		"unlocked_artifacts": [],
		"seen_rift_hint": false,
		"mode": "full",
		"beacon": "beacon_default",
	}


static func _parse_dict(raw: String) -> Variant:
	if raw == "":
		return null
	var v: Variant = JSON.parse_string(raw)
	return v if v is Dictionary else null


static func _read_file_dict(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var txt := f.get_as_text()
	f.close()
	return _parse_dict(txt)


static func load_save() -> Dictionary:
	if not mem.is_empty():
		return mem.duplicate(true)
	var d := defaults()
	var loaded: Variant = null
	if OS.has_feature("web"):
		var raw := str(JavaScriptBridge.eval("localStorage.getItem('%s')||''" % LS_KEY, true))
		loaded = _parse_dict(raw)
		if loaded == null:
			var bak_raw := str(JavaScriptBridge.eval("localStorage.getItem('%s')||''" % LS_BAK_KEY, true))
			loaded = _parse_dict(bak_raw)
	if loaded == null:
		loaded = _read_file_dict(PATH)
	if loaded == null:
		loaded = _read_file_dict(BAK_PATH)
	if loaded is Dictionary:
		for k in loaded:
			d[k] = loaded[k]
	if not (d.meta is Dictionary):
		d.meta = {}
	return d


static func write_save(d: Dictionary) -> void:
	mem = d.duplicate(true)
	var payload := JSON.stringify(d)
	if OS.has_feature("web"):
		# Web 端单次 JS 调用完成 localStorage 备份+写入，跳过同步 IndexedDB 4步文件重命名，消除检查点 50ms+ 卡顿
		JavaScriptBridge.eval(
			"try{var p=localStorage.getItem('%s');if(p)localStorage.setItem('%s',p);localStorage.setItem('%s',%s)}catch(e){}" % [LS_KEY, LS_BAK_KEY, LS_KEY, JSON.stringify(payload)],
			true
		)
		return
	# 桌面端原子写：先写 .tmp，确认落盘后再轮转 .json -> .bak 并 .tmp -> .json
	var f := FileAccess.open(TMP_PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(payload)
	f.flush()
	f.close()
	var g_tmp := ProjectSettings.globalize_path(TMP_PATH)
	var g_cur := ProjectSettings.globalize_path(PATH)
	var g_bak := ProjectSettings.globalize_path(BAK_PATH)
	if FileAccess.file_exists(PATH):
		if FileAccess.file_exists(BAK_PATH):
			DirAccess.remove_absolute(g_bak)
		DirAccess.rename_absolute(g_cur, g_bak)
	var err := DirAccess.rename_absolute(g_tmp, g_cur)
	if err != OK:
		# 某些平台重命名失败时退回直接写入，确保不丢档
		var f2 := FileAccess.open(PATH, FileAccess.WRITE)
		if f2 != null:
			f2.store_string(payload)
			f2.close()


static func clear_all() -> void:
	mem = {}
	if OS.has_feature("web"):
		JavaScriptBridge.eval("try{localStorage.removeItem('%s');localStorage.removeItem('%s')}catch(e){}" % [LS_KEY, LS_BAK_KEY], true)
	for p in [PATH, TMP_PATH, BAK_PATH]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(p))
