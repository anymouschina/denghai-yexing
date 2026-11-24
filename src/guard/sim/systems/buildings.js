// M5 经营 · 建筑：在地基上建造 / 升级 / 拆除五种防御建筑，并驱动塔的攻击、拒马反伤、灯柱治疗。
// 数值全部在 data/buildings.json。命令：build {fid, bld}（bld = 建筑种类；type 字段已被命令类型占用）、upgrade {bid}、demolish {bid}。
import BD from '../../data/buildings.json' with { type: 'json' };

const T = BD.types;
const R = BD.buildRange;

export const BUILD_TYPES = Object.keys(T);

/** 第 lv 级升到 lv+1 的费用（lv=1 → ×1.2，lv=2 → ×1.8）；满级返回 null */
export function upgradeCost(type, lv) {
  const m = BD.upMul[lv - 1];
  return m ? Math.round(T[type].cost * m) : null;
}

export function lvVal(arr, lv) { return Array.isArray(arr) ? arr[Math.min(lv, arr.length) - 1] : arr; }

/** 建筑伤害随波数小幅成长（避免后期完全失效；平衡在 M6 统一调） */
function dmgOf(sim, b) {
  return lvVal(b.def0.dmg, b.lv) * (1 + BD.waveScale * Math.max(0, sim.wave.n - 1));
}

/** 能否在地基 f 建造/操作：任一可操控单位在 220 内；或当前操控单位在孔明 300 内且地基离孔明 420 内（内圈） */
export function canReach(sim, f) {
  for (const id of sim.party) {
    const u = sim.byId(id);
    if (u && u.alive && (u.x - f.x) ** 2 + (u.y - f.y) ** 2 <= R.unit * R.unit) return true;
  }
  const c = sim.ctrl;
  const K = sim.kongming;
  return !!(c && c.alive && (c.x - K.x) ** 2 + (c.y - K.y) ** 2 <= R.kongmingUnit ** 2
    && (f.x - K.x) ** 2 + (f.y - K.y) ** 2 <= R.kongmingFoundation ** 2);
}

/** 离 (x,y) 最近的地基 */
export function nearestFoundation(sim, x, y) {
  let best = null;
  let bd = Infinity;
  for (const f of sim.foundations) { const d = (f.x - x) ** 2 + (f.y - y) ** 2; if (d < bd) { bd = d; best = f; } }
  return best;
}

export function buildingAt(sim, f) { return f && f.bid != null ? sim.buildings.find((b) => b.id === f.bid && b.alive) || null : null; }

function applyLevel(b) {
  const d = b.def0;
  const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 1;
  b.maxHp = lvVal(d.hp, b.lv);
  b.hp = Math.max(1, ratio * b.maxHp);
}

function towerFire(sim, b) {
  const d = b.def0;
  const e = sim.nearestEnemy(b.x, b.y, d.range, (x) => !x.realm);
  if (!e) return false;
  const dmg = dmgOf(sim, b);
  const sy = b.y - b.h * 0.75;
  if (b.type === 'lei') {
    const hit = new Set();
    let cur = e;
    let px = b.x; let py = sy;
    let k = 1;
    for (let j = 0; j <= lvVal(d.jumps, b.lv) && cur; j++) {
      hit.add(cur.id);
      sim.pushFx({ t: 'bolt', x1: px, y1: py, x2: cur.x, y2: cur.y - cur.h * 0.4 });
      sim.damage(b, cur, dmg * k);
      px = cur.x; py = cur.y - cur.h * 0.4;
      k *= d.decay;
      cur = sim.nearestEnemy(cur.x, cur.y, d.jumpR, (x) => !hit.has(x.id) && !x.realm);
    }
    return true;
  }
  // 预判一点提前量
  const tx = e.x; const ty = e.y - e.h * 0.4;
  const a = Math.atan2(ty - sy, tx - b.x);
  const life = Math.min(1.4, Math.hypot(tx - b.x, ty - sy) / d.speed + 0.25);
  sim.addProj({
    side: 'ally', src: b, x: b.x, y: sy, a, speed: d.speed, life, dmg, r: b.type === 'fu' ? 18 : 12,
    splash: b.type === 'fu' ? lvVal(d.splash, b.lv) : 0, tex: d.proj, scale: b.type === 'fu' ? 0.6 : 0.9,
    tint: b.type === 'fu' ? 0xffd36a : null,
  });
  return true;
}

export default {
  id: 'buildings',
  init(sim) {
    sim.bldStats = { built: 0, upgraded: 0, demolished: 0, destroyed: 0, healed: 0, thorns: 0 };
    sim.on('buildingDestroyed', (b) => {
      const f = sim.foundations.find((x) => x.id === b.fid);
      if (f && f.bid === b.id) f.bid = null;
      sim.bldStats.destroyed++;
    });
    // 拒马反伤：近身打它的妖物按受到伤害的比例被反弹
    sim.on('damage', ({ src, tgt, dmg }) => {
      if (!tgt || tgt.kind !== 'building' || tgt.type !== 'wall' || !src || src.side !== 'enemy' || !src.alive) return;
      const d = tgt.def0;
      if ((src.x - tgt.x) ** 2 + (src.y - tgt.y) ** 2 > d.thornsRange ** 2) return;
      const v = sim.damage(tgt, src, dmg * lvVal(d.thorns, tgt.lv) + 4 * tgt.lv, { tag: 'thorns', canCrit: false });
      sim.bldStats.thorns += v;
      sim.pushFx({ t: 'thorns', x: (src.x + tgt.x) / 2, y: (src.y + tgt.y) / 2 - 30 });
    });
  },
  update(sim, dt) {
    for (const b of sim.buildings) {
      if (!b.alive) continue;
      if (b.hitT > 0) b.hitT -= dt;
      if (b.cd > 0) { b.cd -= dt; continue; }
      const d = b.def0;
      if (b.type === 'wall') continue;
      if (b.type === 'lamp') {
        b.cd = d.tick;
        const v = lvVal(d.heal, b.lv) * d.tick;
        let any = false;
        for (const u of sim.alliesIn(b.x, b.y, d.range)) if (u.hp < u.maxHp) { sim.bldStats.healed += sim.heal(u, v, b); any = true; }
        if (any) sim.pushFx({ t: 'lampPulse', x: b.x, y: b.y, r: d.range });
        continue;
      }
      if (towerFire(sim, b)) b.cd = d.cd; else b.cd = 0.2;
    }
  },
  commands: {
    build(sim, c) {
      const f = sim.foundations.find((x) => x.id === c.fid);
      const bt = c.bld || c.building;
      const d = T[bt];
      if (!f) return { ok: false, reason: '没有这块地基' };
      if (!d) return { ok: false, reason: '未知建筑' };
      if (buildingAt(sim, f)) return { ok: false, reason: '地基上已有建筑' };
      if (!canReach(sim, f)) return { ok: false, reason: '离地基太远，走近一些再建造' };
      if (sim.copper < d.cost) return { ok: false, reason: `铜钱不足（需要 ${d.cost}）` };
      sim.copper -= d.cost;
      const b = {
        id: sim.uid++, side: 'ally', kind: 'building', type: bt, key: bt, name: d.name, x: f.x, y: f.y, r: d.r, h: d.h,
        hp: 0, maxHp: 0, def: d.def, def0: d, lv: 1, fid: f.id, block: !!d.block, alive: true, tex: d.tex, scale: d.scale,
        cd: 0.3, hitT: 0, spent: d.cost, builtAt: sim.t,
      };
      applyLevel(b);
      b.hp = b.maxHp;
      sim.buildings.push(b);
      f.bid = b.id;
      sim.bldStats.built++;
      sim.pushFx({ t: 'build', x: b.x, y: b.y, lv: 1 });
      sim.emit('build', { b });
      return { ok: true, b };
    },
    upgrade(sim, c) {
      const b = sim.buildings.find((x) => x.id === c.bid && x.alive);
      if (!b) return { ok: false, reason: '建筑不存在' };
      const cost = upgradeCost(b.type, b.lv);
      if (cost == null) return { ok: false, reason: '已满级' };
      if (sim.copper < cost) return { ok: false, reason: `铜钱不足（需要 ${cost}）` };
      sim.copper -= cost;
      b.lv++;
      b.spent += cost;
      applyLevel(b);
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.3);
      sim.bldStats.upgraded++;
      sim.pushFx({ t: 'build', x: b.x, y: b.y, lv: b.lv, up: true });
      sim.emit('upgrade', { b });
      return { ok: true, b };
    },
    demolish(sim, c) {
      const b = sim.buildings.find((x) => x.id === c.bid && x.alive);
      if (!b) return { ok: false, reason: '建筑不存在' };
      const back = Math.round(b.spent * BD.refund);
      b.alive = false;
      const f = sim.foundations.find((x) => x.id === b.fid);
      if (f && f.bid === b.id) f.bid = null;
      sim.copper += back;
      sim.pushFx({ t: 'coin', x: b.x, y: b.y, v: back });
      sim.bldStats.demolished++;
      sim.pushFx({ t: 'boom', x: b.x, y: b.y, r: 60, small: true });
      sim.emit('demolish', { b });
      return { ok: true, refund: back };
    },
    repair(sim, c) {
      const b = sim.buildings.find((x) => x.id === c.bid && x.alive);
      if (!b) return { ok: false, reason: '建筑不存在' };
      if (b.hp >= b.maxHp) return { ok: false, reason: '建筑耐久已满' };
      const missing = (b.maxHp - b.hp) / b.maxHp;
      const cost = c.free ? 0 : Math.max(10, Math.ceil(b.def0.cost * 0.35 * missing));
      if (sim.copper < cost) return { ok: false, reason: `铜钱不足（修复需要 ${cost}）` };
      sim.copper -= cost;
      const healed = Math.round(b.maxHp - b.hp);
      b.hp = b.maxHp;
      sim.pushFx({ t: 'heal', x: b.x, y: b.y - 60, v: healed });
      sim.emit('repair', { b, cost, healed });
      return { ok: true, cost, healed };
    },
    repairWall(sim, c) {
      const w = (sim.walls || []).find((x) => x.id === c.wid);
      if (!w || !w.destructible || !w.repairable) return { ok: false, reason: '该墙体不可修复' };
      if (w.hp >= w.maxHp && w.alive) return { ok: false, reason: '城墙耐久已满' };
      const missing = (w.maxHp - w.hp) / Math.max(1, w.maxHp);
      const cost = c.free ? 0 : Math.max(15, Math.ceil((w.repairCost || 60) * missing));
      if (sim.copper < cost) return { ok: false, reason: `铜钱不足（修复需要 ${cost}）` };
      sim.copper -= cost;
      const r = sim.repairWall(w.id, c.amt ?? w.maxHp);
      return { ...r, cost };
    },
  },
};
