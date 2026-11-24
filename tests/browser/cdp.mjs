// 极简浏览器驱动：本机 Chrome（headless）+ DevTools 协议，Node 自带 WebSocket，不依赖 Playwright/Puppeteer。
// 起一个只读静态服务（node:http）托管 dist/，用真实键鼠事件驱动游戏、截图、读 __TAPCANVAS_PLAYTEST__.snapshot()。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.css': 'text/css', '.mp3': 'audio/mpeg' };

export function serve(root, port) {
  const missing = [];
  const srv = createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const buf = await readFile(join(root, p.endsWith('/') ? `${p}index.html` : p));
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      missing.push(p);
      res.writeHead(404); res.end();
    }
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok({ srv, missing })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Browser {
  static async launch({ port = 9333, width = 1280, height = 720, mobile = null } = {}) {
    const dir = join(tmpdir(), `cdp-prof-${port}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless=new', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required', ...(process.env.CDP_GPU === '1' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
    let ws;
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        const pg = list.find((t) => t.type === 'page');
        if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; }
      } catch { /* 还没起来 */ }
    }
    if (!ws) throw new Error('Chrome 没有启动');
    await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
    const b = new Browser(proc, ws);
    await b.send('Page.enable');
    await b.send('Runtime.enable');
    await b.send('Log.enable');
    await b.send('Emulation.setDeviceMetricsOverride', mobile || { width, height, deviceScaleFactor: 1, mobile: false });
    if (mobile) await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    b.width = mobile ? mobile.width : width;
    b.height = mobile ? mobile.height : height;
    return b;
  }

  constructor(proc, ws) {
    this.proc = proc;
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    this.logs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); if (m.error) p.no(new Error(m.error.message)); else p.ok(m.result); }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled') {
        const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (m.params.type === 'error') this.errors.push(`console.error: ${text}`); else this.logs.push(text);
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') this.errors.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, no) => this.pending.set(id, { ok, no }));
  }

  async goto(url) { await this.send('Page.navigate', { url }); await sleep(500); }

  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  snap() { return this.eval('globalThis.__TAPCANVAS_PLAYTEST__ ? __TAPCANVAS_PLAYTEST__.snapshot() : null'); }

  async until(pred, timeoutMs = 30000, label = '') {
    const t0 = Date.now();
    for (;;) {
      const s = await this.snap().catch(() => null);
      if (s && pred(s)) return s;
      if (Date.now() - t0 > timeoutMs) throw new Error(`等待超时：${label} 最后状态 ${JSON.stringify(s)}`);
      await sleep(150);
    }
  }

  // 按进度等待：只要游戏内时钟（snapshot.t）还在推进就继续等，连续 stallMs 不推进才判失败。
  // 为什么：机器负载高时 headless 帧率会掉到个位数，固定墙钟超时会误判；真卡死（时钟不走）仍会被抓住。
  async untilProgress(pred, { stallMs = 20000, capMs = 900000, label = '' } = {}) {
    const t0 = Date.now();
    let lastT = null;
    let lastMove = Date.now();
    for (;;) {
      const s = await this.snap().catch(() => null);
      if (s && pred(s)) return s;
      const gt = s ? s.t : null;
      if (gt !== lastT) { lastT = gt; lastMove = Date.now(); }
      if (Date.now() - lastMove > stallMs) throw new Error(`游戏时钟停止推进：${label} 最后状态 ${JSON.stringify(s)}`);
      if (Date.now() - t0 > capMs) throw new Error(`等待超过上限：${label} 最后状态 ${JSON.stringify(s)}`);
      await sleep(200);
    }
  }

  static keyInfo(key) {
    const named = { Enter: [13, 'Enter'], Escape: [27, 'Escape'], Tab: [9, 'Tab'], ' ': [32, 'Space'], ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'] };
    if (named[key]) return { code: named[key][1], kc: named[key][0], text: key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined };
    if (/^[0-9]$/.test(key)) return { code: `Digit${key}`, kc: key.charCodeAt(0), text: key };
    return { code: `Key${key.toUpperCase()}`, kc: key.toUpperCase().charCodeAt(0), text: key };
  }

  async keyDown(key) { if (key === 'Space') key = ' '; const k = Browser.keyInfo(key); await this.send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', key, code: k.code, windowsVirtualKeyCode: k.kc, text: k.text }); }
  async keyUp(key) { if (key === 'Space') key = ' '; const k = Browser.keyInfo(key); await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.kc }); }
  async press(key, holdMs = 60) { await this.keyDown(key); await sleep(holdMs); await this.keyUp(key); }

  async click(rx, ry, holdMs = 60) {
    const x = rx * this.width; const y = ry * this.height;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(holdMs);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async mouseMove(rx, ry) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx * this.width, y: ry * this.height }); }

  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path, Buffer.from(r.data, 'base64'));
    return path;
  }

  async close() { try { this.ws.close(); } catch { /* 已关 */ } this.proc.kill('SIGKILL'); }
}

export { sleep };
