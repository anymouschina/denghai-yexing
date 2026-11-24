// Game Feel（打击感与镜头反馈）核心模块 — 纯 JS + Phaser 3 适配器，支持 Node 无头测试与浏览器运行
// 参考 game-feel skill：平方创伤值震屏（叠加平滑正弦，永不逐帧随机）、防重叠真实时间 Hit-Stop、Back.easeOut 挤压拉伸、WCAG 2.3.1 闪屏保护、无障碍设置持久化

export const GAME_FEEL_STORAGE_KEY = 'tapcanvas_game_feel_v1';
export const DEFAULT_DECAY = 1.35;
export const MAX_HIT_STOP_SEC = 0.14;
export const DEFAULT_FEEL_SETTINGS = Object.freeze({
  shakeStrength: 0.75,
  reduceFlash: false,
  reduceCameraMotion: false,
});

const TIER_PRESETS = {
  small: {
    trauma: 0.14,
    hitStop: 0,
    slow: 0.06,
    particles: 3,
    zoom: 0,
    flash: null,
  },
  medium: {
    trauma: 0.36,
    hitStop: 0.048,
    slow: 0.06,
    particles: 9,
    zoom: 0,
    flash: { color: 0xfff0d0, alpha: 0.1, dur: 95 },
  },
  large: {
    trauma: 0.78,
    hitStop: 0.105,
    slow: 0.06,
    particles: 26,
    zoom: 0.04,
    flash: { color: 0xffd36a, alpha: 0.22, dur: 145 },
  },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function realNowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function loadFeelSettings(overrides = null) {
  const base = { ...DEFAULT_FEEL_SETTINGS };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(GAME_FEEL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (Number.isFinite(Number(parsed.shakeStrength))) {
            base.shakeStrength = clamp(Number(parsed.shakeStrength), 0, 1);
          }
          if (typeof parsed.reduceFlash === 'boolean') {
            base.reduceFlash = parsed.reduceFlash;
          }
          if (typeof parsed.reduceCameraMotion === 'boolean') {
            base.reduceCameraMotion = parsed.reduceCameraMotion;
          }
        }
      }
    }
  } catch {
    // Node / 隐私模式忽略 storage 异常
  }
  if (overrides && typeof overrides === 'object') {
    if (Number.isFinite(Number(overrides.shakeStrength))) {
      base.shakeStrength = clamp(Number(overrides.shakeStrength), 0, 1);
    }
    if (typeof overrides.reduceFlash === 'boolean') base.reduceFlash = overrides.reduceFlash;
    if (typeof overrides.reduceCameraMotion === 'boolean') base.reduceCameraMotion = overrides.reduceCameraMotion;
  }
  return base;
}

export function saveFeelSettings(settings) {
  const clean = {
    shakeStrength: clamp(Number(settings?.shakeStrength ?? DEFAULT_FEEL_SETTINGS.shakeStrength), 0, 1),
    reduceFlash: !!settings?.reduceFlash,
    reduceCameraMotion: !!settings?.reduceCameraMotion,
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GAME_FEEL_STORAGE_KEY, JSON.stringify(clean));
    }
  } catch {
    // Node / 无存储环境静默安全返回
  }
  return clean;
}

/** 创伤线性衰减（真实未缩放 dt，保证在 1 / decay 秒内精确归零） */
export function stepTrauma(trauma, realDt, decay = DEFAULT_DECAY) {
  const cur = clamp(Number(trauma) || 0, 0, 1);
  if (cur <= 0) return 0;
  const step = Math.max(0, Number(decay) || 0) * Math.max(0, Number(realDt) || 0);
  const next = cur - step;
  return next <= 1e-6 ? 0 : next;
}

/** 平滑叠加正弦采样：0.6*sin(t*11+seed) + 0.4*sin(t*23+seed*2)，绝不逐帧随机 */
export function sampleShakeAxis(seed, t) {
  return 0.6 * Math.sin(t * 11 + seed) + 0.4 * Math.sin(t * 23 + seed * 2);
}

/** 计算平方创伤镜头偏移与滚转角；创伤为 0 时精确归零 */
export function computeShakeOffset(trauma, t, opts = {}) {
  const tr = clamp(Number(trauma) || 0, 0, 1);
  if (tr <= 0) {
    return { offsetX: 0, offsetY: 0, roll: 0, shake: 0 };
  }
  const strength = clamp(Number(opts.strength ?? 1), 0, 1);
  const shake = tr * tr * strength;
  if (shake <= 0) {
    return { offsetX: 0, offsetY: 0, roll: 0, shake: 0 };
  }
  const maxX = opts.maxOffsetX ?? 14;
  const maxY = opts.maxOffsetY ?? 9;
  const maxRoll = opts.reduceCameraMotion ? 0 : (opts.maxRoll ?? 0.045);
  const seedX = opts.seedX ?? 0.7;
  const seedY = opts.seedY ?? 3.1;
  const seedRoll = opts.seedRoll ?? 5.9;
  const nz = (v) => (v === 0 ? 0 : v);
  const ox = maxX * shake * sampleShakeAxis(seedX, t);
  const oy = maxY * shake * sampleShakeAxis(seedY, t);
  const r = opts.reduceCameraMotion ? 0 : maxRoll * shake * sampleShakeAxis(seedRoll, t);
  return {
    offsetX: nz(ox),
    offsetY: nz(oy),
    roll: nz(r),
    shake,
  };
}

export function createGameFeel(scene = null, opts = {}) {
  const settings = loadFeelSettings(opts.settings);
  const decay = Math.max(0.01, Number(opts.decay ?? DEFAULT_DECAY));
  const maxOffsetX = opts.maxOffsetX ?? 14;
  const maxOffsetY = opts.maxOffsetY ?? 9;
  const maxRoll = opts.maxRoll ?? 0.045;

  let trauma = 0;
  let time = 0;
  let simScale = 1.0;
  let inHitStop = false;
  let hitStopId = 0;
  let hitStopRemain = 0;
  let hitStopChainStartMs = -1;
  let lastAutoHitStopMs = -9999;
  const timers = new Set();
  const flashTimestamps = [];

  let flashRect = null;
  let flashTween = null;
  let zoomTween = null;
  let destroyed = false;

  const state = {
    simScale: 1.0,
    inHitStop: false,
    trauma: 0,
    shake: 0,
    offsetX: 0,
    offsetY: 0,
    roll: 0,
  };

  function clearAllTimers() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  function restoreHitStop(id) {
    if (id !== hitStopId) return false;
    simScale = 1.0;
    inHitStop = false;
    hitStopRemain = 0;
    hitStopChainStartMs = -1;
    state.simScale = 1.0;
    state.inHitStop = false;
    clearAllTimers();
    return true;
  }

  function syncSettings(patch) {
    if (patch && typeof patch === 'object') {
      if (Number.isFinite(Number(patch.shakeStrength))) {
        settings.shakeStrength = clamp(Number(patch.shakeStrength), 0, 1);
      }
      if (typeof patch.reduceFlash === 'boolean') {
        settings.reduceFlash = patch.reduceFlash;
      }
      if (typeof patch.reduceCameraMotion === 'boolean') {
        settings.reduceCameraMotion = patch.reduceCameraMotion;
        if (settings.reduceCameraMotion) {
          const cam = scene?.cameras?.main;
          if (cam) {
            if (zoomTween) { zoomTween.stop(); zoomTween = null; }
            cam.setZoom?.(1.0);
            cam.setRotation?.(0);
          }
          state.roll = 0;
        }
      }
    }
    return saveFeelSettings(settings);
  }

  function addTrauma(amount) {
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0) return trauma;
    trauma = clamp(trauma + a, 0, 1);
    state.trauma = trauma;
    return trauma;
  }

  /**
   * 真实时间 Hit-Stop（永不卡死输入/UI/震屏衰减）：
   * - _hitStopId 递增，仅最新 ID 负责恢复 simScale = 1.0（重叠命中 30ms 也不会被旧计时器提前打断）
   * - 单次 duration 钳制 <= 0.14s，连续链上限保护防连击锁死
   */
  function hitStop(duration = 0.06, slow = 0.06, hitOpts = {}) {
    if (destroyed) return false;
    const dur = clamp(Number(duration) || 0, 0, MAX_HIT_STOP_SEC);
    if (dur <= 0) return false;
    const nowMs = realNowMs();
    if (inHitStop && hitOpts.skipIfActive) return false;
    // 防高频连续命中无限延长冻结（连续链超过 240ms 自动跳过新触发，等当前自然恢复）
    if (inHitStop && hitStopChainStartMs >= 0 && nowMs - hitStopChainStartMs > 180) {
      return false;
    }

    hitStopId += 1;
    const myId = hitStopId;
    const scale = clamp(Number(slow) || 0.06, 0.01, 1.0);
    if (!inHitStop) hitStopChainStartMs = nowMs;
    inHitStop = true;
    simScale = scale;
    hitStopRemain = dur;
    state.inHitStop = true;
    state.simScale = scale;

    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!destroyed && myId === hitStopId) {
        restoreHitStop(myId);
      }
    }, Math.max(1, Math.round(dur * 1000)));
    timers.add(timer);
    return true;
  }

  /**
   * 挤压拉伸（Back.easeOut），杀掉精灵上一次 _feelPopTween 并在结束后精确还原静止缩放
   */
  function popSprite(sprite, sx = 1.26, sy = 0.74, dur = 180) {
    if (destroyed || !sprite) return null;
    const durMs = clamp(dur <= 5 ? dur * 1000 : dur, 30, 1000);
    if (sprite._feelPopTween) {
      const prev = sprite._feelPopTween;
      sprite._feelPopTween = null;
      prev.stop?.();
      prev.remove?.();
    }
    const restX = Number.isFinite(sprite._feelRestScaleX) ? sprite._feelRestScaleX : (sprite.scaleX ?? 1);
    const restY = Number.isFinite(sprite._feelRestScaleY) ? sprite._feelRestScaleY : (sprite.scaleY ?? 1);
    sprite._feelRestScaleX = restX;
    sprite._feelRestScaleY = restY;

    if (typeof sprite.setScale === 'function') {
      sprite.setScale(restX * sx, restY * sy);
    } else {
      sprite.scaleX = restX * sx;
      sprite.scaleY = restY * sy;
    }

    let tw = null;
    const restore = () => {
      if (tw && sprite._feelPopTween !== tw) return;
      if (sprite && (sprite.scene !== null)) {
        if (typeof sprite.setScale === 'function') sprite.setScale(restX, restY);
        else { sprite.scaleX = restX; sprite.scaleY = restY; }
      }
      if (sprite) {
        sprite._feelPopTween = null;
        delete sprite._feelRestScaleX;
        delete sprite._feelRestScaleY;
      }
    };

    if (!scene?.tweens?.add) {
      return null;
    }
    tw = scene.tweens.add({
      targets: sprite,
      scaleX: restX,
      scaleY: restY,
      duration: Math.max(40, durMs),
      ease: 'Back.easeOut',
      onComplete: restore,
      onStop: restore,
    });
    sprite._feelPopTween = tw;
    return tw;
  }

  /**
   * 全屏受击/爆发闪光（WCAG 2.3.1 光敏安全：1000ms 内最多 3 次；reduceFlash 开启时改用柔和静态淡染色）
   */
  function flashScreen(color = 0xffffff, alpha = 0.2, dur = 120) {
    if (destroyed) return false;
    const nowMs = realNowMs();
    while (flashTimestamps.length && nowMs - flashTimestamps[0] >= 1000) {
      flashTimestamps.shift();
    }

    const durMs = clamp(dur <= 5 ? dur * 1000 : dur, 40, 1000);
    if (settings.reduceFlash) {
      // 光敏保护：用极低透明度、缓慢平缓的静态染色替代闪烁
      if (flashRect && flashRect.visible) return false;
      const safeAlpha = clamp((Number(alpha) || 0.2) * 0.3, 0.02, 0.08);
      if (!scene?.add?.rectangle) return true;
      const cam = scene.cameras?.main;
      const w = cam?.width || 1280;
      const h = cam?.height || 720;
      if (!flashRect || !flashRect.scene) {
        flashRect = scene.add.rectangle(w / 2, h / 2, w + 40, h + 40, color, safeAlpha)
          .setScrollFactor(0).setDepth(9950);
      } else {
        flashRect.setFillStyle(color, safeAlpha).setBlendMode(0).setAlpha(safeAlpha).setVisible(true);
      }
      if (flashTween) {
        const prev = flashTween;
        flashTween = null;
        prev.stop?.();
      }
      let tw = null;
      const done = () => {
        if (tw && flashTween !== tw) return;
        if (flashRect?.scene) flashRect.setVisible(false);
        flashTween = null;
      };
      tw = scene.tweens.add({
        targets: flashRect,
        alpha: 0,
        duration: Math.max(360, durMs * 2),
        ease: 'Sine.easeOut',
        onComplete: done,
        onStop: done,
      });
      flashTween = tw;
      return true;
    }

    if (flashTimestamps.length >= 3) return false;
    flashTimestamps.push(nowMs);

    if (!scene?.add?.rectangle || !scene?.tweens?.add) return true;
    const cam = scene.cameras?.main;
    const w = cam?.width || 1280;
    const h = cam?.height || 720;
    const effAlpha = clamp(Number(alpha) || 0.18, 0.02, 0.42);
    if (!flashRect || !flashRect.scene) {
      flashRect = scene.add.rectangle(w / 2, h / 2, w + 40, h + 40, color, effAlpha)
        .setScrollFactor(0).setDepth(9950).setBlendMode('ADD');
    } else {
      flashRect.setFillStyle(color, 1).setBlendMode('ADD').setAlpha(effAlpha).setVisible(true);
    }
    if (flashTween) {
      const prev = flashTween;
      flashTween = null;
      prev.stop?.();
    }
    let tw = null;
    const done = () => {
      if (tw && flashTween !== tw) return;
      if (flashRect?.scene) flashRect.setVisible(false);
      flashTween = null;
    };
    tw = scene.tweens.add({
      targets: flashRect,
      alpha: 0,
      duration: durMs,
      ease: 'Cubic.easeOut',
      onComplete: done,
      onStop: done,
    });
    flashTween = tw;
    return true;
  }

  /** 镜头脉冲缩放（完成后精确回落 zoom = 1.0；respects reduceCameraMotion） */
  function zoomPunch(delta = 0.035, dur = 220) {
    if (destroyed) return false;
    const cam = scene?.cameras?.main;
    if (settings.reduceCameraMotion) {
      if (cam?.setZoom) cam.setZoom(1.0);
      return false;
    }
    const d = clamp(Number(delta) || 0, -0.08, 0.12);
    if (d === 0 || !cam || !scene?.tweens?.add) return false;
    const durMs = clamp(dur <= 5 ? dur * 1000 : dur, 60, 800);
    if (zoomTween) {
      const prev = zoomTween;
      zoomTween = null;
      prev.stop?.();
    }
    cam.setZoom(1.0 + d);
    let tw = null;
    const done = () => {
      if (tw && zoomTween !== tw) return;
      if (cam.scene !== null) cam.setZoom(1.0);
      zoomTween = null;
    };
    tw = scene.tweens.add({
      targets: cam,
      zoom: 1.0,
      duration: durMs,
      ease: 'Cubic.easeOut',
      onComplete: done,
      onStop: done,
    });
    zoomTween = tw;
    return true;
  }

  /** 统一分级反馈入口（small / medium / large） */
  function feedback(tier = 'small', pos = null, optsArg = {}) {
    if (destroyed) return;
    const preset = TIER_PRESETS[tier] || TIER_PRESETS.small;
    const tr = optsArg.trauma ?? preset.trauma;
    if (tr > 0) addTrauma(tr);

    const hs = optsArg.hitStop === false ? 0 : (optsArg.hitStop ?? preset.hitStop);
    if (hs > 0) {
      const nowMs = realNowMs();
      if (optsArg.forceHitStop || (!inHitStop && nowMs - lastAutoHitStopMs >= 160)) {
        lastAutoHitStopMs = nowMs;
        hitStop(hs, optsArg.slow ?? preset.slow, { skipIfActive: !optsArg.forceHitStop });
      }
    }

    const fl = optsArg.flash === false ? null : (optsArg.flash ?? preset.flash);
    if (fl) {
      flashScreen(fl.color ?? optsArg.color ?? 0xffffff, fl.alpha ?? 0.14, fl.dur ?? 110);
    }

    const zm = optsArg.zoom === false ? 0 : (optsArg.zoom ?? preset.zoom);
    if (zm !== 0) zoomPunch(zm, optsArg.zoomDur ?? 220);

    if (optsArg.sprite) {
      const [sx, sy] = optsArg.popScale || (tier === 'large' ? [1.32, 0.7] : [1.2, 0.8]);
      popSprite(optsArg.sprite, sx, sy, optsArg.popDur ?? 170);
    }

    const pCount = optsArg.particles ?? preset.particles;
    if (pos && pCount > 0 && scene) {
      const emitter = (tier === 'large' && scene.pGold) ? scene.pGold : scene.pSpark;
      if (emitter && typeof emitter.explode === 'function') {
        emitter.explode(pCount, pos.x, (pos.y ?? 0) - (optsArg.yOffset ?? 28));
      }
    }
  }

  /** 每渲染帧使用真实未缩放 dt（秒）更新震屏衰减与 Hit-Stop */
  function update(realDtSec) {
    const rdt = Math.max(0, Number(realDtSec) || 0);
    if (inHitStop && hitStopRemain > 0) {
      hitStopRemain -= rdt;
      if (hitStopRemain <= 0) {
        restoreHitStop(hitStopId);
      }
    }
    if (trauma > 0) {
      time += rdt * 2.1;
      trauma = stepTrauma(trauma, rdt, decay);
    }
    const off = computeShakeOffset(trauma, time, {
      strength: settings.shakeStrength,
      reduceCameraMotion: settings.reduceCameraMotion,
      maxOffsetX,
      maxOffsetY,
      maxRoll,
    });
    state.simScale = simScale;
    state.inHitStop = inHitStop;
    state.trauma = trauma;
    state.shake = off.shake;
    state.offsetX = off.offsetX;
    state.offsetY = off.offsetY;
    state.roll = off.roll;
    return state;
  }

  function destroy() {
    destroyed = true;
    hitStopId += 1;
    clearAllTimers();
    simScale = 1.0;
    inHitStop = false;
    hitStopRemain = 0;
    trauma = 0;
    state.simScale = 1.0;
    state.inHitStop = false;
    state.trauma = 0;
    state.shake = 0;
    state.offsetX = 0;
    state.offsetY = 0;
    state.roll = 0;
    if (flashTween) { flashTween.stop(); flashTween = null; }
    if (zoomTween) { zoomTween.stop(); zoomTween = null; }
    if (flashRect?.scene) { flashRect.destroy(); flashRect = null; }
    const cam = scene?.cameras?.main;
    if (cam) {
      cam.setZoom?.(1.0);
      cam.setRotation?.(0);
    }
  }

  if (scene?.events?.once) {
    scene.events.once('shutdown', destroy);
  }

  return {
    settings,
    state,
    get simScale() { return simScale; },
    get inHitStop() { return inHitStop; },
    get trauma() { return trauma; },
    get _hitStopId() { return hitStopId; },
    getSettings: () => ({ ...settings }),
    setSettings: syncSettings,
    saveSettings: () => saveFeelSettings(settings),
    addTrauma,
    hitStop,
    popSprite,
    flashScreen,
    zoomPunch,
    feedback,
    update,
    destroy,
  };
}
