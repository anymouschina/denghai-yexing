// M3 成长的世界层渲染：拾取飘字、套装激活光环爆发、八阵图、镇岳护盾，以及 4 件套单位脚下的常驻套装光环。
import { registerFx } from './fx.js';
import { registerLayer } from './index.js';
import { sfx } from '../../audio.js';
import { SET_IDS, setHex } from '../sim/systems/loot.js';

function burstRing(sc, x, y, color, r0, r1, dur, width = 6, depth = 9050) {
  const g = sc.add.graphics().setDepth(depth).setBlendMode('ADD');
  const o = { k: 0 };
  sc.tweens.add({
    targets: o, k: 1, duration: dur, ease: 'Cubic.easeOut',
    onUpdate: () => {
      const r = r0 + (r1 - r0) * o.k;
      g.clear().lineStyle(width * (1 - o.k) + 1, color, 1 - o.k).strokeEllipse(x, y, r * 2, r);
      g.fillStyle(color, 0.18 * (1 - o.k)).fillEllipse(x, y, r * 2, r);
    },
    onComplete: () => g.destroy(),
  });
}

registerFx('loot', (sc, f) => {
  sc.floatText(f.x, f.y - 70, f.text, f.color, f.q >= 3 ? 24 : 18);
  if (f.q >= 2) { sc.pGold.explode(f.q >= 4 ? 40 : f.q * 6, f.x, f.y - 30); sfx('levelup', 0.4); } else sfx('coin', 0.5);
});

registerFx('setAura', (sc, f) => {
  const u = sc.sim.byId(f.id);
  const x = u ? u.x : f.x; const y = u ? u.y : f.y;
  for (let i = 0; i < (f.pieces === 4 ? 3 : 2); i++) sc.time.delayedCall(i * 160, () => burstRing(sc, x, y, f.color, 30, f.pieces === 4 ? 260 : 170, 700, 10));
  sc.pGold.explode(f.pieces === 4 ? 50 : 24, x, y - 50);
  if (f.pieces === 4) sc.cameras.main.shake(180, 0.004);
  sfx('levelup', 0.8);
});

registerFx('bazhen', (sc, f) => {
  const g = sc.add.graphics().setDepth(9040).setBlendMode('ADD');
  const o = { k: 0 };
  sc.tweens.add({
    targets: o, k: 1, duration: 650, ease: 'Sine.easeOut',
    onUpdate: () => {
      g.clear();
      const a = 1 - o.k;
      const rot = o.k * 0.8;
      for (const rr of [f.r, f.r * 0.62]) {
        const pts = [];
        for (let i = 0; i < 8; i++) { const t = rot + (i / 8) * Math.PI * 2; pts.push({ x: f.x + Math.cos(t) * rr, y: f.y + Math.sin(t) * rr * 0.5 }); }
        g.lineStyle(4, 0xffc94a, a).strokePoints(pts, true);
      }
      for (let i = 0; i < 8; i++) { // 八卦爻线
        const t = rot + (i / 8) * Math.PI * 2;
        g.lineStyle(3, 0xfff0b0, a * 0.8).lineBetween(f.x + Math.cos(t) * f.r * 0.66, f.y + Math.sin(t) * f.r * 0.33, f.x + Math.cos(t) * f.r * 0.95, f.y + Math.sin(t) * f.r * 0.475);
      }
      g.fillStyle(0xffc94a, 0.16 * a).fillEllipse(f.x, f.y, f.r * 2, f.r);
    },
    onComplete: () => g.destroy(),
  });
  sc.floatText(f.x, f.y - 120, '八阵图', '#ffc94a', 24);
  sfx('thunder', 0.5);
});

registerFx('setShield', (sc, f) => {
  burstRing(sc, f.x, f.y, 0x5aa8d8, 20, 120, 500, 8);
  sc.floatText(f.x, f.y - 110, '镇岳护盾', '#9fd8ff', 22);
});

// 常驻：4 件套单位脚下的套装色光环；镇岳护盾存在时画一层护罩
let g = null;
registerLayer((sc, sim, inView) => {
  if (!g || !g.scene) g = sc.add.graphics().setDepth(8990);
  g.clear();
  if (!sim.inv) return;
  const pulse = 0.5 + 0.5 * Math.sin(sim.t * 4);
  for (const u of sim.units) {
    if (!u.alive || !inView(u)) continue;
    const t = sim.inv.tiers[u.id];
    if (!t) continue;
    let i = 0;
    for (const id of SET_IDS) {
      if (t[id] !== 4) continue;
      const c = setHex(id);
      const rx = u.r * (2.6 + i * 0.5);
      g.lineStyle(3, c, 0.5 + 0.3 * pulse).strokeEllipse(u.x, u.y, rx * 2, rx * 0.9);
      g.fillStyle(c, 0.05 + 0.04 * pulse).fillEllipse(u.x, u.y, rx * 2, rx * 0.9);
      i++;
    }
    if (u.shield > 0 && t.xuanwu === 4) {
      g.lineStyle(2, 0x9fd8ff, 0.7).strokeCircle(u.x, u.y - (u.h || 60) * 0.45, (u.h || 60) * 0.6);
      g.fillStyle(0x5aa8d8, 0.12).fillCircle(u.x, u.y - (u.h || 60) * 0.45, (u.h || 60) * 0.6);
    }
  }
});

