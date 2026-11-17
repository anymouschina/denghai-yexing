import '@fontsource/ma-shan-zheng/index.css';
import Phaser from 'phaser';
import UP from './data/upgrades.json';
import META from './data/meta.json';
import { TITLE_TEXT } from './fonts.js';
import { Boot } from './scenes/Boot.js';
import { Title } from './scenes/Title.js';
import { Game } from './scenes/Game.js';
import { UI } from './scenes/UI.js';

const glyphs = TITLE_TEXT + UP.list.map((u) => u.name).join('') + UP.evolutions.map((e) => e.name).join('') + META.map((m) => m.name).join('');

// 不用顶层 await：构建为普通脚本，双击 dist/index.html（file://）也能运行
document.fonts.load('48px "Ma Shan Zheng"', glyphs).then(() => {
document.getElementById('loading').remove();

new Phaser.Game({
  // 双击打开（file://）时浏览器禁止 WebGL 读取本地图片，只能用 Canvas 渲染；通过 http 打开仍用 WebGL
  type: location.protocol === 'file:' ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#0b0d1c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false },
  input: { activePointers: 1 },
  loader: { imageLoadType: 'HTMLImageElement' }, // file:// 下 XHR 被拦，图片改用 <img> 加载
  scene: [Boot, Title, Game, UI],
});
});
