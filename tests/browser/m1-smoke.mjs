// M1 冒烟：标题 → 新模式入口 → 选英雄 → 对局（移动/普攻/技能键）→ 暂停 → 继续；记录报错与 404
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8765);
const b = await Browser.launch({ port: 9334 });
try {
  await b.goto('http://127.0.0.1:8765/index.html?tapcanvasPlaytest=1&seed=20261117');
  await b.until((s) => s.scene === 'title', 20000, 'title');
  await b.shot(`${OUT}m1-01-title.png`);
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'select');
  await sleep(800);
  await b.press('ArrowRight');
  await sleep(300);
  await b.shot(`${OUT}m1-02-select.png`);
  await b.press('Enter');
  const s0 = await b.until((s) => s.scene === 'play', 20000, 'play');
  console.log('start', JSON.stringify(s0));
  await b.keyDown('w'); await b.keyDown('j'); await sleep(1500); await b.keyUp('w');
  await sleep(6000);
  await b.keyUp('j');
  await b.press('q'); await sleep(200); await b.press('e');
  await sleep(4000);
  await b.shot(`${OUT}m1-03-play.png`);
  await b.press('Escape');
  await b.until((s) => s.scene === 'paused', 5000, 'paused');
  await b.shot(`${OUT}m1-04-pause.png`);
  await b.press('Escape');
  const s1 = await b.until((s) => s.scene === 'play', 5000, 'resume');
  console.log('after', JSON.stringify(s1));
} catch (e) { console.log('FAIL', e.message); }
console.log('errors', JSON.stringify(b.errors.slice(0, 10)));
console.log('missing', JSON.stringify(missing));
await b.close(); srv.close();
