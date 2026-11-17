// 表现：飘字、特效池、爆炸/冲击环、死亡粒子、阴影/预警/火路/闪电/雾的逐帧绘制
// 以 Object.assign 混入 Game.prototype，方法里的 this 即 Game 场景
//
// 性能约定（200 只同屏 60 帧）：
// - 所有特效对象都进池，预热后逐帧零分配；动画在 drawWorld 里手动推进，不为每个特效建 tween
// - 阴影、火路用 Blitter（一次合批，Bob 不进显示列表排序）；伤害数字用位图字（改字不重绘纹理）
// - 每帧只遍历一次活动特效数组，删除用交换删除
import { DMG_FONT_RE, SHADOW_MIN, SHADOW_MAX, SHADOW_STEP } from './fxTextures.js';

const SHADOW_FRAMES = (SHADOW_MAX - SHADOW_MIN) / SHADOW_STEP;
const DMG_POOL = 140;
const BOLT_SEG = 7;

// 飘字样式：pop 峰值缩放、持续、上飘速度、终值缩放
const STYLE = {
  normal: { peak: 1.35, rest: 1, dur: 0.72, vy: -70, drag: 3.2 },
  crit:   { peak: 2.0, rest: 1.25, dur: 0.95, vy: -55, drag: 2.4 },
  burn:   { peak: 1.1, rest: 0.9, dur: 0.55, vy: -60, drag: 1.5 },
  text:   { peak: 1.25, rest: 1, dur: 0.95, vy: -55, drag: 2.2 },
};

const colorCache = new Map();
function hexColor(str) {
  if (typeof str === 'number') return str;
  let c = colorCache.get(str);
  if (c === undefined) {
    c = parseInt(String(str).replace('#', ''), 16);
    if (Number.isNaN(c)) c = 0xffffff;
    colorCache.set(str, c);
  }
  return c;
}

const easeOutCubic = (k) => 1 - (1 - k) * (1 - k) * (1 - k);
const easeOutBack = (k) => { const c = 1.9; const m = k - 1; return 1 + (c + 1) * m * m * m + c * m * m; };

export const fxMethods = {
  // ---------------- 初始化（懒加载；场景重开后 fxPool 换了新数组即重建） ----------------
  ensureFx() {
    if (this._fxKey === this.fxPool) return;
    this._fxKey = this.fxPool;
    this._live = [];          // 活动特效记录
    this._recPool = [];       // 记录对象池
    this._imgPool = [];       // 内部 Image 池（与 getFx 的外部池分开，避免 tween 冲突）
    this._boltPts = new Float32Array((BOLT_SEG + 1) * 2);

    // 伤害数字位图字池
    this._dmg = [];
    this._dmgIdx = 0;
    for (let i = 0; i < DMG_POOL; i++) {
      const t = this.add.bitmapText(0, 0, 'dmgfont', '0', 60).setOrigin(0.5).setDepth(9610).setVisible(false);
      t._rec = null;
      this._dmg.push(t);
    }
    for (const t of this.texts) t._rec = null;

    // 阴影 / 火路：Blitter
    this._shadowBl = this.add.blitter(0, 0, 'fx_shadows').setDepth(-7990);
    this._shadowBobs = [];
    this._shadowUsed = 0;
    this._trailBl = this.add.blitter(0, 0, 'fx_trail').setDepth(-6900).setBlendMode('ADD');
    this._trailBobs = [];
    this._trailUsed = 0;
    if (this.shadowG) this.shadowG.clear();
    if (this.trailG) this.trailG.clear();

    // 第二、三层雾：地面薄雾（在角色下方、视差 0.85）与近景雾（屏幕最上层、视差 1.3，更快更淡）
    this._mists = [];
    const R = this.rng || Math.random;
    for (let i = 0; i < 6; i++) {
      const m = this.add.image(0, 0, 'fx_mist').setScrollFactor(0).setDepth(-9500).setTint(0x7d8fd8)
        .setAlpha(0.22 + R() * 0.12).setScale(1.6 + R() * 0.8, 1 + R() * 0.5).setBlendMode('ADD');
      Object.assign(m, { bx: R() * 2200, by: R() * 1000, vx: 6 + R() * 8, par: 0.85, wrapX: 2200, wrapY: 1000, ox: 460, oy: 160, ph: R() * 6 });
      this._mists.push(m);
    }
    for (let i = 0; i < 4; i++) {
      const m = this.add.image(0, 0, 'fx_mist').setScrollFactor(0).setDepth(9420).setTint(0xa98ee0)
        .setAlpha(0.1 + R() * 0.06).setScale(2.4 + R(), 1.6 + R() * 0.6);
      Object.assign(m, { bx: R() * 2600, by: R() * 1100, vx: 22 + R() * 18, par: 1.3, wrapX: 2600, wrapY: 1100, ox: 660, oy: 220, ph: R() * 6 });
      this._mists.push(m);
    }

    // 死亡粒子：纸屑（4 帧随机、带重力与翻飞）、鬼火上飘、火星光条、烟团
    const base = { emitting: false, angle: { min: 0, max: 360 }, alpha: { start: 1, end: 0 } };
    const scrap = this.add.particles(0, 0, 'fx_scraps', {
      ...base, frame: [0, 1, 2, 3], speed: { min: 90, max: 300 }, lifespan: { min: 550, max: 1000 },
      scale: { start: 1.25, end: 0.6 }, rotate: { start: 0, end: { min: -540, max: 540 } }, gravityY: 420,
      alpha: { start: 1, end: 0, ease: 'Quad.easeIn' }, maxParticles: 500,
    }).setDepth(9100);
    if (this.pPaper && this.pPaper !== scrap) this.pPaper.destroy();
    this.pPaper = scrap; // 原有 kill() 读 this.pPaper.explode()，直接换成新纸屑
    this._emWisp = this.add.particles(0, 0, 'glow', {
      ...base, angle: { min: 240, max: 300 }, speed: { min: 30, max: 120 }, lifespan: { min: 500, max: 1100 },
      scale: { start: 0.55, end: 0 }, gravityY: -120, tint: [0x7fe3ff, 0x9fa8ff, 0xd0f6ff], blendMode: 'ADD', maxParticles: 300,
    }).setDepth(9110);
    this._emStreak = this.add.particles(0, 0, 'fx_spark', {
      ...base, speed: { min: 220, max: 520 }, lifespan: { min: 180, max: 380 }, scale: { start: 1.1, end: 0.2 },
      tint: [0xffd36a, 0xffa040, 0xfff2c0], blendMode: 'ADD', maxParticles: 300,
      // 光条沿飞行方向：Phaser 先算 rotate 再算 angle，所以在 rotate 里抽随机角、angle 复用它
      rotate: { onEmit: (p) => (p.fxA = Math.random() * 360) },
      angle: { onEmit: (p) => p.fxA },
    }).setDepth(9120);
    this._emSmoke = this.add.particles(0, 0, 'fx_puff', {
      ...base, speed: { min: 15, max: 60 }, lifespan: { min: 500, max: 900 }, scale: { start: 0.6, end: 1.5 },
      alpha: { start: 0.45, end: 0 }, tint: [0x3a3550, 0x4b4466, 0x2a2840], rotate: { min: 0, max: 360 }, maxParticles: 160,
    }).setDepth(9090);

  },

  _rec() {
    const r = this._recPool.pop() || {};
    this._live.push(r);
    return r;
  },

  _img(tex) {
    let f = this._imgPool.pop();
    if (!f) f = this.add.image(0, 0, tex);
    return f.setTexture(tex).setVisible(true).setRotation(0).setAlpha(1).setScale(1).setOrigin(0.5).clearTint().setBlendMode('NORMAL');
  },

  // ---------------- 飘字 ----------------
  // 伤害数字按样式区分：普通白、暴击金色大字带“!”、灼烧橙色小字、玩家受伤红色
  floatText(x, y, str, color, size = 22) {
    this.ensureFx();
    const s = String(str);
    const kind = size >= 30 ? 'crit' : size <= 17 ? 'burn' : 'normal';
    const bitmap = DMG_FONT_RE.test(s);
    let o;
    if (bitmap) {
      o = this._dmg[this._dmgIdx];
      this._dmgIdx = (this._dmgIdx + 1) % this._dmg.length;
      o.setText(s).setTint(hexColor(color));
    } else {
      o = this.texts[this.textIdx];
      this.textIdx = (this.textIdx + 1) % this.texts.length;
      this.tweens.killTweensOf(o);
      o.setText(s).setColor(color).setFontSize(size);
    }
    // 复用的对象若还在播放，直接把旧记录作废
    if (o._rec) o._rec.dead = true;
    const st = STYLE[bitmap ? kind : 'text'];
    const r = this._rec();
    r.type = 'text';
    r.dead = false;
    r.o = o;
    r.t = 0;
    r.dur = st.dur;
    r.st = st;
    r.x = x;
    r.y = y;
    r.vy = st.vy;
    r.vx = (Math.random() - 0.5) * (kind === 'crit' ? 50 : 30);
    r.base = bitmap ? size / (kind === 'normal' ? 34 : 40) : 1;
    r.kind = kind;
    o._rec = r;
    o.setPosition(x, y).setVisible(true).setAlpha(1).setScale(r.base * 0.3).setRotation(0);
    o.setDepth(kind === 'crit' ? 9620 : bitmap ? 9610 : 9600);
    if (kind === 'crit' && bitmap) this.flashFx(x, y, 0xffc977, 1.3);
  },

  // ---------------- 外部特效池（combat.js 等用 getFx + tween + freeFx） ----------------
  getFx(tex) {
    let f = this.fxPool.pop();
    if (!f) f = this.add.image(0, 0, tex);
    this.tweens.killTweensOf(f);
    return f.setTexture(tex).setVisible(true).setRotation(0).setAlpha(1).clearTint().setBlendMode('NORMAL');
  },

  freeFx(f) {
    f.setVisible(false);
    this.fxPool.push(f);
  },

  // ---------------- 爆炸 / 冲击环 / 闪光 / 死亡 ----------------
  boomFx(x, y, scale = 1) {
    this.ensureFx();
    const r = this._rec();
    r.type = 'boom';
    r.dead = false;
    r.o = this._img('fx_boom').setPosition(x, y).setDepth(8700).setScale(scale * 0.3).setRotation(Math.random() * 6.28);
    r.t = 0;
    r.dur = 0.42;
    r.s = scale;
    // 外圈冲击波 + 中心闪光 + 火星 + 烟
    this.shockFx(x, y + 10, 70 * scale, 0xffb060, 0.36);
    this.flashFx(x, y, 0xfff0c0, 2.2 * scale);
    this.pSpark.explode(Math.round(10 * scale), x, y);
    this._emStreak.explode(Math.min(24, Math.round(10 * scale)), x, y);
    this._emSmoke.explode(Math.min(10, Math.round(4 * scale)), x, y);
  },

  // 地面冲击环：主环（ring，按 3/4 视角压扁）+ 软光环，外扩并淡出
  ringFx(x, y, r, color = 0xffffff) {
    this.ensureFx();
    const a = this._rec();
    a.type = 'ring';
    a.dead = false;
    a.o = this._img('ring').setPosition(x, y).setDepth(8600).setTint(color).setBlendMode('ADD').setScale(0.15, 0.12);
    a.t = 0;
    a.dur = 0.42;
    a.r = r / 58;
    a.a = 1.1;
    this.shockFx(x, y, r * 1.1, color, 0.5);
  },

  shockFx(x, y, r, color, dur) {
    const a = this._rec();
    a.type = 'ring';
    a.dead = false;
    a.o = this._img('fx_shock').setPosition(x, y).setDepth(8590).setTint(color).setBlendMode('ADD').setScale(0.1, 0.08);
    a.t = 0;
    a.dur = dur;
    a.r = r / 64;
    a.a = 0.6;
  },

  flashFx(x, y, color, scale = 1) {
    const a = this._rec();
    a.type = 'flash';
    a.dead = false;
    a.o = this._img('fx_flare').setPosition(x, y).setDepth(9130).setTint(color).setBlendMode('ADD').setScale(scale * 0.4).setRotation(Math.random() * 0.6);
    a.t = 0;
    a.dur = 0.16;
    a.s = scale;
  },

  // 妖物死亡粒子：纸扎类 → 纸屑 + 烟；鬼火类 → 冷色魂火上飘；爆竹/灯笼类 → 火星光条 + 闪光
  // kind: 'paper' | 'wisp' | 'spark'，size: 1 普通 / 2 精英 / 3 Boss
  deathFx(x, y, kind, size = 1) {
    this.ensureFx();
    const n = size >= 3 ? 70 : size >= 2 ? 34 : 10;
    if (kind === 'paper') {
      this.pPaper.explode(n, x, y);
      this._emSmoke.explode(size >= 2 ? 8 : 2, x, y + 8);
      this._emWisp.explode(Math.ceil(n / 4), x, y);
    } else if (kind === 'wisp') {
      this.pWisp.explode(n, x, y);
      this._emWisp.explode(Math.ceil(n / 2), x, y);
      this.flashFx(x, y, 0x7fe3ff, 1.1 * size);
    } else {
      this.pSpark.explode(n, x, y);
      this._emStreak.explode(Math.ceil(n * 0.8), x, y);
      this._emSmoke.explode(size >= 2 ? 6 : 2, x, y);
      this.flashFx(x, y, 0xffc070, 1.2 * size);
    }
    if (size >= 2) this.shockFx(x, y + 20, 60 * size, kind === 'wisp' ? 0x7fe3ff : 0xffc070, 0.45);
  },

  // 命中火花（轻量；给 damage() 用）
  hitFx(x, y, crit) {
    this.ensureFx();
    this._emStreak.explode(crit ? 6 : 2, x, y);
  },

  // ---------------- 每帧推进 ----------------
  _tickFx(dt) {
    const live = this._live;
    for (let i = live.length - 1; i >= 0; i--) {
      const r = live[i];
      let done = r.dead;
      if (!done) {
        r.t += dt;
        const k = Math.min(1, r.t / r.dur);
        const o = r.o;
        if (r.type === 'text') {
          const st = r.st;
          // 弹出：前 18% 冲到峰值，回落到静止大小；随后上飘减速、最后 40% 淡出
          const pk = Math.min(1, r.t / (r.dur * 0.18));
          const sc = r.t < r.dur * 0.18 ? 0.3 + (st.peak - 0.3) * easeOutBack(pk) : st.rest + (st.peak - st.rest) * Math.max(0, 1 - (r.t - r.dur * 0.18) / (r.dur * 0.2));
          r.vy *= Math.max(0, 1 - st.drag * dt);
          r.x += r.vx * dt;
          r.y += r.vy * dt;
          let ox = 0;
          if (r.kind === 'burn') ox = Math.sin(r.t * 14) * 3;
          o.setPosition(r.x + ox, r.y).setScale(r.base * sc).setAlpha(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
          if (r.kind === 'crit') o.setRotation(Math.sin(r.t * 40) * 0.12 * (1 - pk));
          if (k >= 1) { o.setVisible(false); o._rec = null; done = true; }
        } else if (r.type === 'boom') {
          o.setScale(r.s * (0.3 + 0.65 * easeOutCubic(Math.min(1, k * 1.8))));
          o.setAlpha(k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6);
          if (k >= 1) done = true;
        } else if (r.type === 'ring') {
          const e = easeOutCubic(k);
          o.setScale(r.r * (0.12 + 0.88 * e), r.r * (0.12 + 0.88 * e) * 0.78).setAlpha((1 - k) * (1 - k) * r.a);
          if (k >= 1) done = true;
        } else if (r.type === 'flash') {
          o.setScale(r.s * (0.4 + 0.8 * k)).setAlpha(1 - k);
          if (k >= 1) done = true;
        }
      }
      if (done) {
        if (r.type !== 'text' && r.o) { r.o.setVisible(false); this._imgPool.push(r.o); }
        r.o = null;
        r.st = null;
        live[i] = live[live.length - 1];
        live.pop();
        this._recPool.push(r);
      }
    }
  },

  _shadow(x, y, w, a) {
    let b = this._shadowBobs[this._shadowUsed];
    if (!b) { b = this._shadowBl.create(0, 0, 0); this._shadowBobs.push(b); }
    this._shadowUsed++;
    let fi = Math.round((w - SHADOW_MIN) / SHADOW_STEP);
    fi = fi < 0 ? 0 : fi > SHADOW_FRAMES ? SHADOW_FRAMES : fi;
    const fw = SHADOW_MIN + fi * SHADOW_STEP;
    b.setFrame(fi);
    b.x = x - fw / 2;
    b.y = y - fw * 0.17;
    b.alpha = a;
    b.visible = true;
  },

  drawWorld(dt = 1 / 60) {
    this.ensureFx();
    const cam = this.cameras.main;
    const realDt = Math.min(this.game.loop.delta, 50) / 1000;
    this._tickFx(dt);

    // 阴影（Blitter：每帧只改 Bob 字段，零分配）
    const prevShadow = this._shadowUsed;
    this._shadowUsed = 0;
    this._shadow(this.p.x, this.p.y - 2, 52, 0.75);
    const vx0 = cam.worldView.x - 120;
    const vy0 = cam.worldView.y - 120;
    const vx1 = cam.worldView.right + 120;
    const vy1 = cam.worldView.bottom + 160;
    for (const e of this.enemies) {
      if (!e.visible || e.x < vx0 || e.x > vx1 || e.y < vy0 || e.y > vy1) continue;
      const lift = e.liftY || 0;
      const k = 1 - Math.min(0.6, lift / 60);
      this._shadow(e.x, e.y - 2, e.r * 2.4 * k, 0.8 * (0.5 + k * 0.5) * e.alpha);
    }
    for (const pk of this.pickups) {
      if (!pk.visible) continue;
      this._shadow(pk.x, pk.y + 14 + (pk.kind === 'chest' ? 18 : 0), 18 * ((pk.sc || 0.42) / 0.42), 0.4);
    }
    for (let i = this._shadowUsed; i < prevShadow; i++) this._shadowBobs[i].visible = false;

    // 预警圈：外圈淡红底 + 随进度长大的实心圈 + 外沿脉动描边；临近落下时整体闪亮
    const tg = this.teleG.clear();
    for (const t of this.teles) {
      const k = Math.min(1, t.t / t.dur);
      const w = t.r * 2;
      const h = t.r * 1.6;
      const late = k > 0.8 ? (Math.sin(t.t * 50) * 0.5 + 0.5) : 0;
      tg.fillStyle(0xc0202a, 0.2 + k * 0.12).fillEllipse(t.x, t.y, w, h, 28);
      tg.fillStyle(0xff4a3a, 0.28 + k * 0.22 + late * 0.15).fillEllipse(t.x, t.y, w * k, h * k, 28);
      tg.lineStyle(2, 0xffd0a0, 0.55 * k).strokeEllipse(t.x, t.y, w * k, h * k, 28);
      tg.lineStyle(3 + late * 2, 0xff6a5a, 0.75 + 0.25 * Math.sin(t.t * 16)).strokeEllipse(t.x, t.y, w, h, 32);
    }

    // 火路（Blitter ADD，带闪烁）
    const prevTrail = this._trailUsed;
    this._trailUsed = 0;
    for (const tr of this.trails) {
      const a = Math.min(1, tr.life / 0.5);
      let b = this._trailBobs[this._trailUsed];
      if (!b) { b = this._trailBl.create(0, 0); this._trailBobs.push(b); }
      this._trailUsed++;
      b.x = tr.x - 32;
      b.y = tr.y - 17;
      b.alpha = a * (0.75 + 0.25 * Math.sin(this.t * 22 + tr.x * 0.07));
      b.visible = true;
    }
    for (let i = this._trailUsed; i < prevTrail; i++) this._trailBobs[i].visible = false;

    // 连锁闪电：锯齿折线 30Hz 重抖，三层（外辉、中辉、白芯）+ 中段分叉；新链落点闪光
    const bg = this.boltG.clear();
    const pts = this._boltPts;
    const tick = Math.floor(this.time.now / 33);
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= realDt;
      if (b.life <= 0) { this.bolts[i] = this.bolts[this.bolts.length - 1]; this.bolts.pop(); continue; }
      if (!b.fx) {
        b.fx = true;
        b.max = b.life;
        this.flashFx(b.x2, b.y2, 0x9fe8ff, 1.2);
      }
      const dx = b.x2 - b.x1;
      const dy = b.y2 - b.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const amp = Math.min(22, len * 0.12);
      pts[0] = b.x1; pts[1] = b.y1;
      for (let s = 1; s < BOLT_SEG; s++) {
        const k = s / BOLT_SEG;
        const j = Math.sin(b.seed * 9973 + s * 12.9898 + tick * 78.233) * 43758.5453;
        const off = ((j - Math.floor(j)) * 2 - 1) * amp;
        pts[s * 2] = b.x1 + dx * k + nx * off;
        pts[s * 2 + 1] = b.y1 + dy * k + ny * off;
      }
      pts[BOLT_SEG * 2] = b.x2; pts[BOLT_SEG * 2 + 1] = b.y2;
      const fade = b.life / b.max;
      for (let pass = 0; pass < 3; pass++) {
        const w = pass === 0 ? 12 : pass === 1 ? 5 : 2;
        const c = pass === 0 ? 0x3a6bff : pass === 1 ? 0x7fe3ff : 0xffffff;
        const al = (pass === 0 ? 0.3 : pass === 1 ? 0.65 : 1) * fade;
        bg.lineStyle(w, c, al);
        bg.beginPath();
        bg.moveTo(pts[0], pts[1]);
        for (let s = 1; s <= BOLT_SEG; s++) bg.lineTo(pts[s * 2], pts[s * 2 + 1]);
        bg.strokePath();
      }
      // 分叉：从第 3 段拐点岔出一小截
      const fx0 = pts[6];
      const fy0 = pts[7];
      const fj = Math.sin(b.seed * 31 + tick * 3.1);
      bg.lineStyle(2, 0xbff4ff, 0.8 * fade);
      bg.beginPath();
      bg.moveTo(fx0, fy0);
      bg.lineTo(fx0 + nx * 18 * fj + dx * 0.12, fy0 + ny * 18 * fj + dy * 0.12);
      bg.lineTo(fx0 + nx * 30 * fj + dx * 0.2, fy0 + ny * 26 * fj + dy * 0.2);
      bg.strokePath();
    }

    // 远景雾（Boot 的 fog，视差 0.6）
    for (const f of this.fogs) {
      f.bx += f.vx * realDt;
      const sx = (((f.bx - cam.scrollX * 0.6) % 1900) + 1900) % 1900 - 310;
      const sy = (((f.by - cam.scrollY * 0.6) % 980) + 980) % 980 - 130;
      f.setPosition(sx, sy);
    }
    // 地面薄雾 + 近景雾：不同视差与速度，形成纵深；透明度缓慢呼吸
    const now = this.time.now / 1000;
    for (const m of this._mists) {
      m.bx += m.vx * realDt;
      const sx = (((m.bx - cam.scrollX * m.par) % m.wrapX) + m.wrapX) % m.wrapX - m.ox;
      const sy = (((m.by - cam.scrollY * m.par) % m.wrapY) + m.wrapY) % m.wrapY - m.oy;
      m.setPosition(sx, sy + Math.sin(now * 0.4 + m.ph) * 12);
    }
  },
};
