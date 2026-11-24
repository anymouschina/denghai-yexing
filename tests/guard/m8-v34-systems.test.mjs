// M8 v3.4 全面体验升级无头测试：
// 1) 渲染插值快照 prevX/prevY（含传送吸附）
// 2) 装备栏与道具/魂痕栏严格分离（道具绝不挤占装备）
// 3) 唯一道具严格禁止出售（魂痕/奇珍/唯一装备）+ 批量卖凡铁保护套装与神兵
// 4) 技能全面受装备加成（攻击/技能伤害/暴击/冷却/治疗/护盾/灼烧）+ 装备提升显著
// 5) 装备合成体系（二合一升阶 + 6 件名将神兵锻造与专属被动生效）
// 6) 练功房系统（传送/快捷进出、初/中/高阶切换、永不攻击孔明、产出经验/铜钱/装备、地图可复用）
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import { createMap } from '../../src/guard/sim/map.js';
import { EQUIP_BAG_SIZE, ITEM_BAG_SIZE, isUniqueItem } from '../../src/guard/sim/systems/loot.js';
import { RECIPES } from '../../src/guard/sim/systems/craft.js';

const mk = (seed = 101, o = {}) => new Sim({ seed, heroId: 'huoqing', mode: 'story', fx: false, ...o });

test('帧间插值快照 prevX/prevY：移动记录上帧坐标，传送/复活瞬间吸附不拉丝', () => {
  const s = mk(1);
  const h = s.hero;
  const x0 = h.x;
  s.input.mx = 1;
  s.step();
  assert.equal(h.prevX, x0, 'step 开始时快照 prevX');
  assert.ok(h.x > h.prevX, 'step 结束后 x 前进');
  s.input.mx = 0;

  // 进入练功房传送时 prevX/prevY 应同步吸附到落点
  assert.ok(s.command({ type: 'enterTraining' }).ok);
  assert.equal(h.prevX, h.x);
  assert.equal(h.prevY, h.y);
});

test('装备栏与道具/魂痕栏严格分离：道具满格绝不挤占装备，装备满格绝不挤占道具', () => {
  const s = mk(2);
  // 1. 塞满全部 24 格道具栏
  for (let i = 0; i < ITEM_BAG_SIZE; i++) {
    const it = s.loot.roll({ id: 'pill' });
    it.id = `pill_${i}`; // 避免叠放，确保占满 24 个独立道具格
    assert.ok(s.loot.give(it));
  }
  assert.equal(s.inv.itemBag.filter(Boolean).length, ITEM_BAG_SIZE);
  assert.equal(s.inv.equipBag.filter(Boolean).length, 0, '道具绝不占用装备栏');

  // 2. 此时依然可以完整放入 30 件装备
  for (let i = 0; i < EQUIP_BAG_SIZE; i++) {
    assert.ok(s.loot.give(s.loot.roll({ slot: 'weapon', q: 1, wave: 5 })), `第 ${i + 1} 件装备入包成功`);
  }
  assert.equal(s.inv.equipBag.filter(Boolean).length, EQUIP_BAG_SIZE);
  assert.equal(s.loot.give(s.loot.roll({ slot: 'weapon', q: 1, wave: 5 })), false, '装备栏满 30 格后拒绝第 31 件装备');
});

test('唯一道具严格禁止出售：魂痕与唯一奇珍在指令层被拦截，批量出售跳过套装与神兵', () => {
  const s = mk(3);
  const soul = s.loot.roll({ id: 'soul_qinglong' });
  const seal = s.loot.roll({ id: 'qilin_seal' });
  const pill = s.loot.roll({ id: 'pill' });
  s.loot.give(soul);
  s.loot.give(seal);
  s.loot.give(pill);
  assert.ok(isUniqueItem(soul) && isUniqueItem(seal) && !isUniqueItem(pill));

  const c0 = s.copper;
  const r1 = s.command({ type: 'sell', itemIdx: 0 });
  assert.equal(r1.ok, false, '唯一神兽魂痕禁止出售');
  assert.match(r1.reason, /唯一道具/);
  assert.equal(s.inv.itemBag[0], soul);

  const r2 = s.command({ type: 'sell', itemIdx: 1 });
  assert.equal(r2.ok, false, '唯一灯魂印信禁止出售');
  assert.equal(s.copper, c0);

  // 普通消耗品可以正常出售
  const r3 = s.command({ type: 'sell', itemIdx: 2 });
  assert.ok(r3.ok && s.copper === c0 + pill.price);

  // 批量卖低阶凡铁：只卖普通凡铁，保留套装凡铁与高阶/唯一装备
  const plainLow = s.loot.roll({ slot: 'weapon', q: 0, set: 'plain', wave: 1 });
  const setLow = s.loot.roll({ slot: 'armor', q: 0, set: 'baihu', wave: 1 });
  const uniqueEq = s.loot.roll({ slot: 'weapon', q: 0, set: 'plain', wave: 1 });
  uniqueEq.unique = true;
  s.loot.give(plainLow);
  s.loot.give(setLow);
  s.loot.give(uniqueEq);
  const rBulk = s.command({ type: 'sellLowTier', maxQ: 0 });
  assert.ok(rBulk.ok && rBulk.sold === 1);
  assert.equal(s.inv.equipBag.includes(plainLow), false);
  assert.equal(s.inv.equipBag.includes(setLow), true, '套装装备受保护');
  assert.equal(s.inv.equipBag.includes(uniqueEq), true, '唯一装备受保护');
});

test('装备合成体系：同阶二合一升阶 + 6 件名将神兵定向锻造与专属被动', () => {
  const s = mk(4);
  s.copper = 2000;

  // 1. 二合一升阶：2 件凡铁武器 → 1 件精钢武器（保留套装）
  const w1 = s.loot.roll({ slot: 'weapon', q: 0, set: 'baihu', wave: 1 });
  const w2 = s.loot.roll({ slot: 'weapon', q: 0, set: 'plain', wave: 1 });
  s.loot.give(w1);
  s.loot.give(w2);
  assert.equal(s.craft.tierUps().length, 1);
  const up = s.command({ type: 'craftTierUp', slot: 'weapon', q: 0 });
  assert.ok(up.ok);
  assert.equal(up.item.q, 1, '升阶为精钢');
  assert.equal(up.item.set, 'baihu', '保留输入材料的套装属性');
  assert.equal(s.inv.equipBag.filter(Boolean).length, 1, '消耗 2 件产出 1 件');

  // 非法升阶校验：不能用同一格合成
  assert.equal(s.command({ type: 'craftTierUp', idxA: 0, idxB: 0 }).ok, false);

  // 2. 锻造名将神兵：青龙偃月刀（灵器武器×1 + 精钢武器×1 + 220钱）
  s.inv.equipBag.fill(null);
  const m1 = s.loot.roll({ slot: 'weapon', q: 2, wave: 8 });
  const m2 = s.loot.roll({ slot: 'weapon', q: 1, wave: 5 });
  s.loot.give(m1);
  s.loot.give(m2);
  assert.equal(s.craft.canCraft('qinglong_yanyuedao'), true);
  const res = s.command({ type: 'craftRecipe', recipeId: 'qinglong_yanyuedao' });
  assert.ok(res.ok);
  assert.equal(res.item.name, '青龙偃月刀');
  assert.equal(res.item.tex, 'g_eq_legend_qinglong_blade');
  assert.equal(res.item.crafted, true);
  assert.equal(res.item.passiveTag, 'yanyuedao');
  assert.equal(RECIPES.legendaries.length, 14); // 6 原有神兵 + 3 套装神兵 + 5 上古神器（含轩辕剑）
});

test('全部技能受装备加成且提升显著：伤害技能、治疗技能、护盾技能与神兵被动', () => {
  // 1. 霍青 E 技能：裸装 vs 穿青龙偃月刀 + 卧龙八阵图，伤害暴涨 ≥ 2.5 倍！
  const s1 = mk(5, { heroId: 'huoqing' });
  s1.command({ type: 'upgradeSkill', slot: 'e' });
  const dummy1 = s1.spawnEnemy('jiangshi', s1.hero.x + 60, s1.hero.y, { hpMul: 500 });
  dummy1.spd = 0; dummy1.atk = 0; dummy1.armor = 40;
  s1.step();
  const hpBefore1 = dummy1.hp;
  s1.castSkill(s1.hero, 'e', { x: dummy1.x, y: dummy1.y });
  const baseDmg = hpBefore1 - dummy1.hp;

  // 锻造并穿戴青龙偃月刀 + 卧龙八阵图
  const s2 = mk(5, { heroId: 'huoqing' });
  s2.command({ type: 'upgradeSkill', slot: 'e' });
  s2.copper = 3000;
  s2.loot.give(s2.loot.roll({ slot: 'weapon', q: 2, wave: 10 }));
  s2.loot.give(s2.loot.roll({ slot: 'weapon', q: 1, wave: 5 }));
  const rBlade = s2.command({ type: 'craftRecipe', recipeId: 'qinglong_yanyuedao' });
  assert.ok(rBlade.ok);
  s2.command({ type: 'equip', bagIdx: s2.inv.equipBag.indexOf(rBlade.item), unitId: s2.hero.id });

  s2.loot.give(s2.loot.roll({ slot: 'treasure', q: 2, wave: 10 }));
  s2.loot.give(s2.loot.roll({ slot: 'armor', q: 1, wave: 5 }));
  const rScroll = s2.command({ type: 'craftRecipe', recipeId: 'wolong_bazhentu' });
  assert.ok(rScroll.ok);
  s2.command({ type: 'equip', bagIdx: s2.inv.equipBag.indexOf(rScroll.item), unitId: s2.hero.id });

  const dummy2 = s2.spawnEnemy('jiangshi', s2.hero.x + 60, s2.hero.y, { hpMul: 500 });
  dummy2.spd = 0; dummy2.atk = 0; dummy2.armor = 40;
  s2.step();
  const hpBefore2 = dummy2.hp;
  s2.castSkill(s2.hero, 'e', { x: dummy2.x, y: dummy2.y });
  const gearedDmg = hpBefore2 - dummy2.hp;
  assert.ok(gearedDmg > baseDmg * 3.0, `神兵装备后技能伤害应暴涨 >=3x (${Math.round(baseDmg)} -> ${Math.round(gearedDmg)})`);

  // 2. 玄霜治疗技能（回春铃）受 skillDmg 装备加成
  const s3 = mk(6, { heroId: 'xuanshuang' });
  s3.command({ type: 'upgradeSkill', slot: 'e' });
  s3.kongming.hp = 500;
  const km0 = s3.kongming.hp;
  s3.castSkill(s3.hero, 'e', { x: s3.hero.x, y: s3.hero.y });
  const healBase = s3.kongming.hp - km0;

  s3.hero.cds.e = 0;
  s3.hero.base.skillDmg = 0.8; // 模拟 +80% 技能伤害装备
  s3.markDirty(s3.hero);
  s3.calcStats(s3.hero);
  s3.kongming.hp = 500;
  s3.castSkill(s3.hero, 'e', { x: s3.hero.x, y: s3.hero.y });
  const healGeared = s3.kongming.hp - 500;
  assert.ok(healGeared > healBase * 1.7, `治疗技能受技能伤害装备加成 (${Math.round(healBase)} -> ${Math.round(healGeared)})`);

  // 3. 玄武护盾技能（龟甲阵）受 skillDmg 装备加成
  const s4 = mk(7);
  const xw = s4.spawnUnit('beast', 'xuanwu', s4.hero.x + 40, s4.hero.y);
  s4.castSkill(xw, 'q', { x: xw.x, y: xw.y });
  const shBase = s4.hero.shield;
  s4.hero.shield = 0;
  xw.cds.q = 0;
  xw.base.skillDmg = 0.6;
  s4.markDirty(xw);
  s4.calcStats(xw);
  s4.castSkill(xw, 'q', { x: xw.x, y: xw.y });
  assert.ok(s4.hero.shield > shBase * 1.5, `玄武护盾受技能伤害装备加成 (${Math.round(shBase)} -> ${Math.round(s4.hero.shield)})`);
});

test('练功房系统：快捷进出、三阶切换、稳产经验铜钱装备、永不攻击孔明、可复用地图配置', () => {
  const s = mk(8, { heroId: 'huoqing' });
  s.wave.nextAt = 1e9; // 暂停主线波次以便专注测练功房
  const kmHp0 = s.kongming.hp;
  const copper0 = s.copper;

  // 进入练功房
  assert.ok(s.command({ type: 'enterTraining' }).ok);
  assert.equal(s.training.inRoom(), true);
  assert.equal(s.hero.realm, 'training');
  const mobs = s.enemies.filter((e) => e.alive && e.training);
  assert.ok(mobs.length >= 3, '进房立即刷新演武怪');

  // 初阶练功巡攻战斗 10 秒：稳产铜钱与经验，孔明毫发无损
  s.command({ type: 'attackMove', x: 4940, y: 625 });
  s.input.autoAttack = true;
  s.advance(10);
  assert.equal(s.kongming.hp, kmHp0, '练功房怪绝不攻击孔明');
  assert.ok(s.copper > copper0, `练功房击杀获得铜钱 (${copper0} -> ${s.copper})`);
  assert.ok(s.training.kills > 0, `练功房击杀数 ${s.training.kills}`);

  // 切换至中阶和高阶
  assert.ok(s.command({ type: 'setTrainingTier', tier: 'mid' }).ok);
  assert.equal(s.training.tier, 'mid');
  assert.ok(s.command({ type: 'setTrainingTier', tier: 'high' }).ok);
  assert.equal(s.training.tier, 'high');

  // 退出练功房返回基地
  assert.ok(s.command({ type: 'exitTraining' }).ok);
  assert.equal(s.training.inRoom(), false);
  assert.equal(s.hero.realm, null);

  // 地图无练功房配置时优雅禁用
  const noTrainMap = createMap({ trainingRoom: null });
  const sNo = mk(9, { map: noTrainMap });
  assert.equal(sNo.training, null);
  assert.equal(sNo.command({ type: 'enterTraining' }).ok, false);
});

test('复审回归：合成材料不重复计数 + 满包(30/30)连锻全部6件神兵 + 高阶神兵专属图标', () => {
  const s = mk(10);
  s.copper = 9999;
  // 只有 1 件灵器武器时，青龙偃月刀（灵器×1 + 精钢×1）第二项必须显示 0/1 且不可合成
  s.loot.give(s.loot.roll({ slot: 'weapon', q: 2, wave: 8 }));
  const ql = s.craft.recipes().find((x) => x.recipe.id === 'qinglong_yanyuedao');
  assert.equal(ql.mats[0].owned, 1);
  assert.equal(ql.mats[1].owned, 0, '单件灵器武器不可同时计入灵器与精钢两项材料');
  assert.equal(ql.hasMaterials, false);
  assert.equal(ql.canCraft, false);

  // 塞满 30/30 装备栏（含锻造全部 6 件神兵所需的 12 件材料 + 18 件普通填充），验证满包也能全部锻造成功
  s.inv.equipBag.fill(null);
  const mats = [
    ['weapon', 2], ['weapon', 1],
    ['weapon', 2], ['accessory', 1],
    ['weapon', 2], ['treasure', 1],
    ['armor', 2], ['armor', 1],
    ['accessory', 2], ['treasure', 1],
    ['treasure', 2], ['armor', 1],
  ];
  for (const [slot, q] of mats) assert.ok(s.loot.give(s.loot.roll({ slot, q, wave: 10 })));
  for (let i = mats.length; i < 30; i++) assert.ok(s.loot.give(s.loot.roll({ slot: 'weapon', q: 0, wave: 1 })));
  assert.equal(s.inv.equipBag.filter(Boolean).length, 30);

  for (const id of ['qinglong_yanyuedao', 'fangtian_huaji', 'zhuque_yushan', 'xuanwu_zhenyuejia', 'qilin_shengyin', 'wolong_bazhentu']) {
    const r = s.command({ type: 'craftRecipe', recipeId: id });
    assert.ok(r.ok, `满包应能锻造 ${id}: ${r.reason || ''}`);
    assert.ok(r.item.tex.startsWith('g_eq_legend_'), `${id} 应绑定专属神兵图标`);
  }

  // 高阶神兵(q=4)随机掉落也绑定专属图标
  const hi = s.loot.roll({ slot: 'weapon', q: 4, set: 'qinglong', wave: 20 });
  assert.equal(hi.tex, 'g_eq_legend_qinglong_blade');
});

test('复审回归：练功房切走操控后 AI 友军 3 秒自动归位 + 短距闪现/回城 prevX/prevY 瞬间吸附', () => {
  const s = mk(11, { heroId: 'azhu' });
  s.wave.nextAt = 1e9;
  const xw = s.spawnUnit('beast', 'xuanwu', s.kongming.x + 120, s.kongming.y + 80);
  // 英雄进入练功房后切走操控玄武 -> 英雄应在 3.5 秒内自动归位到主战区
  assert.ok(s.command({ type: 'enterTraining' }).ok);
  assert.equal(s.hero.realm, 'training');
  assert.ok(s.command({ type: 'switch', id: xw.id }).ok);
  s.advance(3.6);
  assert.equal(s.hero.realm, null, '留守练功房的非操控 AI 应自动返回主战区');

  // 短距闪现（<=220px）必须同步 prevX/prevY 防止渲染层插值滑动
  assert.ok(s.command({ type: 'switch', id: s.hero.id }).ok);
  const bx = s.hero.x + 120;
  const by = s.hero.y;
  const rb = s.command({ type: 'blink', x: bx, y: by });
  assert.ok(rb.ok);
  assert.equal(s.hero.prevX, s.hero.x);
  assert.equal(s.hero.prevY, s.hero.y);
});
