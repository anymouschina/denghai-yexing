extends SceneTree
## 整局时间线：真人代理从开局跑到结算，记录各阶段的墙内时间(real_t)与战斗时钟(t)。用法：--script tests/timeline.gd -- --n=3 --tier=0
func _init() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var b := a.trim_prefix("--"); var eq := b.find("=")
		args[b.substr(0, eq) if eq >= 0 else b] = b.substr(eq + 1) if eq >= 0 else "1"
	GameData.load_all()
	var plans := [[], [0], [0, 1]]
	for i in range(int(args.get("n", 3))):
		var s := Sim.new(i + 1)
		var b := Bot.new(Bot.Kind.PROXY, i + 1, plans[int(args.get("tier", 0))])
		var last := -1
		var log: Array = []
		var g := 0
		while not s.ended and g < 60000:
			b.act(s, 0.0666667); s.step(0.0666667); g += 1
			var key := s.phase * 10 + (s.seg if s.phase != Sim.PH_BOSS else 9)
			if key != last:
				last = key
				log.append("%s@real=%.0f,t=%.0f" % [["S","BREAK","RIFT","BOSS","END"][s.phase] + str(s.seg + 1), s.real_t, s.t])
		print("TL ", JSON.stringify({"seed": i + 1, "win": s.victory, "real": snappedf(s.real_t, 1), "boss_kill_s": snappedf(s.boss_time, 1), "phases": log, "kills": s.kills, "lv": s.level}))
	quit()
