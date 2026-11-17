import Phaser from 'phaser';
import { BAL, META, WV, UPS, CELL, FX_TINT } from '../game/shared.js';
import { mulberry32 } from '../rng.js';
import { loadSave } from '../save.js';
import { music } from '../audio.js';
import { NF, INK } from '../fonts.js';
import { playerMethods } from '../game/player.js';
import { enemiesMethods } from '../game/enemies.js';
import { combatMethods } from '../game/combat.js';
import { progressionMethods } from '../game/progression.js';
import { fxMethods } from '../game/fx.js';

// 对局场景：只放创建、主循环、空间网格与数值汇总；各系统见 src/game/*.js
export class Game extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    this.save = loadSave();
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.rng = mulberry32(this.seed);
    this.cameras.main.fadeIn(450, 5, 6, 18);

    const bg = this.add.image(0, 0, 'field').setOrigin(0).setScale(BAL.worldScale).setDepth(-10000);
    this.W = bg.displayWidth;
    this.H = bg.displayHeight;
    const m = BAL.worldMargin;
    this.walk = { x0: m, y0: m, x1: this.W - m, y1: this.H - m };
    this.cameras.main.setBounds(0, 0, this.W, this.H);
    // 场地调色：压一层暗紫，并在地面铺几处灯笼暖光，避免整片灰冷
    bg.setTint(0xd2c2f2);
    this.add.rectangle(0, 0, this.W, this.H, 0x3b2a5c, 0.16).setOrigin(0).setBlendMode('MULTIPLY').setDepth(-9900);
    this.makeFieldLanterns();

    this.lightPool = this.add.image(0, 0, 'glow').setTint(0xffa850).setAlpha(0.34).setBlendMode('ADD').setDepth(-9000).setScale(8.5, 7);
    this.shadowG = this.add.graphics().setDepth(-8000);
    this.teleG = this.add.graphics().setDepth(-7000);
    this.trailG = this.add.graphics().setDepth(-6900).setBlendMode('ADD');
    this.boltG = this.add.graphics().setDepth(9000).setBlendMode('ADD');

    // 远景雾层（屏幕空间，按视差慢速漂移）
    this.fogs = [];
    for (let i = 0; i < 8; i++) {
      const f = this.add.image(0, 0, 'fog').setScrollFactor(0).setDepth(9400).setTint(0x9fb4ff).setAlpha(0.1 + this.rng() * 0.06)
        .setScale(2.2 + this.rng() * 1.6, 1 + this.rng() * 0.6);
      f.bx = this.rng() * 1900;
      f.by = this.rng() * 900;
      f.vx = 8 + this.rng() * 14;
      this.fogs.push(f);
    }
    this.night = this.add.image(640, 360, 'night').setScrollFactor(0).setDepth(9500);

    // 主角
    const P = BAL.player;
    this.player = this.add.sprite(this.W / 2, this.H / 2, 'hero_run', 0).setOrigin(0.5, 0.92).setScale(P.scale);
    this.player.play('run');
    this.player.anims.pause();
    const mm = (stat) => META.filter((x) => x.stat === stat).reduce((a, x) => a + (this.save.meta[x.id] || 0) * x.per, 0);
    this.meta = { maxHp: mm('maxHp'), dmg: mm('dmg'), speed: mm('speed'), pickup: mm('pickup'), rerolls: mm('rerolls'), revive: mm('revive') };
    this.p = {
      x: this.player.x, y: this.player.y, hp: 0, maxHp: 0, invuln: 0, dashCdLeft: 0, dashT: 0, dashInv: 0,
      vx: 0, vy: 0, faceX: 1, moving: false, revive: this.meta.revive,
    };
    this.levels = { fu: 1 };
    this.evo = {};
    this.recalc();
    this.p.hp = this.p.maxHp;
    this.rerolls = BAL.rerolls + this.meta.rerolls;

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,SHIFT');

    // 状态
    this.t = 0;
    this.kills = 0;
    this.coins = 0;
    this.level = 1;
    this.xp = 0;
    this.need = this.reqFor(1);
    this.pendingLv = 0;
    this.modal = false;
    this.over = false;
    this.ended = false;
    this.bonusSoul = 0;
    this.gemCount = 0;
    this.pendingChest = 0;
    this.lastStopAt = 0;
    this.hitStop = 0;
    this.slowmo = 1;
    this.dmgBy = {};
    this.uid = 0;
    this.spawnT = 0.6;
    this.packT = WV.packs.from;
    this.eventIdx = 0;
    this.boss = null;
    this.bossPhase = false;
    this.lastCritStop = 0;

    this.enemies = [];
    this.ePool = [];
    this.bullets = [];
    this.bPool = [];
    this.ebullets = [];
    this.ebPool = [];
    this.pickups = [];
    this.pkPool = [];
    this.fxPool = [];
    this.texts = [];
    this.teles = [];
    this.bolts = [];
    this.trails = [];
    this.orbs = [];
    this.marks = [];
    this.grid = new Map();
    this.wTimers = { fu: 0.4, fuRing: 1, lei: 1.2, trail: 0 };
    this.orbAngle = 0;

    for (let i = 0; i < 60; i++) {
      const t = this.add.text(0, 0, '', { fontFamily: NF, fontSize: '22px', fontStyle: 'bold', color: '#ffffff', stroke: INK, strokeThickness: 5 })
        .setOrigin(0.5).setDepth(9600).setVisible(false);
      this.texts.push(t);
    }
    this.textIdx = 0;

    const pcfg = (tex, extra) => this.add.particles(0, 0, tex, {
      emitting: false, speed: { min: 80, max: 280 }, angle: { min: 0, max: 360 }, lifespan: { min: 300, max: 700 },
      scale: { start: 1, end: 0.2 }, alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 }, ...extra,
    }).setDepth(9100);
    this.pPaper = pcfg('paper', { gravityY: 260, tint: FX_TINT.paper });
    this.pWisp = pcfg('glow', { scale: { start: 0.5, end: 0 }, blendMode: 'ADD', tint: FX_TINT.wisp });
    this.pSpark = pcfg('glow', { scale: { start: 0.45, end: 0 }, blendMode: 'ADD', tint: FX_TINT.spark });
    this.pGold = pcfg('glow', { scale: { start: 0.6, end: 0 }, blendMode: 'ADD', tint: [0xffd36a, 0xffffff, 0x7fe3ff], speed: { min: 150, max: 420 }, lifespan: { min: 500, max: 1000 } });
    this.pDash = this.add.particles(0, 0, 'glow', {
      emitting: false, lifespan: 380, scale: { start: 0.55, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: 0x7fe3ff, blendMode: 'ADD', speed: 20,
    }).setDepth(-50);
    this.pEmbers = this.add.particles(0, 0, 'glow', {
      x: { min: -700, max: 700 }, y: { min: -400, max: 400 }, lifespan: 4000, speedY: { min: -40, max: -15 }, speedX: { min: -10, max: 10 },
      scale: { start: 0.16, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: [0xffa040, 0xffc977], blendMode: 'ADD', frequency: 140,
      follow: this.player,
    }).setDepth(9450);

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.centerOn(this.player.x, this.player.y);

    this.scene.launch('UI');
    this.ui = this.scene.get('UI');
    music.play('battle');
    this.events.once('shutdown', () => this.tweens.killAll());
  }

  // ---------------- 数值 ----------------
  // 场上散落的竹竿纸灯笼：随风摇摆、灯光呼吸闪烁（纯装饰，不参与碰撞）
  makeFieldLanterns() {
    const m = BAL.worldMargin;
    const cols = 5;
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = m + ((c + 0.5 + (this.rng() - 0.5) * 0.6) / cols) * (this.W - m * 2);
        const y = m + ((r + 0.5 + (this.rng() - 0.5) * 0.6) / rows) * (this.H - m * 2);
        if (Math.hypot(x - this.W / 2, y - this.H / 2) < 260) continue;
        const pool = this.add.image(x + 6, y - 6, 'glow').setTint(0xff9a3c).setBlendMode('ADD').setAlpha(0.32).setScale(5.2, 3.6).setDepth(-9500);
        const lan = this.add.image(x, y, 'field_lantern').setOrigin(0.5, 1).setScale(0.95).setDepth(y);
        const halo = this.add.image(x + 6, y - 84, 'glow').setTint(0xffb050).setBlendMode('ADD').setAlpha(0.7).setScale(2.2).setDepth(y + 1);
        const dur = 1600 + this.rng() * 900;
        this.tweens.add({ targets: lan, angle: { from: -3, to: 3 }, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: this.rng() * 800 });
        this.tweens.add({ targets: halo, alpha: { from: 0.45, to: 0.85 }, x: { from: x + 2, to: x + 10 }, duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: pool, alpha: { from: 0.24, to: 0.38 }, duration: 700 + this.rng() * 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  lv(id) { return this.levels[id] || 0; }

  lv(id) { return this.levels[id] || 0; }

  wstat(id) { return UPS[id].stats[this.lv(id) - 1]; }

  reqFor(level) {
    const first = BAL.xp.first;
    if (level <= first.length) return first[level - 1];
    return Math.round(first[first.length - 1] * Math.pow(BAL.xp.growth, level - first.length));
  }

  recalc() {
    const P = BAL.player;
    const per = (id, k) => this.lv(id) * (UPS[id].per[k] || 0);
    const s = {
      maxHp: P.hp + this.meta.maxHp + per('yupei', 'maxHp'),
      speed: P.speed * (1 + this.meta.speed + per('caolv', 'speed')),
      pickup: P.pickup * (1 + this.meta.pickup + per('hundai', 'pickup')),
      dmgMul: 1 + this.meta.dmg + per('taomu', 'dmg'),
      crit: P.crit + per('tiangang', 'crit'),
      critMul: P.critMul + per('tiangang', 'critMul'),
      dashCd: P.dashCd * (1 - per('jingxin', 'dashCd')),
      fuCdMul: 1 - per('jishu', 'fuCd'),
      fuSpeedMul: 1 + per('jishu', 'fuSpeed'),
      fuCount: per('zhongfu', 'fuCount'),
      burnDps: BAL.burn.baseDps + per('zhuohun', 'burnDps'),
      ignite: per('zhuohun', 'igniteChance'),
      orbRadiusMul: 1 + per('tianyou', 'orbRadius'),
      orbSpinMul: 1 + per('tianyou', 'orbSpin'),
      chainBonus: per('leiyin', 'chain'),
      soulMul: 1 + per('tongqian', 'soulGain'),
      coinChance: BAL.drops.coin + per('tongqian', 'coinChance'),
    };
    Object.assign(this.p, { stats: s, maxHp: s.maxHp });
    this.p.hp = Math.min(this.p.hp, s.maxHp);
    this.syncOrbs();
  }

  wstat(id) { return UPS[id].stats[this.lv(id) - 1]; }

  update(_, deltaMs) {
    if (this.over && this.slowmo <= 0) return;
    let dt = Math.min(deltaMs, 50) / 1000;
    if (this.hitStop > 0) {
      this.hitStop -= deltaMs;
      this.drawWorld(0);
      return;
    }
    dt *= this.slowmo;
    if (!this.over) this.t += dt;
    this.rebuildGrid();
    if (!this.over) {
      this.updatePlayer(dt);
      this.updateSpawns(dt);
      this.updateWeapons(dt);
    }
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateEnemyBullets(dt);
    this.updatePickups(dt);
    this.updateTeles(dt);
    this.drawWorld(dt);
    if (!this.over && !this.modal && this.pendingLv > 0) this.openLevelUp();
  }

  rebuildGrid() {
    this.grid.clear();
    for (const e of this.enemies) {
      const k = ((e.x / CELL) | 0) * 4096 + ((e.y / CELL) | 0);
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(e);
    }
  }

  query(x, y, r, cb) {
    const x0 = ((x - r) / CELL) | 0;
    const x1 = ((x + r) / CELL) | 0;
    const y0 = ((y - r) / CELL) | 0;
    const y1 = ((y + r) / CELL) | 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.grid.get(cx * 4096 + cy);
        if (!arr) continue;
        for (const e of arr) if (e.alive && cb(e) === false) return;
      }
    }
  }

  nearestEnemy(x, y, range) {
    let best = null;
    let bd = range * range;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
}

Object.assign(Game.prototype, playerMethods, enemiesMethods, combatMethods, progressionMethods, fxMethods);
