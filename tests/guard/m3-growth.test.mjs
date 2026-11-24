// M3 成长无头测试：掉落表、品质随波数上移、装备改属性（含孔明）、2/4 件套（含孔明触发）、道具、出售、背包满、可复现
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import { ITEMS, SLOTS, qualityWeights } from '../../src/guard/sim/systems/loot.js';

const mk = (seed = 1, heroId = 'huoqing') => new Sim({ seed, heroId, mode: 'story', fx: false });
const fakeEnemy = (o = {}) => ({ alive: false, side: 'enemy', x: 0, y: 0, wave: 5, ...o });
const setPiece = (s, set, slot, q = 2) => s.loot.roll({ set, slot, q, wave: 5 });
function wear(s, u, items) {
  for (const it of items) {
    assert.ok(s.loot.give(it));
    const i = s.inv.bag.indexOf(it);
    assert.ok(s.command({ type: 'equip', bagIdx: i, unitId: u.id }).ok);
  }
}
const fullSet = (s, set) => SLOTS.map((sl) => setPiece(s, set, sl));
function strongEnemy(s, x, y, type = 'jiangshi') {
  const e = s.spawnEnemy(type, x, y, { hpMul: 200 });
  e.spd = 0; e.atk = 0; e.cdMax = 99; e.cd = 99; // 木桩：不动不打，便于测触发
  return e;
}

test('掉落按表：普通 1.2% 装备，精英必掉 1 件，BOSS 3 件且至少精品', () => {
  const s = mk(11);
  const N = 40000;
  let eq = 0; let items = 0;
  for (let i = 0; i < N; i++) for (const it of s.loot.dropsFor(fakeEnemy())) { if (it.kind === 'equip') eq++; else items++; }
  const rate = eq / N;
  assert.ok(Math.abs(rate - ITEMS.drops.normal.equip) < 0.003, `普通装备掉率 ${rate}`);
  const itemRate = Object.values(ITEMS.drops.normal.items).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(items / N - itemRate) < 0.004, `普通道具掉率 ${items / N}`);
  for (let i = 0; i < 200; i++) {
    const d = s.loot.dropsFor(fakeEnemy({ elite: true }));
    assert.equal(d.filter((x) => x.kind === 'equip').length, 1);
    const b = s.loot.dropsFor(fakeEnemy({ boss: 'lz', wave: 10 }));
    const be = b.filter((x) => x.kind === 'equip');
    assert.equal(be.length, 3);
    assert.ok(be.every((x) => x.q >= 2), 'BOSS 掉落至少精品');
  }
});

test('击杀走掉落表直接进背包（精英击杀→背包多 1 件装备，发 itemGain）', () => {
  const s = mk(2);
  let gains = 0;
  s.on('itemGain', () => gains++);
  const e = s.spawnEnemy('paperman', 2000, 1700, { elite: true });
  s.kill(e, s.hero);
  assert.equal(s.inv.bag.filter((x) => x && x.kind === 'equip').length, 1);
  assert.ok(gains >= 1);
});

test('品质随波数上移，装备等级随波数', () => {
  const w1 = qualityWeights(1); const w30 = qualityWeights(30);
  const share = (w, q) => w[q] / w.reduce((a, b) => a + b, 0);
  for (let q = 2; q < 5; q++) assert.ok(share(w30, q) > share(w1, q) * 2, `品质 ${q} 占比上移`);
  const s = mk(3);
  const avg = (wave) => { let t = 0; for (let i = 0; i < 4000; i++) t += s.loot.roll({ wave }).q; return t / 4000; };
  const a1 = avg(1); const a30 = avg(30);
  assert.ok(a30 > a1 + 0.8, `平均品质 1 波 ${a1.toFixed(2)} → 30 波 ${a30.toFixed(2)}`);
  const lo = s.loot.roll({ wave: 1, slot: 'weapon', q: 0 }); const hi = s.loot.roll({ wave: 30, slot: 'weapon', q: 0 });
  assert.equal(hi.lv, 30);
  assert.ok(hi.main.add > lo.main.add * 2, '高等级主属性更高');
  const q4 = s.loot.roll({ wave: 1, slot: 'weapon', q: 4 });
  assert.ok(Math.abs(q4.main.add / lo.main.add - 3) < 0.05, '绝品倍率 3.0');
  assert.equal(q4.subs.length, 3);
  assert.equal(lo.subs.length, 0);
});

test('装备改变属性：穿上武器加攻击，卸下恢复；同槽替换回背包', () => {
  const s = mk(4);
  const h = s.hero;
  const atk0 = h.stats.atk;
  const w = s.loot.roll({ slot: 'weapon', q: 3, wave: 10 });
  s.loot.give(w);
  assert.ok(s.command({ type: 'equip', bagIdx: 0, unitId: h.id }).ok);
  assert.ok(Math.abs(h.stats.atk - (atk0 + w.main.add + (w.subs.find((m) => m.stat === 'atk')?.add || 0))) < 1e-6);
  assert.equal(s.inv.bag[0], null);
  const w2 = s.loot.roll({ slot: 'weapon', q: 0, wave: 1 });
  s.loot.give(w2);
  const r = s.command({ type: 'equip', bagIdx: 0, unitId: h.id });
  assert.ok(r.ok && r.swapped === w && s.inv.bag[0] === w, '旧装备回到原格');
  assert.ok(s.command({ type: 'unequip', unitId: h.id, slot: 'weapon' }).ok);
  assert.ok(Math.abs(h.stats.atk - atk0) < 1e-6);
  assert.equal(s.command({ type: 'equip', bagIdx: 29, unitId: h.id }).ok, false);
});

test('给孔明穿装备后孔明属性变化；守卫不能穿', () => {
  const s = mk(5);
  const k = s.kongming;
  const hp0 = k.maxHp; const atk0 = k.stats.atk;
  const a = s.loot.roll({ slot: 'armor', q: 2, wave: 5 });
  a.main = { stat: 'maxHp', add: 300 }; a.subs = [];
  wear(s, k, [a, s.loot.roll({ slot: 'weapon', q: 2, wave: 5 })]);
  assert.equal(k.maxHp, hp0 + 300);
  assert.equal(Object.values(s.inv.equip.kongming).filter(Boolean).length, 2, '试玩快照用的别名');
  assert.ok(k.stats.atk > atk0);
  const m = s.spawnUnit('merc', 'dao', 2000, 2200);
  s.loot.give(s.loot.roll({ slot: 'weapon' }));
  assert.equal(s.command({ type: 'equip', bagIdx: s.inv.bag.findIndex(Boolean), unitId: m.id }).ok, false);
});

test('2/4 件套：属性加成、setActive 事件、activeSets / bestSetText', () => {
  const s = mk(6);
  const h = s.hero;
  const ev = [];
  s.on('setActive', (d) => ev.push(`${d.set}${d.pieces}`));
  const crit0 = h.stats.crit; const cd0 = h.stats.critDmg;
  const pcs = fullSet(s, 'baihu');
  for (const p of pcs) p.subs = [];
  pcs[2].main = { stat: 'aspd', mul: 0.04 }; // 去掉饰品主属性里的暴击，便于精确断言
  wear(s, h, pcs.slice(0, 2));
  assert.ok(Math.abs(h.stats.crit - (crit0 + 0.10)) < 1e-9, '杀伐 2 件暴击 +10%');
  assert.deepEqual(s.activeSets(h), ['杀伐2']);
  wear(s, h, pcs.slice(2));
  assert.ok(Math.abs(h.stats.critDmg - cd0 * 1.5) < 1e-9, '杀伐 4 件暴伤 +50%');
  assert.deepEqual(ev, ['baihu2', 'baihu4']);
  assert.deepEqual(s.activeSets(), ['杀伐4']);
  assert.match(s.bestSetText(), /杀伐4件/);
  // 其余套装 2 件属性
  const s2 = mk(7);
  const k = s2.kongming;
  const b = { ...k.stats };
  for (const set of ['wolong', 'zhuque', 'xuanwu', 'qinglong']) {
    const two = [setPiece(s2, set, 'weapon'), setPiece(s2, set, 'armor')];
    for (const p of two) { p.main = { stat: 'def', add: 0 }; p.subs = []; }
    s2.inv.equip[k.id] = null; s2.inv.tiers[k.id] = {};
    wear(s2, k, two);
    const st = k.stats;
    if (set === 'wolong') assert.ok(Math.abs(st.cdr - (b.cdr + 0.15)) < 1e-9);
    if (set === 'zhuque') assert.ok(Math.abs(st.dmg - (b.dmg + 0.15)) < 1e-9);
    if (set === 'xuanwu') assert.equal(k.maxHp, Math.round(b.maxHp * 1.2));
    if (set === 'qinglong') assert.ok(Math.abs(st.aspd - b.aspd * 1.15) < 1e-9);
  }
});

test('4 件套触发对孔明生效：卧龙八阵图 / 离火灼烧 / 惊雷连锁', () => {
  for (const [set, check] of [
    ['wolong', (s) => s.stats.dmgBy['kongming:kongming/bazhen'] > 0],
    ['zhuque', (s) => s.stats.dmgBy['kongming:kongming/burn'] > 0],
    ['qinglong', (s) => s.stats.dmgBy['kongming:kongming/jinglei'] > 0],
  ]) {
    const s = mk(8);
    s.hero.x = 3500; s.hero.y = 3500; // 英雄离远，只看孔明
    s.wave.nextAt = 1e9; // 不刷主线怪
    const k = s.kongming;
    wear(s, k, fullSet(s, set));
    assert.deepEqual(s.activeSets(k), [`${ITEMS.sets[set].name}4`]);
    for (let i = 0; i < 4; i++) strongEnemy(s, k.x - 60 + i * 40, k.y - 200);
    const procs = [];
    s.on('setProc', (d) => { if (d.unit === k) procs.push(d.set); });
    s.advance(25);
    assert.ok(check(s), `${set} 4 件对孔明生效 ${JSON.stringify(s.stats.dmgBy)}`);
    if (set !== 'zhuque') assert.ok(procs.includes(set));
  }
});

test('镇岳 4 件：减伤 20% + 低血护盾（冷却 30 秒）；杀伐 4 件击杀回血', () => {
  const s = mk(9);
  const k = s.kongming;
  wear(s, k, fullSet(s, 'xuanwu'));
  assert.ok(Math.abs(k.stats.dmgTaken - 0.2) < 1e-9);
  const e = strongEnemy(s, k.x, k.y - 200);
  k.hp = k.maxHp * 0.35;
  s.damage(e, k, k.maxHp * 0.2, { canCrit: false });
  assert.ok(k.shield > k.maxHp * 0.2, '低血触发护盾');
  k.shield = 0;
  s.damage(e, k, 1, { canCrit: false });
  assert.equal(k.shield, 0, '冷却中不再触发');
  s.advance(31);
  if (k.alive && k.hp / k.maxHp < 0.3) { s.damage(e, k, 1, { canCrit: false }); assert.ok(k.shield > 0, '冷却结束可再次触发'); }

  const s2 = mk(10);
  const h = s2.hero;
  wear(s2, h, fullSet(s2, 'baihu'));
  h.hp = h.maxHp * 0.5;
  const hp0 = h.hp;
  const pm = s2.spawnEnemy('paperman', h.x + 50, h.y);
  s2.kill(pm, h);
  assert.ok(Math.abs(h.hp - (hp0 + h.maxHp * 0.02)) < 1e-6, '击杀回复 2% 生命');
});

test('道具效果：回春丹 / 灯油 / 铜钱袋 / 神行符（可叠放）', () => {
  const s = mk(12);
  const h = s.hero; const k = s.kongming;
  for (const id of ['pill', 'pill', 'oil', 'purse', 'swift']) s.loot.give(s.loot.roll({ id }));
  const stack = s.inv.bag.find((x) => x && x.id === 'pill');
  assert.equal(stack.n, 2, '同种道具叠放');
  const idx = (id) => s.inv.bag.findIndex((x) => x && x.id === id);
  assert.equal(s.command({ type: 'useItem', bagIdx: idx('pill') }).ok, false, '满血不能吃');
  h.hp = h.maxHp * 0.3;
  assert.ok(s.command({ type: 'useItem', bagIdx: idx('pill') }).ok);
  assert.ok(Math.abs(h.hp - h.maxHp * 0.7) < 1e-6);
  assert.equal(stack.n, 1);
  k.hp = k.maxHp * 0.5;
  assert.ok(s.command({ type: 'useItem', bagIdx: idx('oil') }).ok);
  assert.ok(Math.abs(k.hp - k.maxHp * 0.65) < 1e-6);
  const c0 = s.copper;
  assert.ok(s.command({ type: 'useItem', bagIdx: idx('purse') }).ok);
  assert.equal(s.copper, c0 + 80);
  const spd0 = h.stats.spd;
  assert.ok(s.command({ type: 'useItem', bagIdx: idx('swift') }).ok);
  s.step();
  assert.ok(Math.abs(h.stats.spd - spd0 * 1.4) < 1e-6);
  s.advance(10.5);
  assert.ok(Math.abs(h.stats.spd - spd0) < 1e-6, '10 秒后失效');
  assert.equal(idx('swift'), -1);
});

test('出售与整理', () => {
  const s = mk(13);
  const a = s.loot.roll({ q: 0, wave: 1 }); const b = s.loot.roll({ q: 4, wave: 1 });
  s.loot.give(a); s.loot.give(b);
  const c0 = s.copper;
  assert.ok(s.command({ type: 'sell', bagIdx: 0 }).ok);
  assert.equal(s.copper, c0 + a.price);
  assert.equal(s.inv.bag[0], null);
  assert.ok(s.command({ type: 'sort' }).ok);
  assert.equal(s.inv.bag[0], b);
  assert.equal(s.command({ type: 'sell', bagIdx: 5 }).ok, false);
});

test('背包满：掉落自动卖成铜钱并提示；卸装备时背包满会拒绝', () => {
  const s = mk(14);
  const h = s.hero;
  wear(s, h, [s.loot.roll({ slot: 'weapon' })]);
  for (let i = 0; i < 30; i++) assert.ok(s.loot.give(s.loot.roll({ wave: 3 })));
  assert.equal(s.loot.give(s.loot.roll({ wave: 3 })), false);
  let full = null;
  s.on('bagFull', (d) => { full = d; });
  const c0 = s.copper;
  const e = s.spawnEnemy('paperman', 2000, 1700, { elite: true });
  s.kill(e, s.hero);
  assert.ok(full && full.copper > 0);
  assert.ok(s.copper >= c0 + full.copper);
  assert.equal(s.inv.equipBag.filter(Boolean).length, 30);
  assert.equal(s.command({ type: 'unequip', unitId: h.id, slot: 'weapon' }).ok, false);
});

test('同种子掉落可复现（整局推进 6 分钟）', () => {
  const run = () => {
    const s = mk(77, 'azhu');
    s.input.attack = true;
    s.advance(360);
    return JSON.stringify([s.inv.gained, s.inv.bag.map((x) => x && [x.name, x.q, x.lv, x.n || 0, x.main?.stat]), s.copper]);
  };
  const a = run();
  assert.equal(a, run());
});
