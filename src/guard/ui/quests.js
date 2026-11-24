// 孔明军令：T 打开结构化卡片面板（含分步「做法」与一键「前往执行」）；
// 常驻追踪小部件（右侧 x 1050–1266、y 344–548，不挡小地图与秘境状态区），每条均支持一键「指引→」。
import { TF, BF, NF, INK } from '../../fonts.js';
import { makeButton, drawPanel } from '../../widgets.js';
import { rewardText } from '../sim/systems/quests.js';
import { REALMS, HIDDEN, gateCenter } from '../sim/map.js';
import { canReach } from '../sim/systems/buildings.js';
import { touch } from '../../touch.js';

const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({ fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 3, ...extra });

export function wavesLeft(sim, q) {
  if (q.type === 'kmGuard') return '本波';
  return `剩 ${Math.max(0, q.deadline - sim.wave.n + 1)} 波`;
}

function isUrgent(sim, q) {
  if (q.type === 'kmGuard') return true;
  return Math.max(0, q.deadline - sim.wave.n + 1) <= 1;
}

function kmLossPct(sim, q) {
  return (sim.stats.kmDmgTaken - q.kmStart) / Math.max(1, sim.kongming.maxHp);
}

function progShort(sim, q) {
  if (q.type === 'kmGuard') return `${Math.round(kmLossPct(sim, q) * 100)}%/${Math.round(q.pct * 100)}%`;
  return `${q.prog}/${q.need}`;
}

export function questHowTo(q) {
  switch (q.type) {
    case 'buildType': return '做法：走到任意空地基旁（或点「前往执行」自动寻路），建造对应防御塔';
    case 'build': return '做法：点击空地基或按 G 打开建造面板，建造防御建筑';
    case 'upgrade': return '做法：点击已有建筑或按 G，点击「升级」提升塔等级';
    case 'hire': return '做法：按 H 打开雇佣面板，花费铜钱招募守卫协助防守';
    case 'kill': return `做法：前往妖路迎击并消灭 ${q.enemyName || '指定妖物'}（支持巡攻自动索敌）`;
    case 'kmGuard': return '做法：守在孔明身边拦截妖物，本波内确保孔明掉血不超过上限';
    case 'realmEnter': return '做法：前往四角已开放的秘境门并走入门洞（注意主线不暂停）';
    case 'realmClear': return '做法：进入秘境击破守卫并收服神兽，清空整座秘境';
    case 'equipKm': return '做法：按 B 打开行囊，切到「孔明」页签并点击背包装备穿戴';
    case 'set': return '做法：按 B 打开行囊，为同一单位穿戴 2 件同名套装激活效果';
    default: return '做法：按军令目标在战场上推进即可自动完成';
  }
}

export function guideQuest(hud, q) {
  const s = hud.sim;
  const gg = hud.gg;
  const u = s.ctrl || s.hero;
  if (!q || !u) return;

  if (q.type === 'buildType' || q.type === 'build') {
    const empties = s.foundations.filter((f) => f.bid == null);
    if (!empties.length) { hud.toast('所有地基已建满，可拆除后重建', '#ff8a7a'); return; }
    empties.sort((a, b) => ((a.x - u.x) ** 2 + (a.y - u.y) ** 2) - ((b.x - u.x) ** 2 + (b.y - u.y) ** 2));
    const f = empties[0];
    if (canReach(s, f)) {
      hud.closePanel();
      hud.togglePanel('build', f);
      hud.toast('已定位最近空地基，选择建筑即可建造', '#ffc977');
    } else {
      hud.closePanel();
      gg.cmd({ type: 'buildMove', fid: f.id });
      gg.setQuestGuide?.(f.x, f.y, q.name, false);
      hud.toast('英雄正前往空地基，到达后自动打开建造面板', '#ffc977');
    }
    return;
  }

  if (q.type === 'upgrade') {
    const b = s.buildings.find((x) => x.alive && x.lv < 3);
    if (!b) { hud.toast('请先建造一座防御建筑', '#ff8a7a'); return; }
    const f = s.foundations.find((x) => x.id === b.fid);
    hud.closePanel();
    if (f) hud.togglePanel('build', f);
    hud.toast('已定位可升级建筑，点击「升级」完成军令', '#ffc977');
    return;
  }

  if (q.type === 'hire') {
    hud.closePanel();
    hud.togglePanel('hire');
    hud.toast('在雇佣面板点击招募守卫即可完成军令', '#7fe3ff');
    return;
  }

  if (q.type === 'equipKm') {
    hud.closePanel();
    hud.togglePanel('bag', s.kongming.id);
    hud.toast('已切至「孔明」页签，点击右侧装备为丞相穿戴', '#ffc977');
    return;
  }

  if (q.type === 'set') {
    hud.closePanel();
    hud.togglePanel('bag');
    hud.toast('为同一单位穿戴 2 件同名套装即可激活', '#ffc977');
    return;
  }

  if (q.type === 'realmEnter' || q.type === 'realmClear') {
    const R = s.realms;
    const open = [...REALMS, HIDDEN].find((r) => R && (R.state[r.id] === 'open' || R.state[r.id] === 'active') && (!r.hidden || R.hiddenOpen));
    if (!open) { hud.toast('当前暂无开放秘境，请先守住当前波次', '#9aa3cf'); return; }
    const [gx, gy] = open.hidden ? R.portal.entry : gateCenter(open);
    hud.closePanel();
    gg.setQuestGuide?.(gx, gy, open.name, true);
    hud.toast(`正前往 ${open.name}（主线不会暂停，留意孔明血量）`, '#7fe3ff');
    return;
  }

  if (q.type === 'kmGuard') {
    hud.closePanel();
    gg.cmd({ type: 'rallyKongming' });
    gg.addOrderRipple?.(s.kongming.x, s.kongming.y + 130, 0x5fe08a, 'move');
    hud.toast('已下令回防孔明身边，拦截靠近妖物', '#5fe08a');
    return;
  }

  if (q.type === 'kill') {
    const tgt = s.enemies.find((e) => e.alive && !e.realm && e.type === q.enemy) || s.enemies.find((e) => e.alive && !e.realm);
    hud.closePanel();
    if (tgt) {
      gg.cmd({ type: 'attackMove', x: tgt.x, y: tgt.y });
      gg.setQuestGuide?.(tgt.x, tgt.y, q.enemyName || '目标妖物', false);
      hud.toast(`已下令巡攻迎击 ${q.enemyName || '妖物'}！`, '#ff8a7a');
    } else {
      gg.cmd({ type: 'rallyKongming' });
      hud.toast('当前场上暂无目标妖物，先守候孔明或按 N 提前召唤', '#9aa3cf');
    }
  }
}

const panel = {
  name: 'quests',
  key: 't',
  create(hud) {
    const X0 = 180; const Y0 = 78; const W = 920; const H = 564;
    const c = hud.add.container(0, 0);
    const bg = drawPanel(hud.add.graphics(), X0, Y0, W, H, { glow: 0x7fe3ff });
    const title = hud.add.text(640, Y0 + 26, '孔明军令 · 强盗吕达 · 猎人任务', st(26, '#ffc977', TF, { strokeThickness: 6 })).setOrigin(0.5);
    const sub = hud.add.text(640, Y0 + 54, '左上强盗营寨与西南猎人任务均可无限重复刷取铜钱、装备与永久书卷 · 点「前往」自动寻路 · T / Esc 关闭', st(12, '#9aa3cf')).setOrigin(0.5);
    const body = hud.add.container(0, 0);
    const close = makeButton(hud, X0 + W - 34, Y0 + 28, 40, 36, '×', () => hud.closePanel(), { size: 24, font: BF });
    c.add([bg, title, sub, body, close]);
    const self = { c, sig: '' };

    function rebuild() {
      body.removeAll(true);
      const s = hud.sim;
      const Q = s.quests;
      if (!Q) return;

      // 顶部并排：经典可重复支线（左：讨伐左上角吕达；右：西南猎人任务）
      const cardW = (W - 72) / 2;
      const cardY = Y0 + 74;
      const cardH = 104;
      const B = s.bandits;
      if (B) {
        const bx = X0 + 26;
        const g1 = hud.add.graphics();
        g1.fillStyle(0x28161a, 0.94).fillRoundedRect(bx, cardY, cardW, cardH, 11);
        g1.lineStyle(2.5, 0xff7a3a, 0.92).strokeRoundedRect(bx, cardY, cardW, cardH, 11);
        const stTxt = B.state === 'alive' ? `已现身（已讨伐 ${B.clears} 次）` : `重生中 ${Math.ceil(B.cooldownLeft())}s`;
        const t1 = hud.add.text(bx + 14, cardY + 10, '【强盗任务】讨伐左上角·吕达', st(15, '#ff9a5a', BF, { fontStyle: 'bold' }));
        const s1 = hud.add.text(bx + cardW - 14, cardY + 12, stTxt, st(12, B.state === 'alive' ? '#ffd36a' : '#9aa3cf', BF, { fontStyle: 'bold' })).setOrigin(1, 0);
        const d1 = hud.add.text(bx + 14, cardY + 36, '攻破左上角敌方箭塔与山贼营寨，斩杀头目吕达（可重复）', st(12, '#d8d2f5'));
        const r1 = hud.add.text(bx + 14, cardY + 60, `奖励：${B.cfg.reward.copper}+ 铜钱 + 装备×2 + 成长书卷`, st(12, '#ffd36a'));
        const b1 = makeButton(hud, bx + cardW - 76, cardY + 76, 134, 34, '前往讨伐吕达 →', () => { hud.closePanel(); hud.guideBanditQuest(); }, { size: 13, font: BF, primary: true });
        body.add([g1, t1, s1, d1, r1, b1]);
      }
      const Hn = s.hunter;
      if (Hn) {
        const hx = X0 + 26 + cardW + 20;
        const g2 = hud.add.graphics();
        g2.fillStyle(0x13281e, 0.94).fillRoundedRect(hx, cardY, cardW, cardH, 11);
        g2.lineStyle(2.5, 0x5fe08a, 0.92).strokeRoundedRect(hx, cardY, cardW, cardH, 11);
        const t2 = hud.add.text(hx + 14, cardY + 10, '【猎人任务】狩猎西南野狼', st(15, '#9ff0b8', BF, { fontStyle: 'bold' }));
        const s2 = hud.add.text(hx + cardW - 14, cardY + 12, `${Hn.prog}/${Hn.need}（已完成 ${Hn.clears} 轮）`, st(12, '#7fe3ff', BF, { fontStyle: 'bold' })).setOrigin(1, 0);
        const d2 = hud.add.text(hx + 14, cardY + 36, `受${Hn.npc.name}委托狩猎苍原野狼，满 ${Hn.need} 只自动交差`, st(12, '#d8d2f5'));
        const r2 = hud.add.text(hx + 14, cardY + 60, `奖励：${Hn.cfg.reward.copper}+ 铜钱 + 永久属性书 + 装备`, st(12, '#ffd36a'));
        const b2 = makeButton(hud, hx + cardW - 76, cardY + 76, 134, 34, '前往猎人营地 →', () => { hud.closePanel(); hud.guideHunterQuest(); }, { size: 13, font: BF, primary: true });
        body.add([g2, t2, s2, d2, r2, b2]);
      }

      const qTop = cardY + cardH + 14;
      if (!Q.active.length) {
        const eg = hud.add.graphics();
        eg.fillStyle(0x161b3e, 0.85).fillRoundedRect(X0 + 26, qTop, W - 52, 92, 12).lineStyle(2, 0x343c70).strokeRoundedRect(X0 + 26, qTop, W - 52, 92, 12);
        const nextWave = s.wave.n + (s.wave.n % 2 === 0 ? 1 : 2);
        const et = hud.add.text(640, qTop + 32, '当前孔明军令已全部完成', st(17, '#ffc977', BF, { fontStyle: 'bold' })).setOrigin(0.5);
        const es = hud.add.text(640, qTop + 62, `下一道军令预计于第 ${Math.max(3, nextWave)} 波颁布，可先刷上方强盗/猎人任务！`, st(13, '#9aa3cf')).setOrigin(0.5);
        body.add([eg, et, es]);
      } else {
        Q.active.forEach((q, i) => {
          const cy = qTop + i * 114;
          const ch = 104;
          const cw = W - 52;
          const cx = X0 + 26;
          const urg = isUrgent(s, q);
          const cg = hud.add.graphics();
          cg.fillStyle(0x181e46, 0.92).fillRoundedRect(cx, cy, cw, ch, 12);
          cg.lineStyle(2.5, urg ? 0xff7a5a : 0x5c72c8).strokeRoundedRect(cx, cy, cw, ch, 12);
          const nm = hud.add.text(cx + 16, cy + 10, `【军令·${q.name}】 ${q.desc}`, st(15, '#ffc977', BF, { fontStyle: 'bold' }));
          const lf = hud.add.text(cx + cw - 16, cy + 12, urg ? `⚠ ${wavesLeft(s, q)}` : wavesLeft(s, q), st(13, urg ? '#ff7a6a' : '#7fe3ff', BF, { fontStyle: 'bold' })).setOrigin(1, 0);
          const how = hud.add.text(cx + 16, cy + 36, questHowTo(q), st(12, '#d8d2f5', BF, { wordWrap: { width: cw - 170, useAdvancedWrap: true } }));
          let k = q.type === 'kmGuard' ? Math.max(0, 1 - kmLossPct(s, q) / q.pct) : q.prog / Math.max(1, q.need);
          const bx = cx + 16; const by = cy + 64; const bw = 220;
          cg.fillStyle(0x0f122a).fillRoundedRect(bx, by, bw, 9, 5);
          cg.fillStyle(q.type === 'kmGuard' ? 0x5fe08a : 0x7fe3ff).fillRoundedRect(bx, by, Math.max(6, bw * Math.min(1, k)), 9, 5);
          const pt = hud.add.text(bx + bw + 10, by - 3, progShort(s, q), st(12, '#ffffff', NF, { fontStyle: 'bold' }));
          const rw = hud.add.text(cx + 16, cy + 80, `奖励：${rewardText(q.reward)}`, st(12, '#ffd36a'));
          const goBtn = makeButton(hud, cx + cw - 76, cy + 68, 124, 34, '前往执行 →', () => guideQuest(hud, q), { size: 14, primary: true, font: BF });
          body.add([cg, nm, lf, how, pt, rw, goBtn]);
        });
      }

      // 底部：历史战绩（定高防溢出，最多 3 条）
      const hy = Y0 + 428;
      const hh = 116;
      const hg = hud.add.graphics();
      hg.fillStyle(0x121634, 0.85).fillRoundedRect(X0 + 26, hy, W - 52, hh, 10).lineStyle(2, 0x2e3566).strokeRoundedRect(X0 + 26, hy, W - 52, hh, 10);
      const hTitle = hud.add.text(X0 + 42, hy + 10, `历史军令：已完成 ${Q.done} 道   失败 ${Q.failed || 0} 道   讨伐吕达 ${B?.clears || 0} 次   猎人 ${Hn?.clears || 0} 轮`, st(13, '#ffc977', BF, { fontStyle: 'bold' }));
      body.add([hg, hTitle]);
      const hist = Q.history.slice(0, 3);
      if (!hist.length) {
        body.add(hud.add.text(X0 + 42, hy + 46, '完成开局「筑箭楼」或讨伐左上角吕达即可获得丰厚铜钱、卧龙装备与成长书卷！', st(13, '#8d96c4')));
      } else {
        hist.forEach((q, idx) => {
          const ok = q.state === 'done';
          const line = `${ok ? '✔' : '✘'} 第 ${q.endWave} 波  ${q.name}${ok && q.got?.length ? `  获得：${q.got.join(' + ')}` : '  （已过期）'}`;
          body.add(hud.add.text(X0 + 42, hy + 36 + idx * 22, line, st(12, ok ? '#9ff0b8' : '#ff8a7a', BF)));
        });
      }
    }

    self.refresh = () => {
      const s = hud.sim;
      const Q = s.quests;
      if (!Q) return;
      const bSig = s.bandits ? `${s.bandits.state}:${s.bandits.clears}:${Math.ceil(s.bandits.cooldownLeft())}` : '';
      const hSig = s.hunter ? `${s.hunter.prog}:${s.hunter.clears}` : '';
      const sig = `${s.wave.n}|${Q.done}|${Q.failed}|${bSig}|${hSig}|${Q.active.map((q) => `${q.id}:${q.prog}:${q.type === 'kmGuard' ? Math.round(kmLossPct(s, q) * 100) : 0}`).join(',')}`;
      if (sig !== self.sig) { self.sig = sig; rebuild(); }
    };
    self.open = () => { self.sig = ''; self.refresh(); };
    return self;
  },
};

// 常驻任务追踪（右侧 x 1050–1266、y 336–464，底边严格 ≤ 466，与下方 R 键 475 留出净空）
const tracker = {
  name: 'questTracker',
  always: true,
  create(hud) {
    const X = 1050; const Y = 336; const W = 216;
    const c = hud.add.container(0, 0);
    if (touch.enabled) {
      c.setVisible(false);
      return { c, refresh() {} };
    }
    const g = hud.add.graphics();
    const head = hud.add.text(X + 10, Y + 5, '任务/悬赏 [T]', st(13, '#ffc977', TF, { strokeThickness: 3 }));
    const openTip = hud.add.text(X + W - 8, Y + 7, '详情▸', st(11, '#7fe3ff', BF, { strokeThickness: 2 })).setOrigin(1, 0);
    const headHit = hud.add.rectangle(X + W / 2, Y + 14, W, 24, 0, 0.001).setInteractive({ useHandCursor: true });
    headHit.on('pointerdown', () => hud.togglePanel('quests'));

    // 常驻双捷径按钮：讨伐吕达 + 猎人任务
    const lvdaBtn = makeButton(hud, X + 56, Y + 38, 96, 22, '伐吕达→', () => hud.guideBanditQuest(), { size: 11, font: BF, primary: true });
    const huntBtn = makeButton(hud, X + 160, Y + 38, 96, 22, '猎人0/6', () => hud.guideHunterQuest(), { size: 11, font: BF });

    const slots = [0, 1].map((i) => {
      const y = Y + 54 + i * 36;
      const name = hud.add.text(X + 8, y, '', st(11, '#f3e6c8', BF, { fontStyle: 'bold' }));
      const prog = hud.add.text(X + W - 56, y + 1, '', st(10, '#7fe3ff', NF, { fontStyle: 'bold' })).setOrigin(1, 0);
      const rew = hud.add.text(X + 8, y + 16, '', st(10, '#ffd36a', BF));
      const btnBg = hud.add.graphics();
      const btnTxt = hud.add.text(X + W - 26, y + 16, '指引→', st(10, '#141a33', BF, { strokeThickness: 0, fontStyle: 'bold' })).setOrigin(0.5);
      const btnHit = hud.add.rectangle(X + W - 26, y + 16, 46, 20, 0, 0.001).setInteractive({ useHandCursor: true });
      btnHit.on('pointerdown', () => {
        const q = hud.sim.quests?.active?.[i];
        if (q) guideQuest(hud, q);
      });
      return { y, name, prog, rew, btnBg, btnTxt, btnHit };
    });
    const empty = hud.add.text(X + W / 2, Y + 72, '军令已完成（可刷吕达/猎人）', st(11, '#7f86b8')).setOrigin(0.5);
    c.add([g, head, openTip, headHit, lvdaBtn, huntBtn, empty]);
    for (const sl of slots) c.add([sl.name, sl.prog, sl.rew, sl.btnBg, sl.btnTxt, sl.btnHit]);
    const set = (t, v) => { if (t.text !== v) t.setText(v); };

    return {
      c,
      refresh() {
        const s = hud.sim;
        const Q = s.quests;
        g.clear();
        if (!Q) { c.setVisible(false); return; }
        const n = Q.active.length;
        const h = n ? 56 + n * 36 : 92;
        g.fillStyle(0x0f1128, 0.82).fillRoundedRect(X, Y, W, h, 10).lineStyle(2, 0x343c70).strokeRoundedRect(X, Y, W, h, 10);
        if (s.bandits) {
          const lb = s.bandits.state === 'alive' ? '伐吕达→' : `吕达${Math.ceil(s.bandits.cooldownLeft())}s`;
          if (lvdaBtn.label.text !== lb) lvdaBtn.setLabel(lb);
        }
        if (s.hunter) {
          const hb = `猎人${s.hunter.prog}/${s.hunter.need}`;
          if (huntBtn.label.text !== hb) huntBtn.setLabel(hb);
        }
        empty.setVisible(n === 0);
        slots.forEach((sl, i) => {
          const q = Q.active[i];
          const vis = !!q;
          for (const t of [sl.name, sl.prog, sl.rew, sl.btnBg, sl.btnTxt, sl.btnHit]) t.setVisible(vis);
          sl.btnBg.clear();
          if (!q) return;
          set(sl.name, q.name);
          set(sl.prog, progShort(s, q));
          const rStr = rewardText(q.reward);
          set(sl.rew, rStr.length > 13 ? `${rStr.slice(0, 12)}…` : rStr);
          sl.btnBg.fillStyle(0xffc977).fillRoundedRect(X + W - 49, sl.y + 6, 46, 20, 5);
          sl.btnBg.lineStyle(1.5, 0x0b0d18).strokeRoundedRect(X + W - 49, sl.y + 6, 46, 20, 5);
        });
      },
    };
  },
};

export default panel;
export { tracker };
