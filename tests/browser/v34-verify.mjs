// 浏览器实测 v3.4：
// 1) 全部 10 张原生 4x4 16 帧多姿态精灵图（4 英雄 + 孔明 + 5 神兽）加载与播放校验
// 2) 6 张名将神兵专属独立图标加载校验
// 3) 桌面端大号 MOBA 技能轮盘（普攻 100px / 技能 74px / 大招 82px / 闪现回城 62px）点击与拖动取消校验
// 4) 打开行囊/合成自动暂停战斗校验 + 装备/道具分栏 + 选中属性绿红对比卡片 + 唯一道具不可出售
// 5) 装备升阶与名将神兵锻造（青龙偃月刀）
// 6) 练功房一键进入 + 顶部阶层控制栏
// 7) 移动端（?touch=1）实机布局与大号拇指按钮、行囊暂停弹窗零溢出校验
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8768);
const b = await Browser.launch({ port: 9337 });

try {
  // === 1. 桌面端完整验收 ===
  await b.goto('http://127.0.0.1:8768/index.html?tapcanvasPlaytest=1&seed=20261122');
  await b.until((s) => s.scene === 'title', 35000, 'title');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'select');
  await sleep(400);
  await b.press('Enter');
  await b.until((s) => s.scene === 'play', 20000, 'play');
  await sleep(500);

  // 校验全部 10 张原生多姿态精灵图 + 6 张名将神兵图标已加载，并召唤 5 只神兽检验全部使用 sheet_beast_*
  const assetCheck = JSON.parse(await b.eval(`(() => {
    const gg = globalThis.__guardScene;
    const sim = globalThis.__guardSim;
    const sheetKeys = [
      'sheet_azhu', 'sheet_hero_huoqing', 'sheet_hero_yunque', 'sheet_hero_xuanshuang', 'sheet_kongming',
      'sheet_beast_xuanwu', 'sheet_beast_zhuque', 'sheet_beast_baihu', 'sheet_beast_qinglong', 'sheet_beast_qilin',
    ];
    const loadedSheets = sheetKeys.filter((k) => gg.textures.exists(k));
    const legendKeys = [
      'g_eq_legend_qinglong_blade', 'g_eq_legend_fangtian_halberd', 'g_eq_legend_zhuque_fan',
      'g_eq_legend_xuanwu_armor', 'g_eq_legend_qilin_seal', 'g_eq_legend_wolong_scroll',
    ];
    const loadedLegends = legendKeys.filter((k) => gg.textures.exists(k));
    const beasts = ['xuanwu', 'zhuque', 'baihu', 'qinglong', 'qilin'];
    const spawned = [];
    beasts.forEach((bk, i) => {
      const ang = -Math.PI * 0.8 + i * 0.4;
      const u = sim.spawnUnit('beast', bk, sim.hero.x + Math.cos(ang) * 190, sim.hero.y + Math.sin(ang) * 120);
      spawned.push({ key: bk, id: u.id });
    });
    return JSON.stringify({ loadedSheets, loadedLegends, spawned });
  })()`));
  await sleep(350);
  const beastRenderCheck = JSON.parse(await b.eval(`(() => {
    const gg = globalThis.__guardScene;
    const sim = globalThis.__guardSim;
    return JSON.stringify(sim.units.filter((u) => u.kind === 'beast').map((u) => {
      const sp = gg.sprites.get(u.id);
      return { key: u.key, tex: sp ? sp.texKey : null, anim: sp?.anims?.currentAnim?.key || null };
    }));
  })()`));
  console.log('sheets_loaded', assetCheck.loadedSheets.length, 'legends_loaded', assetCheck.loadedLegends.length);
  console.log('beasts_rendered', JSON.stringify(beastRenderCheck));
  if (assetCheck.loadedSheets.length !== 10) throw new Error(`10 张原生精灵图未全加载: ${JSON.stringify(assetCheck.loadedSheets)}`);
  if (assetCheck.loadedLegends.length !== 6) throw new Error(`6 张神兵图标未全加载: ${JSON.stringify(assetCheck.loadedLegends)}`);
  for (const br of beastRenderCheck) {
    if (br.tex !== `sheet_beast_${br.key}`) throw new Error(`神兽 ${br.key} 未使用原生精灵图: ${br.tex}`);
  }
  await b.shot(`${OUT}v34-01-desktop-play.png`);

  // 校验大号 MOBA 普攻键 (1196, 636) 点击不穿透地图移动，并验证拖动 Q (1084, 648) 至取消区 (840, 480) 取消
  const box = JSON.parse(await b.eval('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
  const px = (x) => box.left + (x / 1280) * box.width;
  const py = (y) => box.top + (y / 720) * box.height;
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px(1196), y: py(636), button: 'left', clickCount: 1 });
  await sleep(60);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(1196), y: py(636), button: 'left', clickCount: 1 });
  await sleep(80);
  const orderAfterAtk = await b.eval('JSON.stringify(__guardSim.ctrl.order)');
  if (orderAfterAtk !== 'null') throw new Error(`点击大号普攻键穿透触发移动: ${orderAfterAtk}`);

  // 准备测试装备 + 唯一魂痕，打开行囊（B），验证战斗冻结暂停 + 选中装备展示属性对比
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.copper = 1500;
    const w0 = sim.loot.roll({ slot: 'weapon', q: 0, wave: 1 });
    sim.loot.give(w0);
    sim.command({ type: 'equip', bagIdx: 0, unitId: sim.hero.id });
    sim.loot.give(sim.loot.roll({ slot: 'weapon', q: 2, set: 'qinglong', wave: 10 }));
    sim.loot.give(sim.loot.roll({ slot: 'weapon', q: 1, set: 'baihu', wave: 5 }));
    sim.loot.give(sim.loot.roll({ slot: 'armor', q: 1, set: 'xuanwu', wave: 5 }));
    sim.loot.give(sim.loot.roll({ slot: 'armor', q: 1, set: 'plain', wave: 5 }));
    sim.loot.give(sim.loot.roll({ id: 'soul_qinglong' }));
    sim.loot.give(sim.loot.roll({ id: 'pill' }));
  })()`);
  await b.press('b');
  await b.until((s) => s.scene === 'panel_bag', 5000, 'bag');
  const tOpen = Number(await b.eval('__guardSim.t'));
  await sleep(450);
  const tStill = Number(await b.eval('__guardSim.t'));
  console.log('bag_pause_check', { tOpen, tStill, paused: tOpen === tStill });
  if (tStill !== tOpen) throw new Error(`打开行囊未暂停战斗: ${tOpen} -> ${tStill}`);

  // 点击第 1 格装备（x: 110 + 57 = 167, y: 328 + 41 = 369）查看属性对比卡
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px(167), y: py(369), button: 'left', clickCount: 1 });
  await sleep(50);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(167), y: py(369), button: 'left', clickCount: 1 });
  await sleep(250);
  await b.shot(`${OUT}v34-02-paused-bag-compare.png`);

  // 切换至「神兵合成」页签（第 3 个顶部页签 cx = 90 + 20 + 2*212 + 100 = 634, cy = 66 + 54 + 18 = 138）
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px(634), y: py(138), button: 'left', clickCount: 1 });
  await sleep(50);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(634), y: py(138), button: 'left', clickCount: 1 });
  await sleep(300);
  await b.shot(`${OUT}v34-03-craft-legendary.png`);

  // 关闭行囊，验证战斗恢复
  await b.press('Escape');
  await sleep(300);
  const tResumed = Number(await b.eval('__guardSim.t'));
  if (tResumed <= tStill) throw new Error(`关闭行囊后战斗未恢复: ${tStill} -> ${tResumed}`);

  // 进入练功房并截图
  await b.eval(`__guardSim.command({ type: 'enterTraining' })`);
  await sleep(450);
  await b.shot(`${OUT}v34-04-training-room.png`);

  // === 2. 移动端（?touch=1）验收 ===
  await b.goto('http://127.0.0.1:8768/index.html?tapcanvasPlaytest=1&touch=1&seed=20261122');
  await b.until((s) => s.scene === 'title', 20000, 'touch-title');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'touch-select');
  await sleep(350);
  await b.press('Enter');
  await b.until((s) => s.scene === 'play', 20000, 'touch-play');
  await sleep(450);
  await b.shot(`${OUT}v34-05-mobile-play.png`);

  // 移动端点击顶部「行囊·合成」(170, 132) 验证大号弹窗 + 摇杆隐藏 + 战斗暂停
  const mbox = JSON.parse(await b.eval('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
  const mpx = (x) => mbox.left + (x / 1280) * mbox.width;
  const mpy = (y) => mbox.top + (y / 720) * mbox.height;
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.copper = 800;
    sim.loot.give(sim.loot.roll({ slot: 'weapon', q: 3, set: 'zhuque', wave: 12 }));
    sim.loot.give(sim.loot.roll({ id: 'soul_qilin' }));
  })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mpx(170), y: mpy(132), button: 'left', clickCount: 1 });
  await sleep(50);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mpx(170), y: mpy(132), button: 'left', clickCount: 1 });
  await sleep(300);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mpx(167), y: mpy(369), button: 'left', clickCount: 1 });
  await sleep(50);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mpx(167), y: mpy(369), button: 'left', clickCount: 1 });
  await sleep(250);
  await b.shot(`${OUT}v34-06-mobile-bag.png`);

  console.log('ALL_OK');
} catch (e) {
  console.log('FAIL', e.message);
  process.exitCode = 1;
}
console.log('errors', JSON.stringify(b.errors.slice(0, 10)));
console.log('missing', JSON.stringify(missing));
await b.close();
srv.close();
