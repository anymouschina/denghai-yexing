extends SceneTree
## 后期卡顿剖析：真人代理机器人打完整模式，按 30 秒战斗时钟分桶记录每步耗时与实体数量（emit=true，与真机一致）。
## 用法：godot --headless --path godot --script tests/latecost.gd -- --mode=full --seed=3 --dt=0.0166667
func _init() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var body := a.trim_prefix("--")
		var eq := body.find("=")
		args[body if eq < 0 else body.substr(0, eq)] = "1" if eq < 0 else body.substr(eq + 1)
	GameData.load_all()
	var seed_v := int(args.get("seed", 3))
	var dt := float(args.get("dt", 1.0 / 60.0))
	var s := Sim.new(seed_v, {"emit": true, "mode": str(args.get("mode", "full"))})
	var b := Bot.new(Bot.Kind.PROXY, seed_v, [0, 1])
	var bucket := -1
	var acc := {}
	var n := 0
	var guard := 0
	while not s.ended and guard < 400000:
		b.act(s, dt)
		var a := Time.get_ticks_usec()
		s.step(dt)
		var us := Time.get_ticks_usec() - a
		var ne := s.events.size()
		if us > 4000:
			var h := {}
			for ev in s.events:
				h[ev[0]] = int(h.get(ev[0], 0)) + 1
			print("SPIKE clock=%.1f us=%d ph=%d en=%d kind=%s ev=%s" % [s.clock, us, s.phase, s.enemies.size(), str(s.rift_kind), str(h)])
		s.events.clear()
		guard += 1
		var k := int(s.clock / 30.0)
		if k != bucket:
			if bucket >= 0 and int(acc.n) > 0:
				_print(bucket, acc)
			bucket = k
			acc = {"n": 0, "us": 0, "max": 0, "p_over": 0, "en": 0, "bul": 0, "eb": 0, "pk": 0, "qi": 0, "ps": 0, "ev": 0, "tel": 0, "bolt": 0, "trail": 0, "ph": s.phase, "lv": s.level}
		if s.phase == Sim.PH_BREAK or not s.choice.is_empty():
			continue
		acc.n += 1
		acc.us += us
		acc.max = maxi(int(acc.max), us)
		if us > 4000:
			acc.p_over += 1
		acc.en += s.enemies.size()
		acc.bul += s.bullets.size()
		acc.eb += s.ebullets.size()
		acc.pk += s.pickups.size()
		acc.qi += s.sw_qi.size()
		acc.ps += s.pet_shots.size()
		acc.ev += ne
		acc.tel += s.teles.size()
		acc.bolt += s.bolts.size()
		acc.trail += s.trails.size()
		acc.ph = s.phase
		acc.lv = s.level
	if int(acc.get("n", 0)) > 0:
		_print(bucket, acc)
	print("END win=", s.victory, " clock=", snappedf(s.clock, 0.1), " lv=", s.level, " kills=", s.kills, " steps=", guard)
	quit()


func _print(k: int, a: Dictionary) -> void:
	var n := float(a.n)
	print("t=%4ds ph=%d lv=%2d  avg=%.2fms max=%.1fms >4ms=%d | en=%.0f bul=%.0f eb=%.0f pk=%.0f qi=%.0f pet=%.0f tele=%.0f bolt=%.0f trail=%.0f ev/step=%.1f" % [k * 30, a.ph, a.lv, a.us / n / 1000.0, a.max / 1000.0, a.p_over, a.en / n, a.bul / n, a.eb / n, a.pk / n, a.qi / n, a.ps / n, a.tel / n, a.bolt / n, a.trail / n, a.ev / n])
