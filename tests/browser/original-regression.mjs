// 原模式回归：标题 → 开始 → 移动 → 升级三选一 → 暂停/继续 → 死亡结算 → 再来一局；并检查原存档键不被新模式写入
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8766);
const b = await Browser.launch({ port: 9335 });
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, info); };
try {
  await b.goto('http://127.0.0.1:8766/index.html?tapcanvasPlaytest=1&seed=20261117');
  await b.until((s) => s.scene === 'title', 20000, 'title');
  await b.eval("localStorage.setItem('denghai_yexing_save_v1', JSON.stringify({soul: 123, best: 77, wins: 1, runs: 5, meta: {hp: 1}, mute: false})); localStorage.removeItem('denghai_guard_save_v1'); 1");
  await b.goto('http://127.0.0.1:8766/index.html?tapcanvasPlaytest=1&seed=20261117');
  await b.until((s) => s.scene === 'title', 20000, 'title');
  await sleep(900);
  await b.shot(`${OUT}orig-01-title.png`);
  ok('标题页', true);
  await b.press('Enter');
  const g = await b.until((s) => s.scene === 'game', 15000, 'game');
  ok('进入原模式对局', g.level === 1, JSON.stringify({ hp: g.hp, level: g.level }));
  for (const k of ['d', 'w', 'a', 's']) await b.press(k, 900);
  const lv = await b.untilProgress((s) => s.scene === 'levelup', { label: 'levelup' });
  await b.shot(`${OUT}orig-02-levelup.png`);
  ok('升级三选一出现', true, `t=${lv.t}`);
  await b.press('1');
  const after = await b.until((s) => s.scene === 'game', 5000, 'pick');
  ok('选卡后回到对局且等级提升', after.level >= 2, `level=${after.level}`);
  await b.press('Escape');
  await b.until((s) => s.scene === 'pause', 5000, 'pause');
  ok('Esc 暂停', true);
  // 原版 v3 已有的现象：暂停面板打开后 <100ms 内再按 Esc 偶尔被吞（基线 be27a98 同样复现），按人手节奏间隔 300ms
  await sleep(300);
  await b.press('Escape');
  await b.until((s) => s.scene === 'game', 5000, 'resume');
  ok('Esc 继续', true);
  await b.eval('__TAPCANVAS_PLAYTEST__.setHp(1)');
  const r = await b.untilProgress((s) => s.scene === 'result' || s.scene === 'levelup', { label: 'result' });
  if (r.scene === 'levelup') { await b.press('1'); await b.untilProgress((s) => s.scene === 'result', { label: 'result2' }); }
  await sleep(1500);
  await b.shot(`${OUT}orig-03-result.png`);
  ok('死亡结算', true);
  const save = JSON.parse(await b.eval("localStorage.getItem('denghai_yexing_save_v1')"));
  ok('原存档保留并累加', save.runs === 6 && save.meta.hp === 1 && save.best >= 77, JSON.stringify(save));
  const gsave = await b.eval("localStorage.getItem('denghai_guard_save_v1')");
  ok('原模式不写新模式存档', gsave === null);
  await b.press('Enter');
  const re = await b.until((s) => s.scene === 'game' && s.level === 1, 15000, 'restart');
  ok('再来一局', re.kills === 0 || re.t < 5, `t=${re.t}`);
} catch (e) { ok('流程', false, e.message); }
ok('控制台零报错', b.errors.length === 0, JSON.stringify(b.errors.slice(0, 5)));
ok('无 404', missing.length === 0, JSON.stringify(missing));
await b.close(); srv.close();
process.exitCode = results.every((r) => r.pass) ? 0 : 1;
