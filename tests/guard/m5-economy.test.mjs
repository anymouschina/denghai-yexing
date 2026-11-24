// M5 经营无头测试：建造 / 升级 / 拆除 / 重建、塔攻击、拒马阻挡与反伤、灯柱治疗；雇佣与升级；孔明军令
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import BD from '../../src/guard/data/buildings.json' with { type: 'json' };
import { addQuest } from '../../src/guard/sim/systems/quests.js';
import { upgradeCost } from '../../src/guard/sim/systems/buildings.js';

const mk = (seed = 5) => new Sim({ seed, heroId: 'azhu', mode: 'story', fx: false });
// 北路内圈地基（离孔明约 365，靠近孔明的操控单位即可建造）
const innerN = (s) => s.foundations.find((f) => f.lane === 'N' && Math.abs(f.y - 1670) < 1 && f.x > 2000);
const farF = (s) => s.foundations.reduce((a, f) => ((f.x - 2000) ** 2 + (f.y - 2000) ** 2 > (a.x - 2000) ** 2 + (a.y - 2000) ** 2 ? f : a));

test('建造扣钱；离地基太远建造失败，走近后成功', () => {
  const s = mk();
  s.quests.active.length = 0; // 只测建造扣费，不让开局军令奖励干扰
  s.copper = 1000;
  const f = innerN(s);
  const r = s.command({ type: 'build', fid: f.id, bld: 'arrow' });
  assert.ok(r.ok, r.reason);
  assert.equal(s.copper, 900);
  assert.equal(f.bid, r.b.id);
  assert.equal(s.buildings.length, 1);
  const b = s.buildings[0];
  assert.equal(b.kind, 'building');
  assert.equal(b.tex, 'g_bld_arrow');
  assert.ok(!s.command({ type: 'build', fid: f.id, bld: 'fu' }).ok, '同一地基不能再建');
  const far = farF(s);
  const bad = s.command({ type: 'build', fid: far.id, bld: 'arrow' });
  assert.ok(!bad.ok && /远/.test(bad.reason));
  assert.equal(s.copper, 900, '失败不扣钱');
  s.hero.x = far.x + 150; s.hero.y = far.y;
  assert.ok(s.command({ type: 'build', fid: far.id, bld: 'arrow' }).ok);
  s.copper = 10;
  const poor = s.command({ type: 'build', fid: innerN(s).id + 1, bld: 'lei' });
  assert.ok(!poor.ok);
});

test('箭楼 / 符塔 / 雷坛会攻击并计入 bld: 伤害', () => {
  for (const type of ['arrow', 'fu', 'lei']) {
    const s = mk();
    s.copper = 1000;
    const f = innerN(s);
    assert.ok(s.command({ type: 'build', fid: f.id, bld: type }).ok);
    const es = [0, 1, 2].map((i) => s.spawnEnemy('paperman', f.x + 40 * i, f.y - 300, { extra: { aggro: 1 } }));
    s.advance(4);
    const dealt = Object.entries(s.stats.dmgBy).filter(([k]) => k.startsWith(`bld:${type}`)).reduce((a, [, v]) => a + v, 0);
    assert.ok(dealt > 30, `${type} 造成伤害 ${dealt}`);
    assert.ok(es.some((e) => !e.alive || e.hp < e.maxHp));
  }
});

test('拒马阻挡地面妖物，夜鸦飞越；近身攻击拒马会被反伤', () => {
  const s = mk();
  s.copper = 1000;
  const f = innerN(s);
  const w = s.command({ type: 'build', fid: f.id, bld: 'wall' }).b;
  assert.ok(w.block);
  const K = s.kongming;
  const L = Math.hypot(w.x - K.x, w.y - K.y);
  const dx = (w.x - K.x) / L; const dy = (w.y - K.y) / L;
  const g = s.spawnEnemy('paperman', w.x + dx * 220, w.y + dy * 220, { extra: { aggro: 1 } });
  const y = s.spawnEnemy('yeya', w.x + dx * 220, w.y + dy * 220);
  let minG = Infinity;
  for (let i = 0; i < 30 * 8; i++) { s.step(); minG = Math.min(minG, Math.hypot(g.x - K.x, g.y - K.y)); }
  assert.ok(g.tgt === w || !g.alive, '被挡住的妖物转而攻击拒马');
  assert.ok(minG > L, `地面妖物没越过拒马（最近 ${minG.toFixed(0)}，拒马 ${L.toFixed(0)}）`);
  assert.ok(!y.alive || Math.hypot(y.x - K.x, y.y - K.y) < 200, '夜鸦飞过拒马扑向孔明');
  // 反伤
  const s2 = mk();
  s2.copper = 1000;
  const w2 = s2.command({ type: 'build', fid: innerN(s2).id, bld: 'wall' }).b;
  const j = s2.spawnEnemy('jiangshi', w2.x + 80, w2.y - 60);
  s2.advance(6);
  assert.ok(w2.hp < w2.maxHp, '拒马被打');
  assert.ok((s2.stats.dmgBy['bld:wall/thorns'] || 0) > 0, '反伤生效');
  assert.ok(j.hp < j.maxHp || !j.alive);
});

test('灯柱治疗孔明', () => {
  const s = mk();
  s.copper = 1000;
  const f = innerN(s);
  assert.ok(s.command({ type: 'build', fid: f.id, bld: 'lamp' }).ok);
  s.kongming.hp -= 600;
  const h0 = s.kongming.hp;
  s.advance(3);
  assert.ok(s.kongming.hp > h0 + 20, `孔明被治疗 ${h0} → ${s.kongming.hp}`);
  assert.ok(s.bldStats.healed > 0);
});

test('升级费用 ×1.2/×1.8、满级 3、拆除返还 50%、被拆毁后可重建', () => {
  const s = mk();
  s.copper = 2000;
  const f = innerN(s);
  const b = s.command({ type: 'build', fid: f.id, bld: 'arrow' }).b;
  assert.equal(upgradeCost('arrow', 1), 120);
  assert.equal(upgradeCost('arrow', 2), 180);
  const hp1 = b.maxHp;
  let c = s.copper;
  assert.ok(s.command({ type: 'upgrade', bid: b.id }).ok);
  assert.equal(s.copper, c - 120);
  assert.equal(b.lv, 2);
  assert.ok(b.maxHp > hp1);
  c = s.copper;
  assert.ok(s.command({ type: 'upgrade', bid: b.id }).ok);
  assert.equal(s.copper, c - 180);
  assert.equal(b.lv, 3);
  assert.ok(!s.command({ type: 'upgrade', bid: b.id }).ok, '满级');
  c = s.copper;
  const r = s.command({ type: 'demolish', bid: b.id });
  assert.ok(r.ok);
  assert.equal(r.refund, Math.round((100 + 120 + 180) * BD.refund));
  assert.equal(s.copper, c + 200);
  assert.equal(f.bid, null);
  // 被拆毁 → 地基空出 → 可重建
  const w = s.command({ type: 'build', fid: f.id, bld: 'wall' }).b;
  s.damage(null, w, 1e7);
  assert.equal(w.alive, false);
  assert.equal(f.bid, null);
  assert.ok(s.command({ type: 'build', fid: f.id, bld: 'fu' }).ok, '重建');
});

test('雇佣扣钱、上限 6、雇佣兵可被操控、升级生效', () => {
  const s = mk();
  s.copper = 80;
  const r = s.command({ type: 'hire', key: 'dao' });
  assert.ok(r.ok, r.reason);
  assert.equal(s.copper, 0);
  assert.ok(s.party.includes(r.u.id));
  assert.ok(Math.hypot(r.u.x - s.kongming.x, r.u.y - s.kongming.y) < 250, '出生在孔明身边');
  assert.ok(!s.command({ type: 'hire', key: 'nu' }).ok, '钱不够');
  s.copper = 5000;
  for (const k of ['nu', 'tong', 'dao', 'nu', 'tong']) assert.ok(s.command({ type: 'hire', key: k }).ok);
  const full = s.command({ type: 'hire', key: 'dao' });
  assert.ok(!full.ok && /6/.test(full.reason), '上限 6');
  assert.ok(s.command({ type: 'switch', id: r.u.id }).ok);
  assert.equal(s.ctrlId, r.u.id);
  const hp0 = r.u.maxHp; const atk0 = r.u.stats.atk;
  const c = s.copper;
  assert.ok(s.command({ type: 'upgradeMerc', id: r.u.id }).ok);
  assert.equal(s.copper, c - 90);
  assert.equal(r.u.lv, 2);
  assert.ok(Math.abs(r.u.maxHp / hp0 - 1.35) < 0.01);
  assert.ok(Math.abs(r.u.stats.atk / atk0 - 1.35) < 0.01);
  s.advance(0.5);
  assert.ok(Math.abs(r.u.stats.atk / atk0 - 1.35) < 0.01, '重算属性后仍保留');
  assert.ok(s.command({ type: 'upgradeMerc', id: r.u.id }).ok);
  assert.ok(!s.command({ type: 'upgradeMerc', id: r.u.id }).ok, '最多 3 级');
});

test('军令：开局发布「筑箭楼」（布阵期也能完成），完成发奖励', () => {
  const s = mk();
  s.advance(9);
  assert.equal(s.wave.n, 1);
  assert.equal(s.quests.active.length, 1);
  const q = s.quests.active[0];
  assert.equal(q.tpl, 'build_arrow');
  const c = s.copper;
  assert.ok(s.command({ type: 'build', fid: innerN(s).id, bld: 'arrow' }).ok);
  assert.equal(q.state, 'done');
  assert.equal(s.quests.done, 1);
  assert.equal(s.copper, c - 100 + q.reward.copper);
  assert.ok(q.reward.copper >= 60);
});

test('军令：过期失败；每 2 波发布、最多 2 个', () => {
  const s = mk(11);
  s.advance(9);
  const q = s.quests.active[0];
  while (s.wave.n <= q.deadline) assert.ok(s.command({ type: 'callWave' }).ok);
  assert.equal(q.state, 'fail');
  assert.ok(s.quests.history.includes(q));
  for (let i = 0; i < 10; i++) { s.command({ type: 'callWave' }); assert.ok(s.quests.active.length <= 2); }
  assert.ok(s.quests.history.length + s.quests.active.length >= 3, '持续发布');
});

test('军令：给孔明穿装备在 equip 事件后完成，给英雄穿不算；奖励含孔明增益', () => {
  const s = mk();
  s.advance(9);
  const q = addQuest(s, 'equipKm');
  s.emit('equip', { unit: s.hero, item: {}, slot: 'weapon' });
  assert.equal(q.state, 'active');
  const c = s.copper;
  s.emit('equip', { unit: s.kongming, item: {}, slot: 'weapon' });
  assert.equal(q.state, 'done');
  assert.ok(s.copper > c, '未接入 M3 时装备奖励退化为铜钱');
  const h = addQuest(s, 'hire');
  for (let i = 0; i < h.need; i++) { s.copper += 200; s.command({ type: 'hire', key: 'dao' }); }
  assert.equal(h.state, 'done');
  assert.ok(s.kongming.buffs.some((b) => b.id === 'quest_km_ward'), '孔明获得临时增益');
});

test('军令：本波护灯与击杀类', () => {
  const s = mk();
  s.advance(9);
  const g = addQuest(s, 'kmGuard');
  s.command({ type: 'callWave' });
  assert.equal(g.state, 'done', '孔明没掉血 → 完成');
  const k = addQuest(s, 'kill');
  for (let i = 0; i < k.need; i++) { const e = s.spawnEnemy(k.enemy, 100, 100); s.damage(null, e, 1e6); }
  assert.equal(k.state, 'done');
});

test('军令：开波前就造箭楼也算完成', () => {
  const s = mk();
  assert.equal(s.quests.active[0]?.tpl, 'build_arrow');
  assert.ok(s.command({ type: 'build', fid: innerN(s).id, bld: 'arrow' }).ok);
  assert.equal(s.quests.done, 1);
});
