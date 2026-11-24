// v3.6 全面系统与打击感无头单元测试：
// 1) 挨打升级 + 挨打练体 5 阶里程碑 + 反伤/受击回血/金钟震波 + 挨打房快速射箭 (`enterTemper`)
// 2) 挨打成长神装（龙鳞铠甲 & 的卢马）受击升阶与不可出售保护
// 3) 上古神器（女娲石/东皇钟/伏羲琴/盘古斧）+ silence 沉默状态
// 4) 青龙 4 件套连锁闪电 + 召唤「武圣·关羽」（独立 summon，TTL 消散，同秘境自动索敌）
// 5) 项羽（霸王）/ 刑天（战神）/ 吕布（无双）2/4 件套属性与触发 + 3 件新神兵配方
// 6) 南华仙人金币强化（+0 -> +15）与四重金币渡劫飞升
// 7) 四圣兽与项羽/刑天开局不限波数 + 梯度重做 + 自适应难度与高收益递进
// 8) 20× 怪物波次数量（第 1 波 ~200 怪）与波数攻血护甲成长
// 9) game-feel 无头校验（重叠 30ms hit-stop 精准恢复 simScale=1.0、trauma 在 1/decay 内归零、静止振幅归零、WCAG 闪光保护）
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, BAL } from '../../src/guard/sim/Sim.js';
import { ITEMS, SLOTS, itemMods, setCounts } from '../../src/guard/sim/systems/loot.js';
import { RECIPES } from '../../src/guard/sim/systems/craft.js';
import { createGameFeel, DEFAULT_DECAY, computeShakeOffset, stepTrauma } from '../../src/guard/render/gameFeel.js';
import RD from '../../src/guard/data/realms.json' with { type: 'json' };

const mk = (seed = 360, opts = {}) => new Sim({ seed, heroId: opts.heroId || 'huoqing', mode: opts.mode || 'story', fx: true, ...opts });

function wear(s, u, items) {
  for (const it of items) {
    assert.ok(s.loot.give(it));
    const idx = s.inv.equipBag.indexOf(it);
    assert.ok(idx >= 0);
    assert.ok(s.command({ type: 'equip', bagIdx: idx, unitId: u.id }).ok);
  }
}

test('挨打升级 + 挨打练体 5 阶里程碑 + 反伤 + 回血 + 金钟震波 + 挨打房快速射箭', () => {
  const s = mk(1);
  s.wave.nextAt = 1e9;
  const h = s.hero;
  h.invuln = 0;
  h.shield = 0;
  const mob = s.spawnEnemy('paperman', h.x + 70, h.y, { hpMul: 800 });
  mob.spd = 0; mob.atk = 0;

  // 1) 同帧高频伤害严格受 0.06s 节流保护，隔 >=0.06s 每次挨打直接加 XP 升级与大招充能
  const lv0 = h.lv;
  const e0 = h.energy;
  s.damage(mob, h, 5, { canCrit: false });
  s.damage(mob, h, 5, { canCrit: false }); // 同帧重复命中应被节流
  assert.equal(s.temper.hits, 1, '同帧两次命中只计 1 次挨打');
  assert.ok(s.temper.xpGained >= 4);
  assert.ok(h.energy >= e0 + 2, '挨打直接获得大招能量');

  // 模拟受击 35 次 → 英雄直接挨打升级 + 解锁 30 击【皮糙肉厚】(+100 铜钱)
  const copper0 = s.copper;
  let m1 = null;
  s.on('temperMilestone', (ev) => { m1 = ev; });
  for (let i = 1; i < 35; i++) {
    s.advance(0.08);
    h.hp = h.maxHp;
    s.damage(mob, h, 5, { canCrit: false });
  }
  assert.equal(s.temper.hits, 35);
  assert.ok(h.lv > lv0, `挨打直接升级 Lv.${lv0} -> Lv.${h.lv}`);
  assert.ok(m1 && m1.milestone.name === '皮糙肉厚', '30 次挨打突破【皮糙肉厚】');
  assert.equal(s.copper, copper0 + 100, '【皮糙肉厚】发放 100 铜钱');

  // 2) 推至 100 击解锁【铜皮铁骨】（反伤射线 thornsRay + 反伤伤害）
  for (let i = 35; i < 100; i++) {
    s.advance(0.08);
    h.hp = h.maxHp;
    s.damage(mob, h, 5, { canCrit: false });
  }
  assert.equal(s.temper.currentTitle, '铜皮铁骨');
  assert.equal(s.temper.thorns, 0.15);
  const mobHpBefore = mob.hp;
  s.fx.length = 0;
  s.advance(0.08);
  h.hp = h.maxHp;
  s.damage(mob, h, 20, { canCrit: false });
  assert.ok(mob.hp < mobHpBefore, '铜皮铁骨反伤命中攻击者');
  assert.ok(s.fx.some((f) => f.t === 'thornsRay'), '反伤推送 thornsRay 特效');

  // 3) 推至 250 击解锁【金钟罩体】（受击回血 + 0.5s cd）
  for (let i = 101; i < 250; i++) {
    s.advance(0.08);
    h.hp = h.maxHp;
    s.damage(mob, h, 5, { canCrit: false });
  }
  assert.equal(s.temper.currentTitle, '金钟罩体');
  assert.ok(s.temper.hitHealPct >= 0.015);
  s.advance(0.6);
  h.hp = h.maxHp * 0.5;
  const hpPre = h.hp;
  s.damage(mob, h, 2, { canCrit: false });
  assert.ok(h.hp > hpPre, `金钟罩体受击回血 (${hpPre} -> ${h.hp})`);

  // 4) 推至 500 击解锁【金刚不坏】（每 15 击金钟震荡波） & 1000 击【万劫不灭体】
  for (let i = 251; i < 510; i++) {
    s.advance(0.08);
    h.hp = h.maxHp;
    s.damage(mob, h, 5, { canCrit: false });
  }
  assert.equal(s.temper.currentTitle, '金刚不坏');
  assert.equal(s.temper.novaEvery, 15);
  const pack = s.spawnEnemy('paperman', h.x + 120, h.y, { hpMul: 800 });
  pack.spd = 0; pack.atk = 0;
  s.step();
  const packHp0 = pack.hp;
  s.fx.length = 0;
  // 推进到下一个 15 的倍数（525）触发 goldenNova
  for (let i = 510; i < 525; i++) {
    s.advance(0.08);
    h.hp = h.maxHp;
    s.damage(mob, h, 5, { canCrit: false });
  }
  assert.ok(s.fx.some((f) => f.t === 'goldenNova'), '触发金钟震荡波 goldenNova');
  assert.ok(pack.hp < packHp0, '金钟震荡波伤害周围敌人');

  for (let i = 525; i < 1000; i++) {
    s.advance(0.08);
    h.hp = h.maxHp;
    s.damage(mob, h, 5, { canCrit: false });
  }
  assert.equal(s.temper.currentTitle, '万劫不灭体');
  assert.equal(s.temper.novaEvery, 10);
  assert.ok(s.temper.bonus.maxHp >= 12000 + 5000 + 2200 + 900 + 300);

  // 校验 dmgTaken 减伤上限已提升到 0.78
  h.base.dmgTaken = 0.9;
  s.markDirty(h);
  s.calcStats(h);
  assert.ok(Math.abs(h.stats.dmgTaken - 0.78) < 1e-6, `减伤上限提升至 0.78 (actual=${h.stats.dmgTaken})`);

  // 5) enterTemper 进入专属挨打房：箭傀快速射 g_arrow，英雄挂机挨打升级且绝不伤害孔明
  const s2 = mk(2);
  s2.wave.nextAt = 1e9;
  const kmHp0 = s2.kongming.hp;
  const enter = s2.command({ type: 'enterTemper' });
  assert.ok(enter.ok && enter.tier === 'temper', 'enterTemper 进入挨打房成功');
  assert.equal(s2.training.tier, 'temper');
  assert.equal(s2.hero.realm, 'training');
  const archers = s2.enemies.filter((e) => e.alive && e.training && e.trainingTier === 'temper');
  assert.ok(archers.length >= 4, '挨打房刷出练体箭傀');
  s2.advance(5.0);
  assert.ok(s2.projs.some((p) => p.tex === 'g_arrow') || s2.temper.hits >= 5, '箭傀快速射出 g_arrow 命中英雄');
  assert.ok(s2.temper.hits >= 10, `挨打房 5 秒快速累计挨打 ${s2.temper.hits} 次`);
  assert.ok(s2.hero.lv >= 2, `挨打房挂机挨打直接升级至 Lv.${s2.hero.lv}`);
  assert.equal(s2.kongming.hp, kmHp0, '挨打房绝不伤害孔明');
});

test('挨打成长神装（龙鳞铠甲 & 的卢马）：商店购买开匣、受击自动升阶、不可出售', () => {
  const s = mk(3);
  s.wave.nextAt = 1e9;
  s.copper = 1000;
  assert.ok(s.command({ type: 'buyItem', itemId: 'growth_dragonscale_box' }).ok);
  assert.ok(s.command({ type: 'buyItem', itemId: 'growth_dilu_box' }).ok);
  const dIdx = s.inv.itemBag.findIndex((x) => x && x.id === 'growth_dragonscale_box');
  assert.ok(s.command({ type: 'useItem', itemIdx: dIdx }).ok);
  const mIdx = s.inv.itemBag.findIndex((x) => x && x.id === 'growth_dilu_box');
  assert.ok(s.command({ type: 'useItem', itemIdx: mIdx }).ok);

  const dsIdx = s.inv.equipBag.findIndex((x) => x && x.growthId === 'dragonscale');
  const dlIdx = s.inv.equipBag.findIndex((x) => x && x.growthId === 'dilu');
  assert.ok(dsIdx >= 0 && dlIdx >= 0, '开启礼盒获得龙鳞铠甲与的卢马');
  const ds = s.inv.equipBag[dsIdx];
  const dl = s.inv.equipBag[dlIdx];
  assert.equal(ds.growthType, 'hits');
  assert.equal(dl.growthType, 'hits');
  assert.equal(s.command({ type: 'sell', bagIdx: dsIdx }).ok, false, '龙鳞铠甲唯一不可出售');

  assert.ok(s.command({ type: 'equip', bagIdx: dsIdx, unitId: s.hero.id }).ok);
  assert.ok(s.command({ type: 'equip', bagIdx: s.inv.equipBag.indexOf(dl), unitId: s.hero.id }).ok);

  const hp1 = s.hero.maxHp;
  const spd1 = s.hero.stats.spd;
  const mob = s.spawnEnemy('paperman', s.hero.x + 60, s.hero.y, { hpMul: 500 });
  mob.spd = 0; mob.atk = 0;

  let hitUps = 0;
  s.on('growthLevelUp', (ev) => { if (ev.growthType === 'hits') hitUps++; });
  for (let i = 0; i < 20; i++) {
    s.advance(0.08);
    s.hero.hp = s.hero.maxHp;
    s.damage(mob, s.hero, 5, { canCrit: false });
  }
  assert.equal(ds.hitsTaken, 20);
  assert.equal(ds.stage, 2, '龙鳞铠甲挨打 20 次升至 2 阶');
  assert.equal(dl.stage, 2, '的卢马挨打 20 次升至 2 阶');
  assert.ok(hitUps >= 2, '触发两次 growthLevelUp (hits)');
  assert.ok(s.hero.maxHp > hp1 && s.hero.stats.spd > spd1, '升阶后生命与移速明显提高');
});

test('上古神器（女娲石/东皇钟/伏羲琴/盘古斧）与 silence 沉默状态闭环', () => {
  // 1) 女娲石：致命伤拦截复活（满血+2.5s无敌+群疗+45s冷却）
  const s = mk(4);
  s.wave.nextAt = 1e9;
  const nuwa = s.loot.roll({ artifactId: 'nuwa_stone' });
  assert.ok(nuwa && nuwa.artifact);
  wear(s, s.hero, [nuwa]);
  s.kongming.hp = s.kongming.maxHp * 0.5;
  const kmBefore = s.kongming.hp;
  let artEv = null;
  s.on('artifactProc', (ev) => { artEv = ev; });

  s.damage(null, s.hero, 1e9, { canCrit: false });
  assert.equal(s.hero.alive, true, '女娲石拦截致命伤原地复活');
  assert.equal(s.hero.hp, s.hero.maxHp, '女娲石满血复活');
  assert.ok(s.hero.invuln >= 2.4, '女娲石复活后获得 2.5s 无敌');
  assert.ok(s.kongming.hp > kmBefore, '女娲石复活同时治疗孔明');
  assert.ok(artEv && artEv.artifact === 'nuwa_stone' && artEv.kind === 'revive');
  assert.ok(s.fx.some((f) => f.t === 'nuwaRevive'));

  // 冷却中再次致命伤正常阵亡
  s.hero.invuln = 0;
  s.damage(null, s.hero, 1e9, { canCrit: false });
  assert.equal(s.hero.alive, false, '45 秒冷却期间不重复触发复活');

  // 2) 东皇钟（群体沉默 + 护盾）+ 伏羲琴（群体治疗 + 加速）+ 盘古斧（普攻沉默斩）+ BOSS 沉默禁放技能
  const s2 = mk(5);
  s2.wave.nextAt = 1e9;
  const bell = s2.loot.roll({ artifactId: 'donghuang_bell' });
  const axe = s2.loot.roll({ artifactId: 'pangu_axe' });
  wear(s2, s2.hero, [bell, axe]);

  // 在第 10 波刷出老祖 BOSS，验证沉默禁止施放技能（不产生预警圈）
  s2.wave.n = 9;
  s2.wave.nextAt = s2.t;
  s2.step();
  const boss = s2.enemies.find((e) => e.boss === 'laozu');
  assert.ok(boss);
  boss.x = s2.hero.x + 120; boss.y = s2.hero.y;
  s2.step();
  s2.advance(10.2); // 触发东皇钟震响
  assert.ok(s2.hero.shield > 0, '东皇钟获得护盾');
  assert.ok(s2.fx.some((f) => f.t === 'donghuangSilence'), '东皇钟推送 donghuangSilence');
  assert.ok(boss.st.silence > 0, '东皇钟沉默 BOSS');
  // 持续保持沉默验证不产生任何敌方预警圈
  s2.zones = s2.zones.filter((z) => z.side !== 'enemy');
  s2.applyStatus(boss, 'silence', 15);
  s2.advance(4);
  assert.equal(s2.zones.some((z) => z.alive && z.vis === 'warn' && z.side === 'enemy'), false, '沉默期间 BOSS 禁止施放技能');

  // 伏羲琴：8 秒群疗 + fuxi_melody 加速增益
  const s3 = mk(6);
  s3.wave.nextAt = 1e9;
  wear(s3, s3.hero, [s3.loot.roll({ artifactId: 'fuxi_qin' })]);
  s3.hero.hp = s3.hero.maxHp * 0.5;
  s3.kongming.hp = s3.kongming.maxHp * 0.5;
  const spd0 = s3.hero.stats.spd;
  s3.advance(8.2);
  assert.ok(s3.hero.hp > s3.hero.maxHp * 0.55 && s3.kongming.hp > s3.kongming.maxHp * 0.5, '伏羲琴群疗英雄与孔明');
  assert.ok(s3.hero.buffs.some((b) => b.id === 'fuxi_melody') && s3.hero.stats.spd > spd0, '伏羲琴赋予移速攻速增益');
  assert.ok(s3.fx.some((f) => f.t === 'fuxiHeal'), '伏羲琴推送 fuxiHeal');

  // 盘古斧：普攻多次必触发沉默与 AoE（deterministic seed）
  const s4 = mk(7);
  s4.wave.nextAt = 1e9;
  wear(s4, s4.hero, [s4.loot.roll({ artifactId: 'pangu_axe' })]);
  const dummy = s4.spawnEnemy('jiangshi', s4.hero.x + 70, s4.hero.y, { hpMul: 800 });
  dummy.spd = 0; dummy.atk = 0;
  s4.step();
  let panguProcs = 0;
  s4.on('artifactProc', (ev) => { if (ev.artifact === 'pangu_axe') panguProcs++; });
  for (let i = 0; i < 30 && panguProcs === 0; i++) {
    s4.hitBasic(s4.hero, dummy, 10);
  }
  assert.ok(panguProcs >= 1 && dummy.st.silence > 0, '盘古斧普攻触发破甲沉默斩');

  // 配方表包含 5 件上古神器（含轩辕剑）与 3 件新套装神兵，共 14 件
  assert.equal(RECIPES.legendaries.length, 14);
});

test('青龙 4 件套触发连锁闪电 + 召唤「武圣·关羽」（独立 summon，TTL 消散，自动索敌）', () => {
  const s = mk(8);
  s.wave.nextAt = 1e9;
  const qlPieces = SLOTS.map((slot) => s.loot.roll({ slot, set: 'qinglong', q: 3, wave: 10 }));
  wear(s, s.hero, qlPieces);
  assert.deepEqual(s.activeSets(s.hero), ['惊雷4']);

  const e1 = s.spawnEnemy('jiangshi', s.hero.x + 80, s.hero.y, { hpMul: 1000 });
  const e2 = s.spawnEnemy('jiangshi', s.hero.x + 150, s.hero.y, { hpMul: 1000 });
  e1.spd = 0; e1.atk = 0; e2.spd = 0; e2.atk = 0;
  s.step();

  let guanyuEv = null;
  let jingleiTriggered = false;
  s.on('setProc', (ev) => {
    if (ev.set === 'qinglong' && ev.summon === 'guanyu') guanyuEv = ev;
    if (ev.set === 'qinglong' && !ev.summon) jingleiTriggered = true;
  });

  const partyBefore = s.party.length;
  for (let i = 0; i < 40 && (!guanyuEv || !jingleiTriggered); i++) {
    s.hitBasic(s.hero, e1, 20);
  }
  assert.ok(jingleiTriggered, '青龙 4 件套仍触发连锁闪电');
  assert.ok(s.stats.dmgBy['hero:huoqing/jinglei'] > 0, '连锁闪电造成伤害');
  assert.ok(guanyuEv && guanyuEv.summonUnit, '青龙 4 件套召唤【武圣·关羽】');

  const gy = guanyuEv.summonUnit;
  assert.equal(gy.kind, 'summon');
  assert.equal(gy.key, 'guanyu');
  assert.equal(s.party.length, partyBefore, '召唤物不占用 party 席位');
  assert.ok(s.fx.some((f) => f.t === 'guanyuSummon'));

  // 关羽自动靠近并攻击敌人
  const hpBefore = e1.hp + e2.hp;
  s.advance(4);
  assert.ok(e1.hp + e2.hp < hpBefore, '武圣·关羽自动攻击周围敌人');

  // TTL（14s）到期后干净消散
  let despawned = false;
  s.on('unitDespawn', (u) => { if (u === gy) despawned = true; });
  s.advance(11);
  assert.equal(gy.alive, false, '关羽召唤时间到期后消散');
  assert.equal(despawned, true, '触发 unitDespawn 事件');
});

test('项羽 / 刑天 / 吕布 2/4 件套属性与触发 + 3 件新神兵配方锻造', () => {
  // 1) 霸王（项羽）2/4 件套
  const s1 = mk(9);
  s1.wave.nextAt = 1e9;
  const h1 = s1.hero;
  const baseAtk1 = h1.stats.atk;
  const baseHp1 = h1.maxHp;
  const baseSk1 = h1.stats.skillDmg;
  const xyPieces = SLOTS.map((slot) => {
    const it = s1.loot.roll({ slot, set: 'xiangyu', q: 2, wave: 5 });
    it.main = { stat: 'def', add: 0 };
    it.subs = [];
    return it;
  });
  wear(s1, h1, xyPieces.slice(0, 2));
  assert.ok(Math.abs(h1.stats.atk - baseAtk1 * 1.2) < 1e-6, '霸王 2 件攻击 +20%');
  assert.equal(h1.maxHp, Math.round(baseHp1 * 1.15), '霸王 2 件生命 +15%');
  wear(s1, h1, xyPieces.slice(2));
  assert.ok(Math.abs(h1.stats.skillDmg - (baseSk1 + 0.35)) < 1e-6, '霸王 4 件技能伤害 +35%');
  const e1 = s1.spawnEnemy('jiangshi', h1.x + 80, h1.y, { hpMul: 800 });
  e1.spd = 0; e1.atk = 0;
  s1.step();
  let bwProc = false;
  s1.on('setProc', (ev) => { if (ev.skill === 'bawangSlam') bwProc = true; });
  for (let i = 0; i < 40 && !bwProc; i++) {
    s1.advance(0.1);
    s1.damage(h1, e1, 20);
  }
  assert.ok(bwProc && s1.fx.some((f) => f.t === 'bawangSlam'), '霸王 4 件套触发 bawangSlam');

  // 2) 战神（刑天）2/4 件套
  const s2 = mk(10);
  s2.wave.nextAt = 1e9;
  const h2 = s2.hero;
  const baseDef2 = h2.stats.def;
  const baseHp2 = h2.maxHp;
  const xtPieces = SLOTS.map((slot) => {
    const it = s2.loot.roll({ slot, set: 'xingtian', q: 2, wave: 5 });
    it.main = { stat: 'atk', add: 0 };
    it.subs = [];
    return it;
  });
  wear(s2, h2, xtPieces.slice(0, 2));
  assert.ok(Math.abs(h2.stats.def - (baseDef2 + 28)) < 1e-6, '战神 2 件防御 +28');
  assert.ok(Math.abs(h2.stats.dmgTaken - 0.12) < 1e-6, '战神 2 件减伤 +12%');
  wear(s2, h2, xtPieces.slice(2));
  assert.equal(h2.maxHp, Math.round(baseHp2 * 1.30), '战神 4 件生命 +30%');
  const e2 = s2.spawnEnemy('jiangshi', h2.x + 80, h2.y, { hpMul: 800 });
  e2.spd = 0; e2.atk = 0;
  s2.step();
  let xtProc = false;
  s2.on('setProc', (ev) => { if (ev.skill === 'xingtianRoar') xtProc = true; });
  h2.hp = h2.maxHp * 0.5;
  for (let i = 0; i < 30 && !xtProc; i++) {
    s2.advance(0.1);
    s2.damage(e2, h2, 5, { canCrit: false });
  }
  assert.ok(xtProc && s2.fx.some((f) => f.t === 'xingtianRoar'), '战神 4 件套受击触发 xingtianRoar');

  // 3) 无双（吕布）2/4 件套
  const s3 = mk(11);
  s3.wave.nextAt = 1e9;
  const h3 = s3.hero;
  const baseCrit3 = h3.stats.crit;
  const baseCd3 = h3.stats.critDmg;
  const baseAspd3 = h3.stats.aspd;
  const baseDmg3 = h3.stats.dmg;
  const lbPieces = SLOTS.map((slot) => {
    const it = s3.loot.roll({ slot, set: 'lvbu', q: 2, wave: 5 });
    it.main = { stat: 'def', add: 0 };
    it.subs = [];
    return it;
  });
  wear(s3, h3, lbPieces.slice(0, 2));
  assert.ok(Math.abs(h3.stats.crit - (baseCrit3 + 0.14)) < 1e-6, '无双 2 件暴击 +14%');
  assert.ok(Math.abs(h3.stats.critDmg - baseCd3 * 1.35) < 1e-6, '无双 2 件暴伤 +35%');
  wear(s3, h3, lbPieces.slice(2));
  assert.ok(Math.abs(h3.stats.aspd - baseAspd3 * 1.25) < 1e-6, '无双 4 件攻速 +25%');
  assert.ok(Math.abs(h3.stats.dmg - (baseDmg3 + 0.20)) < 1e-6, '无双 4 件伤害 +20%');
  const e3 = s3.spawnEnemy('jiangshi', h3.x + 80, h3.y, { hpMul: 800 });
  e3.spd = 0; e3.atk = 0;
  s3.step();
  let lbProc = false;
  s3.on('setProc', (ev) => { if (ev.skill === 'lvbuSlash') lbProc = true; });
  h3.hp = h3.maxHp * 0.6;
  for (let i = 0; i < 30 && !lbProc; i++) {
    s3.advance(0.1);
    s3.hitBasic(h3, e3, 20);
  }
  assert.ok(lbProc && s3.fx.some((f) => f.t === 'lvbuSlash'), '无双 4 件套普攻触发 lvbuSlash');

  // 4) 3 件新名将神兵配方可正常锻造（霸王破阵枪 / 刑天干戚斧 / 吕布无双戟）
  s3.copper = 5000;
  s3.inv.equipBag.fill(null);
  for (const [id, m1, m2] of [
    ['bawang_pozhunqiang', ['weapon', 3], ['armor', 2]],
    ['xingtian_ganqifu', ['weapon', 3], ['armor', 2]],
    ['lvbu_wushuangji', ['weapon', 3], ['accessory', 2]],
  ]) {
    s3.loot.give(s3.loot.roll({ slot: m1[0], q: m1[1], wave: 12 }));
    s3.loot.give(s3.loot.roll({ slot: m2[0], q: m2[1], wave: 8 }));
    const res = s3.command({ type: 'craftRecipe', recipeId: id });
    assert.ok(res.ok, `成功锻造新神兵 ${id}`);
    assert.ok(res.item.tex.startsWith('g_eq_legend_'), `${id} 使用已加载的传说贴图`);
  }
});

test('南华仙人：金币强化 (+0 -> +15) 与四重金币渡劫飞升', () => {
  const s = mk(12);
  s.wave.nextAt = 1e9;
  assert.ok(s.nanhua && s.nanhua.x === 2260 && s.nanhua.y === 2140);
  const h = s.hero;
  const w = s.loot.roll({ slot: 'weapon', q: 3, wave: 10 });
  wear(s, h, [w]);
  const atkPreEnh = h.stats.atk;
  const baseMainAdd = w.main.add;

  // 钱不够时强化失败
  s.copper = 10;
  assert.equal(s.command({ type: 'enhanceEquip', unitId: h.id, slot: 'weapon' }).ok, false);

  // 充足铜钱连续强化 +0 -> +15
  s.copper = 50000;
  let enhEvents = 0;
  s.on('nanhuaEnhance', () => { enhEvents++; });
  for (let lv = 1; lv <= 15; lv++) {
    const r = s.command({ type: 'enhanceEquip', unitId: h.id, slot: 'weapon' });
    assert.ok(r.ok && r.enhanceLv === lv, `强化至 +${lv}`);
  }
  assert.equal(enhEvents, 15);
  assert.equal(s.command({ type: 'enhanceEquip', unitId: h.id, slot: 'weapon' }).ok, false, '+15 满级后不可继续强化');
  const scaledMain = itemMods(w)[0].add;
  assert.ok(Math.abs(scaledMain - baseMainAdd * (1 + 0.15 * 15)) < 1, '强化 +15 主属性按 +15%/级 放大');
  assert.ok(h.stats.atk > atkPreEnh + baseMainAdd * 2, '装备强化立即反映到英雄战斗属性');
  assert.ok(s.fx.some((f) => f.t === 'nanhuaFx' && f.kind === 'enhance'));

  // 支持对背包内未穿戴装备强化
  const bagArmor = s.loot.roll({ slot: 'armor', q: 2, wave: 5 });
  s.loot.give(bagArmor);
  const bagIdx = s.inv.equipBag.indexOf(bagArmor);
  assert.ok(s.command({ type: 'enhanceEquip', bagIdx }).ok);
  assert.equal(bagArmor.enhanceLv, 1);

  // 金币渡劫飞升（Lv.10/20/30/40 四重门槛检查与属性叠加）
  assert.equal(s.command({ type: 'ascendHero' }).ok, false, 'Lv.1 不可一重渡劫');
  s.gainXp(2000000); // 升至满级 Lv.50
  assert.ok(h.lv >= 40, `英雄升至 Lv.${h.lv}`);
  const atkBeforeAsc = h.stats.atk;
  const hpBeforeAsc = h.maxHp;
  let ascEvents = 0;
  s.on('nanhuaAscend', () => { ascEvents++; });
  for (let tier = 1; tier <= 4; tier++) {
    const r = s.command({ type: 'ascendHero' });
    assert.ok(r.ok && r.ascendLv === tier, `完成第 ${tier} 重渡劫`);
  }
  assert.equal(ascEvents, 4);
  assert.equal(s.command({ type: 'ascendHero' }).ok, false, '四重渡劫封顶后不可重复渡劫');
  assert.ok(h.stats.atk >= atkBeforeAsc + 900, '四重渡劫永久大幅提升攻击');
  assert.ok(h.maxHp >= hpBeforeAsc + 12000, '四重渡劫永久大幅提升生命');
  assert.ok(s.fx.some((f) => f.t === 'nanhuaFx' && f.big === true));
});

test('四圣兽秘境与山洞不限波数 + 原版固定高难度梯度（零膨胀 + 高阶固定高收益）', () => {
  const s = mk(13);
  s.wave.nextAt = 1e9;
  for (const id of ['xuanwu', 'baihu', 'zhuque', 'qinglong', 'xiangyu', 'xingtian']) {
    assert.equal(RD.realms[id].open, 0, `${id} 配置为 open=0`);
    assert.equal(s.realms.state[id], 'open', `${id} 开局第 1 波即可进`);
  }
  assert.equal(s.realms.state.qilin, 'locked', '隐藏麒麟秘境仍需清 3 秘境解锁');

  // 1) 固定高难度梯度（7 大秘境 tierMul / bossHp / bossAtk / copper / xp 严格递增；minQ/equipCount/bonusTomes 递进）
  const order = ['xuanwu', 'baihu', 'zhuque', 'qinglong', 'qilin', 'xiangyu', 'xingtian'];
  for (let i = 1; i < order.length; i++) {
    const prev = s.realms.getAdaptiveInfo(order[i - 1]);
    const cur = s.realms.getAdaptiveInfo(order[i]);
    assert.equal(cur.fixed, true);
    assert.equal(cur.adaptMul, 1);
    assert.ok(cur.tierMul > prev.tierMul, `tierMul 递增: ${prev.tierMul} -> ${cur.tierMul}`);
    assert.ok(cur.bossHp > prev.bossHp && cur.bossAtk > prev.bossAtk, `BOSS 固定强度递增: ${order[i - 1]} -> ${order[i]}`);
    assert.ok(cur.copper > prev.copper && cur.xp > prev.xp, `固定铜钱与经验收益递增: ${order[i - 1]} -> ${order[i]}`);
    assert.ok(cur.minQ >= prev.minQ && cur.equipCount >= prev.equipCount && cur.bonusTomes >= prev.bonusTomes);
  }
  const brLow = s.bossRoom.getAdaptiveInfo('low');
  const brMid = s.bossRoom.getAdaptiveInfo('mid');
  const brHigh = s.bossRoom.getAdaptiveInfo('high');
  assert.ok(brLow.bossHp < brMid.bossHp && brMid.bossHp < brHigh.bossHp);
  assert.ok(brLow.copper < brMid.copper && brMid.copper < brHigh.copper);
  assert.ok(brLow.xp < brMid.xp && brMid.xp < brHigh.xp);

  // 2) 零膨胀校验：推进到第 25 波、英雄满级 Lv.50、重刷 5 次，秘境/强盗山洞/BOSS房强度与收益均严格保持固定
  const rInfoLow = s.realms.getAdaptiveInfo('xuanwu');
  const bInfoLow = s.bandits.getAdaptiveInfo();
  assert.equal(rInfoLow.bossHp, 22000);
  assert.equal(rInfoLow.copper, 360);
  assert.equal(rInfoLow.xp, 320);
  assert.equal(bInfoLow.bossHp, 16000);
  assert.equal(bInfoLow.copper, 420);
  assert.equal(bInfoLow.xp, 300);
  assert.equal(brHigh.bossHp, 280000);
  assert.equal(brHigh.copper, 2000);

  s.wave.n = 25;
  s.gainXp(2000000);
  s.realms.clearCount.xuanwu = 5;
  s.bandits.clears = 5;
  s.bossRoom.clears = 5;

  const rInfoHi = s.realms.getAdaptiveInfo('xuanwu');
  const bInfoHi = s.bandits.getAdaptiveInfo();
  const brInfoHi = s.bossRoom.getAdaptiveInfo('high');
  assert.equal(rInfoHi.adaptMul, 1);
  assert.equal(rInfoHi.bossHp, rInfoLow.bossHp, '秘境 BOSS 血量不随波数/等级/重刷膨胀');
  assert.equal(rInfoHi.copper, rInfoLow.copper, '秘境铜钱不随波数膨胀');
  assert.equal(rInfoHi.xp, rInfoLow.xp, '秘境经验不随波数膨胀');
  assert.equal(bInfoHi.adaptMul, 1);
  assert.equal(bInfoHi.bossHp, bInfoLow.bossHp, '吕达血量不随波数/重刷膨胀');
  assert.equal(bInfoHi.copper, bInfoLow.copper, '山洞铜钱不随波数/重刷膨胀');
  assert.equal(brInfoHi.adaptMul, 1);
  assert.equal(brInfoHi.bossHp, brHigh.bossHp, 'BOSS房血量不随波数/重刷膨胀');

  // 3) 实际刷出项羽 BOSS 与吕达验证固定高难真实数值（波数 25 也不膨胀）与通关经验发放
  const s2 = mk(130);
  s2.wave.nextAt = 1e9;
  s2.wave.n = 25;
  const lvda = s2.bandits.getBoss();
  assert.ok(lvda && lvda.maxHp === 16000 && lvda.atk === 135, `吕达保持固定 16000 HP / 135 ATK (actual=${lvda?.maxHp}/${lvda?.atk})`);

  s2.command({ type: 'enterRealm', id: 'xiangyu' });
  for (let i = 0; i < 120 && !s2.realms.run.xiangyu?.boss; i++) {
    for (const e of s2.enemies) if (e.alive && e.realm === 'xiangyu' && !e.realmBoss) s2.kill(e, s2.hero);
    s2.advance(0.2);
  }
  const xyBoss = s2.enemies.find((e) => e.alive && e.realmBoss === 'xiangyu');
  assert.ok(xyBoss && xyBoss.maxHp === 340000 && xyBoss.atk === 820, `第25波进入项羽仍为固定 340000 HP / 820 ATK (actual=${xyBoss?.maxHp}/${xyBoss?.atk})`);
  const xpBefore = s2.hero.xp + s2.hero.lv * 1000;
  let rewardEv = null;
  s2.on('realmReward', (ev) => { rewardEv = ev; });
  s2.kill(xyBoss, s2.hero);
  assert.ok(rewardEv && rewardEv.fixed === true && rewardEv.xp === 2400 && rewardEv.copper === 2400 && rewardEv.tameable === false, '项羽通关发放固定高额奖励且仅刷装备不守家');
  assert.ok(s2.hero.xp + s2.hero.lv * 1000 > xpBefore, '英雄实际获得通关经验');
  assert.equal(s2.realms.getAdaptiveInfo('qinglong').bossHp, 120000);
  assert.equal(s2.realms.getAdaptiveInfo('qilin').bossHp, 200000);
  assert.equal(s2.realms.getAdaptiveInfo('xingtian').bossHp, 560000);
  assert.equal(s2.realms.getAdaptiveInfo('qinglong').tameable, true);
  assert.equal(s2.realms.getAdaptiveInfo('qilin').tameable, false);
  assert.equal(s2.realms.getAdaptiveInfo('xingtian').tameable, false);
});

test('20× 怪物波次数量（第 1 波 ~200 怪）与波数攻/血/护甲增长', () => {
  const s = mk(14);
  s.advance(9);
  assert.equal(s.wave.n, 1);
  assert.equal(s.wave.spawnTotal, 200, '第 1 波刷怪总数达到 200（20× 怪潮）');
  const w1Hp = s.wave.hpMul;
  const w1Atk = s.wave.atkMul;
  const w1Arm = s.wave.armorBonus;

  // 推进完成第 1 波刷怪周期（35s），校验能正常产出接近 200 只怪（含被击杀与在场）
  s.advance(36);
  const totalWave1Spawned = s.enemies.filter((e) => !e.realm).length + s.stats.kills;
  assert.ok(totalWave1Spawned >= 190, `第 1 波突增刷出 >=190 只妖物 (actual=${totalWave1Spawned})`);

  // 切到第 10 波验证数量与攻/血/护甲增长
  while (s.wave.n < 10) s.command({ type: 'callWave' });
  assert.equal(s.wave.spawnTotal, 200 + 44 * 9);
  assert.ok(s.wave.hpMul > w1Hp * 3.0, `第 10 波血量倍率显著成长 (${w1Hp} -> ${s.wave.hpMul})`);
  assert.ok(s.wave.atkMul > w1Atk * 1.9, `第 10 波攻击倍率显著成长 (${w1Atk} -> ${s.wave.atkMul})`);
  assert.ok(s.wave.armorBonus >= w1Arm + 19, `第 10 波护甲显著成长 (${w1Arm} -> ${s.wave.armorBonus})`);

  s.advance(1.5);
  const w10Mob = s.enemies.find((e) => !e.realm && e.wave === 10 && !e.boss);
  assert.ok(w10Mob && w10Mob.armor >= s.wave.armorBonus, '波次新怪正确应用护甲加成');
});

test('game-feel 无头断言：30ms 重叠 hit-stop 恢复 simScale=1.0、创伤 1/decay 归零、静止振幅归零、WCAG 闪光上限', async () => {
  const feel = createGameFeel(null, { settings: { shakeStrength: 0.8, reduceFlash: false, reduceCameraMotion: false } });

  // 1) 重叠 30ms 的 hit-stop 恢复 simScale = 1.0
  assert.equal(feel.hitStop(0.06, 0.05), true);
  assert.equal(feel.simScale, 0.05);
  assert.equal(feel.inHitStop, true);

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(feel.inHitStop, true, '30ms 时第一个 hit-stop 仍在持续');
  assert.equal(feel.hitStop(0.06, 0.05), true, '重叠 30ms 再次触发 hit-stop');
  const latestId = feel._hitStopId;
  assert.ok(latestId >= 2);

  await new Promise((r) => setTimeout(r, 45));
  // 此时第一个 60ms 定时器早已到点，但因为不是 latestId，不得提前解除第二次 hit-stop
  assert.equal(feel.inHitStop, true, '旧定时器不得提前恢复重叠中的新 hit-stop');

  await new Promise((r) => setTimeout(r, 55));
  assert.equal(feel.simScale, 1.0, '重叠 hit-stop 结束后精确恢复 simScale = 1.0');
  assert.equal(feel.inHitStop, false);

  // 2) trauma 在 1 / decay 秒内精确衰减至 0
  feel.addTrauma(1.0);
  assert.equal(feel.trauma, 1.0);
  const needSec = 1 / DEFAULT_DECAY;
  const steps = Math.ceil(needSec / 0.016) + 1;
  for (let i = 0; i < steps; i++) feel.update(0.016);
  assert.equal(feel.trauma, 0, `trauma 应在 1/decay (${needSec.toFixed(3)}s) 内归零`);
  assert.equal(feel.state.offsetX, 0);
  assert.equal(feel.state.offsetY, 0);
  assert.equal(feel.state.roll, 0);
  assert.equal(stepTrauma(0.5, 1 / (2 * DEFAULT_DECAY) + 0.001, DEFAULT_DECAY), 0);

  // 3) summed sines 静止态返回精确 0，有 trauma 时输出平滑有限值
  const rest = computeShakeOffset(0, 12.345, { strength: 1 });
  assert.deepEqual(rest, { offsetX: 0, offsetY: 0, roll: 0, shake: 0 });
  const active = computeShakeOffset(0.8, 1.5, { strength: 1 });
  assert.ok(Number.isFinite(active.offsetX) && Math.abs(active.offsetX) > 0);
  assert.ok(active.shake === 0.8 * 0.8);

  // 4) WCAG 2.3.1：1000ms 内最多 3 次闪屏
  assert.equal(feel.flashScreen(0xffffff, 0.2, 80), true);
  assert.equal(feel.flashScreen(0xffffff, 0.2, 80), true);
  assert.equal(feel.flashScreen(0xffffff, 0.2, 80), true);
  assert.equal(feel.flashScreen(0xffffff, 0.2, 80), false, '1000ms 内第 4 次闪屏被 WCAG 2.3.1 拦截');

  feel.destroy();
});
