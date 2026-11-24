// 可复用铜钱功能道具商店 & 快捷道具栏系统（数据驱动、地图无关）：
// - 商品列表默认读取 items.json 中带 buy > 0 的道具；任意新地图可通过 map.shopCatalog 覆盖商品表。
// - 命令：buyItem { itemId, count? } / useQuickItem { itemId, x?, y? }
import IT from '../../data/items.json' with { type: 'json' };

export const QUICK_ITEM_IDS = ['pill', 'oil', 'recall_scroll', 'blink_scroll', 'km_shield', 'repair_kit'];

/** 返回当前地图的商店目录数组 */
export function shopCatalog(sim) {
  if (sim && sim.map && Array.isArray(sim.map.shopCatalog)) {
    return sim.map.shopCatalog.map((entry) => {
      const id = typeof entry === 'string' ? entry : entry.id;
      const base = IT.consumables[id];
      if (!base) return null;
      return { id, ...base, ...(typeof entry === 'object' ? entry : {}) };
    }).filter(Boolean);
  }
  return Object.entries(IT.consumables)
    .filter(([, def]) => def.buy > 0)
    .map(([id, def]) => ({ id, ...def }));
}

export function countItemInBag(sim, itemId) {
  if (!sim.inv) return 0;
  let total = 0;
  const arr = sim.inv.itemBag || sim.inv.bag;
  for (const it of arr) {
    if (it && it.kind === 'item' && it.id === itemId) total += it.n || 1;
  }
  return total;
}

export function canFitItem(sim, itemId, count = 1) {
  if (!sim.inv) return false;
  let left = count;
  const arr = sim.inv.itemBag || sim.inv.bag;
  for (const it of arr) {
    if (it && it.kind === 'item' && it.id === itemId && it.n < IT.stackMax) {
      left -= (IT.stackMax - it.n);
      if (left <= 0) return true;
    }
  }
  const emptySlots = arr.filter((x) => !x).length;
  return emptySlots * IT.stackMax >= left;
}

export function bookstoreCatalog(sim) {
  return shopCatalog(sim).filter((x) => !!x.book);
}

export default {
  id: 'shop',
  init(sim) {
    sim.shop = {
      catalog: () => shopCatalog(sim),
      books: () => bookstoreCatalog(sim),
      count: (id) => countItemInBag(sim, id),
    };
  },
  commands: {
    buyBook(sim, c) {
      const list = bookstoreCatalog(sim);
      const entry = list.find((x) => x.id === c.itemId);
      if (!entry) return { ok: false, reason: '书店未出售此书卷' };
      const u = (sim.ctrl && sim.ctrl.alive) ? sim.ctrl : sim.hero;
      if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
      const count = Math.max(1, Math.min(20, Math.floor(Number(c.count) || 1)));
      const totalCost = entry.buy * count;
      if (sim.copper < totalCost) return { ok: false, reason: `铜钱不足（需要 ${totalCost}）` };
      sim.copper -= totalCost;
      for (let i = 0; i < count; i++) {
        sim.loot.applyTome(u, entry);
      }
      sim.pushFx({ t: 'sfx', name: 'levelup', vol: 0.5 });
      sim.emit('buyBook', { itemId: entry.id, count, cost: totalCost, unit: u });
      return { ok: true, itemId: entry.id, count, cost: totalCost };
    },
    buyItem(sim, c) {
      const list = shopCatalog(sim);
      const entry = list.find((x) => x.id === c.itemId);
      if (!entry) return { ok: false, reason: '商店未出售此道具' };
      const count = Math.max(1, Math.floor(Number(c.count) || 1));
      const totalCost = entry.buy * count;
      if (sim.copper < totalCost) return { ok: false, reason: `铜钱不足（需要 ${totalCost}）` };
      if (!canFitItem(sim, entry.id, count)) return { ok: false, reason: '行囊已满，无法购买' };
      sim.copper -= totalCost;
      for (let i = 0; i < count; i++) {
        const item = sim.loot.roll({ id: entry.id });
        sim.loot.give(item);
      }
      sim.pushFx({ t: 'sfx', name: 'click', vol: 0.7 });
      sim.emit('buyItem', { itemId: entry.id, count, cost: totalCost });
      return { ok: true, itemId: entry.id, count, cost: totalCost };
    },
    useQuickItem(sim, c) {
      if (!sim.inv) return { ok: false, reason: '行囊未初始化' };
      const arr = sim.inv.itemBag || sim.inv.bag;
      const idx = arr.findIndex((it) => it && it.kind === 'item' && it.id === c.itemId);
      if (idx < 0) return { ok: false, reason: '道具栏中没有该道具，可按 P 在商店购买' };
      return sim.command({ type: 'useItem', itemIdx: idx, x: c.x, y: c.y });
    },
  },
};
