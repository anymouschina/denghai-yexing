// 存档 / 读档自动化测试：整图快照往返、关键状态逐项核对、版本与损坏兜底、存储配额降级、自动存档调度、读档后继续长跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import { PlayerBot } from './bot/player.mjs';
import { captureSim, restoreSim, SAVE_VERSION } from '../../src/guard/persist/snapshot.js';
import { writeRun, readRun, listRuns, latestRun, deleteRun, setStorageBackend, checksum } from '../../src/guard/persist/store.js';
import { attachAutosave, AUTOSAVE_EVERY_SEC } from '../../src/guard/persist/autosave.js';

const memStore = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
};
const fresh = () => { const st = memStore(); setStorageBackend(st); return st; };

function play(seed, hero, wave, mode = 'story') {
  const s = new Sim({ seed, heroId: hero, mode, fx: false });
  const b = new PlayerBot(s, { kind: 'proxy', sigma: 0.05, seed: seed ^ 77 });
  while (!s.over && s.wave.n < wave && s.t < 4000) { b.step(); s.step(); }
  return { s, b };
}
// 抓取前后对比用：去掉渲染插值字段（读档会把上一帧位置对齐到当前位置）
const norm = (snap) => JSON.stringify(snap.graph).replace(/"prev[XY]":-?[\d.e+-]+,?/g, '');
const keyState = (s) => ({
  t: s.t, copper: s.copper, wave: { ...s.wave }, kills: s.stats.kills,
  hero: { id: s.hero.id, lv: s.hero.lv, xp: s.hero.xp, hp: s.hero.hp, skillLvs: { ...s.hero.skillLvs }, skillPoints: s.hero.skillPoints, x: s.hero.x, y: s.hero.y },
  km: { hp: s.kongming.hp, maxHp: s.kongming.maxHp },
  equip: JSON.parse(JSON.stringify(s.inv.equip)), bag: JSON.parse(JSON.stringify(s.inv.bag)),
  buildings: s.buildings.filter((b) => b.alive).map((b) => ({ fid: b.fid, key: b.key, lv: b.lv, hp: b.hp })),
  party: [...s.party], units: s.units.filter((u) => u.alive).map((u) => `${u.kind}:${u.key}:${u.lv}`).sort(),
  realms: s.realms && JSON.parse(JSON.stringify(s.realms.state || {})), quests: JSON.parse(JSON.stringify(s.quests)),
  sets: s.activeSets ? s.activeSets() : null, enemies: s.enemies.filter((e) => e.alive).length,
});

test('整图快照往返：capture → JSON → restore → 再 capture 逐位一致（多英雄 / 多波次）', () => {
  for (const [seed, hero, wave] of [[11, 'huoqing', 4], [21, 'azhu', 9], [31, 'xuanshuang', 13]]) {
    const { s } = play(seed, hero, wave);
    for (const u of s.units) if (u.alive) s.calcStats(u); // 抓取前把待重算的属性结算掉（读档同样会重算）
    const a = captureSim(s);
    assert.equal(a.lostCount, 0, '具名函数都已登记，没有丢失的闭包（update 等）');
    const s2 = new Sim({ seed: a.sim.seed, heroId: a.sim.heroId, mode: a.sim.mode, fx: false });
    restoreSim(s2, JSON.parse(JSON.stringify(a)));
    assert.equal(norm(captureSim(s2)), norm(a), `${hero} 第 ${wave} 波快照往返一致`);
    assert.deepEqual(keyState(s2), keyState(s));
    assert.equal(s2.rng(), s.rng(), '随机数序列从存档点无缝继续');
  }
});

test('关键进度完整还原：英雄 / 装备行囊套装 / 建筑 / 资源 / 波次 / 秘境 / 军令', () => {
  fresh();
  const { s } = play(5, 'huoqing', 14);
  assert.ok(s.hero.lv > 3 && s.buildings.length > 0 && s.copper >= 0, '机器人推到后期，有成长有建筑');
  const w = writeRun(s, 'manual');
  assert.ok(w.ok && w.slot === 'manual');
  const r = readRun('manual', { fx: false });
  assert.ok(r.ok, r.reason);
  const s2 = r.sim;
  assert.deepEqual(keyState(s2), keyState(s));
  assert.equal(s2.hero, s2.units.find((u) => u.id === s.hero.id), 'sim.hero 与 units 里的英雄是同一对象');
  assert.equal(s2.kongming, s2.units.find((u) => u.kind === 'kongming'));
  assert.equal(s2.ctrlId, s.ctrlId);
  // 共享引用：妖物目标指向还原后的同一单位
  const withTgt = s2.enemies.find((e) => e.tgt && e.tgt.side === 'ally');
  if (withTgt) assert.equal(withTgt.tgt, s2.byId(withTgt.tgt.id) || s2.buildings.find((b) => b === withTgt.tgt));
  // 地基 ↔ 建筑
  for (const f of s2.foundations) if (f.bid) assert.ok(s2.buildings.find((b) => b.id === f.bid), '地基指向的建筑存在');
  // 妖物行为函数按登记名还原（boss / 强盗 / 狼等）
  for (const e of s.enemies) { const e2 = s2.enemies.find((x) => x.id === e.id); assert.ok(e2, `妖物 ${e.id} 还原`); assert.equal(typeof e2.update, typeof e.update); if (e.update) assert.equal(e2.update, e.update); }
  // 系统 API 仍在（对象身份保留）
  assert.equal(typeof s2.loot.roll, 'function');
  assert.equal(typeof s2.shop.catalog, 'function');
});

test('读档后继续运行：命令可用、无异常、进度推进，装备仍生效', () => {
  fresh();
  const { s } = play(8, 'yunque', 10);
  writeRun(s, 'manual');
  const r = readRun('manual', { fx: false });
  const s2 = r.sim;
  const atkBefore = s2.hero.stats.atk;
  assert.equal(atkBefore, s.hero.stats.atk, '属性由还原后的装备重算，与存档时一致');
  const b2 = new PlayerBot(s2, { kind: 'proxy', sigma: 0.05, seed: 4 });
  const w0 = s2.wave.n; const k0 = s2.stats.kills;
  for (let i = 0; i < 30 * 120 && !s2.over; i++) { b2.step(); s2.step(); }
  assert.ok(s2.t > s.t + 100 || s2.over);
  assert.ok(s2.stats.kills > k0 || s2.wave.n > w0, '读档后战斗/波次继续推进');
  assert.ok(Number.isFinite(s2.hero.x) && Number.isFinite(s2.copper));
});

test('确定性：同一存档两次读出，各自继续运行得到完全相同的结果', () => {
  fresh();
  const { s } = play(3, 'huoqing', 7);
  writeRun(s, 'manual');
  const run = () => { const r = readRun('manual', { fx: false }); r.sim.advance(20); return JSON.stringify([r.sim.t, r.sim.stats.kills, r.sim.copper, r.sim.enemies.length, r.sim.wave.n, Math.round(r.sim.kongming.hp)]); };
  assert.equal(run(), run());
});

test('版本校验与异常兜底：高版本 / 低版本 / 校验失败 / 截断 / 垃圾 / 缺字段，一律 ok:false 且不抛异常', () => {
  const st = fresh();
  const { s } = play(2, 'huoqing', 3);
  writeRun(s, 'manual');
  const key = [...st.m.keys()].find((k) => k.endsWith('manual'));
  const good = st.m.get(key);
  const mutate = (fn) => { const p = JSON.parse(good); fn(p); st.m.set(key, JSON.stringify(p)); };
  mutate((p) => { p.version = SAVE_VERSION + 1; });
  let r = readRun('manual'); assert.ok(!r.ok && r.incompatible && /更新游戏/.test(r.reason));
  mutate((p) => { p.version = SAVE_VERSION - 1; });
  r = readRun('manual'); assert.ok(!r.ok && r.incompatible && /过旧/.test(r.reason));
  mutate((p) => { p.data = p.data.slice(0, -50); });
  r = readRun('manual'); assert.ok(!r.ok && r.corrupt && /校验/.test(r.reason));
  mutate((p) => { p.data = '{"bad":'; p.sum = checksum(p.data); });
  r = readRun('manual'); assert.ok(!r.ok && r.corrupt, '校验通过但内容不是合法快照 → 还原失败兜底');
  mutate((p) => { p.data = JSON.stringify({ sim: { seed: 1, heroId: 'huoqing', mode: 'story' }, graph: { nodes: [], root: { $: 0 } } }); p.sum = checksum(p.data); });
  r = readRun('manual'); assert.ok(!r.ok && r.corrupt);
  st.m.set(key, good.slice(0, 40));
  r = readRun('manual'); assert.ok(!r.ok && r.corrupt && /无法解析/.test(r.reason));
  st.m.set(key, '{"hello":1}');
  r = readRun('manual'); assert.ok(!r.ok && r.corrupt);
  st.m.set(key, good);
  assert.ok(readRun('manual').ok, '原始存档仍可读');
  deleteRun('manual');
  r = readRun('manual'); assert.ok(!r.ok && r.empty);
  assert.equal(latestRun(), null);
  assert.equal(listRuns().length, 2);
});

test('存储降级：localStorage 配额满 / 不可用时退回内存，不崩', () => {
  setStorageBackend({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} });
  const { s } = play(2, 'huoqing', 2);
  const w = writeRun(s, 'manual');
  assert.ok(w.ok && w.persisted === false, '写失败改存内存，并如实告知未持久化');
  assert.ok(readRun('manual').ok, '同一页面内仍可读到');
  setStorageBackend({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } });
  assert.ok(writeRun(s, 'timer').ok);
  deleteRun('auto');
});

test('最新存档选择：自动与手动谁新读谁；结束的对局不存', () => {
  fresh();
  const { s } = play(2, 'huoqing', 3);
  const realNow = Date.now;
  Date.now = () => 1000; writeRun(s, 'manual');
  Date.now = () => 2000; writeRun(s, 'wave');
  Date.now = realNow;
  assert.equal(latestRun().slot, 'auto');
  assert.equal(listRuns().find((r) => r.slot === 'manual').meta.wave, s.wave.n);
  s.over = { win: false, reason: 'x', wave: 3, t: 1 };
  assert.ok(!writeRun(s, 'manual').ok, '已结束的对局拒绝存档');
});

test('自动存档调度：波次切换 / 清波 / 每 30 秒 / 手动；事件回调只打标记，flush 里才落盘；结束清自动档；dispose 摘监听', () => {
  fresh();
  const s = new Sim({ seed: 9, heroId: 'huoqing', mode: 'story', fx: false });
  const b = new PlayerBot(s, { kind: 'proxy', sigma: 0.05, seed: 1 });
  const saved = [];
  const as = attachAutosave(s, { onSaved: (r) => saved.push(r.kind) });
  const base = Object.values(s.listeners).flat().length;
  assert.equal(as.flush(), null, '无事发生不存档');
  // 推进到第 1 波：waveStart 触发 → flush 存档
  let guard = 0;
  while (s.wave.n < 1 && guard++ < 30 * 200) { b.step(); s.step(); }
  const r1 = as.flush();
  assert.ok(r1 && r1.ok && r1.kind === 'wave' && r1.slot === 'auto');
  assert.equal(as.flush(), null, '一次标记只存一次');
  const t0 = s.t;
  while (s.t - t0 < AUTOSAVE_EVERY_SEC + 1 && !s.over) { b.step(); s.step(); if (s.wave.n > 1) break; }
  while (s.t - t0 < AUTOSAVE_EVERY_SEC + 1 && !s.over) { b.step(); s.step(); }
  assert.ok(saved.length >= 1);
  const rs = as.flush();
  assert.ok(rs && rs.ok, '定时 / 波次触发自动存档');
  const m = as.manual();
  assert.ok(m.ok && m.slot === 'manual');
  assert.ok(listRuns().every((r) => r.ok), '两个槽位都可读');
  as.dispose();
  assert.equal(Object.values(s.listeners).flat().length, base - 3, 'dispose 摘掉 3 个事件监听');
  assert.equal(as.manual(), null, 'dispose 后不再存档');
  // 结束清自动档
  const s3 = new Sim({ seed: 9, heroId: 'huoqing', mode: 'story', fx: false });
  const as3 = attachAutosave(s3);
  as3.manual(); writeRun(s3, 'wave');
  assert.ok(listRuns().find((r) => r.slot === 'auto').ok);
  s3.end(false, '测试');
  assert.ok(listRuns().find((r) => r.slot === 'auto').empty, '对局结束后自动档被清除');
  assert.ok(listRuns().find((r) => r.slot === 'manual').ok, '手动档保留');
  as3.dispose();
});

test('存档体积：高波次整局存档远小于 localStorage 配额', () => {
  fresh();
  let s; let bytes = 0;
  for (const seed of [31, 5, 8, 12]) { s = play(seed, 'huoqing', 20).s; if (!s.over) break; }
  const w = writeRun(s, 'manual');
  assert.ok(w.ok, `${w.reason} wave=${s.wave.n} over=${JSON.stringify(s.over)}`);
  assert.ok(w.bytes < 3 * 1024 * 1024, `存档 ${(w.bytes / 1024).toFixed(0)}KB（敌人 ${s.enemies.length}）`);
});
