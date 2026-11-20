// 真实后期压测：node tools/bench_late.mjs <输出json> [到达战斗时钟秒=700] [采样秒=20] [seed=3]
// 网页版 ?tapcanvasPlaytest=1&bot=1：真人代理机器人（与 tests/latecost.gd 同一个 Bot）代打完整模式；不降速 8× 快进到目标时钟，
// 再切回 1×、开 CDP CPU 降速 THROTTLE（默认 4，模拟中低端手机）采样 rAF 帧间隔与引擎分项。不是合成场景：妖物/弹幕/掉落/事件全是真实对局产生的。
import { spawn } from 'node:child_process'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [OUT = 'docs/perf/late.json', AT = '700', SEC = '20', SEED = '3'] = process.argv.slice(2);
const THROTTLE = Number(process.env.THROTTLE || 4);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const DIR = path.join(ROOT, process.env.BENCH_DIR || 'build/web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const u = q.url.split('?')[0]; const p = path.join(DIR, u === '/' ? 'index.html' : u); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', `--remote-debugging-port=${dbg}`, '--no-first-run', '--enable-precise-memory-info', '--window-size=1280,720', `--user-data-dir=/private/tmp/claude-501/chrome-late${dbg}`, 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 60; i++) { try { t = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (t.find((x) => x.type === 'page')) break; } catch {} await sleep(300); }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const call = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await call('Runtime.evaluate', { expression: e, returnByValue: true })).result.result?.value;
await call('Page.enable');
await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__fr=[];window.__lt=0;window.__ltd=0;window.__rec=false;(function loop(t){ if(window.__rec) window.__fr.push(t); requestAnimationFrame(loop);})(0);try{new PerformanceObserver(l=>{if(window.__rec){for(const e of l.getEntries()){window.__lt++;window.__ltd=Math.max(window.__ltd,e.duration)}}}).observe({entryTypes:['longtask']})}catch(e){}` });
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html?tapcanvasPlaytest=1&bot=1&ts=8&seed=${SEED}${process.env.TOUCH ? '&touch=1' : ''}` });
const snap = async () => { try { return JSON.parse(await ev('JSON.stringify(globalThis.__TAPCANVAS_PLAYTEST__?globalThis.__TAPCANVAS_PLAYTEST__.snapshot():{})')); } catch { return {}; } };
for (let i = 0; i < 120 && (await snap()).scene !== 'title'; i++) await sleep(500);
await sleep(800);
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
const t0 = Date.now(); let s = {};
for (;;) { await sleep(2000); s = await snap(); if ((s.clock || 0) >= Number(AT) && s.phase === 0 && (s.bench_en || 0) > Number(process.env.MIN_EN || 220)) break; if (s.scene === 'result' || Date.now() - t0 > 900000) break; if (((Date.now() - t0) / 2000 | 0) % 15 === 0) console.error('ff clock', s.clock, 'scene', s.scene, 'en', s.bench_en, 'lv', s.lv); }
console.error('reached clock', s.clock, 'en', s.bench_en, 'scene', s.scene, 'after', ((Date.now() - t0) / 1000) | 0, 's');
await ev('globalThis.__tc_ts = 1'); await sleep(1500);
if (THROTTLE > 1) await call('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await sleep(3000);
await ev('window.__fr=[];window.__lt=0;window.__ltd=0;window.__rec=true');
const mid = []; const partsMid = []; for (let i = 0; i < Number(SEC) / 2; i++) { await sleep(2000); const q = await snap(); partsMid.push(q.perf?.parts); mid.push({ clock: q.clock, en: q.bench_en, bul: q.bench_bul, eb: q.bench_ebul, pk: q.bench_pk, dc: q.perf?.draw_calls, scene: q.scene }); }
await ev('window.__rec=false');
const fr = JSON.parse(await ev('JSON.stringify({fr:window.__fr,lt:window.__lt,ltd:window.__ltd})'));
const d = []; for (let i = 1; i < fr.fr.length; i++) d.push(fr.fr[i] - fr.fr[i - 1]); d.sort((a, b) => a - b);
const pct = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))]; const mean = d.reduce((a, b) => a + b, 0) / d.length;
const parts = {}; const acc = {}; for (const m of partsMid) for (const [k, v] of Object.entries(m || {})) (acc[k] ||= []).push(v);
for (const [k, vs] of Object.entries(acc)) parts[k] = +(vs.reduce((a, v) => a + v[0], 0) / vs.length).toFixed(2);
const row = { touch: !!process.env.TOUCH, at: Number(AT), seed: Number(SEED), throttle: THROTTLE, frames: d.length, fps: +(1000 / mean).toFixed(1), mean_ms: +mean.toFixed(2), p50_ms: +pct(0.5).toFixed(1), p95_ms: +pct(0.95).toFixed(1), p99_ms: +pct(0.99).toFixed(1), worst_ms: +d[d.length - 1].toFixed(1), over33_pct: +(100 * d.filter((x) => x > 33.4).length / d.length).toFixed(1), longtasks: fr.lt, longtask_max_ms: +fr.ltd.toFixed(0), parts_ms_per_frame: parts, samples: mid };
console.log(JSON.stringify(row, null, 1));
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), row }, null, 1));
ws.close(); chrome.kill(); server.close(); process.exit(0);
