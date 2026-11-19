// 复用 H5 版的 ZzFX 音效参数，离线渲染成 WAV（Godot 播放用）。用法：node tools/make_sfx.mjs
import fs from 'node:fs';
globalThis.AudioContext = class { constructor() { this.sampleRate = 44100; } };
const { ZZFX } = await import('zzfx');
const src = fs.readFileSync('src/audio.js', 'utf8');
const a = src.indexOf('const SFX = {');
const b = src.indexOf('\n};', a) + 3;
const SFX = new Function(`${src.slice(a, b).replace('const SFX =', 'return')}`)();
ZZFX.sampleRate = 44100;
function wav(samples, sr) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}
const meta = {};
for (const [name, def] of Object.entries(SFX)) {
  for (let v = 0; v < 2; v++) {
    const s = ZZFX.buildSamples(...def.p);
    let peak = 0;
    for (const x of s) peak = Math.max(peak, Math.abs(x));
    const k = peak > 0 ? 0.92 / peak : 1;
    fs.writeFileSync(`godot/audio/sfx/${name}_${v}.wav`, wav(s.map((x) => x * k), 44100));
  }
  meta[name] = { v: def.v, gap: def.gap, voices: def.voices, pj: def.pj, duck: def.duck || 0 };
}
fs.writeFileSync('godot/audio/sfx/sfx.json', JSON.stringify(meta, null, 1));
console.log('ok', Object.keys(SFX).length);
