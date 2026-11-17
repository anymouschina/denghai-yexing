const KEY = 'denghai_yexing_save_v1';
const defaults = () => ({ soul: 0, best: 0, wins: 0, runs: 0, meta: {}, mute: false });

export function loadSave() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return defaults();
  const s = JSON.parse(raw);
  return { ...defaults(), ...s, meta: { ...(s.meta || {}) } };
}

export function writeSave(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
