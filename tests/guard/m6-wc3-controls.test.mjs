// WC3 英雄移动与 RTS 指令系统单元测试：右键移动、巡攻(A地板)、锁定攻击、坚守、停止、寻路建造、回防孔明、自动索敌与 WASD 瞬时打断
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';

test('WC3 moveTo：英雄平滑移动到目标点并在到达后清空指令', () => {
  const s = new Sim({ seed: 101, heroId: 'huoqing', mode: 'story', fx: false });
  const tx = s.hero.x + 300;
  const ty = s.hero.y - 120;
  const r = s.command({ type: 'moveTo', x: tx, y: ty });
  assert.equal(r.ok, true);
  assert.equal(s.hero.order.type, 'move');
  s.advance(3);
  assert.equal(s.hero.order, null, '到达目标点后应自动清空 move 指令');
  assert.ok(Math.hypot(s.hero.x - tx, s.hero.y - ty) <= 20, '应到达目标点附近');
});

test('WASD 瞬时打断 WC3 点击移动指令', () => {
  const s = new Sim({ seed: 102, heroId: 'azhu', mode: 'story', fx: false });
  s.command({ type: 'moveTo', x: s.hero.x + 600, y: s.hero.y });
  assert.equal(s.hero.order.type, 'move');
  s.input.mx = -1;
  s.step();
  assert.equal(s.hero.order, null, '按下 WASD 应立即取消点击移动指令');
  s.input.mx = 0;
});

test('WC3 attackMove（巡攻/A地板）：沿途自动迎敌，清敌后继续前往目标点', () => {
  const s = new Sim({ seed: 103, heroId: 'yunque', mode: 'story', fx: false });
  const tx = s.hero.x + 500;
  const ty = s.hero.y;
  const e = s.spawnEnemy('paperman', s.hero.x + 220, s.hero.y, { hpMul: 0.4 });
  s.command({ type: 'attackMove', x: tx, y: ty });
  s.advance(5);
  assert.equal(e.alive, false, '沿途妖物应被巡攻消灭');
  assert.ok(Math.hypot(s.hero.x - tx, s.hero.y - ty) <= 24, '清敌后应继续到达目标点');
});

test('WC3 attackTarget：锁定追击并消灭指定敌人后清空指令', () => {
  const s = new Sim({ seed: 104, heroId: 'huoqing', mode: 'story', fx: false });
  const e = s.spawnEnemy('paperman', s.hero.x + 260, s.hero.y, { hpMul: 0.5 });
  const r = s.command({ type: 'attackTarget', targetId: e.id });
  assert.equal(r.ok, true);
  s.advance(4);
  assert.equal(e.alive, false, '应追上并击杀锁定目标');
  assert.equal(s.hero.order, null, '目标死亡后清空 attack 指令');
});

test('WC3 hold（坚守）与 stop（停止）：坚守原地不追击但自动反击射程内敌人', () => {
  const s = new Sim({ seed: 105, heroId: 'azhu', mode: 'story', fx: false });
  const sx = s.hero.x; const sy = s.hero.y;
  const e = s.spawnEnemy('paperman', sx + 220, sy, { hpMul: 0.5 });
  s.command({ type: 'hold' });
  assert.equal(s.hero.order.type, 'hold');
  s.advance(2.5);
  assert.ok(Math.hypot(s.hero.x - sx, s.hero.y - sy) < 1, '坚守态不得移动');
  assert.equal(e.alive, false, '坚守态应自动反击消灭射程内敌人');
  s.command({ type: 'stop' });
  assert.equal(s.hero.order, null, 'stop 清空指令');
});

test('WC3 buildMove：点击远处地基自动走近并触发 arrivedFoundation 事件', () => {
  const s = new Sim({ seed: 106, heroId: 'xuanshuang', mode: 'story', fx: false });
  const farF = s.foundations.reduce((best, f) => {
    const d = (f.x - s.hero.x) ** 2 + (f.y - s.hero.y) ** 2;
    return d > best.d ? { f, d } : best;
  }, { f: null, d: -1 }).f;
  let arrived = null;
  s.on('arrivedFoundation', ({ f }) => { arrived = f; });
  const r = s.command({ type: 'buildMove', fid: farF.id });
  assert.equal(r.ok, true);
  s.advance(8);
  assert.ok(arrived && arrived.id === farF.id, '走近远处地基后应触发 arrivedFoundation');
  assert.equal(s.hero.order, null);
});

test('WC3 rallyKongming（回防孔明）与停步自动索敌 autoAttack', () => {
  const s = new Sim({ seed: 107, heroId: 'azhu', mode: 'story', fx: false });
  s.hero.x = s.kongming.x + 600;
  s.hero.y = s.kongming.y + 400;
  s.command({ type: 'rallyKongming' });
  s.advance(4);
  assert.ok(Math.hypot(s.hero.x - s.kongming.x, s.hero.y - (s.kongming.y + 130)) <= 24, '应回到孔明身边');
  // 停步自动索敌
  s.input.autoAttack = true;
  const e = s.spawnEnemy('paperman', s.hero.x + 180, s.hero.y, { hpMul: 0.4 });
  s.advance(2);
  assert.equal(e.alive, false, '开启 autoAttack 时停步应自动普攻消灭射程内敌人');
});

test('切换操控单位时清空旧单位残留手动指令', () => {
  const s = new Sim({ seed: 108, heroId: 'huoqing', mode: 'story', fx: false });
  s.copper = 500;
  const hr = s.command({ type: 'hire', key: 'dao' });
  assert.equal(hr.ok, true);
  s.command({ type: 'moveTo', x: s.hero.x + 400, y: s.hero.y });
  assert.ok(s.hero.order);
  s.command({ type: 'cycle', dir: 1 });
  assert.equal(s.hero.order, null, '切走后旧操控单位应清空手动指令交还 AI');
});

test('WC3 moveTo 顶墙卡阻超时后自动停止，不原地空跑', () => {
  const s = new Sim({ seed: 109, heroId: 'huoqing', mode: 'story', fx: false });
  // 将英雄贴近秘境围墙外侧并向墙内下达直线移动指令
  s.hero.x = 1200 + s.hero.r + 2;
  s.hero.y = 400;
  s.command({ type: 'moveTo', x: 600, y: 400 });
  s.advance(1.5);
  assert.equal(s.hero.order, null, '持续受阻无法前进时应自动清空卡死指令');
  assert.equal(s.hero.moving, false);
});
