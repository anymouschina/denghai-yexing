// 浏览器实测 v3.5：
// 1) 全部 13 张原生 4x4 16 帧多姿态精灵图（4 英雄 + 孔明 + 5 神兽 + 吕达/项羽/刑天）加载与渲染校验
// 2) 经典魔兽 0 级技能学习 + 30 级觉醒技能校验
// 3) 左上角强盗营寨（敌方箭塔 + 强盗头目·吕达原生精灵图）实景截图
// 4) 秘境总览面板 [M]（7 座可重刷秘境含项羽/刑天 + 镜像试炼）+ 霸王项羽实景截图
// 5) 藏经书店（买1本/连买5本永久属性）+ 杀敌成长神兵行囊对比截图
// 6) 专属 BOSS 房（三阶控制条）截图
// 7) 移动端（?touch=1）超大防误触 MOBA 按钮尺寸与全对边到边几何间距 ≥ 18px 自动化断言 + 移动端实景截图
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8769);
const b = await Browser.launch({ port: 9338 });

try {
  // === 1. 桌面端完整验收 ===
  await b.goto('http://127.0.0.1:8769/index.html?tapcanvasPlaytest=1&seed=20261122');
  await b.until((s) => s.scene === 'title', 35000, 'title');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'select');
  await sleep(350);
  await b.press('Enter');
  await b.until((s) => s.scene === 'play', 20000, 'play');
  await sleep(450);

  // 校验全部 13 张原生 4x4 精灵图已加载 + 开局 0 级技能未学
  const initCheck = JSON.parse(await b.eval(`(() => {
    const gg = globalThis.__guardScene;
    const sim = globalThis.__guardSim;
    const sheetKeys = [
      'sheet_azhu', 'sheet_hero_huoqing', 'sheet_hero_yunque', 'sheet_hero_xuanshuang', 'sheet_kongming',
      'sheet_beast_xuanwu', 'sheet_beast_zhuque', 'sheet_beast_baihu', 'sheet_beast_qinglong', 'sheet_beast_qilin',
      'sheet_boss_lvda', 'sheet_boss_xiangyu', 'sheet_boss_xingtian',
    ];
    const loadedSheets = sheetKeys.filter((k) => gg.textures.exists(k));
    const initSkills = { ...sim.hero.skillLvs };
    const initSp = sim.hero.skillPoints;
    const castLocked = sim.command({ type: 'castSkill', slot: 'q', autoAim: true }).ok;
    const learnQ = sim.command({ type: 'upgradeSkill', slot: 'q' });
    return JSON.stringify({ loadedSheets, initSkills, initSp, castLocked, learnQ });
  })()`));
  console.log('sheets_13_loaded', initCheck.loadedSheets.length, 'initSkills', JSON.stringify(initCheck.initSkills));
  if (initCheck.loadedSheets.length !== 13) throw new Error(`13 张原生精灵图未全加载: ${JSON.stringify(initCheck.loadedSheets)}`);
  if (initCheck.initSkills.q !== 0 || initCheck.initSkills.e !== 0 || initCheck.initSkills.u !== 0) {
    throw new Error(`开局技能应全为 0 级: ${JSON.stringify(initCheck.initSkills)}`);
  }
  if (initCheck.castLocked !== false) throw new Error('未学技能不应可施放');
  if (!initCheck.learnQ?.ok || initCheck.learnQ.lv !== 1) throw new Error('学习 Q 技能失败');

  // 移动到左上角强盗营寨检验吕达与 2 座敌方箭塔渲染
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.wave.nextAt = 1e9;
    sim.hero.x = 1440; sim.hero.y = 660;
    sim.hero.prevX = 1440; sim.hero.prevY = 660;
    sim.hero.invuln = 10;
  })()`);
  await sleep(450);
  const lvdaRender = JSON.parse(await b.eval(`(() => {
    const gg = globalThis.__guardScene;
    const sim = globalThis.__guardSim;
    const lvda = sim.bandits.getBoss();
    const sp = lvda ? gg.sprites.get(lvda.id) : null;
    const towers = sim.enemies.filter((e) => e.alive && e.enemyTower).length;
    return JSON.stringify({ tex: sp ? sp.texKey : null, towers });
  })()`));
  console.log('lvda_render', JSON.stringify(lvdaRender));
  if (lvdaRender.tex !== 'sheet_boss_lvda') throw new Error(`吕达未使用原生精灵图: ${lvdaRender.tex}`);
  if (lvdaRender.towers !== 2) throw new Error(`敌方箭塔数量异常: ${lvdaRender.towers}`);
  await b.shot(`${OUT}v35-01-bandit-lvda.png`);

  // 打开秘境总览面板 [Y] 检验项羽/刑天/可重刷秘境展示
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.wave.n = 12;
    sim.step();
  })()`);
  await b.press('y');
  await sleep(300);
  await b.shot(`${OUT}v35-02-realms-panel.png`);
  await b.press('Escape');
  await sleep(200);

  // 进入霸王秘境·项羽并刷出项羽 BOSS 检验原生精灵图 sheet_boss_xiangyu
  const xyCheck = JSON.parse(await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.command({ type: 'enterRealm', id: 'xiangyu' });
    for (let i = 0; i < 120 && !sim.realms.run.xiangyu?.boss; i++) {
      for (const e of sim.enemies) if (e.alive && e.realm === 'xiangyu' && !e.realmBoss) sim.kill(e, sim.hero);
      sim.advance(0.2);
    }
    const boss = sim.enemies.find((e) => e.alive && e.realmBoss === 'xiangyu');
    if (boss) {
      sim.hero.x = boss.x - 160; sim.hero.y = boss.y;
      sim.hero.prevX = sim.hero.x; sim.hero.prevY = sim.hero.y;
      sim.hero.invuln = 10;
    }
    return JSON.stringify({ bossId: boss ? boss.id : null });
  })()`));
  await sleep(400);
  const xyTex = await b.eval(`(() => {
    const gg = globalThis.__guardScene;
    const sp = gg.sprites.get(${xyCheck.bossId});
    return sp ? sp.texKey : null;
  })()`);
  console.log('xiangyu_tex', xyTex);
  if (xyTex !== 'sheet_boss_xiangyu') throw new Error(`项羽未使用原生精灵图: ${xyTex}`);
  await b.shot(`${OUT}v35-03-xiangyu-boss.png`);

  // 检验藏经书店 + 30 级觉醒 + 杀敌成长神兵
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.command({ type: 'exitRealm' });
    sim.copper = 3000;
    sim.gainXp(200000); // 触发 30 级觉醒
    sim.command({ type: 'buyBook', itemId: 'tome_atk', count: 5 });
    const blade = sim.loot.makeGrowth('soulblade');
    blade.kills = 24;
    sim.loot.give(blade);
    sim.command({ type: 'equip', bagIdx: sim.inv.equipBag.indexOf(blade), unitId: sim.hero.id });
    globalThis.__guardScene.hud.togglePanel('shop', { tab: 'books' });
  })()`);
  await sleep(300);
  await b.shot(`${OUT}v35-04-bookstore.png`);
  await b.press('Escape');
  await sleep(180);

  // 打开行囊查看成长神兵与永久书卷加成
  await b.press('b');
  await sleep(300);
  await b.shot(`${OUT}v35-05-bag-growth.png`);
  await b.press('Escape');
  await sleep(180);

  // 进入 BOSS 房截图 + 校验顶部 BOSS 血条不显示已离开的项羽且不与 BOSS 房控制栏重叠
  await b.eval(`__guardSim.command({ type: 'enterBossRoom', tier: 'high' })`);
  await sleep(400);
  const bossBarCheck = JSON.parse(await b.eval(`(() => {
    const hud = globalThis.__guardScene.hud;
    return JSON.stringify({ visible: hud.bossName.visible, text: hud.bossName.text, y: hud.bossName.y });
  })()`));
  console.log('bossroom_bar', JSON.stringify(bossBarCheck));
  if (!bossBarCheck.visible || bossBarCheck.text.includes('项羽')) {
    throw new Error(`BOSS 房顶部血条串区异常: ${JSON.stringify(bossBarCheck)}`);
  }
  if (bossBarCheck.y < 160) {
    throw new Error(`BOSS 房顶部血条与控制栏重叠: y=${bossBarCheck.y}`);
  }
  await b.shot(`${OUT}v35-06-bossroom.png`);

  // 验证战神秘境·刑天原生精灵图 sheet_boss_xingtian 实装渲染
  const xtCheck = JSON.parse(await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.command({ type: 'exitBossRoom' });
    sim.command({ type: 'enterRealm', id: 'xingtian' });
    for (let i = 0; i < 120 && !sim.realms.run.xingtian?.boss; i++) {
      for (const e of sim.enemies) if (e.alive && e.realm === 'xingtian' && !e.realmBoss) sim.kill(e, sim.hero);
      sim.advance(0.2);
    }
    const boss = sim.enemies.find((e) => e.alive && e.realmBoss === 'xingtian');
    return JSON.stringify({ bossId: boss ? boss.id : null });
  })()`));
  await sleep(300);
  const xtTex = await b.eval(`(() => {
    const gg = globalThis.__guardScene;
    const sp = gg.sprites.get(${xtCheck.bossId});
    return sp ? sp.texKey : null;
  })()`);
  console.log('xingtian_tex', xtTex);
  if (xtTex !== 'sheet_boss_xingtian') throw new Error(`刑天未使用原生精灵图: ${xtTex}`);

  // === 2. 移动端（?touch=1）验收 + 自动化防误触几何间距断言 ===
  await b.goto('http://127.0.0.1:8769/index.html?tapcanvasPlaytest=1&touch=1&seed=20261122');
  await b.until((s) => s.scene === 'title', 20000, 'touch-title');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'touch-select');
  await sleep(300);
  await b.press('Enter');
  await b.until((s) => s.scene === 'play', 20000, 'touch-play');
  await sleep(450);

  const geoCheck = JSON.parse(await b.eval(`(() => {
    const hud = globalThis.__guardScene.hud;
    const btns = hud.mobaButtons || [];
    const pairs = [];
    let minGap = Infinity;
    let minUtilGap = Infinity;
    const outOfBounds = [];
    for (const btn of btns) {
      if (btn.cx - btn.r < 4 || btn.cx + btn.r > 1276 || btn.cy - btn.r < 4 || btn.cy + btn.r > 716) {
        outOfBounds.push(btn);
      }
    }
    for (let i = 0; i < btns.length; i++) {
      for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i]; const b2 = btns[j];
        const gap = Math.hypot(a.cx - b2.cx, a.cy - b2.cy) - a.r - b2.r;
        pairs.push({ a: a.id, b: b2.id, gap: Math.round(gap * 10) / 10 });
        if (gap < minGap) minGap = gap;
        if ((a.kind === 'utility' || b2.kind === 'utility') && gap < minUtilGap) minUtilGap = gap;
      }
    }
    return JSON.stringify({ count: btns.length, btns, minGap: Math.round(minGap * 10) / 10, minUtilGap: Math.round(minUtilGap * 10) / 10, outOfBounds });
  })()`));
  console.log('mobile_moba_geometry', JSON.stringify({
    count: geoCheck.count,
    minGap: geoCheck.minGap,
    minUtilGap: geoCheck.minUtilGap,
    outOfBounds: geoCheck.outOfBounds.length,
    sizes: geoCheck.btns.map((x) => `${x.id}:${x.d}px`),
  }));
  if (geoCheck.count < 8) throw new Error(`移动端 MOBA 按钮数量不足: ${geoCheck.count}`);
  if (geoCheck.outOfBounds.length > 0) throw new Error(`存在越界按钮: ${JSON.stringify(geoCheck.outOfBounds)}`);
  if (geoCheck.minGap < 18) throw new Error(`移动端按钮边到边间距不足 18px: minGap=${geoCheck.minGap}px`);
  if (geoCheck.minUtilGap < 24) throw new Error(`召唤师技能距技能弧间距不足 24px: minUtilGap=${geoCheck.minUtilGap}px`);
  const atkBtn = geoCheck.btns.find((x) => x.id === 'atk');
  const ultBtn = geoCheck.btns.find((x) => x.id === 'u');
  if (!atkBtn || atkBtn.d < 114) throw new Error(`普攻键直径不足 114px: ${atkBtn?.d}`);
  if (!ultBtn || ultBtn.d < 88) throw new Error(`大招键直径不足 88px: ${ultBtn?.d}`);

  await b.shot(`${OUT}v35-07-mobile-play.png`);

  // 打开移动端功能抽屉截图（校验 讨伐吕达 / 猎人任务 / 藏经书店 / 秘境挑战 / BOSS房 / 镜像3w 均清晰可见）
  const mbox = JSON.parse(await b.eval('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
  const mpx = (x) => mbox.left + (x / 1280) * mbox.width;
  const mpy = (y) => mbox.top + (y / 720) * mbox.height;
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mpx(64), y: mpy(132), button: 'left', clickCount: 1 });
  await sleep(50);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mpx(64), y: mpy(132), button: 'left', clickCount: 1 });
  await sleep(250);
  await b.shot(`${OUT}v35-08-mobile-drawer.png`);

  if (b.errors.length > 0) throw new Error(`页面报错: ${JSON.stringify(b.errors)}`);
  if (missing.length > 0) throw new Error(`存在缺失资源: ${JSON.stringify(missing)}`);
  console.log('ALL_OK');
} catch (e) {
  console.log('FAIL', e.message);
  process.exitCode = 1;
}
console.log('errors', JSON.stringify(b.errors.slice(0, 10)));
console.log('missing', JSON.stringify(missing));
await b.close();
srv.close();
