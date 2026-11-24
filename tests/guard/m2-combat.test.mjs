// M2 战斗无头测试：英雄/雇佣兵/神兽技能、友军技能 AI、BOSS 波与预警、精英、剧情胜利、无尽轮换
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import { KITS } from '../../src/guard/sim/kits/index.js';
import { bossFor } from '../../src/guard/sim/systems/bosses.js';
import BD from '../../src/guard/data/bosses.json' with { type: 'json' };

const HEROES = ['azhu', 'huoqing', 'yunque', 'xuanshuang'];
const SLOTS = ['q', 'e', 'r', 'f', 'u'];

// 在单位前方摆一团耐打的纸扎人
function arena(heroId = 'azhu', seed = 11) {
  const s = new Sim({ seed, heroId, mode: 'story', fx: false });
  s.wave.nextAt = 1e9; // 不开波，场上只有测试妖物
  s.hero.skillLvs = { q: 1, e: 1, r: 1, f: 1, u: 1 };
  return s;
}
function pack(s, x, y, n = 6, hpMul = 60) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = s.spawnEnemy('paperman', x + (i % 3) * 30 - 30, y + ((i / 3) | 0) * 30 - 15, { hpMul });
    out.push(e);
  }
  s.step(); // 重建空间格子
  return out;
}
const tagDmg = (s, key, slot) => s.stats.dmgBy[`${key}/${slot}`] || 0;

test('KITS 注册齐全：4 英雄 × 5 技能、3 雇佣兵 Q、5 神兽 Q/E，都有 cast 与 ai', () => {
  for (const h of HEROES) for (const sl of SLOTS) { assert.equal(typeof KITS[h][sl].cast, 'function', `${h}.${sl}`); assert.equal(typeof KITS[h][sl].ai, 'function'); }
  for (const m of ['dao', 'nu', 'tong']) assert.ok(KITS[m].q.cast && KITS[m].q.ai, m);
  for (const b of ['baihu', 'zhuque', 'xuanwu', 'qinglong', 'qilin']) for (const sl of ['q', 'e']) assert.ok(KITS[b][sl].cast && KITS[b][sl].ai, `${b}.${sl}`);
});

for (const h of HEROES) {
  test(`${h}：5 个技能都能释放并产生效果`, () => {
    for (const sl of SLOTS) {
      const s = arena(h);
      const u = s.hero;
      u.x = 2000; u.y = 2400;
      const es = pack(s, 2160, 2400);
      const aim = { x: 2160, y: 2400 };
      if (sl === 'u') u.energy = 100;
      s.kongming.hp = s.kongming.maxHp * 0.5;
      u.hp = u.maxHp * 0.5;
      const km0 = s.kongming.hp;
      const x0 = u.x; const y0 = u.y;
      assert.ok(s.castSkill(u, sl, aim), `${h}.${sl} 释放成功`);
      assert.ok(sl === 'u' ? u.energy === 0 : u.cds[sl] > 0, `${h}.${sl} 进入冷却/耗能`);
      const effect = [];
      if (h === 'huoqing' && sl === 'r') { effect.push(u.stats.dmgTaken >= 0.5 || u.buffs.some((b) => b.id === 'tiebi')); effect.push(es.some((e) => e.st.taunt && e.st.taunt.id === u.id)); }
      if (h === 'xuanshuang' && sl === 'e') effect.push(s.kongming.hp > km0 && u.hp > u.maxHp * 0.5);
      if (h === 'xuanshuang' && sl === 'r') effect.push(s.zones.filter((z) => z.block && z.vis === 'wall').length >= 3);
      if (h === 'xuanshuang' && sl === 'f') effect.push(u.buffs.some((b) => b.id === 'qingxin'));
      if (h === 'azhu' && sl === 'f') effect.push(u.invuln > 0 && Math.hypot(u.x - x0, u.y - y0) > 200);
      s.advance(2.5);
      if (h === 'yunque' && sl === 'f') effect.push(Math.hypot(u.x - x0, u.y - y0) > 150);
      const dmg = tagDmg(s, `hero:${h}`, sl);
      const ctl = es.some((e) => e.st.stun > 0 || e.st.root > 0 || e.st.freeze > 0 || e.st.slow);
      if (!effect.length) effect.push(dmg > 0);
      assert.ok(effect.every(Boolean), `${h}.${sl} 效果生效（伤害 ${Math.round(dmg)}，控制 ${ctl}）`);
      if (['xuanshuang:q', 'xuanshuang:u', 'azhu:e', 'huoqing:f', 'yunque:r'].includes(`${h}:${sl}`)) assert.ok(ctl || dmg > 0, `${h}.${sl} 控制`);
    }
  });
}

test('控制类技能确实施加控制：掌心雷眩晕、挑枪眩晕、缚灵定身、寒霜减速、冰封冻结', () => {
  const cases = [['azhu', 'e', 'stun'], ['huoqing', 'f', 'stun'], ['yunque', 'r', 'root'], ['xuanshuang', 'q', 'slow'], ['xuanshuang', 'u', 'freeze']];
  for (const [h, sl, st] of cases) {
    const s = arena(h);
    const u = s.hero;
    u.x = 2000; u.y = 2400;
    const es = pack(s, 2120, 2400, 4);
    if (sl === 'u') u.energy = 100;
    s.castSkill(u, sl, { x: 2120, y: 2400 });
    if (sl === 'r') s.advance(0.6); // 陷阱 0.3 秒后激活
    assert.ok(es.some((e) => (st === 'slow' ? e.st.slow : e.st[st] > 0)), `${h}.${sl} → ${st}`);
  }
});

test('雇佣兵与神兽技能：能释放并造成伤害/治疗/护盾', () => {
  const list = [['merc', 'dao', 'q'], ['merc', 'nu', 'q'], ['merc', 'tong', 'q'], ['beast', 'baihu', 'q'], ['beast', 'baihu', 'e'], ['beast', 'zhuque', 'q'], ['beast', 'zhuque', 'e'],
    ['beast', 'xuanwu', 'q'], ['beast', 'xuanwu', 'e'], ['beast', 'qinglong', 'q'], ['beast', 'qinglong', 'e'], ['beast', 'qilin', 'q'], ['beast', 'qilin', 'e']];
  for (const [kind, key, sl] of list) {
    const s = arena('azhu');
    const u = s.spawnUnit(kind, key, 2000, 2400);
    const es = pack(s, 2110, 2400);
    s.kongming.hp = s.kongming.maxHp * 0.5;
    const km0 = s.kongming.hp;
    s.hero.hp = s.hero.maxHp * 0.5;
    s.hero.x = 2030; s.hero.y = 2400;
    u.cds[sl] = 0;
    assert.ok(s.castSkill(u, sl, { x: 2110, y: 2400 }), `${key}.${sl} 释放`);
    s.advance(2);
    const dmg = tagDmg(s, `${kind}:${key}`, sl);
    if (key === 'tong' || (key === 'qilin' && sl === 'q')) assert.ok(s.hero.hp > s.hero.maxHp * 0.5 || s.kongming.hp > km0, `${key}.${sl} 治疗`);
    else if (key === 'xuanwu' && sl === 'q') assert.ok(s.hero.shield > 0 || u.shield > 0, '龟甲阵护盾');
    else assert.ok(dmg > 0, `${key}.${sl} 伤害 ${dmg}`);
    if (key === 'xuanwu' && sl === 'e') assert.ok(es.some((e) => e.st.taunt), '蛇缠嘲讽');
  }
});

test('友军 AI：非操控英雄会自己放技能（聚团放 AOE、敌人多时放大招、孔明掉血时治疗）', () => {
  for (const h of HEROES) {
    const s = arena(h);
    const m = s.spawnUnit('merc', 'dao', 1500, 1500);
    s.switchTo(m.id); // 英雄交给 AI
    const u = s.hero;
    u.x = 2000; u.y = 2250;
    u.energy = 100;
    s.kongming.hp = s.kongming.maxHp * 0.6;
    const casts = new Set();
    s.on('cast', (c) => { if (c.u === u) casts.add(c.slot); });
    pack(s, 2000, 2400, 9, 200);
    s.advance(12);
    assert.ok(casts.size >= 3, `${h} AI 放了 ${[...casts]}`);
    assert.ok(casts.has('u'), `${h} 敌人 ≥6 时 AI 放大招`);
    if (h === 'xuanshuang') assert.ok(casts.has('e'), '孔明掉血时玄霜放回春铃');
  }
});

test('AI 不乱放：没有敌人时不放技能，满血时不放治疗', () => {
  const s = arena('xuanshuang');
  const m = s.spawnUnit('merc', 'dao', 1500, 1500);
  s.switchTo(m.id);
  let n = 0;
  s.on('cast', (c) => { if (c.u === s.hero) n++; });
  s.advance(5);
  assert.equal(n, 0);
  assert.equal(KITS.xuanshuang.e.ai(s, s.hero), null);
});

function toWave(s, n) {
  s.wave.n = n - 1;
  s.wave.nextAt = s.t;
  s.step();
  assert.equal(s.wave.n, n);
}

for (const [n, key, tex] of [[10, 'laozu', 'boss'], [20, 'hanba', 'g_boss_hanba'], [30, 'yedi', 'g_boss_yedi']]) {
  test(`第 ${n} 波刷出 BOSS ${BD[key].name}，大招有 ≥0.5 秒红圈预警`, () => {
    const s = new Sim({ seed: 21, heroId: 'huoqing', mode: 'story', fx: false });
    const spawned = [];
    s.on('bossSpawn', (e) => spawned.push(e));
    toWave(s, n);
    const b = s.enemies.find((e) => e.boss);
    assert.ok(b && spawned[0] === b, 'BOSS 出现并发 bossSpawn');
    assert.equal(b.boss, key);
    assert.equal(b.def.tex, tex);
    assert.equal(b.name, BD[key].name);
    if (key === 'laozu') assert.equal(b.sheet, 'boss_idle');
    // 拉到孔明附近，观察招式
    b.x = s.kongming.x; b.y = s.kongming.y - 320;
    const warns = new Set();
    for (let i = 0; i < 30 * 25 && !s.over; i++) {
      s.step();
      for (const z of s.zones) if (z.alive && z.vis === 'warn' && z.side === 'enemy') { assert.ok(z.total >= 0.5, `预警 ${z.total}s`); warns.add(z.id); }
      s.kongming.hp = s.kongming.maxHp; // 只看招式，不让孔明死
    }
    assert.ok(warns.size >= 3, `出现预警圈 ${warns.size}`);
    assert.ok(b.skI >= 3, `招式轮换 ${b.skI}`);
  });
}

test('BOSS 推进：无人阻拦时沿北路走向孔明', () => {
  const s = new Sim({ seed: 2, heroId: 'azhu', mode: 'story', fx: false });
  toWave(s, 10);
  const b = s.enemies.find((e) => e.boss);
  const d0 = Math.hypot(b.x - s.kongming.x, b.y - s.kongming.y);
  s.hero.x = 3500; s.hero.y = 3500; // 英雄躲远
  s.advance(15);
  const d1 = Math.hypot(b.x - s.kongming.x, b.y - s.kongming.y);
  assert.ok(d1 < d0 - 300, `${Math.round(d0)} → ${Math.round(d1)}`);
});

test('夜帝血量过半进入二阶段；剧情第 30 波击杀判胜', () => {
  const s = new Sim({ seed: 4, heroId: 'yunque', mode: 'story', fx: false });
  let killed = 0;
  s.on('bossKill', () => killed++);
  toWave(s, 30);
  const b = s.enemies.find((e) => e.boss === 'yedi');
  b.hp = b.maxHp * 0.45;
  s.step();
  assert.equal(b.phase2, true);
  s.damage(s.hero, b, 1e9);
  assert.equal(killed, 1);
  assert.equal(s.stats.bossKills, 1);
  assert.equal(s.bossesKilled, 1);
  assert.ok(s.over && s.over.win === true, '胜利');
  assert.match(s.over.reason, /第 30 波 · 夜帝·无光 伏诛/);
});

test('第 10 波 BOSS 击杀不判胜；无尽模式第 30 波击杀也不结束', () => {
  const s = new Sim({ seed: 4, heroId: 'yunque', mode: 'story', fx: false });
  toWave(s, 10);
  s.damage(s.hero, s.enemies.find((e) => e.boss), 1e9);
  assert.equal(s.over, null);
  const e2 = new Sim({ seed: 4, heroId: 'yunque', mode: 'endless', fx: false });
  toWave(e2, 30);
  e2.damage(e2.hero, e2.enemies.find((e) => e.boss), 1e9);
  assert.equal(e2.over, null);
});

test('无尽模式：30 波后每 10 波轮换三只 BOSS 并按波数加血', () => {
  assert.equal(bossFor(40, 'endless').key, 'laozu');
  assert.equal(bossFor(50, 'endless').key, 'hanba');
  assert.equal(bossFor(60, 'endless').key, 'yedi');
  assert.equal(bossFor(70, 'endless').key, 'laozu');
  assert.equal(bossFor(40, 'story'), null);
  assert.equal(bossFor(35, 'endless'), null);
  const s = new Sim({ seed: 8, heroId: 'azhu', mode: 'endless', fx: false });
  toWave(s, 40);
  const b = s.enemies.find((e) => e.boss);
  assert.equal(b.boss, 'laozu');
  assert.ok(b.maxHp > BD.laozu.hp * 2, `加血 ${b.maxHp}`);
});

test('精英：第 5 波出现 1 只（放大、加血、带预警技能），BOSS 波不出精英', () => {
  const s = new Sim({ seed: 6, heroId: 'huoqing', mode: 'story', fx: false });
  const got = [];
  s.on('eliteSpawn', (e) => got.push(e));
  s.advance(8 + 48 * 4 + 1); // 自然推进到第 5 波
  assert.equal(s.wave.n, 5);
  assert.equal(got.length, 1);
  const e = got[0];
  assert.ok(e.elite && e.scale === BD.elite.scale && e.tint);
  assert.ok(e.maxHp >= e.def.hp * BD.elite.hpMul, '血 ×8 以上（含波次成长）');
  // 精英靠近友军会放带预警的重击
  e.x = s.hero.x + 120; e.y = s.hero.y;
  e.eliteT = 0;
  let warned = false;
  for (let i = 0; i < 30 && !s.over; i++) { s.step(); if (s.zones.some((z) => z.alive && z.vis === 'warn' && z.total >= 0.5)) warned = true; }
  assert.ok(warned, '精英技能有预警');
  const s2 = new Sim({ seed: 6, heroId: 'huoqing', mode: 'story', fx: false });
  let n2 = 0;
  s2.on('eliteSpawn', () => n2++);
  toWave(s2, 10);
  assert.equal(n2, 0);
});

test('数值基线：空挂（不操作）孔明在第 4–6 波失守；英雄 AI 代打守住前 5 波', () => {
  for (const h of HEROES) {
    const idle = new Sim({ seed: 3, heroId: h, mode: 'story', fx: false });
    idle.advance(8 + 48 * 7);
    assert.ok(idle.over && idle.over.wave >= 4 && idle.over.wave <= 6, `${h} 空挂失守于第 ${idle.over && idle.over.wave} 波`);
    const ai = new Sim({ seed: 3, heroId: h, mode: 'story', fx: false });
    ai.hero.ctrl = false; ai.ctrlId = -1; // 英雄交给友军 AI（会放技能）
    ai.advance(8 + 48 * 5 + 20);
    assert.ok(!ai.over && ai.wave.n >= 6, `${h} AI 代打守住前 5 波（${ai.over ? ai.over.reason : '存活'}）`);
  }
});
