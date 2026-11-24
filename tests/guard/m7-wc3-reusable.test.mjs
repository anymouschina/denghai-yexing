// M7 魔兽守图完整闭环 & 可复用地图抽象无头测试：
// 三路兵线、复活点与灵泉回血、可复用地图配置、回城机制、可复用墙壁（地面/飞行/弹体/可破坏与修复）、
// 通用闪现与合法穿墙（含禁止穿入未开放秘境）、功能道具商店与快捷道具、地面掉落与一键清地（保护唯一道具）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import { createMap, DEFAULT_MAP } from '../../src/guard/sim/map.js';
import { lanesFor } from '../../src/guard/sim/systems/waves.js';
import { spawnBoss } from '../../src/guard/sim/systems/bosses.js';
import RD from '../../src/guard/data/realms.json' with { type: 'json' };

const mk = (seed = 7, o = {}) => new Sim({ seed, heroId: 'huoqing', mode: 'story', fx: false, ...o });

test('默认地图为三条路兵线（北/东/西），波次只从这三路刷怪，不含南路', () => {
  assert.deepEqual(DEFAULT_MAP.laneOrder, ['N', 'E', 'W']);
  assert.deepEqual(Object.keys(DEFAULT_MAP.lanes), ['N', 'E', 'W']);
  assert.deepEqual(lanesFor(1, DEFAULT_MAP), ['N']);
  assert.deepEqual(lanesFor(4, DEFAULT_MAP), ['N', 'E']);
  assert.deepEqual(lanesFor(8, DEFAULT_MAP), ['N', 'E', 'W']);
  assert.deepEqual(lanesFor(25, DEFAULT_MAP), ['N', 'E', 'W']);
  const s = mk(11);
  assert.ok(s.foundations.every((f) => ['N', 'E', 'W'].includes(f.lane)), '所有地基分布在三路旁');
});

test('可复用地图配置 createMap：自定义兵线、复活点、回城锚点、墙体与商店目录均可即插即用', () => {
  const custom = createMap({
    id: 'canyon_test',
    name: '峡谷测试图',
    lanes: {
      A: [[2000, 120], [2000, 1200], [2000, 1880]],
      B: [[3800, 2000], [2800, 2000], [2120, 2000]],
    },
    laneOrder: ['A', 'B'],
    laneNames: { A: '上', B: '右' },
    lanesAt: [[1, 1], [3, 2]],
    includeRealmWalls: false,
    walls: [{ id: 'custom_wall', x0: 1800, y0: 1500, x1: 2200, y1: 1540, blocksGround: true, blocksProj: true }],
    revivePoint: { x: 1600, y: 2600, r: 140, healPct: 0.1, name: '自定义复活泉' },
    homeAnchor: { x: 1650, y: 2500, r: 80 },
    shopCatalog: ['pill', 'recall_scroll'],
  });
  const s = mk(12, { map: custom });
  assert.equal(s.map.id, 'canyon_test');
  assert.deepEqual(lanesFor(5, s.map), ['A', 'B']);
  assert.equal(s.walls.length, 1);
  assert.equal(s.walls[0].id, 'custom_wall');
  assert.deepEqual(s.getHomeAnchor(), { x: 1650, y: 2500, r: 80 });
  assert.equal(s.getRevivePoint().x, 1600);
  assert.deepEqual(s.shop.catalog().map((x) => x.id), ['pill', 'recall_scroll']);
});

test('复活点机制：英雄与神兽阵亡后严格在复活点复活，且站入复活泉持续回血', () => {
  const s = mk(13);
  const rp = s.getRevivePoint();
  // 1. 英雄复活落在复活点内
  s.hero.x = 1200; s.hero.y = 1200;
  s.damage(null, s.hero, 1e9);
  assert.equal(s.hero.alive, false);
  s.advance(s.hero.downT + 0.2);
  assert.equal(s.hero.alive, true);
  assert.ok(Math.hypot(s.hero.x - rp.x, s.hero.y - rp.y) <= rp.r, `英雄在复活点复活 (${Math.round(s.hero.x)},${Math.round(s.hero.y)})`);

  // 2. 站入复活点泉眼持续回血，离开后不触发泉眼回血
  s.hero.x = rp.x; s.hero.y = rp.y;
  s.hero.hp = s.hero.maxHp * 0.4;
  const hp0 = s.hero.hp;
  s.advance(2.0);
  assert.ok(s.hero.hp > hp0 + s.hero.maxHp * 0.12, `复活泉回血生效 ${hp0} -> ${s.hero.hp}`);
});

test('回城机制：吟唱传送至基地锚点、移动/受控打断、回城符快速吟唱且无视冷却', () => {
  const s = mk(14);
  const h = s.hero;
  const anc = s.getHomeAnchor();
  h.x = 3400; h.y = 2000;
  const r1 = s.command({ type: 'recall' });
  assert.ok(r1.ok && h.recall);

  // 移动打断回城
  s.input.mx = 1;
  s.step();
  s.input.mx = 0;
  assert.equal(h.recall, null, 'WASD 移动打断回城');
  assert.ok(h.cds.recall > 0, '打断后有短暂冷却');

  // 冷却完毕后完整吟唱回城（从隐藏秘境也能传回基地）
  h.cds.recall = 0;
  h.x = 4800; h.y = 2000;
  s.collideUnit(h);
  assert.equal(h.realm, 'qilin');
  assert.ok(s.command({ type: 'recall' }).ok);
  s.advance(2.1);
  assert.equal(h.recall, null);
  assert.ok(Math.hypot(h.x - anc.x, h.y - anc.y) < 20, `成功传回基地锚点 (${Math.round(h.x)},${Math.round(h.y)})`);
  assert.equal(h.realm, null, '回城后正确退出秘境');
  assert.ok(h.cds.recall > 10, '回城后进入冷却');

  // 冷却中再次触发内置回城失败，但使用回城符（recall_scroll）可无视冷却 0.8s 快速回城
  assert.equal(s.command({ type: 'recall' }).ok, false);
  h.x = 3200; h.y = 2000;
  s.loot.give(s.loot.roll({ id: 'recall_scroll' }));
  assert.ok(s.command({ type: 'useQuickItem', itemId: 'recall_scroll' }).ok);
  assert.ok(h.recall && h.recall.total <= 0.85);
  s.advance(0.9);
  assert.ok(Math.hypot(h.x - anc.x, h.y - anc.y) < 20, '回城符快速传送成功');

  // 受控打断回城
  h.cds.recall = 0;
  h.x = 2600; h.y = 2000;
  assert.ok(s.command({ type: 'recall' }).ok);
  h.st.stun = 1.0;
  s.step();
  assert.equal(h.recall, null, '眩晕打断回城');
});

test('墙壁机制：地面阻挡、飞行穿越/阻挡、弹体拦截、可破坏墙体击破与修复', () => {
  const s = mk(15);
  // 添加一面可破坏且拦截弹体、不拦飞行的墙
  const w = s.addWall({
    id: 'test_gate',
    kind: 'fortification',
    x0: 2150, y0: 1900, x1: 2190, y1: 2100,
    blocksGround: true,
    blocksFlying: false,
    blocksProj: true,
    blinkable: true,
    destructible: true,
    repairable: true,
    maxHp: 300,
    hp: 300,
  });

  // 1. 地面英雄被墙阻挡，不能穿过去
  s.hero.x = 2110; s.hero.y = 2000;
  s.command({ type: 'moveTo', x: 2300, y: 2000 });
  s.advance(0.5);
  assert.ok(s.hero.x < 2150, `地面单位被阻挡在墙左 (${s.hero.x})`);

  // 2. 飞行单位（夜鸦）可直接飞越 blocksFlying=false 的墙
  const crow = s.spawnEnemy('yeya', 2260, 2000);
  s.advance(1.3);
  assert.ok(crow.x < 2150, `飞行单位越过墙体 (${crow.x})`);

  // 3. 弹体撞上 blocksProj=true 的墙被拦截
  const p = s.addProj({ side: 'ally', src: s.hero, x: 2120, y: 2000, a: 0, speed: 600, life: 1, dmg: 50, r: 10 });
  s.advance(0.15);
  assert.equal(p.alive, false, '弹体被阻挡弹体的墙截停');

  // 4. 击破可破坏墙体后，地面单位可自由穿过；修复后恢复阻挡
  s.damageWall(w, 999);
  assert.equal(w.alive, false);
  s.hero.x = 2120; s.hero.y = 2000;
  s.command({ type: 'moveTo', x: 2260, y: 2000 });
  s.advance(0.8);
  assert.ok(s.hero.x > 2200, `墙体击破后地面单位顺利通过 (${s.hero.x})`);

  s.copper = 500;
  const rep = s.command({ type: 'repairWall', wid: 'test_gate' });
  assert.ok(rep.ok && w.alive && w.hp === w.maxHp, '城墙修复成功并恢复阻挡');
});

test('通用闪现与合法穿墙：可跨可翻越墙、遇不可翻越墙停前、绝不穿入未开放秘境、阿烛 F 同步支持穿墙', () => {
  const s = mk(16);
  // 默认 4 圣兽从第 1 波即开放，仅隐藏麒麟保持 locked
  for (const id of ['xuanwu', 'baihu', 'zhuque', 'qinglong']) {
    assert.equal(s.realms.state[id], 'open', `${id} 默认开局开放`);
  }
  assert.equal(s.realms.state.qilin, 'locked', '隐藏麒麟秘境初始 locked');
  assert.equal(s.isRegionLocked(4800, 2000), true, '隐藏麒麟区域未开启时处于锁定状态');
  const h = s.hero;
  // 玄武竖墙在 x = 1100 ± 18, y = 0..870
  h.x = 1180; h.y = 400;
  const r = s.command({ type: 'blink', x: 960, y: 400 });
  assert.ok(r.ok && r.crossedWall, '成功穿墙闪现');
  assert.ok(h.x < 1070, `已合法落到墙另一侧 (${h.x})`);
  assert.ok(h.cds.blink > 0, '进入闪现冷却');

  // 不可翻越墙体（blinkable: false）：停在墙前，不能穿过
  s.addWall({ id: 'solid_cliff', x0: 2300, y0: 1900, x1: 2340, y1: 2100, blocksGround: true, blinkable: false });
  h.cds.blink = 0;
  h.x = 2240; h.y = 2000;
  const r2 = s.command({ type: 'blink', x: 2480, y: 2000 });
  assert.ok(r2.ok);
  assert.ok(h.x < 2300, `不可翻越墙体拦住闪现 (${h.x})`);

  // 自定义 open > wave 配置的未开放秘境（青龙 locked，rect [2900,0,4000,1100]）：向内闪现绝不落入未开放秘境
  const prevOpen = RD.realms.qinglong.open;
  RD.realms.qinglong.open = 5;
  try {
    const sLocked = mk(160);
    assert.equal(sLocked.realms.state.qinglong, 'locked');
    const hl = sLocked.hero;
    hl.cds.blink = 0;
    hl.x = 2820; hl.y = 400;
    sLocked.command({ type: 'blink', x: 3060, y: 400 });
    assert.ok(hl.x < 2900 && hl.realm !== 'qinglong', `绝不闪入未开放秘境 (x=${hl.x}, realm=${hl.realm})`);
  } finally {
    RD.realms.qinglong.open = prevOpen;
  }

  // 缩地符（blink_scroll）无视通用闪现冷却且射程更远（460）
  h.cds.blink = 9;
  h.x = 2000; h.y = 2000;
  s.loot.give(s.loot.roll({ id: 'blink_scroll' }));
  const r3 = s.command({ type: 'useQuickItem', itemId: 'blink_scroll', x: 2500, y: 2000 });
  assert.ok(r3.ok);
  assert.ok(h.x > 2360 || h.x < 2300, '缩地符立即生效');

  // 阿烛 F（灯影步）同样合法穿墙
  const sa = mk(17, { heroId: 'azhu' });
  sa.realms.state.xuanwu = 'open';
  sa.command({ type: 'upgradeSkill', slot: 'f' });
  sa.hero.x = 1180; sa.hero.y = 400;
  assert.ok(sa.castSkill(sa.hero, 'f', { x: 960, y: 400 }));
  assert.ok(sa.hero.x < 1070, `阿烛灯影步合法穿墙 (${sa.hero.x})`);
});

test('铜钱商店与功能道具闭环：购买、叠加、护灯金钟、鲁班修塔符、镇妖定身符与建筑单独修复', () => {
  const s = mk(18);
  s.copper = 1000;
  assert.ok(s.command({ type: 'buyItem', itemId: 'km_shield' }).ok);
  assert.ok(s.command({ type: 'buyItem', itemId: 'repair_kit' }).ok);
  assert.ok(s.command({ type: 'buyItem', itemId: 'stun_charm' }).ok);
  assert.equal(s.shop.count('km_shield'), 1);

  // 护灯金钟：孔明获护盾 + 无敌
  assert.ok(s.command({ type: 'useQuickItem', itemId: 'km_shield' }).ok);
  assert.ok(s.kongming.shield > 0 && s.kongming.invuln >= 2.9);

  // 鲁班修塔符：修复受损建筑
  const f = s.foundations.find((x) => x.lane === 'N');
  s.hero.x = f.x + 50; s.hero.y = f.y;
  const b = s.command({ type: 'build', fid: f.id, bld: 'arrow' }).b;
  b.hp = b.maxHp * 0.2;
  assert.ok(s.command({ type: 'useQuickItem', itemId: 'repair_kit' }).ok);
  assert.ok(b.hp >= b.maxHp * 0.69, `修塔符恢复耐久 ${b.hp}/${b.maxHp}`);

  // 建造面板单独修复（repair）
  assert.ok(s.command({ type: 'repair', bid: b.id }).ok);
  assert.equal(b.hp, b.maxHp);

  // 镇妖定身符：范围伤害 + 眩晕
  const e = s.spawnEnemy('jiangshi', s.hero.x + 80, s.hero.y);
  s.step();
  const ehp0 = e.hp;
  assert.ok(s.command({ type: 'useQuickItem', itemId: 'stun_charm' }).ok);
  assert.ok(!e.alive || (e.hp < ehp0 && e.st.stun > 2.5), '镇妖定身符生效');
});

test('地面道具与一键清理：普通未拾取道具一键清除，唯一道具（unique）严格受保护', () => {
  const s = mk(19);
  const h = s.hero;
  const d1 = s.ground.spawn(s.loot.roll({ id: 'pill' }), h.x + 30, h.y);
  const d2 = s.ground.spawn(s.loot.roll({ id: 'oil' }), h.x + 60, h.y);
  const u1 = s.ground.spawn(s.loot.roll({ id: 'qilin_seal' }), h.x + 40, h.y + 20);
  const customUnique = s.loot.roll({ slot: 'weapon', q: 4, wave: 10 });
  customUnique.unique = true;
  const u2 = s.ground.spawn(customUnique, h.x + 20, h.y + 30, { unique: true });

  assert.equal(s.groundItems.length, 4);
  assert.equal(s.ground.uniqueCount(), 2);

  // 距离内拾取 d1
  assert.ok(s.command({ type: 'pickupGround', gid: d1.id }).ok);
  assert.equal(s.groundItems.length, 3);

  // 从背包主动丢弃到地面
  const idx = s.inv.bag.findIndex((it) => it && it.id === 'pill');
  assert.ok(s.command({ type: 'dropItem', bagIdx: idx }).ok);
  assert.equal(s.groundItems.length, 4);

  // 一键清地：只清除 2 件普通地面道具（d2 与刚丢弃的 pill），2 件唯一道具原封不动保留！
  const clr = s.command({ type: 'clearGroundItems' });
  assert.ok(clr.ok);
  assert.equal(clr.cleared, 2);
  assert.equal(clr.keptUnique, 2);
  assert.equal(s.groundItems.length, 2);
  assert.ok(s.groundItems.some((g) => g.id === u1.id));
  assert.ok(s.groundItems.some((g) => g.id === u2.id));

  // 再次一键清地：不会清除任何唯一道具
  const clr2 = s.command({ type: 'clearGroundItems' });
  assert.ok(clr2.ok && clr2.cleared === 0 && clr2.keptUnique === 2);
  assert.equal(s.groundItems.length, 2);
});

test('守卫剑阁联动：击杀第 10 波 BOSS 后，司马懿派出《魂兵》三路进攻', () => {
  const s = mk(20);
  const ev = [];
  s.on('escalation', (d) => ev.push(d));
  const boss = spawnBoss(s, 'laozu', 10, 10);
  s.kill(boss, s.hero);
  assert.equal(ev.length, 1, '触发司马懿魂兵进攻事件');
  assert.equal(ev[0].rule.commander, '司马懿');
  const hunbing = s.enemies.filter((e) => e.alive && e.type === 'hunbing');
  assert.equal(hunbing.length, 12, '三路共派出 12 名魂兵');
  const lanes = new Set(hunbing.map((e) => e.lane));
  assert.deepEqual([...lanes].sort(), ['E', 'N', 'W'], '三路同步进攻');
});

test('神兽魂痕闭环：猎杀神兽掉落唯一魂痕（清地受保护），拾取使用后召唤为己方可控单位', () => {
  const custom = createMap({ beastDropSoulMarkOnly: true });
  const s = mk(21, { map: custom });
  s.realms.state.xuanwu = 'active';
  s.realms.run.xuanwu = { round: 2, wait: 0, boss: 999, since: 0 };
  const fakeBoss = s.spawnEnemy('jiangshi', s.hero.x + 30, s.hero.y, { boss: 'realm', realm: 'xuanwu', extra: { realmBoss: 'xuanwu' } });
  s.kill(fakeBoss, s.hero);

  // 掉落唯一玄武魂痕，清地不会清除
  const soulDrop = s.groundItems.find((g) => g.item.id === 'soul_xuanwu');
  assert.ok(soulDrop && soulDrop.unique, '神兽掉落唯一玄武魂痕');
  const clr = s.command({ type: 'clearGroundItems' });
  assert.ok(s.groundItems.some((g) => g.id === soulDrop.id), '一键清地保护魂痕不被清除');

  // 拾取并使用玄武魂痕 → 召唤玄武加入队伍且可切换操控
  assert.ok(s.command({ type: 'pickupGround', gid: soulDrop.id }).ok);
  const partyBefore = s.party.length;
  assert.ok(s.command({ type: 'useQuickItem', itemId: 'soul_xuanwu' }).ok);
  assert.equal(s.party.length, partyBefore + 1, '使用魂痕召唤神兽入队');
  const beast = s.units.find((u) => u.kind === 'beast' && u.key === 'xuanwu');
  assert.ok(beast && beast.alive);
  assert.ok(s.command({ type: 'switch', id: beast.id }).ok, '召唤出的神兽可切换操控');
});

test('英雄升级属性成长 + 技能点分配与技能等级缩放（含大招等级门槛与上限）', () => {
  const s = mk(22, { heroId: 'azhu' });
  const h = s.hero;
  const hp1 = h.maxHp;
  const atk1 = h.stats.atk;
  const def1 = h.stats.def;
  assert.equal(h.skillPoints, 1, '开局自带 1 点技能点');

  // 1 级所有技能初始 0 级（未学），不能施放也不能学大招（需 6 级）
  assert.equal(h.skillLvs.q, 0, '开局技能初始 0 级未学');
  assert.equal(s.command({ type: 'castSkill', slot: 'q', x: h.x + 200, y: h.y }).ok, false, '未学技能不可施放');
  assert.equal(s.command({ type: 'upgradeSkill', slot: 'u' }).ok, false);

  // 学习 Q 技能（0->1）：消耗技能点后可正常施放，再升至 2 级冷却缩短
  const cdBefore = h.def.skills.q.cd;
  assert.ok(s.command({ type: 'upgradeSkill', slot: 'q' }).ok);
  assert.equal(h.skillLvs.q, 1);
  assert.equal(h.skillPoints, 0);
  s.gainXp(2000);
  assert.ok(h.lv >= 6, `英雄升至 Lv.${h.lv}`);
  assert.ok(h.maxHp > hp1 && h.stats.atk > atk1 && h.stats.def > def1, '升级带来生命/攻击/防御全面提升');
  assert.ok(h.skillPoints >= 5, `升级获得技能点 (${h.skillPoints})`);
  assert.ok(s.command({ type: 'upgradeSkill', slot: 'q' }).ok);
  assert.equal(h.skillLvs.q, 2);
  s.castSkill(h, 'q', { x: h.x + 200, y: h.y });
  assert.ok(h.cds.q < cdBefore, `升级后技能冷却缩短 (${h.cds.q} < ${cdBefore})`);
  assert.ok(s.command({ type: 'upgradeSkill', slot: 'u' }).ok, '6 级解锁大招学习');
  assert.equal(h.skillLvs.u, 1);
});

test('多行囊套装切换：不同行囊套独立保存装备，一键切换立即重算属性与套装加成', () => {
  const s = mk(23);
  const h = s.hero;
  const baseAtk = h.stats.atk;
  const w1 = s.loot.roll({ slot: 'weapon', set: 'baihu', q: 3, wave: 10 });
  const a1 = s.loot.roll({ slot: 'armor', set: 'baihu', q: 3, wave: 10 });
  s.loot.give(w1);
  s.loot.give(a1);
  assert.ok(s.command({ type: 'equip', bagIdx: s.inv.bag.indexOf(w1), unitId: h.id }).ok);
  assert.ok(s.command({ type: 'equip', bagIdx: s.inv.bag.indexOf(a1), unitId: h.id }).ok);
  assert.ok(h.stats.atk > baseAtk && s.activeSets(h).includes('杀伐2'));

  // 切换至行囊套 2（空套装）→ 属性恢复基础，套装加成消失
  assert.ok(s.command({ type: 'switchLoadout', unitId: h.id, index: 1 }).ok);
  assert.ok(Math.abs(h.stats.atk - baseAtk) < 1e-6, '切换至空套装恢复基础攻击');
  assert.equal(s.activeSets(h).length, 0);

  // 切回行囊套 1 → 杀伐 2 件套与攻击立刻恢复
  assert.ok(s.command({ type: 'switchLoadout', unitId: h.id, index: 0 }).ok);
  assert.ok(h.stats.atk > baseAtk && s.activeSets(h).includes('杀伐2'), '切回套 1 立刻恢复装备与套装');
});

test('王者荣耀式定向施法、普攻键与角色动作状态机（idle/walk/attack/cast/ult）', () => {
  const s = mk(24, { heroId: 'huoqing' });
  const h = s.hero;
  assert.equal(h.action.state, 'idle');

  // 移动切至 walk 状态
  s.input.mx = 1;
  s.step();
  assert.equal(h.action.state, 'walk');
  s.input.mx = 0;
  s.step();
  assert.equal(h.action.state, 'idle');

  // 普攻键切至 attack 状态并记录朝向角
  assert.ok(s.command({ type: 'basicAttack', x: h.x - 160, y: h.y }).ok);
  assert.equal(h.action.state, 'attack');
  assert.equal(h.face, -1);

  // 定向施放 Q 技能：先学 1 级 Q，再沿指定方向释放并切至 cast 状态
  assert.ok(s.command({ type: 'upgradeSkill', slot: 'q' }).ok);
  const r = s.command({ type: 'castSkill', slot: 'q', x: h.x + 260, y: h.y });
  assert.ok(r.ok);
  assert.equal(h.action.state, 'cast');
  assert.equal(h.action.slot, 'q');
  assert.equal(h.face, 1);

  // 充满能量并对附近敌人释放大招 U → ult 状态，动作结束后回到 idle
  const foe = s.spawnEnemy('jiangshi', h.x + 120, h.y);
  s.step();
  h.dash = null;
  h.skillLvs.u = 1;
  h.energy = 100;
  const seqBefore = h.action.seq;
  assert.ok(s.command({ type: 'castSkill', slot: 'u', x: h.x + 120, y: h.y }).ok);
  assert.equal(h.action.state, 'ult');
  assert.ok(h.action.seq > seqBefore, '每次动作应递增 seq 以便动画重播');
  s.advance(0.65);
  assert.equal(h.action.state, 'idle');

  // 受击进入 hurt 状态，阵亡进入 dead 状态并保留 deadAnimT
  h.invuln = 0;
  h.shield = 0;
  s.damage(foe, h, 30);
  assert.equal(h.action.state, 'hurt');
  s.advance(0.25);
  assert.equal(h.action.state, 'idle');
  s.kill(h, foe);
  assert.equal(h.alive, false);
  assert.equal(h.action.state, 'dead');
  assert.ok(h.deadAnimT > 0.5, '阵亡应保留倒地消散动画时长');
});

test('操作体验增强：pickupMove 走近自动拾取 + HUD autoAim 忽略右下角鼠标坐标智能索敌 + 辅助技能升级时长缩放', () => {
  const s = mk(25, { heroId: 'huoqing' });
  const h = s.hero;
  // 1. pickupMove 走近远处魂痕自动拾取
  const soul = s.ground.spawn(s.loot.roll({ id: 'soul_baihu' }), h.x + 240, h.y, { unique: true });
  assert.ok(s.command({ type: 'pickupMove', gid: soul.id }).ok);
  s.advance(1.5);
  assert.equal(s.groundItems.some((g) => g.id === soul.id), false, '走近后自动拾取远处魂痕');
  assert.ok(s.inv.bag.some((it) => it && it.id === 'soul_baihu'), '魂痕已自动收入行囊');

  // 2. HUD 点击普攻/技能 autoAim：即使鼠标停在右下角空地，也应朝左侧近身敌人攻击
  s.input.aim = { x: h.x + 500, y: h.y + 400 };
  const foe = s.spawnEnemy('jiangshi', h.x - 90, h.y);
  s.step();
  const hp0 = foe.hp;
  assert.ok(s.command({ type: 'basicAttack', autoAim: true }).ok);
  assert.equal(h.face, -1, 'autoAim 朝向左侧敌人而非右下角鼠标');
  assert.ok(foe.hp < hp0, 'autoAim 普攻命中左侧敌人');

  // 3. 非伤害型辅助技能升级（霍青 R 铁壁）：持续时间随技能等级提升
  s.gainXp(100);
  assert.ok(s.command({ type: 'upgradeSkill', slot: 'r' }).ok);
  assert.ok(s.command({ type: 'upgradeSkill', slot: 'r' }).ok);
  assert.equal(h.skillLvs.r, 2);
  assert.ok(s.command({ type: 'castSkill', slot: 'r', autoAim: true }).ok);
  const buff = h.buffs.find((b) => b.id === 'tiebi');
  assert.ok(buff && buff.t > h.def.skills.r.dur, `铁壁 Lv.2 持续时间提升 (${buff?.t} > ${h.def.skills.r.dur})`);

  // 4. HUD 点击闪现（autoAim: true）：忽略停在右下角按钮上的鼠标坐标，沿角色当前朝向闪现
  h.face = -1;
  s.input.mx = 0; s.input.my = 0;
  s.input.aim = { x: h.x + 600, y: h.y + 400 };
  const bx0 = h.x;
  const br = s.command({ type: 'blink', autoAim: true });
  assert.ok(br.ok, 'HUD autoAim 闪现成功');
  assert.ok(h.x < bx0 - 150, `autoAim 闪现应沿朝向向左位移，而非飞向右下角鼠标 (${bx0} -> ${h.x})`);
});
