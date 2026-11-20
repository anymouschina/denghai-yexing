class_name SchoolRules
extends RefCounted
## 灯派 2/4/6 羁绊汇总 + 双阴律规则卡抽取（纯逻辑模块，避免 sim.gd 膨胀）


static func compute_schools(levels: Dictionary, relics: Array, active_rules: Array) -> Dictionary:
	var counts: Dictionary = {}
	for uid in levels:
		if int(levels[uid]) <= 0 or not GameData.UPS.has(uid):
			continue
		var u: Dictionary = GameData.UPS[uid]
		var tags: Array = u.get("school_tags", [])
		if tags.is_empty() and u.has("school_tag"):
			tags = [String(u.school_tag)]
		for tg in tags:
			var s := String(tg)
			if s != "":
				counts[s] = int(counts.get(s, 0)) + 1
	for rid in relics:
		if not GameData.RELIC_BY_ID.has(rid):
			continue
		var r: Dictionary = GameData.RELIC_BY_ID[rid]
		var rtags: Array = r.get("school_tags", [])
		if rtags.is_empty() and r.has("school"):
			rtags = [String(r.school)]
		for tg in rtags:
			var s := String(tg)
			if s != "":
				counts[s] = int(counts.get(s, 0)) + 1

	var active: Array = []
	var stats: Dictionary = {}
	var tier_steps := 0
	for sc in GameData.SCHOOLS:
		var sid := String(sc.id)
		var cnt := int(counts.get(sid, 0))
		var best_tier: Dictionary = {}
		var best_idx := 0
		var tiers: Array = sc.get("tiers", [])
		for ti in range(tiers.size()):
			var td: Dictionary = tiers[ti]
			if cnt >= int(td.count):
				best_tier = td
				best_idx = ti + 1
		if not best_tier.is_empty():
			tier_steps += best_idx
			active.append({
				"id": sid,
				"name": String(sc.get("name", sid)),
				"color": String(sc.get("color", "#f2c14b")),
				"count": cnt,
				"tier": int(best_tier.count),
				"desc": String(best_tier.get("desc", "")),
			})
			var st: Dictionary = best_tier.get("stats", {})
			for k in st:
				stats[k] = float(stats.get(k, 0.0)) + float(st[k])

	# 阴律：灯派共鸣（每激活一档灯派羁绊，叠加伤害/暴伤/异常上限）
	if active_rules.has("rule_synergy_echo") and tier_steps > 0 and GameData.RULE_BY_ID.has("rule_synergy_echo"):
		var rp: Dictionary = GameData.RULE_BY_ID["rule_synergy_echo"].get("params", {})
		stats["dmg"] = float(stats.get("dmg", 0.0)) + float(rp.get("dmgPerTier", 0.08)) * float(tier_steps)
		stats["critMul"] = float(stats.get("critMul", 0.0)) + float(rp.get("critMulPerTier", 0.15)) * float(tier_steps)
		stats["ailCapAdd"] = float(stats.get("ailCapAdd", 0.0)) + float(rp.get("ailCapAdd", 0.10)) * float(tier_steps)

	return {
		"counts": counts,
		"active": active,
		"stats": stats,
		"tier_steps": tier_steps,
	}


static func max_rules() -> int:
	return int(GameData.RULES_CFG.get("maxEquipped", 2))


static func roll_rule_option(active_rules: Array, rng: RandomNumberGenerator, emit: bool) -> Dictionary:
	if active_rules.size() >= max_rules() or GameData.RULES.is_empty():
		return {}
	var pool: Array = []
	for rl in GameData.RULES:
		if not active_rules.has(rl.id):
			pool.append(rl)
	if pool.is_empty():
		return {}
	var pick: Dictionary = pool[int(rng.randf() * pool.size())]
	return {
		"kind": "rule",
		"id": String(pick.id),
		"icon": String(pick.get("icon_tag", "huanhun")),
		"name": String(pick.name),
		"school": "gen",
		"rarity": "gold",
		"lvText": "阴律规则 • %d/%d" % [active_rules.size() + 1, max_rules()],
		"desc": String(pick.desc) if emit else "",
	}


static func beacon_for(bid: String) -> Dictionary:
	if GameData.BEACON_BY_ID.has(bid):
		return GameData.BEACON_BY_ID[bid]
	var def_id := String(GameData.BEACONS_CFG.get("defaultId", "beacon_default"))
	if GameData.BEACON_BY_ID.has(def_id):
		return GameData.BEACON_BY_ID[def_id]
	return {
		"id": "beacon_default",
		"name": "安夜签",
		"danger": 0,
		"hp_mul": 1.0,
		"spd_mul": 1.0,
		"elite_mul": 1.0,
		"soul_mul": 1.0,
	}
