// 无头 Chrome + CDP 录音：node tools/record_bgm.mjs <构建目录> <输出目录>
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const [dir, outDir] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = http.createServer((req, res) => {
  const p = path.join(dir, req.url.split('?')[0] === '/' ? 'bgm.html' : req.url.split('?')[0]);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(d); });
}).listen(0);
const port = server.address().port;
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9347', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--user-data-dir=/private/tmp/claude-501/chrome-bgm', `http://127.0.0.1:${port}/`], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9347/json')).json(); if (targets.find((t) => t.type === 'page')) break; } catch {} await sleep(300); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
await sleep(1500);
fs.mkdirSync(outDir, { recursive: true });
for (const [mode, secs] of [['title', 62], ['battle', 46], ['boss', 46]]) {
  const b64 = await ev(`(async () => {
    const A = window.__A; await A.ctx.resume(); A.setMuted(false);
    const dest = A.ctx.createMediaStreamDestination(); A.master.connect(dest);
    const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
    const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
    A.music.play('${mode}');
    await new Promise((r) => setTimeout(r, 2500));
    rec.start(); await new Promise((r) => setTimeout(r, ${secs * 1000})); rec.stop();
    await new Promise((r) => (rec.onstop = r));
    A.master.disconnect(dest); A.music.play('none');
    const buf = await new Blob(chunks).arrayBuffer();
    let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  const raw = path.join(outDir, `raw_${mode}.webm`);
  fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
  // 无缝循环：取前 3 秒作为“头”，剩余作为“身”，身的尾 3 秒与头交叉淡化 → 循环回到身的开头时波形连续
  const out = path.join(outDir, `bgm_${mode}.mp3`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-filter_complex',
    '[0:a]asplit[a][b];[a]atrim=0:3,asetpts=PTS-STARTPTS[head];[b]atrim=3,asetpts=PTS-STARTPTS[body];[body][head]acrossfade=d=3:c1=tri:c2=tri[o]',
    '-map', '[o]', '-c:a', 'libmp3lame', '-q:a', '4', '-ac', '2', out]);
  fs.unlinkSync(raw);
  console.log('ok', mode, fs.statSync(out).size);
}
ws.close(); chrome.kill(); server.close();
