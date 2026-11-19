extends SceneTree
## 移动手感实测：同一按键序列，对比 accelTime/decelTime=0(旧行为，瞬时) 与当前配置。
## 指标：斜向/直向速度比、起步延迟(帧)、松键到静止(帧)、全速(帧)。步长 1/60s。
func run(acc: float, dec: float) -> Dictionary:
	GameData.load_all()
	GameData.MV.accelTime = acc
	GameData.MV.decelTime = dec
	var dt := 1.0 / 60.0
	var out := {}
	for name in ["straight", "diag"]:
		var s := Sim.new(3)
		s.invuln = 1e9
		s.px = 1250; s.py = 700
		var dir := Vector2(1, 0) if name == "straight" else Vector2(1, 1)   # 故意给未归一化的斜向输入(键盘 W+D)
		for i in range(30):
			s.in_move = Vector2.ZERO; s.step(dt)
		var x0 := Vector2(s.px, s.py)
		var first_move := -1
		for i in range(120):
			s.in_move = dir; s.step(dt)
			if first_move < 0 and Vector2(s.px, s.py).distance_to(x0) > 0.01: first_move = i + 1
		var dist := Vector2(s.px, s.py).distance_to(x0)
		var v_full := s.vel.length()
		var stop := 0
		for i in range(60):
			s.in_move = Vector2.ZERO; s.step(dt); stop += 1
			if s.vel.length() < 0.5: break
		out[name] = {"dist_2s": dist, "v_full": v_full, "start_delay_frames": first_move, "stop_frames": stop}
	return out
func _init() -> void:
	var before := run(0.0, 0.0)
	var after := run(0.07, 0.025)
	for k in ["before(瞬时)", "after(accel .07/decel .025)"]:
		var r: Dictionary = before if k.begins_with("before") else after
		print("MV ", k, " 直向 v=%.1f 斜向 v=%.1f 斜/直=%.3f 起步延迟=%d帧 松键停=%d帧 2秒位移 直=%.1f 斜=%.1f" % [r.straight.v_full, r.diag.v_full, r.diag.v_full / r.straight.v_full, r.straight.start_delay_frames, r.straight.stop_frames, r.straight.dist_2s, r.diag.dist_2s])
	quit()
