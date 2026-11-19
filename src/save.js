// 存档：移动端隐私模式 / 配额满时 localStorage 可能抛错 → 降级为内存存档，不让游戏崩。
// 并请求持久化存储，避免移动浏览器在空间紧张时清掉存档。
const KEY = 'denghai_yexing_save_v1';
const defaults = () => ({ soul: 0, best: 0, wins: 0, runs: 0, meta: {}, mute: false });
let mem = null;

try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* 无此 API */ }

export function loadSave() {
  if (mem) return { ...mem, meta: { ...mem.meta } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const s = JSON.parse(raw);
    return { ...defaults(), ...s, meta: { ...(s.meta || {}) } };
  } catch {
    return defaults();
  }
}

export function writeSave(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    mem = null;
  } catch {
    mem = { ...s, meta: { ...s.meta } };
  }
}
