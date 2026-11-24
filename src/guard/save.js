// 新模式独立存档：与原模式（denghai_yexing_save_v1）完全分开，互不读写。
const KEY = 'denghai_guard_save_v1';
const defaults = () => ({ runs: 0, storyWins: 0, endlessBest: 0, storyBest: 0, heroBest: {}, lastHero: 'huoqing', lastMode: 'story' });
let mem = null;

export function loadGuardSave() {
  if (mem) return JSON.parse(JSON.stringify(mem));
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const s = JSON.parse(raw);
    return { ...defaults(), ...s, heroBest: { ...(s.heroBest || {}) } };
  } catch {
    return defaults();
  }
}

export function writeGuardSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); mem = null; } catch { mem = JSON.parse(JSON.stringify(s)); }
}

// 一局结束时记账：返回是否刷新了纪录
export function recordRun(r) {
  const s = loadGuardSave();
  s.runs += 1;
  s.lastHero = r.heroId;
  s.lastMode = r.mode;
  let best = false;
  if (r.mode === 'story') {
    if (r.win) s.storyWins += 1;
    if (r.wave > s.storyBest) { s.storyBest = r.wave; best = true; }
  } else if (r.wave > s.endlessBest) { s.endlessBest = r.wave; best = true; }
  s.heroBest[r.heroId] = Math.max(s.heroBest[r.heroId] || 0, r.wave);
  writeGuardSave(s);
  return best;
}
