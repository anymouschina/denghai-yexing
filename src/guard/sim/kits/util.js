// 技能共用工具（纯 JS）。数值一律从单位 def.skills[slot] 读，代码里只写结构。
import { pushOutOfWalls } from '../map.js';
import BAL from '../../data/balance.json' with { type: 'json' };
import EXTRA from './unit-skills.json' with { type: 'json' };

// 技能配置：def.skills[slot]（英雄数值在 heroes.json），雇佣兵/神兽再合并 unit-skills.json 的补充字段（按 key 缓存）
// 若英雄升级了该技能（u.skillLvs[slot] > 1），按 skillDmgPerLv 自动放大 coef。
const CACHE = new Map();
export function cfg(u, slot) {
  const k = `${u.key}:${slot}`;
  let c = CACHE.get(k);
  if (!c || c.base !== u.def.skills[slot]) {
    c = { base: u.def.skills[slot], v: { ...u.def.skills[slot], ...(EXTRA[u.key] && EXTRA[u.key][slot]) } };
    CACHE.set(k, c);
  }
  const lv = (u.skillLvs && u.skillLvs[slot]) || 1;
  const isAwakenedUlt = slot === 'u' && u.kind === 'hero' && !!u.awakened;
  if (lv > 1 || isAwakenedUlt) {
    const out = { ...c.v };
    const mul = (1 + (lv - 1) * (BAL.hero.skillDmgPerLv || 0.2)) * (isAwakenedUlt ? 1.65 : 1);
    if (out.coef) out.coef = out.coef * mul;
    if (out.pct) out.pct = out.pct * (1 + (lv - 1) * 0.12) * (isAwakenedUlt ? 1.4 : 1);
    if (!out.coef && out.dur) out.dur = out.dur * (1 + (lv - 1) * 0.1);
    if (isAwakenedUlt) {
      if (out.r) out.r = Math.round(out.r * 1.35);
      if (out.dist) out.dist = Math.round(out.dist * 1.2);
    }
    return out;
  }
  return c.v;
}
export const atk = (u) => u.stats.atk;
export const angTo = (u, p) => Math.atan2(p.y - u.y, p.x - u.x);
export const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// 把瞄准点限制在施法距离内
export function clampAim(u, aim, range) {
  const dx = aim.x - u.x;
  const dy = aim.y - u.y;
  const d = Math.hypot(dx, dy);
  if (d <= range || d < 1) return { x: aim.x, y: aim.y };
  return { x: u.x + (dx / d) * range, y: u.y + (dy / d) * range };
}

// 圆形范围伤害，返回命中的妖物
export function hitCircle(sim, u, x, y, r, dmg, o = {}) {
  const hits = sim.enemiesIn(x, y, r);
  for (const e of hits) {
    sim.damage(u, e, dmg, { skill: true, tag: o.tag });
    if (o.stun) sim.applyStatus(e, 'stun', o.stun);
    if (o.freeze) sim.applyStatus(e, 'freeze', o.freeze);
    if (o.root) sim.applyStatus(e, 'root', o.root);
    if (o.slow) sim.applyStatus(e, 'slow', o.slowT || 2, o.slow);
    if (o.burn) sim.applyStatus(e, 'burn', o.burnT || 3, { dps: o.burn, src: u.id });
    if (o.knock) knock(e, x, y, o.knock, sim.walls);
  }
  return hits;
}

// 扇形（锥形）范围伤害
export function hitCone(sim, u, a, r, arc, dmg, o = {}) {
  const hits = [];
  for (const e of sim.enemiesIn(u.x, u.y, r)) {
    let da = Math.atan2(e.y - u.y, e.x - u.x) - a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > arc / 2 && d2(u, e) > (u.r + e.r) ** 2) continue;
    hits.push(e);
    sim.damage(u, e, dmg, { skill: true, tag: o.tag });
    if (o.stun) sim.applyStatus(e, 'stun', o.stun);
    if (o.slow) sim.applyStatus(e, 'slow', o.slowT || 2, o.slow);
    if (o.burn) sim.applyStatus(e, 'burn', o.burnT || 3, { dps: o.burn, src: u.id });
    if (o.knock) knock(e, u.x, u.y, o.knock, sim.walls);
  }
  return hits;
}

// 击退（BOSS 不受影响；支持传入当前地图 sim.walls）
export function knock(e, fx, fy, dist, walls) {
  if (!e.alive || e.boss) return;
  const a = Math.atan2(e.y - fy, e.x - fx);
  const k = e.elite ? 0.4 : 1;
  e.x += Math.cos(a) * dist * k;
  e.y += Math.sin(a) * dist * k;
  if (!e.flying) pushOutOfWalls(e, e.r, walls);
}

// 扇形弹幕
export function fan(sim, u, a, n, spread, p) {
  for (let i = 0; i < n; i++) {
    const aa = n === 1 ? a : a - spread / 2 + (spread * i) / (n - 1);
    sim.addProj({ side: 'ally', src: u, x: u.x + Math.cos(aa) * 20, y: u.y - (u.h || 60) * 0.45 + Math.sin(aa) * 20, a: aa, skill: true, ...p });
  }
}

// 位移：朝角度 a 冲刺 dist 像素，用时 t 秒
export function dash(u, a, dist, t, o = {}) {
  u.dash = { vx: (Math.cos(a) * dist) / t, vy: (Math.sin(a) * dist) / t, t, hitR: o.hitR || 60, hit: new Set(), onHit: o.onHit, onEnd: o.onEnd };
  u.face = Math.cos(a) >= 0 ? 1 : -1;
}

// ---------- AI 查询 ----------
export const isBig = (e) => !!(e.boss || e.elite);
export function bossNear(sim, u, r) { return sim.enemiesIn(u.x, u.y, r).find(isBig) || null; }
export function countNear(sim, x, y, r) { return sim.enemiesIn(x, y, r).length; }
// 聚团点：施法距离内半径 r 敌人 ≥ min 返回该点；否则 BOSS/精英在场时返回它的位置
export function clusterAim(sim, u, range, r, min, big = true) {
  const c = sim.bestCluster(u.x, u.y, range, r);
  if (c && c.n >= min) return { x: c.x, y: c.y };
  if (big) { const b = bossNear(sim, u, range); if (b) return { x: b.x, y: b.y }; }
  return null;
}
export function tgtIn(u, r) { const t = u.tgt; return t && t.alive && d2(u, t) <= (r + (t.r || 0)) ** 2 ? t : null; }
// 残血友军（含孔明）：返回血量比例最低且低于 ratio 的单位
export function lowAlly(sim, u, r, ratio, kmRatio = ratio) {
  let best = null;
  let bv = 1;
  for (const a of sim.units) {
    if (!a.alive || a.realm !== u.realm) continue;
    if (d2(a, u) > (r + a.r) ** 2) continue;
    const v = a.hp / a.maxHp;
    if (v < (a.kind === 'kongming' ? kmRatio : ratio) && v < bv) { bv = v; best = a; }
  }
  return best;
}
// 大招时机：敌人 ≥ n 或 BOSS/精英在场
export function ultAim(sim, u, range, r, n) {
  const b = bossNear(sim, u, range);
  if (b) return { x: b.x, y: b.y };
  const c = sim.bestCluster(u.x, u.y, range, r);
  return c && c.n >= n ? { x: c.x, y: c.y } : null;
}

export function healUnit(sim, u, tgt, c) {
  const kmK = tgt.kind === 'kongming' ? (c.kmMul ?? 1) : 1;
  const skMul = 1 + ((u.stats && u.stats.skillDmg) || 0);
  return sim.heal(tgt, (atk(u) * (c.coef || 0) + tgt.maxHp * (c.pct || 0)) * kmK * skMul, u);
}
