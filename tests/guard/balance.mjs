// 平衡跑批（不作弊：不用伤害倍率、不改生命、不在战斗间回血；机器人只走 input/command）。
// 用法：node tests/guard/balance.mjs [--n 40] [--bots proxy,random,perfect] [--heroes azhu,huoqing,yunque,xuanshuang] [--duel] [--out tests/guard/out/balance.json]
// 多进程并行（worker_threads），一次跑完再汇总。
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HEROES = ['azhu', 'huoqing', 'yunque', 'xuanshuang'];

if (!isMainThread) {
  const { Sim } = await import('../../src/guard/sim/Sim.js');
  // --set 候选参数（只用于比较候选值，选定后写回 data/*.json；不是作弊倍率）：file.path=value,…
  if (workerData.set) {
    const files = { balance: (await import('../../src/guard/data/balance.json', { with: { type: 'json' } })).default, enemies: (await import('../../src/guard/data/enemies.json', { with: { type: 'json' } })).default, bosses: (await import('../../src/guard/data/bosses.json', { with: { type: 'json' } })).default };
    for (const kv of workerData.set.split(',')) {
      const [path, v] = kv.split('=');
      const keys = path.split('.');
      let o = files[keys.shift()];
      while (keys.length > 1) o = o[keys.shift()];
      o[keys[0]] = Number(v);
    }
  }
  const { runGame } = await import('./bot/player.mjs');
  const { runDuel } = await import('./bot/duel.mjs');
  for (const job of workerData.jobs) {
    const r = job.duel ? runDuel(Sim, job) : runGame(Sim, job);
    delete r.events;
    parentPort.postMessage(r);
  }
  process.exit(0);
}

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', 20));
const bots = opt('bots', 'proxy,random,perfect').split(',');
const heroes = opt('heroes', HEROES.join(',')).split(',');
const duel = args.includes('--duel');
const sigma = Number(opt('sigma', 0.05));
const out = opt('out', 'tests/guard/out/balance.json');
const jobs = [];
for (const bot of bots) for (const heroId of heroes) for (let i = 0; i < N; i++) {
  jobs.push({ bot, heroId, seed: 1000 + i * 7919, sigma, duel, growth: args.includes('--growth'), mode: 'story', ...(duel ? { phase: opt('phase', 'init'), bossWave: Number(opt('boss', 10)) } : {}) });
}
const W = Math.min(availableParallelism(), 10, jobs.length);
const per = Array.from({ length: W }, () => []);
jobs.forEach((j, i) => per[i % W].push(j));
const t0 = Date.now();
const results = [];
await Promise.all(per.map((js) => new Promise((ok, no) => {
  const w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: js, set: opt('set', '') } });
  w.on('message', (r) => results.push(r));
  w.on('error', no);
  w.on('exit', ok);
})));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[(s.length / 2) | 0] : 0; };
const summary = {};
for (const bot of bots) {
  summary[bot] = {};
  for (const h of [...heroes, 'ALL']) {
    const rs = results.filter((r) => r.bot === bot && (h === 'ALL' || r.heroId === h));
    if (!rs.length) continue;
    const row = { n: rs.length, winPct: pct(rs.filter((r) => r.win).length, rs.length), medWave: med(rs.map((r) => r.wave)), meanWave: Math.round(rs.reduce((a, r) => a + r.wave, 0) / rs.length * 10) / 10 };
    if (duel) { row.medSec = med(rs.filter((r) => r.win).map((r) => r.t)); row.medBossHpLeft = med(rs.map((r) => r.bossHpLeft ?? 100)); row.medLv = med(rs.map((r) => r.lv)); row.reasons = rs.reduce((a, r) => { a[r.reason] = (a[r.reason] || 0) + 1; return a; }, {}); }
    else {
      row.medLv = med(rs.map((r) => r.lv));
      row.beasts = Math.round(rs.reduce((a, r) => a + r.beasts.length, 0) / rs.length * 10) / 10;
      row.quests = Math.round(rs.reduce((a, r) => a + r.quests, 0) / rs.length * 10) / 10;
      row.kmEquipPct = pct(rs.filter((r) => r.kmEquip > 0).length, rs.length);
      row.setPct = pct(rs.filter((r) => r.sets && r.sets.length).length, rs.length);
      const causes = {};
      for (const r of rs) if (!r.win) { const k = r.reason.replace(/第 \d+ 波 · /, ''); causes[k] = (causes[k] || 0) + 1; }
      row.deathCauses = Object.fromEntries(Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 5));
      const waveHist = {};
      for (const r of rs) if (!r.win) { const b = `${Math.floor((r.wave - 1) / 5) * 5 + 1}-${Math.floor((r.wave - 1) / 5) * 5 + 5}`; waveHist[b] = (waveHist[b] || 0) + 1; }
      row.loseWaves = waveHist;
      const bf = rs.flatMap((r) => r.bossFights);
      row.bossSec = Object.fromEntries(['灯骸老祖', '旱魃', '夜帝·无光'].map((n) => [n, med(bf.filter((b) => b.name.includes(n.slice(0, 2))).map((b) => b.sec))]));
    }
    summary[bot][h] = row;
  }
}
// 伤害来源（代理机器人，全部英雄合并）
const dmg = {};
for (const r of results.filter((x) => x.bot === 'proxy')) for (const [k, v] of Object.entries(r.dmgBy || {})) dmg[k] = (dmg[k] || 0) + v;
const tot = Object.values(dmg).reduce((a, b) => a + b, 0) || 1;
const dmgShare = Object.fromEntries(Object.entries(dmg).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, `${pct(v, tot)}%`]));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), N, sigma, duel, set: opt('set', ''), secs: Math.round((Date.now() - t0) / 1000), summary, dmgShare, results }, null, 1));
console.log(JSON.stringify({ secs: Math.round((Date.now() - t0) / 1000), summary, dmgShare }, null, 1));
