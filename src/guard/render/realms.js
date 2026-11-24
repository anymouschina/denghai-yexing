// M4 秘境渲染：门上封印/开放/交战/已收服状态、隐藏秘境传送门（入口与出口）、神兽 BOSS 光效、收服揭晓特效。
import BAL from '../data/balance.json' with { type: 'json' };
import RD from '../data/realms.json' with { type: 'json' };
import { REALMS, gateCenter } from '../sim/map.js';
import { registerLayer } from './index.js';
import { registerFx } from './fx.js';
import { sfx } from '../../audio.js';

const H = BAL.hiddenRealm;
const KAI = '"Ma Shan Zheng", "STKaiti", serif';
const INK = '#0b0d18';
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const LABEL = {
  locked: (id) => `封印 · 第 ${RD.realms[id].open} 波开放`,
  open: () => '可进入',
  active: () => '交战中 · 主线仍在推进',
  cleared: (id) => {
    const rd = RD.realms[id];
    const nm = rd.boss.name.replace('神兽·', '');
    const canTame = rd.tameable !== undefined ? !!rd.tameable : ['xuanwu', 'baihu', 'zhuque', 'qinglong'].includes(id);
    return canTame ? `已收服 ${nm}` : `已击破 ${nm}`;
  },
};
const LABEL_COLOR = { locked: '#ff8a7a', open: '#7fe3ff', active: '#ffb35a', cleared: '#ffd36a' };

function setup(sc, sim) {
  const g = sc.add.graphics().setDepth(-9550);
  const top = sc.add.graphics().setDepth(9050);
  const gates = {};
  for (const r of REALMS) {
    const [gx, gy] = gateCenter(r);
    const t = sc.add.text(gx, gy - 150, '', { fontFamily: KAI, fontSize: '26px', color: '#ffffff', stroke: INK, strokeThickness: 6 }).setOrigin(0.5).setDepth(9000);
    gates[r.id] = { x: gx, y: gy, t, st: null };
  }
  const mkPortal = (x, y, label) => {
    const glow = sc.add.image(x, y - 60, 'glow').setTint(0xffc94a).setBlendMode('ADD').setScale(5).setAlpha(0).setDepth(y + 1);
    const img = sc.add.image(x, y + 30, 'g_realm_gate').setOrigin(0.5, 1).setScale(0.55).setTint(0xffe2a0).setDepth(y + 30).setVisible(false);
    const t = sc.add.text(x, y - 170, label, { fontFamily: KAI, fontSize: '24px', color: '#ffd36a', stroke: INK, strokeThickness: 6 }).setOrigin(0.5).setDepth(9000).setVisible(false);
    return { x, y, glow, img, t };
  };
  const portals = [mkPortal(H.entry[0], H.entry[1], '传送门 · 麒麟·中宫'), mkPortal(H.exit[0], H.exit[1], '回灯坛')];
  return { sim, g, top, gates, portals, shown: false };
}

function frame(sc, sim, inView) {
  if (!sim.realms) return;
  let V = sc.__realmVis;
  if (!V || V.sim !== sim || !V.g.scene) V = sc.__realmVis = setup(sc, sim);
  const R = sim.realms;
  const t = sim.t;
  const g = V.g.clear();
  const top = V.top.clear();
  // 门：封印 / 开放 / 交战 / 已收服
  for (const r of REALMS) {
    const G = V.gates[r.id];
    const st = R.state[r.id];
    if (G.st !== st) {
      G.st = st;
      G.t.setText(LABEL[st](r.id)).setColor(LABEL_COLOR[st]);
      const gg = sc.gates && sc.gates[r.id];
      if (gg) {
        const tint = st === 'locked' ? 0x7a3a48 : st === 'cleared' ? 0xffd36a : st === 'active' ? 0xff7a3a : r.color;
        gg.glow.setTint(tint);
        gg.img.setTint(st === 'locked' ? 0x8a7d9a : 0xffffff);
      }
    }
    if (!inView({ x: G.x, y: G.y, r: 400 })) continue;
    if (st === 'locked') {
      // 封印：门洞上的红色符阵 + 两道锁链
      const a = 0.5 + Math.sin(t * 3) * 0.15;
      g.lineStyle(4, 0xe0463a, a).strokeEllipse(G.x, G.y, 200, 92);
      g.lineStyle(2, 0xff8a7a, a * 0.8).strokeEllipse(G.x, G.y, 150, 66);
      for (let i = 0; i < 6; i++) {
        const k = t * 0.8 + (i * Math.PI) / 3;
        g.fillStyle(0xff5a4a, a).fillRect(G.x + Math.cos(k) * 88 - 4, G.y + Math.sin(k) * 40 - 4, 8, 8);
      }
      g.lineStyle(5, 0xa01414, 0.7);
      g.lineBetween(G.x - 90, G.y - 40, G.x + 90, G.y + 40);
      g.lineBetween(G.x - 90, G.y + 40, G.x + 90, G.y - 40);
    } else if (st === 'open') {
      const k = (t * 0.7) % 1;
      g.lineStyle(3, r.color, 0.8 * (1 - k)).strokeEllipse(G.x, G.y, 120 + 120 * k, 56 + 56 * k);
      g.fillStyle(r.color, 0.12).fillEllipse(G.x, G.y, 200, 92);
    } else if (st === 'active') {
      g.lineStyle(4, 0xff7a3a, 0.5 + Math.sin(t * 8) * 0.3).strokeEllipse(G.x, G.y, 210, 96);
    } else {
      g.fillStyle(0xffd36a, 0.14 + Math.sin(t * 2) * 0.05).fillEllipse(G.x, G.y, 210, 96);
    }
    G.t.setScale(st === 'active' ? 1 + Math.sin(t * 6) * 0.04 : 1);
  }
  // 隐藏秘境传送门
  if (R.hiddenOpen) {
    for (const P of V.portals) {
      if (!V.shown) { P.img.setVisible(true); P.t.setVisible(true); sc.tweens.add({ targets: P.glow, alpha: { from: 0, to: 0.75 }, duration: 900 }); }
      if (!inView({ x: P.x, y: P.y, r: 300 })) continue;
      P.glow.setScale(5 + Math.sin(t * 3) * 0.4);
      const rr = R.portal.r;
      const k = (t * 0.9) % 1;
      g.fillStyle(0xffc94a, 0.18).fillEllipse(P.x, P.y, rr * 2, rr);
      g.lineStyle(3, 0xffe2a0, 0.9).strokeEllipse(P.x, P.y, rr * 2, rr);
      g.lineStyle(2, 0xffc94a, 0.8 * (1 - k)).strokeEllipse(P.x, P.y, rr * 2 * (1 - k * 0.7), rr * (1 - k * 0.7));
      for (let i = 0; i < 4; i++) {
        const a = t * 2 + (i * Math.PI) / 2;
        top.fillStyle(0xffe2a0, 0.8).fillCircle(P.x + Math.cos(a) * rr, P.y - 60 + Math.sin(a) * rr * 0.5 - 40 * ((t + i) % 1), 3);
      }
    }
    V.shown = true;
  }
  // 神兽 BOSS 光效：脚下秘境色光环 + 大招蓄力时变红
  for (const e of sim.enemies) {
    if (!e.alive || e.boss !== 'realm' || !inView(e)) continue;
    const c = e.castT > 0 ? 0xff5a3a : e.realmColor || 0xffc94a;
    const p = 1 + Math.sin(t * 5) * 0.08;
    g.fillStyle(c, 0.22).fillEllipse(e.x, e.y, e.r * 4.2 * p, e.r * 1.9 * p);
    g.lineStyle(4, c, 0.75).strokeEllipse(e.x, e.y, e.r * 4.6 * p, e.r * 2.1 * p);
    if (e.armorUp) top.lineStyle(3, 0x7fe3ff, 0.6).strokeEllipse(e.x, e.y - e.h * 0.45, e.r * 3.4, e.h * 0.9);
  }
}

registerLayer(frame);

// 收服揭晓：神兽化光冲天（光柱 + 金粒子 + 大字），或隐藏传送门浮现
registerFx('tame', (sc, f) => {
  const col = f.color || 0xffd36a;
  const pillar = sc.add.image(f.x, f.y, 'glow').setOrigin(0.5, 1).setTint(col).setBlendMode('ADD').setScale(2.2, 0.2).setAlpha(0.95).setDepth(9200);
  sc.tweens.add({ targets: pillar, scaleY: 14, duration: 380, ease: 'Cubic.easeOut' });
  sc.tweens.add({ targets: pillar, alpha: 0, scaleX: 4, delay: 900, duration: 700, onComplete: () => pillar.destroy() });
  const core = sc.add.image(f.x, f.y - 40, 'glow').setTint(0xffffff).setBlendMode('ADD').setScale(1).setAlpha(1).setDepth(9201);
  sc.tweens.add({ targets: core, scale: 7, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => core.destroy() });
  if (sc.pGold) { sc.pGold.explode(70, f.x, f.y - 60); sc.time.delayedCall(250, () => sc.pGold.explode(40, f.x, f.y - 160)); }
  if (!f.portal) {
    const tex = `g_beast_${f.key}`;
    if (sc.textures.exists(tex)) {
      const ghost = sc.add.image(f.x, f.y, tex).setOrigin(0.5, 0.95).setScale(0.5).setTint(0xffe2a0).setBlendMode('ADD').setDepth(9202);
      sc.tweens.add({ targets: ghost, y: f.y - 260, alpha: 0, scale: 0.7, duration: 1300, ease: 'Sine.easeIn', onComplete: () => ghost.destroy() });
    }
    if (sc.floatText) sc.floatText(f.x, f.y - 220, `收服 ${f.name || ''}！`, hex(col === 0xd8d2c0 ? 0xffd36a : col), 40);
    sc.cameras.main.flash(260, 255, 220, 140);
  }
  sfx('levelup');
});

// 神兽现身：秘境色冲击环
registerFx('realmBoss', (sc, f) => {
  const ring = sc.add.image(f.x, f.y - 40, 'glow').setTint(f.color || 0xff5a3a).setBlendMode('ADD').setScale(1).setAlpha(0.9).setDepth(9100);
  sc.tweens.add({ targets: ring, scale: 10, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  sc.cameras.main.shake(300, 0.006);
  sfx('boom', 0.8);
});
