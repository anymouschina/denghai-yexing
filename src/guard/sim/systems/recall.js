// 可复用回城系统（Town Portal / Recall，地图无关）：
// - 目标锚点从 sim.getHomeAnchor() 动态读取，适配未来任意新地图。
// - 支持内置回城技能（command: recall，带吟唱与冷却）和回城符（startRecall({ fast: true })，短吟唱且无视冷却）。
// - 移动/受控/施法/倒下打断吟唱并给出明确反馈；吟唱完成传送至基地锚点并更新秘境归属。
import BAL from '../../data/balance.json' with { type: 'json' };
import { clampWorld, pushOutOfWalls } from '../map.js';

const RC = () => BAL.recall || { channelTime: 2.0, scrollChannelTime: 0.8, cd: 25, cancelCd: 2, arriveInvuln: 0.6, cancelOnMove: true, cancelOnStun: true, cancelOnDamage: false };

export function cancelRecall(sim, u, reason = '已打断') {
  if (!u || !u.recall) return false;
  const rc = u.recall;
  u.recall = null;
  if (!rc.fromItem && rc.applyCancelCd !== false) {
    u.cds.recall = Math.max(u.cds.recall || 0, RC().cancelCd ?? 2);
  }
  sim.pushFx({ t: 'text', x: u.x, y: u.y - 95, text: `回城${reason}`, color: '#ff8a7a', size: 18 });
  sim.emit('recallCancel', { u, reason, fromItem: !!rc.fromItem });
  return true;
}

export function startRecall(sim, u, opts = {}) {
  if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
  if (u.kind === 'kongming') return { ok: false, reason: '孔明无法回城' };
  if (u.st.stun > 0 || u.st.freeze > 0) return { ok: false, reason: '被控制中，无法回城' };
  if (u.recall) return { ok: false, reason: '正在回城吟唱中' };
  const cfg = RC();
  const fromItem = !!opts.fromItem;
  if (!fromItem && (u.cds.recall || 0) > 0) {
    return { ok: false, reason: `回城冷却中（剩余 ${Math.ceil(u.cds.recall)} 秒）` };
  }
  const anchor = opts.dest || sim.getHomeAnchor();
  const dur = Math.max(0.1, Number(opts.channelTime ?? (fromItem ? cfg.scrollChannelTime : cfg.channelTime)));
  u.order = null;
  u.dash = null;
  u.moving = false;
  u.recall = {
    t: dur,
    total: dur,
    dest: { x: anchor.x, y: anchor.y },
    fromItem,
    invuln: opts.arriveInvuln ?? cfg.arriveInvuln ?? 0.6,
    cd: opts.cd ?? cfg.cd ?? 25,
  };
  sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: 68, dur: Math.min(dur, 0.7), color: 0x7fe3ff });
  sim.pushFx({ t: 'text', x: u.x, y: u.y - 100, text: fromItem ? '回城符吟唱…' : '回城吟唱…', color: '#7fe3ff', size: 20 });
  sim.emit('recallStart', { u, dur, dest: u.recall.dest, fromItem });
  return { ok: true, dur, dest: u.recall.dest };
}

function finishRecall(sim, u) {
  const rc = u.recall;
  if (!rc) return;
  const ox = u.x;
  const oy = u.y;
  u.recall = null;
  const dest = { x: rc.dest.x, y: rc.dest.y };
  clampWorld(dest, u.r, sim.map);
  pushOutOfWalls(dest, u.r, sim.walls, { flying: u.flying });
  u.x = dest.x;
  u.y = dest.y;
  u.prevX = u.x;
  u.prevY = u.y;
  u.order = null;
  u.dash = null;
  u.invuln = Math.max(u.invuln, rc.invuln || 0.6);
  if (!rc.fromItem) u.cds.recall = rc.cd * (1 - (u.stats?.cdr || 0));
  sim.collideUnit(u);
  sim.pushFx({ t: 'ring', x: ox, y: oy, r: 80, dur: 0.45, color: 0x7fe3ff });
  sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: 105, dur: 0.55, color: 0xffd36a });
  sim.pushFx({ t: 'text', x: u.x, y: u.y - 105, text: '回城归位！', color: '#ffd36a', size: 22 });
  sim.pushFx({ t: 'sfx', name: 'dash', vol: 0.65 });
  sim.emit('recallDone', { u, from: { x: ox, y: oy }, to: { x: u.x, y: u.y }, fromItem: rc.fromItem });
}

export default {
  id: 'recall',
  init(sim) {
    sim.startRecall = (u, opts) => startRecall(sim, u, opts);
    sim.cancelRecall = (u, reason) => cancelRecall(sim, u, reason);
    sim.on('damage', ({ tgt }) => {
      if (RC().cancelOnDamage && tgt && tgt.recall) cancelRecall(sim, tgt, '受击打断');
    });
    sim.on('cast', ({ u }) => {
      if (u && u.recall) cancelRecall(sim, u, '施法打断');
    });
  },
  update(sim, dt) {
    const cfg = RC();
    for (const u of sim.units) {
      if (!u.recall) continue;
      if (!u.alive) { u.recall = null; continue; }
      if (cfg.cancelOnStun && (u.st.stun > 0 || u.st.freeze > 0)) {
        cancelRecall(sim, u, '受控打断');
        continue;
      }
      u.recall.t -= dt;
      if (u.recall.t <= 0) finishRecall(sim, u);
    }
  },
  commands: {
    recall(sim, c) {
      const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
      return startRecall(sim, u, { fromItem: false });
    },
    cancelRecall(sim, c) {
      const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
      if (!u || !u.recall) return { ok: false, reason: '当前未在回城' };
      cancelRecall(sim, u, '已取消');
      return { ok: true };
    },
  },
};
