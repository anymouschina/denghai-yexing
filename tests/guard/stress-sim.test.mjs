// 长局/高波次压力回归（无头 Sim + PlayerBot）。默认跑缩短版（~20s）；STRESS_FULL=1 跑满（story 30 波 + endless 40+ 波，fx 开/关各一次，~60s）。
// 断言：无异常；enemies/projs/zones/fx/groundItems/units/listeners 不超上限；各数组在窗口期内不无限增长；堆增长受控。
// 想要精确堆数字：node --expose-gc --test tests/guard/stress-sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import { PlayerBot } from './bot/player.mjs';
import BAL from '../../src/guard/data/balance.json' with { type: 'json' };

const FULL = process.env.STRESS_FULL === '1';
const CAPS = { enemies: BAL.enemyCap + 80, projs: BAL.projCap + 20, zones: 400, fx: 600, ground: BAL.groundDrops.maxItems, units: 60, buildings: 80, listeners: 200, history: 12 };
const heapMB = () => { if (global.gc) global.gc(); return process.memoryUsage().heapUsed / 1e6; };

function sample(s) {
  return {
    wave: s.wave.n, enemies: s.enemies.length, projs: s.projs.length, zones: s.zones.length, fx: s.fx.length, ground: (s.groundItems || []).length,
    units: s.units.length, buildings: s.buildings.length, listeners: Object.values(s.listeners).reduce((a, l) => a + l.length, 0),
    history: s.quests ? s.quests.history.length : 0, killsBy: Object.keys(s.stats.killsBy).length, heap: heapMB(),
  };
}

// drainFx：模拟渲染层每帧清空 fx 队列；false 时验证队列自身的 600 上限。
function run({ mode, seed, targetWave, fx, drainFx = true, maxSimSec = 30000 }) {
  const s = new Sim({ seed, heroId: 'huoqing', mode, fx });
  const bot = new PlayerBot(s, { kind: 'proxy', seed: seed ^ 77 });
  s.kongming.invuln = 1e9; s.hero.invuln = 1e9; // 只测资源增长：保证局面不因失败提前结束
  const rows = [];
  let lastCall = 0;
  while (!s.over && s.wave.n < targetWave && s.t < maxSimSec) {
    bot.step();
    s.step();
    if (drainFx && s.tickN % 2 === 0) s.fx.length = 0;
    if (s.t - lastCall > 12 && s.wave.spawnLeft === 0) { lastCall = s.t; s.command({ type: 'callWave' }); }
    for (const u of s.units) if (u.kind === 'hero' || u.kind === 'kongming') u.invuln = 1e9;
    if (s.tickN % 900 === 0) rows.push(sample(s));
  }
  rows.push(sample(s));
  return { s, rows };
}

function assertBounded(rows, label) {
  for (const k of ['enemies', 'projs', 'zones', 'fx', 'ground', 'units', 'buildings', 'listeners', 'history']) {
    const peak = Math.max(...rows.map((r) => r[k]));
    assert.ok(peak <= CAPS[k], `${label}: ${k} 峰值 ${peak} 超过上限 ${CAPS[k]}`);
  }
  // 窗口期不无限增长：后半段峰值不超过前半段峰值的 1.5 倍（+慢启动余量），或已处在上限内的饱和状态
  const half = Math.floor(rows.length / 2);
  if (half >= 3) {
    // projs/zones/fx 随怪潮负载涨落（上限已在上面按 cap 断言），这里只查与负载无关的结构性数组
    for (const k of ['units', 'buildings', 'listeners', 'killsBy', 'history']) {
      const a = Math.max(...rows.slice(0, half).map((r) => r[k]));
      const z = Math.max(...rows.slice(half).map((r) => r[k]));
      assert.ok(z <= a * 1.5 + 30, `${label}: ${k} 后半段 ${z} 相对前半段 ${a} 持续增长`);
    }
  }
  const lis = rows.map((r) => r.listeners);
  assert.equal(Math.max(...lis), Math.min(...lis.slice(1)) , `${label}: sim.listeners 运行中变化（重复注册）：${lis}`);
}

function assertHeap(rows, label, limitMB) {
  if (rows.length < 6) return;
  const half = Math.floor(rows.length / 2);
  const q = Math.floor(rows.length / 4) || 1;
  const early = Math.min(...rows.slice(q, half).map((r) => r.heap));
  const late = Math.min(...rows.slice(half).map((r) => r.heap));
  assert.ok(late - early < limitMB, `${label}: 堆（窗口最低点）后半段增长 ${Math.round(late - early)}MB 超过 ${limitMB}MB（early ${Math.round(early)} → late ${Math.round(late)}）`);
}

const LIMIT = global.gc ? 40 : 150;
const cases = FULL
  ? [['endless fx:false', { mode: 'endless', seed: 5, targetWave: 42, fx: false }], ['story fx:true', { mode: 'story', seed: 11, targetWave: 30, fx: true }],
    ['endless fx:true 不清队列', { mode: 'endless', seed: 21, targetWave: 18, fx: true, drainFx: false }]]
  : [['endless fx:false', { mode: 'endless', seed: 5, targetWave: 16, fx: false }], ['story fx:true', { mode: 'story', seed: 11, targetWave: 12, fx: true }],
    ['endless fx:true 不清队列', { mode: 'endless', seed: 21, targetWave: 8, fx: true, drainFx: false }]];

for (const [name, cfg] of cases) {
  test(`压力长局：${name}（${FULL ? '满' : '缩短'}版）`, { timeout: 240000 }, () => {
    const t0 = Date.now();
    const { s, rows } = run(cfg);
    const last = rows.at(-1);
    console.log(`  [stress] ${name} wave=${last.wave} t=${Math.round(s.t)}s wall=${((Date.now() - t0) / 1000).toFixed(1)}s peak(en/proj/fx/ground/units)=${Math.max(...rows.map((r) => r.enemies))}/${Math.max(...rows.map((r) => r.projs))}/${Math.max(...rows.map((r) => r.fx))}/${Math.max(...rows.map((r) => r.ground))}/${Math.max(...rows.map((r) => r.units))} heap ${Math.round(rows[0].heap)}→${Math.round(last.heap)}MB`);
    assert.ok(last.wave >= cfg.targetWave - 1 || s.over === null, `${name}: 没有推到目标波次 ${cfg.targetWave}（${last.wave}）`);
    assertBounded(rows, name);
    assertHeap(rows, name, LIMIT);
    // NaN/脏引用：所有存活实体坐标有限
    for (const e of [...s.enemies, ...s.units, ...s.projs]) if (e.alive) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `${name}: 实体 ${e.id}/${e.type || e.key} 坐标非有限数`);
  });
}

test('sim.listeners：重复构造 Sim 不共享/叠加监听', () => {
  const a = new Sim({ seed: 1, heroId: 'huoqing', mode: 'story', fx: false });
  const n = Object.values(a.listeners).reduce((x, l) => x + l.length, 0);
  const b = new Sim({ seed: 2, heroId: 'huoqing', mode: 'story', fx: false });
  assert.equal(Object.values(b.listeners).reduce((x, l) => x + l.length, 0), n);
});
