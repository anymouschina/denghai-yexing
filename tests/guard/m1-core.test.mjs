// M1 框架无头测试：四名英雄都能开局、模拟可复现、切换操控、孔明死亡即结束、实时不停（波次按时开）
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, BAL } from '../../src/guard/sim/Sim.js';

const HEROES = ['azhu', 'huoqing', 'yunque', 'xuanshuang'];

test('四名英雄都能开局并推进 120 秒', () => {
  for (const h of HEROES) {
    const s = new Sim({ seed: 7, heroId: h, mode: 'story', fx: false });
    s.advance(120);
    assert.ok(s.wave.n >= 2, `${h} 波次在推进`);
    assert.equal(s.hero.key, h);
  }
});

test('同种子同输入结果一致（可复现）', () => {
  const run = () => { const s = new Sim({ seed: 99, heroId: 'huoqing', mode: 'story', fx: false }); s.input.attack = true; s.advance(90); return [s.stats.kills, Math.round(s.kongming.hp), s.enemies.length, s.copper]; };
  assert.deepEqual(run(), run());
});

test('波次实时推进：不清场也按间隔开下一波；N 提前召唤给铜钱', () => {
  const s = new Sim({ seed: 3, heroId: 'azhu', mode: 'story', fx: false });
  s.advance(9);
  assert.equal(s.wave.n, 1);
  const c0 = s.copper;
  const r = s.command({ type: 'callWave' });
  const stipend = BAL.waves.stipendBase + BAL.waves.stipendPerWave * 2;
  assert.ok(r.ok && r.bonus > 0 && s.copper === c0 + r.bonus + stipend && s.wave.n === 2);
});

test('切换操控：switch / cycle，只能切到存活单位', () => {
  const s = new Sim({ seed: 1, heroId: 'yunque', mode: 'story', fx: false });
  const m = s.spawnUnit('merc', 'dao', 2000, 2200);
  const b = s.spawnUnit('beast', 'baihu', 2100, 2200);
  assert.deepEqual(s.party, [s.hero.id, m.id, b.id]);
  assert.ok(s.command({ type: 'switch', id: b.id }).ok);
  assert.equal(s.ctrlId, b.id);
  assert.ok(b.ctrl && !s.hero.ctrl);
  assert.ok(s.command({ type: 'cycle', dir: 1 }).ok);
  assert.equal(s.ctrlId, s.hero.id);
  assert.equal(s.command({ type: 'switch', id: s.kongming.id }).ok, false);
});

test('孔明死亡立刻结束（失败）', () => {
  const s = new Sim({ seed: 5, heroId: 'huoqing', mode: 'story', fx: false });
  s.advance(12);
  const e = s.enemies[0];
  s.damage(e, s.kongming, 1e9);
  assert.ok(s.over && s.over.win === false);
  const t = s.t;
  s.advance(5);
  assert.equal(s.t, t, '结束后不再推进');
});

test('操控单位倒下自动切到下一个存活单位', () => {
  const s = new Sim({ seed: 5, heroId: 'huoqing', mode: 'story', fx: false });
  const m = s.spawnUnit('merc', 'nu', 2000, 2200);
  s.advance(12);
  s.damage(s.enemies[0], s.hero, 1e9);
  assert.equal(s.ctrlId, m.id);
  assert.ok(s.hero.downT > 0);
  s.advance(s.hero.downT + 0.2);
  assert.ok(s.hero.alive, '英雄会在灯坛复活');
});
