extends SceneTree
func _init() -> void:
	GameData.load_all()
	var dt := 1.0 / 60.0
	var s := Sim.new(3, {"emit": true, "mode": "full"})
	var b := Bot.new(Bot.Kind.PROXY, 3, [0, 1])
	var n := 0
	var tot := 0
	while not s.ended and n < 400000:
		b.act(s, dt)
		if s.clock < 640.0 or s.phase != Sim.PH_SEG:
			Sim.prof.clear()
			tot = 0
		var a := Time.get_ticks_usec()
		s.step(dt)
		tot += Time.get_ticks_usec() - a
		s.events.clear()
		n += 1
		if s.clock > 640.0 and s.phase == Sim.PH_SEG and n % 600 == 0:
			var pairs := 0
			var mx := 0
			var near := 0
			for k in s.grid:
				var c: int = s.grid[k].size()
				pairs += c * c
				mx = maxi(mx, c)
			for e in s.enemies:
				if absf(e.x - s.px) < 700 and absf(e.y - s.py) < 420:
					near += 1
			print("clock=%.0f en=%d cells=%d pairs=%d maxcell=%d onscreen=%d" % [s.clock, s.enemies.size(), s.grid.size(), pairs, mx, near])
		if s.clock > 920.0:
			break
	var keys := Sim.prof.keys()
	keys.sort_custom(func(x, y): return Sim.prof[x] > Sim.prof[y])
	for k in keys:
		print("%-18s %6.1f%%  %d ms" % [k, 100.0 * Sim.prof[k] / tot, Sim.prof[k] / 1000])
	print("total ", tot / 1000, " ms")
	quit()
