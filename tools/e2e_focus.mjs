// 桌面焦点回归：点画布边缘后按 Enter 仍应开局。node tools/e2e_focus.mjs
import { spawn } from 'node:child_process'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build/web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const u = q.url.split('?')[0]; const p = path.join(DIR, u === '/' ? 'index.html' : u); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const dbg = 9500 + Math.floor(Math.random() * 90);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${dbg}`, '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', `--user-data-dir=/private/tmp/claude-501/chrome-f${dbg}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 60; i++) { try { t = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (t.find((x) => x.type === 'page')) break; } catch {} await sleep(300); }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html?tapcanvasPlaytest=1` });
const snap = async () => { const r = await call('Runtime.evaluate', { expression: 'JSON.stringify(globalThis.__TAPCANVAS_PLAYTEST__?globalThis.__TAPCANVAS_PLAYTEST__.snapshot():{})', returnByValue: true }); try { return JSON.parse(r.result.result.value).scene; } catch { return '?'; } };
for (let i = 0; i < 60 && (await snap()) !== 'title'; i++) await sleep(500);
await sleep(1000);
const mouse = async (x, y) => { await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); };
await mouse(1279, 799); await sleep(500);
const key = async (k, code, vk) => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
await key('Enter', 'Enter', 13); await sleep(2000);
const s1 = await snap(); console.log('after corner click + Enter:', s1);
chrome.kill(); server.close(); process.exit(s1 === 'play' ? 0 : 1);
