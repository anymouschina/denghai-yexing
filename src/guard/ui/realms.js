// M4/v3.5 秘境常驻小部件 + 秘境总览/重刷面板（M 打开，桌面与移动端通用）：
// - 覆盖全部 7 座秘境（玄武/青龙/朱雀/白虎/麒麟 + 霸王·项羽 + 战神·刑天），显示 可进/交战/冷却Xs/可重刷。
// - 点击一键寻路或直接传送进入，冷却结束后支持一键「再次挑战」无限重刷高阶装备与套装。
import RD from '../data/realms.json' with { type: 'json' };
import { REALMS, HIDDEN, EXTRA_REALMS, ALL_REALMS, gateCenter } from '../sim/map.js';
import { qName } from '../sim/systems/loot.js';
import { TF, BF, NF, INK } from '../../fonts.js';
import { makeButton, drawPanel } from '../../widgets.js';
import { touch } from '../../touch.js';

const X0 = 1050;
const Y0 = 236;
const W = 216;
const H = 96;
const ROW1 = [...REALMS, HIDDEN];
const ROW2 = EXTRA_REALMS;

const stText = (size, color = '#f3e6c8', font = BF, extra = {}) => ({
  fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 3, ...extra,
});

function realmStatus(sim, r) {
  const R = sim.realms;
  if (!R) return { code: 'locked', txt: '锁', panelTxt: '未启用', col: 0x5a5470, fg: '#9a94b8', canEnter: false };
  const rd = RD.realms[r.id] || {};
  const s = R.state[r.id] || 'locked';
  const hiddenLocked = r.hidden && !R.hiddenOpen;
  if (hiddenLocked) return { code: 'locked', txt: `清${RD.hiddenNeed}座`, panelTxt: `清${RD.hiddenNeed}座秘境开启`, col: 0x5a5470, fg: '#9a94b8', canEnter: false };
  if (s === 'locked') return { code: 'locked', txt: `第${rd.open}波`, panelTxt: `第${rd.open}波开放`, col: 0x5a5470, fg: '#9a94b8', canEnter: false };
  if (s === 'active') return { code: 'active', txt: '交战', panelTxt: '交战中', col: 0xb0502a, fg: '#ffb35a', canEnter: true };
  if (s === 'cleared') {
    const cd = Math.ceil(R.cooldownLeft(r.id));
    if (rd.repeatable && cd > 0) return { code: 'cd', txt: `${cd}s`, panelTxt: `冷却 ${cd}s`, col: 0x3b3d68, fg: '#b8c4ff', canEnter: false };
    if (rd.repeatable) return { code: 'repeat', txt: '可重刷', panelTxt: '可重刷', col: 0x2e8a5c, fg: '#9ff0b8', canEnter: true };
    const canTame = rd.tameable !== undefined ? !!rd.tameable : ['xuanwu', 'baihu', 'zhuque', 'qinglong'].includes(r.id);
    return { code: 'cleared', txt: canTame ? '收服' : '已破', panelTxt: canTame ? '已收服' : '已击破', col: 0xb08a2a, fg: '#ffd36a', canEnter: false };
  }
  if (R.firstCleared[r.id]) return { code: 'repeat', txt: '可重刷', panelTxt: '可重刷', col: 0x2e8a5c, fg: '#9ff0b8', canEnter: true };
  const unrestricted = !r.hidden && (rd.open || 0) <= 0;
  return { code: 'open', txt: '可进', panelTxt: unrestricted ? '不限波数·已开放' : '可进入', col: 0x2a7f9a, fg: '#7fe3ff', canEnter: true };
}

function enterOrGuideRealm(hud, r) {
  const sim = hud.sim;
  const R = sim.realms;
  if (!R) return;
  const info = realmStatus(sim, r);
  const rd = RD.realms[r.id] || {};
  if (!info.canEnter) {
    if (info.code === 'cd') hud.toast(`${r.name}重刷冷却中（剩 ${info.txt}）`, '#b8c4ff');
    else if (r.hidden && !R.hiddenOpen) hud.toast(`需先清空 ${RD.hiddenNeed} 座神兽秘境开启麒麟·中宫`, '#9aa3cf');
    else hud.toast(`${r.name}将于第 ${rd.open} 波开放`, '#9aa3cf');
    return;
  }
  hud.closePanel();
  if (r.portal || r.hidden || sim.ctrl?.realm === r.id) {
    const res = hud.gg.cmd({ type: 'enterRealm', id: r.id });
    if (res && res.ok) hud.toast(res.activated ? `已重新开启 ${r.name} 挑战！` : `已传送进入 ${r.name}（主线不会暂停）`, '#ffd36a');
    return;
  }
  const [gx, gy] = gateCenter(r);
  hud.gg.setQuestGuide?.(gx, gy, r.name, true);
  hud.toast(`正前往 ${r.name}（主线不会暂停，留意孔明血量）`, '#7fe3ff');
}

// 1. 常驻秘境小部件（桌面端右侧小地图下方）
const widget = {
  name: 'realmsWidget',
  always: true,
  create(hud) {
    const sim = hud.sim;
    const c = hud.add.container(0, 0);
    sim.on('realmBlocked', (b) => hud.toast(b.text, '#ff8a7a'));
    sim.on('realmEnter', (d) => {
      const rr = ALL_REALMS.find((r) => r.id === d.id);
      if (rr) hud.toast(`进入${rr.name}${d.repeat ? '（重刷）' : ''} · 主线妖物不会停`, '#ffc977');
    });
    sim.on('realmReset', () => hud.toast('全员离开秘境 · 守卫重置，下次进入重新开始', '#d8d2f5'));
    sim.on('realmRespawn', (d) => {
      const rr = ALL_REALMS.find((r) => r.id === d.id);
      if (rr) hud.toast(`${rr.name}已刷新 · 可再次挑战刷高阶神兵！`, '#9ff0b8');
    });
    if (touch.enabled) {
      c.setVisible(false);
      return { c, refresh() {} };
    }
    const g = hud.add.graphics();
    c.add(g);

    const cw = 38;
    const gap = (W - 12 - cw * 5) / 4;
    const chips = ROW1.map((r, i) => {
      const x = X0 + 6 + i * (cw + gap);
      const y = Y0 + 4;
      const ch = hud.add.text(x + cw / 2, y + 14, RD.realms[r.id].short, { fontFamily: '"Ma Shan Zheng", "STKaiti", serif', fontSize: '19px', color: '#f3e6c8', stroke: INK, strokeThickness: 3 }).setOrigin(0.5);
      const st = hud.add.text(x + cw / 2, y + 36, '', stText(10, '#ffffff', BF, { strokeThickness: 2 })).setOrigin(0.5);
      const hit = hud.add.rectangle(x + cw / 2, y + 22, cw, 42, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => enterOrGuideRealm(hud, r));
      c.add([ch, st, hit]);
      return { r, x, y, w: cw, h: 30, ch, st };
    });

    // 第二排：项羽 + 刑天 + 总览按钮 [M]
    const row2Y = Y0 + 50;
    const extraChips = ROW2.map((r, i) => {
      const x = X0 + 6 + i * 70;
      const w = 66;
      const ch = hud.add.text(x + w / 2, row2Y + 11, r.id === 'xiangyu' ? '霸王·项羽' : '战神·刑天', stText(11, '#ffd36a', BF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(0.5);
      const st = hud.add.text(x + w / 2, row2Y + 28, '', stText(10, '#ffffff', BF, { strokeThickness: 2 })).setOrigin(0.5);
      const hit = hud.add.rectangle(x + w / 2, row2Y + 19, w, 38, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => enterOrGuideRealm(hud, r));
      c.add([ch, st, hit]);
      return { r, x, y: row2Y, w, h: 38, ch, st };
    });

    const openBtn = makeButton(hud, X0 + W - 36, row2Y + 19, 60, 34, '总览[Y]', () => hud.togglePanel('realms'), { size: 11, font: BF, primary: true });
    c.add(openBtn);

    let last = '';
    return {
      c,
      refresh() {
        const R = sim.realms;
        if (!R) { c.setVisible(false); return; }
        const u = sim.ctrl;
        const inR = u && u.alive && u.realm ? u.realm : null;
        const key = `${ALL_REALMS.map((r) => `${R.state[r.id]}:${Math.ceil(R.cooldownLeft(r.id))}`).join()}|${R.hiddenOpen}|${inR}|${sim.wave.n}`;
        if (key === last) return;
        last = key;
        g.clear();
        g.fillStyle(0x0b0d18, 0.78).fillRoundedRect(X0, Y0, W, H, 10);
        g.lineStyle(2, inR ? 0xff7a3a : 0x343c70, 0.95).strokeRoundedRect(X0, Y0, W, H, 10);
        for (const k of chips) {
          const info = realmStatus(sim, k.r);
          g.fillStyle(info.col, info.code === 'locked' ? 0.45 : 0.85).fillRoundedRect(k.x, k.y, k.w, k.h, 7);
          g.lineStyle(1.8, k.r.color, info.code === 'locked' ? 0.35 : 0.9).strokeRoundedRect(k.x, k.y, k.w, k.h, 7);
          if (inR === k.r.id) g.lineStyle(2.5, 0xffffff, 0.95).strokeRoundedRect(k.x - 1, k.y - 1, k.w + 2, k.h + 2, 8);
          k.ch.setText(k.r.hidden && !R.hiddenOpen ? '？' : RD.realms[k.r.id].short).setAlpha(info.code === 'locked' ? 0.55 : 1);
          k.st.setText(info.txt).setColor(info.fg);
        }
        for (const k of extraChips) {
          const info = realmStatus(sim, k.r);
          g.fillStyle(info.col, info.code === 'locked' ? 0.45 : 0.86).fillRoundedRect(k.x, k.y, k.w, k.h, 7);
          g.lineStyle(1.8, k.r.color, info.code === 'locked' ? 0.35 : 0.95).strokeRoundedRect(k.x, k.y, k.w, k.h, 7);
          if (inR === k.r.id) g.lineStyle(2.5, 0xffffff, 0.95).strokeRoundedRect(k.x - 1, k.y - 1, k.w + 2, k.h + 2, 8);
          k.st.setText(info.txt).setColor(info.fg);
        }
      },
    };
  },
};

// 2. 完整秘境选择与重刷面板（Y 打开，支持桌面端与移动端，打开自动暂停）
const realmsPanel = {
  name: 'realms',
  key: 'y',
  create(hud) {
    const X = 130; const Y = 74; const PW = 1020; const PH = 572;
    const c = hud.add.container(0, 0);
    const dim = hud.add.rectangle(640, 360, 1280, 720, 0x05061a, 0.58).setInteractive();
    const bg = drawPanel(hud.add.graphics(), X, Y, PW, PH, { glow: 0xffc977 });
    const title = hud.add.text(640, Y + 28, '神兽秘境 · 霸王项羽 · 战神刑天（固定高难·可重刷）', stText(26, '#ffc977', TF, { strokeThickness: 6 })).setOrigin(0.5);
    const sub = hud.add.text(640, Y + 58, '仅四圣兽（玄武/白虎/朱雀/青龙）可收服助守家 · 麒麟/项羽/刑天纯刷神装与神器（不守家） · 固定高难不膨胀 · Y / Esc 关闭', stText(12, '#9ff0b8')).setOrigin(0.5);
    const body = hud.add.container(0, 0);
    const close = makeButton(hud, X + PW - 34, Y + 28, 40, 36, '×', () => hud.closePanel(), { size: 24, font: BF });
    c.add([dim, bg, title, sub, body, close]);
    const self = { c, sig: '' };

    function rebuild() {
      body.removeAll(true);
      const sim = hud.sim;
      const R = sim.realms;
      if (!R) return;
      sub.setText('仅四圣兽（玄武/白虎/朱雀/青龙）可收服助守家 · 麒麟/项羽/刑天纯刷神装与神器（不守家） · 固定高难不膨胀 · Y / Esc 关闭');
      const cols = 2;
      const cardW = 474;
      const cardH = 106;
      const gapX = 20;
      const gapY = 12;
      const startX = X + 26;
      const startY = Y + 82;

      ALL_REALMS.forEach((r, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cx = startX + col * (cardW + gapX);
        const cy = startY + row * (cardH + gapY);
        const rd = RD.realms[r.id] || {};
        const info = realmStatus(sim, r);
        const clears = R.clearCount[r.id] || 0;
        const ad = R.getAdaptiveInfo ? R.getAdaptiveInfo(r.id) : null;
        const g = hud.add.graphics();
        g.fillStyle(0x161c3d, 0.95).fillRoundedRect(cx, cy, cardW, cardH, 11);
        g.lineStyle(2.5, info.canEnter ? r.color : 0x384070, 0.92).strokeRoundedRect(cx, cy, cardW, cardH, 11);
        const badgeCol = info.fg;
        const nm = hud.add.text(cx + 16, cy + 7, r.name, stText(18, '#ffd36a', TF, { strokeThickness: 4 }));
        const stTag = hud.add.text(cx + cardW - 16, cy + 9, `${info.panelTxt || info.txt}${clears > 0 ? ` · 已通${clears}次` : ''}`, stText(12, badgeCol, BF, { fontStyle: 'bold' })).setOrigin(1, 0);

        const openDesc = !r.hidden && (rd.open || 0) <= 0 ? '不限波数·已开放' : (r.hidden ? `清${RD.hiddenNeed}秘境开启` : `第${rd.open}波开放`);
        const tierMul = ad?.tierMul ?? rd.tierMul ?? 1;
        const bossHp = ad?.bossHp ?? rd.boss?.hp ?? 0;
        const bossAtk = ad?.bossAtk ?? rd.boss?.atk ?? 0;
        const diffDesc = `固定高难 ${tierMul}×（BOSS ${bossHp}血/${bossAtk}攻）`;
        const rec = hud.add.text(cx + 16, cy + 30, `${openDesc}  ·  ${diffDesc}`, stText(11, '#7fe3ff'));

        const qLabel = qName(ad?.minQ ?? rd.minQ ?? 1);
        const fixedCopper = ad?.copper ?? rd.copper ?? 120;
        const fixedXp = ad?.xp ?? rd.xp ?? 0;
        const eqCount = ad?.equipCount ?? rd.equipCount ?? 2;
        const canTame = rd.tameable !== undefined ? !!rd.tameable : ['xuanwu', 'baihu', 'zhuque', 'qinglong'].includes(r.id);
        const tomeNote = ad?.bonusTomes ? ` + 成长书×${ad.bonusTomes}` : '';
        const xpNote = fixedXp ? ` + ${fixedXp}经验` : '';
        const lootLead = R.firstCleared[r.id]
          ? '重刷'
          : (canTame ? '首通(收服助守家)' : '首通(神装+1)');
        const lootNote = hud.add.text(cx + 16, cy + 47,
          `${lootLead}：${rd.setName} ${qLabel}+ ×${eqCount} + ${fixedCopper}钱${xpNote}${tomeNote}`,
          stText(11, R.firstCleared[r.id] ? '#9ff0b8' : '#ffc977'));
        const roleDesc = canTame
          ? '四圣兽·首通助守家'
          : `纯刷神装/神器(${Math.round((rd.artifactChance || 0.3) * 100)}%神器·不守家)`;
        const recSub = hud.add.text(
          cx + 16, cy + 76,
          `${roleDesc} · ${rd.recPower || ''} · 冷却${rd.respawnSec || 35}s`,
          stText(10, canTame ? '#9ff0b8' : '#f5c28b', BF),
        );

        const btnLabel = !info.canEnter
          ? (info.code === 'cd' ? `冷却 ${info.txt}` : '未开放')
          : info.code === 'repeat'
            ? '再次挑战 →'
            : (r.portal || r.hidden ? '传送进入 →' : '前往入口 →');
        const btn = makeButton(hud, cx + cardW - 66, cy + 82, 114, 28, btnLabel, () => enterOrGuideRealm(hud, r), {
          size: 12, font: BF, primary: info.canEnter,
        });
        body.add([g, nm, stTag, rec, lootNote, recSub, btn]);
      });

      // 第 8 格位置：快捷「返回灯坛」与「镜像试炼」入口
      const exX = startX + 1 * (cardW + gapX);
      const exY = startY + 3 * (cardH + gapY);
      const eg = hud.add.graphics();
      eg.fillStyle(0x21173b, 0.95).fillRoundedRect(exX, exY, cardW, cardH, 11);
      eg.lineStyle(2.5, 0xc47bff, 0.92).strokeRoundedRect(exX, exY, cardW, cardH, 11);
      const M = sim.mirror;
      const mBonus = M ? M.totalPowerBonus : 0;
      const mTitle = hud.add.text(exX + 16, exY + 12, `心魔镜像试炼（已获战力 +${mBonus} / 30000）`, stText(17, '#e2b8ff', TF, { strokeThickness: 4 }));
      const mDesc = hud.add.text(exX + 16, exY + 40, '挑战 2倍 / 5倍 / 10倍 自身镜像，三阶累计永久暴涨 30,000 战力！', stText(12, '#d8d2f5'));
      const mBtn = makeButton(hud, exX + 104, exY + 78, 170, 32, '开启下一阶镜像 →', () => { hud.closePanel(); hud.startNextMirror(); }, { size: 13, font: BF, primary: true });
      const bBtn = makeButton(hud, exX + 292, exY + 78, 150, 32, '进入BOSS房 →', () => { hud.closePanel(); hud.toggleBossRoom(); }, { size: 13, font: BF });
      body.add([eg, mTitle, mDesc, mBtn, bBtn]);
    }

    self.refresh = () => {
      const sim = hud.sim;
      const R = sim.realms;
      if (!R) return;
      const sig = `${ALL_REALMS.map((r) => `${R.state[r.id]}:${Math.ceil(R.cooldownLeft(r.id))}:${R.clearCount[r.id]}`).join()}|${sim.mirror?.totalPowerBonus || 0}|${sim.wave.n}|${sim.hero?.lv || 1}`;
      if (sig !== self.sig) { self.sig = sig; rebuild(); }
    };
    self.open = () => { self.sig = ''; self.refresh(); };
    return self;
  },
};

export default widget;
export { realmsPanel };
