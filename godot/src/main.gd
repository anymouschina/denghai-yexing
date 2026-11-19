extends Node
## 入口：标题 ↔ 对局。触屏设备自动启用虚拟摇杆（也可用 ?touch=1 强制）。

var current: Node = null
var touch_mode := false


func _ready() -> void:
	GameData.load_all()
	touch_mode = detect_touch()
	var win := get_window()
	win.min_size = Vector2i(320, 180)
	_show_title()


static func detect_touch() -> bool:
	if Playtest.touch_forced:
		return true
	if OS.has_feature("web"):
		var r: Variant = JavaScriptBridge.eval("(window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0)", true)
		return bool(r)
	return OS.has_feature("mobile") or DisplayServer.is_touchscreen_available()


func _swap(n: Node) -> void:
	if current != null:
		current.queue_free()
	current = n
	add_child(n)


func _show_title() -> void:
	var t := TitleScreen.new()
	t.touch_mode = touch_mode
	t.start_pressed.connect(_start_game)
	t.continue_pressed.connect(_continue_game)
	_swap(t)


func _continue_game() -> void:
	var sv := SaveData.load_save()
	var g := GameScreen.new()
	g.request_title.connect(_show_title)
	g.request_restart.connect(_start_game)
	_swap(g)
	g.start(touch_mode, sv.run)


func _start_game() -> void:
	var g := GameScreen.new()
	g.request_title.connect(_show_title)
	g.request_restart.connect(_start_game)
	_swap(g)
	g.start(touch_mode)


## 截图/切窗口/弹系统对话框时浏览器收不到 keyup，按键会“卡住”（例如 D 卡住则无法左转）：失焦时释放全部输入动作
func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_WM_WINDOW_FOCUS_OUT:
		release_inputs()


static func release_inputs() -> void:
	for a in ["move_left", "move_right", "move_up", "move_down", "dash", "skill", "pause", "accept"]:
		Input.action_release(a)
	Input.flush_buffered_events()
