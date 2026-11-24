// 持续区域的绘制：按 z.vis 选画法（俯视 3/4 透视：六角冰晶雪花、立体冰棱柱、青莲花瓣、八卦陷阱阵）。
const VIS = {
  warn(g, z) {
    const k = 1 - Math.max(0, z.t) / (z.total || 1);
    const col = z.color || 0xe0463a;
    g.fillStyle(col, 0.14 + 0.24 * k).fillEllipse(z.x, z.y, z.r * 2 * k, z.r * k);
    g.lineStyle(3.5, col, 0.9).strokeEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(1.5, 0xffffff, 0.35 + 0.35 * k).strokeEllipse(z.x, z.y, z.r * 2 * k, z.r * k);
  },
  ring(g, z, s) {
    const a = 0.26 + Math.sin(s.t * 8) * 0.06;
    const col = z.color || 0x7fe3ff;
    g.fillStyle(col, a * 0.45).fillEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(3, col, 0.75).strokeEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(1.5, 0xffffff, 0.42).strokeEllipse(z.x, z.y, z.r * 1.5, z.r * 0.75);
  },
  heal(g, z, s) {
    const pulse = 0.5 + 0.5 * Math.sin(s.t * 5);
    g.fillStyle(0x32c86a, 0.14 + pulse * 0.06).fillEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(2.5, 0x9ff0b8, 0.75).strokeEllipse(z.x, z.y, z.r * 2, z.r);
    // 八瓣旋转翡翠莲华
    const rot = s.t * 0.65;
    const open = 0.72 + pulse * 0.14;
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4;
      const tx = Math.cos(a); const ty = Math.sin(a);
      const px = -ty; const py = tx;
      const rIn = z.r * 0.22;
      const rMid = z.r * 0.56 * open;
      const rTip = z.r * 0.9 * open;
      const w = z.r * 0.16;
      const petal = [
        { x: z.x + tx * rIn, y: z.y + ty * rIn * 0.5 },
        { x: z.x + tx * rMid + px * w, y: z.y + (ty * rMid + py * w) * 0.5 },
        { x: z.x + tx * rTip, y: z.y + ty * rTip * 0.5 },
        { x: z.x + tx * rMid - px * w, y: z.y + (ty * rMid - py * w) * 0.5 },
      ];
      g.fillStyle(0x45d87e, 0.28 + pulse * 0.12).fillPoints(petal, true);
      g.lineStyle(1.8, 0xc8ffd8, 0.78).strokePoints(petal, true);
    }
    g.lineStyle(2, 0xc8ffd8, 0.65).strokeEllipse(z.x, z.y, z.r * 0.5, z.r * 0.25);
  },
  fire(g, z, s) {
    const zid = z.id || 0;
    const fl = Math.sin(s.t * 14 + zid);
    g.fillStyle(0xff5a20, 0.2 + fl * 0.06).fillEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(3, 0xff9a3c, 0.75).strokeEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(1.8, 0xffd36a, 0.62).strokeEllipse(z.x, z.y, z.r * 1.4, z.r * 0.7);
    for (let i = 0; i < 6; i++) {
      const a = s.t * 2.4 + (i * Math.PI) / 3 + zid;
      const fx = z.x + Math.cos(a) * z.r * 0.65;
      const fy = z.y + Math.sin(a) * z.r * 0.32;
      const h = 16 + Math.sin(s.t * 16 + i * 2.1) * 7;
      g.fillStyle(0xffc94a, 0.65).fillTriangle(fx, fy - h, fx - 6, fy + 2, fx + 6, fy + 2);
    }
  },
  ice(g, z, s) {
    g.fillStyle(0x7fe3ff, 0.2).fillEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(3, 0xd8f6ff, 0.82).strokeEllipse(z.x, z.y, z.r * 2, z.r);
    // 6 向晶体雪花几何（3/4 俯视压缩 + 对称分支晶刺）
    const rot = (s?.t || 0) * 0.28 + (z.id || 0) * 0.3;
    const hexPts = [];
    for (let i = 0; i < 6; i++) {
      const a = rot + (i * Math.PI) / 3;
      const ex = z.x + Math.cos(a) * z.r * 0.92;
      const ey = z.y + Math.sin(a) * z.r * 0.46;
      hexPts.push({ x: z.x + Math.cos(a) * z.r * 0.48, y: z.y + Math.sin(a) * z.r * 0.24 });
      // 主冰晶臂
      g.lineStyle(2.6, 0xd8f6ff, 0.88).lineBetween(z.x, z.y, ex, ey);
      g.lineStyle(1.4, 0xffffff, 0.9).lineBetween(z.x, z.y, ex, ey);
      // 两侧 60° 对称冰晶倒刺
      for (const frac of [0.46, 0.72]) {
        const bx = z.x + Math.cos(a) * z.r * 0.92 * frac;
        const by = z.y + Math.sin(a) * z.r * 0.46 * frac;
        const barb = z.r * (frac < 0.6 ? 0.24 : 0.16);
        for (const side of [-0.95, 0.95]) {
          const ba = a + side;
          g.lineStyle(2, 0xbff4ff, 0.82).lineBetween(
            bx, by,
            bx + Math.cos(ba) * barb,
            by + Math.sin(ba) * barb * 0.5,
          );
        }
      }
    }
    g.lineStyle(1.8, 0xffffff, 0.65).strokePoints(hexPts, true);
  },
  trap(g, z, s) {
    const armed = (z.armT || 0) <= 0;
    const rot = s.t * (armed ? 1.1 : 0.4);
    const col = armed ? 0xffd36a : 0xff9a5a;
    g.fillStyle(col, 0.12).fillEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(3, col, 0.65 + Math.sin(s.t * 6) * 0.22).strokeEllipse(z.x, z.y, z.r * 2, z.r);
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4;
      pts.push({ x: z.x + Math.cos(a) * z.r * 0.84, y: z.y + Math.sin(a) * z.r * 0.42 });
    }
    g.lineStyle(2, 0xffe9a8, 0.78).strokePoints(pts, true);
    // 4 枚锁定符爪
    for (let i = 0; i < 4; i++) {
      const a = -rot * 0.8 + (i * Math.PI) / 2;
      const r0 = z.r * (armed ? 0.55 : 0.78);
      const r1 = z.r * (armed ? 0.28 : 0.55);
      g.lineStyle(2.5, armed ? 0xff6a4a : 0xffd36a, 0.9).lineBetween(
        z.x + Math.cos(a) * r0, z.y + Math.sin(a) * r0 * 0.5,
        z.x + Math.cos(a) * r1, z.y + Math.sin(a) * r1 * 0.5,
      );
    }
  },
  wall(g, z) {
    const fade = Math.min(1, Math.max(0.2, (z.t ?? 1) / 0.6));
    const w = Math.max(24, z.r * 0.88);
    const h = Math.max(54, z.r * 1.45);
    const x = z.x;
    const y = z.y + 6;
    // 冰座阴影与寒霜底环
    g.fillStyle(0x0b1a2e, 0.42 * fade).fillEllipse(x, y + 4, w * 2.2, w * 0.95);
    g.lineStyle(2, 0x9fe8ff, 0.6 * fade).strokeEllipse(x, y + 2, w * 2.1, w * 0.9);
    // 左侧受光棱面
    const leftFacet = [
      { x: x - w * 0.86, y: y - 4 },
      { x, y: y + w * 0.34 },
      { x, y: y - h * 0.72 },
      { x: x - w * 0.62, y: y - h * 0.55 },
    ];
    // 右侧背光折射面
    const rightFacet = [
      { x, y: y + w * 0.34 },
      { x: x + w * 0.86, y: y - 4 },
      { x: x + w * 0.62, y: y - h * 0.55 },
      { x, y: y - h * 0.72 },
    ];
    // 尖顶三棱锥冰冠
    const topLeft = [
      { x: x - w * 0.62, y: y - h * 0.55 },
      { x, y: y - h * 0.72 },
      { x, y: y - h },
    ];
    const topRight = [
      { x, y: y - h * 0.72 },
      { x: x + w * 0.62, y: y - h * 0.55 },
      { x, y: y - h },
    ];
    g.fillStyle(0xbff4ff, 0.72 * fade).fillPoints(leftFacet, true);
    g.fillStyle(0x4c9ad2, 0.78 * fade).fillPoints(rightFacet, true);
    g.fillStyle(0xeafaff, 0.88 * fade).fillPoints(topLeft, true);
    g.fillStyle(0x7fc4ee, 0.82 * fade).fillPoints(topRight, true);
    g.lineStyle(2, 0xffffff, 0.88 * fade).strokePoints(leftFacet, true);
    g.lineStyle(2, 0xbff4ff, 0.78 * fade).strokePoints(rightFacet, true);
    g.lineStyle(2, 0xffffff, 0.95 * fade).strokePoints(topLeft, true);
    g.lineStyle(2, 0xd8f6ff, 0.85 * fade).strokePoints(topRight, true);
    g.lineStyle(2.5, 0xffffff, 0.92 * fade).lineBetween(x, y + w * 0.32, x, y - h);
  },
  dark(g, z, s) {
    g.fillStyle(0x2a0a40, 0.35 + Math.sin(s.t * 4) * 0.08).fillEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(3, 0xb05aff, 0.75).strokeEllipse(z.x, z.y, z.r * 2, z.r);
    g.lineStyle(1.8, 0xe0a8ff, 0.45).strokeEllipse(z.x, z.y, z.r * 1.4, z.r * 0.7);
  },
};

export function registerZoneVis(name, fn) { VIS[name] = fn; }

export function drawZone(sc, g, z, s) {
  const f = VIS[z.vis];
  if (f) f(g, z, s, sc);
}
