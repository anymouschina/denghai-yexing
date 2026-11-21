class_name LanternRules
extends RefCounted
## 灯油与命灯风险收益、挑灯爆焰、擦灯闪避、双阴律运行时触发、开局加速与荒野目标（破庙灯龛/镇魂断碑）


static func lcfg() -> Dictionary:
	return GameData.BAL.get("lantern", {})


static func oil_max() -> float:
	return float(lcfg().get("max", 100.0))


static func lantern_state(oil: float) -> String:
	var L := lcfg()
	if oil > float(L.get("highThreshold", 70.0)):
		return "high"
	if oil < float(L.get("lowThreshold", 30.0)):
		return "low"
	return "mid"


static func sync_lantern_cache(sim: Sim) -> void:
	var L := lcfg()
	var hi_thr := float(L.get("highThreshold", 70.0))
	var lo_thr := float(L.get("lowThreshold", 30.0))
	var oil := sim.lantern_oil
	if oil > hi_thr:
		sim.lantern_mode = Sim.LANTERN_HIGH
	elif oil < lo_thr:
		sim.lantern_mode = Sim.LANTERN_LOW
	else:
		sim.lantern_mode = Sim.LANTERN_MID
	sim._eff_crit = sim.s_crit + (float(L.get("lowCritAdd", 0.25)) if sim.lantern_mode == Sim.LANTERN_LOW else 0.0)
	sim._high_reveal_on = (sim.lantern_mode == Sim.LANTERN_HIGH) or (sim.flare_t > 0.0)
	var rr_hi := float(L.get("highRevealRadius", 220.0))
	sim._high_reveal_r2 = rr_hi * rr_hi
	sim._high_reveal_mul = 1.0 + float(L.get("highRevealDmg", 0.15))
	sim._low_speed_mul = 1.0 + (float(L.get("lowSpeedAdd", 0.20)) if sim.lantern_mode == Sim.LANTERN_LOW else 0.0)
	sim._high_xp_mul = 1.0 + (float(L.get("highXpMul", 0.20)) if sim.lantern_mode == Sim.LANTERN_HIGH else 0.0)
	sim._low_frenzy_dmg_add = 0.0
	sim._low_frenzy_cd_mul = 1.0
	if sim._has_rule_low_frenzy:
		var rp_f: Dictionary = GameData.RULE_BY_ID.get("rule_low_frenzy", {}).get("params", {})
		if oil < float(rp_f.get("oilThreshold", 30.0)):
			sim._low_frenzy_dmg_add = float(rp_f.get("dmgAdd", 0.28))
			sim._low_frenzy_cd_mul = float(rp_f.get("cdMul", 0.82))


static func add_oil(sim: Sim, amount: float) -> void:
	if amount <= 0.0:
		return
	var mul := 1.0 + float(sim.school_stats.get("oilGainMul", 0.0))
	sim.lantern_oil = clampf(sim.lantern_oil + amount * mul, 0.0, oil_max())
	sync_lantern_cache(sim)


static func activate_shrine_ward(sim: Sim, dur_override: float = -1.0) -> void:
	var dur := dur_override
	if dur <= 0.0:
		var rp: Dictionary = GameData.RULE_BY_ID.get("rule_shrine_ward", {}).get("params", {})
		dur = float(rp.get("dur", 6.0))
	sim.shrine_ward_t = maxf(sim.shrine_ward_t, dur)


static func trigger_flare(sim: Sim) -> bool:
	if sim.over or sim.ended or not sim.choice.is_empty() or sim.shop_open or sim.extract_choice_open:
		return false
	var L := lcfg()
	var cost := float(L.get("flareCost", 25.0))
	if sim.lantern_oil < cost or sim.flare_cd > 0.0:
		return false
	sim.lantern_oil = maxf(0.0, sim.lantern_oil - cost)
	sim.flare_t = float(L.get("flareDur", 4.0))
	sim.flare_wave_t = float(L.get("flareWaveDur", 0.65))
	sim.flare_cd = 1.2
	var clear_r := float(L.get("flareClearRadius", 260.0))
	var clear_r2 := clear_r * clear_r
	var fy := sim.py - 30.0
	# 立即清除 260px 内全部敌弹（正面反制灯笼怪弹幕海）
	var cleared := 0
	var eb := sim.ebullets
	var bi := eb.size() - 1
	while bi >= 0:
		var b: SimBullet = eb[bi]
		var dx := b.x - sim.px
		var dy := b.y - fy
		if dx * dx + dy * dy <= clear_r2:
			var last := eb.size() - 1
			if bi != last:
				eb[bi] = eb[last]
			eb.pop_back()
			cleared += 1
		bi -= 1
	sync_lantern_cache(sim)
	# 点燃并击退周围妖物
	var base_dmg := float(L.get("flareDmg", 45.0)) * (1.0 + float(sim.school_stats.get("flareDmgMul", 0.0)))
	var near := sim._q_flare
	sim.grid_sys.query_into(sim.px, fy, clear_r + 40.0, near)
	for i in range(near.size()):
		var e: SimEnemy = near[i]
		if not e.alive:
			continue
		var dx := e.x - sim.px
		var dy := e.y - e.h * 0.4 - fy
		var rr := clear_r + e.r
		if dx * dx + dy * dy < rr * rr:
			sim.damage_fast(e, base_dmg, "flare", false, false, false, false, -1.0, true, dx, dy, 240.0)
			if e.alive:
				sim._fusion_ignite(e)
	if sim.has_rule("rule_shrine_ward"):
		activate_shrine_ward(sim)
	sim.add_trauma(0.55)
	sim.hitstop_t = maxf(sim.hitstop_t, 0.055)
	sim._ev("flare", sim.px, fy, clear_r, cleared)
	sim._ev("ring", sim.px, fy, clear_r)
	sim._ev("sfx", "flare")
	return true


static func step_lantern_and_rules(sim: Sim, dt: float) -> void:
	var L := lcfg()
	sim.flare_t = maxf(0.0, sim.flare_t - dt)
	sim.flare_wave_t = maxf(0.0, sim.flare_wave_t - dt)
	sim.flare_cd = maxf(0.0, sim.flare_cd - dt)
	sim.perfect_dash_t = maxf(0.0, sim.perfect_dash_t - dt)
	sim.graze_cd = maxf(0.0, sim.graze_cd - dt)
	sim.shake_trauma = maxf(0.0, sim.shake_trauma - 1.8 * dt)
	sim.hitstop_t = maxf(0.0, sim.hitstop_t - dt)
	if sim.kill_streak_t > 0.0:
		sim.kill_streak_t -= dt
		if sim.kill_streak_t <= 0.0:
			sim.kill_streak = 0
	# 灯油自然衰减（仅战斗阶段，且爆焰期间不耗油）
	if sim.phase != Sim.PH_BREAK and sim.flare_t <= 0.0:
		var drain := float(L.get("drainPerSec", 1.6))
		sim.lantern_oil = maxf(0.0, sim.lantern_oil - drain * dt)
	sync_lantern_cache(sim)
	# 生命自然回复（来自聚魂派羁绊 + 绿葫芦）
	if sim.s_regen > 0.0 and sim.hp < sim.maxhp and sim.phase != Sim.PH_BREAK:
		sim.hp = minf(sim.maxhp, sim.hp + sim.s_regen * dt)
	# 擦灯闪避检测（冲刺无敌帧内穿过敌弹或预警区）
	if sim.dash_inv > 0.0 and not sim._dash_grazed:
		var grazed := false
		var pyc := sim.py - 34.0
		for i in range(sim.ebullets.size()):
			var b: SimBullet = sim.ebullets[i]
			var dx := b.x - sim.px
			var dy := b.y - pyc
			if dx * dx + dy * dy < 56.0 * 56.0:
				grazed = true
				break
		if not grazed:
			for i in range(sim.teles.size()):
				var tl: SimTele = sim.teles[i]
				if tl.is_inside(Vector2(sim.px, sim.py - (30.0 if tl.is_rect() else 0.0)), 14.0):
					grazed = true
					break
		if grazed:
			sim._dash_grazed = true
			var gain := float(L.get("perfectDashOil", 15.0))
			var refund := float(L.get("perfectDashCdRefund", 0.50))
			if sim.has_rule("rule_graze_oil") and GameData.RULE_BY_ID.has("rule_graze_oil"):
				var rp: Dictionary = GameData.RULE_BY_ID["rule_graze_oil"].get("params", {})
				gain += float(rp.get("oilGain", 12.0))
				refund = minf(0.85, refund + float(rp.get("dashCdRefund", 0.15)))
			add_oil(sim, gain)
			sim.dash_cd *= (1.0 - refund)
			sim.perfect_dash_t = 0.5
			sim.hitstop_t = maxf(sim.hitstop_t, 0.04)
			sim.add_trauma(0.25)
			sim._ev("perfect_dash", sim.px, sim.py - 30.0)
			sim._ev("sfx", "perfect_dash")
	# 阴律：擦弹聚油（非冲刺状态近距擦过敌弹也可聚油）
	if sim.has_rule("rule_graze_oil") and sim.graze_cd <= 0.0 and sim.ebullets.size() > 0:
		var rp2: Dictionary = GameData.RULE_BY_ID.get("rule_graze_oil", {}).get("params", {})
		var gr := float(rp2.get("grazeRadius", 44.0)) + 22.0
		var gr2 := gr * gr
		var pyc2 := sim.py - 34.0
		for i in range(sim.ebullets.size()):
			var b: SimBullet = sim.ebullets[i]
			var dx := b.x - sim.px
			var dy := b.y - pyc2
			var d2 := dx * dx + dy * dy
			if d2 < gr2 and d2 > 24.0 * 24.0:
				sim.graze_cd = float(rp2.get("grazeCd", 0.35))
				add_oil(sim, float(rp2.get("oilGain", 12.0)) * 0.6)
				sim.dash_cd = maxf(0.0, sim.dash_cd - sim.s_dash_cd * float(rp2.get("dashCdRefund", 0.15)))
				break
	# 阴律：龛火护身 & 破庙灯龛护卫光环
	if sim.shrine_ward_t > 0.0:
		sim.shrine_ward_t = maxf(0.0, sim.shrine_ward_t - dt)
		sim.shrine_ward_tick -= dt
		if sim.shrine_ward_tick <= 0.0:
			sim.shrine_ward_tick = 0.5
			var rp3: Dictionary = GameData.RULE_BY_ID.get("rule_shrine_ward", {}).get("params", {})
			var ar := float(rp3.get("auraRadius", 140.0))
			var admg := float(rp3.get("auraDps", 28.0)) * 0.5
			var near := sim._q_rule
			sim.grid_sys.query_into(sim.px, sim.py - 20.0, ar + 30.0, near)
			for i in range(near.size()):
				var e: SimEnemy = near[i]
				if not e.alive:
					continue
				if (e.x - sim.px) * (e.x - sim.px) + (e.y - sim.py) * (e.y - sim.py) < (ar + e.r) * (ar + e.r):
					sim.damage_fast(e, admg, "rule", true, false, true)
	# 开局加速（12s 首次三选一保底）+ 荒野互动目标（24s 首个破庙灯龛/镇魂断碑）
	if sim.mode != "classic" and sim.phase == Sim.PH_SEG:
		_step_opening_and_objectives(sim, dt)


static func on_player_move(sim: Sim, dist: float) -> void:
	if not sim._has_rule_step_lotus or sim.phase == Sim.PH_BREAK:
		return
	var rp: Dictionary = GameData.RULE_BY_ID.get("rule_step_lotus", {}).get("params", {})
	var need_d := float(rp.get("stepDist", 180.0))
	sim.rule_step_acc += dist
	if sim.rule_step_acc >= need_d:
		sim.rule_step_acc -= need_d
		var rad := float(rp.get("radius", 88.0))
		var dmg := float(rp.get("dmg", 32.0))
		var lx := sim.px
		var ly := sim.py - 20.0
		sim._ev("ring", lx, ly, rad)
		var near := sim._q_rule
		sim.grid_sys.query_into(lx, ly, rad + 30.0, near)
		for i in range(near.size()):
			var e: SimEnemy = near[i]
			if not e.alive:
				continue
			if (e.x - lx) * (e.x - lx) + (e.y - ly) * (e.y - ly) < (rad + e.r) * (rad + e.r):
				sim.damage_fast(e, dmg, "rule", false, false, false, false, -1.0, true, e.x - lx, e.y - ly, 110.0)
				if e.alive:
					sim._fusion_ignite(e)


static func on_enemy_kill(sim: Sim, e: SimEnemy) -> void:
	var L := lcfg()
	var gain := float(L.get("killGain", 1.4)) * (5.0 if (e.elite or e.boss) else 1.0)
	add_oil(sim, gain)
	# 连杀与 SNKRX 反馈
	sim.kill_streak += 1
	sim.kill_streak_t = 2.5
	var vis := e.boss or e.elite or sim._is_on_screen(e.x, e.y)
	if vis:
		sim._ev("kill_streak", sim.kill_streak)
	if e.elite or e.boss:
		sim.add_trauma(0.45 if e.boss else 0.28)
		sim.hitstop_t = maxf(sim.hitstop_t, 0.06 if e.boss else 0.035)
	# 阴律：残灯狂澜击杀回血
	if sim._has_rule_low_frenzy and sim._low_frenzy_dmg_add > 0.0:
		var rp_f: Dictionary = GameData.RULE_BY_ID.get("rule_low_frenzy", {}).get("params", {})
		var heal := float(rp_f.get("killHeal", 2.0))
		sim.hp = minf(sim.maxhp, sim.hp + heal)
	# 阴律：尸爆传火（严格递归上限 maxDepth = 1）
	if sim._has_rule_corpse_flame and e.burn_t > 0.0:
		var rp_c: Dictionary = GameData.RULE_BY_ID.get("rule_corpse_flame", {}).get("params", {})
		var max_d := int(rp_c.get("maxDepth", 1))
		if sim.corpse_flame_depth < max_d:
			sim.corpse_flame_depth += 1
			var rad := float(rp_c.get("radius", 105.0))
			var cdmg := clampf(e.maxhp * float(rp_c.get("hpPct", 0.12)), float(rp_c.get("minDmg", 24.0)), float(rp_c.get("maxDmg", 420.0)))
			var ex := e.x
			var ey := e.y - 25.0
			if vis:
				sim._ev("ring", ex, ey, rad)
			var near := sim._q_corpse
			sim.grid_sys.query_into(ex, ey, rad + 30.0, near)
			for i in range(near.size()):
				var o: SimEnemy = near[i]
				if o == e or not o.alive:
					continue
				if (o.x - ex) * (o.x - ex) + (o.y - ey) * (o.y - ey) < (rad + o.r) * (rad + o.r):
					sim.damage_fast(o, cdmg, "rule", true, false, false, false, -1.0, true, o.x - ex, o.y - ey, 120.0)
					if o.alive:
						sim._fusion_ignite(o)
			sim.corpse_flame_depth -= 1


static func _step_opening_and_objectives(sim: Sim, dt: float) -> void:
	var OP: Dictionary = GameData.WV.get("opening", {})
	var first_draft_t := float(OP.get("firstDraftSec", 12.0))
	if not sim.opening_draft_done and sim.clock >= first_draft_t:
		sim.opening_draft_done = true
		if sim.clock < first_draft_t + 8.0 and sim.level == 1 and sim.pending_lv == 0:
			sim._gain_xp(maxi(1, sim.need - sim.xp))
			sim._ev("banner", "初灯引魂 • 首次构筑三选一！", "#ffcf5a")
	var first_shrine_t := float(OP.get("firstShrineSec", 24.0))
	var respawn_t := float(OP.get("shrineRespawnSec", 75.0))
	if sim.next_obj_clock <= 0.0:
		sim.next_obj_clock = first_shrine_t
	var has_active := false
	for i in range(sim.objectives.size() - 1, -1, -1):
		var obj: Dictionary = sim.objectives[i]
		if obj.done:
			continue
		has_active = true
		var ox := float(obj.x)
		var oy := float(obj.y)
		var orad := float(obj.r)
		var d2 := (sim.px - ox) * (sim.px - ox) + (sim.py - oy) * (sim.py - oy)
		if d2 <= orad * orad:
			obj.progress = float(obj.progress) + dt
			if float(obj.progress) >= float(obj.need):
				_complete_objective(sim, obj, OP)
		else:
			obj.progress = maxf(0.0, float(obj.progress) - dt * 0.4)
	if not has_active and sim.clock >= sim.next_obj_clock:
		_spawn_objective(sim, OP)
		sim.next_obj_clock = sim.clock + respawn_t


static func _spawn_objective(sim: Sim, OP: Dictionary) -> void:
	sim.obj_serial += 1
	var is_lamp := (sim.obj_serial % 2 == 1)
	var ang := sim.rng.randf() * TAU
	var dist := 280.0 + sim.rng.randf() * 140.0
	var ox := clampf(sim.px + cos(ang) * dist, Sim.MARGIN + 120.0, Sim.W - Sim.MARGIN - 120.0)
	var oy := clampf(sim.py + sin(ang) * dist, Sim.MARGIN + 120.0, Sim.H - Sim.MARGIN - 120.0)
	var obj := {
		"id": sim.obj_serial,
		"kind": "shrine_lamp" if is_lamp else "stele_soul",
		"name": "破庙灯龛" if is_lamp else "镇魂断碑",
		"x": ox,
		"y": oy,
		"r": 115.0,
		"progress": 0.0,
		"need": float(OP.get("shrineCaptureSec", 3.0)) if is_lamp else 2.5,
		"done": false,
	}
	sim.objectives.append(obj)
	sim._ev("banner", "荒野异象 • 「%s」显现，前往圈内站定触发！" % obj.name, "#ffcf5a" if is_lamp else "#9fe8ff")


static func _complete_objective(sim: Sim, obj: Dictionary, OP: Dictionary) -> void:
	obj.done = true
	var oil_gain := float(OP.get("shrineOilGain", 30.0))
	var ward_dur := float(OP.get("shrineWardDur", 10.0))
	if obj.kind == "shrine_lamp":
		add_oil(sim, oil_gain)
		activate_shrine_ward(sim, ward_dur)
		sim._ev("ring", float(obj.x), float(obj.y), 180.0)
		sim._ev("sfx", "chest")
		if sim.active_rules.size() < SchoolRules.max_rules():
			sim.pending_rule_pick += 1
			sim._ev("banner", "破庙灯龛已点亮 • +%d 灯油 + 10秒护身灯罩 + 阴律抉择！" % int(oil_gain), "#ffcf5a")
		else:
			sim.pending_chest += 1
			sim._ev("banner", "破庙灯龛已点亮 • +%d 灯油 + 10秒护身灯罩 + 古灯宝箱！" % int(oil_gain), "#ffcf5a")
	else:
		add_oil(sim, oil_gain * 0.8)
		# 镇魂断碑震碎：清弹 + 击退 + 伤害 + 葫芦散件/铜钱
		var ox := float(obj.x)
		var oy := float(obj.y)
		var rr := 320.0
		var rr2 := rr * rr
		var eb2 := sim.ebullets
		var bi2 := eb2.size() - 1
		while bi2 >= 0:
			var b: SimBullet = eb2[bi2]
			if (b.x - ox) * (b.x - ox) + (b.y - oy) * (b.y - oy) <= rr2:
				var last2 := eb2.size() - 1
				if bi2 != last2:
					eb2[bi2] = eb2[last2]
				eb2.pop_back()
			bi2 -= 1
		sim._ev("ring", ox, oy, rr)
		var near := sim._q_rule
		sim.grid_sys.query_into(ox, oy, rr + 40.0, near)
		for i in range(near.size()):
			var e: SimEnemy = near[i]
			if not e.alive:
				continue
			if (e.x - ox) * (e.x - ox) + (e.y - oy) * (e.y - oy) < (rr + e.r) * (rr + e.r):
				sim.damage_fast(e, 75.0, "rule", false, false, false, false, -1.0, true, e.x - ox, e.y - oy, 300.0)
		var got := sim.grant_gourd("镇魂断碑")
		if not got:
			sim.coins += 65
		sim.add_trauma(0.5)
		sim._ev("sfx", "flare")
		sim._ev("banner", "镇魂断碑已震碎 • 击退妖潮 + %s！" % ("葫芦散件" if got else "铜钱 65"), "#9fe8ff")
	sim.poi_log.append({"t": snappedf(sim.clock, 0.1), "kind": obj.kind, "res": obj.name})
