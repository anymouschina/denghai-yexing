// 守灯·镇夜 程序化 VFX 纹理与复合特效工厂（ADD 混合 + 自动回收 + 安全上限 <= 160）
import { TF, INK } from '../../fonts.js';

export const VFX_TEXTURE_KEYS = [
  'vfx_glow_orb',
  'vfx_crescent',
  'vfx_rune_ring',
  'vfx_spear_streak',
  'vfx_ice_shard',
  'vfx_star_spark',
  'vfx_impact_wave',
];

const MAX_ACTIVE_VFX = 156;

function makeCanvasTex(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return scene.textures.get(key);
  const tex = scene.textures.createCanvas(key, w, h);
  draw(tex.getContext(), w, h);
  tex.refresh();
  return tex;
}

/**
 * 生成 7 张高精细程序化 Canvas 发光贴图（纯白/灰度 + 透明通道，运行时 ADD + setTint 上色，绝无黑底方块）
 */
export function makeVfxTextures(scene) {
  if (!scene?.textures?.createCanvas) return [];

  // 1. vfx_glow_orb：白热核心 + 柔化羽化光晕 + 内环光晕
  makeCanvasTex(scene, 'vfx_glow_orb', 96, 96, (c, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, cx);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.16, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.38, 'rgba(255,255,255,0.48)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    c.strokeStyle = 'rgba(255,255,255,0.42)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, 24, 0, Math.PI * 2);
    c.stroke();
  });

  // 2. vfx_crescent：锐利收尖月牙斩击弧（右向 0 rad 为弧峰）
  makeCanvasTex(scene, 'vfx_crescent', 192, 192, (c, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const rOut = 80;
    const aSpan = 1.18;
    const tipX = cx + Math.cos(aSpan) * rOut;
    const tipYTop = cy - Math.sin(aSpan) * rOut;

    c.save();
    c.shadowColor = 'rgba(255,255,255,0.9)';
    c.shadowBlur = 12;

    const grad = c.createRadialGradient(cx + 12, cy, rOut * 0.42, cx, cy, rOut + 4);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    grad.addColorStop(0.78, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.95, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');

    c.fillStyle = grad;
    c.beginPath();
    c.arc(cx, cy, rOut, -aSpan, aSpan, false);
    c.quadraticCurveTo(cx + rOut * 0.56, cy, tipX, tipYTop);
    c.closePath();
    c.fill();

    // 锋利白热刃脊
    c.shadowBlur = 6;
    c.strokeStyle = 'rgba(255,255,255,0.98)';
    c.lineWidth = 3.2;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(cx, cy, rOut - 2, -aSpan * 0.88, aSpan * 0.88, false);
    c.stroke();
    c.restore();
  });

  // 3. vfx_rune_ring：中式八卦/八爻符阵圆环
  makeCanvasTex(scene, 'vfx_rune_ring', 256, 256, (c, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    c.save();
    c.translate(cx, cy);

    // 外圈柔光
    const rim = c.createRadialGradient(0, 0, 68, 0, 0, 124);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(0.72, 'rgba(255,255,255,0.18)');
    rim.addColorStop(0.88, 'rgba(255,255,255,0.34)');
    rim.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = rim;
    c.beginPath();
    c.arc(0, 0, 124, 0, Math.PI * 2);
    c.fill();

    // 阵环线
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, 114, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.65)';
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(0, 0, 105, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.88)';
    c.lineWidth = 2.4;
    c.beginPath(); c.arc(0, 0, 74, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.lineWidth = 1.2;
    c.beginPath(); c.arc(0, 0, 64, 0, Math.PI * 2); c.stroke();

    // 内八角几何阵纹
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 1.5;
    for (let rot = 0; rot < 2; rot++) {
      c.beginPath();
      for (let i = 0; i <= 4; i++) {
        const a = rot * (Math.PI / 4) + (i * Math.PI) / 2;
        const px = Math.cos(a) * 63;
        const py = Math.sin(a) * 63;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
    }

    // 八卦八爻（乾兑离震巽坎艮坤）
    const trigrams = [
      [1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 0, 1],
      [1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0],
    ];
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      c.save();
      c.rotate(ang);
      const bars = trigrams[i];
      for (let b = 0; b < 3; b++) {
        const ry = -81 - b * 7;
        c.fillStyle = 'rgba(255,255,255,0.95)';
        if (bars[b]) {
          c.fillRect(-12, ry - 1.5, 24, 3);
        } else {
          c.fillRect(-12, ry - 1.5, 9.5, 3);
          c.fillRect(2.5, ry - 1.5, 9.5, 3);
        }
      }
      // 间隔符印星点
      c.rotate(Math.PI / 8);
      c.fillStyle = 'rgba(255,255,255,0.88)';
      c.beginPath();
      c.moveTo(0, -119); c.lineTo(4, -114); c.lineTo(0, -109); c.lineTo(-4, -114);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.restore();
  });

  // 4. vfx_spear_streak：枪芒/穿透光束拖尾（朝右指向 +X）
  makeCanvasTex(scene, 'vfx_spear_streak', 192, 48, (c, w, h) => {
    const cy = h / 2;
    const lg = c.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.28, 'rgba(255,255,255,0.35)');
    lg.addColorStop(0.76, 'rgba(255,255,255,0.92)');
    lg.addColorStop(0.92, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');

    c.save();
    c.shadowColor = 'rgba(255,255,255,0.9)';
    c.shadowBlur = 8;
    c.fillStyle = lg;
    c.beginPath();
    c.moveTo(6, cy);
    c.quadraticCurveTo(w * 0.56, cy - 17, w - 34, cy - 11);
    c.lineTo(w - 2, cy);
    c.lineTo(w - 34, cy + 11);
    c.quadraticCurveTo(w * 0.56, cy + 17, 6, cy);
    c.closePath();
    c.fill();

    // 白热中心枪脊
    c.fillStyle = 'rgba(255,255,255,0.98)';
    c.beginPath();
    c.moveTo(28, cy);
    c.lineTo(w - 36, cy - 3.6);
    c.lineTo(w - 4, cy);
    c.lineTo(w - 36, cy + 3.6);
    c.closePath();
    c.fill();
    c.restore();
  });

  // 5. vfx_ice_shard：多切面晶莹冰棱（朝右指向 +X）
  makeCanvasTex(scene, 'vfx_ice_shard', 96, 96, (c, w, h) => {
    const cy = h / 2;
    const g = c.createRadialGradient(48, cy, 2, 48, cy, 44);
    g.addColorStop(0, 'rgba(255,255,255,0.38)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    const pts = [[10, cy], [36, cy - 18], [88, cy], [36, cy + 18]];
    // 上半受光切面
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    c.lineTo(pts[1][0], pts[1][1]);
    c.lineTo(pts[2][0], pts[2][1]);
    c.lineTo(42, cy - 2);
    c.closePath();
    c.fill();

    // 下半折射暗面
    c.fillStyle = 'rgba(255,255,255,0.58)';
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    c.lineTo(42, cy - 2);
    c.lineTo(pts[2][0], pts[2][1]);
    c.lineTo(pts[3][0], pts[3][1]);
    c.closePath();
    c.fill();

    // 晶体边线与中央冰棱高光
    c.strokeStyle = 'rgba(255,255,255,0.98)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    c.lineTo(pts[1][0], pts[1][1]);
    c.lineTo(pts[2][0], pts[2][1]);
    c.lineTo(pts[3][0], pts[3][1]);
    c.closePath();
    c.stroke();

    c.strokeStyle = '#ffffff';
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(14, cy);
    c.lineTo(84, cy);
    c.moveTo(36, cy - 16);
    c.lineTo(42, cy - 2);
    c.lineTo(36, cy + 16);
    c.stroke();
  });

  // 6. vfx_star_spark：暴击八芒星芒（四主尖芒 + 四辅微芒 + 白热中心）
  makeCanvasTex(scene, 'vfx_star_spark', 64, 64, (c, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, 28);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    const drawRay = (len, waist, alpha) => {
      c.fillStyle = `rgba(255,255,255,${alpha})`;
      c.beginPath();
      c.moveTo(cx - len, cy);
      c.quadraticCurveTo(cx, cy - waist, cx + len, cy);
      c.quadraticCurveTo(cx, cy + waist, cx - len, cy);
      c.fill();
      c.beginPath();
      c.moveTo(cx, cy - len);
      c.quadraticCurveTo(cx + waist, cy, cx, cy + len);
      c.quadraticCurveTo(cx - waist, cy, cx, cy - len);
      c.fill();
    };
    drawRay(30, 3.6, 0.98);
    c.save();
    c.translate(cx, cy);
    c.rotate(Math.PI / 4);
    c.translate(-cx, -cy);
    drawRay(16, 2.0, 0.72);
    c.restore();
  });

  // 7. vfx_impact_wave：震地冲击波纹环（外锐内羽 + 放射速度缺口）
  makeCanvasTex(scene, 'vfx_impact_wave', 192, 192, (c, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const g = c.createRadialGradient(cx, cy, 40, cx, cy, 95);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.84, 'rgba(255,255,255,1)');
    g.addColorStop(0.94, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI * 2) / 16;
      const r0 = i % 2 === 0 ? 64 : 70;
      const r1 = i % 2 === 0 ? 89 : 85;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
    }
  });

  return VFX_TEXTURE_KEYS;
}

// ---------------- 临时特效对象管理与安全上限（<= 160） ----------------
function vfxBucket(sc) {
  if (!sc.__vfxActive || sc.__vfxScene !== sc) {
    sc.__vfxActive = [];
    sc.__vfxScene = sc;
  }
  const arr = sc.__vfxActive;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!arr[i].obj || !arr[i].obj.scene) arr.splice(i, 1);
  }
  return arr;
}

export function getActiveVfxCount(sc) {
  return vfxBucket(sc).length;
}

function trackVfx(sc, obj, priority = 1) {
  const arr = vfxBucket(sc);
  const rec = { obj, priority };
  arr.push(rec);
  obj.once?.('destroy', () => {
    const idx = arr.indexOf(rec);
    if (idx >= 0) arr.splice(idx, 1);
  });
  return obj;
}

function canSpawnVfx(sc, priority = 1) {
  const arr = vfxBucket(sc);
  if (arr.length < MAX_ACTIVE_VFX) return true;
  if (priority < 2) return false;
  // 高优先级特效（大招/套装/BOSS/雷暴）：优先淘汰最老的低优先级临时精灵
  let victimIdx = arr.findIndex((x) => x.priority < 2);
  if (victimIdx < 0) victimIdx = 0;
  const victim = arr[victimIdx];
  arr.splice(victimIdx, 1);
  if (victim?.obj?.scene) {
    sc.tweens?.killTweensOf?.(victim.obj);
    victim.obj.destroy();
  }
  return true;
}

function ensureTextures(sc) {
  if (!sc.textures.exists('vfx_glow_orb')) makeVfxTextures(sc);
}

function vfxImg(sc, x, y, tex, cfg = {}) {
  const priority = cfg.priority ?? 1;
  if (!sc?.add?.image || !canSpawnVfx(sc, priority)) return null;
  ensureTextures(sc);
  const img = sc.add.image(x, y, tex);
  img.setDepth(cfg.depth ?? 9110);
  if (cfg.blend !== false) img.setBlendMode('ADD');
  if (cfg.originX !== undefined || cfg.originY !== undefined) {
    img.setOrigin(cfg.originX ?? 0.5, cfg.originY ?? 0.5);
  }
  if (cfg.tint !== undefined && cfg.tint !== null) img.setTint(cfg.tint);
  if (cfg.alpha !== undefined) img.setAlpha(cfg.alpha);
  if (cfg.rotation !== undefined) img.setRotation(cfg.rotation);
  if (cfg.scaleX !== undefined || cfg.scaleY !== undefined) {
    img.setScale(cfg.scaleX ?? 1, cfg.scaleY ?? (cfg.scaleX ?? 1));
  } else if (cfg.scale !== undefined) {
    img.setScale(cfg.scale);
  }
  return trackVfx(sc, img, priority);
}

function vfxTweenDestroy(sc, target, tweenCfg) {
  if (!target || !sc?.tweens?.add) return null;
  const userComplete = tweenCfg.onComplete;
  return sc.tweens.add({
    ...tweenCfg,
    targets: target,
    onComplete: (...args) => {
      userComplete?.(...args);
      if (target.scene) target.destroy();
    },
  });
}

/** 3/4 俯视椭圆内无变形旋转的八卦阵环容器（Container Y 轴压扁 0.55，内部子精灵等比旋转） */
function spawnSpinningRuneRing(sc, x, y, radius, color, durMs, opts = {}) {
  const priority = opts.priority ?? 2;
  if (!sc?.add?.container || !canSpawnVfx(sc, priority)) return null;
  ensureTextures(sc);
  const scaleYRatio = opts.perspective ?? 0.55;
  const cont = sc.add.container(x, y).setDepth(opts.depth ?? 9070).setScale(1, scaleYRatio);
  trackVfx(sc, cont, priority);

  const ring = sc.add.image(0, 0, opts.tex || 'vfx_rune_ring')
    .setBlendMode('ADD')
    .setTint(color)
    .setAlpha(opts.alpha ?? 0.92);
  const baseSc = (radius * 2) / 236;
  const startSc = (opts.startScale ?? 0.72) * baseSc;
  const endSc = (opts.endScale ?? 1.08) * baseSc;
  ring.setScale(startSc);
  if (opts.startRot !== undefined) ring.setRotation(opts.startRot);
  cont.add(ring);

  const rotDelta = (opts.rotDir ?? 1) * (opts.rotRad ?? 1.8);
  sc.tweens.add({
    targets: ring,
    scaleX: endSc,
    scaleY: endSc,
    rotation: ring.rotation + rotDelta,
    alpha: { from: opts.alpha ?? 0.92, to: 0 },
    duration: durMs,
    ease: opts.ease || 'Cubic.easeOut',
    onComplete: () => { if (cont.scene) cont.destroy(); },
  });
  return cont;
}

/** 放射状星芒/火星爆散 */
export function spawnStarSparks(sc, x, y, opts = {}) {
  const count = opts.count ?? 5;
  const color = opts.color ?? 0xffd36a;
  const dist = opts.dist ?? 56;
  const dur = opts.dur ?? 260;
  const baseAngle = opts.angle;
  const spread = opts.spread ?? Math.PI * 2;
  const priority = opts.priority ?? 1;

  for (let i = 0; i < count; i++) {
    const a = baseAngle !== undefined
      ? baseAngle + (Math.random() - 0.5) * spread
      : (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
    const tex = i % 2 === 0 ? 'vfx_star_spark' : 'vfx_spear_streak';
    const sp = vfxImg(sc, x, y, tex, {
      tint: i === 0 ? 0xffffff : color,
      depth: opts.depth ?? 9160,
      scale: tex === 'vfx_star_spark' ? (opts.scale ?? 0.42) : (opts.scale ?? 0.28),
      rotation: a,
      alpha: 0.95,
      priority,
    });
    if (!sp) break;
    const reach = dist * (0.65 + Math.random() * 0.55);
    vfxTweenDestroy(sc, sp, {
      x: x + Math.cos(a) * reach,
      y: y + Math.sin(a) * reach * 0.85,
      scaleX: sp.scaleX * 0.2,
      scaleY: sp.scaleY * 0.2,
      alpha: 0,
      duration: dur + Math.random() * 80,
      ease: 'Cubic.easeOut',
    });
  }
}

/** 斩击复合特效：月牙刀光 + 内芯白光 + 暴击/觉醒火花 */
export function spawnSlashVfx(sc, f) {
  const x = f.x;
  const y = f.y;
  const a = f.a ?? 0;
  const r = f.r ?? 120;
  const arc = f.arc ?? 1.8;
  const color = f.color ?? (f.awakened ? 0xffc94a : 0xffe0a0);
  const fullSpin = arc >= Math.PI * 1.65;
  const blades = fullSpin ? 2 : 1;
  const baseScale = Math.max(0.45, r / 84);

  for (let i = 0; i < blades; i++) {
    const startA = a + i * Math.PI - (fullSpin ? 0.55 : arc * 0.22);
    const sweep = fullSpin ? Math.PI * 1.25 : Math.min(1.1, arc * 0.42);
    const outer = vfxImg(sc, x, y, 'vfx_crescent', {
      tint: color,
      depth: 9120,
      rotation: startA,
      scaleX: baseScale * 0.9,
      scaleY: baseScale * 0.86,
      alpha: 0.96,
      priority: f.awakened ? 2 : 1,
    });
    if (outer) {
      vfxTweenDestroy(sc, outer, {
        rotation: startA + sweep,
        scaleX: baseScale * 1.14,
        scaleY: baseScale * 1.08,
        alpha: 0,
        duration: f.awakened ? 240 : 190,
        ease: 'Cubic.easeOut',
      });
    }

    const core = vfxImg(sc, x, y, 'vfx_crescent', {
      tint: 0xffffff,
      depth: 9122,
      rotation: startA + 0.08,
      scaleX: baseScale * 0.78,
      scaleY: baseScale * 0.74,
      alpha: 0.88,
      priority: 1,
    });
    if (core) {
      vfxTweenDestroy(sc, core, {
        rotation: startA + sweep + 0.1,
        scaleX: baseScale * 0.96,
        scaleY: baseScale * 0.92,
        alpha: 0,
        duration: 150,
        ease: 'Quad.easeOut',
      });
    }
  }

  if (f.awakened) {
    spawnRingVfx(sc, { x, y: y + 20, r: r * 0.95, color, dur: 0.26, rune: true, priority: 2 });
  }
  if (f.sparks || f.awakened) {
    spawnStarSparks(sc, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.4, {
      count: f.awakened ? 7 : 4,
      color,
      angle: a,
      spread: Math.min(Math.PI * 2, arc),
      dist: r * 0.55,
    });
  }
}

/** 闪电/雷链复合特效：分叉外辉 + 白热电弧 + 落点星芒波纹 */
export function spawnBoltVfx(sc, f) {
  const x1 = f.x1; const y1 = f.y1;
  const x2 = f.x2; const y2 = f.y2;
  const color = f.color ?? 0x7fe3ff;
  const priority = f.rune ? 2 : 1;

  if (sc?.add?.graphics && canSpawnVfx(sc, priority)) {
    const g = sc.add.graphics().setDepth(9135).setBlendMode('ADD');
    trackVfx(sc, g, priority);
    const pts = [{ x: x1, y: y1 }];
    const segs = 7;
    const dx = x2 - x1; const dy = y2 - y1;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len; const ny = dx / len;
    const jit = Math.min(26, Math.max(10, len * 0.08));
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const off = (Math.random() - 0.5) * 2 * jit;
      pts.push({ x: x1 + dx * t + nx * off, y: y1 + dy * t + ny * off });
    }
    pts.push({ x: x2, y: y2 });

    // 外层青蓝光晕电弧
    g.lineStyle(8, color, 0.58);
    g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokePath();

    // 枝杈小电弧
    const mid = pts[Math.floor(pts.length / 2)];
    g.lineStyle(3, color, 0.5);
    g.lineBetween(mid.x, mid.y, mid.x + (Math.random() - 0.5) * 52, mid.y + (Math.random() - 0.5) * 38);

    // 内层白热弧芯
    g.lineStyle(2.5, 0xffffff, 0.98);
    g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokePath();

    vfxTweenDestroy(sc, g, { alpha: 0, duration: 200, ease: 'Cubic.easeOut' });
  }

  const endFlare = vfxImg(sc, x2, y2, 'vfx_star_spark', {
    tint: color, depth: 9140, scale: 0.58, rotation: Math.random() * Math.PI, priority,
  });
  if (endFlare) {
    vfxTweenDestroy(sc, endFlare, { scale: 0.15, alpha: 0, rotation: endFlare.rotation + 0.8, duration: 210 });
  }
  const wave = vfxImg(sc, x2, y2, 'vfx_impact_wave', {
    tint: color, depth: 9095, scaleX: 0.24, scaleY: 0.14, alpha: 0.85, priority: 1,
  });
  if (wave) {
    vfxTweenDestroy(sc, wave, { scaleX: 0.55, scaleY: 0.3, alpha: 0, duration: 230, ease: 'Cubic.easeOut' });
  }
  if (f.rune) {
    spawnSpinningRuneRing(sc, x2, y2, 62, color, 340, { priority: 2 });
  }
}

/** 枪芒/贯穿光束复合特效：长条光束 + 白热芯 + 起点爆闪 + 音爆波纹环 */
export function spawnBeamVfx(sc, f) {
  const x1 = f.x1; const y1 = f.y1;
  const x2 = f.x2; const y2 = f.y2;
  const dx = x2 - x1; const dy = y2 - y1;
  const len = Math.max(20, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx);
  const w = f.w ?? 14;
  const color = f.color ?? (f.awakened ? 0xffc94a : 0xffe0a0);
  const durMs = Math.round((f.dur ?? 0.28) * 1000);
  const priority = f.awakened ? 2 : 1;

  const outer = vfxImg(sc, x1, y1, 'vfx_spear_streak', {
    originX: 0, originY: 0.5, rotation: ang,
    tint: color, depth: 9115,
    scaleX: len / 186, scaleY: Math.max(0.45, w / 16),
    alpha: 0.94, priority,
  });
  if (outer) {
    vfxTweenDestroy(sc, outer, {
      scaleY: outer.scaleY * 0.2, alpha: 0, duration: durMs, ease: 'Cubic.easeOut',
    });
  }

  const core = vfxImg(sc, x1, y1, 'vfx_spear_streak', {
    originX: 0, originY: 0.5, rotation: ang,
    tint: 0xffffff, depth: 9116,
    scaleX: len / 186, scaleY: Math.max(0.22, w / 34),
    alpha: 0.98, priority: 1,
  });
  if (core) {
    vfxTweenDestroy(sc, core, {
      scaleY: 0.05, alpha: 0, duration: Math.max(120, durMs * 0.78), ease: 'Quad.easeOut',
    });
  }

  const muzzle = vfxImg(sc, x1, y1, 'vfx_glow_orb', {
    tint: color, depth: 9118, scale: 0.55, alpha: 0.9, priority: 1,
  });
  if (muzzle) {
    vfxTweenDestroy(sc, muzzle, { scale: 1.05, alpha: 0, duration: 180, ease: 'Cubic.easeOut' });
  }

  if (f.sonic || f.awakened) {
    const rings = f.awakened ? 3 : 2;
    for (let i = 1; i <= rings; i++) {
      const k = i / (rings + 0.5);
      const rx = x1 + dx * k;
      const ry = y1 + dy * k;
      const ring = vfxImg(sc, rx, ry, 'vfx_impact_wave', {
        tint: color, depth: 9114, rotation: ang,
        scaleX: 0.16, scaleY: 0.42, alpha: 0.85, priority: 1,
      });
      if (ring) {
        vfxTweenDestroy(sc, ring, {
          scaleX: 0.36, scaleY: 0.82, alpha: 0, delay: i * 35, duration: 220, ease: 'Cubic.easeOut',
        });
      }
    }
  }
}

/** 扩散冲击圈（可选八卦符阵） */
export function spawnRingVfx(sc, f) {
  const x = f.x; const y = f.y;
  const r = f.r ?? 100;
  const color = f.color ?? 0x7fe3ff;
  const durMs = Math.round((f.dur ?? 0.42) * 1000);
  const priority = (f.rune || f.awakened || r >= 160) ? 2 : 1;

  const wave = vfxImg(sc, x, y, 'vfx_impact_wave', {
    tint: color, depth: 9085,
    scaleX: Math.max(0.25, (r * 0.75) / 92),
    scaleY: Math.max(0.14, (r * 0.42) / 92),
    alpha: 0.92, priority,
  });
  if (wave) {
    vfxTweenDestroy(sc, wave, {
      scaleX: (r * 2.15) / 180,
      scaleY: (r * 1.15) / 180,
      alpha: 0,
      duration: durMs,
      ease: 'Cubic.easeOut',
    });
  }

  const orb = vfxImg(sc, x, y - 6, 'vfx_glow_orb', {
    tint: color, depth: 9084, scaleX: r / 70, scaleY: r / 120, alpha: 0.38, priority: 1,
  });
  if (orb) {
    vfxTweenDestroy(sc, orb, { alpha: 0, scaleX: r / 52, scaleY: r / 90, duration: durMs * 0.85 });
  }

  if (f.rune || f.awakened) {
    spawnSpinningRuneRing(sc, x, y, r * 0.95, color, Math.max(360, durMs + 80), { priority });
  }
}

/** 扇形火焰/气浪喷涌 */
export function spawnConeVfx(sc, f) {
  const x = f.x; const y = f.y;
  const a = f.a ?? 0;
  const r = f.r ?? 180;
  const arc = f.arc ?? 1.1;
  const color = f.color ?? 0xff7a30;
  const durMs = Math.round((f.dur ?? 0.36) * 1000);
  const jets = f.awakened ? 7 : 5;

  for (let i = 0; i < jets; i++) {
    const k = jets === 1 ? 0 : i / (jets - 1) - 0.5;
    const ja = a + k * arc * 0.92;
    const jet = vfxImg(sc, x, y, 'vfx_spear_streak', {
      originX: 0, originY: 0.5, rotation: ja,
      tint: i % 2 === 0 ? color : 0xffd36a,
      depth: 9112,
      scaleX: (r * 0.45) / 186, scaleY: 0.85, alpha: 0.88, priority: 1,
    });
    if (jet) {
      vfxTweenDestroy(sc, jet, {
        scaleX: (r * (0.9 + Math.random() * 0.2)) / 186,
        scaleY: 1.35,
        alpha: 0,
        duration: durMs,
        ease: 'Cubic.easeOut',
      });
    }
  }

  const sweep = vfxImg(sc, x, y, 'vfx_crescent', {
    tint: color, depth: 9114, rotation: a, scale: (r * 0.72) / 84, alpha: 0.78, priority: 1,
  });
  if (sweep) {
    vfxTweenDestroy(sc, sweep, { scale: (r * 1.1) / 84, alpha: 0, duration: durMs, ease: 'Cubic.easeOut' });
  }

  spawnStarSparks(sc, x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.35, {
    count: 6, color: 0xffd36a, angle: a, spread: arc, dist: r * 0.6,
  });
}

/** 冰霜爆发：多切面晶莹冰棱散射 + 霜冻波纹 + 寒阵 */
export function spawnIceBurst(sc, f) {
  const x = f.x; const y = f.y;
  const r = f.r ?? 160;
  const color = f.color ?? 0x9fe8ff;
  const shards = Math.min(20, f.shards ?? (f.awakened ? 16 : 10));

  spawnRingVfx(sc, { x, y, r, color, dur: 0.52, rune: true, awakened: f.awakened, priority: 2 });

  const core = vfxImg(sc, x, y - 24, 'vfx_glow_orb', {
    tint: 0xd8f6ff, depth: 9120, scale: Math.max(1.2, r / 80), alpha: 0.85, priority: 2,
  });
  if (core) {
    vfxTweenDestroy(sc, core, { scale: core.scaleX * 1.65, alpha: 0, duration: 360, ease: 'Cubic.easeOut' });
  }

  for (let i = 0; i < shards; i++) {
    const a = (i / shards) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const reach = r * (0.45 + Math.random() * 0.55);
    const sh = vfxImg(sc, x, y - 16, 'vfx_ice_shard', {
      tint: i % 3 === 0 ? 0xffffff : color,
      depth: 9128,
      rotation: a,
      scale: (0.42 + Math.random() * 0.32) * (f.awakened ? 1.25 : 1),
      alpha: 0.96,
      priority: i < 4 ? 2 : 1,
    });
    if (!sh) break;
    vfxTweenDestroy(sc, sh, {
      x: x + Math.cos(a) * reach,
      y: y - 16 + Math.sin(a) * reach * 0.56 - 10,
      rotation: a + (Math.random() - 0.5) * 0.9,
      scale: 0.15,
      alpha: 0,
      duration: 380 + Math.random() * 140,
      ease: 'Cubic.easeOut',
    });
  }
}

/** 天雷落击：苍穹光柱 + 落雷图 + 地面八卦阵 + 激荡波纹 */
export function spawnThunderVfx(sc, f) {
  const x = f.x; const y = f.y;
  const r = f.r ?? 120;
  const color = f.color ?? 0xbff4ff;

  if (sc.textures.exists('fx_thunder') && canSpawnVfx(sc, 2)) {
    const img = sc.add.image(x, y + 10, 'fx_thunder')
      .setOrigin(0.5, 1).setDepth(9130).setBlendMode('ADD');
    img.setScale((r * 2.3) / (img.height || 200));
    trackVfx(sc, img, 2);
    vfxTweenDestroy(sc, img, { alpha: 0, duration: 380, ease: 'Cubic.easeIn' });
  }

  const pillar = vfxImg(sc, x, y + 8, 'vfx_spear_streak', {
    originX: 0, originY: 0.5, rotation: -Math.PI / 2,
    tint: color, depth: 9132,
    scaleX: 2.8, scaleY: Math.max(0.85, r / 90), alpha: 0.92, priority: 2,
  });
  if (pillar) {
    vfxTweenDestroy(sc, pillar, { scaleY: 0.1, alpha: 0, duration: 280, ease: 'Cubic.easeOut' });
  }

  spawnRingVfx(sc, { x, y, r, color, dur: 0.42, rune: f.rune !== false, awakened: f.awakened, priority: 2 });
  spawnStarSparks(sc, x, y - 10, { count: 7, color, dist: r * 0.65, priority: 1 });
}

/** 高空坠落弹体（万符朝宗 / 焚天火雨） */
export function spawnDropVfx(sc, f) {
  const x = f.x; const y = f.y;
  const tint = f.tint ?? f.color ?? null;
  const tex = f.tex || 'proj_talisman';
  const col = tint ?? (tex === 'proj_flame' ? 0xff7a30 : 0xffd36a);
  if (!sc?.add?.image || !canSpawnVfx(sc, 1)) return;

  const img = sc.add.image(x, y - 260, tex).setDepth(9115).setRotation(Math.PI / 2).setScale(0.64);
  if (tint) img.setTint(tint);
  trackVfx(sc, img, 1);

  const trail = vfxImg(sc, x, y - 260, 'vfx_spear_streak', {
    originX: 1, originY: 0.5, rotation: Math.PI / 2,
    tint: col, depth: 9114, scaleX: 0.72, scaleY: 0.42, alpha: 0.78, priority: 1,
  });

  sc.tweens.add({
    targets: trail ? [img, trail] : img,
    y: y - 16,
    duration: 185,
    ease: 'Quad.easeIn',
    onComplete: () => {
      if (img.scene) img.destroy();
      if (trail?.scene) trail.destroy();
      const wave = vfxImg(sc, x, y, 'vfx_impact_wave', {
        tint: col, depth: 9105, scaleX: 0.2, scaleY: 0.12, alpha: 0.88, priority: 1,
      });
      if (wave) {
        vfxTweenDestroy(sc, wave, { scaleX: 0.58, scaleY: 0.32, alpha: 0, duration: 240, ease: 'Cubic.easeOut' });
      }
      const burst = vfxImg(sc, x, y - 14, 'vfx_glow_orb', {
        tint: col, depth: 9108, scale: 0.45, alpha: 0.85, priority: 1,
      });
      if (burst) {
        vfxTweenDestroy(sc, burst, { scale: 0.95, alpha: 0, duration: 220, ease: 'Cubic.easeOut' });
      }
    },
  });
}

function parseColorNum(c, fallback = 0xffd36a) {
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (typeof c === 'string' && c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** 英雄大招盛典：旋转八卦阵（觉醒时双环反向旋转）+ 镜头微缩放 + 柔闪 + Q弹缩放标题 */
export function spawnUltShowcase(sc, f) {
  const x = f.x; const y = f.y;
  const colStr = f.color || '#ffd36a';
  const colHex = parseColorNum(f.color, 0xffd36a);
  const awakened = !!f.awakened;

  // 1. 旋转八卦符阵（觉醒双环逆向旋转）
  spawnSpinningRuneRing(sc, x, y, awakened ? 230 : 175, colHex, awakened ? 1050 : 780, {
    rotDir: 1, rotRad: 2.2, startScale: 0.45, endScale: 1.12, alpha: 0.96, priority: 3,
  });
  if (awakened) {
    spawnSpinningRuneRing(sc, x, y, 310, 0xffffff, 1150, {
      rotDir: -1, rotRad: 2.6, startScale: 0.55, endScale: 1.18, alpha: 0.85, priority: 3,
    });
  }

  // 2. 冲天光柱 + 中心爆辉 + 冲击波纹
  const pillar = vfxImg(sc, x, y + 10, 'vfx_spear_streak', {
    originX: 0, originY: 0.5, rotation: -Math.PI / 2,
    tint: colHex, depth: 9150, scaleX: awakened ? 2.6 : 1.9, scaleY: awakened ? 1.8 : 1.25, alpha: 0.9, priority: 3,
  });
  if (pillar) {
    vfxTweenDestroy(sc, pillar, { scaleX: pillar.scaleX * 1.3, scaleY: 0.1, alpha: 0, duration: 540, ease: 'Cubic.easeOut' });
  }

  const orb = vfxImg(sc, x, y - 40, 'vfx_glow_orb', {
    tint: colHex, depth: 9145, scale: awakened ? 1.8 : 1.3, alpha: 0.92, priority: 3,
  });
  if (orb) {
    vfxTweenDestroy(sc, orb, { scale: orb.scaleX * 2.2, alpha: 0, duration: 480, ease: 'Cubic.easeOut' });
  }

  const wave = vfxImg(sc, x, y, 'vfx_impact_wave', {
    tint: colHex, depth: 9140, scaleX: 0.45, scaleY: 0.25, alpha: 0.96, priority: 3,
  });
  if (wave) {
    vfxTweenDestroy(sc, wave, {
      scaleX: awakened ? 2.8 : 2.1, scaleY: awakened ? 1.55 : 1.15, alpha: 0, duration: 520, ease: 'Cubic.easeOut',
    });
  }

  spawnStarSparks(sc, x, y - 45, {
    count: awakened ? 14 : 9, color: colHex, dist: awakened ? 130 : 90, dur: 420, scale: 0.65, priority: 2,
  });
  if (sc.pGold) sc.pGold.explode(awakened ? 52 : 36, x, y - 40);

  // 3. 大招书法标题（Back.easeOut Q弹放大定格）
  if (f.text && sc?.add?.text && canSpawnVfx(sc, 3)) {
    const label = awakened && !String(f.text).startsWith('觉醒') ? `觉醒 · ${f.text}` : f.text;
    const txt = sc.add.text(x, y - 148, label, {
      fontFamily: TF,
      fontSize: awakened ? '46px' : '40px',
      color: colStr,
      stroke: INK,
      strokeThickness: 7,
    }).setOrigin(0.5).setDepth(9680).setScale(0.35).setAlpha(0);
    trackVfx(sc, txt, 3);
    sc.tweens.add({
      targets: txt,
      scale: 1.08,
      alpha: 1,
      y: y - 166,
      duration: 210,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (!txt.scene) return;
        sc.tweens.add({
          targets: txt,
          scale: 1.0,
          y: y - 208,
          alpha: 0,
          delay: 360,
          duration: 420,
          ease: 'Cubic.easeIn',
          onComplete: () => { if (txt.scene) txt.destroy(); },
        });
      },
    });
  }

  // 4. 镜头打击感（震屏 + 短时停 + 缩放脉冲 + WCAG 安全微闪）
  if (sc.feel) {
    sc.feel.feedback('large', f, {
      trauma: awakened ? 0.85 : 0.68,
      hitStop: awakened ? 0.095 : 0.07,
      zoom: awakened ? 0.055 : 0.036,
      zoomDur: 260,
      flash: { color: colHex, alpha: awakened ? 0.2 : 0.13, dur: 150 },
      particles: 0,
    });
  } else {
    sc.cameras?.main?.shake?.(220, 0.006);
  }
}

// ---------------- v3.6 套装 / 练体 / 南华仙人专项复合特效 ----------------

/** 青龙四件套触发：青玉光柱降临 + 旋转八卦阵 + 青龙偃月斩弧 + 武圣关羽降临 */
export function guanyuSummon(sc, f) {
  const x = f.x; const y = f.y;
  const jade = f.color ?? 0x5fe0b8;

  spawnSpinningRuneRing(sc, x, y, 165, jade, 900, { rotDir: 1, rotRad: 2.1, priority: 3 });
  spawnSpinningRuneRing(sc, x, y, 210, 0xffd36a, 950, { rotDir: -1, rotRad: 1.6, priority: 3 });

  const pillar = vfxImg(sc, x, y + 12, 'vfx_spear_streak', {
    originX: 0, originY: 0.5, rotation: -Math.PI / 2,
    tint: jade, depth: 9152, scaleX: 2.5, scaleY: 1.5, alpha: 0.95, priority: 3,
  });
  if (pillar) {
    vfxTweenDestroy(sc, pillar, { scaleX: 3.1, scaleY: 0.08, alpha: 0, duration: 560, ease: 'Cubic.easeOut' });
  }

  spawnSlashVfx(sc, { x, y: y - 48, a: -0.35, r: 145, arc: 2.3, color: 0x7ff0d0, sparks: true, awakened: true });
  spawnStarSparks(sc, x, y - 50, { count: 10, color: 0xffd36a, dist: 100, dur: 380, priority: 2 });
  if (sc.pGold) sc.pGold.explode(36, x, y - 40);

  if (sc.floatText) sc.floatText(x, y - 140, f.text || '武圣 · 关羽降临！', '#5fe0b8', 30);
  sc.feel?.feedback('large', f, {
    trauma: 0.62, hitStop: 0.065, zoom: 0.035,
    flash: { color: jade, alpha: 0.16, dur: 140 }, particles: 0,
  });
}

/** 吕布无双四件套：交叉猩红金方天画戟弧光 + 吸魂爆闪 */
export function lvbuSlash(sc, f) {
  const x = f.x; const y = f.y;
  const r = f.r ?? 220;
  const crimson = f.color ?? 0xff4a3a;
  const a = f.a ?? 0;

  spawnSlashVfx(sc, { x, y: y - 34, a, r, arc: Math.PI * 1.9, color: crimson, sparks: true, awakened: true });
  spawnSlashVfx(sc, { x, y: y - 34, a: a + Math.PI * 0.5, r: r * 0.88, arc: Math.PI * 1.7, color: 0xffd36a, sparks: true });
  spawnRingVfx(sc, { x, y, r, color: crimson, dur: 0.36, rune: false, priority: 2 });
  spawnStarSparks(sc, x, y - 28, { count: 8, color: 0xffd36a, dist: r * 0.55, priority: 2 });

  if (sc.floatText && f.text !== false) sc.floatText(x, y - 118, f.text || '无双戟舞！', '#ff6a5a', 24);
  sc.feel?.feedback('medium', f, {
    trauma: 0.42, hitStop: 0.045, flash: { color: crimson, alpha: 0.12, dur: 95 }, particles: 0,
  });
}

/** 项羽霸王四件套 / 盘古斧开天破斩：裂地重砸冲击波 + 金焰/玄紫光柱 */
export function bawangSlam(sc, f) {
  const x = f.x; const y = f.y;
  const r = f.r ?? 210;
  const color = f.color ?? 0xff7a30;
  const isPangu = color === 0xc47bff;
  const beamCol = isPangu ? 0xc47bff : 0xffc94a;
  const txtCol = isPangu ? '#c47bff' : '#ff9a3c';
  const defaultTxt = isPangu ? '开天破斩！' : '霸王震岳！';

  const slamBeam = vfxImg(sc, x, y - 190, 'vfx_spear_streak', {
    originX: 1, originY: 0.5, rotation: Math.PI / 2,
    tint: beamCol, depth: 9145, scaleX: 1.45, scaleY: 1.35, alpha: 0.94, priority: 3,
  });
  if (slamBeam) {
    vfxTweenDestroy(sc, slamBeam, { y: y + 6, scaleY: 0.15, alpha: 0, duration: 220, ease: 'Cubic.easeIn' });
  }

  spawnRingVfx(sc, { x, y, r, color, dur: 0.46, rune: true, priority: 2 });
  spawnRingVfx(sc, { x, y, r: r * 0.62, color: 0xffd36a, dur: 0.34, priority: 2 });
  spawnStarSparks(sc, x, y - 12, { count: 10, color, dist: r * 0.65, dur: 340, priority: 2 });

  if (sc.floatText && f.text !== false) sc.floatText(x, y - 126, f.text || defaultTxt, txtCol, 25);
  sc.feel?.feedback('large', f, {
    trauma: 0.64, hitStop: 0.06, zoom: 0.03, flash: { color, alpha: 0.15, dur: 110 }, particles: 0,
  });
}

/** 刑天战神四件套：不屈狂嚎紫金冲击圈 + 战意回血灵光 */
export function xingtianRoar(sc, f) {
  const x = f.x; const y = f.y;
  const r = f.r ?? 220;
  const color = f.color ?? 0xc47bff;

  spawnSpinningRuneRing(sc, x, y, r, color, 620, { rotDir: -1, rotRad: 1.9, priority: 2 });
  spawnRingVfx(sc, { x, y, r: r * 1.05, color: 0xff5a4a, dur: 0.44, priority: 2 });

  const dome = vfxImg(sc, x, y - 30, 'vfx_glow_orb', {
    tint: color, depth: 9120, scale: 1.4, alpha: 0.72, priority: 2,
  });
  if (dome) {
    vfxTweenDestroy(sc, dome, { scale: 2.5, alpha: 0, duration: 360, ease: 'Cubic.easeOut' });
  }
  spawnStarSparks(sc, x, y - 24, { count: 8, color: 0x5fe08a, dist: r * 0.5, priority: 1 });

  if (sc.floatText && f.text !== false) sc.floatText(x, y - 126, f.text || '战神怒吼！', '#d8a8ff', 24);
  sc.feel?.feedback('medium', f, { trauma: 0.44, hitStop: 0.04, flash: false, particles: 0 });
}

/** 挨打练体反伤射线：金色反震光枪直刺攻击者 */
export function thornsRay(sc, f) {
  const x1 = f.x1 ?? f.x ?? 0;
  const y1 = f.y1 ?? f.y ?? 0;
  const x2 = f.x2 ?? x1;
  const y2 = f.y2 ?? y1;
  spawnBeamVfx(sc, { x1, y1, x2, y2, w: 9, color: f.color ?? 0xffd36a, dur: 0.2, sonic: false });
  spawnStarSparks(sc, x2, y2, { count: 4, color: 0xffd36a, dist: 38, dur: 200, scale: 0.36 });
}

/** 挨打练体「金钟罩体 / 金刚不坏」金色震荡波 */
export function goldenNova(sc, f) {
  const x = f.x; const y = f.y;
  const r = f.r ?? 220;
  const gold = f.color ?? 0xffd36a;

  spawnSpinningRuneRing(sc, x, y, r, gold, 640, { rotDir: 1, rotRad: 1.7, priority: 2 });
  spawnRingVfx(sc, { x, y, r: r * 1.08, color: 0xfff0b0, dur: 0.42, priority: 2 });
  const bell = vfxImg(sc, x, y - 34, 'vfx_glow_orb', {
    tint: gold, depth: 9125, scale: 1.25, alpha: 0.85, priority: 2,
  });
  if (bell) {
    vfxTweenDestroy(sc, bell, { scale: 2.4, alpha: 0, duration: 380, ease: 'Cubic.easeOut' });
  }
  spawnStarSparks(sc, x, y - 24, { count: 10, color: gold, dist: r * 0.6, dur: 320, priority: 2 });
  if (sc.floatText && f.text) sc.floatText(x, y - 122, f.text, '#ffd36a', 24);
  sc.feel?.feedback('medium', f, {
    trauma: 0.42, hitStop: 0.04, flash: { color: gold, alpha: 0.12, dur: 100 }, particles: 0,
  });
}

/** 挨打练体单次受击金光微震反馈 */
export function temperHit(sc, f) {
  const x = f.x; const y = f.y - 24;
  const wave = vfxImg(sc, x, y, 'vfx_impact_wave', {
    tint: f.color ?? 0xffd36a, depth: 9106, scaleX: 0.18, scaleY: 0.24, alpha: 0.72, priority: 1,
  });
  if (wave) {
    vfxTweenDestroy(sc, wave, { scaleX: 0.48, scaleY: 0.56, alpha: 0, duration: 200, ease: 'Cubic.easeOut' });
  }
  spawnStarSparks(sc, x, y, { count: 3, color: 0xffd36a, dist: 36, dur: 180, scale: 0.34, priority: 1 });
  sc.feel?.feedback('small', f, { trauma: 0.12, particles: 0 });
}

/** 挨打练体里程碑突破（皮糙肉厚 → 万劫不灭体） */
export function temperBreak(sc, f) {
  const x = f.x; const y = f.y;
  const gold = f.color ?? 0xffd36a;

  spawnSpinningRuneRing(sc, x, y, 185, gold, 880, { rotDir: 1, rotRad: 2.0, priority: 3 });
  spawnSpinningRuneRing(sc, x, y, 140, 0xfff0b0, 760, { rotDir: -1, rotRad: 2.2, priority: 3 });
  const pillar = vfxImg(sc, x, y + 8, 'vfx_spear_streak', {
    originX: 0, originY: 0.5, rotation: -Math.PI / 2,
    tint: gold, depth: 9152, scaleX: 2.2, scaleY: 1.35, alpha: 0.92, priority: 3,
  });
  if (pillar) {
    vfxTweenDestroy(sc, pillar, { scaleY: 0.1, alpha: 0, duration: 500, ease: 'Cubic.easeOut' });
  }
  spawnStarSparks(sc, x, y - 36, { count: 12, color: gold, dist: 110, dur: 400, scale: 0.56, priority: 2 });
  if (sc.pGold) sc.pGold.explode(36, x, y - 40);
  if (sc.floatText) sc.floatText(x, y - 142, f.name ? `练体突破 · ${f.name}！` : (f.text || '练体突破！'), '#ffd36a', 30);
  sc.feel?.feedback('large', f, {
    trauma: 0.65, hitStop: 0.075, zoom: 0.04, flash: { color: gold, alpha: 0.18, dur: 150 }, particles: 0,
  });
}

/** 南华仙人：神兵强化 / 渡劫飞升玄青仙光 */
export function nanhuaFx(sc, f) {
  const x = f.x; const y = f.y;
  const big = !!f.big;
  const col = f.color ?? (big ? 0xffd36a : 0x7fe3ff);

  spawnSpinningRuneRing(sc, x, y, big ? 200 : 120, col, big ? 920 : 540, { rotDir: 1, rotRad: 2.2, priority: big ? 3 : 2 });
  if (big) {
    spawnSpinningRuneRing(sc, x, y, 260, 0x7fe3ff, 1000, { rotDir: -1, rotRad: 2.5, priority: 3 });
    const pillar = vfxImg(sc, x, y + 10, 'vfx_spear_streak', {
      originX: 0, originY: 0.5, rotation: -Math.PI / 2,
      tint: col, depth: 9155, scaleX: 2.6, scaleY: 1.5, alpha: 0.94, priority: 3,
    });
    if (pillar) {
      vfxTweenDestroy(sc, pillar, { scaleY: 0.1, alpha: 0, duration: 560, ease: 'Cubic.easeOut' });
    }
  }

  const orb = vfxImg(sc, x, y - 34, 'vfx_glow_orb', {
    tint: col, depth: 9140, scale: big ? 1.5 : 0.85, alpha: 0.88, priority: 2,
  });
  if (orb) {
    vfxTweenDestroy(sc, orb, { scale: orb.scaleX * 2.1, alpha: 0, duration: big ? 480 : 320, ease: 'Cubic.easeOut' });
  }
  spawnStarSparks(sc, x, y - 36, { count: big ? 12 : 6, color: col, dist: big ? 115 : 65, dur: 380, priority: 2 });
  if (sc.pGold) sc.pGold.explode(big ? 42 : 16, x, y - 40);

  if (f.text && sc.floatText) {
    sc.floatText(x, y - (big ? 148 : 112), f.text, big ? '#ffd36a' : '#7fe3ff', big ? 30 : 22);
  }
  if (big) {
    sc.feel?.feedback('large', f, {
      trauma: 0.65, hitStop: 0.07, zoom: 0.04, flash: { color: col, alpha: 0.18, dur: 150 }, particles: 0,
    });
  } else {
    sc.feel?.feedback('small', f, { trauma: 0.18, particles: 0 });
  }
}

// ---------------- 上古神器复合特效（女娲石 / 东皇钟 / 伏羲琴） ----------------

/** 女娲石：翠金莲华复活阵 + 八卦光柱 + 星芒爆发 + 涅槃重生 */
export function nuwaRevive(sc, f) {
  const x = f.x; const y = f.y;
  const jade = f.color ?? 0x5fe08a;
  const gold = 0xffd36a;

  spawnSpinningRuneRing(sc, x, y, 200, jade, 960, { rotDir: 1, rotRad: 2.2, priority: 3 });
  spawnSpinningRuneRing(sc, x, y, 150, gold, 880, { rotDir: -1, rotRad: 2.4, priority: 3 });

  const pillar = vfxImg(sc, x, y + 10, 'vfx_spear_streak', {
    originX: 0, originY: 0.5, rotation: -Math.PI / 2,
    tint: jade, depth: 9155, scaleX: 2.6, scaleY: 1.55, alpha: 0.96, priority: 3,
  });
  if (pillar) {
    vfxTweenDestroy(sc, pillar, { scaleX: 3.1, scaleY: 0.08, alpha: 0, duration: 580, ease: 'Cubic.easeOut' });
  }

  const orb = vfxImg(sc, x, y - 34, 'vfx_glow_orb', {
    tint: jade, depth: 9145, scale: 1.45, alpha: 0.92, priority: 3,
  });
  if (orb) {
    vfxTweenDestroy(sc, orb, { scale: 2.8, alpha: 0, duration: 480, ease: 'Cubic.easeOut' });
  }

  spawnRingVfx(sc, { x, y, r: f.r ?? 260, color: jade, dur: 0.55, rune: false, priority: 2 });
  spawnStarSparks(sc, x, y - 34, { count: 10, color: gold, dist: 120, dur: 420, scale: 0.58, priority: 2 });
  spawnStarSparks(sc, x, y - 34, { count: 6, color: jade, dist: 95, dur: 380, scale: 0.5, priority: 2 });
  if (sc.pGold) sc.pGold.explode(36, x, y - 40);
  if (sc.pHeal) sc.pHeal.explode(16, x, y - 24);

  if (sc.floatText && f.text !== false) {
    sc.floatText(x, y - 144, f.text || '女娲石·涅槃重生！', '#5fe08a', 28);
  }
  sc.feel?.feedback('medium', f, {
    trauma: 0.44, hitStop: 0.05, zoom: 0.028, flash: { color: jade, alpha: 0.16, dur: 140 }, particles: 0,
  });
}

/** 东皇钟：金钟震波 + 紫金禁言符文阵 + 万法沉默 */
export function donghuangSilence(sc, f) {
  const x = f.x; const y = f.y;
  const r = f.r ?? 280;
  const gold = f.color ?? 0xffd36a;
  const violet = 0xc47bff;

  spawnSpinningRuneRing(sc, x, y, r, gold, 780, { rotDir: 1, rotRad: 1.9, priority: 3 });
  spawnSpinningRuneRing(sc, x, y, r * 0.72, violet, 720, { rotDir: -1, rotRad: 2.3, priority: 3 });
  spawnRingVfx(sc, { x, y, r: r * 1.05, color: gold, dur: 0.48, priority: 2 });

  const bellDome = vfxImg(sc, x, y - 36, 'vfx_glow_orb', {
    tint: gold, depth: 9130, scale: 1.5, alpha: 0.88, priority: 2,
  });
  if (bellDome) {
    vfxTweenDestroy(sc, bellDome, { scale: 2.8, alpha: 0, duration: 420, ease: 'Cubic.easeOut' });
  }

  spawnStarSparks(sc, x, y - 24, { count: 10, color: violet, dist: r * 0.65, dur: 360, scale: 0.56, priority: 2 });
  spawnStarSparks(sc, x, y - 24, { count: 6, color: gold, dist: r * 0.48, dur: 320, scale: 0.48, priority: 1 });

  if (sc.floatText && f.text !== false) {
    sc.floatText(x, y - 138, f.text || '东皇钟·万法沉默！', '#ffd36a', 28);
  }
  sc.feel?.feedback('medium', f, {
    trauma: 0.5, hitStop: 0.048, zoom: 0.025, flash: { color: gold, alpha: 0.14, dur: 115 }, particles: 0,
  });
}

/** 伏羲琴：翠青双色扩散音律波纹 + 莲华治疗粒子 */
export function fuxiHeal(sc, f) {
  const x = f.x; const y = f.y;
  const r = f.r ?? 320;
  const jade = 0x5fe08a;
  const cyan = 0x7fe3ff;

  spawnRingVfx(sc, { x, y, r: r * 0.92, color: jade, dur: 0.52, rune: true, priority: 2 });

  // 第二重错峰青色音律波纹
  const echoWave = vfxImg(sc, x, y, 'vfx_impact_wave', {
    tint: cyan, depth: 9088, scaleX: 0.35, scaleY: 0.19, alpha: 0.88, priority: 2,
  });
  if (echoWave) {
    vfxTweenDestroy(sc, echoWave, {
      scaleX: (r * 2.15) / 180, scaleY: (r * 1.18) / 180, alpha: 0, delay: 90, duration: 480, ease: 'Cubic.easeOut',
    });
  }

  const orb = vfxImg(sc, x, y - 24, 'vfx_glow_orb', {
    tint: cyan, depth: 9115, scale: 0.95, alpha: 0.72, priority: 1,
  });
  if (orb) {
    vfxTweenDestroy(sc, orb, { scale: 1.9, alpha: 0, duration: 380, ease: 'Cubic.easeOut' });
  }

  spawnStarSparks(sc, x, y - 22, { count: 6, color: jade, dist: r * 0.35, dur: 360, scale: 0.42, priority: 1 });
  spawnStarSparks(sc, x, y - 22, { count: 4, color: cyan, dist: r * 0.45, dur: 380, scale: 0.38, priority: 1 });
  if (sc.pHeal) sc.pHeal.explode(16, x, y - 20);
  if (f.text && sc.floatText) {
    sc.floatText(x, y - 124, f.text, '#7fe3ff', 22);
  }
}
