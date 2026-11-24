// 对局存档调度：波次切换 / 清波 / 定时 / 切后台与刷新（pagehide）/ 玩家手动。
// 为什么不在事件回调里直接写：事件是在 sim.step() 中途触发的，此刻状态可能只更新了一半；
// 一律只打标记，等一整步（或一整帧的若干步）跑完后在 flush() 里存，保证存的是一致的局面。
import { writeRun, clearAutoRun } from './store.js';

export const AUTOSAVE_EVERY_SEC = 30; // 模拟时间（暂停时自然不走）

export function attachAutosave(sim, { onSaved, onFail } = {}) {
  let pending = null;
  let lastT = sim.t;
  let lastResult = null;
  let disposed = false;
  const mark = (kind) => { if (!pending || pending === 'timer') pending = kind; };
  const offs = [];
  const on = (evt, fn) => { sim.on(evt, fn); offs.push([evt, fn]); };
  on('waveStart', () => mark('wave'));
  on('waveClear', () => mark('wave'));
  on('end', () => { pending = null; clearAutoRun(); });

  const doSave = (kind) => {
    if (disposed || sim.over) return null;
    const r = writeRun(sim, kind);
    lastT = sim.t;
    lastResult = r;
    if (r.ok) { if (onSaved) onSaved(r); } else if (onFail) onFail(r);
    return r;
  };

  // 刷新 / 关页 / 切后台：同步写（浏览器允许 pagehide 里的同步 localStorage 写入）
  const onLeave = () => doSave('timer');
  const onVis = () => { if (document.hidden) doSave('timer'); };
  const hasDoc = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (hasDoc) {
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('visibilitychange', onVis);
  }

  return {
    /** 每帧在模拟步进之后调用 */
    flush() {
      if (disposed || sim.over) return null;
      if (!pending && sim.t - lastT >= AUTOSAVE_EVERY_SEC) pending = 'timer';
      if (!pending) return null;
      const k = pending;
      pending = null;
      return doSave(k);
    },
    manual() { return doSave('manual'); },
    get last() { return lastResult; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (hasDoc) {
        window.removeEventListener('pagehide', onLeave);
        window.removeEventListener('beforeunload', onLeave);
        document.removeEventListener('visibilitychange', onVis);
      }
      for (const [evt, fn] of offs) { const ls = sim.listeners[evt]; if (ls) { const i = ls.indexOf(fn); if (i >= 0) ls.splice(i, 1); } }
      offs.length = 0;
    },
  };
}
