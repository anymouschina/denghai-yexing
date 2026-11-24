// v3.7 自动拾取 + 上古神器·轩辕剑（最大生命百分比真实伤害）无头单元测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, BAL } from '../../src/guard/sim/Sim.js';
import { ARTIFACT_IDS } from '../../src/guard/sim/systems/loot.js';
import { RECIPES } from '../../src/guard/sim/systems/craft.js';

const mk = (seed = 370, opts = {}) => new Sim({ seed, heroId: opts.heroId || 'huoqing', mode: 'story', fx: true, ...opts });

function wear(s, u, items) {
  for (const it of items) {
    assert.ok(s.loot.give(it));
    const idx = s.inv.equipBag.indexOf(it);
    assert.ok(s.command({ type: 'equip', bagIdx: idx, unitId: u.id }).ok);
  }
}

test('自动拾取：远处掉落的道具与装备无需走近，落地后自动收入行囊；主动丢弃的不被捡回', () => {
  const s = mk(1);
  s.wave.nextAt = 1e9;
  const h = s.hero;
  const GD = BAL.groundDrops;
  assert.equal(GD.autoPickup, true);
  const far = s.ground.spawn(s.loot.roll({ id: 'pill' }), h.x + 1500, h.y + 900);
  const eq = s.loot.roll({ slot: 'weapon', q: 3, wave: 10 });
  const farEq = s.ground.spawn(eq, h.x - 1400, h.y);
  const soul = s.ground.spawn(s.loot.roll({ id: 'soul_baihu' }), h.x + 2000, h.y, { unique: true });
  assert.equal(s.groundItems.length, 3, '落地瞬间仍可见');
  s.advance(GD.autoPickupDelay + GD.autoPickupInterval + 0.1);
  for (const g of [far, farEq, soul]) assert.ok(!s.groundItems.some((x) => x.id === g.id), '落地后自动拾取');
  assert.ok(s.inv.itemBag.some((it) => it && it.id === 'pill'));
  assert.ok(s.inv.equipBag.includes(eq), '装备自动入装备栏');
  assert.ok(s.inv.itemBag.some((it) => it && it.id === 'soul_baihu'), '唯一魂痕同样自动收取');

  // 主动丢弃 → 不会被自动捡回，可一键清地
  const idx = s.inv.bag.findIndex((it) => it && it.id === 'pill');
  const dr = s.command({ type: 'dropItem', bagIdx: idx });
  assert.ok(dr.ok && dr.drop.manual);
  s.advance(2);
  assert.ok(s.groundItems.some((g) => g.id === dr.drop.id), '主动丢弃的物品留在地面');
});

test('自动拾取：行囊满时掉落留在地上并提示，腾出格子后下一轮自动收取', () => {
  const s = mk(2);
  s.wave.nextAt = 1e9;
  for (let i = 0; i < s.inv.equipBag.length; i++) s.inv.equipBag[i] = s.loot.roll({ slot: 'armor', q: 0, wave: 1 });
  let blocked = 0;
  s.on('autoPickupBlocked', () => { blocked++; });
  const eq = s.loot.roll({ slot: 'weapon', q: 4, wave: 20 });
  const g = s.ground.spawn(eq, s.hero.x + 900, s.hero.y);
  s.advance(1.2);
  assert.ok(s.groundItems.some((x) => x.id === g.id), '满包不丢失、不自动卖');
  assert.ok(blocked >= 1, '满包推送提示事件');
  s.inv.equipBag[0] = null;
  s.advance(0.5);
  assert.ok(!s.groundItems.some((x) => x.id === g.id));
  assert.equal(s.inv.equipBag[0], eq, '腾出格子后自动收取');
});

test('上古神器·轩辕剑：命中附加目标最大生命 1% 真实伤害（无视护甲、内置冷却、AoE 只结算一次），可锻造可掉落', () => {
  const recipe = RECIPES.legendaries.find((r) => r.id === 'xuanyuan_sword');
  assert.ok(recipe && recipe.artifact && recipe.slot === 'weapon');
  assert.ok(ARTIFACT_IDS.includes('xuanyuan_sword'), '进入上古神器随机掉落池');
  const pct = recipe.effect.maxHpPct;
  const icd = recipe.effect.icd;

  const s = mk(3);
  s.wave.nextAt = 1e9;
  const h = s.hero;
  wear(s, h, [s.loot.roll({ artifactId: 'xuanyuan_sword' })]);
  const boss = s.spawnEnemy('jiangshi', h.x + 70, h.y, { hpMul: 2000 });
  boss.spd = 0; boss.atk = 0; boss.armor = 900;
  const other = s.spawnEnemy('jiangshi', h.x + 90, h.y + 20, { hpMul: 2000 });
  other.spd = 0; other.atk = 0;
  s.step();
  const pctHits = [];
  s.on('damage', ({ tgt, dmg, o }) => { if (o && o.tag === 'xuanyuan') pctHits.push({ tgt, dmg }); });

  s.damage(h, boss, 10);
  assert.equal(pctHits.length, 1, '命中触发一次百分比斩');
  assert.ok(Math.abs(pctHits[0].dmg - boss.maxHp * pct) < 1e-6, '伤害=最大生命×1%，无视 900 护甲且不吃增伤');
  s.damage(h, other, 10, { skill: true });
  assert.equal(pctHits.length, 1, '内置冷却内的第二个目标不再触发（AoE 只结算一次）');
  s.advance(icd + 0.05);
  s.damage(h, other, 10, { skill: true });
  assert.equal(pctHits.length, 2, '冷却结束后技能命中再次触发');
  assert.ok(s.fx.some((f) => f.t === 'bolt' && f.color === 0xffe08a), '推送金色斩妖落雷特效');
});
