// 浏览器实测：WC3 点击地面移动 + 全套改造面板（军令/建造/雇佣/背包）无溢出截图验收
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8766);
const b = await Browser.launch({ port: 9335 });
const rel = (x, y) => [x / 1280, y / 720];

try {
  await b.goto('http://127.0.0.1:8766/index.html?tapcanvasPlaytest=1&seed=20261122');
  await b.until((s) => s.scene === 'title', 20000, 'title');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'select');
  await sleep(500);
  await b.press('Enter');
  const s0 = await b.until((s) => s.scene === 'play', 20000, 'play');
  await sleep(300);

  // 1. 实测 WC3 点击地面移动（不按 WASD，纯鼠标点击右上方空地）
  const x0 = s0.x; const y0 = s0.y;
  await b.click(...rel(840, 260));
  await sleep(900);
  const s1 = await b.snap();
  const moved = Math.hypot(s1.x - x0, s1.y - y0);
  console.log('wc3_click_move', JSON.stringify({ from: [x0, y0], to: [s1.x, s1.y], moved: Math.round(moved) }));
  if (moved < 50) throw new Error(`点击地面移动未生效，仅移动 ${moved}px`);
  await b.shot(`${OUT}v31-01-play-wc3.png`);

  // 2. 军令面板（T）
  await b.press('t');
  await b.until((s) => s.scene === 'panel_quests', 5000, 'quests');
  await sleep(350);
  await b.shot(`${OUT}v31-02-quests.png`);
  await b.press('Escape');
  await sleep(250);

  // 3. 建造面板（G）
  await b.press('g');
  await b.until((s) => s.scene === 'panel_build', 5000, 'build');
  await sleep(350);
  await b.shot(`${OUT}v31-03-build.png`);
  await b.press('Escape');
  await sleep(250);

  // 4. 雇佣面板（H）
  await b.press('h');
  await b.until((s) => s.scene === 'panel_hire', 5000, 'hire');
  await sleep(350);
  await b.shot(`${OUT}v31-04-hire.png`);
  await b.press('Escape');
  await sleep(250);

  // 5. 背包面板（B）
  await b.press('b');
  await b.until((s) => s.scene === 'panel_bag', 5000, 'bag');
  await sleep(350);
  await b.shot(`${OUT}v31-05-bag.png`);
  await b.press('Escape');
  await sleep(200);

  console.log('ALL_OK');
} catch (e) {
  console.log('FAIL', e.message);
  process.exitCode = 1;
}
console.log('errors', JSON.stringify(b.errors.slice(0, 10)));
console.log('missing', JSON.stringify(missing));
await b.close();
srv.close();
