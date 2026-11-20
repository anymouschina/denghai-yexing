class_name SimTele
extends RefCounted
## 预警区：倒计时结束后执行回调（震击/鬼火环/Boss 技能）
## 形状：默认圆（x,y 为圆心，r 半径）；rw>0 时为矩形（x,y 为矩形中心，rw/rh 为宽高，用于 Boss 半屏技）

var x := 0.0
var y := 0.0
var r := 0.0
var rw := 0.0
var rh := 0.0
var t := 0.0
var dur := 0.5
var follow: SimEnemy = null
var cb: Callable = Callable()
var color := 0


func is_rect() -> bool:
	return rw > 0.0


## 点是否落在预警区内（pad 为额外余量：玩家半径或机器人的安全边距）。r<=0 的圆是不可见的计时器，不算危险区。
func is_inside(p: Vector2, pad: float = 0.0) -> bool:
	if rw > 0.0:
		return absf(p.x - x) <= rw * 0.5 + pad and absf(p.y - y) <= rh * 0.5 + pad
	if r <= 0.0:
		return false
	return p.distance_to(Vector2(x, y)) < r + pad
