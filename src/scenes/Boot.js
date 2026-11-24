import Phaser from 'phaser';
import UP from '../data/upgrades.json';
import { BF } from '../fonts.js';
import { preloadExtra, registerAnims } from '../game/anims.js';
import { makeFxTextures } from '../game/fxTextures.js';

const IMAGES = [
  'hero', 'boss', 'field', 'title_keyart', 'enemy_paperman', 'enemy_foxfire', 'enemy_lanternyokai', 'enemy_jiangshi',
  'enemy_firecracker', 'proj_talisman', 'proj_flame', 'proj_ghostfire', 'fx_thunder', 'fx_boom',
  'drop_soul', 'drop_coin', 'drop_oil', 'drop_chest', 'field_lantern',
];

export class Boot extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    const bar = this.add.graphics();
    const label = this.add.text(640, 400, '灯火点燃中… 0%', { fontFamily: BF, fontSize: '20px', color: '#ffc977' }).setOrigin(0.5);
    this.load.on('progress', (v) => {
      bar.clear().fillStyle(0x1f2a52).fillRoundedRect(440, 350, 400, 14, 7).fillStyle(0xff9a3c).fillRoundedRect(440, 350, 400 * v, 14, 7);
      label.setText(`灯火点燃中… ${Math.round(v * 100)}%`);
    });
    for (const k of IMAGES) this.load.image(k, `assets/${k}.${k === 'field' || k === 'title_keyart' ? 'jpg' : 'png'}`);
    for (const u of [...UP.list, ...UP.evolutions]) this.load.image(`icon_${u.icon}`, `assets/icons/${u.icon}.png`);
    for (const k of ['huanhun', 'qiantong']) this.load.image(`icon_${k}`, `assets/icons/${k}.png`);
    this.load.spritesheet('hero_run', 'assets/hero_run.png', { frameWidth: 152, frameHeight: 192 });
    preloadExtra(this);
  }

  create() {
    this.makeTextures();
    makeFxTextures(this);
    registerAnims(this);
    this.scene.start('Title');
  }

  canvas(key, w, h, draw) {
    const t = this.textures.createCanvas(key, w, h);
    draw(t.getContext(), w, h);
    t.refresh();
  }

  makeTextures() {
    const radial = (c, w, h, stops) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) / 2);
      for (const [o, col] of stops) g.addColorStop(o, col);
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    };
    this.canvas('glow', 64, 64, (c, w, h) => radial(c, w, h, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]));
    this.canvas('fog', 256, 256, (c, w, h) => radial(c, w, h, [[0, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]));
    this.canvas('dot', 12, 12, (c) => { c.fillStyle = '#fff'; c.beginPath(); c.arc(6, 6, 5, 0, Math.PI * 2); c.fill(); });
    this.canvas('paper', 12, 9, (c) => { c.fillStyle = '#fff'; c.fillRect(0, 0, 12, 9); c.strokeStyle = '#0b0d18'; c.lineWidth = 2; c.strokeRect(1, 1, 10, 7); });
    this.canvas('ring', 128, 128, (c) => { c.strokeStyle = '#fff'; c.lineWidth = 6; c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.stroke(); });
    // 夜色：屏幕中心（主角灯笼）留一圈亮，四周压暗
    this.canvas('night', 1280, 720, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2 + 10, 120, w / 2, h / 2 + 10, 760);
      g.addColorStop(0, 'rgba(6,8,26,0)');
      g.addColorStop(0.3, 'rgba(6,8,26,0.2)');
      g.addColorStop(0.65, 'rgba(6,8,26,0.55)');
      g.addColorStop(1, 'rgba(4,5,16,0.82)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    // 标题页左侧压暗
    this.canvas('shade', 1280, 720, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(10,12,30,0.94)');
      g.addColorStop(0.36, 'rgba(10,12,30,0.66)');
      g.addColorStop(0.62, 'rgba(10,12,30,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      const v = c.createLinearGradient(0, h * 0.7, 0, h);
      v.addColorStop(0, 'rgba(10,12,30,0)');
      v.addColorStop(1, 'rgba(10,12,30,0.7)');
      c.fillStyle = v;
      c.fillRect(0, 0, w, h);
    });
  }
}
