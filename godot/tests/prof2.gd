extends SceneTree
func _init() -> void:
	GameData.load_all()
	var s := Sim.new(1)
	var b := Bot.new(Bot.Kind.PROXY, 1, [])
	var t0 := Time.get_ticks_msec()
	var n := 0
	while not s.ended and n < 1500:
		b.act(s, 0.0666667); s.step(0.0666667); n += 1
	print("steps ", n, " ms ", Time.get_ticks_msec() - t0, " t ", s.t, " en ", s.enemies.size(), " ebul ", s.ebullets.size(), " qi ", s.sw_qi.size(), " pk ", s.pickups.size())
	quit()
