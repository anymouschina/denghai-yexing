extends SceneTree
## 平衡模拟（不作弊）：只经 Sim 的输入口/选择口操作，没有任何 debug 倍率、改血量、战斗间回血。
## 用法：godot --headless --path godot --script tests/balance.gd -- --bot=proxy --tier=0 --from=0 --n=100 [--dt=0.0667]
## 输出每局一行 "RES {json}"，由 tools/run_balance.py 汇总。

func _init() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var body := a.trim_prefix("--")
		var eq := body.find("=")
		if eq < 0:
			args[body] = "1"
		else:
			args[body.substr(0, eq)] = body.substr(eq + 1)
	GameData.load_all()
	_apply_overrides(str(args.get("set", "")))
	var kind := Bot.Kind.PROXY
	match str(args.get("bot", "proxy")):
		"random": kind = Bot.Kind.RANDOM
		"aim": kind = Bot.Kind.AIM
	var tier := int(args.get("tier", 0))
	var from := int(args.get("from", 0))
	var n := int(args.get("n", 10))
	var dt := float(args.get("dt", 0.0666667))
	var plans := [[], [0], [0, 1]]
	var plan: Array = plans[tier]
	if args.has("plan"):
		plan = []
		for x in str(args.plan).split(","):
			if x != "":
				plan.append(int(x))
	var out: Array = []
	for i in range(n):
		var seed_v := from + i + 1
		var s := Sim.new(seed_v, {"touch": args.has("touch")})
		var b := Bot.new(kind, seed_v, plan)
		var guard := 0
		var t0 := Time.get_ticks_msec()
		while not s.ended and guard < 60000:
			b.act(s, dt)
			s.step(dt)
			guard += 1
		var r := {"seed": seed_v, "win": s.victory, "t": snappedf(s.t, 0.1), "real": snappedf(s.real_t, 0.1), "lv": s.level, "kills": s.kills, "cause": s.death_cause,
			"seg": s.seg, "phase": s.phase, "boss_time": snappedf(s.boss_time, 0.1), "rift": s.rift_log, "relics": s.relics, "art": s.artifact,
			"wicks": s.wicks, "ms": Time.get_ticks_msec() - t0, "sword_drops": s.sw_drops, "hp": snappedf(s.hp, 0.1), "maxhp": s.maxhp,
			"sw_stage": s.sw_stage, "rift_clears": s.rift_clears, "dmg_by": s.dmg_by, "levels": s.levels, "evo": s.evo}
		print("RES ", JSON.stringify(r))
	quit()


## 调参实验用：--set="WV.hpMulPerMin=1.3;EN.boss.hp=20000"（只改内存里的数值表，定稿后写回 data/*.json）
func _apply_overrides(spec: String) -> void:
	if spec == "":
		return
	var roots := {"BAL": GameData.BAL, "WV": GameData.WV, "EN": GameData.EN, "DG": GameData.DG, "SEG": GameData.SEG}
	for item in spec.split(";"):
		if item == "":
			continue
		var kv := item.split("=")
		var keys := kv[0].split(".")
		var cur: Variant = roots[keys[0]]
		for i in range(1, keys.size() - 1):
			cur = cur[keys[i]]
		cur[keys[keys.size() - 1]] = float(kv[1])
		if keys[0] == "EN" and keys.size() == 3 and GameData.EN.has(keys[1]) == false:
			pass
