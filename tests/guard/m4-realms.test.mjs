// M4 秘境无头测试：封印/开放、进入刷守卫且主线照常推进、击败神兽收服、全员离开重置、隐藏秘境与传送门。
// 说明：这是功能测试，不是平衡测试；为了让流程可控，测试里让英雄无敌、直接结算守卫（平衡由 M6 用不作弊机器人验证）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import { REALMS, HIDDEN, gateCenter } from '../../src/guard/sim/map.js';
import BAL from '../../src/guard/data/balance.json' with { type: 'json' };
import RD from '../../src/guard/data/realms.json' with { type: 'json' };

const geo = (id) => REALMS.find((r) => r.id === id);
const mk = (seed = 11) => {
  const s = new Sim({ seed, heroId: 'huoqing', mode: 'story', fx: false });
  s.hero.invuln = 1e9;
  s.kongming.invuln = 1e9; // 只测秘境流程：防止挂机太久孔明阵亡导致模拟停止
  return s;
};
// 门洞里、秘境一侧的点（越过墙线 30px）
function insideGate(id) {
  const r = geo(id);
  const [gx, gy] = gateCenter(r);
  return [gx, gy];
}
function outsideGate(id) {
  const r = geo(id);
  const sx = r.gate[0] === r.rect[2] ? 1 : -1;
  const sy = r.gate[1] === r.rect[3] ? 1 : -1;
  return [r.gate[0] + sx * 140, r.gate[1] + sy * 140];
}
const guards = (s, id) => s.enemies.filter((e) => e.alive && e.realm === id);
const mainEnemies = (s) => s.enemies.filter((e) => e.alive && !e.realm);
function waitWave(s, n) { let k = 0; while (s.wave.n < n && k++ < 20000 && !s.over) s.step(); assert.ok(!s.over && s.wave.n >= n, `到达第 ${n} 波`); }
function put(s, u, [x, y]) { u.x = x; u.y = y; s.step(); }
// 把某秘境打穿：反复击杀秘境里的妖物，直到收服
function clearRealm(s, id) {
  for (let i = 0; i < 400 && s.realms.state[id] !== 'cleared'; i++) {
    for (const e of guards(s, id)) s.damage(s.hero, e, 1e9);
    s.advance(0.5);
  }
}

test('默认四圣兽开局即开放；隐藏麒麟与自定义 open > wave 仍封印挡回', () => {
  // 1) 默认配置：四圣兽与项羽/刑天从第 1 波（开局）即 open，仅隐藏麒麟为 locked
  const sDef = mk();
  sDef.advance(1);
  for (const id of ['xuanwu', 'baihu', 'zhuque', 'qinglong', 'xiangyu', 'xingtian']) {
    assert.equal(sDef.realms.state[id], 'open', `${id} 默认开局即开放`);
  }
  assert.equal(sDef.realms.state.qilin, 'locked', '隐藏麒麟秘境初始 locked');
  assert.equal(sDef.realms.hiddenOpen, false);

  // 2) 自定义 open > wave：未到开放波数仍封印挡回，到达波数后开放
  const prevOpen = RD.realms.xuanwu.open;
  RD.realms.xuanwu.open = 3;
  try {
    const s = mk();
    s.advance(1);
    assert.equal(s.realms.state.xuanwu, 'locked');
    const blocked = [];
    s.on('realmBlocked', (b) => blocked.push(b));
    put(s, s.hero, insideGate('xuanwu'));
    assert.equal(s.hero.realm, null, '被推回门外');
    assert.ok(!(s.hero.x < 1100 && s.hero.y < 1100), '不在秘境矩形里');
    assert.equal(s.realms.state.xuanwu, 'locked');
    assert.equal(blocked.length, 1);
    assert.match(blocked[0].text, /第 3 波开放/);
    assert.equal(guards(s, 'xuanwu').length, 0);
    // 走路进去同样被挡
    put(s, s.hero, outsideGate('xuanwu'));
    s.input.mx = -1; s.input.my = -1;
    s.advance(3);
    s.input.mx = 0; s.input.my = 0;
    assert.equal(s.hero.realm, null);
    waitWave(s, 3);
    assert.equal(s.realms.state.xuanwu, 'open', '到达第 3 波后自动开放');
  } finally {
    RD.realms.xuanwu.open = prevOpen;
  }
});

test('开放后进入：刷守卫，主线波次照常推进、主线妖物继续走向孔明', () => {
  const s = mk();
  waitWave(s, RD.realms.xuanwu.open);
  assert.equal(s.realms.state.xuanwu, 'open');
  const enters = [];
  s.on('realmEnter', (d) => enters.push(d.id));
  put(s, s.hero, insideGate('xuanwu'));
  assert.equal(s.hero.realm, 'xuanwu');
  assert.equal(s.realms.state.xuanwu, 'active');
  assert.deepEqual(enters, ['xuanwu']);
  const n0 = Object.values(RD.realms.xuanwu.rounds[0]).reduce((a, b) => a + b, 0);
  assert.equal(guards(s, 'xuanwu').length, n0);
  for (const e of guards(s, 'xuanwu')) assert.ok(e.home && e.tint, '守卫有家和秘境色');
  // 主线推进：记录主线妖物到孔明的距离
  const K = s.kongming;
  const w0 = s.wave.n;
  const tracked = mainEnemies(s).slice(0, 5).map((e) => ({ e, d: Math.hypot(e.x - K.x, e.y - K.y) }));
  s.advance(60);
  assert.equal(s.hero.realm, 'xuanwu', '英雄一直在秘境里');
  assert.ok(s.wave.n > w0, `波次在推进 ${w0} → ${s.wave.n}`);
  const moved = tracked.filter(({ e, d }) => !e.alive || Math.hypot(e.x - K.x, e.y - K.y) < d - 50);
  assert.ok(tracked.length === 0 || moved.length > 0, '主线妖物照常走向孔明');
  assert.ok(mainEnemies(s).length > 0, '主线妖物在场');
  // 守卫只在秘境里
  for (const e of guards(s, 'xuanwu')) assert.ok(e.x <= 1100 + e.r && e.y <= 1100 + e.r, '守卫没跑出秘境');
});

test('击败神兽：收服加入队伍可切换，state=cleared，发事件', () => {
  const s = mk();
  waitWave(s, RD.realms.xuanwu.open);
  const ev = { tame: [], clear: [], reward: [] };
  s.on('tame', (d) => ev.tame.push(d));
  s.on('realmClear', (d) => ev.clear.push(d.id));
  s.on('realmReward', (d) => ev.reward.push(d));
  put(s, s.hero, insideGate('xuanwu'));
  // 打完两轮小怪 → 神兽现身
  let boss = null;
  for (let i = 0; i < 100 && !boss; i++) {
    boss = guards(s, 'xuanwu').find((e) => e.boss === 'realm');
    if (!boss) { for (const e of guards(s, 'xuanwu')) s.damage(s.hero, e, 1e9); s.advance(0.5); }
  }
  assert.ok(boss, '神兽现身');
  assert.equal(boss.def.tex, 'g_beast_xuanwu');
  assert.equal(typeof boss.update, 'function');
  // 神兽会放招：大招用 telegraph 预警（≥0.5 秒）
  let warned = false;
  for (let i = 0; i < 30 * 20 && !warned; i++) { s.step(); warned = s.zones.some((z) => z.alive && z.vis === 'warn' && z.total >= 0.5); }
  assert.ok(warned, '神兽招式有红圈预警');
  const party0 = s.party.length;
  const copper0 = s.copper;
  s.damage(s.hero, boss, 1e9);
  assert.equal(s.realms.state.xuanwu, 'cleared');
  assert.equal(s.party.length, party0 + 1);
  const beast = s.byId(s.party[s.party.length - 1]);
  assert.equal(beast.kind, 'beast');
  assert.equal(beast.key, 'xuanwu');
  assert.equal(ev.tame.length, 1);
  assert.equal(ev.tame[0].beast, beast);
  assert.deepEqual(ev.clear, ['xuanwu']);
  assert.equal(ev.reward[0].set, 'xuanwu');
  assert.ok(s.copper >= copper0 + RD.realms.xuanwu.copper, '秘境铜钱奖励');
  assert.ok(s.command({ type: 'switch', id: beast.id }).ok, '可以切换到神兽');
  assert.equal(s.ctrlId, beast.id);
  assert.equal(guards(s, 'xuanwu').length, 0);
  // 再进已收服的秘境不会重新刷
  s.command({ type: 'switch', id: s.hero.id });
  put(s, s.hero, outsideGate('xuanwu'));
  put(s, s.hero, insideGate('xuanwu'));
  s.advance(2);
  assert.equal(guards(s, 'xuanwu').length, 0);
  assert.equal(s.realms.state.xuanwu, 'cleared');
});

test('中途全员离开：守卫消失，回到 open；再进重新开始', () => {
  const s = mk();
  waitWave(s, RD.realms.baihu.open);
  put(s, s.hero, insideGate('baihu'));
  assert.equal(s.realms.state.baihu, 'active');
  for (const e of guards(s, 'baihu')) s.damage(s.hero, e, 1e9);
  s.advance(2);
  assert.equal(s.realms.run.baihu.round, 1, '进入第 2 轮');
  put(s, s.hero, outsideGate('baihu'));
  assert.equal(s.hero.realm, null);
  // 离开后有 leaveGrace 秒宽限：期间回来进度保留
  s.advance(RD.leaveGrace - 1);
  assert.equal(s.realms.state.baihu, 'active', '宽限期内不重置');
  assert.equal(s.realms.run.baihu.round, 1, '宽限期内进度保留');
  s.advance(1.2);
  assert.equal(s.realms.state.baihu, 'open');
  assert.equal(guards(s, 'baihu').length, 0, '守卫消失');
  put(s, s.hero, insideGate('baihu'));
  assert.equal(s.realms.state.baihu, 'active');
  assert.equal(s.realms.run.baihu.round, 0, '从第 1 轮重新开始');
  // 操控单位在秘境里阵亡也算离开
  s.hero.invuln = 0;
  s.damage(guards(s, 'baihu')[0], s.hero, 1e9);
  s.advance(RD.leaveGrace + 0.2);
  assert.equal(s.realms.state.baihu, 'open');
});

test('清完 3 个秘境：隐藏秘境开放，传送门进出，收服麒麟（给卧龙套）', () => {
  const s = mk(23);
  waitWave(s, 6);
  const hidden = [];
  s.on('hiddenOpen', () => hidden.push(1));
  for (const id of ['xuanwu', 'baihu', 'zhuque']) {
    put(s, s.hero, outsideGate(id));
    put(s, s.hero, insideGate(id));
    assert.equal(s.realms.state[id], 'active', id);
    clearRealm(s, id);
    assert.equal(s.realms.state[id], 'cleared', id);
    assert.equal(s.realms.hiddenOpen, id === 'zhuque', `清完 ${id} 后 hiddenOpen`);
  }
  assert.equal(hidden.length, 1);
  assert.equal(s.realms.state.qilin, 'open');
  const H = BAL.hiddenRealm;
  // 踩传送门 → 传到隐藏秘境
  put(s, s.hero, [s.kongming.x, s.kongming.y + 200]);
  put(s, s.hero, [H.entry[0] + 20, H.entry[1]]);
  assert.deepEqual([s.hero.x, s.hero.y], H.arrive);
  s.step();
  assert.equal(s.hero.realm, 'qilin');
  assert.equal(s.realms.state.qilin, 'active');
  assert.ok(guards(s, 'qilin').length > 0);
  // 出口门传回灯坛旁（冷却过后）→ 重置
  s.advance(2);
  put(s, s.hero, [H.exit[0], H.exit[1] + 10]);
  assert.deepEqual([s.hero.x, s.hero.y], H.back);
  s.step();
  assert.equal(s.hero.realm, null);
  s.advance(RD.leaveGrace + 0.2);
  assert.equal(s.realms.state.qilin, 'open');
  // 再进去打穿，收服麒麟
  const rewards = [];
  s.on('realmReward', (d) => rewards.push(d));
  s.advance(2);
  put(s, s.hero, H.entry);
  s.step();
  assert.equal(s.realms.state.qilin, 'active');
  clearRealm(s, 'qilin');
  assert.equal(s.realms.state.qilin, 'cleared');
  const q = s.units.find((u) => u.kind === 'beast' && u.key === 'qilin');
  assert.equal(q, undefined, '麒麟为纯刷神装/神器秘境，不收服助守家');
  assert.equal(rewards[0].tameable, false);
  assert.equal(rewards[0].set, 'wolong');
  assert.equal(s.units.filter((u) => u.kind === 'beast').length, 3, '仅四圣兽（此前已收3只）可助守家');
  // 主线没停：wave 仍在增长
  const w = s.wave.n;
  s.advance(60);
  assert.ok(s.wave.n > w);
  assert.equal(HIDDEN.id, 'qilin');
});
