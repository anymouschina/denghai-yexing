class_name SimTele
extends RefCounted
## 预警圈：倒计时结束后执行回调（震击/鬼火环/Boss 技能）

var x := 0.0
var y := 0.0
var r := 0.0
var t := 0.0
var dur := 0.5
var follow: SimEnemy = null
var cb: Callable = Callable()
var color := 0
