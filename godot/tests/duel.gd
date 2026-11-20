extends SceneTree
## 单挑（初始单挑口径）：固定构筑、满血，proxy 机器人（σ=0.05）单挑终局 BOSS 或守关者。不作弊：没有倍率/改血量/回血。
## 用法：godot --headless --path godot --script tests/duel.gd -- --kind=boss|warden --build=A|B|C --sword=0|1 --entry=1|2 --n=200 [--bot=proxy|aim|random]
## 构筑取自 tier0 真人代理整局结束时的常见成型（all-in 三武器 + 满进化），见 README“单挑构筑”
const BUILDS := {
	"A": {"levels": {"fu": 5, "huanhuo": 5, "lei": 5, "jishu": 5, "zhongfu": 3, "zhuohun": 5, "tianyou": 2, "leiyin": 2, "tiangang": 4, "taomu": 5, "yupei": 2}, "evo": {"fu": true, "huanhuo": true, "lei": true}},
	"B": {"levels": {"fu": 3, "huanhuo": 5, "lei": 5, "zhuohun": 5, "tianyou": 3, "leiyin": 3, "tiangang": 4, "taomu": 5, "yupei": 2}, "evo": {"huanhuo": true, "lei": true}},
	"C": {"levels": {"fu": 5, "lei": 5, "jishu": 5, "zhongfu": 3, "leiyin": 3, "tiangang": 4, "taomu": 4, "caolv": 2}, "evo": {"fu": true, "lei": true}},
}
## 第 1 次裂隙（约 160s，10 级上下）时的常见构筑
const EARLY := {
	"A": {"levels": {"fu": 5, "huanhuo": 3, "lei": 2, "taomu": 1, "jishu": 1}},
	"B": {"levels": {"fu": 4, "lei": 3, "taomu": 2, "tiangang": 1}},
	"C": {"levels": {"fu": 5, "huanhuo": 4, "taomu": 1, "zhuohun": 1}},
}


func _init() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var body := a.trim_prefix("--")
		var eq := body.find("=")
		args[body.substr(0, eq) if eq >= 0 else body] = body.substr(eq + 1) if eq >= 0 else "1"
	GameData.load_all()
	var kind := str(args.get("kind", "boss"))
	var bk := str(args.get("build", "A"))
	var sword := int(args.get("sword", 0)) == 1
	var entry := int(args.get("entry", 1))
	var n := int(args.get("n", 100))
	var from := int(args.get("from", 0))
	var dt := float(args.get("dt", 0.0666667))
	var bot_kind := Bot.Kind.PROXY
	match str(args.get("bot", "proxy")):
		"random": bot_kind = Bot.Kind.RANDOM
		"aim": bot_kind = Bot.Kind.AIM
	for i in range(n):
		var seed_v := from + i + 1
		var s := Sim.new(seed_v)
		var b := Bot.new(bot_kind, seed_v, [])
		if kind == "boss":
			s.duel_boss(BUILDS[bk], sword)
		else:
			s.duel_warden(EARLY[bk] if entry == 1 else BUILDS[bk], entry, sword)
		var guard := 0
		var t0 := s.real_t
		var res := ""
		while guard < 40000:
			b.act(s, dt)
			s.step(dt)
			guard += 1
			if kind == "boss":
				if s.ended:
					break
			else:
				if s.phase != Sim.PH_RIFT:
					break
		var r := {"seed": seed_v, "kind": kind, "build": bk, "sword": sword, "entry": entry, "hp": snappedf(s.hp, 0.1)}
		if kind == "boss":
			r["win"] = s.victory
			r["dur"] = snappedf(s.boss_time if s.victory else s.real_t - t0, 0.1)
			r["cause"] = s.death_cause
			r["by"] = s.dmg_by
			r["drops"] = s.sw_drops
		else:
			var rec: Dictionary = s.rift_log[s.rift_log.size() - 1] if s.rift_log.size() > 0 else {}
			r["win"] = rec.get("ok", false)
			r["dur"] = snappedf(float(rec.get("t", 0.0)), 0.1)
			r["how"] = rec.get("how", "")
			r["dps_est"] = snappedf(float(rec.get("dps_est", 0.0)), 0.1)
			r["wardenhp"] = int(rec.get("warden_hp", 0.0))
			r["dealt"] = int(rec.get("dealt", 0.0))
		print("RES ", JSON.stringify(r))
	quit()
