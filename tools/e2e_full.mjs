// 完整自动化试玩（真实 Chrome + CDP 输入），一条命令跑通整条链并留证据：
//   node tools/e2e_full.mjs <desktop|phone> <seed> <输出目录> [ts=2]
// 链路：标题(无存档) → 新开 → 四向/斜向走位实测 → 自动攻击 → 升级三选一 → 清场裂隙出现(入口+引导) → 进副本 → 守关者 → 飞剑术/失败
//       → 出副本(威胁+1) → 存档 → 刷新页面 → 继续本局(逐项对照) → … → 死亡结算 → 再来一局。
// 只读 snapshot()（试玩桥）来“看”局面；全部操作走真实键盘/触摸事件。ts 只是 sim 加速倍率，不跳关不无敌。
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [MODE = 'desktop', SEED = '21', OUT = 'docs/verify/run', TS = '2'] = process.argv.slice(2);
const phone = MODE === 'phone';
const w = phone ? 844 : 1280, h = phone ? 390 : 720;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = path.join(ROOT, 'build/web');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const p = path.join(DIR, u === '/' ? 'index.html' : u); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const port = server.address().port;
const dbg = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, '--no-first-run', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', `--window-size=${w},${h}`, `--user-data-dir=/private/tmp/claude-501/chrome-full-${dbg}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch { /* wait */ } await sleep(300); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const errors = []; const frames = []; let recOn = false; let recName = '';
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 200));
  if (d.method === 'Page.screencastFrame') {
    if (recOn) frames.push({ t: d.params.metadata.timestamp, data: d.params.data, seg: recName });
    call('Page.screencastFrameAck', { sessionId: d.params.sessionId });
  }
};
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await call('Page.enable'); await call('Runtime.enable');
if (phone) {
  await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
}
const URL_ = `http://127.0.0.1:${port}/index.html?tapcanvasPlaytest=1&seed=${SEED}&ts=${TS}${phone ? '&touch=1' : ''}`;
const T0 = Date.now(); const log = [];
const note = (s) => { const l = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`; log.push(l); console.log(l); };
const snap = async () => { const r = await call('Runtime.evaluate', { expression: 'JSON.stringify(globalThis.__TAPCANVAS_PLAYTEST__?globalThis.__TAPCANVAS_PLAYTEST__.snapshot():{})', returnByValue: true }); try { return JSON.parse(r.result.result.value); } catch { return {}; } };
let n = 0;
const shot = async (label) => { const r = await call('Page.captureScreenshot', { format: 'png' }); const name = `play-${String(++n).padStart(2, '0')}-${label}.png`; fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64')); const s = await snap(); note(`截图 ${name} ${JSON.stringify({ scene: s.scene, hp: s.hp, lv: s.level, t: s.t, seg: s.seg, wicks: s.wicks, art: s.artifact })}`); return s; };
const rec = async (on, name = '') => { if (on && recOn) { recName = name; return; } if (!on && !recOn) return; if (on) { recName = name; recOn = true; await call('Page.startScreencast', { format: 'jpeg', quality: 60, everyNthFrame: 2 }); } else { recOn = false; await call('Page.stopScreencast'); } };

// ---------- 输入抽象 ----------
const held = new Set();
const KEYS = { w: ['KeyW', 87], a: ['KeyA', 65], s: ['KeyS', 83], d: ['KeyD', 68], ' ': ['Space', 32], e: ['KeyE', 69], Enter: ['Enter', 13], Escape: ['Escape', 27], 1: ['Digit1', 49], 2: ['Digit2', 50], 3: ['Digit3', 51] };
const keyDown = (k) => { if (held.has(k)) return; held.add(k); const [code, vk] = KEYS[k]; return call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text: k.length === 1 ? k : undefined }); };
const keyUp = (k) => { if (!held.has(k)) return; held.delete(k); const [code, vk] = KEYS[k]; return call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
const keyTap = async (k) => { await keyDown(k); await sleep(60); await keyUp(k); };
let stickDown = false; const stickOrigin = { x: w * 0.17, y: h * 0.72 };
const touch = (type, pts) => call('Input.dispatchTouchEvent', { type, touchPoints: pts });
const sc = h / 720, vw = w / sc;
const btn = { dash: [(vw - 120) * sc, 600 * sc], skill: [(vw - 290) * sc, 630 * sc], pause: [(vw - 54) * sc, 54 * sc] };
const tapAbs = async (x, y) => { await touch('touchStart', [{ x, y, id: 9 }]); await sleep(60); await touch('touchEnd', []); };
const move = async (ux, uy) => { // 单位向量；null=停
  if (!phone) {
    const want = new Set(); if (ux !== null) { if (ux < -0.38) want.add('a'); if (ux > 0.38) want.add('d'); if (uy < -0.38) want.add('w'); if (uy > 0.38) want.add('s'); }
    for (const k of ['w', 'a', 's', 'd']) { if (want.has(k)) await keyDown(k); else await keyUp(k); }
    return;
  }
  if (ux === null) { if (stickDown) { await touch('touchEnd', []); stickDown = false; } return; }
  const R = 46; const tx = stickOrigin.x + ux * R, ty = stickOrigin.y + uy * R;
  if (!stickDown) { await touch('touchStart', [{ x: stickOrigin.x, y: stickOrigin.y, id: 1 }]); stickDown = true; }
  await touch('touchMove', [{ x: tx, y: ty, id: 1 }]);
};
const dash = () => (phone ? tapAbs(...btn.dash) : keyTap(' '));
const skill = () => (phone ? tapAbs(...btn.skill) : keyTap('e'));
const choose = async (i = 0) => { if (phone) await tapAbs((0.29 + 0.207 * i) * w, 0.5 * h); else await keyTap(String(i + 1)); };
const pause = () => (phone ? tapAbs(...btn.pause) : keyTap('Escape'));
const tapRel = async (rx, ry) => { if (phone) await tapAbs(rx * w, ry * h); else { await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx * w, y: ry * h, button: 'left', clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx * w, y: ry * h, button: 'left', clickCount: 1 }); } };

const CX = 1250, CY = 697; let kiteDir = 1, tick = 0;
const evade = (s, R) => {
  const dx = s.x - CX, dy = s.y - CY, r = Math.hypot(dx, dy) || 1;
  const k = (R - r) / R * 1.4; let ax = (-dy / r * kiteDir - dx / r * k) * 0.55, ay = (dx / r * kiteDir - dy / r * k) * 0.55;
  for (const [ex, ey, d] of (s.near || [])) { if (d > 330) continue; const g = Math.pow(1 - d / 330, 2) * 2.4; ax -= ex / Math.max(d, 1) * g; ay -= ey / Math.max(d, 1) * g; }
  for (const [bx, by] of (s.bul || [])) { const d = Math.hypot(bx, by); if (d > 220) continue; const g = Math.pow(1 - d / 220, 2) * 1.6; ax -= bx / Math.max(d, 1) * g; ay -= by / Math.max(d, 1) * g; }
  const l = Math.hypot(ax, ay) || 1; return [ax / l, ay / l];
};
const goto = (s, X, Y) => { const dx = X - s.x, dy = Y - s.y, l = Math.hypot(dx, dy); return l < 28 ? [null, null, l] : [dx / l, dy / l, l]; };
const waitScene = async (name, ms = 20000) => { let s = {}; for (let i = 0; i < ms / 250; i++) { s = await snap(); if (s.scene === name) return s; await sleep(250); } return s; };

// ---------- 流程 ----------
const res = { mode: MODE, seed: SEED, ts: TS, checks: {}, move: {}, save: {}, seen: {} };
await call('Page.navigate', { url: URL_ });
await waitScene('title', 40000); await sleep(800);
await call('Runtime.evaluate', { expression: "localStorage.removeItem('denghai_yexing_save_v15')" });
await call('Page.navigate', { url: URL_ }); await waitScene('title', 40000); await sleep(1500);
let s = await shot('title-no-save'); res.checks.titleNoContinue = s.has_run === false;
await rec(true, 'move');
if (phone) await tapRel(0.2, 0.44); else await keyTap('Enter');
s = await waitScene('play', 10000); await sleep(500); await shot('new-run-start');

// 走位实测：空场时四向 + 斜向各按 0.8 秒(sim 时间)，量位移/速度
const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], 'up-right': [0.7071, -0.7071] };
for (const [name, v] of Object.entries(dirs)) {
  await move(null, null); await sleep(400);
  const a = await snap();
  const useKeys = phone ? v : [Math.sign(v[0]) * (v[0] ? 1 : 0), Math.sign(v[1]) * (v[1] ? 1 : 0)];
  await move(useKeys[0], useKeys[1]);
  await sleep(900 / Number(TS));
  const b = await snap();
  await move(null, null);
  const dt = b.t - a.t, dist = Math.hypot(b.x - a.x, b.y - a.y);
  res.move[name] = { dist: Math.round(dist), dt: +dt.toFixed(2), speed: Math.round(dist / Math.max(dt, 0.01)), dir: [Math.round(b.x - a.x), Math.round(b.y - a.y)] };
  await shot(`walk-${name}`);
}
await rec(false);
const sp = res.move; res.move.diagRatio = +(sp['up-right'].speed / ((sp.left.speed + sp.right.speed + sp.up.speed + sp.down.speed) / 4)).toFixed(3);
note('走位实测 ' + JSON.stringify(res.move));

let deadline = Date.now() + 16 * 60 * 1000;
let lastS = {}, riftEntered = false, riftShots = 0, savedReload = false, restarted = false, dashT = 0, sawBreakShot = false, sawArrow = false, bossShot = false, pausedOnce = false, lvlShot = false;
let before = null;
while (Date.now() < deadline) {
  s = await snap(); if (!s.scene) { await sleep(300); continue; }
  lastS = s;
  if (s.scene === 'levelup' || s.scene === 'gift') {
    await move(null, null); await sleep(250);
    if (s.scene === 'levelup' && !lvlShot) { lvlShot = true; await shot('levelup-choose-one-of-three'); }
    if (s.scene === 'gift') await shot('gift-choice');
    await choose(0); await sleep(600); continue;
  }
  if (s.scene === 'result') {
    await move(null, null); await sleep(900); await shot('result'); res.seen.result = true;
    await sleep(400); if (phone) await tapRel(0.42, 0.7); else await keyTap('Enter'); // 再来一局
    s = await waitScene('play', 10000); await sleep(1200); await shot('restart-new-run'); restarted = s.scene === 'play'; res.seen.restart = restarted; break;
  }
  if (s.scene === 'paused') { await shot('paused-manual-save-button'); await keyTap('Escape'); await sleep(400); continue; }   // 暂停时触屏按钮层隐藏，手机上点暂停键无法恢复（玩家点面板「继续」）；脚本统一用 Esc 恢复
  if (s.scene === 'dying') { await move(null, null); await sleep(400); continue; }
  if (s.scene === 'break' || s.scene === 'shop') {
    res.seen.break = true;
    if (!sawBreakShot) { sawBreakShot = true; await move(null, null); await sleep(500); await shot('break-rift-appears-with-hint'); }
    if (s.rift_state === 'ok' && !riftEntered && (s.x - 1250) ** 2 + (s.y - 697) ** 2 > 360 ** 2 && !sawArrow) { sawArrow = true; await shot('break-arrow-pointing-to-rift'); }
    // 存档→刷新→继续：在“出副本后的段间”做一次（此时已有 自动存档：rift_exit），对照数值
    if (riftEntered && s.rift_state !== 'none' && !savedReload && s.scene === 'break') {
      savedReload = true; await move(null, null); await sleep(600);
      await rec(false);
      before = await snap(); await shot('before-refresh-state');
      await sleep(500);
      await call('Page.navigate', { url: URL_ });
      await waitScene('title', 40000); await sleep(1500);
      const t = await shot('after-refresh-title-continue-button'); res.save.hasContinue = t.has_run === true;
      await rec(true, 'continue');
      if (phone) await tapRel(0.2, 0.44); else await keyTap('Enter');
      const after = await waitScene('break', 15000); await sleep(800); await shot('after-continue-state');
      await rec(false);
      const keys = ['seg', 'hp', 'level', 'wicks', 'artifact', 'rift', 'relics', 'lvsum', 'threat', 'break_idx'];
      res.save.before = Object.fromEntries(keys.map((k) => [k, before[k]])); res.save.after = Object.fromEntries(keys.map((k) => [k, after[k]]));
      res.save.same = Object.fromEntries(keys.map((k) => [k, before[k] === after[k]]));
      note('续档对照 ' + JSON.stringify(res.save));
      continue;
    }
    let X, Y; const goRift = !riftEntered && s.rift_state === 'ok';
    if (goRift) { X = CX; Y = CY; } else { X = CX + 430; Y = CY + 30; }
    const [ux, uy, l] = goto(s, X, Y);
    await move(ux, uy); await sleep(120); continue;
  }
  if (s.scene === 'rift') {
    if (!riftEntered) { riftEntered = true; res.seen.rift = true; await move(null, null); await rec(true, 'rift'); await sleep(900); await shot('rift-entered-warden'); before = null; }
    const [ux, uy] = evade(s, 250); tick++; if (tick % 160 === 0) kiteDir *= -1;
    await move(ux, uy);
    if (s.artifact === 'sword') await skill();
    if (Date.now() - dashT > 3200 && s.hp < s.maxHp * 0.75) { await dash(); dashT = Date.now(); }
    if (riftShots < 2 && (s.wardenHp || 0) > 0 && Math.random() < 0.02) { riftShots++; await shot('rift-fighting-warden'); }
    await sleep(100); continue;
  }
  // 战斗段
  if (riftEntered && !res.seen.afterRift) { res.seen.afterRift = true; await rec(false); await shot('after-rift-threat-up'); res.seen.sword = s.artifact === 'sword'; if (s.artifact === 'sword') await shot('got-feijianshu'); }
  if (s.phase === 3 && !bossShot) { bossShot = true; await shot('boss'); res.seen.boss = true; }
  if (!pausedOnce && s.t > 25 && !riftEntered) { pausedOnce = true; await move(null, null); await pause(); await sleep(700); await shot('paused-manual-save-button'); await keyTap('Escape'); await sleep(300); continue; }
  if (s.artifact === 'sword' && Date.now() - (lastS.swT ||= 0) > 2600) { lastS.swT = Date.now(); await skill(); }
  const [ux, uy] = evade(s, 430); tick++; if (tick % 200 === 0) kiteDir *= -1;
  await move(ux, uy);
  if (Date.now() - dashT > 3500 && (s.near || []).some((q) => q[2] < 70) && s.hp < s.maxHp * 0.85) { await dash(); dashT = Date.now(); }
  await sleep(100);
}
await move(null, null);
// 录像：把各段帧按时间戳拼成一个 mp4
let video = '';
if (frames.length > 10) {
  const fd = path.join(OUT, '_frames'); fs.mkdirSync(fd, { recursive: true });
  let list = '';
  frames.forEach((f, i) => { const fn = `f${String(i).padStart(5, '0')}.jpg`; fs.writeFileSync(path.join(fd, fn), Buffer.from(f.data, 'base64')); const nxt = frames[i + 1]; const dur = nxt && nxt.seg === f.seg ? Math.min(0.5, Math.max(0.04, nxt.t - f.t)) : 0.3; list += `file '${fn}'\nduration ${dur.toFixed(3)}\n`; });
  list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
  fs.writeFileSync(path.join(fd, 'list.txt'), list);
  video = path.join(OUT, `play-video-${MODE}.mp4`);
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(fd, 'list.txt'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=15', '-pix_fmt', 'yuv420p', video]); } catch (e) { note('ffmpeg 失败 ' + e.message.slice(0, 100)); video = ''; }
  fs.rmSync(fd, { recursive: true, force: true });
}
res.video = video; res.errors = errors.slice(0, 5); res.screens = n; res.final = lastS.scene;
fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n') + '\n' + JSON.stringify(res, null, 1) + '\n');
console.log(JSON.stringify(res));
ws.close(); chrome.kill(); server.close(); process.exit(0);
