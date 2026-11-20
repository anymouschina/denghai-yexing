import Phaser from 'phaser';
import META from '../data/meta.json';
import { TF, BF, NF, INK } from '../fonts.js';
import { loadSave, writeSave } from '../save.js';
import { sfx, music, unlockAudio, setMuted, isMuted } from '../audio.js';
import { touch } from '../touch.js';
import { makeButton, popIn, drawPanel, hintRow, bump, fmtTime, fmtNum } from '../widgets.js';

const INK_N = 0x0b0d18;

export class Title extends Phaser.Scene {
  constructor() { super('Title'); }

  create() {
    this.save = loadSave();
    setMuted(this.save.mute);
    this.shop = null;
    this.starting = false;
    this.cameras.main.fadeIn(500, 5, 6, 18);

    const art = this.add.image(640, 360, 'title_keyart');
    art.setScale(Math.max(1280 / art.width, 720 / art.height) * 1.04);
    this.tweens.add({ targets: art, scale: art.scale * 1.05, x: 620, duration: 14000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.image(640, 360, 'shade');

    // 飘起的灯火余烬
    this.add.particles(0, 0, 'glow', {
      x: { min: 0, max: 1280 }, y: 760, lifespan: 7000, speedY: { min: -60, max: -25 }, speedX: { min: -12, max: 12 },
      scale: { start: 0.22, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xffa040, 0xffc977, 0xff7a30], blendMode: 'ADD', frequency: 260,
    });

    // Logo：灯 / 骸（灯笼橙、呼吸）/ 夜行
    const logo = this.add.container(80, 96);
    const PAD = 40;
    const t1 = this.add.text(-PAD, -PAD, '灯', this.logoStyle('#f3e6c8'));
    const t2 = this.add.text(t1.width - 2 * PAD - 8 - PAD, -PAD, '骸', this.logoStyle('#ff9a3c'));
    const t3 = this.add.text(t1.width + t2.width - 4 * PAD - 16 - PAD, -PAD, '夜行', this.logoStyle('#f3e6c8'));
    const sub = this.add.text(10, 156, '提 一 盏 灯 ， 守 一 夜 村', { fontFamily: BF, fontSize: '21px', color: '#d6d0f0', stroke: INK, strokeThickness: 4 });
    logo.add([t1, t2, t3, sub]);
    popIn(this, logo);
    this.tweens.add({ targets: t2, alpha: 0.72, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.buttons = [
      makeButton(this, 230, 352, 300, 60, '开始夜行', () => this.startGame(), { primary: true }),
      makeButton(this, 230, 430, 300, 60, '灯坊 · 强化', () => this.openShop()),
      makeButton(this, 230, 508, 300, 60, this.soundLabel(), () => this.toggleSound()),
    ];
    this.buttons.forEach((b, i) => popIn(this, b, 120 + i * 80));

    const press = this.add.text(80, 566, touch.enabled ? '— 轻点画面开始 —' : '— 点击画面或按 Enter / 空格 开始 —', { fontFamily: BF, fontSize: '16px', color: '#ffc977', stroke: INK, strokeThickness: 4 });
    this.tweens.add({ targets: press, alpha: 0.3, duration: 900, yoyo: true, repeat: -1 });

    if (touch.enabled) {
      hintRow(this, 80, 628, [{ text: '左侧拖动摇杆移动 · 右下「闪」键冲刺 · 右上 ❚❚ 暂停' }]);
      hintRow(this, 80, 668, [{ text: '攻击全自动 · 升级时点卡片选择' }]);
    } else {
      hintRow(this, 80, 628, [
        { key: 'W' }, { key: 'A' }, { key: 'S' }, { key: 'D' }, { text: '/ 方向键 移动' },
        { key: '空格' }, { text: '冲刺' }, { key: 'Esc' }, { text: '暂停' }, { key: 'M' }, { text: '静音' },
      ]);
      hintRow(this, 80, 668, [{ text: '攻击全自动 · 升级时用' }, { key: '1' }, { key: '2' }, { key: '3' }, { text: '或鼠标选择' }]);
    }

    this.buildRecord();

    this.input.on('pointerdown', (p, objs) => {
      unlockAudio();
      music.play('title');
      if (!this.shop && objs.length === 0) this.startGame();
    });
    this.input.keyboard.on('keydown', (e) => {
      unlockAudio();
      music.play('title');
      if (e.key === 'Escape' && this.shop) this.closeShop();
      else if ((e.key === 'Enter' || e.key === ' ') && !this.shop) this.startGame();
      else if (e.key === 'm' || e.key === 'M') this.toggleSound();
    });
    music.play('title');
  }

  logoStyle(color) {
    return { fontFamily: TF, fontSize: '124px', color, stroke: INK, strokeThickness: 10, padding: { x: 40, y: 40 }, shadow: { offsetX: 0, offsetY: 6, color: '#ff8a2a', blur: 26, fill: true, stroke: true } };
  }

  // 右下角战绩：标签用正文、数字用等宽
  buildRecord() {
    const w = 236;
    const h = 108;
    const c = this.add.container(1240 - w, 684 - h);
    const g = this.add.graphics();
    g.fillStyle(0x0f1128, 0.82).fillRoundedRect(0, 0, w, h, 12);
    g.lineStyle(3, INK_N).strokeRoundedRect(0, 0, w, h, 12);
    c.add(g);
    const rows = ['最久守夜', '持有魂火', '通关 / 出征'];
    this.recNums = rows.map((label, i) => {
      c.add(this.add.text(18, 18 + i * 26, label, { fontFamily: BF, fontSize: '15px', color: '#d8d2f5' }).setOrigin(0, 0));
      const n = this.add.text(w - 18, 17 + i * 26, '', { fontFamily: NF, fontSize: '16px', color: '#ffc977', fontStyle: 'bold' }).setOrigin(1, 0);
      c.add(n);
      return n;
    });
    popIn(this, c, 380);
    this.refreshRecord();
  }

  refreshRecord() {
    const s = this.save;
    this.recNums[0].setText(fmtTime(s.best));
    this.recNums[1].setText(fmtNum(s.soul));
    this.recNums[2].setText(`${s.wins} / ${s.runs}`);
  }

  soundLabel() { return isMuted() ? '声音：关' : '声音：开'; }

  toggleSound() {
    setMuted(!isMuted());
    this.save.mute = isMuted();
    writeSave(this.save);
    this.buttons[2].setLabel(this.soundLabel());
  }

  startGame() {
    if (this.starting) return;
    this.starting = true;
    unlockAudio();
    sfx('click');
    this.cameras.main.fadeOut(350, 5, 6, 18);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Game'));
  }

  // ---------------- 灯坊（局外强化） ----------------
  openShop() {
    if (this.shop) return;
    const c = this.add.container(640, 360).setDepth(100);
    const dim = this.add.rectangle(0, 0, 1280, 720, 0x05061a, 0.74).setInteractive();
    const g = drawPanel(this.add.graphics(), -450, -300, 900, 590, { glow: 0xff9a3c });
    const title = this.add.text(0, -258, '灯 坊', { fontFamily: TF, fontSize: '50px', color: '#ffc977', stroke: INK, strokeThickness: 6 }).setOrigin(0.5);
    const flame = this.add.image(0, -206, 'glow').setTint(0xff9a3c).setScale(0.55).setBlendMode('ADD');
    const soulLabel = this.add.text(0, -206, '持有魂火', { fontFamily: BF, fontSize: '16px', color: '#c4c8ea' }).setOrigin(1, 0.5);
    this.soulText = this.add.text(0, -206, '', { fontFamily: NF, fontSize: '20px', color: '#ff9a3c', fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.soulParts = { flame, soulLabel };
    c.add([dim, g, title, flame, soulLabel, this.soulText]);
    this.shopRows = META.map((m, i) => {
      const x = i % 2 === 0 ? -420 : 10;
      const y = -170 + Math.floor(i / 2) * 134;
      const rg = this.add.graphics();
      const icon = this.add.image(x + 56, y + 60, `icon_${m.icon}`).setDisplaySize(80, 80);
      const name = this.add.text(x + 108, y + 12, m.name, { fontFamily: TF, fontSize: '28px', color: '#f3e6c8' });
      const desc = this.add.text(x + 108, y + 52, m.desc, { fontFamily: BF, fontSize: '15px', color: '#c4c8ea' });
      const pips = this.add.graphics();
      const cur = this.add.text(x + 108, y + 88, '', { fontFamily: NF, fontSize: '13px', color: '#ffc977' }).setOrigin(0, 0.5);
      const btn = makeButton(this, x + 344, y + 74, 116, 44, '', () => this.buy(m), { size: 17, primary: true, font: BF });
      c.add([rg, icon, name, desc, pips, cur, btn]);
      return { m, x, y, rg, icon, pips, cur, btn };
    });
    const close = makeButton(this, 0, 252, 220, 52, '返回', () => this.closeShop(), { size: 26 });
    const esc = this.add.text(124, 252, 'Esc', { fontFamily: NF, fontSize: '13px', color: '#7f86b8' }).setOrigin(0, 0.5);
    c.add([close, esc]);
    this.shop = c;
    this.refreshShop();
    popIn(this, c);
  }

  refreshShop() {
    const s = this.save;
    this.soulText.setText(fmtNum(s.soul));
    // 「持有魂火 [n]」整体居中
    const total = this.soulParts.soulLabel.width + 30 + this.soulText.width;
    const left = -total / 2;
    this.soulParts.soulLabel.x = left + this.soulParts.soulLabel.width;
    this.soulParts.flame.x = left + this.soulParts.soulLabel.width + 15;
    this.soulText.x = left + this.soulParts.soulLabel.width + 30;
    for (const r of this.shopRows) {
      const l = s.meta[r.m.id] || 0;
      const maxed = l >= r.m.max;
      const cost = maxed ? 0 : r.m.cost[l];
      const can = !maxed && s.soul >= cost;
      r.rg.clear();
      r.rg.fillStyle(0x161a3c).fillRoundedRect(r.x, r.y, 410, 120, 12);
      r.rg.lineStyle(2, maxed ? 0xc9a24a : can ? 0x5a63a8 : 0x343a66).strokeRoundedRect(r.x, r.y, 410, 120, 12);
      r.pips.clear();
      for (let k = 0; k < r.m.max; k++) {
        r.pips.fillStyle(k < l ? 0xff9a3c : 0x2a2f5c).fillRoundedRect(r.x + 108 + k * 16, r.y + 82, 12, 12, 3);
        r.pips.lineStyle(2, INK_N).strokeRoundedRect(r.x + 108 + k * 16, r.y + 82, 12, 12, 3);
      }
      r.cur.x = r.x + 108 + r.m.max * 16 + 8;
      r.cur.setText(l > 0 ? `当前 ${this.metaValue(r.m, l)}` : '');
      r.icon.setAlpha(maxed || can ? 1 : 0.7);
      if (maxed) r.btn.setLabel('已满').setEnabled(false);
      else r.btn.setLabel(`${fmtNum(cost)} 魂火`).setEnabled(can);
    }
    this.refreshRecord();
  }

  metaValue(m, l) {
    const v = m.per * l;
    if (m.stat === 'revive') return '已拥有';
    if (m.stat === 'rerolls') return `+${v} 次`;
    if (v < 1) return `+${Math.round(v * 100)}%`;
    return `+${v}`;
  }

  buy(m) {
    const l = this.save.meta[m.id] || 0;
    if (l >= m.max || this.save.soul < m.cost[l]) return;
    this.save.soul -= m.cost[l];
    this.save.meta[m.id] = l + 1;
    writeSave(this.save);
    sfx('levelup');
    this.refreshShop();
    const r = this.shopRows.find((x) => x.m === m);
    if (r) {
      const s0 = r.icon.scaleX;
      this.tweens.add({ targets: r.icon, scaleX: s0 * 1.25, scaleY: s0 * 1.25, duration: 120, yoyo: true, ease: 'Quad.easeOut' });
      const pe = this.add.particles(0, 0, 'glow', {
        emitting: false, speed: { min: 60, max: 200 }, lifespan: 600, scale: { start: 0.4, end: 0 }, tint: [0xff9a3c, 0xffc977], blendMode: 'ADD',
      }).setDepth(200);
      pe.explode(18, 640 + r.x + 56, 360 + r.y + 60);
      this.time.delayedCall(800, () => pe.destroy());
    }
    bump(this, this.soulText, 1.25);
  }

  closeShop() {
    const c = this.shop;
    if (!c) return;
    this.tweens.add({ targets: c, alpha: 0, scale: 0.92, duration: 180, ease: 'Quad.easeIn', onComplete: () => c.destroy() });
    this.time.delayedCall(60, () => { this.shop = null; });
  }
}
