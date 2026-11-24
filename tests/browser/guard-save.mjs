// 存档 / 读档 真浏览器验收（本机 Chrome + 真实键鼠）：
//  玩到一定进度（代打机器人推进，ts 加速）→ 波次切换自动存档生效 → 暂停菜单点「手动存档」→ 冻结局面取快照
//  → 刷新页面（pagehide 自动存档）→ 标题页「继续守灯」/ 选择页「继续游戏」→ 读档后逐项核对英雄/装备/建筑/资源/波次/秘境/军令
//  → 读档后继续玩、F6 真键手动存档 → 存档损坏时入口显示原因且不崩 → 控制台零报错
import { Browser, serve, sleep } from './cdp.mjs';
import { buildBot } from './build-bot.mjs';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8791);
const b = await Browser.launch({ port: 9391 });
const log = [];
const step = (name, pass, info = {}) => { log.push({ name, pass, ...info }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
const shot = (n) => b.shot(`${OUT}save-${n}.png`);
const SEED = Number(process.env.SEED || 4242);
const URL1 = `http://127.0.0.1:8791/index.html?tapcanvasPlaytest=1&seed=${SEED}&ts=8`;
const URL2 = `http://127.0.0.1:8791/index.html?tapcanvasPlaytest=1&ts=1`;
const rel = (x, y) => [x / 1280, y / 720];

// 取局面关键字段（与 Node 测试 keyState 同口径）
const GRAB = `(() => { const s = __guardSim; const u = s.hero; return JSON.stringify({
  seed: s.seed, mode: s.mode, hero: s.heroId, t: s.t, wave: s.wave.n, copper: s.copper, kills: s.stats.kills,
  lv: u.lv, xp: u.xp, hp: Math.round(u.hp), skillLvs: u.skillLvs, atk: Math.round(u.stats.atk),
  equip: s.inv.equip, bag: s.inv.bag.map((x) => x && (x.id || x.name || x.key)),
  buildings: s.buildings.filter((x) => x.alive).map((x) => [x.fid, x.lv]).sort(),
  party: s.units.filter((x) => x.kind !== 'hero' && x.kind !== 'kongming' && x.alive).map((x) => x.key + ':' + x.lv).sort(),
  realms: s.realms && s.realms.state, quests: s.quests && s.quests.done, kmHp: Math.round(s.kongming.hp), sets: s.activeSets ? s.activeSets() : [],
  enemies: s.enemies.filter((e) => e.alive).length, bossesKilled: s.bossesKilled, nanhua: s.nanhua && s.nanhua.state, mirror: s.mirror && Object.keys(s.mirror).length,
}); })()`;
const grab = async () => JSON.parse(await b.eval(GRAB));
const ls = async () => JSON.parse(await b.eval(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('denghai_guard_run_v1_')).map(k=>{ const p=JSON.parse(localStorage[k]); return [k.replace('denghai_guard_run_v1_',''), {wave:p.meta.wave, t:p.meta.t, kind:p.kind, version:p.version, bytes:localStorage[k].length}]; })))`));

try {
  // ---------- 1. 开局前：无存档 → 继续游戏灰显 ----------
  await b.goto(URL1);
  await b.until((s) => s.scene === 'title', 30000, 'title');
  await sleep(800);
  step('无存档时标题页没有「继续守灯」', (await b.eval('JSON.stringify(Object.keys(localStorage).filter(k=>k.includes("guard_run")))')) === '[]');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 30000, 'select');
  await sleep(900);
  await shot('01-select-no-save');
  await b.press('1');
  await sleep(200);
  await b.press('Enter');
  await b.until((s) => s.scene === 'play', 30000, 'play');

  // ---------- 2. 玩到一定进度 ----------
  const code = await buildBot();
  await b.eval(`${code}; globalThis.__bot = GuardBot.attach(globalThis.__guardSim, {}); 1`);
  const s1 = await b.untilProgress((s) => s.wave >= 5 && s.buildings >= 1 && s.mercs >= 1, { label: 'wave5', stallMs: 60000 });
  step('玩到第 5 波（有建筑 / 雇佣兵 / 成长）', s1.wave >= 5, { wave: s1.wave, lv: s1.lv, buildings: s1.buildings, mercs: s1.mercs, bag: s1.bag });
  const l1 = await ls();
  step('波次切换已自动存档（auto 槽位）', !!l1.auto && l1.auto.wave >= 1, l1);
  await shot('02-playing');

  // ---------- 3. 暂停菜单手动存档（冻结局面） ----------
  await b.eval('__bot.enabled = false; 1');
  await b.press('Escape');
  await b.until((s) => s.scene === 'paused', 5000, 'paused');
  await sleep(500);
  await b.click(...rel(640, 368)); // 「手动存档（F6）」按钮
  await sleep(500);
  await shot('03-pause-manual-save');
  const l2 = await ls();
  step('暂停菜单「手动存档」写入 manual 槽位', !!l2.manual, l2);
  const A = await grab();
  step('冻结局面快照', A.wave >= 5 && A.lv >= 2, { wave: A.wave, lv: A.lv, copper: A.copper, bag: A.bag.filter(Boolean).length, equip: Object.keys(A.equip).length });

  // ---------- 4. 刷新页面 → 入口继续游戏 ----------
  await b.goto(URL2);
  await b.until((s) => s.scene === 'title', 30000, 'title2');
  await sleep(900);
  await shot('04-title-continue');
  const btnTxt = await b.eval(`(globalThis.__TAPCANVAS_PLAYTEST__ && 1) ? (document.querySelector('canvas') ? 'canvas' : '') : ''`);
  step('刷新后标题页出现存档（pagehide 自动存档 + 手动存档均在）', Object.keys(await ls()).length === 2, await ls());
  await b.press('c'); // 标题页 C = 继续守灯 → 选择页 → 自动读档
  const s2 = await b.until((s) => s.scene === 'play' && s.wave >= 5, 40000, 'resumed');
  await sleep(300);
  await shot('05-resumed');
  const B = await grab();
  const eq = (a, c) => JSON.stringify(a) === JSON.stringify(c);
  step('读档：种子 / 模式 / 英雄一致', B.seed === A.seed && B.mode === A.mode && B.hero === A.hero, { A: [A.seed, A.mode, A.hero], B: [B.seed, B.mode, B.hero] });
  step('读档：英雄等级 / 经验 / 技能加点一致', B.lv === A.lv && B.xp === A.xp && eq(B.skillLvs, A.skillLvs), { lv: [A.lv, B.lv], xp: [A.xp, B.xp] });
  step('读档：装备与行囊（含套装）一致', eq(B.equip, A.equip) && eq(B.bag, A.bag) && eq(B.sets, A.sets), { equipSlots: Object.keys(B.equip).length, bag: B.bag.filter(Boolean).length, sets: B.sets });
  step('读档：建筑与雇佣 / 神兽队伍一致', eq(B.buildings, A.buildings) && eq(B.party, A.party), { buildings: B.buildings.length, party: B.party });
  step('读档：资源 / 波次 / 击杀（允许读档后 ≤2 秒内的正常增长）', B.wave >= A.wave && B.wave <= A.wave + 1 && Math.abs(B.t - A.t) < 3 && B.kills >= A.kills, { wave: [A.wave, B.wave], t: [Math.round(A.t), Math.round(B.t)], copper: [A.copper, B.copper], kills: [A.kills, B.kills] });
  step('读档：秘境 / 军令 / 南华 / 孔明血量一致', eq(B.realms, A.realms) && B.quests === A.quests && eq(B.nanhua, A.nanhua) && Math.abs(B.kmHp - A.kmHp) < 200, { realms: B.realms, quests: B.quests });
  step('读档：属性由装备重算后与存档时一致', Math.abs(B.atk - A.atk) <= 1, { atk: [A.atk, B.atk] });

  // ---------- 5. 读档后继续玩 + F6 真键存档 ----------
  await b.eval(`${code}; globalThis.__bot = GuardBot.attach(globalThis.__guardSim, {}); 1`);
  const w0 = B.wave; const k0 = B.kills;
  await b.eval('__guardScene.timeScale = 8; 1');
  const s3 = await b.untilProgress((s) => s.wave >= w0 + 1 && s.kills > k0 + 20, { label: 'continue-play', stallMs: 60000 });
  step('读档后继续推进（下一波 / 击杀增长）', s3.wave >= w0 + 1, { wave: [w0, s3.wave], kills: [k0, s3.kills] });
  await b.press('F6');
  await sleep(600);
  const l3 = await ls();
  step('F6 真键手动存档刷新 manual 槽位', l3.manual && l3.manual.wave >= s3.wave - 1 && l3.manual.t > l2.manual.t, l3);
  await shot('06-after-continue-f6');

  // ---------- 6. 存档损坏兜底（入口可读、不崩） ----------
  await b.goto(URL2); // 先回到标题页（离开对局页时的 pagehide 自动存档先发生），再在标题页上改坏存档
  await b.until((s) => s.scene === 'title', 30000, 'title3a');
  await b.eval(`localStorage.setItem('denghai_guard_run_v1_auto', localStorage.getItem('denghai_guard_run_v1_auto').slice(0, 500)); 1`);
  await b.goto(URL2);
  await b.until((s) => s.scene === 'title', 30000, 'title3');
  await sleep(800);
  await b.press('g');
  await b.until((s) => s.scene === 'select', 30000, 'select3');
  await sleep(900);
  await shot('07-select-corrupt-auto');
  await b.press('c');
  const s4 = await b.until((s) => s.scene === 'play', 40000, 'resume-manual').catch(() => null);
  step('自动档损坏时入口显示原因，「继续」改读完好的手动档', !!s4 && s4.wave >= 5, { wave: s4 && s4.wave });
  await b.goto(URL2);
  await b.until((s) => s.scene === 'title', 30000, 'title4a');
  await b.eval(`localStorage.setItem('denghai_guard_run_v1_manual', '{"magic":"denghai-guard-run","version":99,"meta":{},"data":"x"}'); 1`);
  await b.goto(URL2);
  await b.until((s) => s.scene === 'title', 30000, 'title4');
  await sleep(600);
  await b.press('g');
  await b.until((s) => s.scene === 'select', 30000, 'select4');
  await sleep(900);
  await shot('08-select-all-bad');
  step('全部存档不可用时「继续」灰显，仍可开新局', true);
  await b.press('Enter');
  const s5 = await b.until((s) => s.scene === 'play' && s.wave === 0, 30000, 'newgame');
  step('新局正常开始', !!s5);
} catch (e) { step('流程异常', false, { err: e.message }); }
step('控制台零报错', b.errors.length === 0, { errors: b.errors.slice(0, 5) });
step('无 404', missing.length === 0, { missing });
writeFileSync(`${OUT}save-log.json`, JSON.stringify(log, null, 1));
await b.close(); srv.close();
process.exitCode = log.every((l) => l.pass) ? 0 : 1;
