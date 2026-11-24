import { Sim } from '../../src/guard/sim/Sim.js';
import { PlayerBot } from '../../tests/guard/bot/player.mjs';
const s = new Sim({ seed: 7, heroId: 'huoqing', mode: 'story', fx: false });
const b = new PlayerBot(s, { kind: 'proxy', sigma: 0.05, seed: 9 });
const target = Number(process.argv[2] || 8);
const t0 = Date.now();
while (!s.over && s.wave.n < target && s.t < 3000) { b.step(); s.step(); }
console.log('wave', s.wave.n, 't', Math.round(s.t), 'ms', Date.now() - t0, 'over', s.over && s.over.reason, 'enemies', s.enemies.length);
const skip = new Set(['rng','listeners','handlers','statSources','beforeDeath','systems','grid','map','fx']);
const seen = new Map(); const fns = {}; const sets = {}; const protos = {};
const keysTop = Object.keys(s);
console.log('top keys', keysTop.join(','));
function walk(o, path, depth) {
  if (o === null || typeof o !== 'object') return;
  if (seen.has(o)) return; seen.set(o, path);
  const pr = Object.getPrototypeOf(o);
  if (o instanceof Set) { sets[path] = o.size; return; }
  if (o instanceof Map) { sets[path] = 'Map'; return; }
  if (pr !== Object.prototype && pr !== Array.prototype && pr !== null) protos[path] = pr.constructor.name;
  for (const k of Object.keys(o)) {
    const v = o[k]; const p = path + '.' + (Array.isArray(o) ? '[]' : k);
    if (typeof v === 'function') { fns[p] = (fns[p] || 0) + 1; continue; }
    walk(v, p, depth + 1);
  }
}
for (const k of keysTop) if (!skip.has(k)) walk(s[k], k, 0);
console.log('FUNCS', fns); console.log('SETS', sets); console.log('PROTOS', protos);
console.log('objects', seen.size);
const sizes = {}; for (const k of keysTop) if (!skip.has(k)) sizes[k] = JSON.stringify(s[k], (kk, v) => typeof v === 'function' || v instanceof Set ? undefined : v, 0)?.length; console.log(sizes);
