// 新模式 HUD（并行场景，不随镜头震动）：孔明血条与遇袭预警、波次、铜钱、小地图、头像栏（点击切换）、技能栏、
// 面板（背包/建造/雇佣/任务，打开时战斗不暂停）、Esc 系统菜单（唯一会暂停的界面）、结算。
// 面板由 src/guard/ui/index.js 的 PANELS 注册：{ name, key, create(hud) → { c: Container, refresh?(), open?(arg), close?() } }
import Phaser from 'phaser';
import { TF, BF, NF, INK } from '../../fonts.js';
import { sfx, setMuted, isMuted } from '../../audio.js';
import { makeButton, popIn, drawPanel, bump, fmtTime, fmtNum } from '../../widgets.js';
import { BAL, HEROES, UNITS } from '../sim/Sim.js';
import { REALMS, HIDDEN, EXTRA_REALMS, ALL_REALMS, gateCenter } from '../sim/map.js';
import { recordRun, loadGuardSave } from '../save.js';
import { PANELS } from '../ui/index.js';
import { touch, setTouchVisible } from '../../touch.js';
import { loadFeelSettings, saveFeelSettings } from '../render/gameFeel.js';

const INK_N = 0x0b0d18;
const KEYN = { q: 'Q', e: 'E', r: 'R', f: 'F', u: '空格' };
const PAUSE_PANELS = new Set(['bag', 'shop', 'realms', 'nanhua', 'story']);
const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({ fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 4, ...extra });

export function unitPortrait(u) {
  if (u.kind === 'hero') return HEROES[u.key].portrait;
  if (u.kind === 'kongming') return UNITS.kongming.portrait;
  return u.def.tex;
}

export class GuardHUD extends Phaser.Scene {
  constructor() { super('GuardHUD'); }

  create() {
    this.gg = this.scene.get('GuardGame');
    this.sim = this.gg.sim;
    this.errorCount = 0;
    this.modal = null; // 'pause' | 'result'
    this.panel = null; // 当前打开的面板 {name, obj}
    this.panelObjs = {};
    this.widgets = [];
    this._consumedPtrId = null;
    this._consumedAt = -999;
    this.input.on('gameobjectdown', (p) => {
      this._consumedPtrId = p.id;
      this._consumedAt = this.time.now;
    });
    this.staticG = this.add.graphics().setDepth(4);
    this.g = this.add.graphics().setDepth(5);
    this.miniBg = this.add.graphics().setDepth(11);
    this.mini = this.add.graphics().setDepth(12);
    this._avatarMasks = [];
    this._skillMasks = [];
    this._hudFrame = 0;
    this._miniStaticSig = '';
    this._lastCamX = -1;
    this._lastCamY = -1;
    // 静态底框只画一次，避免 60fps 重复绘制不变的圆角背景
    this.staticG.fillStyle(0x0f1128, 0.82).fillRoundedRect(16, 12, 340, 94, 12).lineStyle(3, INK_N).strokeRoundedRect(16, 12, 340, 94, 12);
    this.staticG.fillStyle(0x0f1128, 0.82).fillRoundedRect(1050, 12, 216, 220, 12).lineStyle(3, INK_N).strokeRoundedRect(1050, 12, 216, 220, 12);
    this.buildTop();
    this.buildTrainingBar();
    this.buildBossRoomBar();
    this.buildActionDock();
    this.buildGuideCard();
    this.buildBottom();
    this.bannerText = this.add.text(640, 182, '', st(38, '#ffc977', TF, { strokeThickness: 7 })).setOrigin(0.5).setAlpha(0).setDepth(50);
    this.toastText = this.add.text(640, 588, '', st(19, '#f3e6c8', BF, { strokeThickness: 5 })).setOrigin(0.5).setAlpha(0).setDepth(60);
    this.alertText = this.add.text(640, 82, '⚠ 孔明遇袭 · 点击回防', st(18, '#ffffff', TF, { strokeThickness: 5, backgroundColor: '#a01414', padding: { x: 14, y: 4 } })).setOrigin(0.5).setVisible(false).setDepth(45).setInteractive({ useHandCursor: true });
    this.alertText.on('pointerdown', () => {
      this.gg.cmd({ type: 'rallyKongming' });
      this.gg.addOrderRipple?.(this.sim.kongming.x, this.sim.kongming.y + 130, 0x5fe08a, 'move');
      this.toast('火速回防孔明！', '#ffc977');
    });
    this.edgeG = this.add.graphics().setDepth(40);
    this.vignette = this.add.rectangle(640, 360, 1280, 720, 0xff2020, 0).setDepth(39);
    const onVis = () => { if (document.hidden && !this.modal) this.togglePause(); };
    document.addEventListener('visibilitychange', onVis);
    touch.onPause = () => this.togglePause();
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onVis);
      touch.onPause = null;
      for (const m of (this._avatarMasks || [])) { if (m && m.scene) m.destroy(); }
      for (const m of (this._skillMasks || [])) { if (m && m.scene) m.destroy(); }
      this._avatarMasks = [];
      this._skillMasks = [];
    });
    this.sim.on('kongmingHit', () => {
      const s = this.sim;
      if (s.t - s.kmAlert.lastWarn > BAL.kongming.alertCd) { s.kmAlert.lastWarn = s.t; sfx('warn'); this.alertPulse(); }
    });
    this.sim.on('switch', (u) => { this.refreshAvatars(); this.buildSkills(); this.toast(`操控：${u.name}`, '#ffc977'); });
    this.sim.on('unitSpawn', () => this.refreshAvatars());
    this.sim.on('unitDown', () => this.refreshAvatars());
    for (const P of PANELS) {
      const o = P.create(this);
      if (P.always) { o.c.setDepth(20); this.widgets.push(o); continue; } // 常驻小部件（如任务追踪），每帧 refresh
      o.c.setVisible(false).setDepth(55); // 面板压在横幅（50）之上、提示（60）之下
      this.panelObjs[P.name] = o;
    }
  }

  // ---------------- 顶部：孔明血条 / 波次 / 资源 / 小地图 ----------------
  buildTop() {
    this.kmName = this.add.text(640, 10, '孔明 · 七星续命', st(20, '#ffc977', TF)).setOrigin(0.5, 0).setDepth(15);
    this.kmHp = this.add.text(640, 48, '', st(14, '#ffffff', NF, { fontStyle: 'bold', strokeThickness: 3 })).setOrigin(0.5).setDepth(15);
    this.bossName = this.add.text(640, 100, '', st(21, '#ff8a7a', TF)).setOrigin(0.5).setVisible(false).setDepth(15);
    this.waveTitle = this.add.text(28, 18, '', st(26, '#ffc977', TF, { strokeThickness: 5 })).setDepth(15);
    this.waveInfo = this.add.text(28, 52, '', st(13, '#d8d2f5', BF, { lineSpacing: 4 })).setDepth(15);
    // 顶部波次框内的快捷「提前召唤」按钮（鼠键与触屏均可点）
    this.callWaveBtn = makeButton(this, 294, 33, 104, 28, '提前召唤 [N]', () => {
      const r = this.gg.cmd({ type: 'callWave' });
      if (r && r.ok && r.bonus) this.toast(`提前召唤 · 铜钱 +${r.bonus}`, '#ffd36a');
    }, { size: 12, font: BF, primary: true }).setDepth(16);

    // 手动存档按钮（也可按 F6）；自动存档在波次切换 / 每 30 秒 / 切后台与刷新时发生
    this.saveBtn = makeButton(this, 294, 66, 104, 26, '存档 [F6]', () => { this.gg.manualSave(); }, { size: 12, font: BF }).setDepth(16);
    this.add.image(250, 66, 'g_ui_save_lantern').setDisplaySize(15, 24).setDepth(17);

    this.coinIcon = this.add.image(1078, 32, 'drop_coin').setScale(0.4).setDepth(15);
    this.coinText = this.add.text(1254, 32, '', st(21, '#ffd36a', NF, { fontStyle: 'bold' })).setOrigin(1, 0.5).setDepth(15);
    this.lvText = this.add.text(1062, 58, '', st(13, '#d8d2f5')).setDepth(15);
    this.miniX = 1066; this.miniY = 90; this.miniW = 194; this.miniH = 136;
    // WC3 小地图交互：点击或右键小地图任意位置，直接指挥当前操控单位前往
    const miniHit = this.add.rectangle(this.miniX + this.miniW / 2, this.miniY + this.miniH / 2, this.miniW, this.miniH, 0, 0.001)
      .setDepth(18).setInteractive({ useHandCursor: true });
    miniHit.on('pointerdown', (p) => {
      if (this.modal || this.gg.paused || this.gg.panelPaused || this.sim.over) return;
      const rx = Phaser.Math.Clamp((p.x - this.miniX) / this.miniW, 0, 1);
      const ry = Phaser.Math.Clamp((p.y - this.miniY) / this.miniH, 0, 1);
      const wx = rx * BAL.world.w;
      const wy = ry * BAL.world.h;
      const atk = this.gg.attackMoveMode || !!(p.event && p.event.shiftKey);
      this.gg.attackMoveMode = false;
      this.gg.cmd({ type: atk ? 'attackMove' : 'moveTo', x: wx, y: wy });
      this.gg.addOrderRipple?.(wx, wy, atk ? 0xff5a4a : 0x5fe08a, atk ? 'attack' : 'move');
      sfx('click');
    });
  }

  // 练功房顶部悬浮控制栏（进入练功房后自动显示：切换初阶/中阶/高阶/挨打房 + 实时挨打计数 + 一键退出回灯坛）
  buildTrainingBar() {
    const c = this.add.container(0, 0).setDepth(35).setVisible(false);
    const bg = this.add.graphics();
    bg.fillStyle(0x0f1f1a, 0.93).fillRoundedRect(414, 106, 556, 54, 12);
    bg.lineStyle(2.5, 0x5fe08a, 0.9).strokeRoundedRect(414, 106, 556, 54, 12);
    const lbl = this.add.text(426, 119, '剑阁·练功房', st(14, '#9ff0b8', TF, { strokeThickness: 3 })).setOrigin(0, 0.5);
    const temperTxt = this.add.text(426, 142, '挨打 0次 · 凡躯', st(12, '#ffd36a', BF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(0, 0.5);
    const tierBtns = {};
    const tiers = [
      ['low', '初阶', 584, 56],
      ['mid', '中阶', 644, 56],
      ['high', '高阶', 704, 56],
      ['temper', '挨打房', 772, 68],
    ];
    for (const [id, name, cx, bw] of tiers) {
      const btn = makeButton(this, cx, 133, bw, 32, name, () => {
        const r = this.gg.cmd({ type: 'setTrainingTier', tier: id });
        if (r && r.ok) this.toast(`练功房切换为【${r.name}】`, id === 'temper' ? '#ffb870' : '#9ff0b8');
      }, { size: 12, font: BF });
      tierBtns[id] = btn;
      c.add(btn);
    }
    const exitBtn = makeButton(this, 888, 133, 136, 32, '退出练功房', () => {
      const r = this.gg.cmd({ type: 'exitTraining' });
      if (r && r.ok) this.toast('已返回七星灯坛！', '#7fe3ff');
    }, { size: 12, font: BF, primary: true });
    c.add([bg, lbl, temperTxt, exitBtn]);
    // 把按钮提到 bg 之上
    c.bringToTop(lbl);
    c.bringToTop(temperTxt);
    for (const b of Object.values(tierBtns)) c.bringToTop(b);
    c.bringToTop(exitBtn);
    this.trainingBar = { c, tierBtns, temperTxt, lastTier: null };
  }

  toggleTrainingRoom() {
    const T = this.sim.training;
    if (!T) { this.toast('当前地图未配置练功房', '#9aa3cf'); return; }
    if (T.inRoom()) {
      const r = this.gg.cmd({ type: 'exitTraining' });
      if (r && r.ok) this.toast('已离开练功房，返回七星灯坛', '#7fe3ff');
    } else {
      const r = this.gg.cmd({ type: 'enterTraining' });
      if (r && r.ok) this.toast('进入练功房 · 稳步刷级打装（主线仍在推进）', '#9ff0b8');
    }
  }

  enterTemperRoom() {
    const T = this.sim.training;
    if (!T) { this.toast('当前地图未配置练功房', '#9aa3cf'); return; }
    if (T.inRoom() && T.tier === 'temper') {
      const r = this.gg.cmd({ type: 'exitTraining' });
      if (r && r.ok) this.toast('已离开挨打房，返回七星灯坛', '#7fe3ff');
    } else {
      const r = this.gg.cmd({ type: 'enterTemper' });
      if (r && r.ok) this.toast('进入挨打房 · 快速受击升级练体（主线仍在推进）', '#ffb870');
    }
  }

  // BOSS 房顶部悬浮控制栏（进入 BOSS 房后显示：初/中/高阶切换 + 立即再战 + 退出）
  buildBossRoomBar() {
    const c = this.add.container(0, 0).setDepth(35).setVisible(false);
    const bg = this.add.graphics();
    bg.fillStyle(0x241016, 0.94).fillRoundedRect(356, 108, 568, 46, 12);
    bg.lineStyle(2.5, 0xff6a5a, 0.92).strokeRoundedRect(356, 108, 568, 46, 12);
    const lbl = this.add.text(370, 131, '镇夜·BOSS房', st(16, '#ff9a8a', TF, { strokeThickness: 3 })).setOrigin(0, 0.5);
    const tierBtns = {};
    const tiers = [['low', '初阶', 504], ['mid', '中阶', 574], ['high', '高阶', 644]];
    for (const [id, name, cx] of tiers) {
      const btn = makeButton(this, cx, 131, 64, 32, name, () => {
        const r = this.gg.cmd({ type: 'setBossRoomTier', tier: id });
        if (r && r.ok) this.toast(`BOSS房切换为【${r.name}】`, '#ff9a8a');
      }, { size: 13, font: BF });
      tierBtns[id] = btn;
      c.add(btn);
    }
    const reBtn = makeButton(this, 732, 131, 92, 32, '立即再战', () => {
      const r = this.gg.cmd({ type: 'respawnBossRoom' });
      if (r && r.ok) this.toast('BOSS 已重新降临！', '#ffd36a');
    }, { size: 13, font: BF });
    const exitBtn = makeButton(this, 848, 131, 118, 32, '退出BOSS房', () => {
      const r = this.gg.cmd({ type: 'exitBossRoom' });
      if (r && r.ok) this.toast('已返回七星灯坛！', '#7fe3ff');
    }, { size: 13, font: BF, primary: true });
    c.add([bg, lbl, reBtn, exitBtn]);
    c.bringToTop(lbl);
    for (const b of Object.values(tierBtns)) c.bringToTop(b);
    c.bringToTop(reBtn);
    c.bringToTop(exitBtn);
    this.bossRoomBar = { c, tierBtns, reBtn, lastTier: null };
  }

  toggleBossRoom() {
    const BR = this.sim.bossRoom;
    if (!BR) { this.toast('当前地图未配置 BOSS 房', '#9aa3cf'); return; }
    if (BR.inRoom()) {
      const r = this.gg.cmd({ type: 'exitBossRoom' });
      if (r && r.ok) this.toast('已离开 BOSS 房，返回七星灯坛', '#7fe3ff');
    } else {
      const r = this.gg.cmd({ type: 'enterBossRoom' });
      if (r && r.ok) this.toast('进入 BOSS 房 · 刷高阶神兵与永久成长书卷！', '#ff8a7a');
    }
  }

  guideBanditQuest() {
    const B = this.sim.bandits;
    if (!B) { this.toast('当前地图未配置强盗营寨', '#9aa3cf'); return; }
    this.gg.cmd({ type: 'guideBandit' });
    this.gg.setQuestGuide?.(B.cfg.x, B.cfg.y, '讨伐左上角吕达', false);
    this.toast(B.state === 'alive' ? '正前往左上角强盗营寨讨伐【吕达】（小心敌方箭塔）！' : `正前往强盗营寨，吕达重生倒计时 ${Math.ceil(B.cooldownLeft())}s`, '#ff9a5a');
  }

  guideHunterQuest() {
    const H = this.sim.hunter;
    if (!H) { this.toast('当前地图未配置猎人营地', '#9aa3cf'); return; }
    this.gg.cmd({ type: 'guideHunter' });
    this.gg.setQuestGuide?.(H.cfg.x, H.cfg.y, '猎人任务·狩猎野狼', false);
    this.toast(`正前往西南猎人营地（当前狩猎进度 ${H.prog}/${H.need}）！`, '#9ff0b8');
  }

  startNextMirror() {
    const M = this.sim.mirror;
    if (!M) { this.toast('当前地图未配置镜像挑战', '#9aa3cf'); return; }
    const next = (M.cfg.tiers || []).find((t) => !M.cleared[t.id]) || M.cfg.tiers[M.cfg.tiers.length - 1];
    const r = this.gg.cmd({ type: 'startMirror', tier: next.id });
    if (r && r.ok) this.toast(`心魔镜像【${next.name}】现身！击败永久战力 +${next.powerBonus}`, '#c47bff');
  }

  // 左侧快捷功能栏 + WC3 战术指令栏（桌面端展开；触屏端顶部精简大按钮 + 「功能 ▾」抽屉）
  buildActionDock() {
    const X = 16;
    if (touch.enabled) {
      this.mobileDrawerOpen = false;
      this.mobileDrawerC = this.add.container(0, 0).setDepth(32).setVisible(false);
      const dbg = this.add.graphics();
      dbg.fillStyle(0x0f1128, 0.96).fillRoundedRect(16, 158, 224, 294, 12).lineStyle(2.5, 0xffc977, 0.9).strokeRoundedRect(16, 158, 224, 294, 12);
      const drawerBlocker = this.add.rectangle(16 + 112, 158 + 147, 224, 294, 0, 0.001).setInteractive();
      this.mobileDrawerC.add([dbg, drawerBlocker]);
      const closeD = () => { this.mobileDrawerOpen = false; this.mobileDrawerC.setVisible(false); this.mobileMenuBtn.setLabel('功能 ▾'); };
      const dm = (col, row, label, fn, opts = {}) => makeButton(this, 26 + col * 106 + 48, 168 + row * 34 + 15, 98, 30, label, () => { closeD(); fn(); }, { size: 12, font: BF, ...opts });
      this.mobileDrawerC.add([
        dm(0, 0, '藏经书店', () => this.togglePanel('shop', { tab: 'books' }), { primary: true }),
        dm(1, 0, '百宝商店', () => this.togglePanel('shop', { tab: 'items' }), { primary: true }),
        dm(0, 1, '讨伐吕达', () => this.guideBanditQuest(), { primary: true }),
        dm(1, 1, '猎人任务', () => this.guideHunterQuest()),
        dm(0, 2, '秘境挑战', () => this.togglePanel('realms'), { primary: true }),
        dm(1, 2, 'BOSS房', () => this.toggleBossRoom()),
        dm(0, 3, '挨打房', () => this.enterTemperRoom(), { primary: true }),
        dm(1, 3, '南华仙人', () => this.togglePanel('nanhua'), { primary: true }),
        dm(0, 4, '镜像3w', () => this.startNextMirror()),
        dm(1, 4, '神兵合成', () => this.togglePanel('bag', { tab: 'craft' })),
        dm(0, 5, '建造箭楼', () => this.togglePanel('build')),
        dm(1, 5, '雇佣守卫', () => this.togglePanel('hire')),
        dm(0, 6, '孔明军令', () => this.togglePanel('quests')),
        dm(1, 6, '吃药/灯油', () => {
          const r1 = this.gg.cmd({ type: 'useQuickItem', itemId: 'pill' });
          if (!r1.ok) {
            const r2 = this.gg.cmd({ type: 'useQuickItem', itemId: 'oil' });
            if (!r2.ok) this.togglePanel('shop');
          }
        }),
        dm(0, 7, '一键清地', () => {
          const r = this.gg.cmd({ type: 'clearGroundItems' });
          if (r && r.ok) this.toast(r.cleared > 0 ? `已清理 ${r.cleared} 件地面道具${r.keptUnique ? `（保留 ${r.keptUnique} 件唯一）` : ''}` : '地面当前无需清理', '#9ff0b8');
        }),
        dm(1, 7, '暂停菜单', () => this.togglePause()),
      ]);
      this.mobileMenuBtn = makeButton(this, 64, 132, 96, 36, '功能 ▾', () => {
        this.mobileDrawerOpen = !this.mobileDrawerOpen;
        this.mobileDrawerC.setVisible(this.mobileDrawerOpen);
        this.mobileMenuBtn.setLabel(this.mobileDrawerOpen ? '收起 ▴' : '功能 ▾');
      }, { size: 14, font: BF, primary: true }).setDepth(33);
      // 移动端高频直达：行囊·合成 + 练功房 + BOSS房 + 秘境
      this.mobileBagBtn = makeButton(this, 170, 132, 102, 36, '行囊·合成', () => { closeD(); this.togglePanel('bag'); }, { size: 14, font: BF }).setDepth(33);
      this.mobileTrainBtn = makeButton(this, 272, 132, 86, 36, '练功房', () => { closeD(); this.toggleTrainingRoom(); }, { size: 14, font: BF }).setDepth(33);
      this.mobileBossBtn = makeButton(this, 364, 132, 86, 36, 'BOSS房', () => { closeD(); this.toggleBossRoom(); }, { size: 14, font: BF }).setDepth(33);
      this.dockBtns = { training: this.mobileTrainBtn, bossRoom: this.mobileBossBtn };
      this.stanceTag = this.add.text(16, 174, '', st(13, '#7fe3ff', BF, { strokeThickness: 3 })).setDepth(18);
      return;
    }

    const Y = 196; const bw = 68; const gap = 6;
    const mk = (col, row, h, label, fn, opts = {}) => {
      const cx = X + col * (bw + gap) + bw / 2;
      const cy = Y + row * 28 + h / 2;
      return makeButton(this, cx, cy, bw, h, label, fn, { size: 12, font: BF, ...opts }).setDepth(18);
    };
    this.dockBtns = {
      bag: mk(0, 0, 24, '行囊 [B]', () => this.togglePanel('bag')),
      craft: mk(1, 0, 24, '合成 [K]', () => this.togglePanel('bag', { tab: 'craft' }), { primary: true }),
      shop: mk(2, 0, 24, '商店 [P]', () => this.togglePanel('shop', { tab: 'items' }), { primary: true }),
      books: mk(0, 1, 24, '书店', () => this.togglePanel('shop', { tab: 'books' }), { primary: true }),
      realms: mk(1, 1, 24, '秘境 [Y]', () => this.togglePanel('realms'), { primary: true }),
      quests: mk(2, 1, 24, '军令 [T]', () => this.togglePanel('quests')),
      training: mk(0, 2, 24, '练功房', () => this.toggleTrainingRoom()),
      bossRoom: mk(1, 2, 24, 'BOSS房', () => this.toggleBossRoom()),
      mirror: mk(2, 2, 24, '镜像3w', () => this.startNextMirror()),
      lvda: mk(0, 3, 24, '伐吕达', () => this.guideBanditQuest()),
      hunter: mk(1, 3, 24, '猎人任务', () => this.guideHunterQuest()),
      build: mk(2, 3, 24, '建造 [G]', () => this.togglePanel('build')),
      hire: mk(0, 4, 24, '雇佣 [H]', () => this.togglePanel('hire')),
      clearGround: mk(1, 4, 24, '清地 [L]', () => {
        const r = this.gg.cmd({ type: 'clearGroundItems' });
        if (r && r.ok) {
          const msg = r.cleared > 0
            ? `已清理 ${r.cleared} 件地面道具${r.keptUnique ? `（保留 ${r.keptUnique} 件唯一道具）` : ''}`
            : (r.keptUnique ? `地面仅剩 ${r.keptUnique} 件唯一道具，已受保护` : '地面当前很干净，无需清理');
          this.toast(msg, r.cleared > 0 ? '#9ff0b8' : '#7fe3ff');
        }
      }),
      amove: mk(2, 4, 24, '巡攻 [Z]', () => {
        this.gg.attackMoveMode = !this.gg.attackMoveMode;
        this.toast(this.gg.attackMoveMode ? '巡攻模式：点击地面/小地图沿途迎敌' : '已取消巡攻', this.gg.attackMoveMode ? '#ff8a7a' : '#9aa3cf');
      }),
      temper: mk(0, 5, 24, '挨打房', () => this.enterTemperRoom(), { primary: true }),
      nanhua: mk(1, 5, 24, '南华 [O]', () => this.togglePanel('nanhua'), { primary: true }),
      story: mk(2, 5, 24, '剑阁录 [I]', () => this.togglePanel('story')),
    };
    this.stanceTag = this.add.text(X, Y + 172, '', st(12, '#7fe3ff', BF, { strokeThickness: 3 })).setDepth(18);
  }

  // 开局 3 步闭环引导卡（仅桌面端显示，完成移动+建塔后自动淡出；触屏端不占屏）
  buildGuideCard() {
    const c = this.add.container(16, 388).setDepth(18);
    if (touch.enabled) {
      c.setVisible(false);
      this.guideC = c;
      this.guideDone = true;
      return;
    }
    const g = this.add.graphics();
    g.fillStyle(0x0f1128, 0.86).fillRoundedRect(0, 0, 224, 68, 10).lineStyle(2, 0xffc977, 0.85).strokeRoundedRect(0, 0, 224, 68, 10);
    const title = this.add.text(10, 6, '新手闭环指引', st(12, '#ffc977', BF, { fontStyle: 'bold', strokeThickness: 3 }));
    const closeX = this.add.text(212, 4, '×', st(15, '#9aa3cf', BF, { strokeThickness: 2 })).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    closeX.on('pointerdown', () => { this.guideDone = true; c.setVisible(false); });
    const body = this.add.text(10, 24, '', st(11, '#e8e4d8', BF, { strokeThickness: 2, lineSpacing: 2, wordWrap: { width: 204, useAdvancedWrap: true } }));
    c.add([g, title, closeX, body]);
    this.guideC = c;
    this.guideBody = body;
    this.guideStartPos = { x: this.sim.hero.x, y: this.sim.hero.y };
    this.guideMoved = false;
    this.guideDone = false;
  }

  buildBottom() {
    this.avatarC = this.add.container(0, 0).setDepth(15);
    this.skillC = this.add.container(0, 0).setDepth(15);
    this.refreshAvatars();
    this.buildSkills();
    if (!touch.enabled) {
      this.add.text(640, 708, '右键/点地/WASD 移动 · QERF 技能 · 空格 大招 · V 回城 · X 穿墙闪现 · O 南华强化 · P 商店 · B/K/G/H/T/Y 面板', st(12, '#9aa3cf', BF, { strokeThickness: 3 })).setOrigin(0.5).setDepth(14);
    }
  }

  refreshAvatars() {
    const s = this.sim;
    const c = this.avatarC;
    for (const m of (this._avatarMasks || [])) { if (m && m.scene) m.destroy(); }
    this._avatarMasks = [];
    c.removeAll(true);
    this.avatars = [];
    const ids = s.party.filter((id) => s.byId(id));
    // 动态压缩步进，确保桌面端与移动端均不会撞上快捷道具栏或大号 MOBA 技能轮盘
    const maxW = touch.enabled ? 540 : 420;
    const step = ids.length <= 1 ? 74 : Math.min(74, Math.floor(maxW / ids.length));
    const sz = step >= 70 ? 66 : Math.max(42, step - 6);
    ids.forEach((id, i) => {
      const u = s.byId(id);
      const x = 24 + i * step;
      const y = 618 + (66 - sz);
      const g = this.add.graphics();
      const img = this.add.image(x + sz / 2, y + 4, unitPortrait(u)).setOrigin(0.5, 0);
      img.setScale(Math.min((sz * 1.65) / img.height, (sz * 1.35) / img.width));
      const m = this.make.graphics({ add: false }).fillRoundedRect(x + 3, y + 3, sz - 6, sz - 6, 9);
      this._avatarMasks.push(m);
      img.setMask(m.createGeometryMask());
      const num = this.add.text(x + 5, y + 2, String(i + 1), st(12, '#ffffff', NF, { fontStyle: 'bold', strokeThickness: 3 }));
      const down = this.add.text(x + sz / 2, y + sz / 2, '', st(17, '#ff8a7a', NF, { fontStyle: 'bold' })).setOrigin(0.5);
      const hit = this.add.rectangle(x + sz / 2, y + sz / 2, sz, sz, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => this.gg.cmd({ type: 'switch', id }));
      c.add([g, img, num, down, hit]);
      this.avatars.push({ id, x, y, sz, g, img, down, lastSig: '' });
    });
    if (!touch.enabled && ids.length > 1) c.add(this.add.text(24, 598, 'Tab 轮换 · 点头像或场上单位切换', st(12, '#9aa3cf')));
  }

  buildSkills() {
    const s = this.sim;
    const c = this.skillC;
    for (const m of (this._skillMasks || [])) { if (m && m.scene) m.destroy(); }
    this._skillMasks = [];
    c.removeAll(true);
    this.skillSlots = [];
    this.aimState = null;
    this.atkHeld = false;
    this.atkPointerId = null;
    const u = s.ctrl;
    if (!u) return;

    // 取消施法区 + 拖动瞄准摇杆覆盖层（置于大号技能轮盘左上方空档 736,474，零重叠）
    if (!this.aimG) {
      this.aimG = this.add.graphics().setDepth(42);
      this.cancelLabel = this.add.text(736, 474, '× 取消施法', st(14, '#ffffff', BF, { fontStyle: 'bold', strokeThickness: 3 })).setOrigin(0.5).setDepth(43).setVisible(false);
      this.input.on('pointermove', (p) => this.onAimMove(p));
      const releasePtr = (p) => {
        if (!p || this.atkPointerId === null || p.id === this.atkPointerId) {
          this.atkHeld = false;
          this.atkPointerId = null;
          if (this.atkBtnC) this.atkBtnC.setScale(1);
        }
        this.onAimUp(p);
      };
      this.input.on('pointerup', releasePtr);
      this.input.on('pointerupoutside', releasePtr);
    }

    // 供自动化几何间距断言读取的右下角全圆钮清单（确保任意两钮边到边净空 ≥ 20px，召唤师技能 ≥ 24px）
    this.mobaButtons = [];

    // 1. 超大号王者荣耀风格右下「普攻键」（直径 116px，r=58，按住持续普攻，点击即打，带按压回弹反馈）
    const ax = 1204; const ay = 644; const ar = 58;
    this.mobaButtons.push({ id: 'atk', kind: 'attack', cx: ax, cy: ay, r: ar, d: ar * 2 });
    const atkBtnC = this.add.container(ax, ay);
    const atkG = this.add.graphics();
    atkG.fillStyle(0x0b0d18, 0.94).fillCircle(0, 4, ar + 4);
    atkG.fillStyle(0x522818, 0.97).fillCircle(0, 0, ar);
    atkG.lineStyle(4.5, 0xffc977, 0.98).strokeCircle(0, 0, ar);
    atkG.lineStyle(2, 0xff9a3c, 0.55).strokeCircle(0, 0, ar - 8);
    const atkLbl = this.add.text(0, -5, '普攻', st(30, '#ffd36a', TF, { strokeThickness: 5 })).setOrigin(0.5);
    const atkSub = this.add.text(0, 26, touch.enabled ? '长按连击' : 'J / 长按', st(12, '#f3e6c8', BF, { strokeThickness: 2 })).setOrigin(0.5);
    const atkHit = this.add.circle(0, 0, ar + 2, 0, 0.001).setInteractive({ useHandCursor: true });
    atkHit.on('pointerdown', (p) => {
      if (this.modal || this.gg.paused || this.gg.panelPaused || this.sim.over) return;
      this.atkHeld = true;
      this.atkPointerId = p ? p.id : null;
      atkBtnC.setScale(0.92);
      this.gg.cmd({ type: 'basicAttack', autoAim: true });
    });
    atkBtnC.add([atkG, atkLbl, atkSub, atkHit]);
    this.atkBtnC = atkBtnC;
    c.add(atkBtnC);

    // 2. 人体工学超大号防误触扇形技能轮盘（Q/E/R/F 直径 82px，大招 90px，任意相邻圆钮边到边间距 ≥ 29px）
    const ARC_POS = {
      q: { cx: 1076, cy: 656, size: 82 },
      e: { cx: 1094, cy: 542, size: 82 },
      r: { cx: 1212, cy: 516, size: 82 },
      f: { cx: 964, cy: 656, size: 82 },
      u: { cx: 972, cy: 534, size: 90 },
    };

    const skills = u.def.skills || {};
    const slots = Object.keys(skills);
    for (const slot of slots) {
      const sk = skills[slot];
      const pos = ARC_POS[slot];
      if (!pos) continue;
      const { cx, cy, size } = pos;
      const x = cx - size / 2;
      const y = cy - size / 2;
      const rad = size / 2;
      this.mobaButtons.push({ id: slot, kind: slot === 'u' ? 'ult' : 'skill', cx, cy, r: rad, d: size });
      const bgRing = this.add.graphics();
      bgRing.fillStyle(0x0b0d18, 0.94).fillCircle(cx, cy + 3, rad + 4);
      bgRing.fillStyle(slot === 'u' ? 0x2c1f4a : 0x161c3d, 0.96).fillCircle(cx, cy, rad);
      bgRing.lineStyle(slot === 'u' ? 3.5 : 2.5, slot === 'u' ? 0xffd36a : 0x6f80c8).strokeCircle(cx, cy, rad + 1);
      const iconKey = this.textures.exists(sk.icon) ? sk.icon : unitPortrait(u);
      const icon = this.add.image(cx, cy, iconKey).setDisplaySize(size - 6, size - 6);
      const maskG = this.make.graphics({ add: false }).fillCircle(cx, cy, rad - 3);
      this._skillMasks.push(maskG);
      icon.setMask(maskG.createGeometryMask());
      const cd = this.add.graphics();
      // 清晰的中文技能名底条 + 桌面端快捷键角标
      const nameTag = this.add.text(cx, cy + rad - 2, slot === 'u' ? `大·${sk.name.slice(0, 2)}` : sk.name.slice(0, 3), st(12, '#ffd36a', BF, { fontStyle: 'bold', strokeThickness: 3 })).setOrigin(0.5, 1);
      const key = !touch.enabled
        ? this.add.text(cx + rad - 5, cy - rad + 3, KEYN[slot], st(11, '#ffffff', NF, { fontStyle: 'bold', strokeThickness: 3 })).setOrigin(1, 0)
        : this.add.text(cx, cy, '').setVisible(false);
      const lvTxt = this.add.text(cx - rad + 5, cy - rad + 3, '', st(11, '#7fe3ff', NF, { fontStyle: 'bold', strokeThickness: 3 }));
      const cdt = this.add.text(cx, cy - 2, '', st(21, '#ffffff', NF, { fontStyle: 'bold', strokeThickness: 4 })).setOrigin(0.5);
      const hit = this.add.circle(cx, cy, rad + 2, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => {
        if (!this.aimState) {
          const skLv = u.kind === 'hero' && u.skillLvs ? (u.skillLvs[slot] || 0) : 1;
          const lockTip = skLv <= 0 ? '【未学习 · 点击上方 + 号消耗技能点学习】' : ` Lv.${skLv}`;
          this.tip(`${sk.name}${lockTip}：${sk.desc}`);
        }
      });
      hit.on('pointerdown', (p) => {
        // 若技能未学但有技能点且可学，直接提示或点 + 学习
        if (u.kind === 'hero' && u.skillLvs && (u.skillLvs[slot] || 0) <= 0) {
          if (this.sim.canUpgradeSkill(u, slot)) {
            const r = this.gg.cmd({ type: 'upgradeSkill', slot });
            if (r && r.ok) this.toast(`已习得【${sk.name}】Lv.1！再次点击即可施放`, '#ffd36a');
          } else {
            this.toast(slot === 'u' ? '大招需英雄达到 6 级并消耗技能点学习' : '该技能尚未学习（升级获得技能点后点击 + 学习）', '#ff8a7a');
          }
          return;
        }
        bump(this, icon, 0.9);
        this.startSkillAim(slot, sk, cx, cy, p);
      });

      // 技能学习 / 加点按钮（位于圆钮正上方，有可用技能点时高亮显示）
      const ux = Math.round(cx);
      const uy = Math.round(cy - rad - 5);
      const upBg = this.add.graphics().setVisible(false);
      upBg.fillStyle(0xffc94a).fillRoundedRect(ux - 16, uy - 11, 32, 22, 6).lineStyle(2, INK_N).strokeRoundedRect(ux - 16, uy - 11, 32, 22, 6);
      const upTxt = this.add.text(ux, uy, '+', st(16, '#0b0d18', NF, { fontStyle: 'bold', strokeThickness: 0 })).setOrigin(0.5).setVisible(false);
      const upHit = this.add.rectangle(ux, uy, 36, 26, 0, 0.001).setInteractive({ useHandCursor: true }).setVisible(false);
      upHit.on('pointerdown', () => {
        const r = this.gg.cmd({ type: 'upgradeSkill', slot });
        if (r && r.ok) this.toast(r.learned ? `已习得 ${sk.name} Lv.1！` : `${sk.name} 升至 Lv.${r.lv}`, '#ffd36a');
      });
      c.add([bgRing, icon, cd, cdt, nameTag, key, lvTxt, hit, upBg, upTxt, upHit]);
      this.skillSlots.push({ slot, x, y, cx, cy, size, cd, cdt, sk, icon, nameTag, lvTxt, upBg, upTxt, upHit });
    }

    // 3. 独立分列大号「闪现」与「回城」召唤师技能圆钮（直径 70px，r=35，距技能弧 ≥ 32px 净空，绝不误触）
    const mkSummoner = (id, cx, cy, label, sub, col, onDown) => {
      const r = 35;
      this.mobaButtons.push({ id, kind: 'utility', cx, cy, r, d: r * 2 });
      const btnC = this.add.container(cx, cy);
      const g = this.add.graphics();
      g.fillStyle(0x0b0d18, 0.94).fillCircle(0, 3, r + 3);
      g.fillStyle(0x1b224a, 0.96).fillCircle(0, 0, r);
      g.lineStyle(3, col, 0.95).strokeCircle(0, 0, r);
      const t = this.add.text(0, -6, label, st(17, '#ffffff', BF, { fontStyle: 'bold', strokeThickness: 3 })).setOrigin(0.5);
      const cdTxt = this.add.text(0, 16, sub, st(12, '#ffd36a', NF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(0.5);
      const hit = this.add.circle(0, 0, r + 2, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', (p) => { bump(this, btnC, 0.9); onDown(p); });
      btnC.add([g, t, cdTxt, hit]);
      c.add(btnC);
      return { id, cdTxt };
    };
    this.sumBlink = mkSummoner('blink', 860, 550, '闪现', touch.enabled ? '拖动' : 'X', 0xc47bff, (p) => {
      this.startSkillAim('blink', { name: '穿墙闪现', range: BAL.blink?.range || 320 }, 860, 550, p);
    });
    this.sumRecall = mkSummoner('recall', 856, 656, '回城', touch.enabled ? '回坛' : 'V', 0x7fe3ff, () => {
      if (this.modal || this.gg.paused || this.gg.panelPaused || this.sim.over) return;
      const r = this.gg.cmd({ type: 'recall' });
      if (r && r.ok) this.toast('正在回城吟唱（移动将打断）…', '#7fe3ff');
    });

    this.spBadge = this.add.text(860, 496, '', st(14, '#ffd36a', BF, { fontStyle: 'bold', strokeThickness: 3 })).setOrigin(0.5);
    c.add(this.spBadge);
  }

  startSkillAim(slot, sk, cx, cy, p) {
    if (this.modal || this.gg.paused || this.gg.panelPaused || this.sim.over) return;
    const u = this.sim.ctrl;
    if (!u || !u.alive) return;
    if (slot === 'blink' && (u.cds?.blink || 0) > 0) {
      this.toast(`闪现冷却中（${u.cds.blink.toFixed(1)}s）`, '#ff8a7a');
      return;
    }
    if (slot === 'u' && u.energy < BAL.hero.ultEnergy) {
      this.toast(`大招能量不足（${Math.floor(u.energy)}%）`, '#ff8a7a');
      return;
    }
    if (slot !== 'blink' && slot !== 'u' && (u.cds?.[slot] || 0) > 0) {
      this.toast(`${sk.name} 冷却中（${u.cds[slot].toFixed(1)}s）`, '#ff8a7a');
      return;
    }
    const isAoe = !!(sk && sk.r && !sk.dist && !sk.speed && !sk.arc);
    this.aimState = {
      slot,
      sk,
      cx,
      cy,
      pointerId: p.id,
      px: p.x,
      py: p.y,
      dx: 0,
      dy: 0,
      dist: 0,
      ang: (this.sim.ctrl && this.sim.ctrl.face < 0) ? Math.PI : 0,
      ratio: 0.7,
      cancelled: false,
      range: (sk && (sk.range || sk.dist)) || 320,
      aoeR: (sk && sk.r) || 110,
      kind: isAoe ? 'aoe' : 'dir',
    };
  }

  consumedPointer(p) {
    if (this.aimState || this.atkHeld) return true;
    if (!p) return false;
    return this._consumedPtrId === p.id && (this.time.now - this._consumedAt) <= 40;
  }

  onAimMove(p) {
    const a = this.aimState;
    if (!a || p.id !== a.pointerId) return;
    a.px = p.x;
    a.py = p.y;
    a.dx = p.x - a.cx;
    a.dy = p.y - a.cy;
    a.dist = Math.hypot(a.dx, a.dy);
    if (a.dist > 10) {
      a.ang = Math.atan2(a.dy, a.dx);
      a.ratio = Math.min(1, a.dist / 78);
    }
    a.cancelled = Math.hypot(p.x - 736, p.y - 474) <= 50;
  }

  onAimUp(p) {
    const a = this.aimState;
    if (!a || (p && p.id !== a.pointerId)) return;
    this.aimState = null;
    if (this.aimG) this.aimG.clear();
    if (this.cancelLabel) this.cancelLabel.setVisible(false);
    if (a.cancelled) {
      this.toast('已取消施法', '#9aa3cf');
      return;
    }
    const u = this.sim.ctrl;
    if (!u || !u.alive) return;
    let aim = null;
    if (a.dist > 14) {
      const reach = a.range * Math.max(0.3, a.ratio);
      aim = { x: u.x + Math.cos(a.ang) * reach, y: u.y + Math.sin(a.ang) * reach };
    }
    if (a.slot === 'blink') {
      this.gg.cmd(aim ? { type: 'blink', x: aim.x, y: aim.y } : { type: 'blink', autoAim: true });
    } else {
      this.gg.cmd(aim ? { type: 'castSkill', slot: a.slot, x: aim.x, y: aim.y } : { type: 'castSkill', slot: a.slot, autoAim: true });
    }
  }

  // ---------------- 每帧刷新 ----------------
  update(...a) {
    try { this.updateHud(...a); } catch (e) { this.errorCount = (this.errorCount || 0) + 1; this.gg?.reportError?.(e, 'hud'); }
  }

  updateHud() {
    const s = this.sim;
    const g = this.g.clear();
    const km = s.kongming;
    // 孔明血条（始终显示；被打时闪红）
    const hit = s.t - s.kmAlert.t < 0.5;
    const k = Math.max(0, km.hp / km.maxHp);
    const bw = 520;
    g.fillStyle(INK_N).fillRoundedRect(640 - bw / 2 - 3, 36, bw + 6, 28, 14);
    g.fillStyle(0x2a0f14).fillRoundedRect(640 - bw / 2, 39, bw, 22, 11);
    g.fillStyle(k < 0.3 ? 0xff3a2a : 0xe0463a).fillRoundedRect(640 - bw / 2, 39, Math.max(22, bw * k), 22, 11);
    g.fillStyle(0xffffff, 0.18).fillRoundedRect(640 - bw / 2 + 4, 41, Math.max(14, bw * k - 8), 7, 4);
    if (hit || k < 0.3) g.lineStyle(4, 0xff5a4a, 0.5 + Math.sin(s.t * 18) * 0.4).strokeRoundedRect(640 - bw / 2 - 5, 34, bw + 10, 32, 15);
    const setTxt = (o, v) => { if (o.text !== v) o.setText(v); };
    setTxt(this.kmHp, `${Math.ceil(km.hp)} / ${km.maxHp}`);
    this.vignette.setAlpha(hit ? 0.08 + Math.sin(s.t * 20) * 0.04 : k < 0.3 ? 0.05 : 0);
    this.alertText.setVisible(s.t - s.kmAlert.t < 2.5 && !s.over);
    this.drawKmArrow(hit);
    // BOSS 血条（仅显示当前操控单位所在区域的 BOSS；若练功房/BOSS房悬浮栏可见则自动下移避让）
    const curRealm = s.ctrl?.realm || null;
    const boss = s.enemies.find((e) => e.alive && e.boss && (curRealm ? e.realm === curRealm : (!e.realm || e.openCamp)));
    const topBarVisible = !!(
      (this.bossRoomBar && s.bossRoom && s.bossRoom.inRoom() && !this.panel && !this.modal)
      || (this.trainingBar && s.training && s.training.inRoom() && !this.panel && !this.modal)
    );
    if (boss) {
      const barY = topBarVisible ? 168 : 100;
      this.bossName.setY(barY).setVisible(true);
      setTxt(this.bossName, `${boss.name}${boss.phase2 ? ' · 狂怒' : ''}`);
      g.fillStyle(INK_N).fillRoundedRect(340 - 3, barY + 14, 606, 18, 9);
      g.fillStyle(0x3a1020).fillRoundedRect(340, barY + 17, 600, 12, 6);
      g.fillStyle(0xb05aff).fillRoundedRect(340, barY + 17, 600 * Math.max(0, boss.hp / boss.maxHp), 12, 6);
    } else this.bossName.setVisible(false);
    // 波次（x: 16..356, 与孔明血条 380..900 留出 24px 净空）
    const w = s.wave;
    const last = s.mode === 'story' ? BAL.waves.storyLast : '∞';
    setTxt(this.waveTitle, w.n ? `第 ${w.n} 波 / ${last}` : '布阵中');
    const nextIn = Math.max(0, w.nextAt - s.t);
    let mainEnemies = 0;
    for (let i = 0; i < s.enemies.length; i++) { const e = s.enemies[i]; if (e.alive && !e.realm) mainEnemies++; }
    let aliveAllies = 0;
    for (let i = 0; i < s.party.length; i++) { if (s.byId(s.party[i])?.alive) aliveAllies++; }
    const laneNames = (s.map && s.map.laneNames) || BAL.laneNames || { N: '北', E: '东', W: '西', S: '南' };
    const lanes = (w.lanes || []).map((l) => laneNames[l] || l).join(' ');
    const canEarly = (s.mode !== 'story' || w.n < BAL.waves.storyLast) && nextIn > 0.5 && !s.over;
    this.callWaveBtn.setVisible(canEarly);
    if (canEarly) {
      const bonus = Math.round(nextIn * BAL.waves.earlyBonusPerSec);
      const lbl = `提前 +${bonus}钱`;
      if (this.callWaveBtn.label.text !== lbl) this.callWaveBtn.setLabel(lbl);
    }
    const lines = [];
    if (s.mode !== 'story' || w.n < BAL.waves.storyLast) lines.push(`下一波 ${fmtTime(nextIn)}   来路：${lanes || '—'}`);
    else lines.push('最后一波！击败夜帝·无光即胜');
    lines.push(`场上妖物 ${mainEnemies}   存活友军 ${aliveAllies}`);
    setTxt(this.waveInfo, lines.join('\n'));
    const coinStr = fmtNum(s.copper);
    if (this.coinText.text !== coinStr) { if (this.lastCopper !== undefined && s.copper > this.lastCopper) bump(this, this.coinText, 1.15); this.lastCopper = s.copper; this.coinText.setText(coinStr); }
    const h = s.hero;
    setTxt(this.lvText, `${h.name} Lv.${h.lv} · 杀 ${fmtNum(s.stats.kills)}`);
    g.fillStyle(0x141833).fillRect(1062, 78, 192, 5);
    g.fillStyle(0x7fe3ff).fillRect(1062, 78, 192 * Math.min(1, h.xp / s.xpNeed()), 5);

    // 练功房控制条（进入练功房时自动显示 + 4 阶切换 + 挨打练体实时计数）
    if (this.trainingBar && s.training) {
      const inT = s.training.inRoom();
      this.trainingBar.c.setVisible(inT && !this.panel && !this.modal);
      if (inT) {
        const tierLabels = { low: '初阶', mid: '中阶', high: '高阶', temper: '挨打房' };
        if (this.trainingBar.lastTier !== s.training.tier) {
          this.trainingBar.lastTier = s.training.tier;
          for (const [tid, btn] of Object.entries(this.trainingBar.tierBtns)) {
            const nm = tierLabels[tid] || tid;
            btn.setLabel(tid === s.training.tier ? `✦${nm}` : nm);
          }
        }
        const hits = s.temper ? s.temper.hits : 0;
        const tierName = s.temper?.currentTitle || s.training.tierDef()?.name || '凡躯';
        setTxt(this.trainingBar.temperTxt, `挨打 ${hits}次 · ${tierName}`);
      }
      if (this.dockBtns && this.dockBtns.training) {
        const tLbl = inT ? '出练功房' : '练功房';
        if (this.dockBtns.training.label.text !== tLbl) this.dockBtns.training.setLabel(tLbl);
      }
      if (this.dockBtns && this.dockBtns.temper) {
        const tpLbl = inT && s.training.tier === 'temper' ? '出挨打房' : '挨打房';
        if (this.dockBtns.temper.label.text !== tpLbl) this.dockBtns.temper.setLabel(tpLbl);
      }
    }
    // BOSS 房控制条（进入 BOSS 房时自动显示）
    if (this.bossRoomBar && s.bossRoom) {
      const inB = s.bossRoom.inRoom();
      this.bossRoomBar.c.setVisible(inB && !this.panel && !this.modal);
      if (inB) {
        if (this.bossRoomBar.lastTier !== s.bossRoom.tier) {
          this.bossRoomBar.lastTier = s.bossRoom.tier;
          for (const [tid, btn] of Object.entries(this.bossRoomBar.tierBtns)) {
            const nm = tid === 'low' ? '初阶' : tid === 'mid' ? '中阶' : '高阶';
            btn.setLabel(tid === s.bossRoom.tier ? `✦${nm}` : nm);
          }
        }
        const cd = Math.ceil(s.bossRoom.cooldownLeft());
        const reLbl = cd > 0 ? `冷却 ${cd}s` : '立即再战';
        if (this.bossRoomBar.reBtn.label.text !== reLbl) this.bossRoomBar.reBtn.setLabel(reLbl);
      }
      if (this.dockBtns && this.dockBtns.bossRoom) {
        const bLbl = inB ? '出BOSS房' : 'BOSS房';
        if (this.dockBtns.bossRoom.label.text !== bLbl) this.dockBtns.bossRoom.setLabel(bLbl);
      }
    }

    // 战术指令与回城/闪现/清地状态刷新
    const u = s.ctrl;
    if (this.dockBtns) {
      if (this.dockBtns.recall) {
        const rcLbl = u?.recall ? `吟唱 ${u.recall.t.toFixed(1)}s` : (u?.cds?.recall > 0 ? `回城 ${Math.ceil(u.cds.recall)}s` : (touch.enabled ? '回城' : '回城 [V]'));
        if (this.dockBtns.recall.label.text !== rcLbl) this.dockBtns.recall.setLabel(rcLbl);
      }
      if (this.dockBtns.blink) {
        const bkLbl = u?.cds?.blink > 0 ? `闪现 ${Math.ceil(u.cds.blink)}s` : (touch.enabled ? '闪现' : '闪现 [X]');
        if (this.dockBtns.blink.label.text !== bkLbl) this.dockBtns.blink.setLabel(bkLbl);
      }
      if (this.dockBtns.clearGround) {
        const gCnt = s.groundItems ? s.groundItems.length : 0;
        const clLbl = gCnt > 0 ? `清地(${gCnt})` : '清地 [L]';
        if (this.dockBtns.clearGround.label.text !== clLbl) this.dockBtns.clearGround.setLabel(clLbl);
      }
    }
    const stStr = u?.recall
      ? `✦ 回城吟唱中 ${u.recall.t.toFixed(1)}s（移动打断）`
      : this.gg.attackMoveMode
        ? '⚔ 巡攻待命：点地面/小地图沿途迎敌'
        : u?.order?.type === 'hold'
          ? '🛡 坚守原位：停步自动反击'
          : u?.order?.type === 'attackMove'
            ? '⚔ 正在巡攻前进…'
            : u?.order?.type === 'buildMove'
              ? '🔨 正在前往地基建造…'
              : '';
    setTxt(this.stanceTag, stStr);
    this.stanceTag.setColor(u?.recall ? '#7fe3ff' : this.gg.attackMoveMode || u?.order?.type === 'attackMove' ? '#ff8a7a' : u?.order?.type === 'buildMove' ? '#ffc977' : '#7fe3ff');

    // 新手 3 步闭环引导
    if (!this.guideDone && this.guideC.visible) {
      if (!this.guideMoved && Math.hypot(s.hero.x - this.guideStartPos.x, s.hero.y - this.guideStartPos.y) > 45) this.guideMoved = true;
      const built = s.buildings.some((b) => b.alive);
      if (this.guideMoved && built && s.wave.n >= 2) {
        this.guideDone = true;
        this.guideC.setVisible(false);
      } else if (!this.guideMoved) {
        setTxt(this.guideBody, '①移动英雄：右键/左键点地、点小地图或按WASD均可移动');
      } else if (!built) {
        setTxt(this.guideBody, '②完成首道军令：点右侧「指引→」或按G筑一座箭楼');
      } else {
        setTxt(this.guideBody, '③停步自动普攻！点右侧「指引→」追踪军令，守住孔明');
      }
    }

    this.drawMinimap();
    this.updateAvatars(g);
    this.updateSkills(g);
    if (this.panel && this.panel.obj.refresh) this.panel.obj.refresh();
    for (const w2 of this.widgets) if (w2.refresh) w2.refresh();
  }

  drawKmArrow(hit) {
    const eg = this.edgeG.clear();
    const s = this.sim;
    const cam = this.gg.cameras.main;
    const km = s.kongming;
    const sx = km.x - cam.scrollX;
    const sy = km.y - 60 - cam.scrollY;
    const off = sx < 0 || sx > 1280 || sy < 0 || sy > 720;
    // 屏外：孔明方向箭头（遇袭时红色闪烁）
    if (off) {
      const a = Math.atan2(sy - 360, sx - 640);
      const ex = 640 + Math.cos(a) * 560;
      const ey = 360 + Math.sin(a) * 290;
      const col = hit ? 0xff3a2a : 0xffc977;
      const al = hit ? 0.6 + Math.sin(s.t * 20) * 0.4 : 0.8;
      eg.fillStyle(col, al).fillTriangle(ex + Math.cos(a) * 26, ey + Math.sin(a) * 26, ex + Math.cos(a + 2.4) * 18, ey + Math.sin(a + 2.4) * 18, ex + Math.cos(a - 2.4) * 18, ey + Math.sin(a - 2.4) * 18);
      eg.fillStyle(INK_N, 0.8).fillCircle(ex - Math.cos(a) * 18, ey - Math.sin(a) * 18, 13);
      eg.fillStyle(col, al).fillCircle(ex - Math.cos(a) * 18, ey - Math.sin(a) * 18, 9);
    }
    // 屏外靠近孔明的妖物：屏幕边缘红点
    let n = 0;
    for (const e of s.enemies) {
      if (!e.alive || e.realm || n > 24) continue;
      if ((e.x - km.x) ** 2 + (e.y - km.y) ** 2 > BAL.kongming.alertRange ** 2) continue;
      const ex = e.x - cam.scrollX;
      const ey = e.y - cam.scrollY;
      if (ex > 0 && ex < 1280 && ey > 0 && ey < 720) continue;
      eg.fillStyle(0xff4a3a, 0.85).fillCircle(Phaser.Math.Clamp(ex, 8, 1272), Phaser.Math.Clamp(ey, 8, 712), 5);
      n++;
    }
    // 屏外军令追踪目标方向金箭
    const qg = this.gg.questGuide;
    if (qg) {
      const qx = qg.x - cam.scrollX;
      const qy = qg.y - cam.scrollY;
      if (qx < 20 || qx > 1260 || qy < 20 || qy > 700) {
        const a = Math.atan2(qy - 360, qx - 640);
        const ex = 640 + Math.cos(a) * 520;
        const ey = 360 + Math.sin(a) * 260;
        const al = 0.72 + Math.sin(s.t * 8) * 0.25;
        eg.fillStyle(0xffd36a, al).fillTriangle(ex + Math.cos(a) * 24, ey + Math.sin(a) * 24, ex + Math.cos(a + 2.35) * 16, ey + Math.sin(a + 2.35) * 16, ex + Math.cos(a - 2.35) * 16, ey + Math.sin(a - 2.35) * 16);
      }
    }
  }

  drawMinimap() {
    const s = this.sim;
    const x = this.miniX; const y = this.miniY; const w = this.miniW; const h = this.miniH;
    const sx = w / BAL.world.w; const sy = h / BAL.world.h;

    // 静态地形底图（秘境区块/路线/营地/复活泉）：只在秘境开启/通关状态变化时重绘
    const R = s.realms;
    const staticSig = `${R ? R.hiddenOpen : 0}|${R ? Object.values(R.state).join('') : ''}`;
    if (staticSig !== this._miniStaticSig && this.miniBg) {
      this._miniStaticSig = staticSig;
      const bg = this.miniBg.clear();
      bg.fillStyle(0x12173a).fillRect(x, y, w, h);
      for (const r of [...REALMS, HIDDEN, ...EXTRA_REALMS]) {
        if (r.hidden && !R?.hiddenOpen) continue;
        const [a, b, c, d] = r.rect;
        const done = R && R.state[r.id] === 'cleared';
        bg.fillStyle(r.color, done ? 0.18 : 0.4).fillRect(x + a * sx, y + b * sy, (c - a) * sx, (d - b) * sy);
      }
      if (s.map.trainingRoom) {
        const [a, b, c, d] = s.map.trainingRoom.rect;
        bg.fillStyle(0x5fe08a, 0.38).fillRect(x + a * sx, y + b * sy, (c - a) * sx, (d - b) * sy);
      }
      if (s.map.bossRoom) {
        const [a, b, c, d] = s.map.bossRoom.rect;
        bg.fillStyle(0xff6a5a, 0.42).fillRect(x + a * sx, y + b * sy, (c - a) * sx, (d - b) * sy);
      }
      if (s.map.banditCamp) {
        const bc = s.map.banditCamp;
        bg.fillStyle(0xff7a3a, 0.85).fillCircle(x + bc.x * sx, y + bc.y * sy, 4);
      }
      if (s.map.hunterCamp) {
        const hc = s.map.hunterCamp;
        bg.fillStyle(0x5fe08a, 0.85).fillCircle(x + hc.x * sx, y + hc.y * sy, 4);
      }
      bg.lineStyle(3, 0x6b5640, 0.8);
      for (const p of Object.values(s.map.lanes)) { bg.beginPath(); bg.moveTo(x + p[0][0] * sx, y + p[0][1] * sy); for (const q of p) bg.lineTo(x + q[0] * sx, y + q[1] * sy); bg.strokePath(); }
      const rp = s.getRevivePoint();
      if (rp) {
        const rx = x + rp.x * sx; const ry = y + rp.y * sy;
        bg.fillStyle(0x7fe3ff, 0.85).fillCircle(rx, ry, 3.2);
        bg.lineStyle(1, 0xffffff, 0.9).strokeCircle(rx, ry, 5);
      }
      if (s.nanhua) bg.fillStyle(0x7fe3ff).fillCircle(x + s.nanhua.x * sx, y + s.nanhua.y * sy, 3.2);
      bg.fillStyle(0xffc977).fillCircle(x + s.kongming.x * sx, y + s.kongming.y * sy, 4);
      bg.lineStyle(2, INK_N).strokeRect(x, y, w, h);
    }

    // 动态实体层：每 3 帧或镜头移动明显时刷新（60fps -> ~20Hz，视觉无感、CPU 大幅减负）
    const cam = this.gg.cameras.main.worldView;
    this._hudFrame = (this._hudFrame || 0) + 1;
    const camMoved = Math.abs(cam.x - this._lastCamX) > 32 || Math.abs(cam.y - this._lastCamY) > 32;
    if (this._hudFrame % 3 !== 0 && !camMoved && this._hudFrame > 2) return;
    this._lastCamX = cam.x;
    this._lastCamY = cam.y;

    const m = this.mini.clear();
    const gItems = s.groundItems || [];
    for (let i = 0; i < gItems.length; i++) {
      const gd = gItems[i];
      m.fillStyle(gd.unique ? 0xffd36a : 0x9ff0b8).fillCircle(x + gd.x * sx, y + gd.y * sy, gd.unique ? 2.4 : 1.5);
    }
    for (let i = 0; i < s.buildings.length; i++) {
      const b = s.buildings[i];
      if (b.alive) m.fillStyle(0x7fe3ff).fillRect(x + b.x * sx - 1.5, y + b.y * sy - 1.5, 3, 3);
    }
    const eStride = s.enemies.length > 350 ? 3 : s.enemies.length > 150 ? 2 : 1;
    for (let i = 0; i < s.enemies.length; i++) {
      const e = s.enemies[i];
      if (!e.alive) continue;
      if (eStride > 1 && !e.boss && !e.elite && (i % eStride !== 0)) continue;
      m.fillStyle(e.boss ? 0xb05aff : 0xe0463a).fillRect(x + e.x * sx - 1, y + e.y * sy - 1, e.boss ? 5 : 2, e.boss ? 5 : 2);
    }
    for (let i = 0; i < s.units.length; i++) {
      const u = s.units[i];
      if (u.alive && u.kind !== 'kongming') m.fillStyle(u.ctrl ? 0xffffff : (u.kind === 'summon' ? 0x5fe0b8 : 0x5fe08a)).fillCircle(x + u.x * sx, y + u.y * sy, u.ctrl ? 3 : 2);
    }
    m.lineStyle(1, 0xffffff, 0.6).strokeRect(x + cam.x * sx, y + cam.y * sy, cam.width * sx, cam.height * sy);
  }

  updateAvatars(g) {
    const s = this.sim;
    for (const a of this.avatars) {
      const u = s.byId(a.id);
      if (!u) continue;
      const on = u.id === s.ctrlId;
      const sz = a.sz || 66;
      const hpRatio = u.alive ? Math.max(0, u.hp / u.maxHp) : 0;
      const hpBin = Math.round(hpRatio * 40);
      const ultReady = u.kind === 'hero' && u.energy >= BAL.hero.ultEnergy;
      const pulseBin = ultReady ? Math.floor(s.t * 8) : 0;
      const sig = `${on ? 1 : 0}|${u.alive ? 1 : 0}|${hpBin}|${ultReady ? 1 : 0}|${pulseBin}`;
      if (sig !== a.lastSig) {
        a.lastSig = sig;
        a.g.clear();
        a.g.fillStyle(INK_N).fillRoundedRect(a.x, a.y + 4, sz, sz, 11);
        a.g.fillStyle(u.kind === 'beast' ? 0x3a2f60 : u.kind === 'merc' ? 0x23304e : 0x262b5e).fillRoundedRect(a.x, a.y, sz, sz, 11);
        a.g.lineStyle(on ? 4 : 2, on ? 0xffc977 : 0x343a66).strokeRoundedRect(a.x, a.y, sz, sz, 11);
        if (on) a.g.lineStyle(7, 0xff9a3c, 0.25).strokeRoundedRect(a.x - 4, a.y - 4, sz + 8, sz + 8, 13);
        a.g.fillStyle(0x2a0f14).fillRect(a.x + 5, a.y + sz - 8, sz - 10, 5);
        a.g.fillStyle(hpRatio < 0.35 ? 0xff5a4a : 0x5fe08a).fillRect(a.x + 5, a.y + sz - 8, (sz - 10) * hpRatio, 5);
        if (ultReady) a.g.lineStyle(3, 0xffd36a, 0.5 + Math.sin(s.t * 6) * 0.4).strokeRoundedRect(a.x - 2, a.y - 2, sz + 4, sz + 4, 12);
      }
      const alpha = u.alive ? 1 : 0.3;
      if (a.img.alpha !== alpha) a.img.setAlpha(alpha);
      const downTxt = u.alive ? '' : `${Math.ceil(u.downT)}`;
      if (a.down.text !== downTxt) a.down.setText(downTxt);
    }
  }

  updateSkills(g) {
    const s = this.sim;
    const u = s.ctrl;
    if (!u || !this.skillSlots) return;
    if (this.atkHeld && u.alive && !this.modal && !this.gg.paused && !this.gg.panelPaused && (u.cds?.atk || 0) <= 0) {
      this.gg.cmd({ type: 'basicAttack', autoAim: true });
    }
    if (this.aimG) {
      this.aimG.clear();
      const a = this.aimState;
      if (a && a.dist > 12) {
        const col = a.cancelled ? 0xff4a3a : 0x7fe3ff;
        this.aimG.lineStyle(2.5, col, 0.75).strokeCircle(a.cx, a.cy, 58);
        const kx = a.cx + Math.cos(a.ang) * Math.min(58, a.dist);
        const ky = a.cy + Math.sin(a.ang) * Math.min(58, a.dist);
        this.aimG.lineStyle(3, col, 0.85).lineBetween(a.cx, a.cy, kx, ky);
        this.aimG.fillStyle(col, 0.9).fillCircle(kx, ky, 10);
        // 取消施法区（736, 474，大号技能轮盘左上方，零重叠）
        this.aimG.fillStyle(a.cancelled ? 0xc02020 : 0x241428, a.cancelled ? 0.92 : 0.8).fillCircle(736, 474, 46);
        this.aimG.lineStyle(2.5, a.cancelled ? 0xff6a5a : 0x9aa3cf, 0.95).strokeCircle(736, 474, 46);
        if (this.cancelLabel) this.cancelLabel.setVisible(true);
      } else if (this.cancelLabel) {
        this.cancelLabel.setVisible(false);
      }
    }
    if (this.sumBlink) {
      const bcd = u.cds?.blink > 0 ? `${Math.ceil(u.cds.blink)}s` : (touch.enabled ? '拖动' : 'X');
      if (this.sumBlink.cdTxt.text !== bcd) this.sumBlink.cdTxt.setText(bcd);
    }
    if (this.sumRecall) {
      const rcd = u.recall ? `${u.recall.t.toFixed(1)}s` : (u.cds?.recall > 0 ? `${Math.ceil(u.cds.recall)}s` : (touch.enabled ? '回坛' : 'V'));
      if (this.sumRecall.cdTxt.text !== rcd) this.sumRecall.cdTxt.setText(rcd);
    }
    for (const sl of this.skillSlots) {
      const skLv = u.kind === 'hero' && u.skillLvs ? (u.skillLvs[sl.slot] ?? 0) : 1;
      const locked = u.kind === 'hero' && skLv <= 0;
      let k = 0;
      let label = '';
      if (locked) {
        label = sl.slot === 'u' ? '6级' : '未学';
      } else if (sl.slot === 'u') {
        k = 1 - u.energy / BAL.hero.ultEnergy;
        if (k > 0) label = `${Math.floor(u.energy)}%`;
      } else if (u.cds[sl.slot] > 0) {
        k = u.cds[sl.slot] / (sl.sk.cd * (1 - u.stats.cdr));
        label = u.cds[sl.slot] >= 1 ? String(Math.ceil(u.cds[sl.slot])) : u.cds[sl.slot].toFixed(1);
      }
      const kBin = Math.round(Math.min(1, Math.max(0, k)) * 36);
      const ultPulse = (!locked && sl.slot === 'u' && k <= 0) ? Math.floor(s.t * 8) : 0;
      const cdSig = `${locked ? 1 : 0}|${kBin}|${u.awakened ? 1 : 0}|${ultPulse}`;
      if (cdSig !== sl._cdSig) {
        sl._cdSig = cdSig;
        const cg = sl.cd.clear();
        if (locked) {
          cg.fillStyle(0x05061a, 0.72).fillCircle(sl.cx, sl.cy, sl.size / 2 - 1);
        } else if (k > 0) {
          cg.fillStyle(0x05061a, 0.72);
          cg.slice(sl.cx, sl.cy, sl.size / 2 - 1, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k), false).fillPath();
        } else if (sl.slot === 'u') {
          const aw = !!u.awakened;
          cg.lineStyle(aw ? 5 : 4, aw ? 0xff9a3c : 0xffd36a, 0.65 + Math.sin(s.t * 6) * 0.35).strokeCircle(sl.cx, sl.cy, sl.size / 2 + 4);
        }
      }
      if (sl.cdt.text !== label) sl.cdt.setText(label);
      const lblCol = locked ? '#9aa3cf' : '#ffffff';
      if (sl.cdt.style.color !== lblCol) sl.cdt.setColor(lblCol);
      const icAlpha = !u.alive ? 0.35 : locked ? 0.25 : 1;
      if (sl.icon.alpha !== icAlpha) sl.icon.setAlpha(icAlpha);
      if (sl.slot === 'u' && sl.nameTag) {
        const nm = u.awakened ? `觉醒·${sl.sk.name.slice(0, 2)}` : `大·${sl.sk.name.slice(0, 2)}`;
        if (sl.nameTag.text !== nm) sl.nameTag.setText(nm).setColor(u.awakened ? '#ff9a3c' : '#ffd36a');
      }
      const lvStr = skLv > 0 ? `L${skLv}` : '';
      if (sl.lvTxt && sl.lvTxt.text !== lvStr) sl.lvTxt.setText(lvStr);
      const canUp = u.kind === 'hero' && s.canUpgradeSkill && s.canUpgradeSkill(u, sl.slot);
      if (sl.upBg && sl.upBg.visible !== canUp) {
        sl.upBg.setVisible(canUp);
        sl.upTxt.setVisible(canUp);
        sl.upHit.setVisible(canUp);
      }
    }
    if (this.spBadge) {
      const sp = u.kind === 'hero' ? (u.skillPoints || 0) : 0;
      const txt = sp > 0 ? `✦ 技能点 +${sp}` : '';
      if (this.spBadge.text !== txt) this.spBadge.setText(txt);
    }
  }

  // ---------------- 提示 ----------------
  banner(text, color = '#ffc977', big = false) {
    const t = this.bannerText;
    this.tweens.killTweensOf(t);
    t.setText(text).setColor(color).setFontSize(big ? 54 : 38).setAlpha(0).setScale(0.8);
    this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 260, ease: 'Back.easeOut', yoyo: true, hold: big ? 1600 : 1100 });
  }

  toast(text, color = '#f3e6c8') {
    const t = this.toastText;
    this.tweens.killTweensOf(t);
    t.setText(text).setColor(color).setAlpha(1).setY(594); // 放在面板下沿之外，避免压住面板说明文字
    this.tweens.add({ targets: t, alpha: 0, y: 578, delay: 1100, duration: 400 });
  }

  tip(text) { this.toast(text, '#d8d2f5'); }

  alertPulse() {
    this.alertText.setScale(1.3);
    this.tweens.add({ targets: this.alertText, scale: 1, duration: 300, ease: 'Back.easeOut' });
  }

  // ---------------- 面板 ----------------
  hotkey(k) {
    if (k === 'k') { this.togglePanel('bag', { tab: 'craft' }); return; }
    const P = PANELS.find((p) => p.key === k);
    if (P) this.togglePanel(P.name);
  }

  togglePanel(name, arg) {
    if (this.modal) return;
    const obj = this.panelObjs[name];
    if (!obj) return;
    if (this.panel && this.panel.name === name && !arg) { this.closePanel(); return; }
    this.closePanel();
    this.panel = { name, obj };
    this.gg.panelPaused = PAUSE_PANELS.has(name);
    if (touch.enabled) setTouchVisible(false);
    if (obj.open) obj.open(arg);
    obj.c.setVisible(true);
    popIn(this, obj.c);
    sfx('click');
  }

  closePanel() {
    if (!this.panel) return;
    const { obj } = this.panel;
    if (obj.close) obj.close();
    obj.c.setVisible(false);
    this.panel = null;
    this.gg.panelPaused = false;
    if (touch.enabled && !this.modal && !this.gg.paused && !this.sim.over) setTouchVisible(true, { dash: false, guard: true });
  }

  foundationClick(f) {
    if (this.panelObjs.build) { this.closePanel(); this.togglePanel('build', f); } else this.toast('地基：建造系统未接入');
  }

  // 返回 true 表示按键被 HUD 吃掉（菜单/结算/面板）
  captureKey(e) {
    if (this.modal === 'result') {
      if (e.key === 'Enter' || e.key === ' ') this.restart();
      return true;
    }
    if (this.modal === 'pause') {
      if (e.key === 'Escape') this.togglePause();
      return true;
    }
    if (this.panel && e.key === 'Escape') { this.closePanel(); return true; }
    if (this.panel && this.panel.obj.key && this.panel.obj.key(e)) return true;
    return false;
  }

  // ---------------- 系统菜单（暂停） ----------------
  togglePause() {
    if (this.modal === 'result') return;
    if (this.modal === 'pause') {
      this.pauseC.destroy();
      this.modal = null;
      this.gg.paused = false;
      if (touch.enabled) setTouchVisible(true, { dash: false, guard: true });
      return;
    }
    this.closePanel();
    this.modal = 'pause';
    this.gg.paused = true;
    setTouchVisible(false);
    const root = this.add.container(640, 360).setDepth(100);
    const dim = this.add.rectangle(0, 0, 1280, 720, 0x05061a, 0.72).setInteractive();
    const box = this.add.container(0, 0);
    const p = drawPanel(this.add.graphics(), -250, -255, 500, 510, { glow: 0xff9a3c });
    const t = this.add.text(0, -210, '暂 停', st(50, '#ffc977', TF, { strokeThickness: 7 })).setOrigin(0.5);
    const sub = this.add.text(0, -158, `第 ${this.sim.wave.n} 波 · 孔明 ${Math.ceil(this.sim.kongming.hp)} / ${this.sim.kongming.maxHp}`, st(15, '#d8d2f5')).setOrigin(0.5);
    const saveNote = this.add.text(0, -140, '', st(13, '#9ff0b8')).setOrigin(0.5);
    const muteBtn = makeButton(this, 0, 62, 300, 46, isMuted() ? '声音：关' : '声音：开', () => {
      setMuted(!isMuted());
      muteBtn.setLabel(isMuted() ? '声音：关' : '声音：开');
    }, { size: 20 });

    const getFeel = () => (this.gg.feel ? this.gg.feel.getSettings() : loadFeelSettings());
    const setFeel = (patch) => (this.gg.feel ? this.gg.feel.setSettings(patch) : saveFeelSettings({ ...getFeel(), ...patch }));
    const fmtShake = (v) => {
      if (v <= 0.05) return '震屏强度：0%（关）';
      if (v <= 0.6) return '震屏强度：50%';
      if (v < 0.9) return `震屏强度：${Math.round(v * 100)}%`;
      return '震屏强度：100%';
    };
    const feelInit = getFeel();
    const shakeBtn = makeButton(this, 0, 114, 300, 44, fmtShake(feelInit.shakeStrength), () => {
      const cur = getFeel().shakeStrength;
      const next = cur <= 0.05 ? 0.5 : cur <= 0.6 ? 1.0 : 0;
      const updated = setFeel({ shakeStrength: next });
      shakeBtn.setLabel(fmtShake(updated.shakeStrength));
    }, { size: 18, font: BF });
    const flashBtn = makeButton(this, 0, 166, 300, 44, `减弱闪光：${feelInit.reduceFlash ? '开' : '关'}`, () => {
      const cur = getFeel().reduceFlash;
      const updated = setFeel({ reduceFlash: !cur });
      flashBtn.setLabel(`减弱闪光：${updated.reduceFlash ? '开' : '关'}`);
    }, { size: 18, font: BF });

    box.add([p, t, sub, saveNote,
      makeButton(this, 0, -102, 300, 46, '继续（Esc）', () => this.togglePause(), { primary: true, size: 21 }),
      makeButton(this, 0, -47, 300, 46, '重新开始', () => this.restart(), { size: 21 }),
      makeButton(this, 0, 8, 300, 46, '手动存档', () => { const r = this.gg.manualSave(); if (r && r.ok) saveNote.setText(`已存档 · 第 ${r.meta.wave} 波 · ${fmtTime(r.meta.t)}`); }, { size: 21 }),
      muteBtn,
      shakeBtn,
      flashBtn,
      makeButton(this, 0, 218, 300, 46, '回标题', () => this.toTitle(), { size: 20 })]);
    root.add([dim, box]);
    popIn(this, box);
    this.pauseC = root;
  }

  // ---------------- 结算 ----------------
  showResult() {
    if (this.modal === 'result') return;
    this.closePanel();
    if (this.pauseC) { this.pauseC.destroy(); this.pauseC = null; }
    this.modal = 'result';
    setTouchVisible(false);
    const s = this.sim;
    const o = s.over;
    const best = recordRun({ heroId: s.heroId, mode: s.mode, win: o.win, wave: o.wave });
    const save = loadGuardSave();
    const root = this.add.container(640, 360).setDepth(100);
    const dim = this.add.rectangle(0, 0, 1280, 720, 0x05061a, 0.78).setInteractive();
    const c = this.add.container(0, 0);
    const p = drawPanel(this.add.graphics(), -420, -310, 840, 620, { glow: o.win ? 0xffc977 : 0xe0463a });
    const title = this.add.text(0, -252, o.win ? '天 明 灯 存' : (s.mode === 'endless' ? '镇 夜 终 了' : '灯 灭 · 孔 明 陨'), st(58, o.win ? '#ffc977' : '#ff8a7a', TF, { strokeThickness: 8 })).setOrigin(0.5);
    const why = this.add.text(0, -188, o.win ? `${s.mode === 'story' ? '剧情模式' : '无尽模式'} · 第 ${o.wave} 波 · 夜帝·无光 已伏诛` : o.reason, st(17, '#d6d0f0', BF, { align: 'center', wordWrap: { width: 760, useAdvancedWrap: true } })).setOrigin(0.5);
    c.add([p, title, why]);
    // 队伍
    const team = [s.kongming, ...s.party.map((id) => s.byId(id)).filter(Boolean)].slice(0, 7);
    team.forEach((u, i) => {
      const img = this.add.image(-((team.length - 1) * 80) / 2 + i * 80, -110, unitPortrait(u)).setOrigin(0.5, 0.5);
      img.setScale(Math.min(80 / img.height, 76 / img.width));
      c.add(img);
    });
    const st2 = s.stats;
    const rows = [
      ['守住波数', `${o.wave}${s.mode === 'story' ? ` / ${BAL.waves.storyLast}` : ''}`], ['用时', fmtTime(o.t)],
      ['击杀妖物', fmtNum(st2.kills)], ['BOSS 击杀', String(st2.bossKills)],
      ['收服四圣兽', `${s.units.filter((u) => u.kind === 'beast' && ['xuanwu', 'baihu', 'zhuque', 'qinglong'].includes(u.key)).length} / 4`], ['建筑', String(s.buildings.filter((b) => b.alive).length)],
      ['完成军令', String(s.quests ? s.quests.done : 0)], ['最高套装', s.bestSetText ? s.bestSetText() : '—'],
      ['孔明剩余', `${Math.round(Math.max(0, s.kongming.hp) / s.kongming.maxHp * 100)}%`], ['种子', String(s.seed)],
    ];
    rows.forEach(([a, b], i) => {
      const x = i % 2 === 0 ? -360 : 30;
      const y = -52 + Math.floor(i / 2) * 36;
      c.add(this.add.text(x, y, a, st(17, '#d8d2f5')));
      c.add(this.add.text(x + 330, y, b, st(17, '#ffc977', NF, { fontStyle: 'bold' })).setOrigin(1, 0));
    });
    const rec = s.mode === 'story' ? `剧情最远 第 ${save.storyBest} 波 · 通关 ${save.storyWins} 次` : `无尽最高 第 ${save.endlessBest} 波`;
    c.add(this.add.text(0, 148, (best ? '新纪录！ ' : '') + rec, st(16, best ? '#ffd36a' : '#9aa3cf')).setOrigin(0.5));
    c.add(makeButton(this, -250, 228, 224, 56, '再守一夜', () => this.restart(), { primary: true, size: 23 }));
    c.add(makeButton(this, 0, 228, 224, 56, '换英雄', () => this.toSelect(), { size: 23 }));
    c.add(makeButton(this, 250, 228, 224, 56, '回标题', () => this.toTitle(), { size: 23 }));
    c.add(this.add.text(0, 280, 'Enter 再守一夜', st(13, '#7f86b8')).setOrigin(0.5));
    root.add([dim, c]);
    popIn(this, c);
    sfx(o.win ? 'chest' : 'death');
  }

  restart() { this.scene.stop(); this.gg.scene.restart({ heroId: this.sim.heroId, mode: this.sim.mode }); }
  toSelect() { this.scene.stop(); this.gg.scene.start('GuardSelect'); }
  toTitle() { this.scene.stop(); this.gg.scene.start('Title'); }

  playtestState() {
    if (this.modal === 'result') return 'result';
    if (this.modal === 'pause') return 'paused';
    if (this.panel) return `panel_${this.panel.name}`;
    return 'play';
  }
}
