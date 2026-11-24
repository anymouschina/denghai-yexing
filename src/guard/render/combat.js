// 战斗表现：技能/BOSS/套装/练体/南华复合特效注册 + 高细节持续区域画法
import { registerFx } from './fx.js';
import { registerZoneVis } from './zones.js';
import { sfx } from '../../audio.js';
import {
  spawnBeamVfx,
  spawnConeVfx,
  spawnThunderVfx,
  spawnDropVfx,
  spawnUltShowcase,
  spawnIceBurst,
  guanyuSummon,
  lvbuSlash,
  bawangSlam,
  xingtianRoar,
  thornsRay,
  goldenNova,
  temperHit,
  temperBreak,
  nanhuaFx,
  nuwaRevive,
  donghuangSilence,
  fuxiHeal,
} from './vfx.js';

registerFx('beam', (sc, f) => { spawnBeamVfx(sc, f); });
registerFx('cone', (sc, f) => { spawnConeVfx(sc, f); sfx('boom', 0.3); });

// 天雷：落雷光柱 + 八卦阵环 + 中阶打击感
registerFx('thunder', (sc, f) => {
  spawnThunderVfx(sc, f);
  if (sc.feel) {
    sc.feel.feedback('medium', f, {
      trauma: 0.36,
      hitStop: 0.044,
      flash: { color: 0xbff4ff, alpha: 0.14, dur: 95 },
      particles: 0,
    });
  } else {
    sc.cameras.main.shake(100, 0.003);
  }
  sfx('thunder', 0.6);
});

// 落体（万符朝宗、焚天火雨）：高速尾迹下落 + 冲击波纹
registerFx('drop', (sc, f) => { spawnDropVfx(sc, f); });

// 英雄大招：八卦符阵 + 觉醒双环逆转 + 镜头脉冲 + 书法标题
registerFx('ult', (sc, f) => {
  spawnUltShowcase(sc, f);
  sfx('roar', 0.6);
});

// 冰霜爆发（玄霜寒霜环 / 冰墙 / 冰封千里）
registerFx('iceBurst', (sc, f) => { spawnIceBurst(sc, f); });

// v3.6 套装 / 挨打练体 / 南华仙人特效
registerFx('guanyuSummon', (sc, f) => { guanyuSummon(sc, f); sfx('levelup', 0.8); });
registerFx('lvbuSlash', (sc, f) => { lvbuSlash(sc, f); sfx('crit', 0.65); });
registerFx('bawangSlam', (sc, f) => { bawangSlam(sc, f); sfx('boom', 0.7); });
registerFx('xingtianRoar', (sc, f) => { xingtianRoar(sc, f); sfx('roar', 0.5); });
registerFx('thornsRay', (sc, f) => { thornsRay(sc, f); });
registerFx('goldenNova', (sc, f) => { goldenNova(sc, f); sfx('boom', 0.55); });
registerFx('temperHit', (sc, f) => { temperHit(sc, f); });
registerFx('temperBreak', (sc, f) => { temperBreak(sc, f); sfx('levelup', 0.85); });
registerFx('nanhuaFx', (sc, f) => { nanhuaFx(sc, f); sfx(f.big ? 'levelup' : 'chest', 0.7); });

// 上古神器（女娲石 / 东皇钟 / 伏羲琴）
registerFx('nuwaRevive', (sc, f) => { nuwaRevive(sc, f); sfx('levelup', 0.85); });
registerFx('donghuangSilence', (sc, f) => { donghuangSilence(sc, f); sfx('boom', 0.6); });
registerFx('fuxiHeal', (sc, f) => { fuxiHeal(sc, f); sfx('heal', 0.65); });

// ---------------- 持续区域（高精细几何图形） ----------------

// 狐火环：3 团环绕狐火 + 多层渐变弯曲火尾 + 轨道灵环
registerZoneVis('foxring', (g, z, s) => {
  g.lineStyle(2, 0xff7a30, 0.28).strokeEllipse(z.x, z.y, z.r * 2, z.r);
  g.lineStyle(1.5, 0xffd36a, 0.22).strokeEllipse(z.x, z.y - 36, z.r * 1.7, z.r * 0.84);
  for (let i = 0; i < 3; i++) {
    const a0 = s.t * 4.2 + (i * Math.PI * 2) / 3;
    // 多层渐变尾迹（从尾部暗红渐亮至火芯白金）
    for (let k = 6; k >= 1; k--) {
      const ta = a0 - k * 0.14;
      const tx = z.x + Math.cos(ta) * z.r * 0.85;
      const ty = z.y - 38 + Math.sin(ta) * z.r * 0.42 - k * 1.2;
      const frac = 1 - k / 7;
      const col = k > 4 ? 0xe0463a : k > 2 ? 0xff7a30 : 0xffb84d;
      g.fillStyle(col, 0.18 + frac * 0.42).fillCircle(tx, ty, 5 + frac * 11);
    }
    const hx = z.x + Math.cos(a0) * z.r * 0.85;
    const hy = z.y - 38 + Math.sin(a0) * z.r * 0.42;
    g.fillStyle(0xff7a30, 0.32).fillCircle(hx, hy, 22);
    g.fillStyle(0xffd36a, 0.88).fillCircle(hx, hy, 11);
    g.fillStyle(0xffffff, 0.95).fillCircle(hx, hy, 5);
  }
});

// 万符朝宗：旋转八卦符阵（八角外阵 + 八爻卦象 + 反向飞舞符箓）
const TRIGRAMS = [[1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 0, 1], [1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0]];
registerZoneVis('furain', (g, z, s) => {
  const pulse = Math.sin(s.t * 6);
  g.fillStyle(0xffd36a, 0.1 + pulse * 0.035).fillEllipse(z.x, z.y, z.r * 2, z.r);
  g.lineStyle(3, 0xffd36a, 0.72).strokeEllipse(z.x, z.y, z.r * 2, z.r);
  g.lineStyle(1.8, 0xffe9a8, 0.48).strokeEllipse(z.x, z.y, z.r * 1.48, z.r * 0.74);

  const rot = s.t * 0.95;
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4;
    pts.push({ x: z.x + Math.cos(a) * z.r * 0.94, y: z.y + Math.sin(a) * z.r * 0.47 });
  }
  g.lineStyle(2, 0xffc94a, 0.55).strokePoints(pts, true);

  // 八卦三爻符号
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4;
    const tx = Math.cos(a); const ty = Math.sin(a);
    const px = -ty; const py = tx * 0.5;
    const bars = TRIGRAMS[i];
    g.lineStyle(2.2, 0xffe9a8, 0.85);
    for (let b = 0; b < 3; b++) {
      const rr = z.r * (0.76 + b * 0.055);
      const bx = z.x + tx * rr;
      const by = z.y + ty * rr * 0.5;
      if (bars[b]) {
        g.lineBetween(bx - px * 10, by - py * 10, bx + px * 10, by + py * 10);
      } else {
        g.lineBetween(bx - px * 10, by - py * 10, bx - px * 3, by - py * 3);
        g.lineBetween(bx + px * 3, by + py * 3, bx + px * 10, by + py * 10);
      }
    }
  }

  // 反向飞旋符纸（带朱砂印）
  for (let i = 0; i < 8; i++) {
    const a = -s.t * 1.7 + (i * Math.PI) / 4;
    const x = z.x + Math.cos(a) * z.r * 0.98;
    const y = z.y - 10 + Math.sin(a) * z.r * 0.49;
    g.fillStyle(0xffe9a8, 0.92).fillRect(x - 5, y - 9, 10, 18);
    g.lineStyle(1.5, 0xe0463a, 0.85).lineBetween(x, y - 6, x, y + 6);
  }
});

// 箭雨：星辉青蓝光箭 + 落地扩散涟漪圈
registerZoneVis('arrowrain', (g, z, s) => {
  g.fillStyle(0x7fe3ff, 0.12).fillEllipse(z.x, z.y, z.r * 2, z.r);
  g.lineStyle(2.5, 0xbff4ff, 0.65).strokeEllipse(z.x, z.y, z.r * 2, z.r);
  g.lineStyle(1.5, 0x7fe3ff, 0.35).strokeEllipse(z.x, z.y, z.r * 1.35, z.r * 0.675);

  for (let i = 0; i < 16; i++) {
    const seed = i * 97.13 + (z.id || 0);
    const ph = (s.t * 3.1 + ((seed * 0.37) % 1)) % 1;
    const rad = z.r * (0.18 + ((i * 7) % 11) * 0.068);
    const x = z.x + Math.cos(seed) * rad;
    const y = z.y + Math.sin(seed * 1.7) * rad * 0.5;
    if (ph < 0.82) {
      const fall = ph / 0.82;
      const tipY = y - 175 * (1 - fall);
      g.lineStyle(3.5, 0x7fe3ff, 0.45).lineBetween(x, tipY - 34, x, tipY);
      g.lineStyle(1.6, 0xffffff, 0.95).lineBetween(x, tipY - 28, x, tipY);
      g.fillStyle(0xbff4ff, 0.95).fillTriangle(x, tipY + 4, x - 3.5, tipY - 6, x + 3.5, tipY - 6);
    } else {
      // 箭矢触地瞬间扩散星辉涟漪
      const rk = (ph - 0.82) / 0.18;
      const rr = 8 + rk * 26;
      g.lineStyle(2, 0xbff4ff, (1 - rk) * 0.9).strokeEllipse(x, y, rr * 2, rr);
      g.fillStyle(0xffffff, (1 - rk) * 0.8).fillCircle(x, y, 3.2 * (1 - rk));
    }
  }
});

// 铁壁：金钟屏障 + 6 面环绕立体金盾牌
registerZoneVis('shield', (g, z, s) => {
  const cy = z.y - 30;
  const pulse = Math.sin(s.t * 8);
  g.fillStyle(0xffb040, 0.1 + pulse * 0.03).fillEllipse(z.x, cy, z.r * 2, z.r * 2.2);
  g.lineStyle(3, 0xffd36a, 0.55 + pulse * 0.15).strokeEllipse(z.x, cy, z.r * 2, z.r * 2.2);

  for (let i = 0; i < 6; i++) {
    const a = s.t * 2.3 + (i * Math.PI) / 3;
    const depthSin = Math.sin(a);
    const front = depthSin >= 0;
    const sx = z.x + Math.cos(a) * z.r * 0.98;
    const sy = cy + 6 + depthSin * z.r * 0.42;
    const w = front ? 11 : 8;
    const h = front ? 15 : 11;
    const al = front ? 0.92 : 0.48;
    const pts = [
      { x: sx - w, y: sy - h * 0.7 },
      { x: sx + w, y: sy - h * 0.7 },
      { x: sx + w * 0.85, y: sy + h * 0.2 },
      { x: sx, y: sy + h },
      { x: sx - w * 0.85, y: sy + h * 0.2 },
    ];
    g.fillStyle(front ? 0xffb040 : 0xa06420, al * 0.72).fillPoints(pts, true);
    g.lineStyle(2, front ? 0xfff0b0 : 0xffb040, al).strokePoints(pts, true);
  }
});

// 啸风：多层高速旋风刃弧 + 内旋气流
registerZoneVis('wind', (g, z, s) => {
  g.lineStyle(2, 0x7fe3ff, 0.25).strokeEllipse(z.x, z.y, z.r * 2, z.r);
  for (let i = 0; i < 4; i++) {
    const a = s.t * 6.5 + (i * Math.PI) / 2;
    g.lineStyle(6, 0x7fe3ff, 0.35);
    g.beginPath();
    g.arc(z.x, z.y - 22, z.r * 0.84, a, a + 0.95);
    g.strokePath();

    g.lineStyle(2.5, 0xffffff, 0.9);
    g.beginPath();
    g.arc(z.x, z.y - 22, z.r * 0.86, a + 0.15, a + 0.85);
    g.strokePath();

    g.lineStyle(3, 0xe8f4ff, 0.52);
    g.beginPath();
    g.arc(z.x, z.y - 16, z.r * 0.56, -a, -a + 0.75);
    g.strokePath();
  }
});
