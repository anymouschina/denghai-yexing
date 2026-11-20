extends SceneTree
## 飞剑阶段/融合验证：真人代理(σ=0.05)整局，逐局输出飞剑升级时间点与途径、各攻击方式伤害占比、副本/融合/死亡时间。不作弊（只经输入口）。
## 用法：--script tests/sword_report.gd -- --seed=1 --plan=0,1
func _init() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var b := a.trim_prefix("--"); var eq := b.find("=")
		args[b.substr(0, eq) if eq >= 0 else b] = b.substr(eq + 1) if eq >= 0 else "1"
	GameData.load_all()
	var plan: Array = []
	for x in str(args.get("plan", "0")).split(","):
		if x != "": plan.append(int(x))
	var sd := int(args.get("seed", 1))
	var s := Sim.new(sd, {"mode": str(args.get("mode", "classic"))})
	var b2 := Bot.new(Bot.Kind.PROXY, sd, plan)
	b2.explore = str(args.get("explore", "0")) == "1"
	var g := 0
	var qi_n := 0
	while not s.ended and g < 90000:
		b2.act(s, 0.0666667); s.step(0.0666667); g += 1
	var by := {}
	var tot := 0.0
	for k in s.dmg_by:
		tot += float(s.dmg_by[k])
	for k in ["sword", "sw_thrust2", "sw_wheel", "sw_qi", "sw_array"]:
		by[k] = snappedf(float(s.dmg_by.get(k, 0.0)) / maxf(1.0, tot) * 100.0, 0.1)
	var rifts: Array = []
	for r in s.rift_log:
		rifts.append({"at": r.get("at", 0), "kind": r.get("kind", "sword"), "ok": r.ok, "how": r.how, "dur": snappedf(r.t, 0.1), "n": r.get("n", 0), "boss_hp": snappedf(float(r.get("boss_hp", r.get("warden_hp", 0.0))), 1), "ticket": r.get("ticket", 0)})
	print("SW ", JSON.stringify({"seed": sd, "plan": plan, "win": s.victory, "end_real_s": snappedf(s.real_t, 1), "cause": s.death_cause, "sword_log": s.sw_log, "sword_stage": s.sw_stage, "sword_kills": s.sw_kills,
		"dmg_share_pct": by, "rifts": rifts, "fusion": s.fusion, "fusion_t": snappedf(s.fusion_t, 0.1), "level": s.level, "mode": s.mode, "clock_end": snappedf(s.clock, 1), "gourds": s.gourds.size(), "pet": s.pet_on, "relics": s.relics, "mini_idx": s.mini_idx, "sets": s.active_sets(), "boss_time": snappedf(s.boss_time, 1), "rift_entries": s.rift_entries, "rift_clears": s.rift_clears, "vine_runs": s.vine_runs, "sw_master": s.sw_master, "sw_cnt": s.sw_cnt, "gourd_log": s.gourd_log, "poi_log": s.poi_log, "mid_idx": s.mid_idx, "coins_end": s.coins, "guard_done": s.guard_done.keys(), "farm_runs": s.farm_runs, "forge_n": s.forge_n, "asc": s.asc_dmg_n + s.asc_hp_n, "boss_maxhp": (s.boss.maxhp if s.boss != null else 0.0), "boss_hp_left": (maxf(0.0, s.boss.hp) if s.boss != null else -1.0), "maxhp": s.maxhp, "hurt_by": s.hurt_by}))
	quit()
