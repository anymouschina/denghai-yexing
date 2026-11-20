extends SceneTree
func _init() -> void:
	var dt := 1.0 / 15.0
	for mode in ["sim_only", "bot"]:
		var s := Sim.new(5)
		var b := Bot.new(Bot.Kind.PROXY, 5, [])
		var t0 := Time.get_ticks_usec()
		var tb := 0
		var ts := 0
		var n := 0
		var tot_en := 0
		while not s.ended and n < 40000:
			var a := Time.get_ticks_usec()
			if mode == "bot":
				b.act(s, dt)
			else:
				if not s.choice.is_empty():
					s.choose(0)
				var ang := s.real_t * 0.9
				s.in_move = Vector2(cos(ang), sin(ang))
			var c := Time.get_ticks_usec()
			s.step(dt)
			tb += c - a
			ts += Time.get_ticks_usec() - c
			n += 1
			tot_en += s.enemies.size()
		print(mode, " steps ", n, " bot_ms ", tb / 1000, " sim_ms ", ts / 1000, " avg_en ", tot_en / n, " end t=", s.t, " win=", s.victory, " hp=", s.hp)
	print(Sim.prof)
	quit()
