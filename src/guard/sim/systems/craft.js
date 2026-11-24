// 可复用装备合成与神兵锻造系统（纯数据驱动，配方见 data/recipes.json）：
// 1) 同槽同阶二合一升阶（凡铁→精钢→灵器→仙宝→神兵）
// 2) 名将神兵定向锻造（青龙偃月刀 / 方天画戟 / 朱雀羽扇 / 玄武镇岳甲 / 麒麟圣印 / 卧龙八阵图）
// 命令：craftTierUp { slot, q } 或 { idxA, idxB }；craftRecipe { recipeId }
import RECIPES from '../../data/recipes.json' with { type: 'json' };
import { ITEMS as IT, SLOTS, qColor, qName } from './loot.js';

export { RECIPES };

function findMaterialIndices(equipBag, materials) {
  const used = new Set();
  const picked = [];
  for (const req of materials) {
    const need = req.count || 1;
    // 优先消耗最低品质满足条件的普通非神兵装备，避免误吞已锻造神兵
    const cands = [];
    for (let i = 0; i < equipBag.length; i++) {
      if (used.has(i)) continue;
      const it = equipBag[i];
      if (!it || it.kind !== 'equip' || it.crafted) continue;
      if (req.slot && it.slot !== req.slot) continue;
      if (req.minQ !== undefined && it.q < req.minQ) continue;
      if (req.set && it.set !== req.set) continue;
      cands.push({ i, q: it.q, isSet: it.set && it.set !== 'plain' ? 1 : 0 });
    }
    cands.sort((a, b) => a.q - b.q || a.isSet - b.isSet || a.i - b.i);
    if (cands.length < need) return null;
    for (let k = 0; k < need; k++) {
      used.add(cands[k].i);
      picked.push(cands[k].i);
    }
  }
  return picked;
}

export function countMatchingMaterial(equipBag, req) {
  let n = 0;
  for (const it of equipBag) {
    if (!it || it.kind !== 'equip' || it.crafted) continue;
    if (req.slot && it.slot !== req.slot) continue;
    if (req.minQ !== undefined && it.q < req.minQ) continue;
    if (req.set && it.set !== req.set) continue;
    n++;
  }
  return n;
}

export function craftableTierUps(sim) {
  const out = [];
  if (!sim.inv) return out;
  const bag = sim.inv.equipBag;
  const cfg = RECIPES.tierUp;
  for (const slot of SLOTS) {
    for (let q = 0; q <= cfg.maxSourceQ; q++) {
      const idxs = [];
      for (let i = 0; i < bag.length; i++) {
        const it = bag[i];
        if (it && it.kind === 'equip' && !it.crafted && it.slot === slot && it.q === q) idxs.push(i);
      }
      if (idxs.length >= cfg.count) {
        const cost = cfg.copperByQ[q] ?? 100;
        out.push({
          slot,
          q,
          nextQ: q + 1,
          idxs: idxs.slice(0, cfg.count),
          owned: idxs.length,
          need: cfg.count,
          cost,
          canAfford: sim.copper >= cost,
          label: `2件${qName(q)}${IT.slots[slot].name} → ${qName(q + 1)}${IT.slots[slot].name}`,
        });
      }
    }
  }
  return out;
}

export function evaluateRecipe(sim, recipe) {
  const bag = sim.inv ? sim.inv.equipBag : [];
  const used = new Set();
  const picked = [];
  let hasMaterials = true;
  const mats = recipe.materials.map((req) => {
    const need = req.count || 1;
    const cands = [];
    for (let i = 0; i < bag.length; i++) {
      if (used.has(i)) continue;
      const it = bag[i];
      if (!it || it.kind !== 'equip' || it.crafted) continue;
      if (req.slot && it.slot !== req.slot) continue;
      if (req.minQ !== undefined && it.q < req.minQ) continue;
      if (req.set && it.set !== req.set) continue;
      cands.push({ i, q: it.q, isSet: it.set && it.set !== 'plain' ? 1 : 0 });
    }
    cands.sort((a, b) => a.q - b.q || a.isSet - b.isSet || a.i - b.i);
    const owned = cands.length;
    if (owned < need) {
      hasMaterials = false;
    } else {
      for (let k = 0; k < need; k++) {
        used.add(cands[k].i);
        picked.push(cands[k].i);
      }
    }
    return { ...req, owned, need };
  });
  const hasCopper = sim.copper >= recipe.copper;
  return {
    recipe,
    mats,
    picked: hasMaterials ? picked : null,
    hasMaterials,
    hasCopper,
    canCraft: hasMaterials && hasCopper,
  };
}

function makeLegendary(sim, recipe) {
  return {
    uid: sim.uid++,
    kind: 'equip',
    slot: recipe.slot,
    set: recipe.set || 'plain',
    q: recipe.q ?? 4,
    lv: Math.max(10, sim.wave.n || 1),
    main: { ...recipe.main },
    subs: recipe.subs.map((m) => ({ ...m })),
    name: recipe.name,
    tex: recipe.tex,
    price: Math.round((recipe.copper || 200) * 0.8),
    crafted: true,
    legendaryId: recipe.id,
    passive: recipe.passive,
    passiveTag: recipe.passiveTag || null,
  };
}

export default {
  id: 'craft',
  init(sim) {
    sim.craft = {
      recipes: () => RECIPES.legendaries.map((r) => evaluateRecipe(sim, r)),
      canCraft: (recipeId) => {
        const r = RECIPES.legendaries.find((x) => x.id === recipeId);
        return r ? evaluateRecipe(sim, r).canCraft : false;
      },
      tierUps: () => craftableTierUps(sim),
      craftableCount: () => craftableTierUps(sim).filter((x) => x.canAfford).length
        + RECIPES.legendaries.filter((r) => evaluateRecipe(sim, r).canCraft).length,
    };
  },
  commands: {
    craftTierUp(sim, c) {
      if (!sim.inv) return { ok: false, reason: '行囊未初始化' };
      const bag = sim.inv.equipBag;
      const cfg = RECIPES.tierUp;
      let idxA = c.idxA;
      let idxB = c.idxB;
      if (idxA === undefined || idxB === undefined) {
        const slot = c.slot;
        const q = Number(c.q);
        if (!SLOTS.includes(slot) || !Number.isInteger(q) || q < 0 || q > cfg.maxSourceQ) {
          return { ok: false, reason: '无效的升阶合成参数' };
        }
        const idxs = [];
        for (let i = 0; i < bag.length; i++) {
          const it = bag[i];
          if (it && it.kind === 'equip' && !it.crafted && it.slot === slot && it.q === q) idxs.push(i);
        }
        if (idxs.length < cfg.count) return { ok: false, reason: `需要至少 2 件${qName(q)}${IT.slots[slot].name}` };
        idxA = idxs[0];
        idxB = idxs[1];
      }
      if (idxA === idxB) return { ok: false, reason: '不能用同一件装备合成' };
      const a = bag[idxA];
      const b = bag[idxB];
      if (!a || !b || a.kind !== 'equip' || b.kind !== 'equip') return { ok: false, reason: '所选材料不是装备' };
      if (a.slot !== b.slot || a.q !== b.q) return { ok: false, reason: '升阶合成需要两件同部位同品阶的装备' };
      if (a.q > cfg.maxSourceQ) return { ok: false, reason: '已是最高品阶神兵，无需继续升阶' };
      const cost = cfg.copperByQ[a.q] ?? 100;
      if (sim.copper < cost) return { ok: false, reason: `铜钱不足（需要 ${cost} 钱）` };

      sim.copper -= cost;
      const keepSet = a.set !== 'plain' ? a.set : (b.set !== 'plain' ? b.set : 'plain');
      const nextQ = a.q + 1;
      const lv = Math.max(a.lv || 1, b.lv || 1, sim.wave.n || 1) + 2;
      bag[idxA] = null;
      bag[idxB] = null;
      const out = sim.loot.roll({ slot: a.slot, q: nextQ, set: keepSet, lv, wave: lv });
      bag[idxA] = out;
      sim.inv.ver++;
      sim.pushFx({ t: 'sfx', name: 'chest', vol: 0.75 });
      if (sim.ctrl) sim.pushFx({ t: 'loot', x: sim.ctrl.x, y: sim.ctrl.y - 40, text: `合成 ${qName(out.q)}·${out.name}`, color: qColor(out.q), q: out.q });
      sim.emit('craft', { kind: 'tierUp', item: out, cost });
      return { ok: true, item: out, cost };
    },
    craftRecipe(sim, c) {
      if (!sim.inv) return { ok: false, reason: '行囊未初始化' };
      const recipe = RECIPES.legendaries.find((r) => r.id === c.recipeId);
      if (!recipe) return { ok: false, reason: '未找到该神兵配方' };
      const ev = evaluateRecipe(sim, recipe);
      if (!ev.hasMaterials) return { ok: false, reason: '合成材料不足' };
      if (!ev.hasCopper) return { ok: false, reason: `铜钱不足（需要 ${recipe.copper} 钱）` };
      const bag = sim.inv.equipBag;
      sim.copper -= recipe.copper;
      const targetIdx = ev.picked[0];
      for (const idx of ev.picked) bag[idx] = null;
      const out = makeLegendary(sim, recipe);
      bag[targetIdx] = out;
      sim.inv.ver++;
      sim.banner(`神兵锻成 · 【${out.name}】！`, '#ffd36a', true);
      sim.pushFx({ t: 'sfx', name: 'levelup', vol: 0.9 });
      if (sim.ctrl) sim.pushFx({ t: 'loot', x: sim.ctrl.x, y: sim.ctrl.y - 60, text: `神兵 · ${out.name}`, color: '#ffc94a', q: 4 });
      sim.emit('craft', { kind: 'legendary', recipeId: recipe.id, item: out, cost: recipe.copper });
      return { ok: true, item: out, cost: recipe.copper };
    },
  },
};
