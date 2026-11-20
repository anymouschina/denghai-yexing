// 性能压测：node tools/bench.mjs <N列表,逗号分隔> <输出json> [采样秒=20] [gpu=1|0] [宽x高=1280x720]
// 每档：加载 build/web?tapcanvasPlaytest=1&bench=N，进入对局，预热 6s，采样 S 秒：
//   rAF 帧间隔(平均FPS/平均/p95/p99/最差/>33ms占比)、JS heap、长任务数、引擎内分项耗时(sim/视图/HUD/绘制，微秒/帧)、绘制调用、同屏实体数。
// 同一脚本同档位用于“修复前/修复后”对比。bench 模式：同屏妖物恒为 N、满级三武器+进化+飞剑、玩家不死（见 game_screen._bench_keepalive）。
import { spawn } from 'node:child_process'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [NS = '50,100,200,300', OUT = 'docs/perf/bench.json', SEC = '20', GPU = '1', SIZE = '1280x720'] = process.argv.slice(2);
const [W, H] = SIZE.split('x').map(Number); const THROTTLE = Number(process.env.THROTTLE || 1);   // CDP CPU 降速倍数，模拟中低端手机（4 = 慢 4 倍）
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const DIR = path.join(ROOT, process.env.BENCH_DIR || 'build/web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const u = q.url.split('?')[0]; const p = path.join(DIR, u === '/' ? 'index.html' : u); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
for (const N of NS.split(',').map(Number)) {
  const dbg = 9100 + Math.floor(Math.random() * 400);
  const flags = ['--headless=new', `--remote-debugging-port=${dbg}`, '--no-first-run', '--enable-precise-memory-info', `--window-size=${W},${H}`, `--user-data-dir=/private/tmp/claude-501/chrome-bn${dbg}`, 'about:blank'];
  if (GPU === '1') flags.splice(2, 0, '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'); else flags.splice(2, 0, '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', flags, { stdio: 'ignore' });
  let t; for (let i = 0; i < 60; i++) { try { t = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); if (t.find((x) => x.type === 'page')) break; } catch {} await sleep(300); }
  const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const call = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => (await call('Runtime.evaluate', { expression: e, returnByValue: true })).result.result?.value;
  await call('Page.enable'); if (THROTTLE > 1) await call('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__fr=[];window.__lt=0;window.__rec=false;(function loop(t){ if(window.__rec) window.__fr.push(t); requestAnimationFrame(loop);})(0);try{new PerformanceObserver(l=>{if(window.__rec)window.__lt+=l.getEntries().length}).observe({entryTypes:['longtask']})}catch(e){}` });
  await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html?tapcanvasPlaytest=1&seed=5&bench=${N}${process.env.HIDE ? '&hide=' + process.env.HIDE : ''}` });
  const snap = async () => { try { return JSON.parse(await ev('JSON.stringify(globalThis.__TAPCANVAS_PLAYTEST__?globalThis.__TAPCANVAS_PLAYTEST__.snapshot():{})')); } catch { return {}; } };
  for (let i = 0; i < 120 && (await snap()).scene !== 'title'; i++) await sleep(500);
  await sleep(800);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  for (let i = 0; i < 40 && (await snap()).scene !== 'play'; i++) await sleep(300);
  for (let i = 0; i < 120 && ((await snap()).bench_en || 0) < N * 0.95; i++) await sleep(500);   // 等同屏达到 N
  await sleep(6000);
  const s0 = await snap(); const heap0 = await ev('performance.memory.usedJSHeapSize');
  await ev('window.__fr=[];window.__lt=0;window.__rec=true');
  const mid = []; const partsMid = []; for (let i = 0; i < Number(SEC) / 2; i++) { await sleep(2000); const s = await snap(); partsMid.push(s.perf?.parts); mid.push([s.bench_en, s.bench_bul, s.bench_ebul, s.bench_pk, s.perf?.draw_calls]); }
  await ev('window.__rec=false');
  const s1 = await snap(); const heap1 = await ev('performance.memory.usedJSHeapSize');
  const fr = JSON.parse(await ev('JSON.stringify({fr:window.__fr,lt:window.__lt})'));
  const d = []; for (let i = 1; i < fr.fr.length; i++) d.push(fr.fr[i] - fr.fr[i - 1]); d.sort((a, b) => a - b);
  const pct = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const parts = {}; const acc = {}; for (const m of partsMid) for (const [k, v] of Object.entries(m || {})) { (acc[k] ||= []).push(v); }
  for (const [k, vs] of Object.entries(acc)) parts[k] = { ms_per_frame: +(vs.reduce((a, v) => a + v[0], 0) / vs.length).toFixed(3), calls_per_frame: +(vs.reduce((a, v) => a + v[1], 0) / vs.length).toFixed(2) };
  const row = { N, throttle: THROTTLE, size: SIZE, gpu: GPU, frames: d.length, fps: +(1000 / mean).toFixed(1), mean_ms: +mean.toFixed(2), p50_ms: +pct(0.5).toFixed(1), p95_ms: +pct(0.95).toFixed(1), p99_ms: +pct(0.99).toFixed(1), worst_ms: +d[d.length - 1].toFixed(1),
    over33_pct: +(100 * d.filter((x) => x > 33.4).length / d.length).toFixed(1), longtasks: fr.lt, heap_mb_start: +(heap0 / 1048576).toFixed(1), heap_mb_end: +(heap1 / 1048576).toFixed(1), entities: { enemies: s1.bench_en, bullets: s1.bench_bul, ebullets: s1.bench_ebul, pickups: s1.bench_pk },
    engine: { draw_calls: s1.perf?.draw_calls, nodes: s1.perf?.nodes, mem_mb: s1.perf?.mem_mb, tex_mb: s1.perf?.tex_mb, process_ms: s1.perf?.process_ms }, parts };
  console.log(JSON.stringify(row)); results.push(row);
  ws.close(); chrome.kill(); await sleep(1500);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), results }, null, 1));
server.close(); process.exit(0);
