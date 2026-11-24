// 可复用通用闪现系统（Universal Blink，地图无关）：
// - 所有可操控单位共用（command: blink，带冷却），同时被缩地符（blink_scroll）与阿烛灯影步复用。
// - 通过 walls.js 的 resolveBlinkPosition 实现合法穿墙：可跨可翻越墙体与拒马，绝不卡墙、绝不穿入未开放秘境或不可翻越墙体。
import BAL from '../../data/balance.json' with { type: 'json' };
import { resolveBlinkPosition } from '../walls.js';

const BK = () => BAL.blink || { range: 320, cd: 10, invuln: 0.25, scrollRange: 460, scrollInvuln: 0.45 };

export function performBlink(sim, u, aim, opts = {}) {
  if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
  if (u.kind === 'kongming') return { ok: false, reason: '孔明无法闪现' };
  if (u.st.stun > 0 || u.st.freeze > 0) return { ok: false, reason: '被控制中，无法闪现' };
  const cfg = BK();
  const useCd = opts.useCd !== false;
  if (useCd && (u.cds.blink || 0) > 0) {
    return { ok: false, reason: `闪现冷却中（剩余 ${u.cds.blink.toFixed(1)} 秒）` };
  }
  const range = Number(opts.range ?? cfg.range ?? 320);
  const invuln = Number(opts.invuln ?? cfg.invuln ?? 0.25);
  let target = aim;
  if (!target) {
    if (opts.autoAim) {
      const mx = sim.input?.mx || 0;
      const my = sim.input?.my || 0;
      const mlen = Math.hypot(mx, my);
      if (mlen > 0.1) target = { x: u.x + (mx / mlen) * range, y: u.y + (my / mlen) * range };
      else target = { x: u.x + (u.face >= 0 ? 1 : -1) * range, y: u.y };
    } else {
      target = sim.aimPoint(u);
    }
  }
  const res = resolveBlinkPosition(sim, u, target, { range });
  if (!res.ok) return { ok: false, reason: '目标位置无法闪现落脚' };

  const ox = u.x;
  const oy = u.y;
  if (u.recall && sim.cancelRecall) sim.cancelRecall(u, '闪现打断');
  u.order = null;
  u.dash = null;
  u.x = res.x;
  u.y = res.y;
  u.prevX = u.x;
  u.prevY = u.y;
  u.face = Math.cos(res.ang) >= 0 ? 1 : -1;
  u.invuln = Math.max(u.invuln, invuln);
  if (useCd) u.cds.blink = (opts.cd ?? cfg.cd ?? 10) * (1 - (u.stats?.cdr || 0));
  sim.collideUnit(u);

  const color = opts.color ?? 0xc47bff;
  sim.pushFx({ t: 'ring', x: ox, y: oy, r: 46, dur: 0.3, color });
  sim.pushFx({ t: 'beam', x1: ox, y1: oy - 36, x2: u.x, y2: u.y - 36, w: 16, color, dur: 0.28 });
  sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: 54, dur: 0.35, color: 0x7fe3ff });
  sim.pushFx({ t: 'sfx', name: 'dash', vol: 0.6 });
  sim.emit('blink', { u, from: { x: ox, y: oy }, to: { x: u.x, y: u.y }, crossedWall: res.crossedWall, fromItem: !!opts.fromItem });
  return { ok: true, x: u.x, y: u.y, crossedWall: res.crossedWall };
}

export default {
  id: 'blink',
  init(sim) {
    sim.performBlink = (u, aim, opts) => performBlink(sim, u, aim, opts);
  },
  commands: {
    blink(sim, c) {
      const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
      const aim = (c.x !== undefined && c.y !== undefined) ? { x: Number(c.x), y: Number(c.y) } : null;
      return performBlink(sim, u, aim, { useCd: true, autoAim: !!c.autoAim });
    },
  },
};
