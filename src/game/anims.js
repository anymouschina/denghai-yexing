// 额外动画资源（Boss / 精英序列帧等）。Boot.preload 调 preloadExtra，Boot.create 调 registerAnims
// 序列帧由 asset 工具 grid 动作切出：一行 8 帧，帧尺寸见同名 .json
export const SHEETS = {
  boss_idle: { frameWidth: 236, frameHeight: 384, frames: 8, frameRate: 9 },
  jiangshi_hop: { frameWidth: 119, frameHeight: 200, frames: 8, frameRate: 9 },
};

export function preloadExtra(scene) {
  for (const [key, s] of Object.entries(SHEETS)) {
    scene.load.spritesheet(key, `assets/anim/${key}.png`, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
  }
}

export function registerAnims(scene) {
  scene.anims.create({ key: 'run', frames: scene.anims.generateFrameNumbers('hero_run', { start: 0, end: 11 }), frameRate: 18, repeat: -1 });
  for (const [key, s] of Object.entries(SHEETS)) {
    if (!scene.textures.exists(key)) continue;
    scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(key, { start: 0, end: s.frames - 1 }), frameRate: s.frameRate, repeat: -1 });
  }
}
