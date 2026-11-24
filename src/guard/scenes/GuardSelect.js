// 新模式入口：选英雄 + 选模式（剧情 30 波 / 无尽）。←/→ 或 1–4 选英雄，Enter 开始剧情，Esc 返回标题。
import Phaser from 'phaser';
import HEROES from '../data/heroes.json' with { type: 'json' };
import { TF, BF, NF, INK } from '../../fonts.js';
import { sfx, music, unlockAudio } from '../../audio.js';
import { makeButton, popIn, drawPanel, hintRow } from '../../widgets.js';
import { preloadGuard, makeGuardTextures } from '../assets.js';
import { loadGuardSave } from '../save.js';
import { listRuns, latestRun, SLOT_NAME } from '../persist/store.js';
import { touch } from '../../touch.js';

const IDS = ['azhu', 'huoqing', 'yunque', 'xuanshuang'];
const INK_N = 0x0b0d18;

function agoText(ts) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

export class GuardSelect extends Phaser.Scene {
  constructor() { super('GuardSelect'); }

  init(data) { this.autoResume = (data && data.resume) || null; } // 从标题页「继续守灯」直达：素材加载完立即读档

  preload() {
    const label = this.add.text(640, 360, '灯坛布阵中… 0%', { fontFamily: BF, fontSize: '20px', color: '#ffc977' }).setOrigin(0.5);
    this.load.on('progress', (v) => label.setText(`灯坛布阵中… ${Math.round(v * 100)}%`));
    this.load.once('complete', () => label.destroy());
    preloadGuard(this);
  }

  create() {
    makeGuardTextures(this);
    this.save = loadGuardSave();
    this.sel = Math.max(0, IDS.indexOf(this.save.lastHero));
    this.starting = false;
    this.cameras.main.fadeIn(400, 5, 6, 18);
    const art = this.add.image(640, 360, 'g_keyart');
    art.setScale(Math.max(1280 / art.width, 720 / art.height) * 1.03);
    this.tweens.add({ targets: art, scale: art.scale * 1.04, duration: 16000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.image(640, 360, 'shade');
    this.add.particles(0, 0, 'glow', {
      x: { min: 0, max: 1280 }, y: 760, lifespan: 7000, speedY: { min: -60, max: -25 }, speedX: { min: -12, max: 12 },
      scale: { start: 0.22, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xffa040, 0xffc977, 0x7fe3ff], blendMode: 'ADD', frequency: 300,
    });

    const logo = this.add.text(60, 20, '守灯·镇夜', { fontFamily: TF, fontSize: '82px', color: '#ffc977', stroke: INK, strokeThickness: 9, padding: { x: 20, y: 16 }, shadow: { offsetX: 0, offsetY: 5, color: '#ff8a2a', blur: 24, fill: true, stroke: true } });
    this.add.text(80, 140, '七 星 续 命 ， 一 夜 不 熄 —— 孔 明 死 ， 则 灯 灭', { fontFamily: BF, fontSize: '18px', color: '#d6d0f0', stroke: INK, strokeThickness: 4 });
    popIn(this, logo);

    // 英雄卡
    this.cards = IDS.map((id, i) => {
      const h = HEROES[id];
      const x = 112 + i * 162;
      const y = 326;
      const c = this.add.container(x, y);
      const g = this.add.graphics();
      const img = this.add.image(0, 44, h.portrait === 'hero' ? 'hero' : h.portrait).setOrigin(0.5, 1);
      img.setScale(Math.min(120 / img.height, 134 / img.width));
      const name = this.add.text(0, 64, h.name, { fontFamily: TF, fontSize: '28px', color: '#f3e6c8', stroke: INK, strokeThickness: 5 }).setOrigin(0.5);
      const role = this.add.text(0, 96, h.role, { fontFamily: BF, fontSize: '14px', color: '#9aa3cf' }).setOrigin(0.5);
      const num = this.add.text(-60, -96, String(i + 1), { fontFamily: NF, fontSize: '15px', color: '#ffc977', fontStyle: 'bold', stroke: INK, strokeThickness: 4 });
      const hit = this.add.rectangle(0, 0, 146, 220, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => { this.select(i); });
      hit.on('pointerover', () => { if (this.sel !== i) this.tweens.add({ targets: c, y: 320, duration: 100 }); });
      hit.on('pointerout', () => { if (this.sel !== i) this.tweens.add({ targets: c, y: 326, duration: 100 }); });
      c.add([g, img, name, role, num, hit]);
      c.g = g;
      c.img = img;
      popIn(this, c, 120 + i * 70);
      return c;
    });

    // 详情面板
    this.detail = this.add.container(0, 0);
    this.modeBtns = [
      makeButton(this, 392, 594, 260, 58, '剧情 · 守满三十波', () => this.start('story'), { primary: true, size: 24 }),
      makeButton(this, 664, 594, 260, 58, '无尽 · 镇夜到天明', () => this.start('endless'), { size: 24 }),
      makeButton(this, 861, 594, 110, 58, '返回', () => this.back(), { size: 25 }),
    ];
    this.modeBtns.forEach((b, i) => popIn(this, b, 300 + i * 70));
    this.buildContinue();
    if (!touch.enabled) {
      hintRow(this, 60, 662, [
        { key: '右键/点地' }, { text: '或' }, { key: 'WASD' }, { text: '移动' },
        { key: '←→' }, { text: '选英雄' }, { key: 'Enter' }, { text: '开局' }, { key: 'Esc' }, { text: '返回' },
      ]);
    } else {
      this.add.text(60, 662, '支持虚拟摇杆与点地移动 · 停步自动普攻 · 左侧栏一键建造/雇佣/军令', { fontFamily: BF, fontSize: '15px', color: '#c4c8ea', stroke: INK, strokeThickness: 4 }).setOrigin(0, 0.5);
    }
    this.buildRecord();
    this.select(this.sel, true);

    this.input.keyboard.on('keydown', (e) => {
      unlockAudio();
      if (e.key === 'ArrowLeft' || e.key === 'a') this.select((this.sel + 3) % 4);
      else if (e.key === 'ArrowRight' || e.key === 'd') this.select((this.sel + 1) % 4);
      else if (e.key >= '1' && e.key <= '4') this.select(Number(e.key) - 1);
      else if (e.key === 'c' || e.key === 'C') this.continueRun();
      else if (e.key === 'Enter' || e.key === ' ') this.start('story');
      else if (e.key === 'Escape') this.back();
    });
    music.play('title');
    if (this.autoResume) {
      const slot = this.autoResume;
      this.autoResume = null;
      this.time.delayedCall(80, () => this.continueRun(slot));
    }
  }

  // 「继续游戏」：列出自动 / 手动存档，点哪个读哪个；没有存档时灰显
  buildContinue() {
    this.runs = listRuns();
    const latest = latestRun();
    this.contBtn = makeButton(this, 155, 594, 190, 58, latest ? '继续游戏 [C]' : '继续（无存档）', () => this.continueRun(), { primary: !!latest, size: 24 });
    this.contBtn.setEnabled?.(!!latest);
    popIn(this, this.contBtn, 340);
    this.runCards = this.runs.map((r, i) => {
      const x = 60 + i * 322;
      const y = 454;
      const c = this.add.container(x, y);
      const g = this.add.graphics();
      const on = r.ok;
      g.fillStyle(0x0b0d18).fillRoundedRect(0, 5, 310, 66, 10).fillStyle(on ? 0x24285a : 0x1a1d3a).fillRoundedRect(0, 0, 310, 66, 10).lineStyle(2.5, on ? 0xffc977 : 0x3a3f6a).strokeRoundedRect(0, 0, 310, 66, 10);
      c.add(g);
      let l1 = SLOT_NAME[r.slot];
      let l2 = '— 暂无 —';
      let col = '#80839c';
      if (r.ok) {
        const m = r.meta;
        const hero = HEROES[m.heroId] ? HEROES[m.heroId].name : m.heroId;
        l1 = `${SLOT_NAME[r.slot]} · ${hero} · ${m.mode === 'story' ? '剧情' : '无尽'}`;
        l2 = `第 ${m.wave} 波 · Lv.${m.lv} · ${m.kills} 杀 · ${agoText(r.savedAt)}`;
        col = '#d8d2f5';
      } else if (!r.empty) { l2 = r.reason; col = '#ff8a7a'; }
      const ic = this.add.image(282, 33, 'g_ui_save_lantern').setDisplaySize(36, 66).setAlpha(on ? 1 : 0.3);
      c.add(ic);
      c.add(this.add.text(14, 8, l1, { fontFamily: BF, fontSize: '16px', color: on ? '#ffc977' : '#9aa3cf', fontStyle: 'bold' }));
      c.add(this.add.text(14, 36, l2, { fontFamily: BF, fontSize: '14px', color: col, wordWrap: { width: 250 } }));
      if (on) {
        const hit = this.add.rectangle(155, 33, 310, 66, 0, 0.001).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => this.continueRun(r.slot));
        c.add(hit);
      }
      popIn(this, c, 320 + i * 60);
      return c;
    });
  }

  continueRun(slot) {
    if (this.starting) return;
    const pick = slot || (latestRun() || {}).slot;
    if (!pick) return;
    this.starting = true;
    unlockAudio();
    sfx('click');
    this.cameras.main.fadeOut(350, 5, 6, 18);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('GuardGame', { resume: pick }));
  }

  buildRecord() {
    const s = this.save;
    const w = 250;
    const c = this.add.container(1240 - w, 590);
    const g = this.add.graphics();
    g.fillStyle(0x0f1128, 0.85).fillRoundedRect(0, 0, w, 100, 12).lineStyle(3, INK_N).strokeRoundedRect(0, 0, w, 100, 12);
    c.add(g);
    const rows = [['剧情通关 / 场次', `${s.storyWins} / ${s.runs}`], ['剧情最远', s.storyBest ? `第 ${s.storyBest} 波` : '—'], ['无尽最高', s.endlessBest ? `第 ${s.endlessBest} 波` : '—']];
    rows.forEach(([a, b], i) => {
      c.add(this.add.text(16, 14 + i * 26, a, { fontFamily: BF, fontSize: '15px', color: '#d8d2f5' }));
      c.add(this.add.text(w - 16, 13 + i * 26, b, { fontFamily: NF, fontSize: '15px', color: '#ffc977', fontStyle: 'bold' }).setOrigin(1, 0));
    });
    popIn(this, c, 400);
  }

  select(i, silent) {
    this.sel = i;
    if (!silent) sfx('click');
    this.cards.forEach((c, k) => {
      const on = k === i;
      c.g.clear();
      c.g.fillStyle(INK_N).fillRoundedRect(-75, -104, 150, 220, 14);
      c.g.fillStyle(on ? 0x34306e : 0x1d2150).fillRoundedRect(-75, -110, 150, 220, 14);
      c.g.lineStyle(on ? 4 : 3, on ? 0xffc977 : 0x343a66).strokeRoundedRect(-75, -110, 150, 220, 14);
      if (on) c.g.lineStyle(10, 0xff9a3c, 0.2).strokeRoundedRect(-80, -115, 160, 230, 16);
      this.tweens.add({ targets: c, y: on ? 318 : 330, duration: 160, ease: 'Back.easeOut' });
    });
    this.drawDetail();
  }

  drawDetail() {
    const d = this.detail;
    d.removeAll(true);
    const h = HEROES[IDS[this.sel]];
    const x = 736;
    const y = 178;
    const w = 508;
    const panelH = 382;
    const g = drawPanel(this.add.graphics(), x, y, w, panelH, { glow: 0xff9a3c });
    d.add(g);
    d.add(this.add.text(x + 22, y + 14, `${h.name} · ${h.role}`, { fontFamily: TF, fontSize: '30px', color: '#ffc977', stroke: INK, strokeThickness: 5 }));
    d.add(this.add.text(x + 22, y + 56, `生命 ${h.hp}   攻击 ${h.atk}   防御 ${h.def}   射程 ${h.basic.range}`, { fontFamily: BF, fontSize: '14px', color: '#c4c8ea' }));
    const keys = { q: 'Q', e: 'E', r: 'R', f: 'F', u: '空格' };
    Object.entries(h.skills).forEach(([slot, s], k) => {
      const yy = y + 92 + k * 54;
      const ic = this.add.image(x + 42, yy + 22, s.icon).setDisplaySize(38, 38);
      d.add(ic);
      d.add(this.add.text(x + 72, yy + 2, s.name, { fontFamily: TF, fontSize: '21px', color: slot === 'u' ? '#ffd36a' : '#f3e6c8', stroke: INK, strokeThickness: 4 }));
      const cdStr = s.cd ? `冷却 ${s.cd}s` : '满能释放';
      d.add(this.add.text(x + 72, yy + 26, `${s.desc}（${cdStr}）`, {
        fontFamily: BF, fontSize: '12px', color: '#a8b0db', wordWrap: { width: w - 146, useAdvancedWrap: true },
      }));
      const kg = this.add.graphics();
      kg.fillStyle(0x161b3e).fillRoundedRect(x + w - 62, yy + 8, 44, 24, 6).lineStyle(1.5, 0xffc977, 0.7).strokeRoundedRect(x + w - 62, yy + 8, 44, 24, 6);
      d.add(kg);
      d.add(this.add.text(x + w - 40, yy + 20, keys[slot], { fontFamily: NF, fontSize: '13px', color: '#ffc977', fontStyle: 'bold' }).setOrigin(0.5));
    });
  }

  start(mode) {
    if (this.starting) return;
    this.starting = true;
    unlockAudio();
    sfx('click');
    const heroId = IDS[this.sel];
    this.cameras.main.fadeOut(350, 5, 6, 18);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('GuardGame', { heroId, mode }));
  }

  back() {
    if (this.starting) return;
    this.starting = true;
    this.cameras.main.fadeOut(300, 5, 6, 18);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Title'));
  }
}
