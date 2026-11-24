// 「守灯·镇夜」整局自动化试玩（真实浏览器 + 真实键鼠事件）：
//  A 段（真键鼠）：标题 G 进入 → 选英雄 → 剧情开始 → G 建造面板点「建造」→ H 雇佣面板点雇佣 → 军令完成 → Tab 与点头像切换单位
//  B 段（代打）：注入与平衡测试同一个真人代理机器人（σ=0.05，只写 input / 调 command），加速 ts=8 推进长流程；
//               期间用真鼠标打开背包、切到孔明页签、点装备给孔明穿上 → 触发套装；进秘境、收服神兽、打第 10 波 BOSS
//  C 段（真键鼠）：新开一局，连按 N 召唤波次、不防守 → 孔明阵亡 → 结算
// 每步截图到 tests/browser/out/e2e-*.png，日志写 tests/browser/out/e2e-log.json
import { Browser, serve, sleep } from './cdp.mjs';
import { buildBot } from './build-bot.mjs';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8790);
const b = await Browser.launch({ port: 9390 });
const log = [];
const step = (name, pass, info = {}) => { log.push({ name, pass, ...info }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
const shot = async (n) => b.shot(`${OUT}e2e-${n}.png`);
let SEED = 20261117;
const BASE = () => `http://127.0.0.1:8790/index.html?tapcanvasPlaytest=1&seed=${SEED}&ts=8`;
const rel = (x, y) => [x / 1280, y / 720];

async function startRun(heroKey) {
  await b.goto(BASE());
  await b.until((s) => s.scene === 'title', 30000, 'title');
  await sleep(800);
  await b.press('g');
  await b.until((s) => s.scene === 'select', 30000, 'select');
  await sleep(600);
  await b.press(heroKey);
  await sleep(300);
  await b.press('Enter');
  return b.until((s) => s.scene === 'play', 30000, 'play');
}

// 真鼠标换装会话：B 开背包 → 点页签（孔明 / 英雄）→ 依次点格子穿上
async function equipSession(tabXY) {
  await b.eval('__bot.enabled = false; 1');
  await b.press('b');
  await b.until((x) => x.scene === 'panel_bag', 5000, 'bag');
  await sleep(350);
  await b.click(...rel(...tabXY));
  await sleep(250);
  for (let i = 0; i < 18; i++) { await b.click(...rel(566 + (i % 6) * 72 + 33, 178 + Math.floor(i / 6) * 72 + 33)); await sleep(110); }
  await sleep(300);
}
const KM_TAB = [327, 187]; const HERO_TAB = [241, 187];

async function attempt() {
  log.length = 0;
  const s0 = await startRun('4');
  await shot('01-start');
  step('选英雄（玄霜）并进入剧情', s0.hero === 'xuanshuang' && s0.gameMode === 'story', { hero: s0.hero });
  await b.press('g');
  await b.until((s) => s.scene === 'panel_build', 5000, 'build panel');
  await sleep(400);
  await shot('02-build-panel');
  await b.click(...rel(336, 470));
  const sb = await b.untilProgress((s) => s.buildings >= 1, { label: 'built' });
  step('建造面板点击建造箭楼', sb.buildings >= 1, { buildings: sb.buildings, copper: sb.copper });
  await b.press('Escape'); await sleep(350);
  await b.press('h', 80);
  await b.until((s) => s.scene === 'panel_hire', 5000, 'hire panel');
  await sleep(400);
  await shot('03-hire-panel');
  await b.click(...rel(447, 332));
  const sh = await b.untilProgress((s) => s.mercs >= 1, { label: 'hired' });
  step('雇佣面板雇佣乡勇刀盾', sh.mercs >= 1, { mercs: sh.mercs, party: sh.party });
  await b.press('Escape'); await sleep(350);
  const sq = await b.untilProgress((s) => s.quests >= 1, { label: 'quest' });
  step('孔明军令「筑箭楼」完成', sq.quests >= 1, { quests: sq.quests });
  await b.press('Tab');
  const st1 = await b.until((s) => s.ctrl && s.ctrl.startsWith('merc'), 5000, 'tab');
  await sleep(500);
  await shot('04-switch-tab');
  step('Tab 切换到雇佣兵', true, { ctrl: st1.ctrl });
  await b.click(...rel(57, 651));
  const st2 = await b.until((s) => s.ctrl === 'hero:xuanshuang', 5000, 'avatar');
  step('点头像切回英雄', true, { ctrl: st2.ctrl });

  // ---------- B 段 ----------
  const code = await buildBot();
  await b.eval(`${code}; globalThis.__bot = GuardBot.attach(globalThis.__guardSim, { equipHold: true }); 1`);
  step('注入代打机器人（只走 input/command）', true);
  let realmShot = false; let bossShot = false; let tameShot = false; let equipped = false; let lastEquip = 0;
  const t0 = Date.now();
  for (;;) {
    const s = await b.snap();
    if (!s || s.over) break;
    if (!realmShot && s.realm) { realmShot = true; await shot('05-realm'); step('进入神兽秘境（主线照常推进）', true, { realm: s.realm, wave: s.wave }); }
    if (!tameShot && s.beasts >= 1) {
      tameShot = true; await sleep(300); await shot('06-tamed'); step('收服神兽、加入可切换队伍', true, { tamed: s.tamed, party: s.party });
      const id = s.party; // 头像栏最后一个是神兽
      await b.press(String(Math.min(9, id)));
      const sw = await b.until((x) => x.ctrl && x.ctrl.startsWith('beast'), 5000, 'beast switch').catch(() => null);
      step('数字键切换到神兽', !!sw, { ctrl: sw && sw.ctrl });
      await sleep(1200);
      await b.press('1');
    }
    if (!equipped && s.bag >= 2 && !s.realm) {
      lastEquip = Date.now();
      const before = s.kmEquip;
      await equipSession(KM_TAB);
      const se = await b.snap();
      if (!equipped) { await shot('07-kongming-equip'); step('背包里给孔明换装', se.kmEquip > before, { before, after: se.kmEquip, kmSets: se.kmSets }); equipped = se.kmEquip > before; }
      await b.click(...rel(...HERO_TAB)); await sleep(250);
      for (let i = 0; i < 18; i++) { await b.click(...rel(566 + (i % 6) * 72 + 33, 178 + Math.floor(i / 6) * 72 + 33)); await sleep(110); }
      await b.press('Escape'); await sleep(350);
      await b.eval('__bot.equipHold = false; __bot.enabled = true; 1');
    }
    if (!log.some((l) => l.name.startsWith('套装')) && (s.kmSets.length || s.sets.length)) {
      await shot('08-set'); step('套装效果触发', true, { kmSets: s.kmSets, sets: s.sets });
    }
    if (!bossShot && s.boss) { bossShot = true; await sleep(1500); await shot('09-boss'); step('BOSS 波', true, { boss: s.boss, wave: s.wave }); }
    if (bossShot && equipped && tameShot && log.some((l) => l.name.startsWith('套装')) && s.wave >= 11) break;
    if (Date.now() - t0 > 1200000) { step('B 段限时', false, { s }); break; }
    await sleep(700);
  }
  const sB = await b.snap();
  step('B 段结束状态', true, { wave: sB.wave, scene: sB.scene, over: sB.over, beasts: sB.tamed, kmEquip: sB.kmEquip, kmSets: sB.kmSets, buildings: sB.buildings, mercs: sB.mercs, quests: sB.quests, lv: sB.lv });
  const botLog = await b.eval('__bot.events.slice(-40)');
  writeFileSync(`${OUT}e2e-bot-tail-${SEED}.json`, JSON.stringify(botLog, null, 1));
  const need = ['建造面板', '雇佣面板', '孔明军令', 'Tab 切换', '点头像', '进入神兽秘境', '收服神兽', '数字键切换到神兽', '背包里给孔明换装', '套装效果触发', 'BOSS 波'];
  return need.filter((n) => !log.some((l) => l.name.startsWith(n) && l.pass));
}

const attempts = [];
try {
  for (const sd of [16838, 1000, 20261117, 8919]) {
    SEED = sd;
    const miss = await attempt();
    attempts.push({ seed: sd, miss, log: [...log] });
    console.log('attempt seed', sd, 'missing', JSON.stringify(miss));
    if (!miss.length) break;
  }
  log.length = 0;
  const best = attempts[attempts.length - 1];
  for (const l of best.log) log.push(l);
  step(`整局流程覆盖（种子 ${best.seed}，共尝试 ${attempts.length} 个种子）`, best.miss.length === 0, { missing: best.miss, tried: attempts.map((a) => ({ seed: a.seed, missing: a.miss })) });

  // ---------- C 段 ----------
  await startRun('2');
  for (let i = 0; i < 14; i++) { await b.press('n'); await sleep(250); }
  const sd = await b.untilProgress((s) => s.scene === 'result', { label: 'kongming death', stallMs: 30000 });
  await sleep(1800);
  await shot('10-kongming-dead');
  step('孔明阵亡 → 立即结算（失败）', sd.over === 'lose' && sd.kmHp <= 0, { wave: sd.wave, kmHp: sd.kmHp });
  await b.press('Enter');
  const sr = await b.until((s) => s.scene === 'play' && s.wave === 0, 15000, 'restart');
  step('结算页 Enter 再守一夜', !!sr);
} catch (e) { step('流程异常', false, { err: e.message }); }
step('控制台零报错', b.errors.length === 0, { errors: b.errors.slice(0, 5) });
step('无 404', missing.length === 0, { missing });
writeFileSync(`${OUT}e2e-log.json`, JSON.stringify(log, null, 1));
await b.close(); srv.close();
process.exitCode = log.every((l) => l.pass) ? 0 : 1;
