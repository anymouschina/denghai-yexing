// v3.5 全新系统与守卫剑阁核心玩法闭环单元测试：
// 1) 左上角强盗营寨 + 敌方箭塔 + 吕达可重复悬赏任务
// 2) 霸王·项羽 & 战神·刑天终极秘境 + 全秘境可重复刷（首通唯一战魂/魂痕，重刷不重复掉唯一只掉高阶装备）
// 3) 西南猎人 NPC & 野狼可重复狩猎任务
// 4) 练功房经验速度下调 + 超出阶层软上限递减
// 5) 专属可重复刷 BOSS 房（初/中/高三阶切换、高阶装备+书卷掉落）
// 6) 成长性道具：藏经书店吃书永久加属性（买1本/连买5本）+ 杀敌成长型神兵（噬魂剑/镇夜成长灯自动升阶且不可出售）
// 7) 心魔镜像试炼（2倍/5倍/10倍镜像，累计永久 +30,000 战力飞升）
// 8) 经典魔兽 0 级技能学习（开局全 0 级未学，一级学一个，6 级学大招）+ 30 级觉醒技能
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import { cfg } from '../../src/guard/sim/kits/util.js';
import { PlayerBot } from './bot/player.mjs';
import RD from '../../src/guard/data/realms.json' with { type: 'json' };

const mk = (seed = 350, opts = {}) => new Sim({ seed, heroId: opts.heroId || 'huoqing', mode: 'story', fx: false, ...opts });

test('左上角强盗营寨 + 敌方箭塔 + 吕达可重复讨伐任务闭环', () => {
  const s = mk(1);
  s.wave.nextAt = 1e9;
  assert.ok(s.bandits, '默认地图启用强盗营寨');
  const bc = s.bandits.cfg;
  assert.ok(bc.x < 1800 && bc.y < 1000, '强盗营寨位于地图左上区域');

  // 1. 敌方箭塔存在并向靠近的友军射箭，击毁发赏金与事件
  const towers = s.enemies.filter((e) => e.alive && e.enemyTower && e.banditCamp === bc.id);
  assert.equal(towers.length, 2, '通往吕达营寨前有 2 座敌方箭塔');
  s.hero.x = towers[0].x + 180;
  s.hero.y = towers[0].y;
  const proj0 = s.projs.length;
  s.advance(1.5);
  assert.ok(s.projs.length > proj0 || s.hero.hp < s.hero.maxHp, '靠近敌方箭塔会遭到箭矢射击');

  let towerDestroyed = false;
  s.on('enemyTowerDestroyed', () => { towerDestroyed = true; });
  s.kill(towers[0], s.hero);
  assert.equal(towerDestroyed, true, '摧毁敌方箭塔触发 enemyTowerDestroyed');

  // 2. 吕达在营寨中，击杀后发丰厚铜钱 + 装备 + 书卷，进入冷却，冷却结束自动重生
  const lvda = s.bandits.getBoss();
  assert.ok(lvda && lvda.banditBoss && lvda.sheetKey === 'boss_lvda', '强盗头目吕达绑定原生 4x4 精灵图 boss_lvda');
  const copper0 = s.copper;
  let killedEv = null;
  s.on('banditBossKill', (ev) => { killedEv = ev; });
  s.kill(lvda, s.hero);
  assert.ok(killedEv && killedEv.clears === 1, '击杀吕达触发 banditBossKill');
  assert.ok(s.copper >= copper0 + bc.reward.copper, '击杀吕达获得高额铜钱');
  assert.equal(s.bandits.state, 'respawning');
  assert.ok(s.bandits.cooldownLeft() > 40, '击杀后进入 45s 重生冷却');

  // 推进超过 45 秒，吕达与箭塔自动重生
  s.advance(46);
  assert.equal(s.bandits.state, 'alive', '冷却结束后吕达自动重生可重复讨伐');
  assert.ok(s.bandits.getBoss(), '重生后吕达回到场上');
});

test('霸王·项羽 & 战神·刑天终极秘境 + 全秘境可重复刷（首通唯一战魂，重刷不重复掉唯一）', () => {
  const s = mk(2);
  s.wave.nextAt = 1e9;
  // 开放项羽与刑天秘境
  s.wave.n = 12;
  s.step();
  assert.equal(s.realms.state.xiangyu, 'open', '第 8 波+ 开放霸王秘境·项羽');
  assert.equal(s.realms.state.xingtian, 'open', '第 12 波+ 开放战神秘境·刑天');

  // 传送进入霸王秘境·项羽，打通首通
  const er = s.command({ type: 'enterRealm', id: 'xiangyu' });
  assert.ok(er.ok && er.teleported, '一键传送进入项羽秘境');
  assert.equal(s.realms.state.xiangyu, 'active');

  // 清完两轮守卫刷出项羽 BOSS
  for (let i = 0; i < 120 && !s.realms.run.xiangyu?.boss; i++) {
    for (const e of s.enemies) if (e.alive && e.realm === 'xiangyu' && !e.realmBoss) s.kill(e, s.hero);
    s.advance(0.2);
  }
  const xyBoss = s.enemies.find((e) => e.alive && e.realmBoss === 'xiangyu');
  assert.ok(xyBoss && xyBoss.sheetKey === 'boss_xiangyu', '项羽 BOSS 现身并绑定 boss_xiangyu');
  const copperBefore = s.copper;
  s.kill(xyBoss, s.hero);
  assert.equal(s.realms.state.xiangyu, 'cleared');
  assert.equal(s.realms.firstCleared.xiangyu, true);
  assert.equal(s.realms.clearCount.xiangyu, 1);
  assert.ok(s.copper >= copperBefore + RD.realms.xiangyu.copper, '首通项羽获铜钱奖励');
  assert.ok(!s.units.some((u) => u.kind === 'beast' && u.key === 'xiangyu'), '项羽秘境纯刷神装/神器，不加入守家队伍');
  const soulCount1 = s.groundItems.filter((g) => g.item.id === 'soul_xiangyu').length;
  assert.equal(soulCount1, 0, '非四圣兽秘境不掉落召唤战魂');

  // 冷却结束自动刷新为 open，再次重刷通关不掉落战魂、不召唤守家，仍稳定产出装备
  s.advance(RD.realms.xiangyu.respawnSec + 1);
  assert.equal(s.realms.state.xiangyu, 'open', '可重复秘境冷却结束自动重置为 open');
  assert.ok(s.command({ type: 'enterRealm', id: 'xiangyu' }).ok);
  for (let i = 0; i < 120 && !s.realms.run.xiangyu?.boss; i++) {
    for (const e of s.enemies) if (e.alive && e.realm === 'xiangyu' && !e.realmBoss) s.kill(e, s.hero);
    s.advance(0.2);
  }
  const xyBoss2 = s.enemies.find((e) => e.alive && e.realmBoss === 'xiangyu');
  assert.ok(xyBoss2, '重刷再次刷出项羽 BOSS');
  const eqCountBefore = s.inv.equipBag.filter(Boolean).length;
  s.kill(xyBoss2, s.hero);
  assert.equal(s.realms.clearCount.xiangyu, 2, '重刷通关次数递增');
  assert.equal(s.units.filter((u) => u.kind === 'beast' && u.key === 'xiangyu').length, 0, '重刷绝不召唤项羽守家');
  assert.equal(s.groundItems.filter((g) => g.item.id === 'soul_xiangyu').length, 0, '重刷绝不掉落召唤战魂');
  assert.ok(s.inv.equipBag.filter(Boolean).length > eqCountBefore, '重刷依然稳定产出高阶装备');

  // 验证刑天 BOSS 与二阶段战意不灭（同样仅刷装备不守家）
  assert.ok(s.command({ type: 'enterRealm', id: 'xingtian' }).ok);
  for (let i = 0; i < 120 && !s.realms.run.xingtian?.boss; i++) {
    for (const e of s.enemies) if (e.alive && e.realm === 'xingtian' && !e.realmBoss) s.kill(e, s.hero);
    s.advance(0.2);
  }
  const xtBoss = s.enemies.find((e) => e.alive && e.realmBoss === 'xingtian');
  assert.ok(xtBoss && xtBoss.sheetKey === 'boss_xingtian', '刑天 BOSS 现身并绑定 boss_xingtian');
  xtBoss.hp = xtBoss.maxHp * 0.4;
  s.advance(0.5);
  assert.equal(xtBoss.phase2, true, '刑天半血触发二阶段狂暴');
  s.kill(xtBoss, s.hero);
  assert.ok(!s.units.some((u) => u.kind === 'beast' && u.key === 'xingtian'), '刑天秘境纯刷神装/神器，不加入守家队伍');
});

test('西南猎人 NPC & 野狼可重复狩猎任务闭环', () => {
  const s = mk(3);
  s.wave.nextAt = 1e9;
  assert.ok(s.hunter, '默认地图启用猎人营地');
  const need = s.hunter.need;
  let doneEv = null;
  s.on('hunterQuestDone', (ev) => { doneEv = ev; });
  const copper0 = s.copper;

  // 猎杀满 need 只野狼（含刷新补怪）
  let killed = 0;
  for (let round = 0; round < 3 && killed < need; round++) {
    const wolves = s.enemies.filter((e) => e.alive && e.hunterMob);
    for (const w of wolves) {
      if (killed >= need) break;
      s.kill(w, s.hero);
      killed++;
    }
    if (killed < need) s.advance(10);
  }
  assert.ok(doneEv && doneEv.clears === 1, '猎杀满野狼自动交付猎人任务');
  assert.ok(s.copper >= copper0 + s.hunter.cfg.reward.copper, '猎人任务发放铜钱奖励');
  assert.equal(s.hunter.prog, 0, '交付后进度归零可继续重复刷');
});

test('练功房经验速度下调 + 超出阶层软上限递减', () => {
  const s = mk(4);
  s.wave.nextAt = 1e9;
  assert.ok(s.training.cfg.tiers.low.xp <= 10, `初阶练功单怪经验已大幅下调 (${s.training.cfg.tiers.low.xp})`);
  s.command({ type: 'enterTraining', tier: 'low' });
  const lowMob1 = s.enemies.find((e) => e.alive && e.training);
  assert.ok(lowMob1 && lowMob1.xp <= 10, '低级英雄在初阶练功房单怪经验适中');

  // 提升英雄等级超过初阶软上限（softCapLv=6），新刷练功怪经验明显递减
  s.gainXp(15000);
  assert.ok(s.hero.lv > s.training.cfg.tiers.low.softCapLv);
  s.command({ type: 'setTrainingTier', tier: 'low' });
  const lowMob2 = s.enemies.find((e) => e.alive && e.training);
  assert.ok(lowMob2 && lowMob2.xp < lowMob1.xp, `超软上限后练功房经验递减 (${lowMob1.xp} -> ${lowMob2.xp})`);
});

test('专属可重复刷 BOSS 房：三阶切换、高阶装备与永久书卷掉落、永不攻击孔明', () => {
  const s = mk(5);
  s.wave.nextAt = 1e9;
  const km0 = s.kongming.hp;
  assert.ok(s.command({ type: 'enterBossRoom', tier: 'mid' }).ok);
  assert.equal(s.bossRoom.inRoom(), true);
  const b1 = s.enemies.find((e) => e.alive && e.bossRoomBoss);
  assert.ok(b1, '进入 BOSS 房即刷出对应阶层 BOSS');

  let clearedEv = null;
  s.on('bossRoomClear', (ev) => { clearedEv = ev; });
  s.kill(b1, s.hero);
  assert.ok(clearedEv && clearedEv.clears === 1 && clearedEv.equipCount >= 2, '击杀 BOSS 房首领必掉高阶装备');
  assert.ok(s.inv.itemBag.some((it) => it && it.id === 'tome_hp'), '击杀中阶 BOSS 房掉落体魄之书');
  assert.equal(s.kongming.hp, km0, 'BOSS 房首领绝不攻击孔明');

  // 房内停留等待冷却结束，BOSS 自动重生
  s.advance(s.bossRoom.cfg.respawnSec + 1);
  const b2 = s.enemies.find((e) => e.alive && e.bossRoomBoss);
  assert.ok(b2, '冷却结束后房内自动刷出下一轮 BOSS');
  // 击杀后支持强制/就绪手动一键再战
  s.kill(b2, s.hero);
  assert.ok(s.command({ type: 'respawnBossRoom', force: true }).ok, '支持手动一键立即再战');
  assert.ok(s.enemies.some((e) => e.alive && e.bossRoomBoss), '手动再战刷出 BOSS');
  assert.ok(s.command({ type: 'exitBossRoom' }).ok);
  assert.equal(s.bossRoom.inRoom(), false);
});

test('成长性道具：藏经书店买1本/连买5本永久加属性 + 杀敌成长神兵自动升阶且不可出售', () => {
  const s = mk(6);
  s.wave.nextAt = 1e9;
  s.copper = 5000;
  const atk0 = s.hero.stats.atk;

  // 1. 藏经书店连买 5 本武勇之书：永久 +60 攻击
  const rb = s.command({ type: 'buyBook', itemId: 'tome_atk', count: 5 });
  assert.ok(rb.ok && rb.count === 5);
  assert.ok(s.hero.stats.atk >= atk0 + 60, `连吃 5 本武勇之书永久加攻击 (${atk0} -> ${s.hero.stats.atk})`);
  assert.equal(s.inv.tomeStats[s.hero.id].count, 5);

  // 2. 购买并开启【噬魂剑·成长匣】获得唯一杀敌成长武器，穿戴后击杀 15 只敌人自动升至 2 阶
  assert.ok(s.command({ type: 'buyItem', itemId: 'growth_soulblade_box' }).ok);
  const boxIdx = s.inv.itemBag.findIndex((it) => it && it.id === 'growth_soulblade_box');
  assert.ok(boxIdx >= 0);
  assert.ok(s.command({ type: 'useItem', itemIdx: boxIdx }).ok);
  const gIdx = s.inv.equipBag.findIndex((it) => it && it.growth && it.growthId === 'soulblade');
  assert.ok(gIdx >= 0, '开启成长匣获得噬魂剑');
  const blade = s.inv.equipBag[gIdx];
  assert.equal(blade.unique, true);
  assert.equal(s.command({ type: 'sell', bagIdx: gIdx }).ok, false, '唯一成长装备禁止出售');

  assert.ok(s.command({ type: 'equip', bagIdx: gIdx, unitId: s.hero.id }).ok);
  const atkStage1 = s.hero.stats.atk;
  let leveledUp = false;
  s.on('growthLevelUp', () => { leveledUp = true; });
  for (let i = 0; i < 15; i++) {
    const m = s.spawnEnemy('paperman', s.hero.x + 80, s.hero.y);
    s.kill(m, s.hero);
  }
  assert.equal(leveledUp, true, '击杀 15 只敌人后噬魂剑自动升阶');
  assert.equal(blade.stage, 2);
  assert.ok(s.hero.stats.atk > atkStage1, `噬魂剑升阶后攻击显著提升 (${atkStage1} -> ${s.hero.stats.atk})`);
});

test('心魔镜像试炼（2倍/5倍/10倍镜像）：累计永久提升 30,000 战力与巨额属性', () => {
  const s = mk(7);
  s.wave.nextAt = 1e9;
  const atk0 = s.hero.stats.atk;
  const hp0 = s.hero.maxHp;

  for (const tid of ['m2', 'm5', 'm10']) {
    const r = s.command({ type: 'startMirror', tier: tid });
    assert.ok(r.ok, `开启 ${tid} 镜像试炼`);
    const boss = s.enemies.find((e) => e.alive && e.mirrorBoss && e.mirrorTier === tid);
    assert.ok(boss, `${tid} 镜像现身`);
    s.kill(boss, s.hero);
  }
  assert.equal(s.mirror.totalPowerBonus, 30000, '三阶镜像全部击破累计提升 30,000 战力');
  assert.ok(s.hero.stats.atk >= atk0 + 600, `镜像试炼后攻击暴涨 (${atk0} -> ${s.hero.stats.atk})`);
  assert.ok(s.hero.maxHp >= hp0 + 6000, `镜像试炼后生命暴涨 (${hp0} -> ${s.hero.maxHp})`);
});

test('魔兽 0 级技能学习 + 30 级觉醒技能闭环', () => {
  const s = mk(8, { heroId: 'huoqing' });
  s.wave.nextAt = 1e9;
  const h = s.hero;
  // 开局全部技能 0 级，有 1 点技能点
  assert.deepEqual(h.skillLvs, { q: 0, e: 0, r: 0, f: 0, u: 0 });
  assert.equal(h.skillPoints, 1);
  assert.equal(s.command({ type: 'castSkill', slot: 'q', autoAim: true }).ok, false, '0 级技能不可释放');

  // 1 级学 Q -> 1 级可释放，其余技能仍为 0 级
  assert.ok(s.command({ type: 'upgradeSkill', slot: 'q' }).ok);
  assert.equal(h.skillLvs.q, 1);
  assert.equal(h.skillLvs.e, 0);
  assert.equal(h.skillPoints, 0);

  // 记录觉醒前大招配置，升至 30 级触发觉醒
  const ultBefore = cfg({ ...h, skillLvs: { ...h.skillLvs, u: 1 }, awakened: false }, 'u');
  let awakenedEv = false;
  s.on('heroAwaken', () => { awakenedEv = true; });
  s.gainXp(200000);
  assert.ok(h.lv >= 30, `英雄升至 Lv.${h.lv}`);
  assert.equal(h.awakened, true, '30 级自动触发觉醒状态');
  assert.equal(awakenedEv, true, '触发 heroAwaken 事件');
  assert.ok(h.skillLvs.u >= 1, '觉醒自动解锁大招');
  const ultAfter = cfg(h, 'u');
  assert.ok(ultAfter.coef > ultBefore.coef * 1.5, `觉醒大招伤害倍率大幅跃升 (${ultBefore.coef} -> ${ultAfter.coef})`);
  if (ultBefore.r) assert.ok(ultAfter.r > ultBefore.r * 1.25, `觉醒大招范围显著扩大 (${ultBefore.r} -> ${ultAfter.r})`);
});

test('边界回归：镜像房内限位与离房清理 + 成长神兵杀敌刷新版本 + PlayerBot 自动学技能', () => {
  const s = mk(9);
  s.wave.nextAt = 1e9;

  // 1) 在 BOSS 房内开启镜像，确保限位在房内；退出后 6 秒自动清理不跨区追击
  assert.ok(s.command({ type: 'enterBossRoom', tier: 'low' }).ok);
  const mr = s.command({ type: 'startMirror', tier: 'm2' });
  assert.ok(mr.ok);
  const mb = s.enemies.find((e) => e.alive && e.id === mr.bossId);
  assert.ok(mb);
  const [x0, y0, x1, y1] = s.map.bossRoom.rect;
  assert.ok(mb.x >= x0 && mb.x <= x1 && mb.y >= y0 && mb.y <= y1, '镜像生成位置受限于当前封闭房间');
  assert.ok(s.command({ type: 'exitBossRoom' }).ok);
  s.advance(6.5);
  assert.equal(mb.alive, false, '英雄离开房间后镜像自动消散');
  assert.equal(s.mirror.activeId, null);

  // 2) 成长神兵未跨阶击杀也会递增 inv.ver
  const blade = s.loot.makeGrowth('soulblade');
  s.loot.give(blade);
  assert.ok(s.command({ type: 'equip', bagIdx: s.inv.equipBag.indexOf(blade), unitId: s.hero.id }).ok);
  const verBefore = s.inv.ver;
  const dummy = s.spawnEnemy('paperman', s.hero.x + 80, s.hero.y);
  s.kill(dummy, s.hero);
  assert.equal(blade.kills, 1);
  assert.ok(s.inv.ver > verBefore, '成长神兵击杀立即递增 inv.ver');

  // 3) PlayerBot 自动学习 0 级技能（1 级学 Q，6 级学 U）
  const s2 = mk(10);
  s2.wave.nextAt = 1e9;
  const bot = new PlayerBot(s2, { kind: 'proxy', seed: 10 });
  bot.step();
  assert.equal(s2.hero.skillLvs.q, 1, 'PlayerBot 开局自动消耗 1 技能点学习 Q');
  assert.equal(s2.hero.skillPoints, 0);
  s2.gainXp(2500);
  assert.ok(s2.hero.lv >= 6);
  bot.thinkT = 0;
  bot.step();
  assert.ok(s2.hero.skillLvs.u >= 1, 'PlayerBot 达到 6 级自动学习大招 U');
});
