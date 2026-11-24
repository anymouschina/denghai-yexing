// 存档仓库：localStorage（配额满/隐私模式降级内存）。两个槽位：auto（波次切换 + 定时自动存档）与 manual（玩家手动存档）。
// 每份存档带：魔数、存档版本、校验和、摘要 meta（入口「继续游戏」卡片用）。读档任何一步失败都返回 {ok:false, reason}，不抛异常。
import { captureSim, restoreSim, SAVE_VERSION } from './snapshot.js';
import { Sim } from '../sim/Sim.js';

const MAGIC = 'denghai-guard-run';
const PREFIX = 'denghai_guard_run_v1_';
export const SLOTS = ['auto', 'manual'];
export const SLOT_NAME = { auto: '自动存档', manual: '手动存档' };

let backend = null; // 可注入（Node 测试）；默认 localStorage
const mem = new Map();
export function setStorageBackend(b) { backend = b; }
function store() {
  if (backend) return backend;
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* 隐私模式 */ }
  return null;
}
function rawGet(k) {
  try { const st = store(); if (st) { const v = st.getItem(k); if (v !== null) return v; } } catch { /* 读失败 → 看内存 */ }
  return mem.has(k) ? mem.get(k) : null;
}
function rawSet(k, v) {
  try { const st = store(); if (st) { st.setItem(k, v); mem.delete(k); return true; } } catch { /* 配额满 */ }
  mem.set(k, v);
  return false;
}
function rawDel(k) { try { const st = store(); if (st) st.removeItem(k); } catch { /* ignore */ } mem.delete(k); }

// FNV-1a 32 位校验：发现被截断 / 手工改坏的存档
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

export function metaOf(sim) {
  const h = sim.hero;
  return {
    heroId: sim.heroId, mode: sim.mode, wave: sim.wave.n, t: Math.round(sim.t), lv: h ? h.lv : 1, copper: Math.round(sim.copper),
    kills: sim.stats.kills, kmHp: Math.round(sim.kongming.hp), kmMax: sim.kongming.maxHp, buildings: sim.buildings.filter((b) => b.alive).length,
  };
}

/** 写档。kind: 'wave' | 'timer' | 'manual'（决定槽位与文案）。返回 {ok, bytes, reason?} */
export function writeRun(sim, kind = 'manual') {
  try {
    if (sim.over) return { ok: false, reason: '本局已结束' };
    const slot = kind === 'manual' ? 'manual' : 'auto';
    const snap = captureSim(sim);
    const data = JSON.stringify(snap);
    const payload = JSON.stringify({ magic: MAGIC, version: SAVE_VERSION, slot, kind, savedAt: Date.now(), meta: metaOf(sim), sum: checksum(data), data });
    const persisted = rawSet(PREFIX + slot, payload);
    return { ok: true, slot, kind, bytes: payload.length, persisted, meta: metaOf(sim) };
  } catch (err) {
    return { ok: false, reason: `存档失败：${err && err.message ? err.message : err}` };
  }
}

function parseSlot(slot) {
  const raw = rawGet(PREFIX + slot);
  if (raw === null) return { ok: false, slot, empty: true, reason: '没有存档' };
  let p;
  try { p = JSON.parse(raw); } catch { return { ok: false, slot, corrupt: true, reason: '存档已损坏（无法解析）' }; }
  if (!p || p.magic !== MAGIC || typeof p.data !== 'string' || !p.meta) return { ok: false, slot, corrupt: true, reason: '存档格式不识别' };
  if (typeof p.version !== 'number' || p.version > SAVE_VERSION) return { ok: false, slot, incompatible: true, meta: p.meta, savedAt: p.savedAt, reason: `存档版本 v${p.version} 高于当前游戏 v${SAVE_VERSION}，请更新游戏` };
  if (p.version < SAVE_VERSION) return { ok: false, slot, incompatible: true, meta: p.meta, savedAt: p.savedAt, reason: `存档版本 v${p.version} 过旧，已无法读取` };
  if (checksum(p.data) !== p.sum) return { ok: false, slot, corrupt: true, meta: p.meta, savedAt: p.savedAt, reason: '存档校验失败（可能被截断或改动）' };
  return { ok: true, slot, kind: p.kind, savedAt: p.savedAt, meta: p.meta, data: p.data };
}

/** 入口卡片用：列出各槽位（不反序列化大 JSON） */
export function listRuns() {
  return SLOTS.map((slot) => {
    const r = parseSlot(slot);
    return r.ok ? { slot, ok: true, kind: r.kind, savedAt: r.savedAt, meta: r.meta } : { slot, ok: false, empty: !!r.empty, reason: r.reason, savedAt: r.savedAt, meta: r.meta };
  });
}

/** 最新的有效存档槽位 id（没有返回 null） */
export function latestRun() {
  const ok = listRuns().filter((r) => r.ok).sort((a, b) => b.savedAt - a.savedAt);
  return ok.length ? ok[0] : null;
}

export function deleteRun(slot) { rawDel(PREFIX + slot); }
export function clearAutoRun() { deleteRun('auto'); }

/** 读档：返回 {ok, sim, meta} 或 {ok:false, reason}。成功时返回一个已还原的全新 Sim。 */
export function readRun(slot, simOpts = {}) {
  const r = parseSlot(slot);
  if (!r.ok) return r;
  try {
    const snap = JSON.parse(r.data);
    const sim = new Sim({ seed: snap.sim.seed, heroId: snap.sim.heroId, mode: snap.sim.mode, ...simOpts });
    restoreSim(sim, snap);
    if (!sim.hero || !sim.kongming || !Number.isFinite(sim.t)) throw new Error('关键状态缺失');
    return { ok: true, slot, sim, meta: r.meta, savedAt: r.savedAt };
  } catch (err) {
    return { ok: false, slot, corrupt: true, reason: `存档还原失败：${err && err.message ? err.message : err}` };
  }
}
