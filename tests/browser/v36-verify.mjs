// 浏览器实测 v3.6：
// 1) 全部 7 张程序化 vfx_* 发光贴图 + 13 张原生 4x4 精灵图加载校验（0 console errors / 0 missing assets）
// 2) 挨打房（练体箭傀射箭 + 挨打升级 + 龙鳞铠甲/的卢马挨打成长 + 顶部练功条显示）
// 3) 青龙 4 件召唤「武圣·关羽」+ 霸王/战神/无双套装 + 上古神器（女娲石/东皇钟/伏羲琴/盘古斧）特效实景
// 4) 南华仙人 NPC 与强化/渡劫面板 + 13 件神兵/神器锻造展示
// 5) 四圣兽不限波数与自适应难度秘境面板 [Y]
// 6) 20× 怪潮压境 + 觉醒大招/八卦符阵复合特效实景（校验活跃 VFX <= 160，无黑底遮挡）
// 7) 移动端（?touch=1）MOBA 防误触几何校验（minGap >= 18, minUtilGap >= 24, outOfBounds === 0）与功能抽屉
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir } from 'node:fs/promises';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const BRAIN = '/Users/libiqiang/.gemini/antigravity/brain/b1393807-a775-4d86-bdce-b3a8dfbd0525/';
await mkdir(OUT, { recursive: true });
await mkdir(BRAIN, { recursive: true });

const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8770);
const b = await Browser.launch({ port: 9339 });

async function shotBoth(name) {
  const outPath = `${OUT}${name}`;
  await b.shot(outPath);
  const brainPath = `${BRAIN}${name}`;
  await copyFile(outPath, brainPath);
  return { outPath, brainPath };
}

async function waitFrames(n = 3) {
  await b.eval(`new Promise((res) => { let k = ${n}; const f = () => (--k <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
}

try {
  // === 1. 桌面端完整验收 ===
  await b.goto('http://127.0.0.1:8770/index.html?tapcanvasPlaytest=1&seed=20261123');
  await b.until((s) => s.scene === 'title', 35000, 'title');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'select');
  await sleep(350);
  await b.press('Enter');
  await b.until((s) => s.scene === 'play', 20000, 'play');
  await sleep(450);

  // 校验 7 张 vfx_* 贴图 + 13 张原生精灵图 + 秘境初始 open + 南华 NPC
  const initCheck = JSON.parse(await b.eval(`(() => {
    const gg = globalThis.__guardScene;
    const sim = globalThis.__guardSim;
    const vfxKeys = [
      'vfx_glow_orb', 'vfx_crescent', 'vfx_rune_ring',
      'vfx_spear_streak', 'vfx_ice_shard', 'vfx_star_spark', 'vfx_impact_wave',
    ];
    const sheetKeys = [
      'sheet_azhu', 'sheet_hero_huoqing', 'sheet_hero_yunque', 'sheet_hero_xuanshuang', 'sheet_kongming',
      'sheet_beast_xuanwu', 'sheet_beast_zhuque', 'sheet_beast_baihu', 'sheet_beast_qinglong', 'sheet_beast_qilin',
      'sheet_boss_lvda', 'sheet_boss_xiangyu', 'sheet_boss_xingtian',
    ];
    const loadedVfx = vfxKeys.filter((k) => gg.textures.exists(k));
    const loadedSheets = sheetKeys.filter((k) => gg.textures.exists(k));
    const openRealms = ['xuanwu', 'baihu', 'zhuque', 'qinglong', 'xiangyu', 'xingtian'].filter((id) => sim.realms.state[id] === 'open');
    return JSON.stringify({
      loadedVfx,
      loadedSheets,
      openRealms,
      qilinState: sim.realms.state.qilin,
      nanhuaNpc: !!gg.nanhuaNpc,
      feelReady: !!gg.feel,
    });
  })()`));
  console.log('init_check', JSON.stringify(initCheck));
  if (initCheck.loadedVfx.length !== 7) throw new Error(`7 张 vfx_* 贴图未全加载: ${JSON.stringify(initCheck.loadedVfx)}`);
  if (initCheck.loadedSheets.length !== 13) throw new Error(`13 张原生精灵图未全加载: ${JSON.stringify(initCheck.loadedSheets)}`);
  if (initCheck.openRealms.length !== 6 || initCheck.qilinState !== 'locked') throw new Error(`秘境初始状态异常: ${JSON.stringify(initCheck)}`);
  if (!initCheck.nanhuaNpc || !initCheck.feelReady) throw new Error('南华仙人 NPC 或 game-feel 未初始化');

  // === 2. 挨打房（enterTemper + 挨打升级 + 挨打成长装备 龙鳞铠甲/的卢马）===
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const gg = globalThis.__guardScene;
    sim.wave.nextAt = 1e9;
    sim.copper = 2000;
    const ds = sim.loot.makeGrowth('dragonscale');
    const dl = sim.loot.makeGrowth('dilu');
    sim.loot.give(ds);
    sim.loot.give(dl);
    sim.command({ type: 'equip', bagIdx: sim.inv.equipBag.indexOf(ds), unitId: sim.hero.id });
    sim.command({ type: 'equip', bagIdx: sim.inv.equipBag.indexOf(dl), unitId: sim.hero.id });
    sim.command({ type: 'enterTemper' });
    sim.input.autoAttack = false;
    gg.timeScale = 6;
  })()`);
  const tWait0 = Date.now();
  let temperCheck = null;
  while (Date.now() - tWait0 < 25000) {
    temperCheck = JSON.parse(await b.eval(`(() => {
      const sim = globalThis.__guardSim;
      const hud = globalThis.__guardScene.hud;
      return JSON.stringify({
        t: sim.t,
        tier: sim.training.tier,
        hits: sim.temper.hits,
        xpGained: sim.temper.xpGained,
        heroLv: sim.hero.lv,
        barVisible: !!(hud.trainingBar && hud.trainingBar.c.visible),
        barText: hud.trainingBar?.temperTxt?.text || '',
        armorHits: sim.inv.equip[sim.hero.id]?.armor?.hitsTaken || 0,
        accHits: sim.inv.equip[sim.hero.id]?.accessory?.hitsTaken || 0,
      });
    })()`));
    if (temperCheck.hits >= 15 && temperCheck.heroLv >= 2) break;
    await sleep(200);
  }
  await b.eval(`globalThis.__guardScene.timeScale = 1`);
  console.log('temper_check', JSON.stringify(temperCheck));
  if (temperCheck.tier !== 'temper' || temperCheck.hits < 10 || temperCheck.xpGained <= 0 || temperCheck.heroLv < 2 || !temperCheck.barVisible) {
    throw new Error(`挨打房实时受击升级验证失败: ${JSON.stringify(temperCheck)}`);
  }
  await shotBoth('v36-01-temper-room.png');

  // === 3. 青龙召唤「武圣·关羽」+ 霸王/战神/无双套装 + 上古神器特效实景 ===
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.command({ type: 'exitTraining' });
    sim.hero.x = 1860; sim.hero.y = 2160;
    sim.hero.prevX = 1860; sim.hero.prevY = 2160;
    sim.hero.invuln = 10;
    const gy = sim.spawnUnit('summon', 'guanyu', 1970, 2150, { ttl: 14, ownerId: sim.hero.id });
    for (let i = 0; i < 6; i++) {
      const m = sim.spawnEnemy('jiangshi', 2060 + (i % 3) * 45, 2120 + Math.floor(i / 3) * 45, { hpMul: 40 });
      m.spd = 0;
    }
  })()`);
  await waitFrames(2);
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const gy = sim.units.find((u) => u.kind === 'summon' && u.key === 'guanyu');
    sim.pushFx({ t: 'guanyuSummon', x: gy.x, y: gy.y, text: '武圣 · 关羽降临！' });
    sim.pushFx({ t: 'lvbuSlash', x: 2140, y: 2120, r: 210, text: '无双戟舞！' });
    sim.pushFx({ t: 'donghuangSilence', x: 1810, y: 2160, r: 220, text: '东皇钟·万法沉默！' });
  })()`);
  await sleep(180);
  await waitFrames(1);
  const summonCheck = JSON.parse(await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const gg = globalThis.__guardScene;
    const gy = sim.units.find((u) => u.kind === 'summon' && u.key === 'guanyu');
    return JSON.stringify({
      hasGuanyu: !!(gy && gy.alive),
      inParty: gy ? sim.party.includes(gy.id) : null,
      hasSprite: gy ? gg.sprites.has(gy.id) : false,
    });
  })()`));
  console.log('guanyu_check', JSON.stringify(summonCheck));
  if (!summonCheck.hasGuanyu || summonCheck.inParty !== false || !summonCheck.hasSprite) {
    throw new Error(`武圣·关羽召唤渲染异常: ${JSON.stringify(summonCheck)}`);
  }
  await shotBoth('v36-02-sets-guanyu.png');

  // === 4. 南华仙人强化 / 渡劫面板 + 13 件锻造列表 ===
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const gg = globalThis.__guardScene;
    sim.copper = 20000;
    sim.gainXp(80000);
    const w = sim.loot.roll({ slot: 'weapon', q: 4, set: 'lvbu', wave: 18 });
    sim.loot.give(w);
    sim.command({ type: 'equip', bagIdx: sim.inv.equipBag.indexOf(w), unitId: sim.hero.id });
    sim.command({ type: 'enhanceEquip', unitId: sim.hero.id, slot: 'weapon' });
    sim.command({ type: 'enhanceEquip', unitId: sim.hero.id, slot: 'weapon' });
    sim.command({ type: 'ascendHero' });
    gg.hud.togglePanel('nanhua');
  })()`);
  await sleep(260);
  await waitFrames(4);
  const nanhuaCheck = JSON.parse(await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const hud = globalThis.__guardScene.hud;
    return JSON.stringify({
      panel: hud.panel?.name,
      enhanceCount: sim.nanhua.enhanceCount,
      ascendLv: sim.nanhua.ascendLv,
      weaponEnh: sim.inv.equip[sim.hero.id]?.weapon?.enhanceLv || 0,
    });
  })()`));
  console.log('nanhua_check', JSON.stringify(nanhuaCheck));
  if (nanhuaCheck.panel !== 'nanhua' || nanhuaCheck.weaponEnh < 2 || nanhuaCheck.ascendLv < 1) {
    throw new Error(`南华仙人面板/强化/渡劫校验失败: ${JSON.stringify(nanhuaCheck)}`);
  }
  await shotBoth('v36-03-nanhua.png');

  // 打开行囊·神兵锻造（神器筛选项）截图
  await b.eval(`globalThis.__guardScene.hud.togglePanel('bag', { tab: 'craft', craftFilter: 'artifact' })`);
  await sleep(240);
  await waitFrames(4);
  await shotBoth('v36-03b-artifacts-craft.png');

  // === 5. 固定高难度秘境面板 [Y] ===
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const hud = globalThis.__guardScene.hud;
    sim.wave.n = 10;
    sim.realms.clearCount.xuanwu = 2;
    hud.togglePanel('realms');
  })()`);
  await sleep(240);
  await waitFrames(4);
  const realmPanelCheck = JSON.parse(await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const ad = sim.realms.getAdaptiveInfo('xuanwu');
    const ql = sim.realms.getAdaptiveInfo('qilin');
    const xt = sim.realms.getAdaptiveInfo('xingtian');
    return JSON.stringify({ panel: globalThis.__guardScene.hud.panel?.name, ad, ql, xt });
  })()`));
  console.log('realms_fixed_check', JSON.stringify(realmPanelCheck));
  if (realmPanelCheck.panel !== 'realms' || realmPanelCheck.ad.fixed !== true || realmPanelCheck.ad.adaptMul !== 1
      || realmPanelCheck.ad.bossHp !== 22000 || realmPanelCheck.ad.tameable !== true
      || realmPanelCheck.ql.tameable !== false
      || realmPanelCheck.xt.tierMul !== 8.8 || realmPanelCheck.xt.bossHp !== 560000 || realmPanelCheck.xt.tameable !== false) {
    throw new Error(`固定高难度秘境面板校验失败: ${JSON.stringify(realmPanelCheck)}`);
  }
  await shotBoth('v36-04-realms.png');
  await b.press('Escape');
  await sleep(200);

  // === 6. 20× 怪潮压境 + 觉醒大招/程序化复合 VFX 实景 ===
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.hero.x = 2000; sim.hero.y = 1660;
    sim.hero.prevX = 2000; sim.hero.prevY = 1660;
    sim.hero.invuln = 10;
    sim.kongming.invuln = 10;
    sim.gainXp(200000); // 30级觉醒
    sim.hero.energy = 100;
    sim.hero.skillLvs.u = 1;
    // 开启第 1 波（重置 nextAt 避免虚高提前奖励）并快进刷出大波 20× 怪潮
    sim.wave.n = 0;
    sim.wave.nextAt = sim.t;
    sim.command({ type: 'callWave' });
    sim.advance(16);
    for (let i = 0; i < 65; i++) {
      const ang = (i / 65) * Math.PI * 2;
      const rad = 120 + (i % 4) * 55;
      sim.spawnEnemy(i % 4 === 0 ? 'jiangshi' : 'paperman', 2000 + Math.cos(ang) * rad, 1620 + Math.sin(ang) * rad * 0.65);
    }
  })()`);
  await waitFrames(2);
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.command({ type: 'castSkill', slot: 'u', x: 2000, y: 1600 });
    sim.pushFx({ t: 'iceBurst', x: 2260, y: 1620, r: 170, awakened: true });
    sim.pushFx({ t: 'goldenNova', x: 1740, y: 1640, r: 190, text: '金刚不坏！' });
  })()`);
  await sleep(180);
  await waitFrames(1);
  const swarmCheck = JSON.parse(await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const gg = globalThis.__guardScene;
    return JSON.stringify({
      waveSpawnTotal: sim.wave.spawnTotal,
      aliveMainEnemies: sim.enemies.filter((e) => e.alive && !e.realm).length,
      visibleEnemies: gg.visibleEnemies,
      awakened: sim.hero.awakened,
      activeVfx: (gg.__vfxActive || []).length,
    });
  })()`));
  console.log('swarm_vfx_check', JSON.stringify(swarmCheck));
  if (swarmCheck.waveSpawnTotal < 200 || swarmCheck.visibleEnemies < 40 || swarmCheck.activeVfx > 160) {
    throw new Error(`20× 怪潮或 VFX 上限异常: ${JSON.stringify(swarmCheck)}`);
  }
  await shotBoth('v36-05-vfx-swarm.png');

  // 停顿检查暂停菜单无障碍设置（震屏强度 & 减弱闪光）
  await b.press('Escape');
  await sleep(240);
  const pauseFeel = await b.eval(`globalThis.__guardScene.hud.modal`);
  if (pauseFeel !== 'pause') throw new Error(`暂停菜单未正常打开: ${pauseFeel}`);

  // === 7. 移动端 (?touch=1) 几何防误触校验与抽屉实景 ===
  await b.goto('http://127.0.0.1:8770/index.html?tapcanvasPlaytest=1&touch=1&seed=20261123');
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
        if (gap < minGap) minGap = gap;
        if ((a.kind === 'utility' || b2.kind === 'utility') && gap < minUtilGap) minUtilGap = gap;
      }
    }
    return JSON.stringify({
      count: btns.length,
      minGap: Math.round(minGap * 10) / 10,
      minUtilGap: Math.round(minUtilGap * 10) / 10,
      outOfBounds,
      btns,
    });
  })()`));
  console.log('mobile_geometry', JSON.stringify({
    count: geoCheck.count,
    minGap: geoCheck.minGap,
    minUtilGap: geoCheck.minUtilGap,
    outOfBounds: geoCheck.outOfBounds.length,
    sizes: geoCheck.btns.map((x) => `${x.id}:${x.d}`),
  }));
  if (geoCheck.count < 8) throw new Error(`移动端 MOBA 按钮数量不足: ${geoCheck.count}`);
  if (geoCheck.outOfBounds.length > 0) throw new Error(`存在越界按钮: ${JSON.stringify(geoCheck.outOfBounds)}`);
  if (geoCheck.minGap < 18) throw new Error(`移动端按钮间距不足 18px: ${geoCheck.minGap}`);
  if (geoCheck.minUtilGap < 24) throw new Error(`召唤师技能间距不足 24px: ${geoCheck.minUtilGap}`);
  await shotBoth('v36-06-mobile.png');

  // 打开移动端功能抽屉检查「挨打房」「南华仙人」入口
  const mbox = JSON.parse(await b.eval('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
  const mpx = (x) => mbox.left + (x / 1280) * mbox.width;
  const mpy = (y) => mbox.top + (y / 720) * mbox.height;
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mpx(64), y: mpy(132), button: 'left', clickCount: 1 });
  await sleep(50);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mpx(64), y: mpy(132), button: 'left', clickCount: 1 });
  await sleep(250);
  const drawerVis = await b.eval('!!(globalThis.__guardScene.hud.mobileDrawerC && globalThis.__guardScene.hud.mobileDrawerC.visible)');
  if (!drawerVis) throw new Error('移动端功能抽屉未打开');
  await shotBoth('v36-06b-mobile-drawer.png');

  if (b.errors.length > 0) throw new Error(`页面报错: ${JSON.stringify(b.errors)}`);
  if (missing.length > 0) throw new Error(`缺失资源: ${JSON.stringify(missing)}`);
  console.log('ALL_OK');
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  console.log('errors', JSON.stringify(b.errors.slice(0, 10)));
  console.log('missing', JSON.stringify(missing));
  await b.close();
  srv.close();
}
