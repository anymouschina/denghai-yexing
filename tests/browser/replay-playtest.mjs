// 按宿主同样的方式回放 playtest-script.json：1280×800 视口、真实键鼠、until 超时即失败、固定种子
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const steps = JSON.parse(readFileSync(fileURLToPath(new URL('./playtest-script.json', import.meta.url)), 'utf8'));
const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8797);
const b = await Browser.launch({ port: 9397, width: 1280, height: 800 });
await b.goto('http://127.0.0.1:8797/index.html?tapcanvasPlaytest=1&seed=20261117');
let n = 0; let ok = true; const t0 = Date.now();
for (const [i, st] of steps.entries()) {
  try {
    if (st.until) { const want = st.until; await b.until((s) => Object.entries(want).every(([k, v]) => s[k] === v), st.timeoutMs || 5000, JSON.stringify(want)); }
    else if (st.key) await b.press(st.key, st.holdMs || 60);
    else if (st.click) await b.click(st.click[0], st.click[1]);
    else if (st.waitMs) await sleep(st.waitMs);
    else if (st.shot) { n++; await b.shot(`${OUT}replay-${String(n).padStart(2, '0')}.png`); const s = await b.snap(); console.log('shot', n, st.shot, JSON.stringify({ scene: s.scene, wave: s.wave, kmHp: s.kmHp, kills: s.kills, enemies: s.enemies, lv: s.lv, bag: s.bag, kmEquip: s.kmEquip, buildings: s.buildings, quests: s.quests, y: s.y })); }
  } catch (e) { ok = false; console.log('FAIL step', i + 1, e.message.slice(0, 300)); break; }
}
console.log(ok ? 'REPLAY OK' : 'REPLAY FAIL', 'secs', Math.round((Date.now() - t0) / 1000), 'errors', JSON.stringify(b.errors.slice(0, 3)), 'missing', JSON.stringify(missing));
await b.close(); srv.close();
