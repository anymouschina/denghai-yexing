// 新模式对局场景：驱动 Sim（固定步长）+ 把模拟状态画出来 + 键鼠输入。HUD 在 GuardHUD 场景（并行运行）。
// 只画镜头附近的实体（屏外剔除）；特效从 sim.fx 队列消费。
import Phaser from 'phaser';
import { Sim, TICK, BAL } from '../sim/Sim.js';
import { REALMS, HIDDEN, WALLS, gateCenter } from '../sim/map.js';
import { NF, INK } from '../../fonts.js';
import { sfx, music, isMuted, setMuted } from '../../audio.js';
import { touch, setTouchVisible } from '../../touch.js';
import { canReach } from '../sim/systems/buildings.js';
import { QUICK_ITEM_IDS } from '../sim/systems/shop.js';
import { drawFx } from '../render/fx.js';
import { drawZone } from '../render/zones.js';
import { LAYERS } from '../render/index.js';
import { makeVfxTextures } from '../render/vfx.js';
import { createGameFeel } from '../render/gameFeel.js';
import { ensureUnitSpriteSheet, isActionSpriteSheet, isNativeSpriteSheet, playUnitActionAnim } from '../render/charAnim.js';
import { resolveNativeSheet } from '../assets.js';
import '../render/extensions.js';
import { readRun } from '../persist/store.js';
import { attachAutosave } from '../persist/autosave.js';

const VIEW_PAD = 220;
const PARTICLE_CAP = 360; // 单个发射器同时存活粒子上限（怪潮连杀时防止粒子无限堆积）
const params = new URLSearchParams(location.search);

export class GuardGame extends Phaser.Scene {
  constructor() { super('GuardGame'); }

  init(data) {
    this.heroId = data.heroId || 'huoqing';
    this.mode = data.mode || 'story';
    this.resumeSlot = data.resume || null; // 「继续游戏」：存档槽位 auto / manual
  }

  create() {
    const urlSeed = Number(params.get('seed'));
    this.seed = urlSeed ? urlSeed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
    this.resumed = null;
    this.resumeError = null;
    if (this.resumeSlot) {
      const r = readRun(this.resumeSlot);
      if (r.ok) { this.sim = r.sim; this.resumed = r; this.seed = r.sim.seed; this.heroId = r.sim.heroId; this.mode = r.sim.mode; } else this.resumeError = r.reason;
      this.resumeSlot = null; // restart 时不再重复读档
    }
    if (!this.sim || !this.resumed) this.sim = new Sim({ seed: this.seed, heroId: this.heroId, mode: this.mode });
    this.sim.input.autoAttack = true;
    this.attackMoveMode = false;
    this.orderRipples = [];
    this.questGuide = null; // { x, y, label, until }
    // 仅自动化验收：暴露模拟对象与场景，供注入的代打机器人与验收脚本读取局面（正常游玩不挂）
    if (params.get('tapcanvasPlaytest') === '1') {
      globalThis.__guardSim = this.sim;
      globalThis.__guardScene = this;
    }
    this.acc = 0;
    // scene.restart 不会重建实例：上一局遗留的标志必须在 create 里复位（endShown 不复位会导致第二局结算界面永不出现）
    this.endShown = false;
    this.errorCount = 0;
    this.lastError = null;
    this.failStreak = 0;
    this.halted = false;
    this.paused = false;
    this.panelPaused = false;
    this.timeScale = params.get('tapcanvasPlaytest') === '1' ? Math.max(1, Math.min(8, Number(params.get('ts')) || 1)) : 1;
    this.sprites = new Map();
    this.pools = new Map();
    this.lastMouse = -99;
    this.cameras.main.fadeIn(450, 5, 6, 18);
    if (touch.enabled) setTouchVisible(true, { dash: false, guard: true });

    makeVfxTextures(this);
    this.feel = createGameFeel(this);
    this.feelState = { simScale: 1, offsetX: 0, offsetY: 0, roll: 0 };

    this.buildWorld();
    this.shadowG = this.add.graphics().setDepth(-5000);
    this.zoneG = this.add.graphics().setDepth(-4000);
    this.ringG = this.add.graphics().setDepth(-3900);
    this.aimWorldG = this.add.graphics().setDepth(9050);
    this.barG = this.add.graphics().setDepth(9200);
    this.fxG = this.add.graphics().setDepth(9100).setBlendMode('ADD');
    this.fxItems = [];
    this.texts = [];
    for (let i = 0; i < 70; i++) {
      this.texts.push(this.add.text(0, 0, '', { fontFamily: NF, fontSize: '20px', fontStyle: 'bold', color: '#ffffff', stroke: INK, strokeThickness: 5 }).setOrigin(0.5).setDepth(9600).setVisible(false));
    }
    this.textIdx = 0;
    const pcfg = (extra) => this.add.particles(0, 0, 'glow', {
      emitting: false, speed: { min: 80, max: 260 }, lifespan: { min: 300, max: 650 }, scale: { start: 0.5, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', maxAliveParticles: PARTICLE_CAP, ...extra,
    }).setDepth(9150);
    this.pSpark = pcfg({ tint: [0xffa040, 0xffd36a, 0xe0463a] });
    this.pPaper = this.add.particles(0, 0, 'paper', {
      emitting: false, speed: { min: 80, max: 260 }, lifespan: { min: 300, max: 700 }, gravityY: 260, rotate: { min: 0, max: 360 }, scale: { start: 1, end: 0.2 }, alpha: { start: 1, end: 0 }, tint: [0xf3e6c8, 0xb9a6d6, 0xe0463a], maxAliveParticles: PARTICLE_CAP,
    }).setDepth(9150);
    this.pGold = pcfg({ tint: [0xffd36a, 0xffffff, 0x7fe3ff], speed: { min: 150, max: 420 }, lifespan: { min: 500, max: 1000 } });
    this.pHeal = pcfg({ tint: [0x5fe08a, 0xc8ffd8], speed: { min: 30, max: 90 }, gravityY: -120 });

    this.night = this.add.image(640, 360, 'night').setScrollFactor(0).setDepth(9500).setAlpha(0.85).setScale(1.12);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, BAL.world.w, BAL.world.h);
    const h = this.sim.hero;
    cam.centerOn(h.x, h.y);
    this.camBaseX = cam.scrollX;
    this.camBaseY = cam.scrollY;

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,J');
    this.input.keyboard.on('keydown', (e) => this.onKey(e));
    this.input.on('pointermove', () => { this.lastMouse = this.time.now; });
    this.input.on('pointerdown', (p, objs) => {
      this.lastMouse = this.time.now;
      if (this.paused || this.panelPaused || this.sim.over) return;
      if (this.hud && (this.hud.modal || this.hud.panel)) return;
      if (this.hud && this.hud.consumedPointer && this.hud.consumedPointer(p)) return;
      if (objs && objs.length > 0) return;
      const wp = cam.getWorldPoint(p.x, p.y);
      this.onWorldPointer(p, wp);
    });
    this.input.on('pointerup', () => { this.mouseAttack = false; });

    this.scene.launch('GuardHUD');
    this.hud = this.scene.get('GuardHUD');
    music.play('battle');
    this.sim.on('waveStart', (w) => { if (w.boss) music.play('boss'); else if (music.mode === 'boss') music.play('battle'); });
    this.sim.on('bossKill', () => music.play('battle'));
    this.sim.on('arrivedFoundation', ({ f }) => {
      if (this.hud && !this.hud.modal) this.hud.foundationClick(f);
    });
    this.sim.on('questDone', () => { this.questGuide = null; });
    this.sim.on('cast', ({ u, slot }) => {
      if (!u || !this.feel) return;
      const sp = this.sprites?.get(u.id);
      if (sp) {
        if (slot === 'u') this.feel.popSprite(sp, 1.32, 0.72, 220);
        else this.feel.popSprite(sp, 1.18, 0.84, 150);
      }
      if (u.ctrl && slot === 'u') this.feel.addTrauma(0.28);
    });
    this.sim.on('damage', ({ tgt, dmg, crit }) => {
      if (!this.feel || !tgt) return;
      const sp = this.sprites?.get(tgt.id);
      if (!sp || sp._feelPopTween) return;
      if (crit || (tgt.kind === 'hero' && dmg >= Math.max(12, tgt.maxHp * 0.04)) || (tgt.boss && dmg >= tgt.maxHp * 0.03)) {
        this.feel.popSprite(sp, 1.22, 0.80, 150);
      }
    });
    this.sim.on('temperMilestone', ({ unit }) => {
      const sp = unit && this.sprites?.get(unit.id);
      if (sp && this.feel) this.feel.popSprite(sp, 1.34, 0.74, 240);
    });
    // 存档：波次切换 / 清波 / 每 30 秒 / 切后台与刷新 自动存；F6 或暂停菜单手动存
    this.autosave = attachAutosave(this.sim, {
      onSaved: (r) => { if (r.kind === 'manual' && this.hud) this.hud.toast(`已手动存档 · 第 ${r.meta.wave} 波`, '#9ff0b8'); },
      onFail: (r) => { if (this.hud) this.hud.toast(r.reason || '存档失败', '#ff8a7a'); },
    });
    if (this.resumed) {
      this.sim.t0Resumed = this.sim.t;
      this.time.delayedCall(700, () => { if (this.hud) this.hud.toast(`已读取${this.resumed.slot === 'manual' ? '手动' : '自动'}存档 · 第 ${this.sim.wave.n} 波`, '#9ff0b8'); });
      if (this.sim.enemies.some((e) => e.alive && e.boss && !e.realm)) music.play('boss');
    } else if (this.resumeError) {
      this.time.delayedCall(700, () => { if (this.hud) this.hud.toast(`读档失败：${this.resumeError}，已开始新局`, '#ff8a7a'); });
    }
    this.events.once('shutdown', () => {
      if (this.autosave) { this.autosave.dispose(); this.autosave = null; }
      this.tweens.killAll();
      this.time.removeAllEvents();
      this.sprites.clear();
      this.pools.clear();
      this.fxItems.length = 0;
      setTouchVisible(false);
    });
  }

  manualSave() {
    if (!this.autosave || this.sim.over) return null;
    const r = this.autosave.manual();
    if (r && !r.ok && this.hud) this.hud.toast(r.reason || '存档失败', '#ff8a7a');
    return r;
  }

  addOrderRipple(x, y, color = 0x5fe08a, kind = 'move') {
    this.orderRipples.push({ x, y, color, kind, life: 0.55, max: 0.55 });
    if (this.orderRipples.length > 16) this.orderRipples.shift();
  }

  setQuestGuide(x, y, label = '军令目标', autoMove = false) {
    this.questGuide = { x, y, label };
    this.addOrderRipple(x, y, 0xffc977, 'guide');
    if (autoMove) {
      this.cmd({ type: 'moveTo', x, y });
    }
  }

  onWorldPointer(p, wp) {
    const s = this.sim;
    const isRight = p.rightButtonDown();
    const shift = !!(p.event && p.event.shiftKey);
    // 查找点中的敌人（用于右键/左键锁定攻击）
    const enemyHit = s.enemies.find((e) => e.alive && (e.x - wp.x) ** 2 + (e.y - e.h * 0.35 - wp.y) ** 2 < (e.r + 36) ** 2);
    // 查找点中的地基
    const foundHit = s.foundations.find((x) => (x.x - wp.x) ** 2 + (x.y - wp.y) ** 2 < 72 * 72);

    if (isRight) {
      if (this.attackMoveMode) {
        this.attackMoveMode = false;
        this.hud?.toast('已取消巡攻指示', '#9aa3cf');
        return;
      }
      if (shift) {
        this.cmd({ type: 'attackMove', x: wp.x, y: wp.y });
        this.addOrderRipple(wp.x, wp.y, 0xff5a4a, 'attack');
        sfx('click');
        return;
      }
      if (enemyHit) {
        this.cmd({ type: 'attackTarget', targetId: enemyHit.id });
        this.addOrderRipple(enemyHit.x, enemyHit.y, 0xff5a4a, 'attack');
        sfx('click');
        return;
      }
      if (foundHit) {
        if (canReach(s, foundHit)) this.hud?.foundationClick(foundHit);
        else {
          this.cmd({ type: 'buildMove', fid: foundHit.id });
          this.addOrderRipple(foundHit.x, foundHit.y, 0xffc977, 'guide');
          this.hud?.toast('正在前往地基…到达后自动打开建造', '#ffc977');
        }
        return;
      }
      this.cmd({ type: 'moveTo', x: wp.x, y: wp.y });
      this.addOrderRipple(wp.x, wp.y, 0x5fe08a, 'move');
      return;
    }

    // 左键：巡攻模式优先
    if (this.attackMoveMode) {
      this.attackMoveMode = false;
      if (enemyHit) {
        this.cmd({ type: 'attackTarget', targetId: enemyHit.id });
        this.addOrderRipple(enemyHit.x, enemyHit.y, 0xff5a4a, 'attack');
      } else {
        this.cmd({ type: 'attackMove', x: wp.x, y: wp.y });
        this.addOrderRipple(wp.x, wp.y, 0xff5a4a, 'attack');
      }
      sfx('click');
      return;
    }

    // 左键点地基：近则直接建造，远则自动走过去建造
    if (foundHit) {
      if (canReach(s, foundHit)) this.hud?.foundationClick(foundHit);
      else {
        this.cmd({ type: 'buildMove', fid: foundHit.id });
        this.addOrderRipple(foundHit.x, foundHit.y, 0xffc977, 'guide');
        this.hud?.toast('正在前往地基…到达后自动打开建造', '#ffc977');
      }
      return;
    }

    // 左键点场上其他友军单位（神兽/雇佣兵/英雄）：像魔兽一样点选切换
    const allyHit = s.units.find((u) => u.alive && u.id !== s.ctrlId && u.kind !== 'kongming' && s.party.includes(u.id)
      && (u.x - wp.x) ** 2 + (u.y - (u.h || 70) * 0.45 - wp.y) ** 2 < (u.r + 34) ** 2);
    if (allyHit) {
      this.cmd({ type: 'switch', id: allyHit.id });
      this.addOrderRipple(allyHit.x, allyHit.y, 0xffc977, 'move');
      return;
    }

    // 左键点敌人：锁定追击攻击
    if (enemyHit) {
      this.cmd({ type: 'attackTarget', targetId: enemyHit.id });
      this.addOrderRipple(enemyHit.x, enemyHit.y, 0xff5a4a, 'attack');
      return;
    }

    // 左键点地面道具：近则直接拾取，远则走过去自动拾取
    const dropHit = (s.groundItems || []).find((g) => (g.x - wp.x) ** 2 + (g.y - wp.y) ** 2 < 46 * 46);
    if (dropHit) {
      const r = this.cmd({ type: 'pickupGround', gid: dropHit.id });
      if (!r.ok && /距离/.test(r.reason || '')) {
        this.cmd({ type: 'pickupMove', gid: dropHit.id });
        this.addOrderRipple(dropHit.x, dropHit.y, 0xffd36a, 'guide');
      }
      return;
    }

    // 左键点空地：直接移动到目标点（兼容单键鼠/触控板/手机点地移动）
    this.cmd({ type: 'moveTo', x: wp.x, y: wp.y });
    this.addOrderRipple(wp.x, wp.y, 0x5fe08a, 'move');
  }

  // ---------------- 地图（一次性绘制） ----------------
  buildWorld() {
    const W = BAL.world;
    const ground = this.add.tileSprite(0, 0, W.main, W.main, 'g_ground').setOrigin(0).setDepth(-10000).setTint(0xb8b0d8);
    ground.tileScaleX = ground.tileScaleY = 0.75;
    const [hx0, hy0, hx1, hy1] = HIDDEN.rect;
    this.add.tileSprite(hx0, hy0, hx1 - hx0, hy1 - hy0, 'g_ground').setOrigin(0).setDepth(-10000).setTint(0xffe2a0);
    // 练功房地面与传送阵（数据驱动：map.trainingRoom）
    const TR = this.sim.map.trainingRoom;
    if (TR) {
      const [tx0, ty0, tx1, ty1] = TR.rect;
      this.add.tileSprite(tx0, ty0, tx1 - tx0, ty1 - ty0, 'g_ground').setOrigin(0).setDepth(-10000).setTint(0x96e0b8);
      const tg = this.add.graphics().setDepth(-9750);
      tg.fillStyle(0x286a48, 0.2).fillRect(tx0, ty0, tx1 - tx0, ty1 - ty0);
      tg.lineStyle(5, 0x5fe08a, 0.72).strokeRect(tx0 + 8, ty0 + 8, tx1 - tx0 - 16, ty1 - ty0 - 16);
      this.add.text((tx0 + tx1) / 2, (ty0 + ty1) / 2, TR.name || '剑阁·练功房', {
        fontFamily: '"Ma Shan Zheng", "STKaiti", serif', fontSize: '64px', color: '#c8ffd8', stroke: INK, strokeThickness: 8,
      }).setOrigin(0.5).setAlpha(0.24).setDepth(-9500);
      const mkTrainPortal = (pt, label, sub) => {
        const [px, py] = pt;
        const r = TR.portalR || 76;
        tg.fillStyle(0x1b5e3c, 0.42).fillEllipse(px, py, r * 2, r * 1.1);
        tg.lineStyle(3.5, 0x5fe08a, 0.92).strokeEllipse(px, py, r * 2, r * 1.1);
        tg.lineStyle(2, 0xffd36a, 0.8).strokeEllipse(px, py, r * 1.35, r * 0.72);
        const gl = this.add.image(px, py - 24, 'glow').setTint(0x5fe08a).setBlendMode('ADD').setScale(4.2).setAlpha(0.55).setDepth(py);
        this.tweens.add({ targets: gl, alpha: { from: 0.32, to: 0.72 }, duration: 1300, yoyo: true, repeat: -1 });
        this.add.text(px, py - 62, label, { fontFamily: '"Ma Shan Zheng", "STKaiti", serif', fontSize: '24px', color: '#9ff0b8', stroke: INK, strokeThickness: 5 }).setOrigin(0.5).setDepth(py + 20);
        this.add.text(px, py - 36, sub, { fontFamily: NF, fontSize: '12px', color: '#ffd36a', stroke: INK, strokeThickness: 3 }).setOrigin(0.5).setDepth(py + 20);
      };
      mkTrainPortal(TR.entry, '练功房传送阵', '踩入刷级打装');
      mkTrainPortal(TR.exit, '返回灯坛', '踩入回基地');
    }
    // BOSS 房与额外传送挑战秘境（霸王·项羽 / 战神·刑天）地面自动平铺
    const BR = this.sim.map.bossRoom;
    if (BR) {
      const [bx0, by0, bx1, by1] = BR.rect;
      this.add.tileSprite(bx0, by0, bx1 - bx0, by1 - by0, 'g_ground').setOrigin(0).setDepth(-10000).setTint(0xc88a8a);
      const bg2 = this.add.graphics().setDepth(-9750);
      bg2.fillStyle(0x5a1818, 0.22).fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      bg2.lineStyle(5, 0xff6a5a, 0.78).strokeRect(bx0 + 8, by0 + 8, bx1 - bx0 - 16, by1 - by0 - 16);
      this.add.text((bx0 + bx1) / 2, (by0 + by1) / 2, BR.name || '镇夜·BOSS房', {
        fontFamily: '"Ma Shan Zheng", "STKaiti", serif', fontSize: '64px', color: '#ffc8b8', stroke: INK, strokeThickness: 8,
      }).setOrigin(0.5).setAlpha(0.24).setDepth(-9500);
    }
    for (const er of (this.sim.map.extraRealms || [])) {
      const [ex0, ey0, ex1, ey1] = er.rect;
      this.add.tileSprite(ex0, ey0, ex1 - ex0, ey1 - ey0, 'g_ground').setOrigin(0).setDepth(-10000).setTint(er.color || 0xd8a8ff);
      const eg2 = this.add.graphics().setDepth(-9750);
      eg2.fillStyle(er.color || 0xc47bff, 0.16).fillRect(ex0, ey0, ex1 - ex0, ey1 - ey0);
      eg2.lineStyle(5, er.color || 0xffc94a, 0.75).strokeRect(ex0 + 8, ey0 + 8, ex1 - ex0 - 16, ey1 - ey0 - 16);
      this.add.text((ex0 + ex1) / 2, (ey0 + ey1) / 2, er.name, {
        fontFamily: '"Ma Shan Zheng", "STKaiti", serif', fontSize: '56px', color: '#ffe6b8', stroke: INK, strokeThickness: 8,
      }).setOrigin(0.5).setAlpha(0.24).setDepth(-9500);
    }
    const g = this.add.graphics().setDepth(-9800);
    // 秘境地面色调
    for (const r of [...REALMS, HIDDEN]) {
      const [x0, y0, x1, y1] = r.rect;
      g.fillStyle(r.color, 0.16).fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // 妖路（从地图配置读取，默认三路：北 / 东 / 西）
    const lanes = this.sim.map.lanes;
    for (const [w, c, a] of [[150, 0x1a1428, 0.35], [118, 0x6b5640, 0.38], [70, 0x8a7258, 0.18]]) {
      g.lineStyle(w, c, a);
      for (const path of Object.values(lanes)) {
        g.beginPath();
        g.moveTo(path[0][0], path[0][1]);
        for (let i = 1; i < path.length; i++) g.lineTo(path[i][0], path[i][1]);
        g.strokePath();
      }
    }
    // 复活点 · 续命泉眼（位于安全南侧基地后方，复活与回血地标）
    const rp = this.sim.getRevivePoint();
    if (rp) {
      const rr = rp.r || 130;
      g.fillStyle(0x1e4c68, 0.38).fillEllipse(rp.x, rp.y, rr * 2, rr * 1.15);
      g.lineStyle(4, 0x7fe3ff, 0.78).strokeEllipse(rp.x, rp.y, rr * 2, rr * 1.15);
      g.lineStyle(2, 0xffd36a, 0.72).strokeEllipse(rp.x, rp.y, rr * 1.35, rr * 0.76);
      this.add.image(rp.x, rp.y, 'glow').setTint(0x7fe3ff).setBlendMode('ADD').setAlpha(0.42).setScale(7, 4.5).setDepth(-9650);
      this.add.text(rp.x, rp.y + 4, rp.name || '续命泉·复活点', {
        fontFamily: '"Ma Shan Zheng", "STKaiti", serif', fontSize: '26px', color: '#bff6ff', stroke: INK, strokeThickness: 5,
      }).setOrigin(0.5).setAlpha(0.88).setDepth(-9500);
      this.add.text(rp.x, rp.y + 30, '英雄/神兽复活 · 泉内回血', {
        fontFamily: NF, fontSize: '13px', color: '#9ff0b8', stroke: INK, strokeThickness: 3,
      }).setOrigin(0.5).setAlpha(0.85).setDepth(-9500);
    }
    // 灯坛光池
    this.add.image(W.cx, W.cy, 'glow').setTint(0xff9a3c).setBlendMode('ADD').setAlpha(0.5).setScale(16, 12).setDepth(-9700);
    // 静态围墙（可破坏墙体在 render 中动态绘制）
    const wg = this.add.graphics().setDepth(-9600);
    for (const w of this.sim.walls) {
      if (w.destructible) continue;
      wg.fillStyle(0x0b0d18).fillRect(w.x0 - 3, w.y0 + 6, w.x1 - w.x0 + 6, w.y1 - w.y0 + 6);
      wg.fillStyle(0x4a4f72).fillRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
      wg.fillStyle(0x6a7098).fillRect(w.x0 + 4, w.y0 + 4, w.x1 - w.x0 - 8, Math.min(10, w.y1 - w.y0 - 8));
      wg.lineStyle(3, 0x0b0d18).strokeRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
    }
    // 秘境门与名牌
    this.gates = {};
    for (const r of REALMS) {
      const [gx, gy] = gateCenter(r);
      const img = this.add.image(gx, gy + 40, 'g_realm_gate').setOrigin(0.5, 1).setScale(0.7).setDepth(gy + 40);
      const glow = this.add.image(gx, gy - 40, 'glow').setTint(r.color).setBlendMode('ADD').setScale(4).setAlpha(0.55).setDepth(gy + 41);
      this.tweens.add({ targets: glow, alpha: { from: 0.35, to: 0.7 }, duration: 1400, yoyo: true, repeat: -1 });
      const [x0, y0, x1, y1] = r.rect;
      this.add.text((x0 + x1) / 2, (y0 + y1) / 2, r.name, { fontFamily: '"Ma Shan Zheng", "STKaiti", serif', fontSize: '64px', color: '#f3e6c8', stroke: INK, strokeThickness: 8 }).setOrigin(0.5).setAlpha(0.22).setDepth(-9500);
      this.gates[r.id] = { img, glow };
    }
    // 装饰：避开妖路、地基、秘境门、灯坛与复活点
    const rnd = new Phaser.Math.RandomDataGenerator([String(this.seed)]);
    const nearLane = (x, y) => Object.values(lanes).some((p) => p.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < 260 * 260));
    for (let i = 0; i < 140; i++) {
      const x = rnd.between(80, W.main - 80);
      const y = rnd.between(80, W.main - 80);
      if ((x - W.cx) ** 2 + (y - W.cy) ** 2 < 700 * 700 || nearLane(x, y)) continue;
      if (rp && (x - rp.x) ** 2 + (y - rp.y) ** 2 < 260 * 260) continue;
      if (this.sim.walls.some((w) => x > w.x0 - 120 && x < w.x1 + 120 && y > w.y0 - 120 && y < w.y1 + 160)) continue;
      const tree = rnd.frac() < 0.45;
      this.add.image(x, y, tree ? 'g_deco_tree' : 'g_deco_rock').setOrigin(0.5, 0.92).setScale(rnd.realInRange(0.55, 0.85)).setFlipX(rnd.frac() < 0.5).setDepth(y).setTint(0xc8c0e8);
    }
    // 场上小灯笼（沿路）
    for (const path of Object.values(lanes)) {
      for (let i = 1; i < path.length - 1; i++) {
        const [x, y] = path[i];
        this.add.image(x + 110, y - 20, 'field_lantern').setOrigin(0.5, 1).setScale(0.8).setDepth(y - 20);
        this.add.image(x + 116, y - 100, 'glow').setTint(0xffb050).setBlendMode('ADD').setAlpha(0.6).setScale(2).setDepth(y - 19);
      }
    }
    // 七星灯坛
    this.altar = this.add.image(W.cx, W.cy + 90, 'g_altar').setOrigin(0.5, 0.82).setScale(0.95).setDepth(W.cy - 40);
    // 七盏灯的光（随孔明血量逐盏熄灭）
    this.lamps = [];
    const lampPos = [[-150, -40], [-100, -80], [-30, -100], [40, -95], [105, -70], [150, -30], [130, 25]];
    for (const [dx, dy] of lampPos) {
      const l = this.add.image(W.cx + dx, W.cy + 90 + dy - 60, 'glow').setTint(0xffb050).setBlendMode('ADD').setScale(1.4).setAlpha(0.85).setDepth(W.cy + 2000);
      this.lamps.push(l);
    }
    // 地基
    this.fSprites = this.sim.foundations.map((f) => this.add.image(f.x, f.y + 30, 'g_bld_foundation').setOrigin(0.5, 0.75).setScale(0.62).setDepth(f.y - 30));
    // 南华仙人 NPC（金币强化 & 渡劫飞升）
    const N = this.sim.nanhua;
    if (N) {
      const nx = N.x;
      const ny = N.y;
      const npcTex = this.textures.exists('g_kongming') ? 'g_kongming' : 'g_hero_huoqing';
      const aura = this.add.image(nx, ny - 10, 'glow')
        .setTint(0x7fe3ff).setBlendMode('ADD').setScale(3.6, 2.0).setAlpha(0.42).setDepth(ny - 20);
      this.tweens.add({ targets: aura, alpha: { from: 0.28, to: 0.62 }, duration: 1500, yoyo: true, repeat: -1 });
      const haloC = this.add.container(nx, ny).setScale(1, 0.52).setDepth(ny - 10);
      const haloTex = this.textures.exists('vfx_rune_ring') ? 'vfx_rune_ring' : 'glow';
      const halo = this.add.image(0, 0, haloTex)
        .setTint(0xffd36a).setBlendMode('ADD')
        .setScale(haloTex === 'vfx_rune_ring' ? 0.56 : 2.6)
        .setAlpha(0.76);
      haloC.add(halo);
      this.tweens.add({ targets: halo, rotation: Math.PI * 2, duration: 8000, repeat: -1 });
      const npcImg = this.add.image(nx, ny + 4, npcTex)
        .setOrigin(0.5, 0.92).setScale(0.46).setTint(0xc8f4ff).setDepth(ny);
      this.tweens.add({ targets: npcImg, y: ny - 2, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.add.text(nx, ny - 104, '南华仙人 · 强化渡劫', {
        fontFamily: '"Ma Shan Zheng", "STKaiti", serif',
        fontSize: '21px',
        color: '#ffd36a',
        stroke: INK,
        strokeThickness: 5,
      }).setOrigin(0.5).setDepth(9000);
      const nhHit = this.add.circle(nx, ny - 36, N.r || 64, 0, 0.001)
        .setDepth(ny + 5).setInteractive({ useHandCursor: true });
      nhHit.on('pointerdown', () => {
        if (this.paused || this.panelPaused || this.sim.over) return;
        if (this.hud && !this.hud.modal && !this.hud.panel) this.hud.togglePanel('nanhua');
      });
      this.nanhuaNpc = { aura, haloC, halo, img: npcImg, hit: nhHit };
    }
  }

  // ---------------- 输入 ----------------
  onKey(e) {
    const s = this.sim;
    if (this.hud && this.hud.captureKey(e)) return;
    if (s.over) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape') {
      if (this.attackMoveMode) { this.attackMoveMode = false; this.hud.toast('已取消巡攻指示', '#9aa3cf'); return; }
      this.hud.togglePause();
      return;
    }
    if (this.paused || this.panelPaused) return;
    if (k === 'F6') { e.preventDefault?.(); this.manualSave(); return; }
    if (k === 'Tab') { e.preventDefault?.(); this.cmd({ type: 'cycle', dir: e.shiftKey ? -1 : 1 }); return; }
    if (k === 'F1') { e.preventDefault?.(); this.cmd({ type: 'switch', id: s.hero.id }); return; }
    if (k >= '1' && k <= '9') { const id = s.party.filter((i) => s.byId(i))[Number(k) - 1]; if (id) this.cmd({ type: 'switch', id }); return; }
    if (k === 'q' || k === 'e' || k === 'r' || k === 'f') {
      const cu = s.ctrl;
      if (e.ctrlKey || e.shiftKey) {
        const r = this.cmd({ type: 'upgradeSkill', slot: k });
        if (r.ok) this.hud.toast(`技能 ${k.toUpperCase()} 升至 Lv.${r.lv}（剩余技能点 ${r.skillPoints}）`, '#ffd36a');
        return;
      }
      if (cu && cu.kind === 'hero' && cu.skillLvs && (cu.skillLvs[k] || 0) <= 0) {
        if (s.canUpgradeSkill(cu, k)) {
          const r = this.cmd({ type: 'upgradeSkill', slot: k });
          if (r.ok) this.hud.toast(`已习得【${cu.def.skills[k].name}】Lv.1！再按 ${k.toUpperCase()} 施放`, '#ffd36a');
        } else {
          this.hud.toast('该技能尚未学习（升级获得技能点后点 + 或 Ctrl+快捷键学习）', '#ff8a7a');
        }
        return;
      }
      s.input.cast.push(k);
      return;
    }
    if (k === ' ') {
      const cu = s.ctrl;
      if (e.ctrlKey || e.shiftKey) {
        const r = this.cmd({ type: 'upgradeSkill', slot: 'u' });
        if (r.ok) this.hud.toast(`大招升至 Lv.${r.lv}（剩余技能点 ${r.skillPoints}）`, '#ffd36a');
        return;
      }
      if (cu && cu.kind === 'hero' && cu.skillLvs && (cu.skillLvs.u || 0) <= 0) {
        if (s.canUpgradeSkill(cu, 'u')) {
          const r = this.cmd({ type: 'upgradeSkill', slot: 'u' });
          if (r.ok) this.hud.toast(`已习得大招【${cu.def.skills.u.name}】Lv.1！`, '#ffd36a');
        } else {
          this.hud.toast('大招需英雄达到 6 级并消耗技能点学习', '#ff8a7a');
        }
        return;
      }
      s.input.cast.push('u');
      return;
    }
    if (k === 'z') {
      this.attackMoveMode = !this.attackMoveMode;
      this.hud.toast(this.attackMoveMode ? '巡攻模式：点击地面或敌人沿途迎敌（右键/Esc 取消）' : '已取消巡攻指示', this.attackMoveMode ? '#ff8a7a' : '#9aa3cf');
      return;
    }
    if (k === 'c') {
      const r = this.cmd({ type: 'hold' });
      if (r.ok) { this.attackMoveMode = false; this.hud.toast('坚守原位：停步自动反击射程内妖物', '#7fe3ff'); }
      return;
    }
    if (k === 'v') {
      const r = this.cmd({ type: 'recall' });
      if (r.ok) {
        this.attackMoveMode = false;
        const anc = s.getHomeAnchor();
        this.addOrderRipple(anc.x, anc.y, 0x7fe3ff, 'guide');
        this.hud.toast('正在回城吟唱（移动将打断）…', '#7fe3ff');
      }
      return;
    }
    if (k === 'x') {
      const aim = s.input.aim || null;
      const r = this.cmd(aim ? { type: 'blink', x: aim.x, y: aim.y } : { type: 'blink' });
      if (r.ok) this.attackMoveMode = false;
      return;
    }
    if (k === 'l') {
      const r = this.cmd({ type: 'clearGroundItems' });
      if (r.ok) {
        const msg = r.cleared > 0
          ? `已清理 ${r.cleared} 件地面道具${r.keptUnique ? `（保留 ${r.keptUnique} 件唯一道具）` : ''}`
          : (r.keptUnique ? `地面仅剩 ${r.keptUnique} 件唯一道具，已受保护` : '地面当前很干净，无需清理');
        this.hud.toast(msg, r.cleared > 0 ? '#9ff0b8' : '#7fe3ff');
      }
      return;
    }
    if (k >= 'F2' && k <= 'F7') {
      e.preventDefault?.();
      const idx = Number(k.slice(1)) - 2;
      const itemId = QUICK_ITEM_IDS[idx];
      if (itemId) this.cmd({ type: 'useQuickItem', itemId });
      return;
    }
    if (k === 'n') { const r = this.cmd({ type: 'callWave' }); if (r.ok && r.bonus) this.hud.toast(`提前召唤 · 铜钱 +${r.bonus}`); return; }
    if (k === 'm') { setMuted(!isMuted()); this.hud.toast(isMuted() ? '已静音' : '声音开'); return; }
    this.hud.hotkey(k);
  }

  cmd(c) {
    const r = this.sim.command(c);
    if (!r.ok && r.reason) this.hud.toast(r.reason, '#ff8a7a');
    else if (r.ok && (c.type === 'switch' || c.type === 'cycle')) sfx('click');
    return r;
  }

  readInput() {
    const k = this.keys;
    const inp = this.sim.input;
    let mx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let my = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (!mx && !my && touch.mag > 0) { mx = touch.mx * touch.mag; my = touch.my * touch.mag; }
    inp.mx = mx;
    inp.my = my;
    inp.attack = k.J.isDown || !!this.mouseAttack;
    const p = this.input.activePointer;
    if (this.time.now - this.lastMouse < BAL.aimIdle * 1000 && !touch.enabled) {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      inp.aim = { x: wp.x, y: wp.y };
    } else inp.aim = null;
  }

  // ---------------- 主循环 ----------------
  update(_, deltaMs) {
    const rawDt = Math.min(deltaMs, 100) / 1000;
    let feelState = this.feelState || { simScale: 1, offsetX: 0, offsetY: 0, roll: 0 };
    const s = this.sim;
    // 全局错误保护（最后保险，不是泄漏修复的替代品）：Phaser 的主循环先调 update 再排下一帧 rAF，
    // 场景 update 抛出的异常会让整个游戏循环停摆（表现为"闪退/卡死"），所以每个阶段单独兜住并计数，errorCount 经调试钩子暴露。
    try { if (this.feel) feelState = this.feelState = this.feel.update(rawDt); } catch (e) { this.reportError(e, 'feel'); }
    if (!this.paused && !this.panelPaused && !s.over && !this.halted) {
      try {
        this.readInput();
        this.acc += rawDt * this.timeScale * feelState.simScale;
        let n = 0;
        while (this.acc >= TICK && n < 8 * this.timeScale) { s.step(); this.acc -= TICK; n++; }
        if (this.acc > TICK * 4) this.acc = 0;
        this.failStreak = 0;
        if (this.autosave) this.autosave.flush();
      } catch (e) {
        this.acc = 0;
        this.reportError(e, 'sim');
        // 模拟层连续报错说明状态已不一致，继续跑只会刷屏并拖垮帧率：停步并提示重开
        if (++this.failStreak >= 30) { this.halted = true; this.hud?.toast?.('模拟出现异常已暂停，请按 Esc 选择重开', '#ff8a7a'); }
      }
    }
    try { this.render(rawDt, feelState); } catch (e) { this.reportError(e, 'render'); }
    if (s.over && !this.endShown) {
      this.endShown = true;
      this.time.delayedCall(1300, () => this.hud.showResult());
    }
  }

  reportError(e, where) {
    this.errorCount = (this.errorCount || 0) + 1;
    this.lastError = `${where}: ${(e && e.stack) || e}`;
    if (this.errorCount <= 5 || this.errorCount % 500 === 0) console.error(`[guard] ${where} 异常 #${this.errorCount}`, e);
  }

  // 渲染帧位置插值（30Hz 模拟步长 → 60/120fps 丝滑渲染；闪现/传送位移 > 220px 直接吸附不拉丝）
  interp(o, alpha) {
    if (!o || o.prevX === undefined || o.prevY === undefined) return { x: o.x, y: o.y };
    const dx = o.x - o.prevX;
    const dy = o.y - o.prevY;
    if (dx * dx + dy * dy > 220 * 220) return { x: o.x, y: o.y };
    return { x: o.prevX + dx * alpha, y: o.prevY + dy * alpha };
  }

  // ---------------- 渲染 ----------------
  getSprite(id, tex, frame) {
    let sp = this.sprites.get(id);
    if (sp && sp.texKey !== tex) { this.releaseSprite(id); sp = null; }
    if (!sp) {
      const pool = this.pools.get(tex);
      sp = pool && pool.length ? pool.pop() : this.add.image(0, 0, tex, frame);
      sp.texKey = tex;
      sp.setVisible(true).setAlpha(1).clearTint().setRotation(0).setFlipX(false);
      if (frame !== undefined) sp.setFrame(frame);
      this.sprites.set(id, sp);
    }
    sp.seen = this.frameN;
    return sp;
  }

  releaseSprite(id) {
    const sp = this.sprites.get(id);
    if (!sp) return;
    if (sp._feelPopTween) {
      sp._feelPopTween.stop?.();
      sp._feelPopTween = null;
    }
    delete sp._feelRestScaleX;
    delete sp._feelRestScaleY;
    sp.setScale(1);
    sp.setVisible(false);
    let pool = this.pools.get(sp.texKey);
    if (!pool) this.pools.set(sp.texKey, (pool = []));
    pool.push(sp);
    this.sprites.delete(id);
  }

  render(dt, feelState = this.feelState) {
    const s = this.sim;
    this.frameN = (this.frameN || 0) + 1;
    const alpha = (this.paused || this.panelPaused || s.over) ? 1 : Phaser.Math.Clamp(this.acc / TICK, 0, 1);
    const cam = this.cameras.main;
    const ctrl = s.ctrl || s.hero;
    const cPos = this.interp(ctrl, alpha);
    // 帧率无关指数平滑镜头跟随（与创伤震屏偏移分离，互不拉扯）
    const tx = Phaser.Math.Clamp(cPos.x - 640, 0, Math.max(0, BAL.world.w - cam.width));
    const ty = Phaser.Math.Clamp(cPos.y - 60 - 360, 0, Math.max(0, BAL.world.h - cam.height));
    if (this.camBaseX === undefined) {
      this.camBaseX = cam.scrollX;
      this.camBaseY = cam.scrollY;
    }
    const jumpDist = Math.hypot(this.camBaseX - tx, this.camBaseY - ty);
    if (jumpDist > 1200) {
      this.camBaseX = tx;
      this.camBaseY = ty;
    } else {
      const far = Math.abs(this.camBaseX - tx) > 900 || Math.abs(this.camBaseY - ty) > 600;
      const camK = 1 - Math.exp(-(far ? 22 : 10) * Math.min(Math.max(dt, 0.001), 0.05));
      this.camBaseX += (tx - this.camBaseX) * camK;
      this.camBaseY += (ty - this.camBaseY) * camK;
    }
    cam.scrollX = this.camBaseX + (feelState?.offsetX || 0);
    cam.scrollY = this.camBaseY + (feelState?.offsetY || 0);
    const roll = feelState?.roll || 0;
    if (cam.rotation !== roll) cam.setRotation(roll);

    const v = cam.worldView;
    const vx0 = v.x - VIEW_PAD; const vy0 = v.y - VIEW_PAD; const vx1 = v.right + VIEW_PAD; const vy1 = v.bottom + VIEW_PAD;
    const inView = (o) => o.x > vx0 && o.x < vx1 && o.y > vy0 && o.y < vy1;
    const sg = this.shadowG.clear();
    const bg = this.barG.clear();
    this.visibleEnemies = 0;

    // 灯坛七灯随孔明血量熄灭
    const km = s.kongming;
    const lit = Math.ceil((km.hp / km.maxHp) * 7);
    this.lamps.forEach((l, i) => l.setAlpha(i < lit ? 0.75 + Math.sin(s.t * 3 + i) * 0.12 : 0.06));

    // 友军（阵亡后保留短暂倒地消散动画）
    for (const u of s.units) {
      if ((!u.alive && !(u.deadAnimT > 0)) || !inView(u)) {
        if (this.sprites.has(u.id)) this.releaseSprite(u.id);
        continue;
      }
      this.drawUnit(u, sg, bg, alpha);
    }
    // 建筑
    for (const b of s.buildings) {
      if (!b.alive || !inView(b)) {
        if (this.sprites.has(b.id)) this.releaseSprite(b.id);
        continue;
      }
      const sp = this.getSprite(b.id, b.tex || `g_bld_${b.type}`);
      sp.setOrigin(0.5, 0.88).setPosition(b.x, b.y + 22).setDepth(b.y + 22);
      if (!sp._feelPopTween) sp.setScale((b.scale || 0.6) * (1 + (b.lv - 1) * 0.08));
      if (b.hitT > 0) sp.setTintFill(0xffffff); else if (b.lv >= 3) sp.setTint(0xfff0c0); else sp.clearTint();
      if (b.hp < b.maxHp) this.bar(bg, b.x, b.y - (b.h || 110), 64, b.hp / b.maxHp, 0x5fe08a);
      if (b.lv > 1) for (let i = 0; i < b.lv; i++) bg.fillStyle(0xffc977).fillCircle(b.x - 10 + i * 10, b.y - (b.h || 110) + 10, 3);
    }
    // 妖物（20× 怪潮优化：先屏外剔除与统计可见数，超百怪自动简化小怪血条与阴影）
    const visEnemies = this._visEnemies || (this._visEnemies = []);
    visEnemies.length = 0;
    for (let i = 0; i < s.enemies.length; i++) {
      const e = s.enemies[i];
      if (!e.alive || !inView(e)) {
        if (this.sprites.has(e.id)) this.releaseSprite(e.id);
        continue;
      }
      visEnemies.push(e);
    }
    const visCount = visEnemies.length;
    this.visibleEnemies = visCount;
    const denseSwarm = visCount > 100;
    for (let i = 0; i < visCount; i++) {
      this.drawEnemy(visEnemies[i], sg, bg, alpha, denseSwarm, visCount);
    }
    // 弹体（帧间插值）
    for (const p of s.projs) {
      if (!p.alive || !inView(p)) {
        if (this.sprites.has(p.id)) this.releaseSprite(p.id);
        continue;
      }
      const pp = this.interp(p, alpha);
      const sp = this.getSprite(p.id, p.tex || 'proj_talisman');
      sp.setPosition(pp.x, pp.y).setRotation(Math.atan2(p.vy, p.vx)).setDepth(pp.y + 40).setScale(p.scale || (p.side === 'enemy' ? 0.5 : 0.55));
      if (p.tint) sp.setTint(p.tint);
    }
    // 地面掉落物（高阶装备/神兵使用独立装备图标与金色光柱，唯一道具金色光柱保护标记）
    for (const gd of (s.groundItems || [])) {
      const sid = `gd_${gd.id}`;
      if (!inView(gd)) { this.releaseSprite(sid); continue; }
      const isEpic = gd.item.kind === 'equip' && (gd.item.crafted || gd.item.q >= 3);
      const sp = this.getSprite(sid, gd.item.tex || 'g_eq_pill');
      const bob = Math.sin(s.t * 5 + gd.id) * 4;
      const fr = sp.frame;
      const targetSz = isEpic || gd.unique ? 42 : 34;
      const sc = targetSz / Math.max(fr.width || targetSz, fr.height || targetSz);
      sp.setOrigin(0.5, 0.7).setPosition(gd.x, gd.y + bob).setDepth(gd.y + 10).setScale(sc);
      if (gd.item.tint) sp.setTint(parseInt(gd.item.tint, 16));
      const isU = gd.unique || isEpic;
      sg.fillStyle(isU ? 0xffd36a : 0x7fe3ff, isU ? 0.35 : 0.22).fillEllipse(gd.x, gd.y + 4, isU ? 50 : 34, isU ? 24 : 16);
      sg.lineStyle(isU ? 3 : 2, isU ? 0xffd36a : 0x9ff0b8, 0.9).strokeEllipse(gd.x, gd.y + 4, isU ? 50 : 34, isU ? 24 : 16);
      if (isU) {
        bg.fillStyle(0xffd36a, 0.22).fillRect(gd.x - 10, gd.y - 74, 20, 76);
        bg.fillStyle(0xffd36a, 0.95).fillCircle(gd.x, gd.y - 48, 5);
      }
    }
    // 清理已消失实体的精灵
    for (const [id, sp] of this.sprites) if (sp.seen !== this.frameN) this.releaseSprite(id);

    // 区域（技能圈/预警/冰墙）+ 可破坏城墙动态绘制
    const zg = this.zoneG.clear();
    for (const z of s.zones) if (z.alive && inView(z)) drawZone(this, zg, z, s);
    for (const w of (s.walls || [])) {
      if (!w.destructible || !w.alive) continue;
      const mx = (w.x0 + w.x1) / 2; const my = (w.y0 + w.y1) / 2;
      if (!inView({ x: mx, y: my })) continue;
      zg.fillStyle(0x525880, 0.95).fillRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
      zg.lineStyle(3, 0xffc977, 0.9).strokeRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
      if (w.hp < w.maxHp) this.bar(bg, mx, w.y0 - 10, 68, w.hp / w.maxHp, 0xffc977);
    }
    // 回城吟唱光环与目的地信标
    for (const u of s.units) {
      if (!u.alive || !u.recall) continue;
      const rc = u.recall;
      const prog = 1 - Math.max(0, rc.t) / Math.max(0.1, rc.total);
      zg.lineStyle(4, 0x7fe3ff, 0.9).strokeEllipse(u.x, u.y, 76, 38);
      zg.fillStyle(0x7fe3ff, 0.22).fillEllipse(u.x, u.y, 76 * prog, 38 * prog);
      if (inView(rc.dest)) {
        zg.lineStyle(3, 0xffd36a, 0.85).strokeEllipse(rc.dest.x, rc.dest.y, 84, 42);
      }
    }
    // 当前操控单位脚下金环 + WC3 指令路径/锁定/坚守视觉 + 军令目标信标
    const rg = this.ringG.clear();
    const ag = this.aimWorldG.clear();
    if (ctrl.alive) {
      const isHold = ctrl.order && ctrl.order.type === 'hold';
      const ringCol = this.attackMoveMode ? 0xff5a4a : isHold ? 0x7fe3ff : 0xffc977;
      rg.lineStyle(3, ringCol, 0.92).strokeEllipse(cPos.x, cPos.y, ctrl.r * 3.2, ctrl.r * 1.5);
      rg.lineStyle(8, ringCol, 0.18).strokeEllipse(cPos.x, cPos.y, ctrl.r * 3.6, ctrl.r * 1.8);
      if (isHold || this.attackMoveMode) {
        const rr = (ctrl.def.basic && ctrl.def.basic.range) || 140;
        rg.lineStyle(2, ringCol, 0.28).strokeEllipse(cPos.x, cPos.y, rr * 2, rr * 1.15);
      }
      if (s.input.aim && !(this.hud && this.hud.aimState)) {
        const a = Math.atan2(s.input.aim.y - cPos.y, s.input.aim.x - cPos.x);
        rg.fillStyle(ringCol, 0.8).fillTriangle(cPos.x + Math.cos(a) * 52, cPos.y + Math.sin(a) * 26, cPos.x + Math.cos(a + 0.2) * 40, cPos.y + Math.sin(a + 0.2) * 20, cPos.x + Math.cos(a - 0.2) * 40, cPos.y + Math.sin(a - 0.2) * 20);
      }
      // 王者荣耀风格技能方向指示器（在顶层 aimWorldG 绘制，永不被七星灯坛/地基/建筑遮挡）
      const aimSt = this.hud && this.hud.aimState;
      if (aimSt && ctrl.alive) {
        const col = aimSt.cancelled ? 0xff4a3a : 0x7fe3ff;
        const maxR = aimSt.range || 320;
        ag.lineStyle(2.5, col, 0.5).strokeEllipse(cPos.x, cPos.y, maxR * 2, maxR * 1.15);
        ag.fillStyle(col, 0.06).fillEllipse(cPos.x, cPos.y, maxR * 2, maxR * 1.15);
        const a = aimSt.ang;
        const reach = maxR * Math.max(0.25, aimSt.ratio || 0.75);
        const tx2 = cPos.x + Math.cos(a) * reach;
        const ty2 = cPos.y + Math.sin(a) * reach;
        if (aimSt.kind === 'aoe') {
          const ar = aimSt.aoeR || 120;
          ag.lineStyle(2, col, 0.65).lineBetween(cPos.x, cPos.y, tx2, ty2);
          ag.fillStyle(col, 0.22).fillEllipse(tx2, ty2, ar * 2, ar * 1.1);
          ag.lineStyle(3, col, 0.95).strokeEllipse(tx2, ty2, ar * 2, ar * 1.1);
        } else {
          // 直线/扇形方向指示箭头
          const w = 22;
          const px = -Math.sin(a) * w;
          const py = Math.cos(a) * w;
          ag.fillStyle(col, 0.26).fillPoints([
            { x: cPos.x + px * 0.5, y: cPos.y + py * 0.5 },
            { x: cPos.x - px * 0.5, y: cPos.y - py * 0.5 },
            { x: tx2 - px * 0.65, y: ty2 - py * 0.65 },
            { x: tx2 + px * 0.65, y: ty2 + py * 0.65 },
          ], true);
          ag.lineStyle(3, col, 0.92).lineBetween(cPos.x, cPos.y, tx2, ty2);
          ag.fillStyle(col, 0.98).fillTriangle(
            tx2 + Math.cos(a) * 26, ty2 + Math.sin(a) * 26,
            tx2 + Math.cos(a + 2.35) * 18, ty2 + Math.sin(a + 2.35) * 18,
            tx2 + Math.cos(a - 2.35) * 18, ty2 + Math.sin(a - 2.35) * 18,
          );
        }
      }
      const o = ctrl.order;
      if (o && (o.type === 'move' || o.type === 'attackMove' || o.type === 'buildMove' || o.type === 'pickupMove')) {
        const col = o.type === 'attackMove' ? 0xff5a4a : (o.type === 'buildMove' || o.type === 'pickupMove') ? 0xffc977 : 0x5fe08a;
        const dx = o.x - ctrl.x; const dy = o.y - ctrl.y; const dist = Math.hypot(dx, dy);
        if (dist > 24) {
          const steps = Math.min(24, Math.max(3, Math.floor(dist / 32)));
          rg.fillStyle(col, 0.55);
          for (let i = 1; i < steps; i++) {
            const f = i / steps;
            rg.fillCircle(ctrl.x + dx * f, ctrl.y + dy * f, 2.6);
          }
          const pulse = 1 + Math.sin(s.t * 9) * 0.14;
          rg.lineStyle(3, col, 0.85).strokeEllipse(o.x, o.y, 44 * pulse, 22 * pulse);
          rg.fillStyle(col, 0.22).fillEllipse(o.x, o.y, 26 * pulse, 13 * pulse);
        }
      } else if (o && o.type === 'attack') {
        const tgt = s.enemies.find((e) => e.id === o.targetId && e.alive);
        if (tgt) {
          const pulse = 1 + Math.sin(s.t * 12) * 0.1;
          rg.lineStyle(3, 0xff4a3a, 0.92).strokeEllipse(tgt.x, tgt.y, tgt.r * 3.4 * pulse, tgt.r * 1.6 * pulse);
        }
      }
    }
    // 点击地面扩散/收缩涟漪
    for (let i = this.orderRipples.length - 1; i >= 0; i--) {
      const rp = this.orderRipples[i];
      rp.life -= dt;
      if (rp.life <= 0) { this.orderRipples.splice(i, 1); continue; }
      const k = rp.life / rp.max;
      const rad = rp.kind === 'guide' ? 24 + (1 - k) * 56 : 14 + k * 42;
      rg.lineStyle(3, rp.color, k * 0.95).strokeEllipse(rp.x, rp.y, rad * 2, rad);
      if (rp.kind === 'move' || rp.kind === 'attack') {
        const h = 10 + k * 14;
        rg.lineStyle(2.5, rp.color, k * 0.9);
        rg.lineBetween(rp.x - 8, rp.y - h - 6, rp.x, rp.y - h + 4);
        rg.lineBetween(rp.x + 8, rp.y - h - 6, rp.x, rp.y - h + 4);
      }
    }
    // 军令追踪目标光圈
    if (this.questGuide) {
      const qg = this.questGuide;
      if (ctrl.alive && (ctrl.x - qg.x) ** 2 + (ctrl.y - qg.y) ** 2 < 140 * 140) {
        this.questGuide = null;
      } else {
        const pulse = 1 + Math.sin(s.t * 6) * 0.16;
        rg.lineStyle(4, 0xffd36a, 0.9).strokeEllipse(qg.x, qg.y, 96 * pulse, 46 * pulse);
        rg.fillStyle(0xffd36a, 0.14).fillEllipse(qg.x, qg.y, 82 * pulse, 38 * pulse);
      }
    }
    for (const L of LAYERS) L(this, s, inView, dt);
    // 特效
    drawFx(this, s, dt, inView);
  }

  bar(g, x, y, w, k, color) {
    g.fillStyle(0x0b0d18).fillRect(x - w / 2 - 2, y - 2, w + 4, 8);
    g.fillStyle(0x3a1418).fillRect(x - w / 2, y, w, 4);
    g.fillStyle(color).fillRect(x - w / 2, y, w * Math.max(0, k), 4);
  }

  drawUnit(u, sg, bg, alpha = 1) {
    const d = u.def;
    const s = this.sim;
    const pos = this.interp(u, alpha);
    const ux = pos.x;
    const uy = pos.y;
    const act = u.action || { state: u.moving ? 'walk' : 'idle', t: 0, dur: 0, slot: null, ang: 0 };
    const resolvedSheet = ensureUnitSpriteSheet(this, d.tex, u.key);
    const nativeMultiPose = isNativeSpriteSheet(resolvedSheet);
    const useLegacyAzhuRun = !nativeMultiPose && u.key === 'azhu' && (act.state === 'walk' || act.state === 'idle');
    const sheetKey = useLegacyAzhuRun ? 'hero_run' : resolvedSheet;

    let sp = this.sprites.get(u.id);
    if (!sp || sp.texKey !== sheetKey) {
      this.releaseSprite(u.id);
      sp = this.pools.get(sheetKey)?.pop() || this.add.sprite(0, 0, sheetKey, 0);
      sp.texKey = sheetKey;
      sp.setVisible(true).setAlpha(1).clearTint().setRotation(0).setFlipX(false);
      this.sprites.set(u.id, sp);
    }
    sp.seen = this.frameN;

    if (useLegacyAzhuRun) {
      if (u.moving) { if (!sp.anims.isPlaying) sp.play('run'); }
      else if (sp.anims.isPlaying) { sp.anims.stop(); sp.setFrame(0); }
    } else if (isActionSpriteSheet(sheetKey)) {
      playUnitActionAnim(sp, sheetKey, u.alive ? act.state : 'dead', act.seq || 0);
    }

    // 动作位移前冲（原生多姿态图已含姿态变化，保留轻盈前冲；单图烘焙保留完整幅度）
    let lungeX = 0;
    let lungeY = 0;
    if ((act.state === 'attack' || act.state === 'cast' || act.state === 'ult' || act.state === 'hurt') && act.dur > 0) {
      const p = 1 - Math.max(0, act.t) / act.dur;
      const baseImp = act.state === 'ult' ? 14 : act.state === 'cast' ? 10 : act.state === 'hurt' ? 7 : 8;
      const impulse = Math.sin(p * Math.PI) * (nativeMultiPose ? baseImp * 0.45 : baseImp);
      lungeX = Math.cos(act.ang || 0) * impulse;
      lungeY = Math.sin(act.ang || 0) * impulse * 0.55;
    }
    const baseH = u.h || 84;
    const frameH = (sp.frame && sp.frame.height) || 180;
    const sc = useLegacyAzhuRun ? (d.scale || 0.5) : nativeMultiPose ? ((baseH * 1.24) / frameH) : ((baseH * 1.45) / frameH);
    const bob = useLegacyAzhuRun && u.moving ? Math.abs(Math.sin(s.t * 12 + u.id)) * 3 : 0;

    sp.setOrigin(0.5, 0.92)
      .setPosition(ux + lungeX, uy + lungeY - bob)
      .setDepth(uy);
    if (!sp._feelPopTween) sp.setScale(sc);
    sp.setFlipX(u.face < 0);
    if (!u.alive) {
      sp.setTint(0x9a8fa8);
      sp.setAlpha(Math.max(0.15, (u.deadAnimT || 0) / 0.65));
      sg.fillStyle(0x000000, 0.22 * Math.max(0.2, (u.deadAnimT || 0) / 0.65)).fillEllipse(ux, uy, u.r * 2.4, u.r * 0.9);
      return;
    }
    if (u.hitT > 0) sp.setTintFill(0xff6a5a);
    else if (act.state === 'ult') sp.setTint(0xffe8a0);
    else if (u.invuln > 0) sp.setTint(0xfff0a0);
    else if (u.def.tint) sp.setTint(u.def.tint);
    else sp.clearTint();
    sp.setAlpha(u.invuln > 0 && Math.floor(s.t * 12) % 2 ? 0.6 : 1);
    if (u.kind === 'kongming') sp.setPosition(ux, uy + 4).setRotation(nativeMultiPose ? 0 : Math.sin(s.t * 1.5) * 0.02);

    // 移动脚步微尘粒子（每 ~0.28s 一次）
    if (u.moving && u.kind !== 'kongming' && !u.flying && ((s.tickN + u.id * 3) % 9 === 0)) {
      this.pPaper.explode(1, ux - u.face * 10, uy - 4);
    }

    sg.fillStyle(0x000000, 0.35).fillEllipse(ux, uy, u.r * 2.6, u.r * 1.1);
    if (u.kind === 'summon') {
      sg.lineStyle(2.5, 0x5fe0b8, 0.88).strokeEllipse(ux, uy, u.r * 3.0, u.r * 1.3);
    }
    const hh = u.h || 80;
    if (u.kind === 'summon') {
      this.bar(bg, ux, uy - hh - 10, 60, u.hp / u.maxHp, 0x5fe0b8);
      if (u.ttl > 0) bg.fillStyle(0xffd36a).fillRect(ux - 30, uy - hh - 4, Math.min(60, 60 * Math.max(0, u.ttl / 14)), 2.5);
    } else if (u.kind !== 'kongming') {
      this.bar(bg, ux, uy - hh - 10, 56, u.hp / u.maxHp, 0x5fe08a);
      if (u.shield > 0) bg.fillStyle(0x7fe3ff).fillRect(ux - 28, uy - hh - 15, Math.min(56, 56 * u.shield / u.maxHp), 3);
    } else {
      this.bar(bg, ux, uy - hh - 14, 100, u.hp / u.maxHp, s.t - s.kmAlert.t < 0.6 ? 0xff6a5a : 0x5fe08a);
    }
  }

  drawEnemy(e, sg, bg, alpha = 1, denseSwarm = false, visCount = 0) {
    const s = this.sim;
    const d = e.def;
    const pos = this.interp(e, alpha);
    const ex = pos.x;
    const ey = pos.y;
    let sp;
    const unitLookup = e.sheetKey || e.beastKey || e.boss || e.type;
    const nativeEnemy = !e.sheet ? resolveNativeSheet(this, e.sheetKey || d.tex || e.tex, unitLookup) : null;
    if (nativeEnemy) {
      const sheetKey = ensureUnitSpriteSheet(this, e.sheetKey || d.tex || e.tex, unitLookup);
      sp = this.sprites.get(e.id);
      if (!sp || sp.texKey !== sheetKey) {
        this.releaseSprite(e.id);
        sp = this.pools.get(sheetKey)?.pop() || this.add.sprite(0, 0, sheetKey, 0);
        sp.texKey = sheetKey;
        sp.setVisible(true).setAlpha(1).clearTint().setRotation(0).setFlipX(false);
        this.sprites.set(e.id, sp);
      }
      sp.seen = this.frameN;
      const eState = e.hitT > 0 ? 'hurt' : (e.atkAnim > 0 || e.charge > 0 || e.castT > 0) ? 'attack' : 'walk';
      playUnitActionAnim(sp, sheetKey, eState, 0);
    } else if (e.sheet) {
      sp = this.sprites.get(e.id);
      if (!sp || sp.texKey !== e.sheet) {
        this.releaseSprite(e.id);
        sp = this.pools.get(e.sheet)?.pop() || this.add.sprite(0, 0, e.sheet, 0);
        sp.texKey = e.sheet;
        sp.setVisible(true);
        this.sprites.set(e.id, sp);
        sp.play(e.sheet);
      }
      sp.seen = this.frameN;
    } else sp = this.getSprite(e.id, d.tex || e.tex);
    const h = e.h;
    let sc = (h / (sp.frame.height || 100)) * (e.sheetScale || 1);
    let yOff = 0;
    if (!e.sheet && !nativeEnemy && d.hop) yOff = -Math.abs(Math.sin((s.t / d.hop) * Math.PI + e.id)) * 14;
    else if (e.flying) yOff = -20 + Math.sin(s.t * 5 + e.id) * 5;
    else if (!nativeEnemy) yOff = -Math.abs(Math.sin(s.t * 8 + e.id)) * 3;
    if (e.charge > 0 || e.fuse > 0) sc *= 1 + Math.sin(s.t * 40) * 0.05;
    sp.setOrigin(0.5, 0.95).setPosition(ex, ey + yOff).setDepth(ey);
    if (!sp._feelPopTween) sp.setScale(sc);
    sp.setFlipX(d.faceRight === false ? e.face > 0 : e.face < 0);
    if (e.hitT > 0) sp.setTintFill(0xffffff);
    else if (e.st.freeze > 0) sp.setTint(0x9fe8ff);
    else if (e.charge > 0 || e.fuse > 0) sp.setTint(0xff6a5a);
    else if (e.st.silence > 0) sp.setTint(0xd8b8ff);
    else if (e.tint) sp.setTint(e.tint);
    else if (e.st.slow) sp.setTint(0xb8d8ff);
    else sp.clearTint();

    const isMajor = !!(e.boss || e.elite || e.banditBoss || e.enemyTower);
    if (!denseSwarm || isMajor) {
      sg.fillStyle(0x000000, e.flying ? 0.18 : 0.32).fillEllipse(ex, ey, e.r * 2.4, e.r * 1);
    } else if (visCount <= 240) {
      sg.fillStyle(0x000000, 0.24).fillRect(ex - e.r * 0.9, ey - e.r * 0.3, e.r * 1.8, e.r * 0.6);
    }
    if (e.boss && e.boss !== 'realm') return; // 主线 BOSS 血条在 HUD 顶部
    if (e.boss === 'realm' || e.banditBoss) {
      this.bar(bg, ex, ey - h - 10, 96, e.hp / e.maxHp, e.banditBoss ? 0xff9a3c : 0xffc94a);
    } else if (e.enemyTower) {
      this.bar(bg, ex, ey - h - 10, 74, e.hp / e.maxHp, 0xff5a4a);
    } else if (e.elite) {
      sg.lineStyle(4, 0xff4a3a, 0.6).strokeEllipse(ex, ey, e.r * 3, e.r * 1.4);
      this.bar(bg, ex, ey - h - 8, 80, e.hp / e.maxHp, 0xff9a3c);
    } else if (e.hp < e.maxHp) {
      const isCtrlTarget = s.ctrl?.tgt === e || (s.ctrl?.order?.type === 'attack' && s.ctrl.order.targetId === e.id);
      if (!denseSwarm || isCtrlTarget) {
        this.bar(bg, ex, ey - h - 6, 40, e.hp / e.maxHp, 0xe0463a);
      } else if (visCount <= 220 && ((e.id % 3) === 0)) {
        bg.fillStyle(0xe0463a, 0.85).fillRect(ex - 14, ey - h - 5, Math.max(2, 28 * Math.max(0, e.hp / e.maxHp)), 3);
      }
    }
  }

  // 文字飘字（对象池）
  floatText(x, y, str, color, size = 20) {
    const t = this.texts[this.textIdx++ % this.texts.length];
    this.tweens.killTweensOf(t);
    t.setText(str).setColor(color).setFontSize(size).setPosition(x + (Math.random() - 0.5) * 20, y).setAlpha(1).setScale(1).setVisible(true);
    this.tweens.add({ targets: t, y: y - 46, alpha: 0, duration: 760, ease: 'Cubic.easeOut', onComplete: () => t.setVisible(false) });
  }
}
