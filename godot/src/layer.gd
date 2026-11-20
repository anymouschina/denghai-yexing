extends Node2D
## 世界视图的绘制层：把 _draw 转给 WorldView 的对应方法（用于分层、加色混合、白闪）
var cb: Callable

func _draw() -> void:
	if cb.is_valid():
		cb.call(self)
