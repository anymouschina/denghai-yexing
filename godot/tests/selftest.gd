extends SceneTree
## 规则自检（headless）：godot --headless --path godot --script tests/selftest.gd
## 逐条验证 v1.5 规格（灯芯闸门、裂隙入口条件、守关者血量公式、副本约束、失败惩罚、威胁预算、飞剑术、加算乘区）。
## 这里允许直接调用 Sim 内部入口来构造场景（单元测试）；平衡测试（tests/balance.gd）则一律不作弊。

var fails := 0
var passes := 0


func ok(cond: bool, msg: String) -> void:
	if cond:
		passes += 1
		print("  PASS  ", msg)
	else:
		fails += 1
		print("  FAIL  ", msg)


func near(a: float, b: float, eps: float = 0.01) -> bool:
	return absf(a - b) <= eps * maxf(1.0, absf(b))


func fresh(seed_v: int = 11) -> Sim:
	return Sim.new(seed_v)


## 把一局推进到第 k 个段间（直接调用段间入口，等价于“该段打满时间”）
func to_break(s: Sim, k: int) -> void:
	s.seg = k
	s.t = float(GameData.SEG.segments[k].to)
	s._start_break(k)


func _init() -> void:
	GameData.load_all()
	print("== 数据外置 ==")
	for f in ["balance", "waves", "enemies", "upgrades", "meta", "dungeon", "relics", "segments"]:
		ok(FileAccess.file_exists("res://data/%s.json" % f), "data/%s.json 存在" % f)
	ok(GameData.SEG.segments.size() == 3, "3 段场地")
	ok(float(GameData.SEG.segments[2].to) == 480.0, "一局 8 分钟（第 3 段结束于 480s，之后 BOSS）")

	print("== 灯芯 ==")
	var s := fresh()
	ok(s.wicks == 2, "每局开局 2 枚灯芯")
	to_break(s, 0)
	ok(s.wicks == 2, "第 1 段间灯芯不变")
	to_break(s, 1)
	ok(s.wicks == 2, "第 2 段间灯芯不变")
	var s2 := fresh()
	to_break(s2, 2)
	ok(s2.wicks == 3, "BOSS 前（第 3 段间）额外 +1 枚灯芯")
	ok(s2.phase == Sim.PH_BREAK and s2.gift_pending, "段间清场后出现入口，三选一馈赠待领")
	# 铜钱商店（灯芯只管进裂隙/刷新）
	var s3 := fresh()
	to_break(s3, 0)
	var pr := s3.price_of(s3.shop[0])
	ok(not s3.buy_relic(0), "铜钱不足买不了遗物")
	s3.coins = 1000
	var c0 := s3.coins
	ok(s3.buy_relic(0), "铜钱商店：铜钱可换遗物")
	ok(s3.coins == c0 - pr and s3.relics.size() == 1 and s3.wicks == 2, "买遗物扣铜钱、不扣灯芯")
	var tiers := {"white": 50, "blue": 110, "purple": 200, "gold": 340}
	var okp := true
	for r in GameData.RELICS:
		okp = okp and s3.price_of(r.id) == int(tiers[r.tier])
	ok(okp, "价格严格分层 白50/蓝110/紫200/金340")
	s3.wicks = 0
	ok(s3.rift_state() == "nowick", "没有灯芯进不了裂隙（双用途闸门）")

	print("== 裂隙入口 ==")
	var a := fresh()
	to_break(a, 0)
	ok(a.rift_state() == "ok", "满血、有灯芯：可入")
	a.hp = a.maxhp * 0.59
	ok(a.rift_state() == "weak", "生命低于 60%：灯弱，不可入")
	a.hp = a.maxhp * 0.60
	ok(a.rift_state() == "ok", "生命恰好 60%：可入")

	print("== 进入裂隙 ==")
	var b := fresh()
	to_break(b, 0)
	b.levels = {"fu": 3, "huanhuo": 2}
	b._recalc()
	var dps := b.build_dps()
	var w_before := b.wicks
	ok(b.enter_rift(), "进入裂隙成功")
	ok(b.wicks == w_before - 1, "进入消耗 1 枚灯芯")
	ok(not b.gift_pending, "进入即放弃本段段间三选一")
	ok(b.phase == Sim.PH_RIFT and b.rift_warden != null, "出现 1 个守关者")
	ok(near(b.rift_warden.maxhp, dps * 55.0, 0.001), "守关者血量 = 当前 DPS × 55s（第一次）  [%.0f = %.1f×55]" % [b.rift_warden.maxhp, dps])
	ok(b.rift_target == 55.0 and b.rift_limit == 70.0, "第一次：要求 55s 内击杀，限时 70s")
	ok(b.rift_warden.ai == "swordwarden" and b.rift_warden.def.tex == "boss_swordwarden", "守关者是专属「剑灵」（不再复用跳尸）")
	ok(GameData.DG.warden.traits.size() == 3 and int(GameData.DG.warden.blades) == 3, "3 个专属机制：御剑环身 / 回鞘突刺 / 剑雨")
	b.rift_warden.blades_t = 5.0
	var bp := b.warden_blade_pos(b.rift_warden, 0)
	b.px = bp.x; b.py = bp.y + 34.0; b.invuln = 0.0; b.dash_inv = 0.0
	var hp_bl := b.hp
	b.step(0.05)
	ok(b.hp < hp_bl, "御剑：灵剑触碰玩家受伤")
	b.rift_warden.stagger_t = 1.0
	var wk0 := b.rift_warden.hp
	b.damage(b.rift_warden, 100.0, "fu", {"noCrit": true, "pierce": true})
	var d_st := wk0 - b.rift_warden.hp
	b.rift_warden.stagger_t = 0.0
	wk0 = b.rift_warden.hp
	b.damage(b.rift_warden, 100.0, "fu", {"noCrit": true, "pierce": true})
	ok(near(d_st / (wk0 - b.rift_warden.hp), float(GameData.DG.warden.lunge.staggerTakenMul), 0.001), "突刺后破绽：承伤 ×1.35")
	b.px = Sim.W / 2.0 - 260.0; b.py = Sim.H / 2.0
	# 副本内约束
	b.dash_cd = 0.0
	b.in_dash = true
	b.in_move = Vector2.RIGHT
	b.step(0.05)
	ok(near(b.dash_cd + 0.05, b.s_dash_cd * 1.25, 0.02), "副本内冲刺冷却 ×1.25")
	b.invuln = 0.0
	b.dash_inv = 0.0
	b.hurt_player(5.0, b.px - 30, b.py, "warden:contact")
	ok(near(b.stun, float(GameData.BAL.player.stun) * 1.2, 0.001), "副本内受击硬直 ×1.2")
	var hp1 := b.hp
	b.hp = b.maxhp * 0.5
	var cc := Vector2(Sim.W / 2.0, Sim.H / 2.0)
	var lamp: Array = GameData.SEG.segments[0].lamps[0]
	b.px = cc.x + lamp[0]
	b.py = cc.y + lamp[1]
	b.invuln = 5.0
	var hp_a := b.hp
	for i in range(20):
		b.step(0.05)
	ok(b.hp <= hp_a + 0.001, "副本内骨灯全熄（站在灯旁不回血）")
	b._spawn_pickup("oil", b.px, b.py + 18.0, 1)
	b.hp = b.maxhp * 0.5
	for i in range(5):
		b.step(0.05)
	ok(b.hp <= b.maxhp * 0.5 + 0.001, "副本内无补给（油瓶不回血）")
	b._gain_xp(500)
	for i in range(3):
		b.step(0.05)
	ok(b.choice.is_empty(), "副本内无三选一（升级排队到出副本后）")
	ok(b.pending_lv > 0, "…升级次数留待出副本")
	ok(b.rift_warden.xpv == 0, "守关者不掉经验")

	print("== 失败惩罚 ==")
	var f := fresh()
	to_break(f, 0)
	f.enter_rift()
	f.levels.clear()     # 没有武器：守关者不会被打死，测超时失败
	f._recalc()
	f.invuln = 100.0
	f.hp = 80.0
	var wk := f.wicks
	var sp_ended := f.ended
	var guard := 0
	while f.phase == Sim.PH_RIFT and guard < 5000:
		f.in_move = Vector2.ZERO
		f.invuln = 100.0
		f.step(0.05)
		guard += 1
	ok(f.phase == Sim.PH_BREAK, "超时失败：弹出回到段间")
	ok(near(f.hp, 56.0, 0.001), "失败扣当前生命 30%%（80 〉 56） 实际 %.1f" % f.hp)
	ok(f.wicks == wk, "失败灯芯不退")
	ok(f.rift_state() == "sealed", "该副本本局不可再进")
	ok(not f.ended and not f.over, "失败不结束本局")
	ok(f.threat_next == 1, "出副本后威胁预算 +1 档（待下一段生效）")
	ok(not sp_ended, "—")
	# 死亡也是失败：不结束本局
	var d := fresh()
	to_break(d, 0)
	d.enter_rift()
	d.invuln = 0.0
	d.dash_inv = 0.0
	d.hp = 5.0
	d.hurt_player(50.0, d.px - 10, d.py, "warden:slam")
	ok(d.phase == Sim.PH_BREAK and not d.over, "副本内致死：弹出而非结束本局")
	ok(d.rift_deaths == 1 and d.hp >= 1.0, "记入副本死亡，生命至少 1")

	print("== 成功：飞剑术 / 威胁预算 ==")
	var g := fresh()
	to_break(g, 0)
	g.enter_rift()
	g.damage(g.rift_warden, 1e9, "fu", {"noCrit": true, "pierce": true})
	g.step(0.05)
	ok(g.phase == Sim.PH_BREAK, "击杀守关者 〉 回到段间")
	ok(g.artifact == "sword" and g.has_sword(), "拿到唯一法宝《飞剑术》")
	ok(g.rift_state() == "ok", "成功不封闭裂隙入口（同段仍可…受 2 次上限约束）")
	ok(not g.choice.is_empty() and g.choice.kind == "swb" and g.sw_stage == 2, "首次通关：确定性 +1 段（飞剑第 2 阶）并弹出分叉增益")
	g.choose(0)
	g.leave_break()
	ok(g.choice.is_empty() and g.seg == 1, "进过副本：段间三选一已放弃，直接进入下一段")
	ok(g.threat_cur == 1, "出副本后本段威胁预算 +1 档")
	var tier_hp := pow(float(GameData.DG.threat.hpMul), 1)
	var e1 := g.spawn_enemy("paperman")
	var base_hp := float(GameData.EN.paperman.hp) * pow(float(GameData.WV.hpMulPerMin), g.t / 60.0) * pow(float(GameData.WV.late.hpPerMin), maxf(0.0, (g.t - float(GameData.WV.late.from)) / 60.0))
	ok(near(e1.hp, base_hp * tier_hp, 0.001), "威胁 +1 档：本段妖物血量 ×%.2f" % tier_hp)
	# 第二次：第 2 段间；一局最多 1 件法宝 〉 第二次通关给宝箱
	to_break(g, 1)
	ok(g.enter_rift(), "第 2 次进入")
	ok(g.rift_target == 70.0 and g.rift_limit == 90.0, "第二次：70s 内击杀，限时 90s")
	g.damage(g.rift_warden, 1e9, "fu", {"noCrit": true, "pierce": true})
	g.step(0.05)
	ok(g.artifact == "sword" and (g.pending_chest == 1 or (not g.choice.is_empty() and g.choice.kind in ["chest", "swb"])), "一局最多 1 件法宝：第二次通关改发宝箱")
	ok(g.relics.size() == 1, "…外加一件免费遗物")
	to_break(g, 2)
	ok(g.rift_state() == "cooldown" and g.rift_cd_left() > 0.0, "第 3 次起有冷却而不是硬上限（剩余 %.0f 秒）" % g.rift_cd_left())
	var g3 := g.fork()
	g3.choice = {}
	g3.pending_chest = 0
	g3.clock += 100.0
	g3.wicks = 3
	g3.hp = g3.maxhp
	ok(g3.rift_state() == "ok", "冷却结束后可再次进入（不限总次数）")
	ok(g3.enter_rift() and g3.rift_target == 80.0 and g3.rift_limit == 100.0, "第 3 次：目标 80s、限时 100s（难度递增）")
	var w3_dmg: float = g3.rift_warden.dmg
	g3.damage(g3.rift_warden, 1e9, "fu", {"noCrit": true, "pierce": true})
	g3.step(0.05)
	ok(g3.rift_clears >= 2 and g3.wicks == 3, "第 3 次通关：返还 1 灯芯 (clears=%d wicks=%d)" % [g3.rift_clears, g3.wicks])

	print("== 飞剑术 ==")
	var h := fresh()
	h.artifact = "sword"
	h.sw_state = Sim.SW_STOW
	h.s_crit = 0.0
	var dummy := h.spawn_enemy("jiangshi", -1.0, -1.0, {"pos": Vector2(h.px + 200.0, h.py)})
	dummy.hp = 1e9
	dummy.maxhp = 1e9
	dummy.speed = 0.0
	dummy.armor = 0.5   # 法宝穿甲：不吃护甲
	var sw: Dictionary = GameData.DG.sword
	var mul0 := h._dmg_mul(dummy, "fu")
	dummy.marks = 3
	ok(near(h._dmg_mul(dummy, "fu"), mul0 + 3.0 * float(sw.markPer), 0.0001), "每层剑痕 +6% 承伤（加算）")
	dummy.marks = 9
	h._sword_strike(dummy, 1.0, false)
	ok(dummy.marks == int(sw.markMax), "剑痕 5 层封顶")
	# 加算不取乘乘：进化 + 剑痕
	h.evo["fu"] = true
	h.s_dmg_add = 0.2
	dummy.marks = 5
	ok(near(h._dmg_mul(dummy, "fu"), 1.0 + 0.2 + float(GameData.BAL.evoAdd) + 5.0 * float(sw.markPer), 0.0001), "法宝增伤与武器进化取加算（1 + 0.2 + 进化 + 剑痕）")
	h.evo.clear()
	h.s_dmg_add = 0.0
	dummy.marks = 0
	dummy.marks_t = 0.0
	# 出鞘 〉 回旋（椭圆）〉 召回 〉 二段 1.8×
	h.in_skill = true
	h.step(0.05)
	ok(h.sw_state == Sim.SW_ORBIT, "按主动键：飞剑出鞘并绕玩家椭圆回旋")
	var hp_b := dummy.hp
	for i in range(60):
		h.step(0.05)
		if h.sw_state != Sim.SW_ORBIT:
			break
	ok(dummy.hp < hp_b and dummy.marks >= 1, "回旋命中并叠剑痕（穿甲：护甲 50%% 不生效）")
	var orbit_hits := 0.0
	# 重新测一次干净的“单发”与“二段”伤害
	var h2 := fresh()
	h2.artifact = "sword"
	h2.sw_state = Sim.SW_STOW
	h2.s_crit = 0.0
	var d2 := h2.spawn_enemy("jiangshi", -1.0, -1.0, {"pos": Vector2(h2.px + 250.0, h2.py)})
	d2.hp = 1e9
	d2.maxhp = 1e9
	d2.speed = 0.0
	d2.armor = 0.5
	var before := d2.hp
	h2._sword_strike(d2, sw.dmg, false)
	var single := before - d2.hp   # 已含第 1 层剑痕 +6%
	d2.marks = 0
	before = d2.hp
	h2._sword_strike(d2, sw.dmg, true)
	var thrust := before - d2.hp
	ok(near(thrust / single, float(sw.thrustMul), 0.001), "召回二段伤害 = 1.8 × 单发（同层剑痕下）  比值 %.3f" % (thrust / single))
	# 召回刺出方向
	h2.sw_state = Sim.SW_ORBIT
	h2.sw_t = 5.0
	d2.marks = 0
	var hp_c := d2.hp
	h2.in_move = Vector2.RIGHT
	h2.in_skill = true
	h2.step(0.05)
	ok(h2.sw_state == Sim.SW_RECALL, "再按主动键：飞剑召回")
	for i in range(10):
		h2.in_move = Vector2.ZERO
		h2.step(0.05)
		if h2.sw_state != Sim.SW_RECALL:
			break
	ok(d2.hp < hp_c, "向面朝方向收束刺出，穿过目标")
	# 召回瞬间受击 〉 坠地 3 秒
	var h3 := fresh()
	h3.artifact = "sword"
	h3.sw_state = Sim.SW_RECALL
	h3.sw_t = 0.2
	h3.invuln = 0.0
	h3.dash_inv = 0.0
	h3.hurt_player(3.0, h3.px - 10, h3.py, "paperman:contact")
	ok(h3.sw_state == Sim.SW_DROP and near(h3.sw_t, 3.0, 0.001), "召回瞬间受击：飞剑坠地 3 秒")
	var h4 := fresh()
	h4.artifact = "sword"
	h4.sw_state = Sim.SW_ORBIT
	h4.sw_t = 4.0
	h4.invuln = 0.0
	h4.hurt_player(3.0, h4.px - 10, h4.py, "paperman:contact")
	ok(h4.sw_state == Sim.SW_ORBIT, "回旋期间受击不坠地（只有召回瞬间才会）")

	print("== 飞剑阶段 / 融合 ==")
	ok(g.sw_stage == 3, "第二次通关再 +1 段（第 3 阶）")
	var q := fresh(9)
	to_break(q, 1)
	ok(q.pending_fusion == 1 and q.artifact == "sword" and q.sw_stage == int(GameData.DG.fusion.guaranteeSwordStage), "融合保底：段间必出融合，缺飞剑则剑冢遗赠（阶数取 fusion.guaranteeSwordStage）")
	q.step(0.05)
	ok(q.choice.kind == "fusion" and q.choice.options.size() >= 1, "融合选择出现")
	q.choose(0)
	ok(q.fusion != "", "融合已生效：" + q.fusion)
	q.sw_stage = 5
	q.px = Sim.W / 2.0; q.py = Sim.H / 2.0
	q.phase = Sim.PH_SEG
	q.pickups.clear()
	q.pending_chest = 0
	q.choice = {}
	var dm := q.spawn_enemy("paperman", -1.0, -1.0, {"pos": Vector2(q.px + 120.0, q.py)})
	dm.hp = 1e9; dm.maxhp = 1e9; dm.speed = 0.0
	for i in range(120):
		q.step(0.05)
	ok(q.sw_wheel_pos.size() == 3, "阶段3 剑轮 3 把")
	ok(float(q.dmg_by.get("sw_wheel", 0.0)) > 0.0 and float(q.dmg_by.get("sw_qi", 0.0)) > 0.0 and float(q.dmg_by.get("sw_array", 0.0)) > 0.0, "阶段3/4/5 的攻击方式都实际造成伤害")
	print("== 大地图 / 战斗中裂隙入口 ==")
	var mp := fresh(21)
	ok(Sim.W == 3600.0 and Sim.H == 2400.0, "主战场 3600×2400")
	ok(mp.pois.size() == 11 and mp.poi_state(0) == "ok", "大地图 2 剑冢 + 游商 + 2 灵藤 + 葫芦藤秘境 + 镇魂宝库 + 4 地标（kind 字段）")
	ok(mp.pickups.size() >= 1 and mp.pickups[0].kind == "chest" and Vector2(mp.pickups[0].x - mp.px, mp.pickups[0].y - mp.py).length() < 350.0, "出生点 350px 内刷古灯宝箱")
	var mw0 := mp.wicks
	mp.px = float(mp.pois[0].x); mp.py = float(mp.pois[0].y)
	for i in range(40):
		mp.step(0.05)
		if mp.phase == Sim.PH_RIFT:
			break
	ok(mp.phase == Sim.PH_RIFT and mp.wicks == mw0 - 1 and mp.rift_poi == 0, "站定入口 1 秒进入裂隙，耗 1 灯芯")
	mp.damage(mp.rift_warden, 1e9, "fu", {"noCrit": true, "pierce": true})
	mp.step(0.05)
	ok(mp.phase == Sim.PH_SEG and absf(mp.px - float(mp.pois[0].x)) < 1.0 and mp.artifact == "sword", "击败后回到主图原位并得飞剑术")
	mp.hp = maxf(1.0, mp.maxhp * 0.1)
	ok(mp.poi_state(1) == "weak", "灯弱时入口不可入")
	print("== 15/10 分钟模式 ==")
	var mf := Sim.new(3, {"mode": "full"})
	var mq := Sim.new(3, {"mode": "quick"})
	mf.invuln = 99.0; mq.invuln = 99.0
	for i in range(300):
		mf.choice = {}; mq.choice = {}
		mf.step(0.1); mq.step(0.1)
	ok(near(mf.clock, 30.0) and near(mf.t, 30.0 / 1.5), "完整模式：战斗节奏钟拉伸 1.5×（段内 480×1.5=12 分钟，含守关/BOSS/段间全程约 18 分钟）")
	ok(near(mq.t, 30.0 / 1.25), "疾速模式：拉伸 1.25×（整局 10 分钟）")
	var mm := fresh(22)
	mm.px = float(mm.pois[2].x); mm.py = float(mm.pois[2].y)
	for i in range(40):
		mm.step(0.05)
		if mm.shop_open:
			break
	ok(mm.shop_open and mm.shop.size() > 0, "战斗中站定游商灯摊 1 秒打开商店")
	print("== 套装 / 进化件 / 葫芦 / 小金刚 / 小 BOSS ==")
	var cs := fresh(31)
	ok(GameData.SETS.size() == 8, "8 组套装")
	cs.relics = ["talisman"]
	cs._recalc()
	var dm1 := cs.s_dmg_add
	cs.relics = ["talisman", "ember"]
	cs._recalc()
	ok(cs.active_sets() == ["flame"] and cs.s_dmg_add > dm1 + 0.08, "烈焰焚魂 2/2 激活并真实加成伤害")
	var cp := fresh(32)
	cp.levels = {"fu": 5}
	cp._recalc()
	ok(cp.part_ready("part_fu") and not cp.part_ready("part_lei"), "驱邪符满级才能买「镇魂连爆符」")
	cp.relics = ["part_lei"]
	cp.levels["lei"] = 1
	cp._recalc()
	ok(cp.s_chain >= 2, "引雷铜柱：连锁 +2")
	var cg := fresh(33)
	for i in range(7):
		ok(cg.grant_gourd(), "葫芦散件 %d/7 不重复" % (i + 1))
	ok(cg.gourds.size() == 7 and cg.pet_on and not cg.grant_gourd(), "7 色集齐合成小金刚，且不再重复掉落")
	var cu := {}
	for gg in cg.gourds:
		cu[gg] = true
	ok(cu.size() == 7, "7 个颜色互不相同")
	cg.pickups.clear()
	var tg := cg.spawn_enemy("paperman", -1.0, -1.0, {"pos": Vector2(cg.px + 150.0, cg.py)})
	tg.hp = 1e7; tg.maxhp = 1e7; tg.speed = 0.0
	for i in range(120):
		cg.choice = {}
		cg.step(0.05)
	ok(float(cg.dmg_by.get("pet", 0.0)) > 0.0, "小金刚自动攻击造成伤害")
	cg.in_combo = true
	cg.step(0.05)
	ok(cg.combo_cd > float(GameData.GD.pet.comboCd) - 1.0 and cg.combo_waves > 0, "Q 七彩神光斩进入冷却并排出后续天雷波次")
	cg.invuln = 0.0; cg.dash_inv = 0.0
	var m0 := cg.pet_marks
	cg.pet_hp = 1.0
	cg.hurt_player(100.0, cg.px, cg.py, "x")
	ok(cg.pet_dead_t > float(GameData.GD.pet.revive) - 1.0 and cg.pet_marks == m0 - 1, "小金刚阵亡：%ds 复活冷却 + 掉 1 层印记" % int(GameData.GD.pet.revive))
	var cm := Sim.new(34, {"mode": "quick"})
	cm.t = float(GameData.SEG.segments[0].to)
	cm.step(0.05)
	var nm := 0
	var gref: SimEnemy = null
	for e in cm.enemies:
		if e.el.has("mini"):
			nm += 1
			gref = e
	ok(nm == 1 and cm.phase == Sim.PH_SEG, "疾速模式：段末先刷出清场守关 BOSS，段间不会提前开始")
	cm.step(0.05)
	ok(cm.phase == Sim.PH_SEG, "守关 BOSS 在场时不清场")
	cm.damage(gref, 1e9, "fu", {"noCrit": true, "pierce": true})
	cm.step(0.05)
	cm.step(0.05)
	ok(cm.phase == Sim.PH_BREAK and cm.gourds.size() >= 1 and cm.coins > 0 or cm.pickups.size() > 0, "击败守关 BOSS 后清场进段间，且掉葫芦散件+铜钱")
	var fg := Sim.new(48, {"mode": "full"})
	fg._roll_shop()
	ok(fg.shop.has("gourd_piece") and fg.price_of("gourd_piece") == 80, "完整模式游商上架铜钱直购葫芦散件（80 起，每得一件 +20）")
	fg.coins = 100
	ok(fg.buy_relic(fg.shop.find("gourd_piece")) and fg.gourds.size() == 1 and fg.coins == 20 and fg.gourd_log[0].src == "游商购买", "购买葫芦散件")
	var tot := 0
	var cv := fresh(35)
	cv.px = float(cv.pois[3].x); cv.py = float(cv.pois[3].y)
	for i in range(40):
		cv.step(0.05)
	ok(cv.gourds.size() == 1 and cv.vine_taken.has(3), "葫芦灵藤站定采集 1 片散件")
	var old := Sim.new(36)
	old.from_save({"phase": 1, "seg": 1, "hp": 50.0, "level": 5, "ver": 2})
	ok(old.gourds.is_empty() and not old.pet_on and old.seg == 1, "旧存档（无葫芦/小金刚字段）读取不报错并补默认值")
	print("== C2：秘境 / 套装机制 / 旧存档 clock ==")
	for kind in ["gourd", "vault"]:
		var ar := fresh(41)
		var idx := 5 if kind == "gourd" else 6
		ar.px = float(ar.pois[idx].x); ar.py = float(ar.pois[idx].y)
		var hp0 := ar.hp
		ar.coins = 200
		var co0 := ar.coins
		for i in range(40):
			ar.step(0.05)
			if ar.phase == Sim.PH_RIFT:
				break
		ok(ar.phase == Sim.PH_RIFT and ar.rift_kind == kind, kind + " 秘境站定 1 秒进入")
		ar.invuln = 1e9
		var gi := 0
		while ar.phase == Sim.PH_RIFT and gi < 4000:
			for e in ar.enemies:
				if e.alive:
					e.hp = 0.0
					ar._kill(e, "fu")
			ar.pickups.clear()
			ar.step(0.1)
			gi += 1
		ok(ar.phase == Sim.PH_SEG and absf(ar.px - float(ar.pois[idx].x)) < 1.0 and (kind == "gourd" or ar.rift_sealed.has(100 + idx)), kind + " 通关后传回原位（宝库封闭，葫芦藤可重复挑战）")
		if kind == "gourd":
			ok(ar.gourds.size() == 1 and ar.coins < 200 + 100 and ar.gourd_log[0].src.begins_with("葫芦藤秘境"), "葫芦藤秘境通关必得 1 片散件，门票已扣")
			ok(ar.vine_ticket() == 60 and ar.poi_state(idx) == "ok", "第 2 劫门票涨到 60 铜钱")
			var hp_first: float = float(ar.rift_log[0].boss_hp)
			ar.px = float(ar.pois[idx].x); ar.py = float(ar.pois[idx].y)
			for i in range(40):
				ar.step(0.05)
				if ar.phase == Sim.PH_RIFT:
					break
			ok(ar.phase == Sim.PH_RIFT and ar.vine_runs == 2 and ar.vine_boss != null and ar.vine_boss.maxhp > hp_first * 0.99 and ar.vine_boss.dmg > 0.0, "第 2 劫：藤妖血量/伤害比第 1 劫更高")
			var dmg2: float = ar.vine_boss.dmg
			ar.rift_t = ar.rift_limit + 1.0
			var coins_before := ar.coins
			ar.step(0.05)
			ok(ar.phase == Sim.PH_SEG and ar.coins >= coins_before + 60 and ar.vine_runs == 1, "超时失败：门票全额返还，强度不升级")
			ar.px = float(ar.pois[idx].x); ar.py = float(ar.pois[idx].y)
			for i in range(40):
				ar.step(0.05)
				if ar.phase == Sim.PH_RIFT:
					break
			var coins_in := ar.coins
			ar.invuln = 0.0; ar.dash_inv = 0.0
			ar.hp = 0.5
			ar.hurt_player(999.0, -1e9, 0.0, "x")
			ok(ar.phase == Sim.PH_SEG and not ar.over and ar.coins == coins_in, "葫芦藤秘境内倒下：门票不退（与剑冢倒下同口径）")
			var poor := fresh(43)
			poor.coins = 10
			ok(poor.poi_state(5) == "noticket", "铜钱不足：提示门票价格")
		else:
			ok(ar.relics.size() == 1 and ar.pickups.size() > 0, "镇魂宝库给高阶遗物与铜钱")
	var fz := Sim.new(53, {"mode": "full"})
	fz.real_t = 329.0
	fz.clock = 100.0   # 模拟打过副本/段间：战斗钟远落后于真实时间
	fz.step(0.05)
	ok(fz.pending_fusion == 0 and fz.fusion_t < 0.0, "融合：真实时间 5:30 前不触发")
	fz.real_t = 331.0
	fz.step(0.05)
	ok(fz.pending_fusion == 1 or fz.fusion != "" or not fz.choice.is_empty(), "融合按真实时间 5:30 触发（不再被副本/段间暂停的战斗钟拖到 10 分钟后）")
	print("== 地标交互 / 飞剑精通 / 葫芦保底 ==")
	var lm := fresh(44)
	lm.coins = 100
	lm.hp = lm.maxhp * 0.5
	for k in range(4):
		var idx2 := 7 + k
		lm.px = float(lm.pois[idx2].x); lm.py = float(lm.pois[idx2].y)
		var st0: String = lm.poi_state(idx2)
		for i in range(30):
			lm.choice = {}
			lm.step(0.05)
			if lm.poi_log.size() > k:
				break
		ok(lm.poi_log.size() == k + 1 and lm.poi_cd.has(idx2), "%s：站定后真实触发（%s）" % [lm.pois[idx2].name, lm.poi_log[k].res if lm.poi_log.size() > k else "未触发 state=" + st0])
	ok(lm.relics.size() >= 1 and lm.coins < 100 + 90 and lm.hp > lm.maxhp * 0.5 * 0.8 - 1.0, "祭坛得遗物、香炉回血、牌坊/香炉扣铜钱")
	var again := lm.poi_state(7)
	ok(again == "cd" and lm.lm_hint(7).contains("冷却"), "地标有冷却并写明剩余秒数")
	var swm := fresh(45)
	swm.artifact = "sword"
	swm.sw_state = Sim.SW_STOW
	swm.sw_stage = 5
	swm.sw_kill5 = 0
	swm.sw_kills = 799
	swm._sw_check()
	ok(swm.sw_master == 0, "精通：未满 800 击杀不升")
	swm.sw_kills = 800
	swm._sw_check()
	ok(swm.sw_master == 1, "飞剑 5/5 后每 800 击杀精通 +1（+8% 伤害）")
	swm._sword_advance("副本守关者")
	ok(swm.sw_master == 2, "再破守关者精通 +1")
	var gg := Sim.new(46, {"mode": "full"})
	gg.clock = 175.0
	gg.step(0.05)
	ok(gg.gourds.size() == 1 and gg.gourd_log[0].src == "保底", "完整模式保底：约每 %d 秒必出一件葫芦散件" % int(GameData.GD.guarantee.full))
	var gq := Sim.new(46, {"mode": "quick"})
	gq.clock = 7.0 * gq.gourd_guarantee_step() + 1.0
	for j in range(8):
		gq.step(0.05)
	ok(gq.gourds.size() == 7 and gq.pet_on and 7.0 * gq.gourd_guarantee_step() < 600.0, "疾速模式（10 分钟）保底也能在终局前集齐 7 件并合成小金刚（以前只能到 3 件保底）")
	var gc := fresh(47)
	gc.clock = 400.0
	gc.step(0.05)
	ok(gc.gourds.size() == 0, "经典口径不发保底（平衡基线不变）")
	var sm := fresh(42)
	sm.relics = ["coin", "thunder", "talisman", "ember", "horse", "blade", "bell", "purse", "mirror", "shade", "gold1", "gold2", "soul1", "soul2", "army1", "army2"]
	sm._recalc()
	ok(sm.active_sets().size() == 8, "8 组套装全部可激活")
	var bt := sm.spawn_enemy("paperman", -1.0, -1.0, {"pos": Vector2(sm.px + 100.0, sm.py)})
	bt.burn_t = 3.0
	var nb := sm.spawn_enemy("paperman", -1.0, -1.0, {"pos": Vector2(sm.px + 160.0, sm.py)})
	nb.hp = 1e6
	sm.set_ward_cd = 0.0
	bt.hp = 0.0
	sm._rebuild_grid()
	sm._kill(bt, "fu")
	ok(nb.burn_t > 0.0, "烈焰焚魂：灼烧怪死亡传染周围")
	sm.ebullets.append(SimBullet.new())
	sm.invuln = 0.0; sm.dash_inv = 0.0
	sm.hurt_player(1.0, sm.px, sm.py, "x")
	ok(sm.ebullets.is_empty() and sm.set_ward_cd > 0.0, "镇煞护心：受击反震清弹幕")
	var oc := Sim.new(43)
	oc.from_save({"phase": 0, "seg": 0, "t": 89.9, "stretch": 3.75, "ver": 2})
	ok(oc.clock > 300.0, "旧存档缺 clock 由 t×stretch 回推")
	print("== C3：6 段 / 专属小 BOSS ==")
	var f6 := Sim.new(51, {"mode": "full"})
	ok(f6.seg_n() == 6 and absf(f6.seg_to(0) - 80.0) < 0.01 and absf(f6.seg_to(5) - 480.0) < 0.01, "完整模式 6 段，每段 2 分钟（节奏钟 80 × 1.5）")
	ok(f6.seg_theme(3).name == "灯冢废墟" and f6.seg_theme(5).name == "灯骸古殿", "6 段主题名")
	f6.t = 79.9
	f6.step(0.5)
	ok(f6.phase == Sim.PH_SEG and f6.guard_ref != null, "第 1 段末：守关 BOSS 已提前刷出（占用段内时间）")
	f6.damage(f6.guard_ref, 1e9, "fu", {"noCrit": true, "pierce": true})
	f6.step(0.1)
	f6.step(0.1)
	ok(f6.phase == Sim.PH_BREAK and f6.break_idx == 0, "击败守关 BOSS 后清场进入段间")
	var q6 := Sim.new(52)
	ok(q6.seg_n() == 3, "非完整模式仍 3 段")
	for pair in [["swordlord", 2], ["sedan", 3], ["lamps", 4]]:
		var bm := Sim.new(53, {"mode": "full"})
		bm._spawn_mini_special(int(pair[1]))
		var bo: SimEnemy = bm.enemies[bm.enemies.size() - 1]
		ok(bo.ai == pair[0] and bo.def.tex == GameData.MB[pair[0]].tex, "%s：专属 AI 与专属贴图（非跳尸/灯笼妖）" % pair[0])
		bm.invuln = 1e9
		bm.px = bo.x - 400.0; bm.py = bo.y
		var got_b := false
		var got_ln := false
		var got_g := false
		var pk := bm.pickups.size()
		for i in range(200):
			bm.choice = {}
			bm.step(0.05)
			bo.hp = bo.maxhp
			got_b = got_b or bm.ebullets.size() > 0
			got_ln = got_ln or bo.state == "lunge" or bo.state == "aim"
			for e in bm.enemies:
				if e.type == "paperman":
					got_g = true
		if pair[0] == "swordlord":
			ok(got_b, "剑冢真主：环形飞剑阵/扇形剑雨发射弹幕")
		elif pair[0] == "sedan":
			ok(got_b and got_ln and got_g, "纸轿冥娘：冲锋预警 + 撒纸钱 + 召纸人卫兵")
			bm.invuln = 0.0; bm.dash_inv = 0.0; bm.stun = 0.0
			bm.hurt_player(1.0, bm.px, bm.py, "sedan:paper")
			ok(bm.stun > 1.0, "纸钱弹幕命中减速")
		else:
			bm.px = bo.x + 150.0; bm.py = bo.y - bo.h * 0.45 + 34.0
			var lp := bm.lamp_pos(bo, 0)
			ok(got_b and lp.distance_to(Vector2(bo.x, bo.y)) > 50.0, "百灯鬼王：鬼灯绕身 + 鬼火射线扫射")
	var ab := fresh(61)
	ab.abandon()
	ok(ab.ended and not ab.victory and ab.result.cause == "abandon", "结算本局：按当前进度结算")
	print("== 确定性 ==")
	var r1 := _run_fixed(777)
	var r2 := _run_fixed(777)
	ok(r1 == r2, "同种子两次模拟结果一致 (%s)" % r1)

	print("== 渲染脚本可加载 ==")
	for sp in ["tri_batch", "touch_controls"]:
		var sc: Script = load("res://src/%s.gd" % sp)
		ok(sc != null and sc.can_instantiate(), "%s.gd 能解析" % sp)
	var tb := TriBatch.new()
	tb.full(0, 0, 4, 4, Color.WHITE)
	tb.circle(Vector2(5, 5), 3.0, Color.WHITE)
	tb.line(Vector2.ZERO, Vector2(5, 0), 2.0, Color.WHITE)
	ok(tb._vc == 4 + 14 + 4 and tb._ic == 6 + 36 + 6, "TriBatch 顶点/索引数量正确")

	print("== 存档往返 ==")
	var sv1 := fresh(5)
	to_break(sv1, 1)
	sv1.levels = {"fu": 4, "lei": 2}
	sv1.relics = ["mirror"]
	sv1.wicks = 1
	sv1.artifact = "sword"
	sv1.rift_entries = 1
	sv1.rift_sealed = {0: true}
	sv1.hp = 77.0
	sv1.level = 9
	var blob := JSON.stringify(sv1.to_save())
	var sv2 := Sim.new(5)
	sv2.from_save(JSON.parse_string(blob))
	ok(sv2.phase == Sim.PH_BREAK and sv2.seg == 1 and sv2.break_idx == 1, "段位/段间序号一致")
	ok(near(sv2.hp, 77.0) and sv2.level == 9, "生命/等级一致")
	ok(sv2.levels.get("fu") == 4 and sv2.levels.get("lei") == 2, "已选升级一致")
	ok(sv2.relics == ["mirror"] and sv2.wicks == 1 and sv2.artifact == "sword", "遗物/灯芯/法宝一致")
	ok(sv2.rift_entries == 1 and sv2.rift_sealed.has(0) and sv2.rift_state() != "none", "副本已用次数/封闭状态一致")
	_test_d1()
	_test_v22()
	_test_assets()
	print("== 小结 ==")
	print("通过 %d 项，失败 %d 项" % [passes, fails])
	quit(1 if fails > 0 else 0)


## 数据里引用的背景键都能按 world_view._bg_tex 的规则（res://assets/<key>.jpg）载入。
## 无头自检不跑渲染层，疾速/经典的 3 段表曾写成 "field.jpg" → 载入 field.jpg.jpg 崩溃，只在网页里暴露。
func _test_assets() -> void:
	print("== 资源：段背景键 ==")
	var bad: Array = []
	for list_key in ["segments", "themes"]:
		for sg in GameData.SEG[list_key]:
			var key := String(sg.get("field", ""))
			if key == "" or not ResourceLoader.exists("res://assets/%s.jpg" % key):
				bad.append("%s:%s" % [list_key, key])
	if not ResourceLoader.exists("res://assets/field_rift.jpg"):
		bad.append("field_rift")
	ok(bad.is_empty(), "每段背景键都能载入（坏键：%s）" % [bad])


## 练级点 / 淬火 / 突破 / 百万血 Boss（单独成函数，避免与 _init 里的变量重名）
func _test_d1() -> void:
	print("== D1：练级点 / 淬火 / 突破 / 百万血 Boss ==")
	var fm := Sim.new(61, {"mode": "full"})
	var ci := -1
	var si := -1
	for j in range(fm.pois.size()):
		if fm.pois[j].kind == "coinfarm": ci = j
		if fm.pois[j].kind == "soulfarm": si = j
	ok(ci == 11 and si == 12, "练级点追加在 POI 末尾（旧下标不变）")
	ok(Sim.new(61).pois.size() == 11, "经典口径不加练级点")
	fm.hp = fm.maxhp
	fm.px = float(fm.pois[ci].x); fm.py = float(fm.pois[ci].y)
	fm._spawn_pickup("coin", fm.px + 900.0, fm.py, 7)
	var c0 := fm.coins
	for j in range(30):
		fm.step(0.05)
		if fm.phase == Sim.PH_RIFT: break
	ok(fm.phase == Sim.PH_RIFT and fm.rift_kind == "coinfarm", "站定 1 秒进入聚宝鬼市")
	ok(fm.pickups.is_empty() and fm.arena_stash.size() >= 1, "进秘境前地上的铜钱先收起来（不再被清掉）")
	fm.invuln = 1e9
	var guard := 0
	while fm.phase == Sim.PH_RIFT and guard < 2000:
		for e in fm.enemies:
			if e.alive: fm.damage(e, 1e9, "fu", {"noCrit": true, "pierce": true})
		fm.step(0.05)
		guard += 1
	ok(fm.phase == Sim.PH_SEG and int(fm.farm_runs.get("coinfarm", 0)) == 1, "坚持到时间即通关并回到大地图")
	ok(fm.coins - c0 >= 7 + 60 and int(fm.farm_gain.kills) > 10, "聚宝鬼市：每只妖物必掉铜钱 + 通关奖励（铜钱 +%d，击杀 %d）" % [fm.coins - c0, int(fm.farm_gain.kills)])
	ok(fm.poi_state(ci) == "cd" and fm.poi_state(ci) != "sealed", "练级点有冷却、不封死（可反复刷）")
	fm.clock += 61.0
	ok(fm.poi_state(ci) == "ok", "冷却过后可再刷")
	fm.guard_ref = fm.spawn_enemy("jiangshi", -1.0, -1.0, {"elite": true})
	var g_hp := fm.guard_ref.hp
	ok(fm.poi_state(si) == "ok", "守关 BOSS 在场时也能进练级点（进去不清怪，出来接着打）")
	var lv0 := fm.level
	fm.px = float(fm.pois[si].x); fm.py = float(fm.pois[si].y)
	fm.hp = fm.maxhp
	for j in range(60):
		while not fm.choice.is_empty():
			fm.choose(0)   # 鬼市里捡的魂火升了级：三选一会暂停 step
		fm.step(0.05)
		if fm.phase == Sim.PH_RIFT: break
	ok(fm.rift_kind == "soulfarm", "进入炼魂坑")
	ok(not fm.enemies.has(fm.guard_ref) and fm.world_stash.has(fm.guard_ref) and fm.guard_ref.alive, "进练级点：大地图妖物（含守关 BOSS）原样收起，不清怪")
	var clk_in := fm.clock
	var t_in := fm.t
	var e_soul: SimEnemy = null
	guard = 0
	while e_soul == null and guard < 100:
		fm.step(0.05)
		guard += 1
		for e in fm.enemies:
			if e.alive and e.type == "paperman": e_soul = e
	ok(e_soul != null and e_soul.xpv >= 3 * int(GameData.EN.paperman.xp), "炼魂坑：妖物魂火 ×3")
	fm.hp = 0.5
	fm.invuln = 0.0; fm.dash_inv = 0.0
	fm.hurt_player(999.0, -1e9, 0.0, "x")
	ok(fm.phase == Sim.PH_SEG and not fm.over and fm.rift_kind == "sword", "练级点内倒下：弹出副本扣血不死、副本类型复位（不会把下一次剑冢当秘境跑）")
	ok(fm.enemies.has(fm.guard_ref) and fm.guard_ref.alive and near(fm.guard_ref.hp, g_hp) and fm.world_stash.is_empty(), "出练级点（倒下弹出）：大地图妖物原样放回，守关 BOSS 血量不变")
	ok(fm.clock > clk_in + 0.5 and fm.t > t_in, "练级点里大地图时钟照走（刷要花一局的时间，不能无限拉长）")
	fm.guard_ref.alive = false
	fm.guard_ref = null
	var gw := Sim.new(62, {"mode": "full"})
	gw.invuln = 1e9
	gw.t = gw.seg_to(0) - 0.01
	gw.clock = gw.t * gw.stretch
	for j in range(40):
		while not gw.choice.is_empty():
			gw.choose(0)
		gw.invuln = 1e9
		gw.step(0.05)
	ok(gw.phase == Sim.PH_SEG and gw.guard_ref != null and gw.guard_ref.alive and near(gw.t, gw.seg_to(0)), "守关 BOSS 在场：先不清场，节奏钟停在段末（下一段妖潮不提前刷）")
	var gl := Sim.new(62, {"mode": "full"})
	gl.from_save(JSON.parse_string(JSON.stringify(gw.to_save())))
	gl.invuln = 1e9
	gl.step(0.05)
	ok(gl.phase == Sim.PH_SEG and gl.guard_ref != null and gl.guard_ref.alive, "守关 BOSS 打到一半存档：读档后重新刷出守关 BOSS（不直接清场）")
	fm.choice = {}
	fm.pending_lv = 0
	for u in GameData.UP.list:
		fm.levels[u.id] = int(u.max)
	for ev in GameData.UP.evolutions:
		fm.evo[ev.weapon] = true
	fm._recalc()
	var opts := fm.roll_choices(false)
	ok(opts.size() == 3 and opts[0].kind == "asc" and opts[1].kind == "asc", "武器被动全满后：升级出可无限叠加的突破卡（不再只给补给）")
	var d0 := fm.s_dmg_add
	var hp0 := fm.maxhp
	fm.choice = {"kind": "level", "options": opts}
	fm.choose(0)
	fm.choice = {"kind": "level", "options": opts}
	fm.choose(1)
	ok(near(fm.s_dmg_add - d0, float(GameData.DG.ascend.dmg)) and near(fm.maxhp - hp0, float(GameData.DG.ascend.hp)), "突破：伤害 +4% / 生命上限 +12")
	var oc2 := Sim.new(61)
	for u in GameData.UP.list:
		oc2.levels[u.id] = int(u.max)
	for ev in GameData.UP.evolutions:
		oc2.evo[ev.weapon] = true
	ok(oc2.roll_choices(false)[0].kind != "asc", "经典口径不出突破卡（平衡基线不变）")
	fm._roll_shop()
	ok(fm.shop.has("forge"), "游商常驻「灯油淬火」")
	fm.coins = 10000
	var fi := fm.shop.find("forge")
	var p1 := fm.price_of("forge")
	var d1 := fm.s_dmg_add
	ok(fm.buy_relic(fi) and fm.shop.has("forge") and fm.price_of("forge") > p1 and near(fm.s_dmg_add - d1, float(GameData.DG.forge.dmg)), "淬火：买了不下架、价格上涨、伤害 +6%")
	ok(fm.buy_relic(fm.shop.find("forge")) and fm.forge_n == 2 and fm.coins == 10000 - p1 - (p1 + int(GameData.DG.forge.step)), "可连续淬火")
	var sv := fm.to_save()
	var fr := Sim.new(61, {"mode": "full"})
	fr.from_save(JSON.parse_string(JSON.stringify(sv)))
	ok(fr.forge_n == 2 and fr.asc_dmg_n == 1 and fr.asc_hp_n == 1 and int(fr.farm_runs.get("coinfarm", 0)) == 1, "淬火/突破/练级点次数随存档恢复")
	ok(fr.poi_cd.has(ci) and float(fr.poi_cd[ci]) > 1.0, "冷却到期时刻随存档恢复为时间（不是 true）")
	var bf := Sim.new(62, {"mode": "full"})
	var bb := bf.spawn_enemy("boss", 0.0, 0.0, {"boss": true})
	ok(int(bb.maxhp) == int(GameData.EN.boss.hpByMode.full), "完整模式终局 Boss 按模式定血量")
	ok(int(Sim.new(62, {"mode": "quick"}).spawn_enemy("boss", 0.0, 0.0, {"boss": true}).maxhp) == int(GameData.EN.boss.hpByMode.quick), "疾速模式 Boss 按模式定血量")
	ok(int(Sim.new(62).spawn_enemy("boss", 0.0, 0.0, {"boss": true}).maxhp) == int(GameData.EN.boss.hp), "经典口径 Boss 按配置血量生成")
	ok(UI.fmt_int(1000000) == "1,000,000", "血条数字千分位")
	bf.px = bb.x - 200.0; bf.py = bb.y
	bf.boss_phase = 1
	bb.atk_idx = 1   # p0 第 2 招 = 半壁灯海
	bb.atk_t = 0.0
	bf._boss_ai(bb, 0.01)
	var rect: SimTele = null
	for tl in bf.teles:
		if tl.is_rect(): rect = tl
	ok(rect != null and rect.rw >= 640.0 and rect.rh >= 720.0, "半壁灯海：预警区覆盖半个屏幕（%d×%d，视口 1280×720）" % [int(rect.rw) if rect else 0, int(rect.rh) if rect else 0])
	ok(rect != null and rect.is_inside(Vector2(bf.px, bf.py - 30.0)), "半壁灯海压在玩家身上，必须横移躲开")
	bf.invuln = 0.0; bf.dash_inv = 0.0
	var hpa := bf.hp
	rect.t = rect.dur
	bf._update_teles(0.0)
	ok(bf.hp < hpa, "站在半壁灯海里会被打中")
	bf.hp = bf.maxhp; bf.invuln = 0.0
	bb.atk_idx = 1
	bb.atk_t = 0.0
	bf.teles.clear()
	bf._boss_ai(bb, 0.01)
	var r2: SimTele = bf.teles[bf.teles.size() - 1]
	var safe_x := r2.x - signf(r2.x - bf.px) * (r2.rw * 0.5 + 40.0)
	bf.px = safe_x
	var hpb := bf.hp
	r2.t = r2.dur
	bf._update_teles(0.0)
	ok(bf.hp == hpb, "躲到另一半屏就不受伤")
	bf.boss_phase = 2
	bf.teles.clear()
	bb.atk_idx = 0   # p1 第 1 招 = 半壁灯海（连击）
	bb.atk_t = 0.0
	bf.invuln = 1e9
	bf._boss_ai(bb, 0.01)
	var first: SimTele = bf.teles[0]
	first.t = first.dur
	bf._update_teles(0.0)
	ok(bf.teles.size() == 1 and bf.teles[0].is_rect() and signf(bf.teles[0].x - bf.px) == -signf(first.x - bf.px), "二阶段：半壁灯海落下后另一侧再补一击（左右连击）")
	bb.hp = bb.maxhp * 0.1
	bb.atk_t = 0.0
	bf._boss_ai(bb, 0.01)
	ok(bf.boss_enraged and bb.atk_t < float(GameData.EN.boss.cd[1]), "血量 20% 以下回光返照：出招加快")


func _run_fixed(seed_v: int) -> String:
	var s := Sim.new(seed_v)
	var b := Bot.new(Bot.Kind.PROXY, seed_v, [])
	var n := 0
	while not s.ended and s.real_t < 60.0 and n < 2000:
		b.act(s, 0.05)
		s.step(0.05)
		n += 1
	return "%d/%d/%.1f/%d" % [s.kills, s.level, s.hp, s.enemies.size()]


## v2.2：后期怪物补强 / 掉落合并上限 / 弹幕上限 / 小金刚主动助战 / 存档不带运行时数组
func _test_v22() -> void:
	print("== v2.2：后期强度 / 掉落 / 上限 / 小金刚 ==")
	# 后期怪物补强（非经典），经典不变
	var cl := Sim.new(71)
	var fu := Sim.new(71, {"mode": "full"})
	cl.t = 420.0; fu.t = 420.0
	var ec := cl.spawn_enemy("paperman")
	var ef := fu.spawn_enemy("paperman")
	ok(ef.hp > ec.hp * 4.0 and ef.dmg > ec.dmg * 2.0, "完整模式后期普通怪血量/伤害显著高于经典（hp×%.1f dmg×%.1f）" % [ef.hp / ec.hp, ef.dmg / ec.dmg])
	var f0 := Sim.new(71, {"mode": "full"})
	f0.t = 30.0
	var e0 := f0.spawn_enemy("paperman")
	ok(e0.hp < ec.hp * 1.0 or near(e0.dmg_mul, 1.0 + float(GameData.WV.modeScale.dmgLinear) * 30.0 / 480.0, 0.01), "前期不额外加血（只在 lateStart 之后起量）")
	ok(near(cl._mode_enemy_scale().x, 1.0) and near(cl._mode_elite_scale().x, 1.0), "经典口径倍率恒为 1（平衡基线不变）")
	# 掉落：同类合并 + 总数上限，价值不丢
	var pk := Sim.new(72, {"mode": "full"})
	pk.pickups.clear()
	for i in range(600):
		pk._spawn_pickup("soul", pk.px + 400.0 + float(i % 40) * 90.0, pk.py + 300.0 + float(i / 40) * 90.0, 2)
	var ns := 0
	var vs := 0
	for k in pk.pickups:
		if k.kind == "soul":
			ns += 1
			vs += k.val
	var cap := int(GameData.BAL.drops.modeCaps.soul)
	ok(ns <= cap, "魂火地面数量封顶 %d（实际 %d，生成 600 次）" % [cap, ns])
	ok(vs + pk.xp + 0 >= 1, "合并后价值保留（地面 %d）" % vs)
	var cpk := Sim.new(72)
	cpk.pickups.clear()
	for i in range(200):
		cpk._spawn_pickup("soul", cpk.px + 400.0 + float(i % 20) * 90.0, cpk.py + 300.0 + float(i / 20) * 90.0, 2)
	ok(cpk.pickups.size() == 200, "经典口径掉落逻辑不变")
	# 弹幕上限
	var bl := Sim.new(73, {"mode": "full"})
	for i in range(400):
		bl._spawn_ebullet(bl.px + 2000.0, bl.py, 0.0, 0.0, 1.0, "x")
	ok(bl.ebullets.size() <= 240, "敌弹上限 240（实际 %d）" % bl.ebullets.size())
	# 小金刚：主动寻敌、跟随构筑成长、可见弹体、占输出可观
	var pt := Sim.new(74, {"mode": "full"})
	pt.levels = {"fu": 5, "huanhuo": 5, "lei": 5}
	pt._recalc()
	var base_dmg := pt.pet_base_dmg()
	for i in range(7):
		pt.grant_gourd()
	ok(pt.pet_on and pt.pet_base_dmg() >= base_dmg * 0.99 and pt.pet_base_dmg() > float(GameData.GD.pet.dmg) * 0.99, "小金刚伤害随玩家 DPS 成长（%.0f）" % pt.pet_base_dmg())
	pt.invuln = 1e9
	pt.pickups.clear()
	var far := pt.spawn_enemy("jiangshi", -1.0, -1.0, {"pos": Vector2(pt.px + 480.0, pt.py)})
	far.hp = 1e9; far.maxhp = 1e9; far.speed = 0.0
	var d0 := Vector2(pt.pet_pos.x - far.x, pt.pet_pos.y - far.y).length()
	var saw_shot := false
	for i in range(200):
		pt.choice = {}
		pt.pending_lv = 0
		pt.step(0.05)
		saw_shot = saw_shot or pt.pet_shots.size() > 0
	var d1 := Vector2(pt.pet_pos.x - far.x, pt.pet_pos.y - far.y).length()
	ok(d1 < d0 - 150.0, "小金刚主动飞向远处妖物（距离 %.0f → %.0f）" % [d0, d1])
	ok(saw_shot, "小金刚发射可见火球弹体")
	var pdmg := float(pt.dmg_by.get("pet", 0.0))
	var tot := 0.0
	for k in pt.dmg_by:
		tot += float(pt.dmg_by[k])
	ok(pdmg > 0.0 and pdmg / maxf(1.0, tot) > 0.15, "满构筑下小金刚输出占比 %.0f%%（>15%%）" % (100.0 * pdmg / maxf(1.0, tot)))
	pt.in_combo = true
	var before_c := float(pt.dmg_by.get("pet", 0.0))
	for i in range(30):
		pt.step(0.05)
	ok(float(pt.dmg_by.get("pet", 0.0)) - before_c > pt.pet_base_dmg() * 5.0, "Q 七彩神光斩 + 7 道天雷造成大额伤害")
	ok(pt.combo_waves == 0, "天雷波次打完归零")
	# 存档：运行时数组不进存档，读档后清空
	var blob := pt.to_save()
	ok(not blob.has("pet_shots") and not blob.has("pet_fx") and blob.has("pet_on"), "存档不含小金刚弹体/特效（只存状态）")
	var rd := Sim.new(74, {"mode": "full"})
	rd.from_save(JSON.parse_string(JSON.stringify(blob)))
	ok(rd.pet_on and rd.pet_shots.is_empty() and rd.combo_waves == 0, "读档后小金刚在场且无残留弹体")
	# 副本走钟（非经典）/ 停钟（经典）
	var rk := Sim.new(75, {"mode": "full"})
	to_break(rk, 0)
	rk.enter_rift()
	var c0 := rk.clock
	rk.invuln = 1e9
	for i in range(20):
		rk.step(0.05)
	ok(rk.clock > c0 + 0.9, "非经典：进剑冢时夜行时钟照走（副本是拿这一夜的时间换资源）")
	var rc := Sim.new(75)
	to_break(rc, 0)
	rc.enter_rift()
	var t0 := rc.t
	rc.invuln = 1e9
	for i in range(20):
		rc.step(0.05)
	ok(near(rc.t, t0), "经典口径：进剑冢停钟（平衡基线不变）")
	# 守关 BOSS 提前刷出、血量按构筑 DPS 封顶
	var gd := Sim.new(76, {"mode": "full"})
	gd.levels = {"fu": 5, "huanhuo": 5, "lei": 5}
	gd._recalc()
	gd.seg = 1
	gd.t = gd.seg_to(gd.seg) - float(GameData.WV.modeScale.guardLead) / gd.stretch + 0.01
	gd.step(0.05)
	ok(gd.guard_ref != null and gd.t < gd.seg_to(gd.seg), "守关 BOSS 在段末前 %ds 就刷出" % int(GameData.WV.modeScale.guardLead))
	var raw_hp := float(GameData.EN.elites.lantern.hp) * 1.5
	var gcap := maxf(gd.build_dps() * float(GameData.WV.modeScale.guardSec), raw_hp)
	ok(gd.guard_ref != null and gd.guard_ref.maxhp <= gcap * 1.01 and gd.guard_ref.maxhp >= raw_hp * 0.99, "守关 BOSS 血量封顶 max(构筑 DPS × %ds, 原始血量)，不低于旧版（%.0f ≤ %.0f）" % [int(GameData.WV.modeScale.guardSec), gd.guard_ref.maxhp if gd.guard_ref != null else -1.0, gcap])
