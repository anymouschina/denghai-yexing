// 浏览器实测 v3.3：桌面端（三路兵线/复活点/商店/6格折叠行囊/技能加点/快捷道具栏/闪现/回城/清地）+ 移动端（?touch=1 精简无遮挡 HUD）
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8767);
const b = await Browser.launch({ port: 9336 });
const rel = (x, y) => [x / 1280, y / 720];

try {
  // === 1. 桌面端验收 ===
  await b.goto('http://127.0.0.1:8767/index.html?tapcanvasPlaytest=1&seed=20261122');
  await b.until((s) => s.scene === 'title', 35000, 'title');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'select');
  await sleep(400);
  await b.press('Enter');
  await b.until((s) => s.scene === 'play', 20000, 'play');
  await sleep(400);
  await b.shot(`${OUT}v33-01-desktop-play.png`);

  // 校验 5 张原生多姿态 16 帧精灵图全部加载且霍青/孔明正在播放 sheet_* 原生图集
  const sheetCheck = JSON.parse(await b.eval(`(() => {
    const gg = globalThis.__guardScene;
    const keys = ['sheet_azhu','sheet_hero_huoqing','sheet_hero_yunque','sheet_hero_xuanshuang','sheet_kongming'];
    const loaded = keys.filter((k) => gg.textures.exists(k));
    const hSp = gg.sprites.get(__guardSim.hero.id);
    const kSp = gg.sprites.get(__guardSim.kongming.id);
    return JSON.stringify({
      loaded,
      heroTex: hSp ? hSp.texKey : null,
      heroAnim: hSp && hSp.anims && hSp.anims.currentAnim ? hSp.anims.currentAnim.key : null,
      kmTex: kSp ? kSp.texKey : null,
      kmAnim: kSp && kSp.anims && kSp.anims.currentAnim ? kSp.anims.currentAnim.key : null,
    });
  })()`));
  console.log('native_sheets', JSON.stringify(sheetCheck));
  if (sheetCheck.loaded.length !== 5) throw new Error(`原生多姿态精灵图未全部加载: ${JSON.stringify(sheetCheck.loaded)}`);
  if (sheetCheck.heroTex !== 'sheet_hero_huoqing') throw new Error(`霍青未使用原生精灵图: ${sheetCheck.heroTex}`);
  if (sheetCheck.kmTex !== 'sheet_kongming') throw new Error(`孔明未使用原生精灵图: ${sheetCheck.kmTex}`);

  // 校验点击 HUD 按钮（普攻键 / 回城键）绝不会穿透触发世界地图移动指令
  const box = JSON.parse(await b.eval('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
  const px = (x) => box.left + (x / 1280) * box.width;
  const py = (y) => box.top + (y / 720) * box.height;
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px(1208), y: py(648), button: 'left', clickCount: 1 });
  await sleep(60);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(1208), y: py(648), button: 'left', clickCount: 1 });
  await sleep(80);
  const orderAfterAtk = await b.eval('JSON.stringify(__guardSim.ctrl.order)');
  if (orderAfterAtk !== 'null') throw new Error(`点击 HUD 普攻键穿透触发了地图移动指令: ${orderAfterAtk}`);
  await b.shot(`${OUT}v33-08-multipose-combat.png`);

  // 打开商店（P）并购买回春丹（1）
  await b.press('p');
  await b.until((s) => s.scene === 'panel_shop', 5000, 'shop');
  await sleep(300);
  await b.shot(`${OUT}v33-02-desktop-shop.png`);
  await b.press('1');
  await sleep(250);
  await b.press('Escape');
  await sleep(250);

  // 打开 6 格折叠行囊（B）
  await b.press('b');
  await b.until((s) => s.scene === 'panel_bag', 5000, 'bag');
  await sleep(300);
  await b.shot(`${OUT}v33-03-desktop-bag6.png`);
  await b.press('Escape');
  await sleep(250);

  // 实测通用闪现（X）与回城（V）
  const sBefore = await b.snap();
  await b.press('x');
  await sleep(250);
  const sAfterBlink = await b.snap();
  const blinkMoved = Math.hypot(sAfterBlink.x - sBefore.x, sAfterBlink.y - sBefore.y);
  console.log('blink_moved', Math.round(blinkMoved));
  if (blinkMoved < 40) throw new Error(`闪现未生效，移动距离仅 ${blinkMoved}`);

  await b.press('v');
  await sleep(300);
  await b.shot(`${OUT}v33-04-desktop-recall.png`);

  // 实测王者荣耀技能轮盘：拖动 Q 瞄准方向并截图（含世界空间指示器 + 取消施法区），再拖至取消区确认取消
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px(1116), y: py(656), button: 'left', clickCount: 1 });
  await sleep(80);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(1048), y: py(620), buttons: 1 });
  await sleep(160);
  await b.shot(`${OUT}v33-07-desktop-aim-wheel.png`);
  // 拖入红圈「× 取消施法」(964, 512) 后松手：技能应被取消（Q 冷却仍为 0）
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(964), y: py(512), buttons: 1 });
  await sleep(100);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(964), y: py(512), button: 'left', clickCount: 1 });
  await sleep(150);
  const qCdCancelled = Number(await b.eval('__guardSim.ctrl.cds.q'));
  if (qCdCancelled > 0) throw new Error(`拖入取消区后 Q 仍被释放，cd=${qCdCancelled}`);
  // 再拖动 Q 向左上方松手：确认定向施法生效
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px(1116), y: py(656), button: 'left', clickCount: 1 });
  await sleep(80);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(1048), y: py(620), buttons: 1 });
  await sleep(100);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(1048), y: py(620), button: 'left', clickCount: 1 });
  await sleep(150);
  const qCdFired = Number(await b.eval('__guardSim.ctrl.cds.q'));
  console.log('drag_aim_cancel_ok', qCdCancelled === 0, 'drag_aim_fire_cd', Number(qCdFired.toFixed(2)));
  if (qCdFired <= 0) throw new Error('拖动瞄准松手后 Q 未释放');

  // === 2. 移动端（?touch=1）精简 HUD 验收 ===
  await b.goto('http://127.0.0.1:8767/index.html?tapcanvasPlaytest=1&touch=1&seed=20261122');
  await b.until((s) => s.scene === 'title', 20000, 'touch-title');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'touch-select');
  await sleep(400);
  await b.press('Enter');
  await b.until((s) => s.scene === 'play', 20000, 'touch-play');
  await sleep(450);
  await b.shot(`${OUT}v33-05-mobile-clean.png`);

  // 点左上「功能 ▾」展开移动端抽屉，并验证点击抽屉内空白区不会穿透触发世界移动
  await b.click(...rel(60, 126));
  await sleep(300);
  await b.shot(`${OUT}v33-06-mobile-drawer.png`);
  const mbox = JSON.parse(await b.eval('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
  const mpx = (x) => mbox.left + (x / 1280) * mbox.width;
  const mpy = (y) => mbox.top + (y / 720) * mbox.height;
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mpx(103), y: mpy(151), button: 'left', clickCount: 1 });
  await sleep(50);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mpx(103), y: mpy(151), button: 'left', clickCount: 1 });
  await sleep(80);
  const mobileDrawerOrder = await b.eval('JSON.stringify(__guardSim.ctrl.order)');
  if (mobileDrawerOrder !== 'null') throw new Error(`移动端点击抽屉空白处穿透触发移动: ${mobileDrawerOrder}`);

  // === 3. 校验其余 3 位英雄（阿烛/云鹊/玄霜）均原生播放 sheet_* 多姿态精灵图（阿烛不再回退旧 hero_run） ===
  const otherHeroes = [
    { key: '1', id: 'azhu', expectedTex: 'sheet_azhu' },
    { key: '3', id: 'yunque', expectedTex: 'sheet_hero_yunque' },
    { key: '4', id: 'xuanshuang', expectedTex: 'sheet_hero_xuanshuang' },
  ];
  const heroSheetResults = [];
  for (const h of otherHeroes) {
    await b.goto('http://127.0.0.1:8767/index.html?tapcanvasPlaytest=1&seed=20261122');
    await b.until((s) => s.scene === 'title', 20000, `title-${h.id}`);
    await b.press('g');
    await b.until((s) => s.scene === 'select', 20000, `select-${h.id}`);
    await sleep(300);
    await b.press(h.key);
    await sleep(200);
    await b.press('Enter');
    await b.until((s) => s.scene === 'play', 20000, `play-${h.id}`);
    await sleep(350);
    const info = JSON.parse(await b.eval(`(() => {
      const gg = globalThis.__guardScene;
      const sp = gg.sprites.get(__guardSim.hero.id);
      return JSON.stringify({ id: __guardSim.hero.key, tex: sp ? sp.texKey : null, anim: sp?.anims?.currentAnim?.key || null });
    })()`));
    heroSheetResults.push(info);
    if (info.tex !== h.expectedTex) throw new Error(`${h.id} 未使用原生精灵图: got=${info.tex}, expected=${h.expectedTex}`);
  }
  console.log('all_heroes_native_sheets', JSON.stringify(heroSheetResults));

  console.log('ALL_OK');
} catch (e) {
  console.log('FAIL', e.message);
  process.exitCode = 1;
}
console.log('errors', JSON.stringify(b.errors.slice(0, 10)));
console.log('missing', JSON.stringify(missing));
await b.close();
srv.close();
