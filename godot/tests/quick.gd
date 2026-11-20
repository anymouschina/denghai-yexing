extends SceneTree
func _init() -> void:
	var s := Sim.new(1)
	var t0 := Time.get_ticks_msec()
	var n := 0
	while not s.ended and s.real_t < 20.0 and n < 2000:
		s.in_move = Vector2(cos(s.real_t), sin(s.real_t * 0.7))
		s.step(1.0/15.0)
		n += 1
		if not s.choice.is_empty():
			s.choose(0)
	print("steps ", n, " ms ", Time.get_ticks_msec()-t0, " t ", s.t, " hp ", s.hp, " en ", s.enemies.size(), " lv ", s.level)
	quit()
