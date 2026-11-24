import '@fontsource/ma-shan-zheng/index.css';
import Phaser from 'phaser';
import UP from './data/upgrades.json';
import META from './data/meta.json';
import { TITLE_TEXT } from './fonts.js';
import { Boot } from './scenes/Boot.js';
import { Title } from './scenes/Title.js';
import { Game } from './scenes/Game.js';
import { UI } from './scenes/UI.js';
import { GuardSelect } from './guard/scenes/GuardSelect.js';
import { GuardGame } from './guard/scenes/GuardGame.js';
import { GuardHUD } from './guard/scenes/GuardHUD.js';
import { guardSnapshot, guardDebug } from './guard/playtest.js';
import { initTouch, touch } from './touch.js';

const glyphs = TITLE_TEXT + UP.list.map((u) => u.name).join('') + UP.evolutions.map((e) => e.name).join('') + META.map((m) => m.name).join('');

// 不用顶层 await：构建为普通脚本，双击 dist/index.html（file://）也能运行
document.fonts.load('48px "Ma Shan Zheng"', glyphs).then(() => {
document.getElementById('loading').remove();

initTouch();

const game = new Phaser.Game({
  // 双击打开（file://）时浏览器禁止 WebGL 读取本地图片，只能用 Canvas 渲染；通过 http 打开仍用 WebGL
  type: location.protocol === 'file:' ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#0b0d1c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false },
  input: { activePointers: 3 },
  disableContextMenu: true,
  loader: { imageLoadType: 'HTMLImageElement' }, // file:// 下 XHR 被拦，图片改用 <img> 加载
  scene: [Boot, Title, Game, UI, GuardSelect, GuardGame, GuardHUD],
});

// 视口变化（旋转、地址栏收起、visualViewport 缩放）后重新计算 FIT 尺寸；iOS 旋转后尺寸要等一帧才稳定
const refit = () => { game.scale.refresh(); setTimeout(() => game.scale.refresh(), 250); };
window.addEventListener('orientationchange', refit);
window.addEventListener('resize', refit);
if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);

// 自动化试玩钩子：只在 URL 带 tapcanvasPlaytest=1 时挂上
if (new URLSearchParams(location.search).get('tapcanvasPlaytest') === '1') {
  globalThis.__TAPCANVAS_PLAYTEST__ = {
    // 仅自动化验收用：把当前血量压到 n，让后面的死亡走真实受击流程（headless 低帧率下自然死亡要很久）
    setHp(n) { const g = game.scene.getScene('Game'); if (g && g.p) g.p.hp = n; },
    guard: guardDebug(game),
    snapshot() {
      const gs = guardSnapshot(game);
      if (gs) return gs;
      const sc = game.scene;
      const ui = sc.getScene('UI');
      const g = sc.getScene('Game');
      const kind = ui && ui.modal ? ui.modal.kind : null;
      let scene = 'boot';
      if (sc.isActive('Title') || sc.isPaused('Title')) scene = 'title';
      if (g && g.p && (sc.isActive('Game') || sc.isPaused('Game'))) {
        scene = kind === 'choice' ? 'levelup' : kind === 'pause' ? 'pause' : kind === 'result' ? 'result' : g.over ? 'dying' : 'game';
      }
      const p = g && g.p;
      return {
        scene, hp: p ? Math.round(p.hp) : 0, maxHp: p ? p.maxHp : 0, level: g ? g.level : 0, kills: g ? g.kills : 0,
        t: g ? Math.round(g.t * 10) / 10 : 0, enemies: g && g.enemies ? g.enemies.length : 0, x: p ? Math.round(p.x) : 0, y: p ? Math.round(p.y) : 0,
        dashCd: p ? Math.round(p.dashCdLeft * 100) / 100 : 0, stick: Math.round(touch.mag * 100) / 100, touch: touch.enabled,
      };
    },
  };
}
});
