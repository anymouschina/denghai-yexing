extends Node
## 试玩桥：URL 带 tapcanvasPlaytest=1 时暴露 __TAPCANVAS_PLAYTEST__.snapshot()；URL 的 seed 决定本局随机数。
## 不提供跳关 / 无敌 / 改血量；只有 ts（加速倍率，仅试玩脚本用于在 180 秒预算内走完整局）。
var enabled := false
var seed_value := 0
var time_scale := 1.0
var touch_forced := false
var bench := 0   # ?bench=N：压测模式（仅试玩桥开启时），把同屏妖物维持在 N 只，满级构筑，玩家不死
var hide := ""   # ?hide=hud,bg,ground,fx,night,world：压测二分用，隐藏对应图层看绘制调用变化
var _last := ""
var autopick_after := 0   # 试玩模式：第 N 次升级之后的三选一自动选第 1 张（保证剧本里走位不被弹窗打断；第 1 次由剧本真实操作）


func _ready() -> void:
	if not OS.has_feature("web"):
		return
	var q := str(JavaScriptBridge.eval("location.search", true))
	enabled = q.contains("tapcanvasPlaytest=1")
	touch_forced = q.contains("touch=1")
	var s := str(JavaScriptBridge.eval("new URLSearchParams(location.search).get('seed') || ''", true))
	if s != "":
		seed_value = int(s)
	var bn := str(JavaScriptBridge.eval("new URLSearchParams(location.search).get('bench') || ''", true))
	if enabled and bn != "":
		bench = clampi(int(bn), 0, 2000)
	if enabled:
		hide = str(JavaScriptBridge.eval("new URLSearchParams(location.search).get('hide') || ''", true))
	var ts := str(JavaScriptBridge.eval("new URLSearchParams(location.search).get('ts') || ''", true))
	if enabled and ts != "":
		time_scale = clampf(float(ts), 0.5, 6.0)
	if enabled and ts == "":
		time_scale = 2.0   # 试玩默认 2× 节奏，保证 180 秒内走完整条闭环（不跳关、不无敌）
	if enabled and not q.contains("keep=1"):
		SaveData.clear_all()   # 试玩从干净存档开始
	if enabled:
		JavaScriptBridge.eval("globalThis.__tc_state = {scene:'boot'}; globalThis.__TAPCANVAS_PLAYTEST__ = { snapshot: () => globalThis.__tc_state };", true)


func publish(state: Dictionary) -> void:
	if not enabled:
		return
	var json := JSON.stringify(state)
	if json != _last:
		_last = json
		JavaScriptBridge.eval("globalThis.__tc_state = %s;" % json, true)
