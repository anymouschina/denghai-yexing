// 可复用墙壁 / 地形屏障与合法穿墙闪现求解器（纯 JS，地图无关）。
// 墙体字段：
//   { id, kind:'realm'|'terrain'|'fortification'|'gate', x0, y0, x1, y1,
//     blocksGround:true, blocksFlying:false, blocksProj:false, blinkable:true,
//     destructible:false, repairable:false, hp?, maxHp?, def?, realm?, alive:true }

export function normalizeWall(w, idx = 0) {
  const x0 = Math.min(w.x0, w.x1);
  const x1 = Math.max(w.x0, w.x1);
  const y0 = Math.min(w.y0, w.y1);
  const y1 = Math.max(w.y0, w.y1);
  const destructible = !!w.destructible;
  const maxHp = destructible ? Math.max(1, Number(w.maxHp ?? w.hp ?? 1000)) : 0;
  return {
    ...w,
    id: w.id || `wall_${idx}`,
    kind: w.kind || (w.realm ? 'realm' : 'terrain'),
    x0,
    y0,
    x1,
    y1,
    blocksGround: w.blocksGround !== false,
    blocksFlying: !!w.blocksFlying,
    blocksProj: !!w.blocksProj,
    blinkable: w.blinkable !== false,
    destructible,
    repairable: w.repairable ?? destructible,
    maxHp,
    hp: destructible ? Math.max(0, Math.min(maxHp, Number(w.hp ?? maxHp))) : 0,
    def: Number(w.def || 0),
    alive: w.alive !== false && (!destructible || Number(w.hp ?? maxHp) > 0),
  };
}

export function isWallActive(w) {
  if (!w || w.alive === false) return false;
  if (w.destructible && (w.hp ?? 0) <= 0) return false;
  return true;
}

export function wallBlocksUnit(w, flying = false) {
  if (!isWallActive(w)) return false;
  return flying ? !!w.blocksFlying : w.blocksGround !== false;
}

/** 圆与墙（轴对齐矩形）求推出向量；把 (x,y,r) 推到墙外。支持飞行穿越与可破坏墙体状态。 */
export function resolveWalls(o, r, walls, opts = {}) {
  const flying = !!opts.flying;
  for (const w of walls) {
    if (!wallBlocksUnit(w, flying)) continue;
    const cx = Math.max(w.x0, Math.min(o.x, w.x1));
    const cy = Math.max(w.y0, Math.min(o.y, w.y1));
    const dx = o.x - cx;
    const dy = o.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      o.x = cx + (dx / d) * r;
      o.y = cy + (dy / d) * r;
    } else {
      const l = o.x - w.x0;
      const rr = w.x1 - o.x;
      const t = o.y - w.y0;
      const b = w.y1 - o.y;
      const m = Math.min(l, rr, t, b);
      if (m === l) o.x = w.x0 - r;
      else if (m === rr) o.x = w.x1 + r;
      else if (m === t) o.y = w.y0 - r;
      else o.y = w.y1 + r;
    }
  }
}

export function pointHitsWall(x, y, r, walls, opts = {}) {
  const flying = !!opts.flying;
  for (const w of walls) {
    if (!wallBlocksUnit(w, flying)) continue;
    const cx = Math.max(w.x0, Math.min(x, w.x1));
    const cy = Math.max(w.y0, Math.min(y, w.y1));
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < r * r) return w;
  }
  return null;
}

/** 线段 (x1,y1)->(x2,y2) 与所有满足 filter 的有效墙体求最近交点（Slab 算法）。 */
export function segmentHitsWall(x1, y1, x2, y2, walls, filter = null, pad = 0) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let best = null;
  for (const w of walls) {
    if (!isWallActive(w)) continue;
    if (filter && !filter(w)) continue;
    const minX = w.x0 - pad;
    const maxX = w.x1 + pad;
    const minY = w.y0 - pad;
    const maxY = w.y1 + pad;
    let tmin = 0;
    let tmax = 1;
    if (Math.abs(dx) < 1e-8) {
      if (x1 < minX || x1 > maxX) continue;
    } else {
      let t1 = (minX - x1) / dx;
      let t2 = (maxX - x1) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dy) < 1e-8) {
      if (y1 < minY || y1 > maxY) continue;
    } else {
      let t1 = (minY - y1) / dy;
      let t2 = (maxY - y1) / dy;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (!best || tmin < best.t) {
      best = { wall: w, t: tmin, x: x1 + dx * tmin, y: y1 + dy * tmin };
    }
  }
  return best;
}

function pointHitsBlocker(x, y, r, sim) {
  if (!sim || !sim.buildings) return false;
  for (const b of sim.buildings) {
    if (!b.alive || !b.block) continue;
    const rr = b.r + r;
    if ((x - b.x) ** 2 + (y - b.y) ** 2 < rr * rr) return true;
  }
  return false;
}

function clampToSameZone(pt, u, map) {
  const r = u.r || 22;
  const M = map.world.main;
  const H = map.hiddenRealm;
  if (H && u.x > M + 100) {
    const [x0, y0, x1, y1] = H.rect;
    pt.x = Math.max(x0 + r, Math.min(x1 - r, pt.x));
    pt.y = Math.max(y0 + r, Math.min(y1 - r, pt.y));
  } else {
    pt.x = Math.max(r, Math.min(M - r, pt.x));
    pt.y = Math.max(r, Math.min(M - r, pt.y));
  }
  return pt;
}

/**
 * 合法穿墙闪现落点求解器：
 * 1. 按 range 截断目标距离；
 * 2. 若路径穿过 blinkable=false 的不可翻越墙体，则停在墙前；
 * 3. 限制在当前世界分区（主战区与隐藏秘境互不跨虚空闪现）；
 * 4. 绝不落入未开放（locked）秘境；
 * 5. 若落点恰在可翻越墙体或拒马内：优先向前微调越过墙体到合法侧，否则沿射线回退至最近合法空地。
 */
export function resolveBlinkPosition(sim, u, aim, opts = {}) {
  const map = sim.map;
  const walls = sim.walls || map.walls || [];
  const range = Math.max(40, Number(opts.range || 320));
  const dx0 = aim ? aim.x - u.x : u.face * range;
  const dy0 = aim ? aim.y - u.y : 0;
  let dist = Math.hypot(dx0, dy0);
  const ang = dist > 1e-3 ? Math.atan2(dy0, dx0) : (u.face >= 0 ? 0 : Math.PI);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  if (dist < 1e-3) dist = range;
  let targetDist = Math.min(range, dist);

  let tx = u.x + ux * targetDist;
  let ty = u.y + uy * targetDist;

  // 不可翻越墙体（blinkable === false）：停在墙体之前
  const hardHit = segmentHitsWall(u.x, u.y, tx, ty, walls, (w) => wallBlocksUnit(w, u.flying) && !w.blinkable, u.r + 2);
  if (hardHit) {
    targetDist = Math.max(0, targetDist * hardHit.t - 4);
    tx = u.x + ux * targetDist;
    ty = u.y + uy * targetDist;
  }

  const isValid = (px, py) => {
    const p = clampToSameZone({ x: px, y: py }, u, map);
    if (Math.abs(p.x - px) > 1 || Math.abs(p.y - py) > 1) return false;
    if (sim.isRegionLocked && sim.isRegionLocked(p.x, p.y)) return false;
    if (pointHitsWall(p.x, p.y, u.r, walls, { flying: u.flying })) return false;
    if (!u.flying && pointHitsBlocker(p.x, p.y, u.r, sim)) return false;
    return true;
  };

  const cand = clampToSameZone({ x: tx, y: ty }, u, map);
  if (isValid(cand.x, cand.y)) {
    return { ok: true, x: cand.x, y: cand.y, ang, crossedWall: !!segmentHitsWall(u.x, u.y, cand.x, cand.y, walls, (w) => wallBlocksUnit(w, u.flying)) };
  }

  // 若落点卡在可翻越墙体/拒马内部，先尝试向前跨过墙体（最多向前多探 120 像素）
  const maxForward = hardHit ? 0 : 120;
  for (let extra = 12; extra <= maxForward; extra += 12) {
    const fx = u.x + ux * (targetDist + extra);
    const fy = u.y + uy * (targetDist + extra);
    if (isValid(fx, fy)) {
      const blockedHard = segmentHitsWall(u.x, u.y, fx, fy, walls, (w) => wallBlocksUnit(w, u.flying) && !w.blinkable, u.r + 2);
      if (!blockedHard) {
        return { ok: true, x: fx, y: fy, ang, crossedWall: true };
      }
    }
  }

  // 否则沿射线向后回退至最近合法点（例如目标落在未开放秘境内时停在门外）
  for (let d = targetDist - 12; d >= 24; d -= 12) {
    const bx = u.x + ux * d;
    const by = u.y + uy * d;
    if (isValid(bx, by)) {
      return { ok: true, x: bx, y: by, ang, crossedWall: !!segmentHitsWall(u.x, u.y, bx, by, walls, (w) => wallBlocksUnit(w, u.flying)) };
    }
  }

  return { ok: false, x: u.x, y: u.y, ang, crossedWall: false };
}
