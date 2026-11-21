// 手机横屏端到端验证（真实 Chrome + CDP 触摸事件）：
//   标题 → 开局 → 移动 → 攻击 → 升级三选一 → 清场出现裂隙 → 进副本击杀守关者 → 拿到飞剑术 → 死亡结算 → 再来一局
// 用法：node tools/e2e_phone.mjs <宽> <高> <输出目录> [seed] [ts]
// 只读游戏暴露的试玩桥 snapshot()（位置/阶段/场景名）来“看”局面；操作全部走真实触摸事件（摇杆拖动、点按）。
// ts：试玩加速倍率（?ts=3 只加快 sim 时间，不跳关、不无敌），让一整局能在几分钟内走完。
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [W, H, OUT, SEED = '20261117', TS = '3'] = process.argv.slice(2);
const w = Number(W), h = Number(H);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'build/web');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.pck': 'application/octet-stream', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(DIR, u === '/' ? 'index.html' : u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const port = server.address().port;
const dbg = 9360 + Math.floor(Math.random() * 100);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, '--no-first-run', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
  `--window-size=${w},${h}`, `--user-data-dir=/private/tmp/claude-501/chrome-e2e-${dbg}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch { /* 等 Chrome 起来 */ } await sleep(300); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || ''));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + d.params.args.map((a) => a.value || a.description).join(' '));
};
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await call('Page.enable'); await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await call('Emulation.setEmitTouchEventsForMouse', { enabled: false });
await call('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?tapcanvasPlaytest=1&seed=${SEED}&ts=${TS}&touch=1` });

const log = [];
const note = (s) => { const line = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`; log.push(line); console.log(line); };
const T0 = Date.now();
const snap = async () => {
  const r = await call('Runtime.evaluate', { expression: "JSON.stringify(globalThis.__TAPCANVAS_PLAYTEST__ ? globalThis.__TAPCANVAS_PLAYTEST__.snapshot() : {})", returnByValue: true });
  try { return JSON.parse(r.result.result.value); } catch { return {}; }
};
let shotN = 0;
const shot = async (label) => {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  const name = `${String(++shotN).padStart(2, '0')}-${label}.png`;
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
  const s = await snap();
  note(`截图 ${name}  状态 ${JSON.stringify({ scene: s.scene, hp: s.hp, lv: s.level, t: s.t, seg: s.seg, wicks: s.wicks, art: s.artifact })}`);
};
const touchId = { stick: 1, btn: 2 };
let stickDown = false; let stickOrigin = { x: w * 0.17, y: h * 0.72 };
const touchEv = (type, pts) => call('Input.dispatchTouchEvent', { type, touchPoints: pts });
const tap = async (rx, ry, label = '') => {
  const x = rx * w, y = ry * h;
  await touchEv('touchStart', [{ x, y, id: 7 }]); await sleep(70); await touchEv('touchEnd', []); if (label) note(`点按 ${label} (${Math.round(x)},${Math.round(y)})`);
};
const stickMove = async (dx, dy) => { // dx,dy 单位向量；null 松手
  if (dx === null) { if (stickDown) { await touchEv('touchEnd', []); stickDown = false; } return; }
  const R = 46; const tx = stickOrigin.x + dx * R, ty = stickOrigin.y + dy * R;
  if (!stickDown) { await touchEv('touchStart', [{ x: stickOrigin.x, y: stickOrigin.y, id: touchId.stick }]); stickDown = true; }
  await touchEv('touchMove', [{ x: tx, y: ty, id: touchId.stick }]);
};
// 视口单位 → CSS 像素（canvas_items + expand：以高度 720 为基准）
const sc = h / 720; const vw = w / sc;
const dashBtn = { x: (vw - 120) * sc, y: (720 - 120) * sc };
const skillBtn = { x: (vw - 290) * sc, y: (720 - 90) * sc };
const escKey = async () => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); };
const tapAbs = async (x, y) => { await touchEv('touchStart', [{ x, y, id: 9 }]); await sleep(60); await touchEv('touchEnd', []); };

const CX = 1250, CY = 697;
let kiteDir = 1;
const heading = (s, R) => { // 绕场地中心的圆周跑位（顺/逆时针），带径向修正
  const dx = s.x - CX, dy = s.y - CY; const r = Math.hypot(dx, dy) || 1;
  const tx = -dy / r * kiteDir, ty = dx / r * kiteDir; const k = (R - r) / R * 1.4;
  const ux = tx - dx / r * k, uy = ty - dy / r * k; const l = Math.hypot(ux, uy) || 1; return [ux / l, uy / l];
};
// 躲避：远离近处妖物与敌弹 + 绕圈 + 远离墙；s.near / s.bul 是相对主角的位置
const evade = (s, R) => {
  let [hx, hy] = heading(s, R);
  let ax = hx * 0.55, ay = hy * 0.55;
  for (const [dx, dy, d] of (s.near || [])) { if (d > 330) continue; const wgt = Math.pow(1 - d / 330, 2) * 2.4; ax -= dx / Math.max(d, 1) * wgt; ay -= dy / Math.max(d, 1) * wgt; }
  for (const [dx, dy] of (s.bul || [])) { const d = Math.hypot(dx, dy); if (d > 220) continue; const wgt = Math.pow(1 - d / 220, 2) * 1.6; ax -= dx / Math.max(d, 1) * wgt; ay -= dy / Math.max(d, 1) * wgt; }
  const l = Math.hypot(ax, ay) || 1; return [ax / l, ay / l];
};
const goto = (s, X, Y) => { const dx = X - s.x, dy = Y - s.y; const l = Math.hypot(dx, dy); return l < 28 ? [0, 0, l] : [dx / l, dy / l, l]; };

// ---------- 流程 ----------
let s = {};
for (let i = 0; i < 120 && s.scene !== 'title'; i++) { await sleep(500); s = await snap(); }
if (s.scene !== 'title') { note('标题页没出现'); process.exit(2); }
await sleep(800);
await shot('title');
await tap(0.85, 0.4, '开始夜行（点空白）');
for (let i = 0; i < 40 && s.scene !== 'play'; i++) { await sleep(300); s = await snap(); }
await sleep(600); await shot('start-joystick-and-buttons');
const seen = { levelup: false, break_: false, rift: false, sword: false, result: false, restart: false, gift: false, pause: false };
let lastShot = {}; let riftEntered = false; let dashT = 0; let kiteFlip = 0; let hold = 0; let deadline = Date.now() + 14 * 60 * 1000; let moveShot = false;
let phaseNote = '';
while (Date.now() < deadline) {
  s = await snap();
  if (!s.scene) { await sleep(300); continue; }
  const sc2 = s.scene;
  if (sc2 === 'levelup') {
    await stickMove(null); await sleep(300);
    if (!seen.levelup) { await shot('levelup-choose-one-of-three'); seen.levelup = true; }
    await tap(0.29, 0.5, '选第 1 张卡'); await sleep(700); continue;
  }
  if (sc2 === 'gift') { await stickMove(null); await sleep(300); if (!seen.gift) { await shot('gift-choice'); seen.gift = true; } await tap(0.29, 0.5, '选馈赠'); await sleep(700); continue; }
  if (sc2 === 'shop') { await stickMove(null); await sleep(200); await escKey(); await sleep(400); continue; }
  if (sc2 === 'result') {
    await stickMove(null); await sleep(800); await shot('result-death'); seen.result = true; break;
  }
  if (sc2 === 'paused') { await escKey(); await sleep(500); continue; }
  if (sc2 === 'dying') { await stickMove(null); await sleep(400); continue; }
  const ph = s.phase;
  if (ph !== undefined && String(ph) + (s.seg ?? '') !== phaseNote) { phaseNote = String(ph) + (s.seg ?? ''); note(`阶段 phase=${ph} seg=${s.seg} t=${s.t} hp=${s.hp}/${s.maxHp} wicks=${s.wicks} rift_state=${s.rift_state}`); }
  if (sc2 === 'break') {
    if (!seen.break_) { seen.break_ = true; await stickMove(null); await sleep(1200); await shot('break-field-cleared-rift-appears'); }
    let X, Y;
    if (!riftEntered && s.rift_state === 'ok') { X = CX; Y = CY; } else { X = CX + 430; Y = CY + 30; }
    const [ux, uy, l] = goto(s, X, Y);
    if (l < 28) { await stickMove(null); } else await stickMove(ux, uy);
    await sleep(120); continue;
  }
  if (sc2 === 'rift') {
    riftEntered = true;
    if (!seen.rift) { seen.rift = true; await stickMove(null); await sleep(900); await shot('rift-entered-warden'); }
    const [ux, uy] = evade(s, 250);
    kiteFlip++; if (kiteFlip % 160 === 0) kiteDir *= -1;
    await stickMove(ux, uy);
    if (Date.now() - dashT > 3200 && s.hp < s.maxHp * 0.7) { await tapAbs(dashBtn.x, dashBtn.y); dashT = Date.now(); }
    if (!lastShot.riftMid && (s.wardenHp || 0) > 0 && Date.now() - (lastShot.riftT ||= Date.now()) > 9000) { lastShot.riftMid = true; await shot('rift-fighting-warden'); }
    await sleep(100); continue;
  }
  if (s.artifact === 'sword' && !seen.sword) { seen.sword = true; await stickMove(null); await sleep(500); await shot('got-feijianshu'); }
  if (sc2 === 'play' || sc2 === 'dying') {
    if (!moveShot && Number(s.t) > 6) { moveShot = true; await shot('moving-and-auto-attacking'); }
    // 拿到飞剑术后：每隔一阵点“剑”出鞘/召回，截一张
    if (s.artifact === 'sword') {
      if (Date.now() - (lastShot.swordT ||= 0) > 2600) { lastShot.swordT = Date.now(); await tapAbs(skillBtn.x, skillBtn.y); if (!lastShot.swordShot) { lastShot.swordShot = true; await sleep(700); await shot('sword-out-orbiting'); } }
    }
    // 暂停/继续验证一次
    if (!seen.pause && Number(s.t) > 25) { seen.pause = true; await stickMove(null); await tapAbs((vw - 54) * sc, 54 * sc); await sleep(700); await shot('paused'); await escKey(); await sleep(400); continue; }
    // 打到足够久后停手等死（拿到飞剑术之后，且过了第 2 段），否则继续跑位生存
    const wantDie = seen.sword && Number(s.t) > 190;
    if (wantDie) { await stickMove(null); await sleep(500); continue; }
    const [ux, uy] = evade(s, 430);
    kiteFlip++; if (kiteFlip % 200 === 0) kiteDir *= -1;
    await stickMove(ux, uy);
    if (Date.now() - dashT > 3500 && (s.near || []).some((n) => n[2] < 70) && s.hp < s.maxHp * 0.85) { await tapAbs(dashBtn.x, dashBtn.y); dashT = Date.now(); }
    await sleep(100); continue;
  }
  await sleep(200);
}
if (seen.result) {
  await sleep(500);
  await tap(0.42, 0.70, '再来一局');
  for (let i = 0; i < 40 && s.scene !== 'play'; i++) { await sleep(300); s = await snap(); }
  await sleep(1200); await shot('restart-new-run'); seen.restart = s.scene === 'play';
}
await stickMove(null);
const summary = { viewport: `${w}x${h}`, seed: SEED, ts: TS, seen, errors: errors.slice(0, 5), finalScene: s.scene };
fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n') + '\n' + JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary));
ws.close(); chrome.kill(); server.close();
process.exit(0);
