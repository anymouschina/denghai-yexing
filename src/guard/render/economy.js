// M5 经营渲染：建造/升级特效、灯柱治疗光圈、拒马反伤火花、操控单位靠近时可建地基高亮。
import { registerFx } from './fx.js';
import { registerLayer } from './index.js';
import { sfx } from '../../audio.js';
import BD from '../data/buildings.json' with { type: 'json' };
import { canReach } from '../sim/systems/buildings.js';
import { touch } from '../../touch.js';

registerFx('build', (sc, f) => {
  sc.pGold?.explode(f.up ? 26 : 18, f.x, f.y - 40);
  if (sc.add && sc.tweens) {
    const img = sc.add.image(f.x, f.y, 'glow').setTint(f.merc ? 0x7fe3ff : 0xffc977).setBlendMode('ADD').setDepth(9000).setScale(0.4).setAlpha(0.9);
    sc.tweens.add({ targets: img, scale: f.up ? 3.2 : 2.4, alpha: 0, duration: 520, ease: 'Cubic.easeOut', onComplete: () => { if (img && img.scene) img.destroy(); } });
  }
  sc.fxItems?.push({ k: 'ring', x: f.x, y: f.y, r: f.up ? 110 : 80, color: f.merc ? 0x7fe3ff : 0xffc977, life: 0.5, max: 0.5 });
  if (f.up) sc.floatText?.(f.x, f.y - 130, `Lv ${f.lv}`, '#ffd36a', 24);
  else if (f.merc) sc.floatText?.(f.x, f.y - 100, '应募！', '#7fe3ff', 20);
  sfx(f.up ? 'levelup' : 'chest', 0.5);
});

registerFx('thorns', (sc, f) => { sc.pSpark?.explode(6, f.x, f.y); });

registerFx('lampPulse', (sc, f) => {
  sc.fxItems?.push({ k: 'ring', x: f.x, y: f.y, r: f.r * 0.9, color: 0x5fe08a, life: 0.7, max: 0.7 });
  sc.pHeal?.explode(4, f.x, f.y - 60);
});

const R = BD.buildRange;

registerLayer((sc, sim, inView) => {
  let g = sc.__ecoG;
  if (!g || !g.scene) {
    g = sc.__ecoG = sc.add.graphics().setDepth(5);
    sc.__ecoTip = sc.add.text(0, 0, '', { fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif', fontSize: '15px', color: '#ffe7b0', stroke: '#0b0d18', strokeThickness: 4 }).setOrigin(0.5).setDepth(9500);
  }
  g.clear();
  const t = sim.t;
  // 灯柱常驻治疗范围（淡绿光圈，呼吸）
  for (const b of sim.buildings) {
    if (!b.alive || b.type !== 'lamp' || !inView(b)) continue;
    const r = b.def0.range;
    g.fillStyle(0x5fe08a, 0.05 + Math.sin(t * 2) * 0.02).fillEllipse(b.x, b.y, r * 2, r);
    g.lineStyle(2, 0x5fe08a, 0.35).strokeEllipse(b.x, b.y, r * 2, r);
  }
  // 操控单位附近的地基：空地基金色高亮 + 提示；已建的显示淡环
  const u = sim.ctrl;
  const tip = sc.__ecoTip;
  tip.setVisible(false);
  if (!u || !u.alive) return;
  let best = null;
  let bd = Infinity;
  for (const f of sim.foundations) {
    if (!inView(f)) continue;
    const d = (f.x - u.x) ** 2 + (f.y - u.y) ** 2;
    const near = canReach(sim, f); // 与 build 命令同一判定（含孔明身边可建内圈）
    if (!near && d > (R.unit * 1.8) ** 2) continue;
    if (f.bid == null) {
      const a = near ? 0.55 + Math.sin(t * 6) * 0.3 : 0.25;
      g.lineStyle(near ? 4 : 2, 0xffc977, a).strokeEllipse(f.x, f.y + 10, 130, 60);
      if (near) g.fillStyle(0xffc977, 0.1).fillEllipse(f.x, f.y + 10, 130, 60);
    } else if (near) g.lineStyle(2, 0x7fe3ff, 0.4).strokeEllipse(f.x, f.y + 10, 120, 56);
    if (near && d < bd) { bd = d; best = f; }
  }
  if (best) {
    const lbl = touch.enabled
      ? (best.bid == null ? '点击 建造' : '点击 升级')
      : (best.bid == null ? 'G / 点击 建造' : 'G / 点击 升级');
    tip.setVisible(true).setPosition(best.x, best.y + 48).setText(lbl);
  }
});
