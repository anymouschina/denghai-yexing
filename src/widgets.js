import { TF, BF, NF, INK } from './fonts.js';
import { sfx } from './audio.js';
import { touch } from './touch.js';

const INK_N = 0x0b0d18;

// 木牌按钮：粗黑边 + 底部厚阴影；悬停放大+橙边、按下下沉变暗、松开回弹。
// 禁用态换成灰石色 + 暗字（不只降透明度），一眼可辨。
export function makeButton(scene, x, y, w, h, label, onClick, opts = {}) {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const txt = scene.add.text(0, -2, label, {
    fontFamily: opts.font || TF, fontSize: `${opts.size || 30}px`, color: '#f3e6c8',
  }).setOrigin(0.5);
  const draw = () => {
    g.clear();
    const pressed = c.pressed && c.hover && c.enabled;
    const dy = pressed ? 4 : 0;
    g.fillStyle(INK_N).fillRoundedRect(-w / 2, -h / 2 + 6, w, h, 10);
    let top;
    let shine;
    let fg;
    if (!c.enabled) { top = 0x34364a; shine = 0x3d4056; fg = '#80839c'; }
    else if (opts.primary) { top = pressed ? 0xc95f14 : 0xf08a2c; shine = 0xffb15a; fg = '#141a33'; }
    else { top = pressed ? 0x15183a : 0x262b5e; shine = c.hover ? 0x3b428a : 0x323874; fg = '#f3e6c8'; }
    g.fillStyle(top).fillRoundedRect(-w / 2, -h / 2 + dy, w, h, 10);
    if (!pressed) g.fillStyle(shine).fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h * 0.42, 7);
    g.lineStyle(3, c.hover && c.enabled ? 0xff9a3c : INK_N).strokeRoundedRect(-w / 2, -h / 2 + dy, w, h, 10);
    txt.setColor(fg);
    txt.y = -2 + dy;
  };
  const hit = scene.add.rectangle(0, 0, touch.enabled ? w + 24 : w, touch.enabled ? Math.max(h + 6, 74) : h + 6, 0x000000, 0.001).setInteractive({ useHandCursor: true });
  c.add([g, txt, hit]);
  c.label = txt;
  c.hover = false;
  c.pressed = false;
  c.enabled = true;
  c.redraw = draw;
  draw();
  hit.on('pointerover', () => {
    c.hover = true;
    draw();
    if (c.enabled) scene.tweens.add({ targets: c, scale: 1.05, duration: 90 });
  });
  hit.on('pointerout', () => { c.hover = false; c.pressed = false; draw(); scene.tweens.add({ targets: c, scale: 1, duration: 90 }); });
  hit.on('pointerdown', () => {
    c.pressed = true;
    c.hover = true;
    draw();
    if (c.enabled) scene.tweens.add({ targets: c, scale: 0.97, duration: 50 });
  });
  hit.on('pointerup', () => {
    const was = c.pressed;
    c.pressed = false;
    draw();
    if (!was || !c.enabled) return;
    sfx('click');
    scene.tweens.add({ targets: c, scale: { from: 0.93, to: c.hover ? 1.05 : 1 }, duration: 200, ease: 'Back.easeOut' });
    onClick();
  });
  c.setEnabled = (on) => {
    c.enabled = on;
    hit.input.cursor = on ? 'pointer' : 'not-allowed';
    c.setAlpha(on ? 1 : 0.85);
    draw();
    return c;
  };
  c.setLabel = (s) => { txt.setText(s); return c; };
  return c;
}

// 面板：黑色厚阴影 + 墨蓝紫渐变底 + 粗描边
export function drawPanel(g, x, y, w, h, opts = {}) {
  const r = opts.r || 18;
  g.fillStyle(INK_N).fillRoundedRect(x, y + (opts.shadow ?? 10), w, h, r);
  g.fillStyle(0x201e48).fillRoundedRect(x, y, w, h, r);
  for (let i = 0; i < 6; i++) g.fillStyle(0x2a3068, 0.13).fillRoundedRect(x + 4, y + 4, w - 8, Math.min(h - 8, 30 + i * 34), r - 2);
  if (opts.glow) g.lineStyle(10, opts.glow, 0.16).strokeRoundedRect(x - 5, y - 5, w + 10, h + 10, r + 4);
  g.lineStyle(4, INK_N).strokeRoundedRect(x, y, w, h, r);
  return g;
}

// 小方框（结算统计格等）
export function drawBox(g, x, y, w, h) {
  g.fillStyle(0x141838).fillRoundedRect(x, y, w, h, 10);
  g.lineStyle(2, 0x343c70).strokeRoundedRect(x, y, w, h, 10);
  return g;
}

// 键帽：等宽字 + 底边加厚
export function keycap(scene, x, y, label, size = 14) {
  const c = scene.add.container(x, y);
  const t = scene.add.text(0, -1, label, { fontFamily: /^[\x20-\x7e]+$/.test(label) ? NF : BF, fontSize: `${size}px`, color: '#f3e6c8' }).setOrigin(0.5);
  const w = Math.max(28, t.width + 16);
  const h = size + 14;
  const g = scene.add.graphics();
  g.fillStyle(0x59609a).fillRoundedRect(-w / 2, -h / 2, w, h, 6);
  g.fillStyle(0x1a1f45).fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 6, 5);
  c.add([g, t]);
  c.w = w;
  return c;
}

// 一行「键帽 + 说明」，返回总宽度
export function hintRow(scene, x, y, parts, color = '#c4c8ea') {
  let cx = x;
  const items = [];
  for (const p of parts) {
    if (p.key) {
      const k = keycap(scene, 0, y, p.key);
      k.x = cx + k.w / 2;
      cx += k.w + 4;
      items.push(k);
    } else {
      const t = scene.add.text(cx + 4, y, p.text, { fontFamily: BF, fontSize: '16px', color, stroke: INK, strokeThickness: 4 }).setOrigin(0, 0.5);
      cx += t.width + 12;
      items.push(t);
    }
  }
  return { width: cx - x, items };
}

export function popIn(scene, target, delay = 0) {
  target.setScale(0.85).setAlpha(0);
  scene.tweens.add({ targets: target, scale: 1, alpha: 1, duration: 280, delay, ease: 'Back.easeOut' });
}

// 数值变化时的跳动
export function bump(scene, target, s = 1.35) {
  scene.tweens.killTweensOf(target);
  target.setScale(s);
  scene.tweens.add({ targets: target, scale: 1, duration: 260, ease: 'Back.easeOut' });
}

// 数字滚动累加
export function countUp(scene, text, to, duration = 1100, fmtFn = (v) => String(v), onDone) {
  const o = { v: 0 };
  text.setText(fmtFn(0));
  return scene.tweens.add({
    targets: o, v: to, duration, ease: 'Cubic.easeOut',
    onUpdate: () => text.setText(fmtFn(Math.round(o.v))),
    onComplete: () => { text.setText(fmtFn(to)); if (onDone) onDone(); },
  });
}

export const strokeText = (extra = {}) => ({ stroke: INK, strokeThickness: 6, ...extra });
export const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const fmtNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
