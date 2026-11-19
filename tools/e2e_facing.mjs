// 朝左回归：按住 D → 模拟失焦(截图) → 按 A 应能向左走；并截朝左/朝右站立图。node tools/e2e_facing.mjs
import { spawn } from 'node:child_process'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const DIR = path.join(ROOT, 'build/web'); const OUT = path.join(ROOT, 'docs/verify/facing');
const server = http.createServer((q, r) => { const u = q.url.split('?')[0]; const p = path.join(DIR, u === '/' ? 'index.html' : u); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' }[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const dbg = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${dbg}`, '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720', `--user-data-dir=/private/tmp/claude-501/chrome-fc${dbg}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 60; i++) { try { t = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (t.find((x) => x.type === 'page')) break; } catch {} await sleep(300); }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const call = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html?tapcanvasPlaytest=1&seed=5` });
const snap = async () => { const r = await call('Runtime.evaluate', { expression: 'JSON.stringify(globalThis.__TAPCANVAS_PLAYTEST__?globalThis.__TAPCANVAS_PLAYTEST__.snapshot():{})', returnByValue: true }); try { return JSON.parse(r.result.result.value); } catch { return {}; } };
const K = { a: ['KeyA', 65], d: ['KeyD', 68], Enter: ['Enter', 13] };
const key = (type, k) => call('Input.dispatchKeyEvent', { type, key: k, code: K[k][0], windowsVirtualKeyCode: K[k][1] });
const shot = async (n) => { const r = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n), Buffer.from(r.result.data, 'base64')); };
for (let i = 0; i < 80 && (await snap()).scene !== 'title'; i++) await sleep(500);
await sleep(1000); await key('keyDown', 'Enter'); await key('keyUp', 'Enter');
for (let i = 0; i < 40 && (await snap()).scene !== 'play'; i++) await sleep(300);
await sleep(800);
const run = async (k, ms) => { const a = await snap(); await key('keyDown', k); const t0 = a.t; for (let i = 0; i < 100; i++) { await sleep(60); if ((await snap()).t - t0 >= ms) break; } const b = await snap(); return [a, b]; };
let [a, b] = await run('d', 0.8); console.log('hold D: dx =', b.x - a.x);
await shot('facing-right-walking.png');
// 不松 D，模拟失焦（截图/切窗）：页面 blur 事件
await call('Runtime.evaluate', { expression: "window.dispatchEvent(new Event('blur'))" }); await sleep(400);
const s1 = await snap(); await key('keyDown', 'a'); const t0 = s1.t; for (let i = 0; i < 100; i++) { await sleep(60); if ((await snap()).t - t0 >= 0.8) break; } const s2 = await snap();
console.log('after blur, hold A: dx =', s2.x - s1.x, s2.x - s1.x < -40 ? 'PASS 能左转' : 'FAIL');
await shot('facing-left-walking.png'); await key('keyUp', 'a'); await sleep(500); await shot('facing-left-standing.png');
chrome.kill(); server.close(); process.exit(s2.x - s1.x < -40 ? 0 : 1);
