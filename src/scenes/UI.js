import Phaser from 'phaser';
import UP from '../data/upgrades.json';
import WV from '../data/waves.json';
import BAL from '../data/balance.json';
import { TF, BF, NF, INK } from '../fonts.js';
import { sfx, setMuted, isMuted } from '../audio.js';
import { loadSave, writeSave } from '../save.js';
import { touch, setTouchVisible, setDashProgress } from '../touch.js';
import { makeButton, popIn, drawPanel, drawBox, keycap, bump, countUp, fmtTime as fmt, fmtNum } from '../widgets.js';

const hex = (c) => Phaser.Display.Color.HexStringToColor(c).color;
const INK_N = 0x0b0d18;
const ICON_SCHOOL = {};
for (const u of [...UP.list, ...UP.evolutions]) ICON_SCHOOL[u.icon] = u.school;
const schoolColor = (icon) => hex(UP.schools[ICON_SCHOOL[icon] || 'gen'].color);
const EVENTS = [...WV.events].sort((a, b) => a.at - b.at);
const CARD_X = [312, 640, 968];
const CARD_Y = 400;

// 界面层（与 Game 并行运行、不受镜头震动影响）。Game 调用的接口：
//   flashHurt() banner(text, color, big) showBoss(name) hideBoss() trackElite(enemy, name)
//   showChoices(info, choices, rerolls, { pick(choice), reroll() -> {choices, rerolls} | null })
//   showResult({ victory, time, level, kills, top, soul, build, seed })
// HUD 每帧直接读 Game 字段：p.hp p.maxHp p.dashCdLeft p.stats.dashCd level xp need t kills coins boss bossPhase owned()
export class UI extends Phaser.Scene {
  constructor() { super('UI'); }

  create() {
    this.game_ = this.scene.get('Game');
    this.modal = null;
    this.elites = [];
    this.bossLabel = '';
    this.makeTextures();
    this.buildHud();
    this.input.keyboard.on('keydown', (e) => this.onKey(e));
    // 切后台 / 失去焦点 / 竖屏 → 自动暂停，回来停在暂停面板里，进度原样保留
    const onVis = () => { if (document.hidden) this.openPause(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onVis);
    touch.onPause = () => { if (!this.modal) this.openPause(); else if (this.modal.kind === 'pause') this.resumeGame(); };
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onVis);
      touch.onPause = null;
      setTouchVisible(false);
    });
  }

  makeTextures() {
    if (this.textures.exists('ui_vignette')) return;
    const t = this.textures.createCanvas('ui_vignette', 640, 360);
    const c = t.getContext();
    const g = c.createRadialGradient(320, 180, 110, 320, 180, 380);
    g.addColorStop(0, 'rgba(224,70,58,0)');
    g.addColorStop(0.55, 'rgba(224,70,58,0.25)');
    g.addColorStop(1, 'rgba(200,30,30,0.95)');
    c.fillStyle = g;
    c.fillRect(0, 0, 640, 360);
    t.refresh();
  }

  // ---------------- HUD ----------------
  buildHud() {
    const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({ fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 5, ...extra });
    this.hudG = this.add.graphics();
    this.eliteG = this.add.graphics();
    this.eliteTexts = [];

    // 经验条文字
    this.xpLabel = this.add.text(1176, 11, '经验', st(16, '#ffffff', BF, { strokeThickness: 3, fontStyle: 'bold' })).setOrigin(1, 0.5);
    this.xpNum = this.add.text(1182, 11, '', st(16, '#ffffff', NF, { strokeThickness: 3, fontStyle: 'bold' })).setOrigin(0, 0.5);

    // 头像（hero 立绘裁出头部）
    this.portraitBg = this.add.graphics();
    this.portraitBg.fillStyle(0x1a1f45).fillCircle(54, 68, 32);
    this.portraitBg.fillStyle(0x3b4aa0, 0.6).fillCircle(54, 62, 24);
    this.portrait = this.add.image(54, 34, 'hero').setOrigin(0.5, 0).setScale(0.3);
    const mask = this.make.graphics({ add: false }).fillCircle(54, 68, 30);
    this.portrait.setMask(mask.createGeometryMask());

    this.lvText = this.add.text(100, 38, '', st(16, '#ffc977', BF, { fontStyle: 'bold', strokeThickness: 4 })).setOrigin(0, 0.5);
    this.hpText = this.add.text(220, 70, '', { fontFamily: NF, fontSize: '13px', color: '#ffffff', fontStyle: 'bold', stroke: INK, strokeThickness: 3 }).setOrigin(0.5);

    // 计时与下一事件
    this.timeText = this.add.text(640, 50, '', st(40, '#f3e6c8', NF, { strokeThickness: 7, fontStyle: 'bold' })).setOrigin(0.5);
    this.nextLabel = this.add.text(640, 88, '', st(14, '#ff8a7a', BF, { fontStyle: 'bold', strokeThickness: 4 })).setOrigin(1, 0.5);
    this.nextNum = this.add.text(640, 88, '', st(14, '#ffc977', NF, { fontStyle: 'bold', strokeThickness: 4 })).setOrigin(0, 0.5);

    // 右上：击杀 / 魂火
    this.stat = [['击杀', '#f3e6c8'], ['魂火', '#ff9a3c']].map(([label, color], i) => {
      const y = 40 + i * 30;
      const num = this.add.text(1258, y, '0', st(20, color, NF, { fontStyle: 'bold' })).setOrigin(1, 0.5);
      const lab = this.add.text(1180, y, label, st(16, '#c4c8ea', BF, { fontStyle: 'bold' })).setOrigin(1, 0.5);
      return { num, lab, v: -1, last: 0 };
    });
    this.soulIcon = this.add.image(0, 70, 'glow').setTint(0xff9a3c).setBlendMode('ADD').setScale(0.45);

    // 构筑图标
    this.iconRow = this.add.container(0, 0);
    this.iconKey = '';

    // 冲刺
    this.dashLabel = this.add.text(670, 676, '冲刺', st(15, '#f3e6c8', BF, { fontStyle: 'bold', strokeThickness: 4 })).setOrigin(0, 0.5);
    this.dashKey = keycap(this, 0, 676, '空格', 13);
    this.dashKey.x = 670 + this.dashLabel.width + 8 + this.dashKey.w / 2;
    this.dashReady = true;

    // 触屏暂停键：画在 Phaser 画布里（不用 DOM 覆盖层），按下即触发，击杀/魂火两行之下
    if (touch.enabled) {
      const pb = this.add.container(1226, 128).setDepth(40);
      const pg = this.add.graphics();
      pg.fillStyle(INK_N, 0.9).fillCircle(0, 0, 31).fillStyle(0x1b2148, 0.85).fillCircle(0, 0, 27);
      pg.lineStyle(3, 0xff9a3c, 0.7).strokeCircle(0, 0, 29);
      pg.fillStyle(0xf3e6c8).fillRoundedRect(-9, -11, 6, 22, 2).fillRoundedRect(3, -11, 6, 22, 2);
      pb.add(pg);
      pb.setSize(96, 96).setInteractive(new Phaser.Geom.Circle(48, 48, 48), Phaser.Geom.Circle.Contains);
      pb.on('pointerdown', () => { if (touch.onPause) touch.onPause(); });
      this.pauseBtn = pb;
    }

    // Boss
    this.bossName = this.add.text(640, 112, '', st(24, '#ffb0a0', TF, { strokeThickness: 6 })).setOrigin(0.5).setVisible(false);
    this.bossPhaseText = this.add.text(948, 140, '', st(13, '#ff7a6a', BF, { fontStyle: 'bold', strokeThickness: 4 })).setOrigin(0, 0.5).setVisible(false);

    // 受击红闪 + 低血量脉冲
    this.lowVig = this.add.image(640, 360, 'ui_vignette').setDisplaySize(1280, 720).setAlpha(0).setDepth(49);
    this.hurtVig = this.add.image(640, 360, 'ui_vignette').setDisplaySize(1280, 720).setAlpha(0).setDepth(50);
    this.hurtFlash = this.add.rectangle(640, 360, 1280, 720, 0xe0463a, 0).setDepth(50);
    this.bannerText = this.add.text(640, 228, '', st(44, '#ffc977', TF, { strokeThickness: 8 })).setOrigin(0.5).setAlpha(0).setDepth(60);
  }

  update(time) {
    const g = this.game_;
    if (!g || !g.p || !g.p.stats) return;
    const p = g.p;
    const h = this.hudG.clear();
    if (touch.enabled) {
      if (touch.portrait && !this.modal) this.openPause();
      setTouchVisible(!this.modal && !g.over);
      if (this.pauseBtn) this.pauseBtn.setVisible(!this.modal && !g.over);
      setDashProgress(Phaser.Math.Clamp(1 - p.dashCdLeft / p.stats.dashCd, 0, 1));
    }

    // 经验通栏
    const xpk = Phaser.Math.Clamp(g.xp / g.need, 0, 1);
    // 空槽用亮一档的墨蓝 + 刻度，能看出还差多少
    h.fillStyle(0x2a3366).fillRect(0, 0, 1280, 22);
    h.fillStyle(0x3a4580).fillRect(0, 0, 1280, 6);
    h.fillStyle(0x4a5590, 0.8);
    for (let i = 1; i < 10; i++) h.fillRect(128 * i - 1, 0, 2, 22);
    h.fillStyle(0x2fb5e8).fillRect(0, 0, 1280 * xpk, 22);
    h.fillStyle(0xa6efff, 0.65).fillRect(0, 0, 1280 * xpk, 7);
    h.fillStyle(INK_N).fillRect(0, 22, 1280, 3);
    this.xpNum.setText(`${String(Math.floor(xpk * 100)).padStart(2, ' ')}%`);

    // 头像环 + 血条
    h.lineStyle(4, INK_N).strokeCircle(54, 68, 33);
    h.lineStyle(3, 0xff9a3c).strokeCircle(54, 68, 36);
    const hpk = Phaser.Math.Clamp(p.hp / p.maxHp, 0, 1);
    h.fillStyle(0x3a1220).fillRoundedRect(100, 58, 240, 22, 6);
    if (hpk > 0) {
      h.fillStyle(hpk < 0.3 ? 0xff3b3b : 0xd42f3a).fillRoundedRect(100, 58, Math.max(12, 240 * hpk), 22, 6);
      h.fillStyle(0xff7a6a, 0.8).fillRoundedRect(103, 60, Math.max(6, 240 * hpk - 6), 6, 3);
    }
    h.lineStyle(3, INK_N).strokeRoundedRect(100, 58, 240, 22, 6);
    this.lvText.setText(`Lv ${g.level} · 阿烛`);
    this.hpText.setText(`${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`);
    this.lowVig.setAlpha(hpk > 0 && hpk < 0.3 && !g.over ? 0.22 + 0.16 * Math.sin(time / 180) : 0);

    // 计时 + 下一事件
    this.timeText.setText(fmt(g.t));
    const bossAlive = g.boss && g.boss.alive;
    const next = EVENTS.find((e) => e.at > g.t);
    if (next && !bossAlive) {
      this.nextLabel.setText(`${next.text}  ·  `);
      this.nextNum.setText(fmt(next.at - g.t));
      const w = this.nextLabel.width + this.nextNum.width;
      this.nextLabel.x = 640 - w / 2 + this.nextLabel.width;
      this.nextNum.x = this.nextLabel.x;
      this.nextLabel.setColor(next.at - g.t < 10 ? '#ff5a4a' : '#ff8a7a').setVisible(true);
      this.nextNum.setVisible(true);
    } else {
      this.nextLabel.setVisible(false);
      this.nextNum.setVisible(false);
    }

    // 右上：击杀 / 魂火（预估）
    const S = BAL.soul;
    const soul = Math.round((g.t * S.perSecond + g.kills * S.perKill + g.coins * S.perCoin + (g.bonusSoul || 0)) * (p.stats.soulMul || 1));
    [g.kills, soul].forEach((v, i) => {
      const s = this.stat[i];
      if (v === s.v) return;
      const grew = s.v >= 0;
      s.v = v;
      s.num.setText(fmtNum(v));
      s.lab.x = 1258 - s.num.width - (i === 1 ? 30 : 12);
      if (grew && time - s.last > 140) { s.last = time; bump(this, s.num, 1.3); }
    });
    this.soulIcon.x = 1258 - this.stat[1].num.width - 15;

    // 冲刺冷却环：有弹窗（三选一/暂停/结算）时整组隐藏，不和卡片抢视线
    const showDash = !this.modal && !touch.enabled; // 触屏用 DOM 闪避键自带冷却环
    this.dashLabel.setVisible(showDash);
    this.dashKey.setVisible(showDash);
    const k = Phaser.Math.Clamp(1 - p.dashCdLeft / p.stats.dashCd, 0, 1);
    const ready = k >= 1;
    if (ready && !this.dashReady) bump(this, this.dashKey, 1.25);
    this.dashReady = ready;
    const pulse = ready ? 1 + 0.06 * Math.sin(time / 160) : 1;
    if (showDash) {
      h.fillStyle(INK_N).fillCircle(640, 678, 26);
      h.fillStyle(0x1b2148).fillCircle(640, 676, 23);
      h.fillStyle(ready ? 0x7fe3ff : 0x3f7fa0).slice(640, 676, 23 * pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).fillPath();
      if (ready) h.fillStyle(0xd9f8ff, 0.5).fillCircle(640, 676, 9);
      h.lineStyle(3, INK_N).strokeCircle(640, 676, 23);
    }
    this.dashLabel.setColor(ready ? '#7fe3ff' : '#8f96c4');

    // Boss 大血条
    if (bossAlive) {
      const bk = Phaser.Math.Clamp(g.boss.hp / g.boss.maxHp, 0, 1);
      h.fillStyle(INK_N).fillRoundedRect(337, 132, 606, 26, 8);
      h.fillStyle(0x200a20).fillRoundedRect(340, 130, 600, 22, 7);
      h.fillStyle(g.bossPhase ? 0xff5a3a : 0xb36bff).fillRoundedRect(340, 130, Math.max(14, 600 * bk), 22, 7);
      h.fillStyle(0xffffff, 0.25).fillRoundedRect(344, 132, Math.max(8, 600 * bk - 8), 6, 3);
      h.lineStyle(1, INK_N, 0.6);
      h.lineBetween(640, 132, 640, 150);
      h.lineStyle(3, INK_N).strokeRoundedRect(340, 130, 600, 22, 7);
      this.bossName.setVisible(true);
      this.bossPhaseText.setText(g.bossPhase ? '灯火尽燃' : '').setVisible(g.bossPhase);
    } else if (this.bossName.visible && !(g.boss && g.boss.alive)) {
      this.bossName.setVisible(false);
      this.bossPhaseText.setVisible(false);
    }

    this.drawElites(g);
    this.drawIcons(g);
    // 弹窗标题压在计时区上方：弹窗打开时把中上方 HUD 文字淡出，避免透出叠字
    const a = this.modal ? 0 : 1;
    for (const t of [this.timeText, this.nextLabel, this.nextNum, this.bossName, this.bossPhaseText]) if (!this.tweens.isTweening(t)) t.setAlpha(a);
  }

  drawElites(g) {
    const eg = this.eliteG.clear();
    this.elites = this.elites.filter((x) => x.e.alive && x.e.elite !== false && x.e.maxHp === x.maxHp);
    const cam = g.cameras.main;
    const wv = cam.worldView;
    this.elites.forEach((x, i) => {
      const e = x.e;
      let sx = (e.x - wv.x) * cam.zoom;
      let sy = (e.y - e.displayHeight * 0.95 - 16 - wv.y) * cam.zoom;
      const top = g.boss && g.boss.alive ? 186 : 140;
      const off = sx < 40 || sx > 1240 || sy < top - 10 || sy > 700;
      sx = Phaser.Math.Clamp(sx, 60, 1220);
      sy = Phaser.Math.Clamp(sy, top, 690);
      const k = Phaser.Math.Clamp(e.hp / e.maxHp, 0, 1);
      eg.fillStyle(0x3a1220).fillRoundedRect(sx - 45, sy, 90, 10, 4);
      eg.fillStyle(0xff5b55).fillRoundedRect(sx - 45, sy, Math.max(6, 90 * k), 10, 4);
      eg.lineStyle(2, INK_N).strokeRoundedRect(sx - 45, sy, 90, 10, 4);
      if (off) {
        // 屏外精英：箭头指向
        const a = Math.atan2(e.y - (wv.y + wv.height / 2), e.x - (wv.x + wv.width / 2));
        const ax = sx + Math.cos(a) * 58;
        const ay = sy + 5 + Math.sin(a) * 18;
        eg.fillStyle(0xff7a6a).fillTriangle(
          ax + Math.cos(a) * 10, ay + Math.sin(a) * 10,
          ax + Math.cos(a + 2.4) * 8, ay + Math.sin(a + 2.4) * 8,
          ax + Math.cos(a - 2.4) * 8, ay + Math.sin(a - 2.4) * 8,
        );
      }
      let t = this.eliteTexts[i];
      if (!t) {
        t = this.add.text(0, 0, '', { fontFamily: BF, fontSize: '13px', color: '#ff7a6a', fontStyle: 'bold', stroke: INK, strokeThickness: 4 }).setOrigin(0.5, 1);
        this.eliteTexts.push(t);
      }
      t.setText(x.name).setPosition(sx, sy - 2).setVisible(true);
    });
    for (let i = this.elites.length; i < this.eliteTexts.length; i++) this.eliteTexts[i].setVisible(false);
  }

  drawIcons(g) {
    const owned = g.owned();
    const key = owned.map((o) => o.icon + o.lv).join(',');
    if (key === this.iconKey) return;
    const prev = new Set(this.iconKey.split(','));
    this.iconKey = key;
    this.iconRow.removeAll(true);
    let ry = 0;
    for (const list of [owned.filter((o) => o.weapon), owned.filter((o) => !o.weapon)]) {
      list.forEach((o, i) => {
        const seal = this.makeSeal(42 + (i % 7) * 48, 136 + (ry + Math.floor(i / 7)) * 48, o, 40);
        this.iconRow.add(seal);
        if (!prev.has(o.icon + o.lv)) bump(this, seal, 1.4);
      });
      ry += Math.ceil(list.length / 7);
    }
  }

  // 图标印章：流派色边框 + 图标 + 右下角等级角标
  makeSeal(x, y, o, size) {
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    const half = size / 2;
    g.fillStyle(INK_N).fillRoundedRect(-half - 2, -half - 2, size + 4, size + 6, 8);
    g.fillStyle(0x1a1f45).fillRoundedRect(-half, -half, size, size, 7);
    g.lineStyle(2, schoolColor(o.icon)).strokeRoundedRect(-half + 1, -half + 1, size - 2, size - 2, 6);
    c.add(g);
    c.add(this.add.image(0, 0, `icon_${o.icon}`).setDisplaySize(size - 6, size - 6));
    const badge = this.add.text(half + 2, half + 3, o.lv, {
      fontFamily: NF, fontSize: '11px', color: o.lv === '★' ? '#ffcf5a' : '#ffffff', backgroundColor: '#0b0d18', padding: { x: 3, y: 0 },
    }).setOrigin(1, 1);
    c.add(badge);
    return c;
  }

  flashHurt() {
    this.tweens.killTweensOf([this.hurtFlash, this.hurtVig]);
    this.hurtFlash.setAlpha(0.14);
    this.hurtVig.setAlpha(0.9);
    this.tweens.add({ targets: this.hurtFlash, alpha: 0, duration: 200 });
    this.tweens.add({ targets: this.hurtVig, alpha: 0, duration: 420, ease: 'Quad.easeOut' });
  }

  banner(text, color = '#ffc977', big = false) {
    this.tweens.killTweensOf(this.bannerText);
    this.bannerText.setText(text).setColor(color).setFontSize(big ? 64 : 44).setAlpha(0).setScale(0.7);
    this.tweens.add({ targets: this.bannerText, alpha: 1, scale: 1, duration: 320, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.bannerText, alpha: 0, delay: big ? 2200 : 1600, duration: 400 });
  }

  showBoss(name) {
    this.bossName.setText(name).setVisible(true).setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: this.bossName, scale: 1, alpha: 1, duration: 420, ease: 'Back.easeOut' });
  }

  hideBoss() {
    this.tweens.add({ targets: [this.bossName, this.bossPhaseText], alpha: 0, duration: 300, onComplete: () => { this.bossName.setVisible(false).setAlpha(1); this.bossPhaseText.setVisible(false).setAlpha(1); } });
  }

  trackElite(e, name) { this.elites.push({ e, name, maxHp: e.maxHp }); }

  // ---------------- 三选一 ----------------
  showChoices(info, choices, rerolls, api) {
    this.closeModal();
    const c = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(640, 360, 1280, 720, 0x06071a, 0.84).setInteractive();
    dim.setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 160 });
    const title = this.add.text(640, 110, info.title, {
      fontFamily: TF, fontSize: '56px', color: '#ffc977', stroke: INK, strokeThickness: 8, padding: { x: 36, y: 36 },
      shadow: { offsetX: 0, offsetY: 0, color: '#ff9a3c', blur: 22, fill: true, stroke: true },
    }).setOrigin(0.5);
    const sub = this.add.text(640, 168, info.sub, { fontFamily: BF, fontSize: '16px', color: '#aeb3d8' }).setOrigin(0.5);
    c.add([dim, title, sub]);
    title.y -= 40;
    title.setAlpha(0);
    this.tweens.add({ targets: title, y: 110, alpha: 1, duration: 380, ease: 'Back.easeOut' });

    const cards = this.add.container(0, 0);
    c.add(cards);
    const m = { kind: 'choice', c, choices, api, cards: [], locked: false };
    this.modal = m;
    const drawCards = (list, flip) => {
      cards.removeAll(true);
      m.cards = list.map((ch, i) => {
        const card = this.makeCard(CARD_X[i], CARD_Y, ch, i, () => this.pick(i));
        cards.add(card);
        if (flip) {
          card.scaleX = 0;
          this.tweens.add({ targets: card, scaleX: 1, duration: 220, delay: i * 60, ease: 'Back.easeOut' });
        } else {
          card.y = CARD_Y + 90;
          card.setAlpha(0);
          this.tweens.add({ targets: card, y: CARD_Y, alpha: 1, duration: 380, delay: 60 + i * 70, ease: 'Back.easeOut' });
        }
        return card;
      });
    };
    drawCards(choices, false);

    const rb = makeButton(this, 640, 646, 300, 50, '', () => this.doReroll(), { size: 20, font: BF });
    const rk = keycap(this, 640 + 150 + 22, 646, 'R').setVisible(!touch.enabled);
    const setRb = (n) => { rb.setLabel(`换一批（剩 ${n} 次）`).setEnabled(n > 0); rk.setAlpha(n > 0 ? 1 : 0.4); };
    setRb(rerolls);
    c.add([rb, rk]);
    popIn(this, rb, 300);
    m.reroll = () => {
      const r = api.reroll();
      if (!r) return;
      sfx('chest', 0.5);
      m.choices = r.choices;
      drawCards(r.choices, true);
      setRb(r.rerolls);
    };
    m.rerollBtn = rb;
  }

  doReroll() {
    const m = this.modal;
    if (m && m.kind === 'choice' && !m.locked && m.rerollBtn.enabled) m.reroll();
  }

  makeCard(x, y, ch, i, onPick) {
    const card = this.add.container(x, y);
    const rar = UP.rarity[ch.rarity] || UP.rarity.white;
    const sch = UP.schools[ch.school] || UP.schools.gen;
    const col = hex(rar.color);
    const g = this.add.graphics();
    if (ch.rarity === 'gold') g.fillStyle(0xffc24a, 0.22).fillRoundedRect(-162, -202, 324, 404, 22);
    g.fillStyle(INK_N).fillRoundedRect(-150, -190 + 8, 300, 380, 14);
    g.fillStyle(0x1b1d42).fillRoundedRect(-150, -190, 300, 380, 14);
    g.fillStyle(0x2b3166).fillRoundedRect(-150, -190, 300, 200, { tl: 14, tr: 14, bl: 0, br: 0 });
    g.fillStyle(col).fillRoundedRect(-150, -190, 300, 32, { tl: 14, tr: 14, bl: 0, br: 0 });
    g.lineStyle(3, col, ch.rarity === 'white' ? 0.35 : 0.9).strokeRoundedRect(-145, -185, 290, 370, 11);
    g.lineStyle(4, INK_N).strokeRoundedRect(-150, -190, 300, 380, 14);
    g.lineStyle(3, INK_N).lineBetween(-150, -158, 150, -158);
    // 图标底
    g.fillStyle(INK_N).fillRoundedRect(-52, -146, 104, 108, 16);
    g.fillStyle(0x141838).fillRoundedRect(-50, -148, 100, 100, 14);
    g.lineStyle(3, hex(sch.color)).strokeRoundedRect(-50, -148, 100, 100, 14);
    card.add(g);
    card.add(this.add.text(0, -174, rar.name, { fontFamily: BF, fontSize: '14px', color: '#141a33', fontStyle: 'bold' }).setOrigin(0.5));
    const icon = this.add.image(0, -98, `icon_${ch.icon}`);
    icon.setScale(88 / Math.max(icon.width, icon.height));
    card.add(icon);
    card.add(this.add.text(0, -14, ch.name, { fontFamily: TF, fontSize: '30px', color: '#f3e6c8', stroke: INK, strokeThickness: 5 }).setOrigin(0.5));
    // 流派签 + 等级
    const chip = this.add.text(0, 24, sch.name, { fontFamily: BF, fontSize: '12px', color: '#141a33', fontStyle: 'bold', backgroundColor: sch.color, padding: { x: 7, y: 2 } }).setOrigin(0, 0.5);
    const lv = this.add.text(0, 24, ch.lvText, { fontFamily: BF, fontSize: '13px', color: '#ffc977', fontStyle: 'bold' }).setOrigin(0, 0.5);
    const tw = chip.width + 8 + lv.width;
    chip.x = -tw / 2;
    lv.x = -tw / 2 + chip.width + 8;
    card.add([chip, lv]);
    const desc = this.add.text(0, 48, ch.desc, {
      fontFamily: BF, fontSize: '16px', color: '#d6d9f5', align: 'center', lineSpacing: 8, wordWrap: { width: 262, useAdvancedWrap: true },
    }).setOrigin(0.5, 0);
    if (desc.height > 110) desc.setFontSize(14).setLineSpacing(5);
    card.add(desc);
    if (!touch.enabled) card.add(keycap(this, 0, 168, String(i + 1)));

    const hit = this.add.rectangle(0, 0, 300, 388, 0, 0.001).setInteractive({ useHandCursor: true });
    let pressed = false;
    const to = (scale, dy, d = 110, ease = 'Quad.easeOut') => (card.setAlpha(1), this.tweens.killTweensOf(card), this.tweens.add({ targets: card, scale, y: y + dy, duration: d, ease }));
    hit.on('pointerover', () => { if (!this.modal || this.modal.locked) return; card.parentContainer.bringToTop(card); to(1.05, -8); sfx('pickup', 0.4); });
    hit.on('pointerout', () => { pressed = false; to(1, 0); });
    hit.on('pointerdown', () => {
      pressed = true;
      // 触屏：按下即选（瞬时轻点时 down/up 可能挤在同一帧；pick 自带防重复锁）
      if (touch.enabled) { pressed = false; onPick(); return; }
      to(0.96, 0, 60);
    });
    hit.on('pointerup', () => {
      if (!pressed) return;
      pressed = false;
      onPick();
    });
    card.add(hit);
    return card;
  }

  pick(i) {
    const m = this.modal;
    if (!m || m.kind !== 'choice' || m.locked) return;
    const ch = m.choices[i];
    if (!ch) return;
    m.locked = true;
    sfx('click');
    m.cards.forEach((card, j) => {
      this.tweens.killTweensOf(card);
      if (j === i) this.tweens.add({ targets: card, scale: { from: 0.94, to: 1.1 }, y: CARD_Y - 10, duration: 200, ease: 'Back.easeOut' });
      else this.tweens.add({ targets: card, alpha: 0, y: CARD_Y + 40, duration: 180 });
    });
    this.time.delayedCall(220, () => {
      if (this.modal !== m) return;
      this.closeModal();
      m.api.pick(ch);
    });
  }

  // ---------------- 暂停 ----------------
  openPause() {
    const g = this.game_;
    if (this.modal || !g || !g.p || g.over || g.modal) return;
    g.modal = true;
    g.scene.pause();
    sfx('click');
    const c = this.add.container(0, 0).setDepth(100);
    c.add(this.add.rectangle(640, 360, 1280, 720, 0x06071a, 0.84).setInteractive());
    const panel = this.add.container(640, 380);
    c.add(panel);
    panel.add(drawPanel(this.add.graphics(), -440, -230, 880, 450));
    panel.add(this.add.text(0, -282, '暂 停', { fontFamily: TF, fontSize: '64px', color: '#ffc977', stroke: INK, strokeThickness: 8 }).setOrigin(0.5));

    const bx = -270;
    panel.add(makeButton(this, bx, -150, 260, 58, '继续', () => this.resumeGame(), { primary: true }));
    panel.add(makeButton(this, bx, -72, 260, 58, '重新开始', () => this.restart()));
    panel.add(makeButton(this, bx, 6, 260, 58, '回标题', () => this.toTitle()));
    const snd = makeButton(this, bx, 84, 260, 58, isMuted() ? '声音：关' : '声音：开', () => this.toggleMute());
    this.pauseSnd = snd;
    panel.add(snd);
    panel.add(this.add.text(bx, 160, touch.enabled ? '切后台会自动暂停' : 'Esc 继续 · M 静音', { fontFamily: BF, fontSize: '14px', color: '#7f86b8' }).setOrigin(0.5));

    // 分隔线
    const dg = this.add.graphics();
    dg.lineStyle(2, 0x343c70).lineBetween(-110, -196, -110, 186);
    panel.add(dg);

    // 右侧：本局数据 + 构筑
    const rx = -80;
    const sg = this.add.graphics();
    panel.add(sg);
    const stats = [['守夜', fmt(g.t)], ['等级', String(g.level)], ['击杀', fmtNum(g.kills)]];
    stats.forEach(([k, v], i) => {
      const x = rx + i * 168;
      drawBox(sg, x, -200, 156, 70);
      panel.add(this.add.text(x + 78, -184, k, { fontFamily: BF, fontSize: '13px', color: '#9aa3cf' }).setOrigin(0.5));
      panel.add(this.add.text(x + 78, -152, v, { fontFamily: NF, fontSize: '26px', color: '#f3e6c8', fontStyle: 'bold' }).setOrigin(0.5));
    });
    panel.add(this.add.text(rx, -110, '本局构筑', { fontFamily: BF, fontSize: '14px', color: '#9aa3cf', fontStyle: 'bold' }));
    const owned = g.owned();
    owned.forEach((o, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = rx + col * 168;
      const y = -66 + row * 50;
      panel.add(this.makeSeal(x + 20, y, o, 38));
      const name = this.add.text(x + 48, y, o.name, { fontFamily: BF, fontSize: '15px', color: o.lv === '★' ? '#ffcf5a' : '#f3e6c8' }).setOrigin(0, 0.5);
      panel.add(name);
      if (name.width > 112) name.setFontSize(13);
    });
    if (!owned.length) panel.add(this.add.text(rx, -66, '—', { fontFamily: BF, fontSize: '15px', color: '#7f86b8' }));
    popIn(this, panel);
    this.modal = { kind: 'pause', c };
  }

  toggleMute() {
    setMuted(!isMuted());
    const s = loadSave();
    s.mute = isMuted();
    writeSave(s);
    if (this.pauseSnd && this.modal && this.modal.kind === 'pause') this.pauseSnd.setLabel(isMuted() ? '声音：关' : '声音：开');
    if (!this.modal) this.banner(isMuted() ? '声音：关' : '声音：开', '#c4c8ea');
  }

  resumeGame() {
    if (!this.modal || this.modal.kind !== 'pause') return;
    const c = this.modal.c;
    this.modal = null;
    this.tweens.add({ targets: c, alpha: 0, duration: 140, onComplete: () => c.destroy() });
    this.game_.modal = false;
    this.game_.scene.resume();
  }

  // ---------------- 结算 ----------------
  showResult(r) {
    this.closeModal();
    const c = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(640, 360, 1280, 720, 0x06071a, 0.86).setInteractive();
    dim.setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 300 });
    c.add(dim);
    const P = this.add.container(640, 360);
    c.add(P);
    P.add(drawPanel(this.add.graphics(), -450, -262, 900, 504, { glow: r.victory ? 0xffb050 : 0x7f86b8 }));
    P.add(this.add.text(0, -196, r.victory ? '夜 尽 天 明' : '灯 灭', {
      fontFamily: TF, fontSize: '64px', color: r.victory ? '#ffc977' : '#f3e6c8', stroke: INK, strokeThickness: 8, padding: { x: 40, y: 40 },
      shadow: r.victory ? { offsetX: 0, offsetY: 0, color: '#ffb050', blur: 26, fill: true, stroke: true } : undefined,
    }).setOrigin(0.5));
    P.add(this.add.text(0, -138, r.victory ? '灯骸老祖已伏诛，荒村迎来黎明' : `阿烛的灯火熄灭了 · 守住了 ${fmt(r.time)}`, {
      fontFamily: BF, fontSize: '16px', color: '#aeb3d8',
    }).setOrigin(0.5));

    // 统计四格
    const sg = this.add.graphics();
    P.add(sg);
    const cells = [['守夜时长', fmt(r.time), false], ['等级', String(r.level), false], ['击杀', r.kills, true], ['最高伤害武器', r.top, 'name']];
    cells.forEach(([k, v, mode], i) => {
      const x = -410 + i * 208;
      drawBox(sg, x, -112, 196, 84);
      P.add(this.add.text(x + 98, -94, k, { fontFamily: BF, fontSize: '13px', color: '#9aa3cf' }).setOrigin(0.5));
      const t = this.add.text(x + 98, -58, '', mode === 'name'
        ? { fontFamily: TF, fontSize: '28px', color: '#ffc977', stroke: INK, strokeThickness: 4 }
        : { fontFamily: NF, fontSize: '30px', color: '#f3e6c8', fontStyle: 'bold' }).setOrigin(0.5);
      P.add(t);
      if (mode === true) countUp(this, t, v, 900, fmtNum);
      else t.setText(v);
      if (mode === 'name' && t.width > 180) t.setFontSize(22);
    });

    // 构筑 + 魂火
    drawBox(sg, -410, -12, 484, 132);
    P.add(this.add.text(-396, 0, '本局构筑', { fontFamily: BF, fontSize: '13px', color: '#9aa3cf', fontStyle: 'bold' }));
    r.build.forEach((o, i) => {
      const seal = this.makeSeal(-380 + (i % 9) * 52, 46 + Math.floor(i / 9) * 50, o, 40);
      P.add(seal);
      seal.setScale(0);
      this.tweens.add({ targets: seal, scale: 1, duration: 260, delay: 300 + i * 50, ease: 'Back.easeOut' });
    });
    drawBox(sg, 86, -12, 324, 132);
    P.add(this.add.text(100, 0, '获得魂火', { fontFamily: BF, fontSize: '13px', color: '#9aa3cf', fontStyle: 'bold' }));
    const flame = this.add.image(136, 58, 'glow').setTint(0xff8a2a).setBlendMode('ADD').setScale(1.1);
    this.tweens.add({ targets: flame, scale: 1.3, alpha: 0.75, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const flameCore = this.add.image(136, 58, 'glow').setTint(0xffe0a0).setBlendMode('ADD').setScale(0.45);
    const soulT = this.add.text(176, 56, '+0', { fontFamily: NF, fontSize: '42px', color: '#ff9a3c', fontStyle: 'bold', stroke: INK, strokeThickness: 5 }).setOrigin(0, 0.5);
    const total = loadSave().soul;
    const hold = this.add.text(100, 100, '', { fontFamily: BF, fontSize: '13px', color: '#9aa3cf' }).setOrigin(0, 0.5);
    const holdN = this.add.text(0, 100, fmtNum(total), { fontFamily: NF, fontSize: '13px', color: '#ffc977' }).setOrigin(0, 0.5);
    hold.setText('累计持有');
    holdN.x = 100 + hold.width + 8;
    P.add([flame, flameCore, soulT, hold, holdN]);
    this.time.delayedCall(450, () => countUp(this, soulT, r.soul, 1200, (v) => `+${fmtNum(v)}`, () => { sfx('coin'); bump(this, soulT, 1.25); }));

    // 按钮
    P.add(makeButton(this, -140, 190, 240, 60, '再来一局', () => this.restart(), { primary: true }));
    P.add(makeButton(this, 140, 190, 240, 60, '回标题', () => this.toTitle()));
    P.add(this.add.text(0, 234, touch.enabled ? '' : 'Enter 再来一局', { fontFamily: BF, fontSize: '13px', color: '#7f86b8' }).setOrigin(0.5));
    c.add(this.add.text(1258, 706, `种子 ${r.seed.toString(16).toUpperCase().padStart(8, '0')}`, { fontFamily: NF, fontSize: '12px', color: '#6f77a8' }).setOrigin(1, 1));
    popIn(this, P, 80);
    this.modal = { kind: 'result', c, at: this.time.now };
  }

  restart() {
    this.closeModal();
    this.scene.start('Game'); // 从 UI 启动 Game：Game 重启，UI 自身关闭，随后由 Game.create 重新 launch
  }

  toTitle() {
    this.closeModal();
    this.scene.stop('Game');
    this.scene.start('Title');
  }

  closeModal() {
    if (this.modal) this.modal.c.destroy();
    this.modal = null;
  }

  onKey(e) {
    const m = this.modal;
    const key = e.key;
    if (m && m.kind === 'choice') {
      if (['1', '2', '3'].includes(key)) this.pick(Number(key) - 1);
      else if (key === 'r' || key === 'R') this.doReroll();
    } else if (m && m.kind === 'result') {
      if ((key === 'Enter' || key === ' ') && this.time.now - m.at > 400) this.restart();
    } else if (key === 'Escape') {
      if (!m) this.openPause();
      else if (m.kind === 'pause') this.resumeGame();
    } else if (key === 'm' || key === 'M') {
      if (!m || m.kind === 'pause') this.toggleMute();
    }
  }
}
