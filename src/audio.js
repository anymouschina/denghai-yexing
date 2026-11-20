import { ZZFX } from 'zzfx';

// 音频总线：
//   sfx（ZzFX 合成→归一化→缓存 AudioBuffer）──┐
//   music（程序化编曲：太鼓/古筝/竹笛/铃/低音）─┼→ master（静音用）→ 限幅器 → 扬声器
//   混响（程序生成冲激响应）与延迟作为音乐的发送效果
// 平台没有音乐生成模型，BGM 用 Web Audio 现场编曲：D 羽调五声（D F G A C），三种模式交叉淡入淡出
const ctx = ZZFX.audioContext;
const SR = ctx.sampleRate;
const SAVE_KEY = 'denghai_yexing_save_v1';

let muted = false;
try { muted = !!JSON.parse(localStorage.getItem(SAVE_KEY) || '{}').mute; } catch { /* 无存档 */ }

// ---------------- 总线 ----------------
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -4;
limiter.knee.value = 0;
limiter.ratio.value = 20;
limiter.attack.value = 0.002;
limiter.release.value = 0.12;
limiter.connect(ctx.destination);

const master = ctx.createGain();
master.gain.value = muted ? 0 : 0.9;
master.connect(limiter);

// 音效总线比音乐低一档，并经过一个轻压缩，密集命中时不会糊成一片
const sfxBus = ctx.createGain();
sfxBus.gain.value = 0.42;
const sfxComp = ctx.createDynamicsCompressor();
sfxComp.threshold.value = -14;
sfxComp.ratio.value = 4;
sfxComp.attack.value = 0.003;
sfxComp.release.value = 0.1;
sfxBus.connect(sfxComp).connect(master);

// 音乐总线：duck（大音效时让位）→ glue 压缩 → master
const musicBus = ctx.createGain();
musicBus.gain.value = 0.62;
const duck = ctx.createGain();
const musicComp = ctx.createDynamicsCompressor();
musicComp.threshold.value = -16;
musicComp.ratio.value = 3;
musicComp.attack.value = 0.01;
musicComp.release.value = 0.2;
musicBus.connect(duck).connect(musicComp).connect(master);

// 混响：2.8 秒衰减噪声冲激响应（立体声）
const reverb = ctx.createConvolver();
{
  const len = Math.floor(SR * 2.8);
  const ir = ctx.createBuffer(2, len, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const k = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.6) * (i < SR * 0.012 ? i / (SR * 0.012) : 1);
    }
  }
  reverb.buffer = ir;
}
const reverbRet = ctx.createGain();
reverbRet.gain.value = 0.5;
reverb.connect(reverbRet).connect(musicBus);

// 古筝回声：附点八分延迟，按曲速设置
const delay = ctx.createDelay(1.5);
delay.delayTime.value = 0.36;
const delayFb = ctx.createGain();
delayFb.gain.value = 0.3;
const delayLp = ctx.createBiquadFilter();
delayLp.type = 'lowpass';
delayLp.frequency.value = 2400;
const delayRet = ctx.createGain();
delayRet.gain.value = 0.32;
delay.connect(delayLp).connect(delayFb).connect(delay);
delayLp.connect(delayRet).connect(musicBus);
delayRet.connect(reverb);

// ---------------- 音效 ----------------
// ZzFX 参数顺序：volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide,
//               pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter
// 每个音效：p 参数、v 归一化后的响度、gap 最短间隔、voices 最大同时发声、pj 随机变调幅度（±）
const SFX = {
  // 符纸飞出：轻的“嗖”，高频短促，最频繁所以最轻
  shoot:   { p: [1, 0.05, 1300, 0, 0.01, 0.05, 1, 2, -40, 0, 0, 0, 0, 0.25, 0, 0, 0, 0.8, 0.02, 0, 600], v: 0.22, gap: 0.05, voices: 3, pj: 0.08 },
  // 命中：闷“笃”一声
  hit:     { p: [1, 0.1, 220, 0, 0.005, 0.06, 3, 1.6, -14, 0, 0, 0, 0, 0.8, 0, 0, 0, 0.6, 0.03, 0, -2200], v: 0.42, gap: 0.035, voices: 5, pj: 0.12 },
  // 击杀：纸裂“啪”+ 下沉
  kill:    { p: [1, 0.05, 420, 0, 0.02, 0.13, 4, 1.2, -8, 0, -180, 0.04, 0, 0.6, 0, 0.1, 0, 0.5, 0.05, 0, -3000], v: 0.46, gap: 0.04, voices: 4, pj: 0.1 },
  // 暴击：金属脆响“叮”
  crit:    { p: [1, 0, 1500, 0, 0.02, 0.18, 1, 2.5, 0, 0, 600, 0.025, 0, 0, 8, 0, 0, 0.6, 0.05], v: 0.5, gap: 0.06, voices: 3, pj: 0.05 },
  // 拾取魂火：清亮小音，连拾时沿五声音阶升调
  pickup:  { p: [1, 0, 1175, 0, 0.01, 0.07, 0, 1.6, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.02], v: 0.3, gap: 0.03, voices: 4, pj: 0 },
  // 铜钱：双音叮当
  coin:    { p: [1, 0, 1650, 0, 0.02, 0.16, 1, 1.8, 0, 0, 550, 0.05, 0, 0, 0, 0, 0, 0.6, 0.03], v: 0.42, gap: 0.05, voices: 3, pj: 0.03 },
  // 回血：柔和上行带颤音
  heal:    { p: [1, 0, 520, 0.04, 0.12, 0.28, 0, 1, 6, 0, 260, 0.1, 0, 0, 0, 0, 0, 0.6, 0.08, 0.15], v: 0.5, gap: 0.1, voices: 2, pj: 0 },
  // 受伤：低沉碎响
  hurt:    { p: [1, 0.05, 160, 0, 0.04, 0.2, 3, 2.2, -12, 0, 0, 0, 0, 1.2, 0, 0.25, 0, 0.55, 0.06, 0, -2500], v: 0.75, gap: 0.12, voices: 2, pj: 0.06 },
  // 冲刺：风声“呼”
  dash:    { p: [1, 0.05, 260, 0.03, 0.05, 0.15, 0, 1, 10, 0, 0, 0, 0, 3, 0, 0, 0, 0.4, 0.05, 0, 900], v: 0.45, gap: 0.1, voices: 2, pj: 0.05 },
  // 落雷：噼啪 + 隆隆
  thunder: { p: [1, 0.1, 1200, 0, 0.03, 0.45, 4, 1, -30, 0, 0, 0, 0, 4, 0, 0.4, 0, 0.5, 0.1], v: 0.55, gap: 0.08, voices: 3, pj: 0.08 },
  // 爆炸：低频轰
  boom:    { p: [1, 0.1, 90, 0.005, 0.12, 0.6, 4, 1, -4, 0, 0, 0, 0, 1.5, 0, 0.3, 0, 0.5, 0.2, 0, -1400], v: 0.8, gap: 0.08, voices: 3, pj: 0.08, duck: 0.75 },
  // 敌弹：阴森下滑的“呜”，与己方高频“嗖”区分
  eshot:   { p: [1, 0.05, 520, 0.03, 0.06, 0.16, 0, 1, -22, 0, 0, 0, 0, 0, 12, 0, 0, 0.6, 0.05, 0.3], v: 0.3, gap: 0.06, voices: 3, pj: 0.06 },
  // UI 点击：木鱼“笃”
  click:   { p: [1, 0, 900, 0, 0.01, 0.04, 0, 2, -30, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0.01], v: 0.45, gap: 0.03, voices: 2, pj: 0.02 },
  // 妖王咆哮
  roar:    { p: [1, 0.1, 70, 0.15, 0.4, 0.7, 2, 0.6, -1, 0, 0, 0, 0, 1.6, 4, 0.2, 0, 0.6, 0.2, 0.2, -900], v: 0.85, gap: 0.3, voices: 1, pj: 0.04, duck: 0.6 },
  // 灯灭（玩家死亡）：长下行带回声
  death:   { p: [1, 0, 330, 0.05, 0.5, 1.1, 1, 1.4, -3.5, 0, 0, 0, 0, 0.3, 0, 0, 0.18, 0.5, 0.3, 0.1, -2400], v: 0.75, gap: 0.5, voices: 1, pj: 0, duck: 0.4 },
  // 组合音的单音素材
  _bell:   { p: [1, 0, 587.33, 0.003, 0.05, 0.4, 1, 1.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.12], v: 0.4, gap: 0, voices: 8, pj: 0 },
  _ting:   { p: [1, 0, 1174.66, 0, 0.03, 0.12, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.02, 0, -3500], v: 0.38, gap: 0, voices: 4, pj: 0 },
};

// 组合音：按五声音阶排程的多个单音（[素材, 延迟秒, 半音, 音量]），与 BGM 同调
const COMBO = {
  levelup: { gap: 0.2, duck: 0.65, notes: [['_bell', 0, 0, 1], ['_bell', 0.07, 3, 0.9], ['_bell', 0.14, 7, 0.9], ['_bell', 0.21, 10, 0.95], ['_bell', 0.28, 12, 1]] },
  chest:   { gap: 0.3, duck: 0.55, notes: [['_bell', 0, -12, 0.8], ['_bell', 0, -5, 0.6], ['_bell', 0.06, 0, 0.8], ['_bell', 0.12, 5, 0.8], ['_bell', 0.18, 7, 0.8], ['_bell', 0.24, 12, 0.9], ['_bell', 0.3, 15, 0.8], ['_bell', 0.36, 19, 0.9], ['_bell', 0.42, 24, 0.7]] },
  warn:    { gap: 0.25, notes: [['_ting', 0, 0, 1], ['_ting', 0.13, 0, 0.9]] },
};
const PENT_STEPS = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

const cache = {};
const lastPlay = {};
const voices = {};
let pickupChain = 0;
let pickupLast = 0;

function build(name) {
  const def = SFX[name];
  const out = [];
  for (let n = 0; n < 3; n++) {
    const s = ZZFX.buildSamples(...def.p);
    let peak = 0;
    for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > peak) peak = a; }
    const k = peak > 0 ? 1 / peak : 1;
    const buf = ctx.createBuffer(1, Math.max(1, s.length), ZZFX.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < s.length; i++) d[i] = s[i] * k;
    out.push(buf);
  }
  return (cache[name] = out);
}

function voice(name, vol, rate, when = 0) {
  const def = SFX[name];
  if ((voices[name] || 0) >= def.voices) return;
  const bufs = cache[name] || build(name);
  const src = ctx.createBufferSource();
  src.buffer = bufs[(Math.random() * bufs.length) | 0];
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = def.v * vol;
  src.connect(g).connect(sfxBus);
  voices[name] = (voices[name] || 0) + 1;
  src.onended = () => { voices[name]--; g.disconnect(); };
  src.start(ctx.currentTime + when);
}

function duckMusic(depth) {
  const t = ctx.currentTime;
  duck.gain.cancelScheduledValues(t);
  duck.gain.setTargetAtTime(depth, t, 0.02);
  duck.gain.setTargetAtTime(1, t + 0.25, 0.35);
}

export function setMuted(m) {
  muted = !!m;
  master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    if (s.mute !== muted) { s.mute = muted; localStorage.setItem(SAVE_KEY, JSON.stringify(s)); }
  } catch { /* 存档不可用时只在本次会话生效 */ }
}
export const isMuted = () => muted;

// 预热：首次解锁后分帧合成所有音效，避免第一次播放时卡一下
let warmed = false;
function prewarm() {
  if (warmed) return;
  warmed = true;
  const names = Object.keys(SFX);
  const step = () => {
    const n = names.shift();
    if (!n) return;
    if (!cache[n]) build(n);
    setTimeout(step, 16);
  };
  setTimeout(step, 50);
}

export function unlockAudio() {
  if (ctx.state !== 'running') ctx.resume();
  prewarm();
}
// 任意首次输入即解锁（浏览器自动播放策略）
if (typeof window !== 'undefined') {
  const once = () => {
    unlockAudio();
    if (ctx.state === 'running') for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, once, true);
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, once, true);
  // 切到后台挂起音频：省电，也避免回来时调度器一次补出一堆音符
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (ctx.state === 'running') { ctx.suspend(); ctx._autoSuspended = true; } } else if (ctx._autoSuspended) { ctx._autoSuspended = false; ctx.resume(); }
  });
}

export function sfx(name, vol = 1) {
  if (muted || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const combo = COMBO[name];
  const def = combo || SFX[name];
  if (!def) return;
  if (now - (lastPlay[name] || -1) < def.gap) return;
  lastPlay[name] = now;
  if (def.duck) duckMusic(def.duck);
  if (combo) {
    for (const [n, d, semi, v] of combo.notes) voice(n, vol * v, Math.pow(2, semi / 12), d);
    return;
  }
  let rate = 1 + (Math.random() * 2 - 1) * def.pj;
  let v = vol * (0.88 + Math.random() * 0.12);
  if (name === 'pickup') {
    // 连续拾取沿五声音阶爬升，停顿 0.45 秒后归位
    pickupChain = now - pickupLast < 0.45 ? Math.min(pickupChain + 1, PENT_STEPS.length - 1) : 0;
    pickupLast = now;
    rate = Math.pow(2, PENT_STEPS[pickupChain] / 12);
    v = vol;
  }
  voice(name, v, rate);
}

// ---------------- 程序化背景音乐 ----------------
const PENT = [0, 3, 5, 7, 10]; // D 羽调：D F G A C
const D2 = 73.416;
const D4 = 293.665;
const D5 = 587.33;
const deg2semi = (d) => Math.floor(d / 5) * 12 + PENT[((d % 5) + 5) % 5];
const hz = (base, semi) => base * Math.pow(2, semi / 12);
const _ = null;

// 8 小节和声（五声音阶度数偏移）：D D C A | D F C A
const CHD = [0, 0, -1, -2, 0, 1, -1, -2];
// Boss 用半音偏移（含小二度 Eb），整体平移制造不安
const CHS = [0, 0, 1, 0, -2, -4, 1, -5];
// 竹笛旋律 [起始 16 分音符, 五声度数(0=D5), 时值]
const FLUTE = [
  [0, 3, 6], [6, 2, 2], [8, 1, 4], [12, 0, 4],
  [16, -1, 4], [20, 0, 10], [30, 1, 2],
  [32, 2, 6], [38, 3, 2], [40, 4, 8],
  [48, 3, 4], [52, 2, 4], [56, 3, 8],
  [64, 5, 6], [70, 4, 2], [72, 3, 6], [78, 4, 2],
  [80, 3, 4], [84, 2, 4], [88, 1, 8],
  [96, 0, 4], [100, 1, 2], [102, 2, 2], [104, 1, 4], [108, -1, 4],
  [112, 0, 16],
];
const FLUTE_AT = new Array(128).fill(null);
for (const n of FLUTE) FLUTE_AT[n[0]] = n;
// 古筝固定音型（16 分）
const OST = [0, 2, 4, 2, 5, 4, 2, 4, 0, 2, 4, 2, 6, 5, 4, 2];
const TITLE_ARP = [0, _, _, 2, _, _, 4, _, _, _, 7, _, _, _, _, _];

const MODES = {
  title:  { bpm: 70, gain: 0.95 },
  battle: { bpm: 126, gain: 0.85 },
  boss:   { bpm: 138, gain: 0.85 },
};

// Karplus-Strong 拨弦（古筝/琵琶质感），按音高缓存 AudioBuffer，用 playbackRate 精确校音
const ksCache = new Map();
function ksBuffer(semiFromD4) {
  const key = Math.round(semiFromD4);
  let e = ksCache.get(key);
  if (e) return e;
  const f = hz(D4, key);
  const N = Math.max(2, Math.round(SR / f - 0.5));
  const fReal = SR / (N + 0.5);
  const dur = Math.min(2.2, 1.0 + 220 / f);
  const len = Math.floor(SR * dur);
  const buf = ctx.createBuffer(1, len, SR);
  const y = buf.getChannelData(0);
  const t60 = Math.max(0.6, 2.6 - key * 0.04);
  const g = Math.pow(10, -3 / (t60 * fReal));
  // 激励：低通噪声 + 拨弦位置梳状，偏亮但不刺耳
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp = lp * 0.45 + (Math.random() * 2 - 1) * 0.55;
    y[i] = lp;
  }
  const pick = Math.max(1, Math.round(N * 0.18));
  for (let i = N - 1; i >= pick; i--) y[i] -= y[i - pick] * 0.6;
  for (let i = N; i < len; i++) y[i] = g * 0.5 * (y[i - N] + y[i - N - 1 < 0 ? 0 : i - N - 1]);
  let peak = 0;
  for (let i = 0; i < len; i++) { const a = Math.abs(y[i]); if (a > peak) peak = a; }
  if (peak > 0) for (let i = 0; i < len; i++) y[i] /= peak;
  e = { buf, rate: f / fReal };
  ksCache.set(key, e);
  return e;
}

const noiseBuf = (() => {
  const b = ctx.createBuffer(1, SR * 2, SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
})();

// 一条乐段：独立输出增益，切换时新旧两条交叉淡化
class Seq {
  constructor(mode, at, fade) {
    this.mode = mode;
    this.m = MODES[mode];
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, at);
    this.out.gain.linearRampToValueAtTime(this.m.gain, at + fade);
    this.out.connect(musicBus);
    this.step = 0;
    this.next = at;
    this.stopAt = Infinity;
  }

  fadeOut(t, fade) {
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    this.stopAt = t + fade + 0.1;
  }

  // ---- 乐器 ----
  env(t, peak, a, d, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(dest || this.out);
    return g;
  }

  osc(type, freq, t, dur, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise(t, dur, dest, filt, freq, q = 1) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filt;
    f.frequency.value = freq;
    f.Q.value = q;
    n.connect(f).connect(dest);
    n.start(t, Math.random() * 1.5, dur + 0.05);
    return f;
  }

  send(node, amt, dly = 0) {
    const g = ctx.createGain();
    g.gain.value = amt;
    node.connect(g).connect(reverb);
    if (dly) {
      const g2 = ctx.createGain();
      g2.gain.value = dly;
      node.connect(g2).connect(delay);
    }
  }

  taiko(t, v = 1) {
    const g = this.env(t, 0.75 * v, 0.004, 0.55);
    const o = this.osc('sine', 120, t, 0.6, g);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.3);
    const g2 = this.env(t, 0.22 * v, 0.002, 0.2);
    const o2 = this.osc('triangle', 210, t, 0.25, g2);
    o2.frequency.exponentialRampToValueAtTime(110, t + 0.15);
    const ng = this.env(t, 0.35 * v, 0.001, 0.09);
    this.noise(t, 0.12, ng, 'lowpass', 900);
    this.send(g, 0.12 * v);
  }

  shime(t, v = 1) {
    const g = this.env(t, 0.22 * v, 0.002, 0.12);
    const o = this.osc('triangle', 380, t, 0.15, g);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.08);
    const ng = this.env(t, 0.16 * v, 0.001, 0.05);
    this.noise(t, 0.06, ng, 'bandpass', 2400, 1.2);
  }

  woodblock(t, v = 1) {
    const g = this.env(t, 0.2 * v, 0.001, 0.06);
    const o = this.osc('sine', 1180, t, 0.08, g);
    o.frequency.exponentialRampToValueAtTime(980, t + 0.05);
    this.send(g, 0.15);
  }

  shaker(t, v = 1) {
    const g = this.env(t, 0.07 * v, 0.004, 0.045);
    this.noise(t, 0.06, g, 'highpass', 6500);
  }

  bass(t, semi, dur, v = 1, grit = false) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(grit ? 1100 : 700, t);
    lp.frequency.exponentialRampToValueAtTime(grit ? 260 : 200, t + dur);
    lp.Q.value = grit ? 6 : 2;
    const g = this.env(t, 0.26 * v, 0.008, dur, lp);
    lp.connect(this.out);
    this.osc(grit ? 'square' : 'sawtooth', hz(D2, semi), t, dur, g);
    this.osc('sine', hz(D2, semi - 12), t, dur, this.env(t, 0.22 * v, 0.008, dur));
  }

  pluck(t, semi, v = 1, bend = 0) {
    const ks = ksBuffer(semi);
    const src = ctx.createBufferSource();
    src.buffer = ks.buf;
    src.playbackRate.setValueAtTime(ks.rate, t);
    // 古筝按音：音头之后向上推半音或全音
    if (bend) src.playbackRate.setTargetAtTime(ks.rate * Math.pow(2, bend / 12), t + 0.08, 0.06);
    const g = ctx.createGain();
    g.gain.value = 0.2 * v;
    src.connect(g).connect(this.out);
    this.send(g, 0.25, 0.35);
    src.start(t);
    src.stop(t + ks.buf.duration);
  }

  gliss(t, fromDeg, count, span, v = 0.6) {
    for (let i = 0; i < count; i++) this.pluck(t + (span / count) * i, deg2semi(fromDeg + i), v * (0.6 + 0.4 * i / count));
  }

  // 竹笛：三角波 + 八度正弦，延迟颤音、气声、起音下滑入音
  flute(t, semi, dur, v = 1, base = D5) {
    const f = hz(base, semi);
    const amp = ctx.createGain();
    const a = Math.min(0.09, dur * 0.3);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.13 * v, t + a);
    amp.gain.setValueAtTime(0.13 * v, t + Math.max(a, dur - 0.12));
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(6000, f * 4);
    amp.connect(lp).connect(this.out);
    this.send(lp, 0.45, 0.12);
    const o = this.osc('triangle', f * 0.965, t, dur + 0.1, amp);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    const o2g = ctx.createGain();
    o2g.gain.value = 0.25;
    o2g.connect(amp);
    const o2 = this.osc('sine', f * 2 * 0.965, t, dur + 0.1, o2g);
    o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.07);
    if (dur > 0.3) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.4, dur * 0.6));
      lfo.connect(depth);
      depth.connect(o.frequency);
      depth.connect(o2.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.15);
    }
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.05 * v, t + 0.04);
    ng.gain.exponentialRampToValueAtTime(0.012 * v, t + 0.2);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    ng.connect(lp);
    this.noise(t, dur + 0.1, ng, 'bandpass', f * 1.5, 2);
  }

  pad(t, semi, dur, v = 1) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 760;
    lp.connect(this.out);
    this.send(lp, 0.4);
    for (const [s, det] of [[semi, -7], [semi, 7], [semi + 7, 0]]) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.03 * v, t + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      g.connect(lp);
      const o = this.osc('sawtooth', hz(D2 * 2, s), t, dur, g);
      o.detune.value = det;
    }
  }

  drone(t, dur, v = 1) {
    for (const [f, type, a] of [[D2, 'sine', 0.16], [D2 * 1.5, 'sine', 0.06], [D2 * 2, 'triangle', 0.035]]) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(a * v, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      g.connect(this.out);
      this.osc(type, f, t, dur, g);
    }
  }

  // 风铃/磬：非整数泛音，长尾混响
  bell(t, semi, v = 1) {
    const f = hz(D5 * 2, semi);
    for (const [r, a, d] of [[1, 0.06, 2.2], [2.76, 0.025, 1.2], [5.4, 0.012, 0.6]]) {
      const g = this.env(t, a * v, 0.003, d);
      this.send(g, 0.8);
      this.osc('sine', f * r, t, d, g);
    }
  }

  // 铜锣：一组非谐泛音缓慢衰减、音高略下沉
  gong(t, v = 1) {
    for (const [f, a] of [[98, 0.12], [147, 0.08], [203, 0.06], [266, 0.05], [349, 0.03]]) {
      const g = this.env(t, a * v, 0.02, 3.2);
      this.send(g, 0.5);
      const o = this.osc('sine', f, t, 3.3, g);
      o.frequency.exponentialRampToValueAtTime(f * 0.96, t + 3);
    }
    const ng = this.env(t, 0.08 * v, 0.005, 1.2);
    this.noise(t, 1.3, ng, 'bandpass', 500, 0.8);
  }

  // ---- 编排 ----
  note(step, t, dt) {
    const bar = (step >> 4) & 7;
    const s = step & 15;
    const loop = step >> 7;
    const mode = this.mode;
    const chromatic = mode === 'boss';
    const root = chromatic ? CHS[bar] : deg2semi(CHD[bar]);
    const tone = (deg) => (chromatic ? deg2semi(deg) + CHS[bar] : deg2semi(deg + CHD[bar]));

    if (mode === 'title') {
      if (bar % 2 === 0 && s === 0) this.drone(t, dt * 32, 0.9);
      if (s === 0) this.pad(t, root, dt * 16, 0.7);
      const arp = TITLE_ARP[s];
      if (arp !== null) this.pluck(t, tone(arp) - 12, 0.55);
      if (bar % 2 === 1 && s === 12) this.pluck(t, tone(9) - 12, 0.4, 2);
      if ((bar === 1 || bar === 5) && s === 8) this.bell(t, bar === 1 ? 7 : 3, 0.8);
      if (s === 0 && bar % 4 === 0) this.taiko(t, 0.45);
      if (s === 0 && bar === 0 && loop % 2 === 1) this.gong(t, 0.5);
      const fl = FLUTE_AT[step & 127];
      if (fl && (loop >= 1 || step >= 32)) this.flute(t, deg2semi(fl[1]), fl[2] * dt * 0.95, 0.75);
      return;
    }

    const boss = mode === 'boss';
    // 鼓组
    if (boss) {
      if ([0, 3, 6, 8, 10, 12, 14].includes(s)) this.taiko(t, s === 0 || s === 8 ? 1 : 0.7);
      this.shime(t, s % 4 === 0 ? 0.9 : 0.35);
      if (bar === 7 && s >= 8) this.taiko(t, 0.5 + (s - 8) * 0.06);
      if (s === 0 && bar === 0) this.gong(t, 0.8);
    } else {
      if (s === 0 || s === 10) this.taiko(t, 1);
      if (s === 4 || s === 12) this.shime(t, 0.9);
      if (s === 7 && bar % 2 === 1) this.taiko(t, 0.55);
      if (bar === 7 && s >= 12) this.shime(t, 0.6 + (s - 12) * 0.1);
      if (s === 2 || s === 7 || s === 10 || s === 14) this.woodblock(t, s === 2 ? 0.9 : 0.6);
    }
    if (s % 2 === 0) this.shaker(t, s % 4 === 2 ? 1 : 0.5);

    // 低音
    if (boss) {
      if (s % 2 === 0) this.bass(t, root + (s === 6 || s === 14 ? 12 : 0), dt * 1.7, 0.9, true);
    } else if ([0, 3, 6, 8, 11, 14].includes(s)) {
      this.bass(t, root + (s === 6 || s === 14 ? 12 : 0), dt * 2.2, 0.85);
    }

    // 和声垫
    if (s === 0 && (boss || loop % 2 === 0)) this.pad(t, root, dt * 16, boss ? 0.9 : 0.6);

    // 古筝：每 8 小节开头一记上行刮奏，平时固定音型
    if (bar === 0 && s === 0) this.gliss(t, -3, 8, dt * 2.5, 0.7);
    else if (boss || s % 2 === 0) this.pluck(t, tone(OST[s]) - (boss ? 0 : 12), (s % 4 === 0 ? 0.75 : 0.5) * (boss ? 0.8 : 1));

    // 竹笛旋律：战斗曲隔一遍出现，Boss 曲每遍都有且高八度
    const fl = FLUTE_AT[step & 127];
    if (fl && (boss || loop % 2 === 1)) {
      const sm = deg2semi(fl[1]) + (boss ? CHS[(fl[0] >> 4) & 7] : 0);
      this.flute(t, sm, fl[2] * dt * 0.95, boss ? 0.85 : 0.9, boss ? D5 * 2 : D5);
    } else if (!boss && loop % 2 === 0 && bar >= 4 && FLUTE_AT[step & 127]) {
      // 没有笛子的那一遍，后半段由古筝高音接旋律
      const n = FLUTE_AT[step & 127];
      this.pluck(t, deg2semi(n[1]) + 12, 0.7, n[2] >= 6 ? 2 : 0);
    }
  }
}

class Music {
  constructor() {
    this.seqs = [];
    this.mode = null;
    this.timer = null;
  }

  play(mode) {
    if (this.mode === mode || !MODES[mode]) return;
    const t = ctx.currentTime + 0.05;
    const fade = mode === 'boss' ? 0.8 : 1.6;
    for (const s of this.seqs) if (s.stopAt === Infinity) s.fadeOut(t, fade);
    const seq = new Seq(mode, t, fade);
    this.seqs.push(seq);
    this.mode = mode;
    const bpm = MODES[mode].bpm;
    delay.delayTime.setTargetAtTime((60 / bpm) * 0.75, t, 0.1);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 25);
  }

  tick() {
    const now = ctx.currentTime;
    if (ctx.state !== 'running') return;
    for (let i = this.seqs.length - 1; i >= 0; i--) {
      const s = this.seqs[i];
      if (now > s.stopAt) {
        s.out.disconnect();
        this.seqs.splice(i, 1);
        continue;
      }
      const dt = 60 / s.m.bpm / 4;
      // 计时器被节流（后台/卡顿）后不补播，直接对齐到现在
      if (s.next < now - 0.1) s.next = now + 0.02;
      while (s.next < now + 0.15 && s.next < s.stopAt) {
        s.note(s.step, s.next, dt);
        s.next += dt;
        s.step++;
      }
    }
  }
}

export const music = new Music();
