// 可复用角色 16 帧精灵图加载/烘焙器与动作状态机（Phaser 渲染层）：
// 1) 优先原生加载多姿态 4x4 精灵图（public/assets/guard/sheets/<key>.png + .json）：
//      Row 1 (0-3):   idle   （呼吸待机）
//      Row 2 (4-7):   walk   （4 帧奔跑循环）
//      Row 3 (8-11):  attack （4 帧蓄力挥砍/发射）
//      Row 4 (12-13): cast/ult（聚能施法/大招爆发）
//      Row 4 (14):    hurt   （受击后仰）
//      Row 4 (15):    dead   （倒地阵亡）
// 2) 若某单位尚未提供原生多姿态图集，自动回退为单帧立绘烘焙 16 帧 canvas SpriteSheet，保持全单位动作闭环。
import { resolveNativeSheet } from '../assets.js';

const SHEET_CACHE = new Set();
const DEFAULT_NATIVE_ANIMS = {
  idle: { start: 0, end: 3, frameRate: 6, repeat: -1 },
  walk: { start: 4, end: 7, frameRate: 12, repeat: -1 },
  attack: { start: 8, end: 11, frameRate: 14, repeat: 0 },
  cast: { start: 12, end: 13, frameRate: 12, repeat: 0 },
  ult: { start: 12, end: 13, frameRate: 12, repeat: 0 },
  hurt: { start: 14, end: 14, frameRate: 12, repeat: 0 },
  dead: { start: 15, end: 15, frameRate: 8, repeat: 0 },
};

function drawPose(ctx, img, cx, cy, fw, fh, pose) {
  ctx.save();
  // 底部锚点（脚底）
  const footY = cy + fh * 0.44;
  ctx.translate(cx + (pose.dx || 0), footY + (pose.dy || 0));

  // 背后能量光环（施法 / 大招）
  if (pose.aura) {
    const grad = ctx.createRadialGradient(0, -fh * 0.42, 6, 0, -fh * 0.42, fw * 0.46);
    grad.addColorStop(0, pose.aura);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, -fh * 0.42, fw * 0.46, 0, Math.PI * 2);
    ctx.fill();
  }

  // 迈步速度残影（walk / attack）
  if (pose.trail) {
    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.translate(pose.trail, 0);
    ctx.transform(pose.sx || 1, 0, pose.skew || 0, pose.sy || 1, 0, 0);
    const scale = Math.min((fw * 0.72) / img.width, (fh * 0.80) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, -dw / 2, -dh, dw, dh);
    ctx.restore();
  }

  // 主体姿态（倾斜 + 挤压拉伸 + 旋转）
  if (pose.rot) ctx.rotate(pose.rot);
  ctx.transform(pose.sx || 1, 0, pose.skew || 0, pose.sy || 1, 0, 0);
  const scale = Math.min((fw * 0.72) / img.width, (fh * 0.80) / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, -dw / 2, -dh, dw, dh);

  // 动作特效层（挥砍光弧 / 施法灵环 / 大招冲击波）
  if (pose.slash) {
    ctx.save();
    ctx.strokeStyle = pose.slash;
    ctx.lineWidth = Math.max(4, fw * 0.04);
    ctx.lineCap = 'round';
    ctx.shadowColor = pose.slash;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(fw * 0.14, -dh * 0.52, fw * 0.34, -0.95, 0.85);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, fw * 0.018);
    ctx.beginPath();
    ctx.arc(fw * 0.16, -dh * 0.52, fw * 0.32, -0.75, 0.65);
    ctx.stroke();
    ctx.restore();
  }
  if (pose.castRing) {
    ctx.save();
    ctx.strokeStyle = pose.castRing;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(fw * 0.22, -dh * 0.54, fw * 0.18, fh * 0.24, 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (pose.dust) {
    ctx.save();
    ctx.fillStyle = 'rgba(232,228,216,0.48)';
    ctx.beginPath();
    ctx.arc(-fw * 0.18, -4, 6, 0, Math.PI * 2);
    ctx.arc(-fw * 0.26, -7, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

const POSES = [
  // 0-1: idle
  { sx: 1.00, sy: 1.00, skew: 0.00, dy: 0 },
  { sx: 0.99, sy: 1.028, skew: 0.015, dy: -2 },
  // 2-5: walk (4-frame stride)
  { sx: 1.05, sy: 0.94, skew: 0.09, dy: 2, dx: 2, trail: -7, dust: true },
  { sx: 0.97, sy: 1.05, skew: 0.05, dy: -7, dx: 4, trail: -5 },
  { sx: 1.05, sy: 0.94, skew: -0.04, dy: 2, dx: -1, trail: -6, dust: true },
  { sx: 0.97, sy: 1.04, skew: 0.06, dy: -6, dx: 3, trail: -5 },
  // 6-7: attack (windup -> strike)
  { sx: 0.94, sy: 1.04, skew: -0.14, dy: 2, dx: -6, rot: -0.06 },
  { sx: 1.12, sy: 0.93, skew: 0.18, dy: 0, dx: 12, rot: 0.05, trail: -10, slash: '#ffd36a' },
  // 8-9: cast (gather -> release)
  { sx: 0.95, sy: 1.07, skew: -0.06, dy: -6, aura: 'rgba(127,227,255,0.55)' },
  { sx: 1.08, sy: 0.97, skew: 0.12, dy: -2, dx: 8, aura: 'rgba(255,211,106,0.55)', castRing: '#7fe3ff' },
  // 10-11: ult (ascend -> burst)
  { sx: 0.94, sy: 1.10, skew: -0.04, dy: -12, aura: 'rgba(255,201,74,0.75)' },
  { sx: 1.14, sy: 0.95, skew: 0.14, dy: -4, dx: 10, aura: 'rgba(255,154,60,0.85)', slash: '#ff9a3c', castRing: '#ffd36a' },
  // 12-13: hurt (recoil -> recover)
  { sx: 0.92, sy: 1.06, skew: -0.18, dy: -3, dx: -10, rot: -0.12, aura: 'rgba(255,80,70,0.55)' },
  { sx: 1.04, sy: 0.96, skew: -0.06, dy: 2, dx: -4, rot: -0.04 },
  // 14-15: dead (stagger -> collapse)
  { sx: 0.96, sy: 0.92, skew: -0.22, dy: 6, dx: -10, rot: -0.42 },
  { sx: 1.08, sy: 0.72, skew: -0.15, dy: 16, dx: -14, rot: -1.18, dust: true },
];

export function isNativeSpriteSheet(sheetKey) {
  return typeof sheetKey === 'string' && sheetKey.startsWith('sheet_');
}

export function isActionSpriteSheet(sheetKey) {
  return typeof sheetKey === 'string' && (sheetKey.startsWith('sheet_') || sheetKey.startsWith('anim_'));
}

function registerSheetAnims(scene, sheetKey, animsSpec) {
  const spec = animsSpec || DEFAULT_NATIVE_ANIMS;
  for (const [name, cfg] of Object.entries(spec)) {
    const key = `${sheetKey}_${name}`;
    if (!scene.anims.exists(key)) {
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(sheetKey, { start: cfg.start, end: cfg.end }),
        frameRate: cfg.frameRate || 8,
        repeat: cfg.repeat ?? 0,
      });
    }
  }
}

/**
 * 优先解析并返回原生多姿态 16 帧精灵图；若未提供原生图集，则回退为单帧立绘烘焙 16 帧精灵图。
 */
export function ensureUnitSpriteSheet(scene, texKey, unitKey = null) {
  const native = resolveNativeSheet(scene, texKey, unitKey);
  if (native) {
    if (!SHEET_CACHE.has(native.sheetKey)) {
      registerSheetAnims(scene, native.sheetKey, native.meta?.anims || DEFAULT_NATIVE_ANIMS);
      SHEET_CACHE.add(native.sheetKey);
    }
    return native.sheetKey;
  }

  const sheetKey = `anim_${texKey}`;
  if (scene.textures.exists(sheetKey)) return sheetKey;
  if (!scene.textures.exists(texKey)) return texKey;

  const srcTex = scene.textures.get(texKey);
  const srcImg = srcTex.getSourceImage();
  if (!srcImg || !srcImg.width || !srcImg.height) return texKey;

  const fw = 180;
  const fh = 180;
  const cols = POSES.length;
  const canvas = document.createElement('canvas');
  canvas.width = fw * cols;
  canvas.height = fh;
  const ctx = canvas.getContext('2d');

  for (let i = 0; i < cols; i++) {
    drawPose(ctx, srcImg, i * fw + fw / 2, fh / 2, fw, fh, POSES[i]);
  }

  scene.textures.addSpriteSheet(sheetKey, canvas, { frameWidth: fw, frameHeight: fh });
  SHEET_CACHE.add(sheetKey);

  const mk = (name, start, end, frameRate, repeat) => {
    const key = `${sheetKey}_${name}`;
    if (!scene.anims.exists(key)) {
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(sheetKey, { start, end }),
        frameRate,
        repeat,
      });
    }
  };
  mk('idle', 0, 1, 5, -1);
  mk('walk', 2, 5, 12, -1);
  mk('attack', 6, 7, 14, 0);
  mk('cast', 8, 9, 12, 0);
  mk('ult', 10, 11, 12, 0);
  mk('hurt', 12, 13, 12, 0);
  mk('dead', 14, 15, 8, 0);
  return sheetKey;
}

/** 驱动单位精灵按 u.action.state 切换真精灵图动作（带 seq 支持连续普攻/施法重播） */
export function playUnitActionAnim(sp, sheetKey, actionState, actionSeq = 0) {
  const map = {
    idle: 'idle',
    walk: 'walk',
    attack: 'attack',
    cast: 'cast',
    ult: 'ult',
    hurt: 'hurt',
    dead: 'dead',
    recall: 'cast',
  };
  const animName = map[actionState] || 'idle';
  const fullKey = `${sheetKey}_${animName}`;
  const isOneShot = animName === 'attack' || animName === 'cast' || animName === 'ult' || animName === 'hurt' || animName === 'dead';
  const seqChanged = isOneShot && actionSeq > 0 && sp._lastActionSeq !== actionSeq;
  if (sp.anims && (sp.anims.currentAnim?.key !== fullKey || seqChanged)) {
    sp._lastActionSeq = actionSeq;
    sp.play(fullKey, !seqChanged);
  }
}
