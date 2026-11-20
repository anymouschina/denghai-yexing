extends SceneTree
## 后期尖峰归因：真人代理打完整模式（emit=true），记录每步各子系统耗时（需先用 instrument.py 插桩 sim.gd），
## 打印 >4ms 的步的分项，以及 clock>=640 战斗段的总分摊。用法：--seed=3 --mode=full
func _init() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var body := a.trim_prefix("--")
		var eq := body.find("=")
		args[body if eq < 0 else body.substr(0, eq)] = "1" if eq < 0 else body.substr(eq + 1)
	GameData.load_all()
	var seed_v := int(args.get("seed", 3))
	var dt := 1.0 / 60.0
	var s := Sim.new(seed_v, {"emit": true, "mode": str(args.get("mode", "full"))})
	var b := Bot.new(Bot.Kind.PROXY, seed_v, [0, 1])
	var tot := {}
	var late_us := 0
	var late_n := 0
	var spikes := 0
	var guard := 0
	var hist := [0, 0, 0, 0, 0]
	while not s.ended and guard < 400000:
		guard += 1
		b.act(s, dt)
		Sim.prof.clear()
		var a := Time.get_ticks_usec()
		s.step(dt)
		var us := Time.get_ticks_usec() - a
		var nev := s.events.size()
		s.events.clear()
		if s.clock >= 640.0 and s.phase == Sim.PH_SEG:
			late_us += us
			late_n += 1
			hist[0 if us < 1000 else (1 if us < 2000 else (2 if us < 4000 else (3 if us < 8000 else 4)))] += 1
			for k in Sim.prof:
				tot[k] = int(tot.get(k, 0)) + int(Sim.prof[k])
		if us > 4000 and spikes < 40:
			spikes += 1
			var ks := Sim.prof.keys()
			ks.sort_custom(func(x, y): return Sim.prof[x] > Sim.prof[y])
			var parts := []
			for k in ks.slice(0, 7):
				parts.append("%s=%s" % [k, Sim.prof[k]])
			print("SPIKE clock=%.1f us=%d en=%d ev=%d lv=%d %s" % [s.clock, us, s.enemies.size(), nev, s.level, " ".join(parts)])
	print("LATE steps=%d avg=%.3fms  hist(<1,<2,<4,<8,>=8ms)=%s" % [late_n, late_us / 1000.0 / maxf(1, late_n), str(hist)])
	var ks2 := tot.keys()
	ks2.sort_custom(func(x, y): return tot[x] > tot[y])
	for k in ks2:
		print("  %-18s %8.3f ms/step" % [k, tot[k] / 1000.0 / maxf(1, late_n)])
	print("END win=", s.victory, " clock=", snappedf(s.clock, 0.1), " lv=", s.level, " kills=", s.kills, " ail=", s.ail_log)
	quit()
