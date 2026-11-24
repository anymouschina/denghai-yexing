// 性能分档（真实浏览器）：同屏妖物 0/50/100/200/260（上限）× 建筑 0/10/20。
// 测：渲染帧率（rAF/秒）、游戏时钟推进比（模拟秒/墙钟秒，<1 说明掉帧拖慢了游戏）、单个模拟 tick 平均耗时。
// 只为测量：暂停开波、孔明无敌、妖物刷在镜头内（不影响正式游玩）。headless Chrome 用 SwiftShader 软件渲染，帧率偏保守。
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const { srv } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8795);
const b = await Browser.launch({ port: 9395 });
await b.goto('http://127.0.0.1:8795/index.html?tapcanvasPlaytest=1&seed=20261117');
await b.until((s) => s.scene === 'title', 30000);
await sleep(800); await b.press('g');
await b.until((s) => s.scene === 'select', 30000); await sleep(500); await b.press('Enter');
await b.until((s) => s.scene === 'play', 30000);
await sleep(1500);
await b.eval(`(() => { const s = globalThis.__guardSim; s.wave.nextAt = Infinity; s.kongming.invuln = 1e9; s.hero.invuln = 1e9;
  const st = s.step.bind(s); s.__ms = 0; s.__n = 0; s.step = () => { const t = performance.now(); st(); s.__ms += performance.now() - t; s.__n++; }; return 1; })()`);
const rows = [];
const types = ['paperman', 'foxfire', 'lantern', 'jiangshi', 'guiche', 'yeya'];
for (const nb of [0, 10, 20]) {
  for (const ne of [0, 50, 100, 200, 260]) {
    await b.eval(`(() => { const s = globalThis.__guardSim;
      for (const e of s.enemies) e.alive = false; s.compact();
      const want = ${nb}; let have = s.buildings.filter((x) => x.alive).length;
      const types = ['arrow', 'fu', 'lei', 'lamp', 'wall'];
      for (const f of s.foundations) { if (have >= want) break; if (f.bid) continue; s.copper = 1e6; const k = types[have % 5];
        s.ctrl.x = f.x; s.ctrl.y = f.y + 60; const r = s.command({ type: 'build', fid: f.id, bld: k }); if (r.ok) have++; }
      s.ctrl.x = s.kongming.x; s.ctrl.y = s.kongming.y + 150;
      const T = ${JSON.stringify(types)};
      for (let i = 0; i < ${ne}; i++) { const a = (i / ${ne || 1}) * 6.283 * 3; const d = 260 + (i % 7) * 40;
        s.spawnEnemy(T[i % T.length], s.kongming.x + Math.cos(a) * d * 1.6, s.kongming.y + Math.sin(a) * d * 0.8, { hpMul: 1e3 }); }
      return 1; })()`);
    await sleep(1200);
    const r = await b.eval(`new Promise((ok) => { const s = globalThis.__guardSim; const g = Phaser.GAMES ? null : null;
      s.__ms = 0; s.__n = 0; const t0 = performance.now(); const st0 = s.t; let f = 0;
      const loop = () => { f++; if (performance.now() - t0 < 4000) requestAnimationFrame(loop); else {
        const wall = (performance.now() - t0) / 1000;
        ok({ fps: Math.round(f / wall * 10) / 10, clock: Math.round((s.t - st0) / wall * 100) / 100, tickMs: Math.round(s.__ms / Math.max(1, s.__n) * 100) / 100,
             enemies: s.enemies.filter((e) => e.alive).length, buildings: s.buildings.filter((x) => x.alive).length }); } };
      requestAnimationFrame(loop); })`);
    rows.push({ targetEnemies: ne, targetBuildings: nb, ...r });
    console.log(JSON.stringify(rows[rows.length - 1]));
    if (ne === 200 && nb === 20) await b.shot(`${OUT}perf-200x20.png`);
  }
}
const env = { cpu: cpus()[0].model, cores: cpus().length, load: loadavg().map((x) => Math.round(x * 10) / 10), renderer: await b.eval("(() => { const c = document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })()") };
writeFileSync(`${OUT}perf${process.env.CDP_GPU === '1' ? '-gpu' : ''}.json`, JSON.stringify({ env, rows }, null, 1));
console.log(JSON.stringify(env), 'errors', b.errors.length);
await b.close(); srv.close();
