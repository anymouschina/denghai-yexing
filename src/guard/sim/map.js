// 地图几何与可复用地图工厂（纯数据，无渲染）：
// - 通过 createMap(cfg) 支持任意自定义地图（三路/多路兵线、复活点、回城锚点、秘境、可破坏/地形墙体、地基）。
// - 默认地图 DEFAULT_MAP 从 data/balance.json 构建，并导出兼容常量（REALMS / HIDDEN / WALLS / FOUNDATIONS / LANES / REVIVE_POINT / HOME_ANCHOR）。
import BAL from '../data/balance.json' with { type: 'json' };
import { normalizeWall, resolveWalls } from './walls.js';

const LANE_DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export function inRect(x, y, rect, pad = 0) {
  return x >= rect[0] - pad && x <= rect[2] + pad && y >= rect[1] - pad && y <= rect[3] + pad;
}

// 门洞中心（在 gate 角朝秘境内侧偏一点），用于进出判定和画门
export function gateCenter(r, gap = BAL.realmGap) {
  const [x0, y0, x1, y1] = r.rect;
  const sx = r.gate[0] === x1 ? -1 : 1;
  const sy = r.gate[1] === y1 ? -1 : 1;
  return [r.gate[0] + sx * gap * 0.45, r.gate[1] + sy * gap * 0.45];
}

function buildRealmWalls(realms, thick, gap) {
  const out = [];
  for (const r of realms) {
    const [x0, y0, x1, y1] = r.rect;
    const gx = r.gate[0];
    const gy = r.gate[1];
    const vy0 = gy === y1 ? y0 : y0 + gap;
    const vy1 = gy === y1 ? y1 - gap : y1;
    out.push(normalizeWall({
      id: `realm_${r.id}_v`,
      kind: 'realm',
      x0: gx - thick / 2,
      y0: vy0,
      x1: gx + thick / 2,
      y1: vy1,
      realm: r.id,
      blocksGround: true,
      blocksFlying: false,
      blocksProj: false,
      blinkable: true,
    }, out.length));
    const hx0 = gx === x1 ? x0 : x0 + gap;
    const hx1 = gx === x1 ? x1 - gap : x1;
    out.push(normalizeWall({
      id: `realm_${r.id}_h`,
      kind: 'realm',
      x0: hx0,
      y0: gy - thick / 2,
      x1: hx1,
      y1: gy + thick / 2,
      realm: r.id,
      blocksGround: true,
      blocksFlying: false,
      blocksProj: false,
      blinkable: true,
    }, out.length));
  }
  return out;
}

function buildFoundationsFromLanes(lanes, cx, cy, ring) {
  const out = [];
  let id = 0;
  for (const lane of Object.keys(lanes)) {
    const dir = LANE_DIRS[lane];
    if (!dir) continue;
    const [dx, dy] = dir;
    const px = -dy;
    const py = dx;
    for (const [dist, side] of ring) {
      out.push({ id: id++, lane, x: cx + dx * dist + px * side, y: cy + dy * dist + py * side });
    }
  }
  return out;
}

/**
 * 可复用地图配置工厂：未来扩展新地图只需传入自己的 config（兵线、复活点、回城点、墙体、秘境、地基、商店表）。
 * @param {object} [cfg]
 */
export function createMap(cfg = {}) {
  const world = { ...BAL.world, ...(cfg.world || {}) };
  const S = cfg.realmSize ?? BAL.realmSize;
  const M = world.main;
  const T = cfg.wallThick ?? BAL.wallThick;
  const GAP = cfg.realmGap ?? BAL.realmGap;

  const realms = cfg.realms ? cfg.realms.map((r) => ({ ...r })) : [
    { id: 'xuanwu', name: '玄武秘境', beast: 'xuanwu', rect: [0, 0, S, S], gate: [S, S], color: 0x3a7fae },
    { id: 'qinglong', name: '青龙秘境', beast: 'qinglong', rect: [M - S, 0, M, S], gate: [M - S, S], color: 0x3fb59a },
    { id: 'zhuque', name: '朱雀秘境', beast: 'zhuque', rect: [M - S, M - S, M, M], gate: [M - S, M - S], color: 0xe0563a },
    { id: 'baihu', name: '白虎秘境', beast: 'baihu', rect: [0, M - S, S, M], gate: [S, M - S], color: 0xd8d2c0 },
  ];

  const hiddenRealm = cfg.hiddenRealm !== undefined
    ? cfg.hiddenRealm
    : { id: 'qilin', name: '麒麟·中宫', beast: 'qilin', rect: BAL.hiddenRealm.rect, color: 0xffc94a, hidden: true, portal: true, ...BAL.hiddenRealm };

  const extraRealms = cfg.extraRealms !== undefined
    ? (cfg.extraRealms || []).map((r) => ({ ...r, portal: true, rect: [...r.rect], entry: [...r.entry], exit: [...r.exit], arrive: [...r.arrive], back: [...r.back] }))
    : (BAL.extraRealms || []).map((r) => ({ ...r, portal: true, rect: [...r.rect], entry: [...r.entry], exit: [...r.exit], arrive: [...r.arrive], back: [...r.back] }));

  const banditCamp = cfg.banditCamp !== undefined
    ? cfg.banditCamp
    : (BAL.banditCamp ? {
      ...BAL.banditCamp,
      minions: (BAL.banditCamp.minions || []).map((m) => ({ ...m })),
      enemyTowers: (BAL.banditCamp.enemyTowers || []).map((t) => ({ ...t })),
      boss: { ...BAL.banditCamp.boss, moves: (BAL.banditCamp.boss?.moves || []).map((mv) => ({ ...mv })) },
      reward: { ...(BAL.banditCamp.reward || {}) },
    } : null);

  const mirrorChallenge = cfg.mirrorChallenge !== undefined
    ? cfg.mirrorChallenge
    : (BAL.mirrorChallenge ? {
      ...BAL.mirrorChallenge,
      tiers: (BAL.mirrorChallenge.tiers || []).map((t) => ({ ...t, reward: { ...(t.reward || {}) } })),
    } : null);

  const hunterCamp = cfg.hunterCamp !== undefined
    ? cfg.hunterCamp
    : (BAL.hunterCamp ? {
      ...BAL.hunterCamp,
      reward: { ...(BAL.hunterCamp.reward || {}), tomePool: [...(BAL.hunterCamp.reward?.tomePool || [])] },
    } : null);

  const bossRoom = cfg.bossRoom !== undefined
    ? cfg.bossRoom
    : (BAL.bossRoom ? {
      ...BAL.bossRoom,
      rect: [...BAL.bossRoom.rect],
      entry: [...BAL.bossRoom.entry],
      exit: [...BAL.bossRoom.exit],
      arrive: [...BAL.bossRoom.arrive],
      back: [...BAL.bossRoom.back],
    } : null);

  const trainingRoom = cfg.trainingRoom !== undefined
    ? cfg.trainingRoom
    : (BAL.trainingRoom ? { ...BAL.trainingRoom, rect: [...BAL.trainingRoom.rect], entry: [...BAL.trainingRoom.entry], exit: [...BAL.trainingRoom.exit], arrive: [...BAL.trainingRoom.arrive], back: [...BAL.trainingRoom.back] } : null);

  const lanes = cfg.lanes || BAL.lanes;
  const laneOrder = cfg.laneOrder || Object.keys(lanes);
  const laneNames = { ...(BAL.laneNames || { N: '北', E: '东', W: '西', S: '南' }), ...(cfg.laneNames || {}) };
  const lanesAt = cfg.lanesAt || BAL.waves.lanesAt;

  const realmWalls = cfg.includeRealmWalls === false ? [] : buildRealmWalls(realms, T, GAP);
  const extraWalls = (cfg.walls || []).map((w, i) => normalizeWall(w, realmWalls.length + i));
  const walls = [...realmWalls, ...extraWalls];

  const foundations = cfg.foundations
    ? cfg.foundations.map((f, i) => ({ id: f.id ?? i, ...f }))
    : buildFoundationsFromLanes(lanes, world.cx, world.cy, cfg.foundationRing || BAL.foundationRing);

  const revivePoint = { ...(BAL.revivePoint || { x: world.cx, y: world.cy + 350, r: 130, healPct: 0.08, name: '续命泉·复活点' }), ...(cfg.revivePoint || {}) };
  const homeAnchor = { ...(BAL.homeAnchor || { x: world.cx, y: world.cy + 150, r: 80 }), ...(cfg.homeAnchor || {}) };

  return {
    id: cfg.id || 'qixing_altar',
    name: cfg.name || '七星灯坛',
    world,
    realmSize: S,
    realmGap: GAP,
    wallThick: T,
    realms,
    hiddenRealm,
    extraRealms,
    banditCamp,
    hunterCamp,
    bossRoom,
    mirrorChallenge,
    trainingRoom,
    lanes,
    laneOrder,
    laneNames,
    lanesAt,
    walls,
    foundations,
    revivePoint,
    homeAnchor,
    shopCatalog: cfg.shopCatalog || null,
    bossEscalations: cfg.bossEscalations ?? BAL.bossEscalations ?? [],
    beastDropSoulMarkOnly: !!cfg.beastDropSoulMarkOnly,
    isUniqueGroundItem: cfg.isUniqueGroundItem || null,
  };
}

export const DEFAULT_MAP = createMap();

// 默认地图常量导出（保持与现有模块/测试完全兼容）
export const REALMS = DEFAULT_MAP.realms;
export const HIDDEN = DEFAULT_MAP.hiddenRealm;
export const EXTRA_REALMS = DEFAULT_MAP.extraRealms;
export const ALL_REALMS = [...REALMS, HIDDEN, ...EXTRA_REALMS];
export const BANDIT_CAMP = DEFAULT_MAP.banditCamp;
export const HUNTER_CAMP = DEFAULT_MAP.hunterCamp;
export const BOSS_ROOM = DEFAULT_MAP.bossRoom;
export const TRAINING_ROOM = DEFAULT_MAP.trainingRoom;
export const WALLS = DEFAULT_MAP.walls;
export const LANES = DEFAULT_MAP.lanes;
export const FOUNDATIONS = DEFAULT_MAP.foundations;
export const REVIVE_POINT = DEFAULT_MAP.revivePoint;
export const HOME_ANCHOR = DEFAULT_MAP.homeAnchor;

export function realmAt(x, y, map = DEFAULT_MAP) {
  for (const r of map.realms) if (inRect(x, y, r.rect)) return r;
  if (map.hiddenRealm && inRect(x, y, map.hiddenRealm.rect)) return map.hiddenRealm;
  for (const r of (map.extraRealms || [])) if (inRect(x, y, r.rect)) return r;
  if (map.bossRoom && inRect(x, y, map.bossRoom.rect)) return map.bossRoom;
  if (map.trainingRoom && inRect(x, y, map.trainingRoom.rect)) return map.trainingRoom;
  return null;
}

// 圆与墙（轴对齐矩形）求推出向量；支持传入自定义 walls 与 flying 选项
export function pushOutOfWalls(o, r, walls = WALLS, opts = {}) {
  resolveWalls(o, r, walls, opts);
}

// 可走区域：主战区 + 隐藏秘境 + 传送挑战秘境（项羽/刑天等）+ BOSS房 + 练功房
export function clampWorld(o, r, map = DEFAULT_MAP) {
  const M = map.world.main;
  if (o.x > M + 100) {
    const offRects = [];
    if (map.trainingRoom) offRects.push(map.trainingRoom);
    if (map.bossRoom) offRects.push(map.bossRoom);
    if (map.hiddenRealm) offRects.push(map.hiddenRealm);
    for (const er of (map.extraRealms || [])) offRects.push(er);

    let target = o.realm ? offRects.find((x) => x.id === o.realm) : null;
    if (!target) target = offRects.find((x) => inRect(o.x, o.y, x.rect, 120));
    if (!target && offRects.length) {
      let bestD = Infinity;
      for (const x of offRects) {
        const cx = (x.rect[0] + x.rect[2]) * 0.5;
        const cy = (x.rect[1] + x.rect[3]) * 0.5;
        const d = (o.x - cx) ** 2 + (o.y - cy) ** 2;
        if (d < bestD) { bestD = d; target = x; }
      }
    }
    if (target) {
      const [x0, y0, x1, y1] = target.rect;
      o.x = Math.max(x0 + r, Math.min(x1 - r, o.x));
      o.y = Math.max(y0 + r, Math.min(y1 - r, o.y));
      return;
    }
  }
  o.x = Math.max(r, Math.min(M - r, o.x));
  o.y = Math.max(r, Math.min(M - r, o.y));
}
