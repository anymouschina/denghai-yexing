extends Node
## 试玩桥：URL 带 tapcanvasPlaytest=1 时暴露 __TAPCANVAS_PLAYTEST__.snapshot()；URL 的 seed 决定本局随机数。
## 不提供跳关 / 无敌 / 改血量；只有 ts（加速倍率，仅试玩脚本用于在 180 秒预算内走完整局）。
var enabled := false
var seed_value := 0
var time_scale := 1.0
var touch_forced := false
var _last := ""


func _ready() -> void:
	if not OS.has_feature("web"):
		return
	var q := str(JavaScriptBridge.eval("location.search", true))
	enabled = q.contains("tapcanvasPlaytest=1")
	touch_forced = q.contains("touch=1")
	var s := str(JavaScriptBridge.eval("new URLSearchParams(location.search).get('seed') || ''", true))
	if s != "":
		seed_value = int(s)
	var ts := str(JavaScriptBridge.eval("new URLSearchParams(location.search).get('ts') || ''", true))
	if enabled and ts != "":
		time_scale = clampf(float(ts), 0.5, 6.0)
	if enabled:
		JavaScriptBridge.eval("globalThis.__tc_state = {scene:'boot'}; globalThis.__TAPCANVAS_PLAYTEST__ = { snapshot: () => globalThis.__tc_state };", true)


func publish(state: Dictionary) -> void:
	if not enabled:
		return
	var json := JSON.stringify(state)
	if json != _last:
		_last = json
		JavaScriptBridge.eval("globalThis.__tc_state = %s;" % json, true)
