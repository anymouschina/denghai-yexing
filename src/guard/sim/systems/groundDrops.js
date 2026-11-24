// 可复用地面掉落物与一键清理系统（地图无关、数据驱动）：
// - 支持地面道具生成（击杀掉落 / 主动丢弃 dropItem / 地图事件）、点击/走近拾取（pickupGround / pickupNear）。
// - 自动拾取（balance.groundDrops.autoPickup）：击杀/秘境/BOSS 掉落的道具与装备落地 autoPickupDelay 秒后自动收入行囊，
//   无需走近；玩家主动丢弃（manual）的物品不会被自动捡回；行囊满时留在地面并节流提示，腾出格子后下一轮自动收取。
// - 支持一键清理地面道具（clearGroundItems）：自动跳过并保护所有唯一道具（unique: true 或地图自定义 protectPredicate）。
import BAL from '../../data/balance.json' with { type: 'json' };
import IT from '../../data/items.json' with { type: 'json' };
import { clampWorld, pushOutOfWalls } from '../map.js';

const GD = () => BAL.groundDrops || { pickupRange: 110, normalChance: 0.08, eliteCount: 1, bossCount: 2, maxItems: 60 };

export function isUniqueGroundDrop(g, sim = null) {
  if (!g) return false;
  if (g.unique) return true;
  const it = g.item;
  if (it) {
    if (it.unique) return true;
    if (it.kind === 'item' && IT.consumables[it.id]?.unique) return true;
  }
  if (sim && sim.map && typeof sim.map.isUniqueGroundItem === 'function') {
    if (sim.map.isUniqueGroundItem(g)) return true;
  }
  return false;
}

export default {
  id: 'groundDrops',
  init(sim) {
    sim.groundItems = [];
    const spawn = (item, x, y, opts = {}) => {
      if (!item) return null;
      const cfg = GD();
      const unique = Boolean(opts.unique || item.unique || (item.kind === 'item' && IT.consumables[item.id]?.unique));
      // 超过上限时优先移除最早的非唯一普通地面道具，绝不挤掉唯一道具
      if (sim.groundItems.length >= cfg.maxItems) {
        const oldIdx = sim.groundItems.findIndex((g) => !isUniqueGroundDrop(g, sim));
        if (oldIdx >= 0) sim.groundItems.splice(oldIdx, 1);
      }
      const pt = { x: Number(x) || sim.hero.x, y: Number(y) || sim.hero.y };
      clampWorld(pt, 24, sim.map);
      pushOutOfWalls(pt, 24, sim.walls);
      const drop = {
        id: sim.uid++,
        item,
        x: pt.x,
        y: pt.y,
        unique,
        manual: Boolean(opts.manual),
        bornAt: sim.t,
      };
      sim.groundItems.push(drop);
      sim.emit('groundSpawn', drop);
      return drop;
    };

    const pickup = (gid, u = sim.ctrl, opts = {}) => {
      const idx = sim.groundItems.findIndex((g) => g.id === gid);
      if (idx < 0) return { ok: false, reason: '地面道具已消失' };
      const g = sim.groundItems[idx];
      const maxR = opts.ignoreRange ? Infinity : (opts.range ?? GD().pickupRange);
      if (u && u.alive && maxR < Infinity) {
        if ((u.x - g.x) ** 2 + (u.y - g.y) ** 2 > maxR * maxR) {
          return { ok: false, reason: '距离太远，走近后拾取' };
        }
      }
      if (!sim.loot.give(g.item)) {
        return { ok: false, reason: '行囊已满，无法拾取' };
      }
      sim.groundItems.splice(idx, 1);
      sim.pushFx({ t: 'loot', x: g.x, y: g.y, text: `拾取 ${g.item.name}`, color: g.unique ? '#ffd36a' : '#9ff0b8', q: g.item.q ?? 0 });
      sim.emit('groundPickup', { drop: g, u });
      return { ok: true, drop: g };
    };

    const clear = (opts = {}) => {
      const pred = opts.protectPredicate || null;
      const kept = [];
      let cleared = 0;
      let keptUnique = 0;
      for (const g of sim.groundItems) {
        const protect = isUniqueGroundDrop(g, sim) || (pred ? !!pred(g) : false);
        if (protect) {
          kept.push(g);
          keptUnique++;
        } else {
          cleared++;
          sim.pushFx({ t: 'ring', x: g.x, y: g.y, r: 28, dur: 0.25, color: 0x9aa3cf });
        }
      }
      sim.groundItems = kept;
      sim.emit('groundClear', { cleared, keptUnique });
      return { ok: true, cleared, keptUnique };
    };

    sim.ground = {
      spawn,
      pickup,
      clear,
      isUnique: (g) => isUniqueGroundDrop(g, sim),
      count: () => sim.groundItems.length,
      uniqueCount: () => sim.groundItems.reduce((a, g) => a + (isUniqueGroundDrop(g, sim) ? 1 : 0), 0),
    };

    // 击杀额外产出地面散落物（与 loot.js 直接入包表独立，不破坏既有 M3 背包断言；BOSS 必掉唯一奇珍）
    sim.on('kill', ({ enemy: e }) => {
      if (!sim.loot) return;
      const cfg = GD();
      const pool = ['pill', 'oil', 'purse', 'swift', 'recall_scroll', 'blink_scroll'];
      if (e.boss) {
        const seal = sim.loot.roll({ id: 'qilin_seal' });
        seal.unique = true;
        spawn(seal, e.x + sim.rand(-24, 24), e.y + sim.rand(-24, 24), { unique: true });
        for (let i = 0; i < (cfg.bossCount || 2); i++) {
          const it = sim.loot.roll({ id: sim.pick(pool) });
          spawn(it, e.x + sim.rand(-64, 64), e.y + sim.rand(-48, 48));
        }
        return;
      }
      if (e.elite) {
        for (let i = 0; i < (cfg.eliteCount || 1); i++) {
          const it = sim.loot.roll({ id: sim.pick(pool) });
          spawn(it, e.x + sim.rand(-40, 40), e.y + sim.rand(-32, 32));
        }
        return;
      }
      if (sim.rng() < (cfg.normalChance || 0.08)) {
        const it = sim.loot.roll({ id: sim.pick(['pill', 'oil', 'purse', 'swift']) });
        spawn(it, e.x + sim.rand(-28, 28), e.y + sim.rand(-22, 22));
      }
    });
  },
  update(sim, dt) {
    const cfg = GD();
    if (!cfg.autoPickup || !sim.groundItems.length) return;
    sim._autoPickT = (sim._autoPickT || 0) + dt;
    if (sim._autoPickT < cfg.autoPickupInterval) return;
    sim._autoPickT = 0;
    let blocked = 0;
    for (const g of sim.groundItems.slice()) {
      if (g.manual || sim.t - g.bornAt < cfg.autoPickupDelay) continue;
      if (!sim.ground.pickup(g.id, null, { ignoreRange: true }).ok) blocked++;
    }
    if (blocked && sim.t >= (sim._autoPickHintAt || 0)) {
      sim._autoPickHintAt = sim.t + cfg.bagFullHintCd;
      sim.banner(`行囊已满 · ${blocked} 件掉落留在地上（整理或出售后自动收取）`, '#ffd36a');
      sim.emit('autoPickupBlocked', { count: blocked });
    }
  },
  commands: {
    pickupGround(sim, c) {
      const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
      return sim.ground.pickup(c.gid, u, { ignoreRange: !!c.ignoreRange });
    },
    pickupNear(sim, c) {
      const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
      if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
      const r = Number(c.range ?? GD().pickupRange);
      const ids = sim.groundItems
        .filter((g) => (g.x - u.x) ** 2 + (g.y - u.y) ** 2 <= r * r)
        .map((g) => g.id);
      if (!ids.length) return { ok: false, reason: '附近没有可拾取的地面道具' };
      let picked = 0;
      for (const id of ids) {
        if (sim.ground.pickup(id, u, { range: r }).ok) picked++;
      }
      return picked > 0 ? { ok: true, picked } : { ok: false, reason: '行囊已满，无法拾取' };
    },
    dropItem(sim, c) {
      const inv = sim.inv;
      const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
      if (!inv || !u || !u.alive) return { ok: false, reason: '无法丢弃' };
      let arr = inv.equipBag;
      let idx = c.bagIdx;
      if (c.itemIdx !== undefined && c.itemIdx !== null) {
        arr = inv.itemBag;
        idx = c.itemIdx;
      } else if (idx >= inv.equipBag.length) {
        arr = inv.itemBag;
        idx = idx - inv.equipBag.length;
      }
      const it = arr[idx];
      if (!it) return { ok: false, reason: '这一格是空的' };
      arr[idx] = null;
      inv.ver++;
      const drop = sim.ground.spawn(it, u.x + sim.rand(-26, 26), u.y + sim.rand(-20, 20), { unique: !!it.unique, manual: true });
      sim.emit('dropItem', { item: it, drop, u });
      return { ok: true, drop };
    },
    clearGroundItems(sim) {
      if (!sim.groundItems.length) return { ok: true, cleared: 0, keptUnique: 0 };
      return sim.ground.clear();
    },
  },
};
