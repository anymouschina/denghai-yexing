// 程序生成的特效贴图（粒子、光晕、圈、阴影、雾、伤害数字位图字）。Boot.create 调用一次
// 全部画成白色/灰度，运行时用 tint 上色，一张贴图多处复用，合批更省

const DMG_CHARS = '0123456789!+-';
const DMG_CELL_W = 48;
const DMG_CELL_H = 60;
export const SHADOW_MIN = 16;
export const SHADOW_MAX = 208;
export const SHADOW_STEP = 8;

function canvas(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const t = scene.textures.createCanvas(key, w, h);
  draw(t.getContext(), w, h, t);
  t.refresh();
  return t;
}

// 可复现的伪随机，保证每次生成的贴图一致
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeFxTextures(scene) {
  // 预缩放的阴影帧（宽 16…208，每 8px 一档），给 Blitter 用：Bob 不能缩放，但几百个 Bob 一次合批画完
  let sy = 0;
  const rows = [];
  for (let w = SHADOW_MIN; w <= SHADOW_MAX; w += SHADOW_STEP) {
    const h = Math.max(6, Math.round(w * 0.34));
    rows.push([w, h, sy]);
    sy += h + 2;
  }
  const sh = canvas(scene, 'fx_shadows', SHADOW_MAX, sy, (c) => {
    for (const [w, h, y] of rows) {
      c.save();
      c.translate(0, y);
      c.scale(1, h / w);
      const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.8)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
      c.restore();
    }
  });
  rows.forEach(([w, h, y], i) => sh.add(i, 0, 0, y, w, h));

  // 火路：暖橙椭圆光斑（颜色烘进贴图，Blitter 用 ADD 叠加）
  canvas(scene, 'fx_trail', 64, 34, (c, w, h) => {
    c.save();
    c.scale(1, h / w);
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,224,120,0.9)');
    g.addColorStop(0.3, 'rgba(255,150,50,0.6)');
    g.addColorStop(0.7, 'rgba(230,80,30,0.22)');
    g.addColorStop(1, 'rgba(200,40,20,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, w);
    c.restore();
  });

  // 冲击波：软边粗环（亮边在外沿）
  canvas(scene, 'fx_shock', 128, 128, (c, w, h) => {
    const g = c.createRadialGradient(64, 64, 30, 64, 64, 63);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.04)');
    g.addColorStop(0.86, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.93, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });

  // 四芒星闪光（暴击/命中/闪电落点）
  canvas(scene, 'fx_flare', 64, 64, (c, w, h) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff';
    for (const [rx, ry] of [[30, 3], [3, 30]]) {
      c.beginPath();
      c.moveTo(32 - rx, 32);
      c.quadraticCurveTo(32, 32 - ry, 32 + rx, 32);
      c.quadraticCurveTo(32, 32 + ry, 32 - rx, 32);
      c.fill();
    }
  });

  // 火星：拉长的光条
  canvas(scene, 'fx_spark', 32, 8, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(w / 2, h / 2, w / 2, h / 2 - 0.5, 0, 0, Math.PI * 2);
    c.fill();
  });

  // 烟团：不规则的软云
  canvas(scene, 'fx_puff', 64, 64, (c) => {
    const r = prng(7);
    for (let i = 0; i < 7; i++) {
      const x = 20 + r() * 24;
      const y = 20 + r() * 24;
      const rad = 10 + r() * 12;
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
    }
  });

  // 纸屑：4 帧（白纸片、黄符碎片、撕裂三角、纸钱圆孔），粗黑描边配合画风
  const scraps = canvas(scene, 'fx_scraps', 64, 16, (c) => {
    c.lineJoin = 'round';
    c.strokeStyle = '#0b0d18';
    c.lineWidth = 2;
    // 0 白纸片
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(2, 4); c.lineTo(13, 2); c.lineTo(14, 11); c.lineTo(3, 13); c.closePath(); c.fill(); c.stroke();
    // 1 符纸碎片（带朱砂笔画）
    c.fillStyle = '#ffe9a8';
    c.beginPath(); c.moveTo(19, 2); c.lineTo(28, 3); c.lineTo(29, 14); c.lineTo(20, 13); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = '#d8382e'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(24, 4); c.lineTo(24, 12); c.moveTo(21.5, 7); c.lineTo(26.5, 7); c.stroke();
    c.strokeStyle = '#0b0d18'; c.lineWidth = 2;
    // 2 撕裂三角
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(34, 3); c.lineTo(46, 6); c.lineTo(37, 14); c.closePath(); c.fill(); c.stroke();
    // 3 纸钱（圆形方孔）
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(56, 8, 6, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#0b0d18'; c.fillRect(54.5, 6.5, 3, 3);
  });
  for (let i = 0; i < 4; i++) scraps.add(i, 0, i * 16, 0, 16, 16);

  // 近景雾：多团噪声云叠出来的长条，比 Boot 的 fog 更有形
  canvas(scene, 'fx_mist', 512, 192, (c, w, h) => {
    const r = prng(42);
    for (let i = 0; i < 46; i++) {
      const x = 40 + r() * (w - 80);
      const y = h / 2 + (r() - 0.5) * h * 0.5;
      const rad = 30 + r() * 60;
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      const a = 0.08 + r() * 0.1;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
    // 两端羽化，拼接时不露边
    c.globalCompositeOperation = 'destination-in';
    const fade = c.createLinearGradient(0, 0, w, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.2, 'rgba(0,0,0,1)');
    fade.addColorStop(0.8, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fade;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  });

  // 伤害数字位图字：白字 + 墨色粗描边，运行时 tint 上色；位图字改数字不重绘纹理，比 Text 便宜得多
  const metrics = [];
  canvas(scene, 'fx_dmgfont', DMG_CELL_W * DMG_CHARS.length, DMG_CELL_H, (c) => {
    c.font = '900 42px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 8;
    c.strokeStyle = '#0b0d18';
    for (let i = 0; i < DMG_CHARS.length; i++) {
      const ch = DMG_CHARS[i];
      const cx = i * DMG_CELL_W + DMG_CELL_W / 2;
      const cy = DMG_CELL_H / 2 + 2;
      c.strokeText(ch, cx, cy);
      // 两阶明暗：下半略灰，tint 后呈现赛璐璐感
      const g = c.createLinearGradient(0, cy - 16, 0, cy + 16);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.55, '#ffffff');
      g.addColorStop(0.56, '#c9c9d6');
      g.addColorStop(1, '#c9c9d6');
      c.fillStyle = g;
      c.fillText(ch, cx, cy);
      const gw = Math.min(DMG_CELL_W, Math.ceil(c.measureText(ch).width + 9));
      metrics.push(gw);
    }
  });
  const tex = 'fx_dmgfont';
  const tw = DMG_CELL_W * DMG_CHARS.length;
  const chars = {};
  for (let i = 0; i < DMG_CHARS.length; i++) {
    const gw = metrics[i];
    const x = Math.round(i * DMG_CELL_W + (DMG_CELL_W - gw) / 2);
    chars[DMG_CHARS.charCodeAt(i)] = {
      x, y: 0, width: gw, height: DMG_CELL_H, centerX: gw / 2, centerY: DMG_CELL_H / 2,
      xOffset: 0, yOffset: 0, xAdvance: gw - 7, data: {}, kerning: {},
      u0: x / tw, v0: 0, u1: (x + gw) / tw, v1: 1,
    };
  }
  if (scene.cache.bitmapFont.exists('dmgfont')) scene.cache.bitmapFont.remove('dmgfont');
  scene.cache.bitmapFont.add('dmgfont', {
    data: { retroFont: true, font: tex, size: DMG_CELL_H, lineHeight: DMG_CELL_H, chars },
    texture: tex,
    frame: null,
  });
}

export const DMG_FONT_RE = /^[0-9!+\-]+$/;
