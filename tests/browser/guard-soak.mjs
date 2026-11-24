// 「守灯·镇夜」长局浸泡测试（真实浏览器）：dist 静态服务 + 无头 Chrome(CDP)，进入对局后注入代打机器人，
// 孔明/英雄无敌 + 连续召唤波次，把局面推到高波次，周期采样：
//   JS 堆(performance.memory)、Phaser 显示对象数、纹理数、tween/timer 数、键鼠监听数、sim 各数组长度、pageerror/console.error。
// 断言：无未捕获错误且 scene.errorCount=0；显示对象/tween/timer 后半段峰值不超过前半段 ×1.25（+常数）；
//       堆后半段（取最小值比较，避开 GC 抖动）增长 < 阈值；重开 N 局后监听数/纹理数/children 不叠加。
// 报告：tests/browser/out/guard-soak.json
// 用法：npx vite build && node tests/browser/guard-soak.mjs   （SOAK_SEC=墙钟秒，默认 150；SOAK_RESTARTS=重开次数，默认 3；SOAK_HEAP_MB 默认 120）
import { Browser, serve, sleep } from './cdp.mjs';
import { buildBot } from './build-bot.mjs';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const SOAK_SEC = Number(process.env.SOAK_SEC || 150);
const RESTARTS = Number(process.env.SOAK_RESTARTS || 3);
const HEAP_LIMIT_MB = Number(process.env.SOAK_HEAP_MB || 120);
const OBJ_GROWTH = 1.25;

const { srv } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8796);
const b = await Browser.launch({ port: 9396 });
const checks = [];
const check = (name, pass, info = {}) => { checks.push({ name, pass, ...info }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
const metrics = () => b.eval('__TAPCANVAS_PLAYTEST__.guard.metrics()');
let botCode = null;

async function start(attachBot = true) {
  await b.goto('http://127.0.0.1:8796/index.html?tapcanvasPlaytest=1&seed=20261117&ts=8');
  await b.until((s) => s.scene === 'title', 30000);
  await sleep(800); await b.press('g');
  await b.until((s) => s.scene === 'select', 30000); await sleep(500); await b.press('Enter');
  await b.until((s) => s.scene === 'play', 30000);
  await sleep(1000);
  if (attachBot) {
    botCode ||= await buildBot();
    await b.eval(`${botCode}; globalThis.__bot = GuardBot.attach(globalThis.__guardSim, {}); 1`);
  }
}
const godMode = () => b.eval(`(() => { const s = globalThis.__guardSim; s.kongming.invuln = 1e9; s.hero.invuln = 1e9; for (const u of s.units) u.invuln = 1e9; if (!s.wave.spawnLeft && s.wave.n > 0) s.command({ type: 'callWave' }); return s.wave.n; })()`);

const samples = [];
let maxWave = 0;
try {
  await start();
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < SOAK_SEC) {
    const w = await godMode();
    await sleep(3000);
    const m = await metrics();
    const objs = (m.gg ? m.gg.children : 0) + (m.hud ? m.hud.children : 0);
    samples.push({ at: Math.round((Date.now() - t0) / 1000), objs, ...m });
    maxWave = Math.max(maxWave, m.sim ? m.sim.wave : 0);
    if (samples.length % 5 === 0) console.log(JSON.stringify({ at: samples.at(-1).at, wave: m.sim && m.sim.wave, objs, heapMB: Math.round(m.heap / 1e6), tex: m.textures, tw: m.gg && m.gg.tweens, tm: m.gg && m.gg.timers, en: m.sim && m.sim.enemies }));
    const st = await b.snap().catch(() => null);
    if (st && st.over) break;
  }
  // 前后半段对比
  const half = Math.floor(samples.length / 2);
  const a = samples.slice(0, half); const z = samples.slice(half);
  const peak = (arr, f) => arr.reduce((x, s) => Math.max(x, f(s) || 0), 0);
  const low = (arr, f) => arr.reduce((x, s) => Math.min(x, f(s) || Infinity), Infinity);
  check('采样点足够', samples.length >= 8, { n: samples.length });
  check('推到高波次', maxWave >= 12, { maxWave });
  for (const [k, f, slack] of [['objs', (s) => s.objs, 40], ['tweens', (s) => s.gg && s.gg.tweens, 40], ['timers', (s) => s.gg && s.gg.timers, 20], ['textures', (s) => s.textures, 5], ['hudChildren', (s) => s.hud && s.hud.children, 20]]) {
    const pa = peak(a, f); const pz = peak(z, f);
    check(`${k} 后半段峰值未增长`, pz <= pa * OBJ_GROWTH + slack, { firstHalfPeak: pa, secondHalfPeak: pz });
  }
  if (samples.length >= 6 && samples[0].heap) {
    const growth = (low(z, (s) => s.heap) - low(a, (s) => s.heap)) / 1e6;
    check(`堆（窗口最低点）后半段增长 < ${HEAP_LIMIT_MB}MB`, growth < HEAP_LIMIT_MB, { growthMB: Math.round(growth), firstLowMB: Math.round(low(a, (s) => s.heap) / 1e6), secondLowMB: Math.round(low(z, (s) => s.heap) / 1e6) });
  }
  const last = samples.at(-1);
  check('sim 数组在上限内', last.sim.enemies <= 900 && last.sim.projs <= 720 && last.sim.fx <= 620 && last.sim.ground <= 60 && last.sim.listeners < 200, last.sim);
  check('场景错误计数为 0', (last.gg.errors || 0) === 0 && (last.hud.errors || 0) === 0, { gg: last.gg.errors, hud: last.hud.errors });

  // 重开叠加检查（HUD 的"重开"走 scene.restart）
  const base = await metrics();
  const seq = [];
  for (let i = 0; i < RESTARTS; i++) {
    await b.eval(`(() => { const h = __guardScene.hud; h.restart(); return 1; })()`);
    await sleep(2500);
    await b.until((s) => s.scene === 'play', 30000);
    await sleep(1500);
    seq.push(await metrics());
  }
  const fin = seq.at(-1) || base;
  check('重开后键盘监听不叠加', fin.gg.inputKb <= base.gg.inputKb, { before: base.gg.inputKb, after: fin.gg.inputKb });
  check('重开后指针监听不叠加', fin.gg.inputPtr <= base.gg.inputPtr, { before: base.gg.inputPtr, after: fin.gg.inputPtr });
  check('重开后纹理数不增长', fin.textures <= base.textures + 4, { before: base.textures, after: fin.textures });
  check('重开后 children 不叠加', fin.gg.children <= base.gg.children + 400 && fin.hud.children <= base.hud.children + 30, { ggBefore: base.gg.children, ggAfter: fin.gg.children, hudBefore: base.hud.children, hudAfter: fin.hud.children });
  check('重开后 sim.listeners 不叠加', fin.sim.listeners <= 60, { listeners: fin.sim.listeners });
  // 重开后的第 N 局结束时结算界面必须仍会出现（scene.restart 不重建实例，遗留标志曾让第二局起结算永不弹出）
  const endRound = async () => {
    await b.eval(`(() => { const s = globalThis.__guardSim; if (globalThis.__bot) globalThis.__bot.enabled = false; s.over = { win: false, reason: 'soak' }; return 1; })()`);
    try { await b.until((x) => x.scene === 'result', 8000); return true; } catch { return false; }
  };
  let shown = await endRound(); // 第 1 局结束 → 结算 → 重开 → 第 2 局结束 → 结算
  const first = shown;
  if (shown) {
    await b.eval('__guardScene.hud.restart(); 1');
    await sleep(2500);
    await b.until((s) => s.scene === 'play', 30000);
    shown = await endRound();
  }
  check('第一局结算界面弹出', first);
  check('重开 N 局后结算界面仍会弹出', shown, { restarts: RESTARTS });
} catch (e) {
  check('浸泡流程无异常', false, { err: String(e.message || e).slice(0, 400) });
}
check('无 pageerror / console.error', b.errors.length === 0, { errors: b.errors.slice(0, 5) });
writeFileSync(`${OUT}guard-soak.json`, JSON.stringify({ soakSec: SOAK_SEC, maxWave, checks, samples }, null, 1));
await b.close(); srv.close();
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
process.exit(failed ? 1 : 0);
