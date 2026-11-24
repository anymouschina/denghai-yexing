// M3 成长：格子背包、四类装备（5 档品质）、5 套套装（2/4 件）、道具、掉落表。
// 状态：sim.inv = {bag: Array(30), equip: {[unitId]: {weapon, armor, accessory, treasure}}, ...}
// 接口：sim.loot.roll/give/chest、sim.activeSets(unit?)、sim.bestSetText()、sim.setCount(unit, set)
// 命令：equip {bagIdx, unitId} / unequip {unitId, slot} / useItem {bagIdx} / sell {bagIdx} / sort
// 事件：itemGain {item} / equip {unit,item,slot} / unequip {unit,item,slot} / setActive {unit,set,pieces} / useItem {item} / bagFull {item, copper}
// 只用 sim.rng()；数值全部在 data/items.json。
import IT from '../../data/items.json' with { type: 'json' };
import BAL from '../../data/balance.json' with { type: 'json' };
import RECIPES from '../../data/recipes.json' with { type: 'json' };

export const SLOTS = ['weapon', 'armor', 'accessory', 'treasure'];
export const SET_IDS = ['wolong', 'baihu', 'zhuque', 'xuanwu', 'qinglong', 'xiangyu', 'xingtian', 'lvbu'];
export const ARTIFACT_IDS = ['nuwa_stone', 'donghuang_bell', 'fuxi_qin', 'pangu_axe', 'xuanyuan_sword'];
const XUANYUAN = RECIPES.legendaries.find((r) => r.id === 'xuanyuan_sword').effect;
export const ITEMS = IT;
export const EQUIP_BAG_SIZE = IT.bagSize || 30;
export const ITEM_BAG_SIZE = IT.itemBagSize || 24;
export const qColor = (q) => IT.qualities[q].color;
export const qHex = (q) => parseInt(IT.qualities[q].color.slice(1), 16);
export const qName = (q) => IT.qualities[q].name;
export const setHex = (id) => parseInt(IT.sets[id].color.slice(1), 16);

export function isUniqueItem(it) {
  if (!it) return false;
  if (it.unique) return true;
  if (it.kind === 'item' && IT.consumables[it.id]?.unique) return true;
  return false;
}

export function itemPowerScore(it) {
  if (!it || it.kind !== 'equip') return 0;
  let score = (it.q + 1) * 100 + (it.crafted ? 250 : 0) + (it.set && it.set !== 'plain' ? 40 : 0);
  const all = itemMods(it);
  for (const m of all) {
    if (m.add !== undefined) score += m.stat === 'maxHp' ? m.add * 0.12 : m.add * 2.2;
    if (m.mul !== undefined) score += m.mul * 220;
  }
  return Math.round(score);
}

// ---------------- 生成 ----------------
function weightedKey(sim, w) {
  let tot = 0;
  for (const k in w) tot += w[k];
  let r = sim.rng() * tot;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return Object.keys(w)[0];
}

/** 品质权重随波数上移：w_q = base_q × (1 + shift × wave)^q */
export function qualityWeights(wave) {
  const k = 1 + IT.qualityShiftPerWave * Math.max(0, wave);
  return IT.qualityWeights.map((b, q) => b * k ** q);
}

function rollQuality(sim, wave, minQ = 0) {
  const w = qualityWeights(wave);
  let tot = 0;
  for (let q = minQ; q < w.length; q++) tot += w[q];
  let r = sim.rng() * tot;
  for (let q = minQ; q < w.length; q++) { r -= w[q]; if (r <= 0) return q; }
  return w.length - 1;
}

export function statValue(stat, q, lv, ratio = 1) {
  const S = IT.stats[stat];
  const lvK = S.flat ? 1 + IT.lvFlat * (lv - 1) : 1 + IT.lvPct * (lv - 1);
  const v = S.base * ratio * IT.qualities[q].mul * lvK;
  return S.flat ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000;
}

const mod = (stat, v) => (IT.stats[stat].kind === 'add' ? { stat, add: v } : { stat, mul: v });

function makeEquip(sim, o) {
  const wave = Math.max(1, o.wave ?? sim.wave.n);
  const slot = o.slot || SLOTS[(sim.rng() * 4) | 0];
  const SL = IT.slots[slot];
  const q = o.q ?? rollQuality(sim, wave, o.minQ || 0);
  const lv = Math.max(1, Math.round(o.lv ?? wave));
  const set = o.set || 'plain';
  const mainStat = SL.main[(sim.rng() * SL.main.length) | 0];
  const main = mod(mainStat, statValue(mainStat, q, lv));
  const subs = [];
  const pool = IT.subPool.filter((s) => s !== mainStat);
  for (let i = 0; i < IT.qualities[q].subs && pool.length; i++) {
    const s = pool.splice((sim.rng() * pool.length) | 0, 1)[0];
    subs.push(mod(s, statValue(s, q, lv, IT.subRatio)));
  }
  const setDef = IT.sets[set] || IT.sets.plain;
  const legendTex = q >= 4 && IT.highTierTex ? IT.highTierTex[`${set}:${slot}`] : null;
  const mappedTex = setDef.texMap && setDef.texMap[SL.code];
  return {
    uid: sim.uid++, kind: 'equip', slot, set, q, lv, main, subs,
    name: setDef.pieces[SL.code], tex: legendTex || mappedTex || `g_eq_${set}_${SL.code}`, tint: setDef.tint || null,
    price: Math.round(IT.qualities[q].sell * (1 + 0.05 * (lv - 1))),
  };
}

function makeConsumable(sim, id) {
  const C = IT.consumables[id];
  return { uid: sim.uid++, kind: 'item', id, name: C.name, tex: C.tex, tint: C.tint || null, unique: !!C.unique, n: 1, price: C.sell };
}

export function syncGrowthEquip(it) {
  if (!it || !it.growth || !it.growthId || !IT.growthGear?.[it.growthId]) return false;
  const gd = IT.growthGear[it.growthId];
  const isHits = (it.growthType || gd.growthType) === 'hits';
  const th = gd.thresholds || (isHits ? [0, 20, 55, 110, 200, 320] : [0, 15, 40, 80, 140, 220]);
  const val = isHits ? (it.hitsTaken || 0) : (it.kills || 0);
  let idx = 0;
  for (let i = 0; i < th.length; i++) {
    if (val >= th[i]) idx = i;
  }
  const prevStage = it.stage || 1;
  const st = gd.stages[Math.min(idx, gd.stages.length - 1)];
  it.stage = idx + 1;
  it.maxStage = gd.stages.length;
  if (isHits) it.nextHits = th[idx + 1] ?? null;
  else it.nextKills = th[idx + 1] ?? null;
  it.q = st.q;
  it.main = { ...st.main };
  it.subs = st.subs.map((m) => ({ ...m }));
  it.name = `${gd.name}·${it.stage}阶`;
  return it.stage > prevStage;
}

export function makeGrowthEquip(sim, growthId) {
  const gd = IT.growthGear && IT.growthGear[growthId];
  if (!gd) return null;
  const growthType = gd.growthType || 'kills';
  const isHits = growthType === 'hits';
  const it = {
    uid: sim.uid++,
    kind: 'equip',
    slot: gd.slot,
    set: gd.set || 'plain',
    q: gd.stages[0].q,
    lv: 1,
    growth: true,
    growthType,
    growthId: gd.id,
    unique: true,
    crafted: true,
    kills: 0,
    hitsTaken: 0,
    stage: 1,
    maxStage: gd.stages.length,
    nextKills: isHits ? null : (gd.thresholds[1] ?? null),
    nextHits: isHits ? (gd.thresholds[1] ?? null) : null,
    main: { ...gd.stages[0].main },
    subs: gd.stages[0].subs.map((m) => ({ ...m })),
    name: `${gd.name}·1阶`,
    tex: gd.tex,
    tint: gd.tint || null,
    desc: gd.desc,
    price: 0,
  };
  return it;
}

export function applyTome(sim, u, C) {
  if (!u || !C) return { ok: false, reason: '无效目标或书卷' };
  if (C.xpGain) {
    sim.gainXp(C.xpGain);
    sim.pushFx({ t: 'text', x: u.x, y: u.y - 110, text: `经验 +${C.xpGain}`, color: '#c47bff', size: 22 });
    sim.emit('useTome', { unit: u, xpGain: C.xpGain, name: C.name });
    return { ok: true };
  }
  if (!C.tome) return { ok: false, reason: '非属性书卷' };
  const ts = (sim.inv.tomeStats[u.id] ||= { atk: 0, maxHp: 0, def: 0, spd: 0, aspd: 0, skillDmg: 0, count: 0 });
  const parts = [];
  for (const [k, v] of Object.entries(C.tome)) {
    ts[k] = (ts[k] || 0) + v;
    const S = IT.stats[k];
    if (S) parts.push(S.kind === 'add' ? `${S.name}+${v}` : `${S.name}+${Math.round(v * 100)}%`);
  }
  ts.count = (ts.count || 0) + 1;
  sim.inv.ver++;
  const prevMax = u.maxHp;
  sim.markDirty(u);
  sim.calcStats(u);
  if (u.alive && u.maxHp > prevMax) u.hp += (u.maxHp - prevMax);
  sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: 78, dur: 0.45, color: 0xffd36a });
  sim.pushFx({ t: 'text', x: u.x, y: u.y - 110, text: `永久 ${parts.join(' ')}`, color: '#ffd36a', size: 20 });
  sim.emit('useTome', { unit: u, tome: C.tome, name: C.name, count: ts.count });
  return { ok: true, stats: ts };
}

function scaleMod(m, mul) {
  if (!m || mul === 1) return m;
  const S = IT.stats[m.stat];
  const flat = S ? S.flat : (m.add !== undefined);
  if (m.add !== undefined) {
    const v = m.add * mul;
    return { ...m, add: flat ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000 };
  }
  if (m.mul !== undefined) {
    const v = m.mul * mul;
    return { ...m, mul: Math.round(v * 1000) / 1000 };
  }
  return m;
}

export function itemMods(it) {
  if (!it || it.kind !== 'equip') return [];
  const lv = it.enhanceLv || 0;
  if (!lv) return [it.main, ...it.subs];
  const mainPerLv = BAL.nanhua?.mainPerLv ?? 0.15;
  const subPerLv = BAL.nanhua?.subPerLv ?? 0.10;
  const mMul = 1 + mainPerLv * lv;
  const sMul = 1 + subPerLv * lv;
  return [scaleMod(it.main, mMul), ...it.subs.map((s) => scaleMod(s, sMul))];
}

export function fmtMod(m) {
  const S = IT.stats[m.stat];
  if (m.add !== undefined) return `${S.name} +${S.flat && m.add % 1 ? m.add.toFixed(1) : Math.round(m.add * 10) / 10}`;
  return `${S.name} +${(m.mul * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

// ---------------- 背包（装备栏与道具/魂痕栏严格分离） ----------------
function resolveSlotRef(inv, c) {
  if (c.itemIdx !== undefined && c.itemIdx !== null) {
    return { arr: inv.itemBag, idx: c.itemIdx, isItemBag: true };
  }
  const bi = c.bagIdx;
  if (bi >= 0 && bi < inv.equipBag.length) {
    return { arr: inv.equipBag, idx: bi, isItemBag: false };
  }
  if (bi >= inv.equipBag.length && bi < inv.equipBag.length + inv.itemBag.length) {
    return { arr: inv.itemBag, idx: bi - inv.equipBag.length, isItemBag: true };
  }
  return { arr: inv.equipBag, idx: -1, isItemBag: false };
}

function give(sim, item) {
  const inv = sim.inv;
  if (item.kind === 'item') {
    const st = inv.itemBag.find((x) => x && x.kind === 'item' && x.id === item.id && x.n < IT.stackMax);
    if (st) { st.n += item.n || 1; inv.ver++; sim.emit('itemGain', { item: st }); return true; }
    const i = inv.itemBag.indexOf(null);
    if (i < 0) return false;
    inv.itemBag[i] = item;
    inv.ver++;
    sim.emit('itemGain', { item });
    return true;
  }
  const i = inv.equipBag.indexOf(null);
  if (i < 0) return false;
  inv.equipBag[i] = item;
  inv.ver++;
  sim.emit('itemGain', { item });
  return true;
}

/** 掉落/奖励入包；满了自动卖成铜钱并提示（唯一道具绝不自动卖，改落地面受保护） */
function grant(sim, item, x, y) {
  if (give(sim, item)) {
    if (x !== undefined) sim.pushFx({ t: 'loot', x, y, text: item.kind === 'equip' ? `${IT.qualities[item.q].name}·${item.name}` : item.name, color: item.kind === 'equip' ? qColor(item.q) : '#9ff0b8', q: item.q ?? 0 });
    return true;
  }
  if (isUniqueItem(item) && sim.ground) {
    sim.ground.spawn(item, x ?? sim.hero.x, y ?? sim.hero.y, { unique: true });
    return false;
  }
  const c = item.price * (item.n || 1);
  sim.addCopper(c, x, y);
  sim.emit('bagFull', { item, copper: c });
  if (x !== undefined) sim.pushFx({ t: 'text', x, y: y - 40, text: `${item.kind === 'equip' ? '装备栏' : '道具栏'}已满 · ${item.name}自动卖出 +${c}`, color: '#ffd36a', size: 16 });
  return false;
}

// ---------------- 套装与多行囊方案 ----------------
export const LOADOUT_COUNT = 3;
const emptyEquip = () => ({ weapon: null, armor: null, accessory: null, treasure: null });

function loadoutsOf(sim, uid) {
  if (!sim.inv.loadouts[uid]) {
    sim.inv.loadouts[uid] = Array.from({ length: LOADOUT_COUNT }, emptyEquip);
    sim.inv.activeLoadout[uid] = 0;
  }
  return sim.inv.loadouts[uid];
}

function slotsOf(sim, uid) {
  const list = loadoutsOf(sim, uid);
  const idx = sim.inv.activeLoadout[uid] || 0;
  sim.inv.equip[uid] = list[idx];
  return list[idx];
}

export function setCounts(sim, u) {
  const eq = sim.inv.equip[u.id];
  const c = {};
  if (!eq) return c;
  for (const s of SLOTS) { const it = eq[s]; if (it && it.set !== 'plain') c[it.set] = (c[it.set] || 0) + 1; }
  return c;
}

function tierOf(n) { return n >= 4 ? 4 : n >= 2 ? 2 : 0; }

function unitMods(sim, u) {
  const eq = sim.inv.equip[u.id];
  const ts = sim.inv.tomeStats && sim.inv.tomeStats[u.id];
  if (!eq && !ts) return null;
  const out = [];
  if (eq) {
    for (const s of SLOTS) for (const m of itemMods(eq[s])) out.push(m);
    const c = setCounts(sim, u);
    for (const id in c) {
      const S = IT.sets[id];
      if (c[id] >= 2) out.push(...S.b2.mods);
      if (c[id] >= 4) out.push(...S.b4.mods);
    }
  }
  if (ts) {
    for (const [k, v] of Object.entries(ts)) {
      if (k === 'count' || !v || !IT.stats[k]) continue;
      out.push(IT.stats[k].kind === 'add' ? { stat: k, add: v } : { stat: k, mul: v });
    }
  }
  return out;
}

function has4(sim, u, set) {
  if (!u || u.side !== 'ally' || u.kind === 'building') return false;
  const t = sim.inv.tiers[u.id];
  return !!t && t[set] >= 4;
}

export function hasLegendary(sim, u, tag) {
  if (!u || !sim.inv || !sim.inv.equip[u.id]) return false;
  const eq = sim.inv.equip[u.id];
  for (const s of SLOTS) {
    if (eq[s] && eq[s].passiveTag === tag) return true;
  }
  return false;
}

/** 装备变化后：重算属性、检测套装激活（只在件数上升到 2/4 时提示） */
function afterChange(sim, u) {
  const inv = sim.inv;
  const prev = inv.tiers[u.id] || {};
  const c = setCounts(sim, u);
  const now = {};
  for (const id of SET_IDS) {
    const t = tierOf(c[id] || 0);
    if (t) now[id] = t;
    if (t > (prev[id] || 0)) {
      const S = IT.sets[id];
      sim.emit('setActive', { unit: u, set: id, pieces: t });
      sim.banner(`${u.name} · ${S.name}${t === 4 ? '四' : '二'}件套激活`, S.color, t === 4);
      sim.pushFx({ t: 'setAura', id: u.id, x: u.x, y: u.y, color: setHex(id), pieces: t });
      const score = t * 10 + (u.kind === 'kongming' ? 1 : 0);
      if (!inv.best || score > inv.best.score) inv.best = { score, set: id, pieces: t, unit: u.name };
    }
  }
  inv.tiers[u.id] = now;
  inv.ver++;
  sim.markDirty(u);
  if (u.alive) sim.calcStats(u);
}

function canWear(u) { return u && (u.kind === 'hero' || u.kind === 'beast' || u.kind === 'kongming'); }

// ---------------- 掉落表 ----------------
function realmSet(e) { return e.realm && IT.sets[e.realm] ? e.realm : null; }

function pickSet(sim, e) {
  const D = IT.drops;
  const rs = realmSet(e);
  if (rs && sim.rng() < D.realmSetChance) return rs;
  if (sim.rng() < D.setChance) return D.worldSets[(sim.rng() * D.worldSets.length) | 0];
  return 'plain';
}

function makeArtifact(sim, artifactId) {
  const id = artifactId || ARTIFACT_IDS[(sim.rng() * ARTIFACT_IDS.length) | 0];
  const recipe = RECIPES.legendaries.find((r) => r.id === id);
  if (!recipe) return null;
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
    tint: recipe.tint || null,
    price: Math.round((recipe.copper || 300) * 0.8),
    crafted: true,
    artifact: true,
    legendaryId: recipe.id,
    passive: recipe.passive,
    passiveTag: recipe.passiveTag || recipe.id,
  };
}

export function dropsFor(sim, e) {
  const D = IT.drops;
  const wave = Math.max(1, e.wave || sim.wave.n);
  const out = [];
  if (e.boss) {
    const rs = realmSet(e);
    const artRoll = !rs && wave >= 10 && sim.rng() < 0.14;
    for (let i = 0; i < D.boss.equipN; i++) {
      if (i === 0 && artRoll) {
        const art = makeArtifact(sim);
        if (art) { out.push(art); continue; }
      }
      const set = rs || (D.bossSets && sim.rng() < 0.7 ? D.bossSets[(sim.rng() * D.bossSets.length) | 0] : pickSet(sim, e));
      out.push(makeEquip(sim, { wave, minQ: D.boss.minQ, set }));
    }
    for (let i = 0; i < D.boss.itemN; i++) out.push(makeConsumable(sim, weightedKey(sim, D.itemWeights)));
    return out;
  }
  if (e.elite) {
    for (let i = 0; i < D.elite.equipN; i++) out.push(makeEquip(sim, { wave, minQ: D.elite.minQ, set: pickSet(sim, e) }));
    if (sim.rng() < D.elite.itemChance) out.push(makeConsumable(sim, weightedKey(sim, D.itemWeights)));
    return out;
  }
  if (sim.rng() < D.normal.equip) out.push(makeEquip(sim, { wave, set: pickSet(sim, e) }));
  for (const id in D.normal.items) if (sim.rng() < D.normal.items[id]) out.push(makeConsumable(sim, id));
  return out;
}

// ---------------- 系统 ----------------
export default {
  id: 'loot',
  init(sim) {
    const inv = {
      equipBag: Array(EQUIP_BAG_SIZE).fill(null),
      itemBag: Array(ITEM_BAG_SIZE).fill(null),
      equip: {},
      loadouts: {},
      activeLoadout: {},
      tomeStats: {},
      tiers: {},
      trig: {},
      ver: 1,
      best: null,
      gained: 0,
      get bag() { return [...this.equipBag, ...this.itemBag]; },
    };
    sim.inv = inv;
    // 合同按 unitId 存；M1 试玩快照读 inv.equip.kongming，这里给个不可枚举的别名（遍历 equip 时不会重复）
    Object.defineProperty(sim.inv.equip, 'kongming', { enumerable: false, get: () => sim.inv.equip[sim.kongming.id] || {} });
    sim.hasLegendary = (u, tag) => hasLegendary(sim, u, tag);
    sim.loot = {
      roll(o = {}) {
        if (o.artifactId) return makeArtifact(sim, o.artifactId);
        if (o.growthId) return makeGrowthEquip(sim, o.growthId);
        if (o.consumable || o.id) return makeConsumable(sim, o.id || weightedKey(sim, IT.drops.itemWeights));
        return makeEquip(sim, o);
      },
      rollArtifact: (artifactId) => makeArtifact(sim, artifactId),
      makeGrowth: (growthId) => makeGrowthEquip(sim, growthId),
      applyTome: (u, C) => applyTome(sim, u, C),
      give: (item) => give(sim, item),
      grant: (item, x, y) => grant(sim, item, x, y),
      chest(n, o = {}) {
        const items = [];
        for (let i = 0; i < n; i++) { const it = sim.loot.roll(o); items.push(it); grant(sim, it, o.x, o.y); }
        return items;
      },
      dropsFor: (e) => dropsFor(sim, e),
    };
    sim.setCount = (u, set) => setCounts(sim, u)[set] || 0;
    sim.activeSets = (u) => {
      const list = u ? [u] : sim.units;
      const out = [];
      for (const x of list) {
        const t = sim.inv.tiers[x.id];
        if (!t) continue;
        for (const id of SET_IDS) if (t[id]) { const s = `${IT.sets[id].name}${t[id]}`; if (!out.includes(s)) out.push(s); }
      }
      return out;
    };
    sim.bestSetText = () => { const b = sim.inv.best; return b ? `${IT.sets[b.set].name}${b.pieces}件（${b.unit}）` : '—'; };

    sim.statSources.push((u) => ((sim.inv.equip[u.id] || sim.inv.tomeStats[u.id]) ? unitMods(sim, u) : null));

    sim.on('kill', ({ enemy: e, src }) => {
      if (!e.training) {
        for (const it of dropsFor(sim, e)) { sim.inv.gained++; grant(sim, it, e.x, e.y); }
      }
      // 杀敌成长装备：穿戴者击杀敌人累计击杀数并自动升阶
      const creditUnit = (src && src.side === 'ally' && sim.inv.equip[src.id]) ? src : sim.hero;
      if (creditUnit && sim.inv.equip[creditUnit.id]) {
        const eq = sim.inv.equip[creditUnit.id];
        let leveled = false;
        let touched = false;
        for (const sl of SLOTS) {
          const git = eq[sl];
          if (git && git.growth && git.growthType !== 'hits') {
            git.kills = (git.kills || 0) + 1;
            touched = true;
            if (syncGrowthEquip(git)) {
              leveled = true;
              sim.banner(`成长神兵升阶 · 【${git.name}】觉醒更强属性！`, '#ffd36a');
              sim.emit('growthLevelUp', { unit: creditUnit, item: git, stage: git.stage, growthType: 'kills' });
            }
          }
        }
        if (touched) sim.inv.ver++;
        if (leveled) {
          sim.markDirty(creditUnit);
          if (creditUnit.alive) sim.calcStats(creditUnit);
        }
      }
      // 杀伐 4 件：击杀回复 2% 生命
      if (has4(sim, src, 'baihu') && src.alive) sim.heal(src, src.maxHp * IT.sets.baihu.b4.killHeal, src);
      // 神兵·方天画戟被动：击杀额外回复 4% 生命
      if (hasLegendary(sim, src, 'fangtian') && src.alive) sim.heal(src, src.maxHp * 0.04, src);
    });

    // 离火 4 件 + 霸王 4 件（对敌伤害触发） / 镇岳 4 件 + 战神 4 件（友军受击触发）
    sim.on('damage', ({ src, tgt, dmg, o }) => {
      if (tgt.side === 'enemy') {
        const tag = o && o.tag;
        if (tag === 'burn' || tag === 'bawangSlam' || tag === 'xingtianRoar' || tag === 'lvbuSlash' || tag === 'thorns' || tag === 'xuanyuan') return;
        // 上古神器·轩辕剑：命中附加目标最大生命百分比真实伤害（每位穿戴者独立内置冷却，AoE 也只结算一次）
        if (tgt.alive && hasLegendary(sim, src, 'xuanyuan_sword')) {
          const tr = (sim.inv.trig[src.id] ||= {});
          if (sim.t >= (tr.xuanyuanAt || 0)) {
            tr.xuanyuanAt = sim.t + XUANYUAN.icd;
            const hy = tgt.y - (tgt.h || 60) * 0.4;
            sim.damage(src, tgt, tgt.maxHp * XUANYUAN.maxHpPct, { trueDmg: true, tag: 'xuanyuan', noEnergy: true });
            sim.pushFx({ t: 'bolt', x1: tgt.x, y1: hy - 220, x2: tgt.x, y2: hy, color: 0xffe08a });
            if (sim.t >= (tr.xuanyuanTextAt || 0)) {
              tr.xuanyuanTextAt = sim.t + 2.5;
              sim.pushFx({ t: 'text', x: tgt.x, y: hy - 70, text: '轩辕·圣道斩妖', color: '#ffe08a', size: 20 });
            }
            sim.emit('artifactProc', { unit: src, artifact: 'xuanyuan_sword', kind: 'pctDamage', tgt });
          }
        }
        if (has4(sim, src, 'zhuque') && tgt.alive) {
          const B = IT.sets.zhuque.b4;
          sim.applyStatus(tgt, 'burn', B.burnT, { dps: (dmg * B.burnPct) / B.burnT, src: src.id });
        }
        if (has4(sim, src, 'xiangyu')) {
          const B = IT.sets.xiangyu.b4;
          const tr = (sim.inv.trig[src.id] ||= {});
          if (sim.t >= (tr.xiangyuAt || 0) && sim.rng() < B.chance) {
            tr.xiangyuAt = sim.t + (B.cd || 2.5);
            const cx = tgt.x;
            const cy = tgt.y;
            const sdmg = (src.stats?.atk || 0) * B.coef;
            for (const e of sim.enemiesIn(cx, cy, B.r)) {
              sim.damage(src, e, sdmg, { pierceArmor: true, skill: true, tag: 'bawangSlam', noEnergy: true });
              if (e.alive) sim.applyStatus(e, 'stun', B.stun || 1.0);
            }
            sim.pushFx({ t: 'bawangSlam', x: cx, y: cy, r: B.r });
            sim.emit('setProc', { unit: src, set: 'xiangyu', skill: 'bawangSlam' });
          }
        }
        return;
      }
      // 镇岳 4 件：低血护盾
      if (has4(sim, tgt, 'xuanwu') && tgt.alive) {
        const B = IT.sets.xuanwu.b4;
        const tr = (sim.inv.trig[tgt.id] ||= {});
        if (tgt.hp / tgt.maxHp < B.shieldBelow && sim.t >= (tr.shieldAt || 0)) {
          tr.shieldAt = sim.t + B.shieldCd;
          tgt.shield = Math.max(tgt.shield || 0, tgt.maxHp * B.shieldPct);
          sim.pushFx({ t: 'setShield', id: tgt.id, x: tgt.x, y: tgt.y });
          sim.emit('setProc', { unit: tgt, set: 'xuanwu' });
        }
      }
      // 战神 4 件（刑天）：受击 25% 触发「战神咆哮」（范围伤害 + 4% 生命回复）
      if (has4(sim, tgt, 'xingtian') && tgt.alive && tgt.hp > 0) {
        const B = IT.sets.xingtian.b4;
        const tr = (sim.inv.trig[tgt.id] ||= {});
        if (sim.t >= (tr.xingtianAt || 0) && sim.rng() < B.chance) {
          tr.xingtianAt = sim.t + (B.cd || 2.0);
          const rdmg = ((tgt.stats?.atk || 0) + (tgt.stats?.def || 0) * (B.defScale || 1.5)) * B.coef;
          for (const e of sim.enemiesIn(tgt.x, tgt.y, B.r)) {
            sim.damage(tgt, e, rdmg, { skill: true, tag: 'xingtianRoar', noEnergy: true });
          }
          sim.heal(tgt, tgt.maxHp * (B.healPct || 0.04), tgt);
          sim.pushFx({ t: 'xingtianRoar', x: tgt.x, y: tgt.y, r: B.r });
          sim.emit('setProc', { unit: tgt, set: 'xingtian', skill: 'xingtianRoar' });
        }
      }
      // 挨打成长神装（龙鳞铠甲 / 的卢马）：友方穿戴者受敌命中累计 hitsTaken 并升阶（0.06s 节流）
      if (tgt.side === 'ally' && src && src.side === 'enemy' && (!o || o.tag !== 'thorns') && sim.inv.equip[tgt.id]) {
        const tr = (sim.inv.trig[tgt.id] ||= {});
        if (sim.t - (tr.hitGrowthAt ?? -99) >= 0.06) {
          const eq = sim.inv.equip[tgt.id];
          let touched = false;
          let leveled = false;
          for (const sl of SLOTS) {
            const git = eq[sl];
            if (git && git.growth && git.growthType === 'hits') {
              if (!touched) { tr.hitGrowthAt = sim.t; touched = true; }
              git.hitsTaken = (git.hitsTaken || 0) + 1;
              if (syncGrowthEquip(git)) {
                leveled = true;
                sim.banner(`挨打成长神装升阶 · 【${git.name}】觉醒更强守护！`, '#7fe3ff');
                sim.emit('growthLevelUp', { unit: tgt, item: git, stage: git.stage, growthType: 'hits' });
              }
            }
          }
          if (touched) sim.inv.ver++;
          if (leveled) {
            sim.markDirty(tgt);
            if (tgt.alive && tgt.hp > 0) sim.calcStats(tgt);
          }
        }
      }
    });

    // 惊雷 4 件（连锁闪电 + 武圣·关羽召唤） + 无双 4 件（吕布乱舞斩）
    sim.on('basicHit', ({ src, tgt }) => {
      if (has4(sim, src, 'qinglong')) {
        const B = IT.sets.qinglong.b4;
        if (sim.rng() < B.chance) {
          const hit = new Set([tgt.id]);
          let px = tgt.x; let py = tgt.y - (tgt.h || 60) * 0.4;
          let cur = sim.nearestEnemy(tgt.x, tgt.y, B.jumpR, (e) => !hit.has(e.id));
          for (let j = 0; j < B.jumps && cur; j++) {
            hit.add(cur.id);
            sim.pushFx({ t: 'bolt', x1: px, y1: py, x2: cur.x, y2: cur.y - cur.h * 0.4, color: 0x7ff0d0 });
            sim.damage(src, cur, src.stats.atk * B.coef, { tag: 'jinglei', noEnergy: true });
            px = cur.x; py = cur.y - cur.h * 0.4;
            cur = sim.nearestEnemy(cur.x, cur.y, B.jumpR, (e) => !hit.has(e.id));
          }
          sim.emit('setProc', { unit: src, set: 'qinglong' });
        }
        if (B.summonChance && src.kind !== 'summon') {
          const tr = (sim.inv.trig[src.id] ||= {});
          if (sim.t >= (tr.guanyuAt || 0) && sim.rng() < B.summonChance) {
            tr.guanyuAt = sim.t + (B.summonCd || 18);
            const gx = src.x + sim.rand(-55, 55);
            const gy = src.y + sim.rand(-40, 40);
            const g = sim.spawnUnit('summon', 'guanyu', gx, gy, {
              ttl: B.summonDur || 14,
              ownerId: src.id,
              realm: src.realm || null,
            });
            sim.collideUnit(g);
            sim.pushFx({ t: 'guanyuSummon', x: g.x, y: g.y, id: g.id, ownerId: src.id, dur: B.summonDur || 14, text: '武圣·关羽' });
            sim.banner(`惊雷显圣 · 【武圣·关羽】降临助战 ${B.summonDur || 14} 秒！`, '#5fe0b8');
            sim.emit('setProc', { unit: src, set: 'qinglong', summon: 'guanyu', summonUnit: g });
          }
        }
      }
      if (has4(sim, src, 'lvbu')) {
        const B = IT.sets.lvbu.b4;
        const tr = (sim.inv.trig[src.id] ||= {});
        if (sim.t >= (tr.lvbuAt || 0) && sim.rng() < B.chance) {
          tr.lvbuAt = sim.t + (B.cd || 1.8);
          const cx = tgt ? tgt.x : src.x;
          const cy = tgt ? tgt.y : src.y;
          const ldmg = (src.stats?.atk || 0) * B.coef;
          for (const e of sim.enemiesIn(cx, cy, B.r)) {
            sim.damage(src, e, ldmg, { pierceArmor: true, tag: 'lvbuSlash', noEnergy: true });
          }
          if (src.alive) sim.heal(src, src.maxHp * (B.lifestealPct || 0.04), src);
          sim.pushFx({ t: 'lvbuSlash', x: cx, y: cy, r: B.r });
          sim.emit('setProc', { unit: src, set: 'lvbu', skill: 'lvbuSlash' });
        }
      }
      // 上古神器·盘古斧：普攻 20% 触发 220 码 2.5 倍破甲重击并沉默 2 秒
      if (hasLegendary(sim, src, 'pangu_axe') && sim.rng() < 0.20) {
        const cx = tgt ? tgt.x : src.x;
        const cy = tgt ? tgt.y : src.y;
        const pdmg = (src.stats?.atk || 0) * 2.5;
        for (const e of sim.enemiesIn(cx, cy, 220)) {
          sim.damage(src, e, pdmg, { pierceArmor: true, skill: true, tag: 'pangu_axe', noEnergy: true });
          if (e.alive) sim.applyStatus(e, 'silence', 2.0);
        }
        sim.pushFx({ t: 'bawangSlam', x: cx, y: cy, r: 220, color: 0xc47bff, text: '盘古开天·沉默！' });
        sim.emit('artifactProc', { unit: src, artifact: 'pangu_axe', kind: 'silence' });
      }
    });

    // 上古神器·女娲石：涅槃复活（穿戴者受致命伤前拦截死亡，冷却 45 秒）
    sim.beforeDeath.push((ctx) => {
      const { tgt } = ctx;
      if (!tgt || tgt.side !== 'ally' || !hasLegendary(sim, tgt, 'nuwa_stone')) return;
      const tr = (sim.inv.trig[tgt.id] ||= {});
      if (sim.t < (tr.nuwaReviveAt || 0)) return;
      tr.nuwaReviveAt = sim.t + 45;
      ctx.handled = true;
      tgt.alive = true;
      tgt.hp = tgt.maxHp;
      tgt.invuln = Math.max(tgt.invuln || 0, 2.5);
      tgt.st = {};
      const healed = new Set();
      for (const a of sim.alliesIn(tgt.x, tgt.y, 320)) {
        healed.add(a);
        sim.heal(a, a.maxHp * (a === sim.kongming ? 0.10 : 0.25), tgt);
      }
      if (sim.kongming && sim.kongming.alive && !healed.has(sim.kongming)) {
        sim.heal(sim.kongming, sim.kongming.maxHp * 0.10, tgt);
      }
      sim.pushFx({ t: 'nuwaRevive', x: tgt.x, y: tgt.y, text: '女娲石·涅槃重生！' });
      sim.banner(`上古神器【女娲石】显圣 · ${tgt.name} 涅槃满血复活！`, '#5fe08a', true);
      sim.emit('artifactProc', { unit: tgt, artifact: 'nuwa_stone', kind: 'revive' });
    });

    // 守卫阵亡会被移出 units：它不能穿装备，所以这里无需回收
    sim.on('unitSpawn', (u) => { if (sim.inv.equip[u.id]) sim.markDirty(u); });
  },

  update(sim) {
    // 卧龙 4 件 + 上古神器（女娲石灵光 / 东皇钟沉默 / 伏羲琴疗愈）
    const B = IT.sets.wolong.b4;
    for (const u of sim.units) {
      if (!u.alive) continue;
      const tr = (sim.inv.trig[u.id] ||= {});
      if (has4(sim, u, 'wolong')) {
        if (tr.bazhenAt === undefined) tr.bazhenAt = sim.t + B.cd;
        if (sim.t >= tr.bazhenAt) {
          const hits = sim.enemiesIn(u.x, u.y, B.r);
          if (hits.length) {
            tr.bazhenAt = sim.t + B.cd;
            for (const e of hits) sim.damage(u, e, u.stats.atk * B.coef, { skill: true, tag: 'bazhen', noEnergy: true });
            sim.pushFx({ t: 'bazhen', x: u.x, y: u.y, r: B.r });
            sim.emit('setProc', { unit: u, set: 'wolong', n: hits.length });
          }
        }
      }
      if (hasLegendary(sim, u, 'nuwa_stone')) {
        if (tr.nuwaAuraAt === undefined) tr.nuwaAuraAt = sim.t + 12;
        if (sim.t >= tr.nuwaAuraAt) {
          const allies = sim.alliesIn(u.x, u.y, 300);
          const needHeal = allies.some((a) => a.hp < a.maxHp) || (sim.kongming?.alive && sim.kongming.hp < sim.kongming.maxHp);
          if (needHeal) {
            tr.nuwaAuraAt = sim.t + 12;
            const healed = new Set();
            for (const a of allies) {
              healed.add(a);
              sim.heal(a, a.maxHp * 0.10, u);
            }
            if (sim.kongming?.alive && !healed.has(sim.kongming)) {
              sim.heal(sim.kongming, sim.kongming.maxHp * 0.10, u);
            }
            sim.pushFx({ t: 'fuxiHeal', x: u.x, y: u.y, r: 300 });
            sim.emit('artifactProc', { unit: u, artifact: 'nuwa_stone', kind: 'heal' });
          }
        }
      }
      if (hasLegendary(sim, u, 'donghuang_bell')) {
        if (tr.donghuangAt === undefined) tr.donghuangAt = sim.t + 10;
        if (sim.t >= tr.donghuangAt) {
          const hits = sim.enemiesIn(u.x, u.y, 280);
          if (hits.length) {
            tr.donghuangAt = sim.t + 10;
            const ddmg = (u.stats?.atk || 0) * 2.2;
            for (const e of hits) {
              sim.damage(u, e, ddmg, { skill: true, tag: 'donghuang', noEnergy: true });
              if (e.alive) sim.applyStatus(e, 'silence', 2.5);
            }
            u.shield = Math.max(u.shield || 0, u.maxHp * 0.15);
            sim.pushFx({ t: 'donghuangSilence', x: u.x, y: u.y, r: 280, text: '东皇钟·万法沉默！' });
            sim.emit('artifactProc', { unit: u, artifact: 'donghuang_bell', kind: 'silence', n: hits.length });
          }
        }
      }
      if (hasLegendary(sim, u, 'fuxi_qin')) {
        if (tr.fuxiAt === undefined) tr.fuxiAt = sim.t + 8;
        if (sim.t >= tr.fuxiAt) {
          const allies = sim.alliesIn(u.x, u.y, 320);
          const active = allies.some((a) => a.hp < a.maxHp) || sim.enemiesIn(u.x, u.y, 500).length > 0;
          if (active) {
            tr.fuxiAt = sim.t + 8;
            for (const a of allies) {
              sim.heal(a, a.maxHp * (a === sim.kongming ? 0.08 : 0.15), u);
              if (a.kind !== 'building') sim.addBuff(a, 'fuxi_melody', 4, [{ stat: 'aspd', mul: 0.20 }, { stat: 'spd', mul: 0.20 }]);
            }
            sim.pushFx({ t: 'fuxiHeal', x: u.x, y: u.y, r: 320 });
            sim.emit('artifactProc', { unit: u, artifact: 'fuxi_qin', kind: 'heal', n: allies.length });
          }
        }
      }
    }
  },

  commands: {
    equip(sim, c) {
      const inv = sim.inv;
      const ref = resolveSlotRef(inv, c);
      const it = ref.idx >= 0 ? ref.arr[ref.idx] : null;
      if (!it) return { ok: false, reason: '这一格是空的' };
      if (it.kind !== 'equip') return { ok: false, reason: '道具不能穿戴' };
      const u = sim.byId(c.unitId);
      if (!canWear(u)) return { ok: false, reason: '该单位不能穿装备' };
      const eq = slotsOf(sim, u.id);
      const old = eq[it.slot];
      eq[it.slot] = it;
      ref.arr[ref.idx] = old || null;
      sim.emit('equip', { unit: u, item: it, slot: it.slot });
      if (old) sim.emit('unequip', { unit: u, item: old, slot: it.slot });
      afterChange(sim, u);
      return { ok: true, swapped: old || null };
    },
    unequip(sim, c) {
      const inv = sim.inv;
      const u = sim.byId(c.unitId);
      const eq = u && inv.equip[u.id];
      const it = eq && eq[c.slot];
      if (!it) return { ok: false, reason: '这个槽位没有装备' };
      const i = inv.equipBag.indexOf(null);
      if (i < 0) return { ok: false, reason: '装备栏已满' };
      eq[c.slot] = null;
      inv.equipBag[i] = it;
      sim.emit('unequip', { unit: u, item: it, slot: c.slot });
      afterChange(sim, u);
      return { ok: true };
    },
    useItem(sim, c) {
      const inv = sim.inv;
      const ref = resolveSlotRef(inv, c);
      const it = ref.idx >= 0 ? ref.arr[ref.idx] : null;
      if (!it) return { ok: false, reason: '这一格是空的' };
      if (it.kind !== 'item') return { ok: false, reason: '装备请点击穿戴' };
      const C = IT.consumables[it.id];
      const cu = sim.ctrl;
      if (it.id === 'pill') {
        if (!cu || !cu.alive) return { ok: false, reason: '当前单位已倒下' };
        if (cu.hp >= cu.maxHp) return { ok: false, reason: '生命已满' };
        sim.heal(cu, cu.maxHp * C.v, cu);
      } else if (it.id === 'oil') {
        const k = sim.kongming;
        if (k.hp >= k.maxHp) return { ok: false, reason: '孔明生命已满' };
        sim.heal(k, k.maxHp * C.v, k);
      } else if (it.id === 'purse') {
        sim.addCopper(C.v, cu ? cu.x : undefined, cu ? cu.y : undefined);
      } else if (it.id === 'swift') {
        if (!cu || !cu.alive) return { ok: false, reason: '当前单位已倒下' };
        sim.addBuff(cu, 'swift', C.t, [{ stat: 'spd', mul: C.v }]);
        sim.pushFx({ t: 'text', x: cu.x, y: cu.y - 100, text: '神行！', color: '#9ff0ff', size: 22 });
      } else if (it.id === 'recall_scroll') {
        if (!sim.startRecall) return { ok: false, reason: '回城系统未启用' };
        const r = sim.startRecall(cu, { fromItem: true });
        if (!r.ok) return r;
      } else if (it.id === 'blink_scroll') {
        if (!sim.performBlink) return { ok: false, reason: '闪现系统未启用' };
        const aim = (c.x !== undefined && c.y !== undefined) ? { x: Number(c.x), y: Number(c.y) } : null;
        const r = sim.performBlink(cu, aim, { useCd: false, fromItem: true, range: C.range || 460, invuln: C.invuln || 0.45, color: 0xc47bff });
        if (!r.ok) return r;
      } else if (it.id === 'km_shield') {
        const k = sim.kongming;
        if (!k || !k.alive) return { ok: false, reason: '孔明已倒下' };
        k.shield = Math.max(k.shield || 0, Math.round(k.maxHp * (C.shieldPct || 0.3)));
        k.invuln = Math.max(k.invuln || 0, C.invuln || 3.0);
        sim.pushFx({ t: 'ring', x: k.x, y: k.y, r: 150, dur: 0.7, color: 0xffd36a });
        sim.pushFx({ t: 'text', x: k.x, y: k.y - 120, text: '护灯金钟！', color: '#ffd36a', size: 26 });
      } else if (it.id === 'repair_kit') {
        const pct = C.healPct || 0.5;
        let repaired = 0;
        for (const b of sim.buildings) {
          if (b.alive && b.hp < b.maxHp) {
            const before = b.hp;
            b.hp = Math.min(b.maxHp, b.hp + b.maxHp * pct);
            if (b.hp > before) {
              repaired++;
              sim.pushFx({ t: 'heal', x: b.x, y: b.y - 60, v: Math.round(b.hp - before) });
            }
          }
        }
        for (const w of (sim.walls || [])) {
          if (w.destructible && w.repairable && w.hp < w.maxHp) {
            const r = sim.repairWall(w.id, Math.round(w.maxHp * pct));
            if (r.ok) repaired++;
          }
        }
        if (!repaired) return { ok: false, reason: '当前没有受损的建筑或城墙' };
        if (cu) sim.pushFx({ t: 'text', x: cu.x, y: cu.y - 105, text: `修缮 ${repaired} 处工事！`, color: '#9ff0b8', size: 22 });
      } else if (it.id === 'stun_charm') {
        if (!cu || !cu.alive) return { ok: false, reason: '当前单位已倒下' };
        const rad = C.r || 320;
        const dmg = (C.dmgBase || 180) + (C.dmgPerWave || 18) * Math.max(1, sim.wave.n);
        const hits = sim.enemiesIn(cu.x, cu.y, rad);
        for (const e of hits) {
          sim.damage(cu, e, dmg, { skill: true, tag: 'stun_charm' });
          sim.applyStatus(e, 'stun', C.stun || 3.0);
        }
        sim.pushFx({ t: 'ring', x: cu.x, y: cu.y, r: rad, dur: 0.5, color: 0x7fe3ff });
        sim.pushFx({ t: 'text', x: cu.x, y: cu.y - 105, text: `镇妖定身（${hits.length}）`, color: '#7fe3ff', size: 24 });
      } else if (it.id === 'qilin_seal') {
        sim.addCopper(C.v || 150, cu ? cu.x : undefined, cu ? cu.y : undefined);
        if (cu && cu.alive && cu.kind === 'hero') cu.energy = 100;
        if (cu) sim.pushFx({ t: 'text', x: cu.x, y: cu.y - 110, text: '灯魂印信 · 能量满盈！', color: '#ffd36a', size: 24 });
      } else if (C && (C.tome || C.xpGain)) {
        const targetU = (cu && cu.alive) ? cu : sim.hero;
        if (!targetU || !targetU.alive) return { ok: false, reason: '当前单位已倒下' };
        const r = applyTome(sim, targetU, C);
        if (!r.ok) return r;
      } else if (C && C.grantGrowth) {
        const gEq = makeGrowthEquip(sim, C.grantGrowth);
        if (!gEq) return { ok: false, reason: '未知成长装备' };
        if (!give(sim, gEq)) return { ok: false, reason: '装备栏已满，请先腾出 1 格装备栏' };
        sim.banner(`获得唯一杀敌成长神兵【${gEq.name}】！穿戴后随击杀自动升阶`, '#ffd36a', true);
      } else if (C && C.beast) {
        if (!cu || !cu.alive) return { ok: false, reason: '当前单位已倒下' };
        const existing = sim.units.find((u) => u.kind === 'beast' && u.key === C.beast);
        if (!existing) {
          const sx = cu.x + sim.rand(-60, 60);
          const sy = cu.y + sim.rand(-40, 40);
          const b = sim.spawnUnit('beast', C.beast, sx, sy);
          sim.collideUnit(b);
          if (sim.realms && !sim.realms.tamed.includes(b.id)) sim.realms.tamed.push(b.id);
          sim.pushFx({ t: 'tame', x: b.x, y: b.y, key: C.beast, color: 0xffd36a, name: b.name, id: b.id });
          sim.banner(`魂痕召唤 · 神兽 ${b.name} 降临助阵！`, '#ffd36a', true);
          sim.emit('summonBeast', { beast: b, item: it });
        } else {
          existing.alive = true;
          existing.downT = 0;
          existing.hp = existing.maxHp;
          existing.x = cu.x + sim.rand(-50, 50);
          existing.y = cu.y + sim.rand(-35, 35);
          sim.collideUnit(existing);
          sim.addBuff(existing, 'soul_empower', 30, [{ stat: 'atk', mul: 0.25 }, { stat: 'aspd', mul: 0.25 }]);
          sim.pushFx({ t: 'ring', x: existing.x, y: existing.y, r: 95, dur: 0.6, color: 0xffd36a });
          sim.banner(`${existing.name} 魂痕共振 · 满血归位并强化 30 秒！`, '#ffd36a');
          sim.emit('summonBeast', { beast: existing, item: it, empowered: true });
        }
      }
      it.n--;
      if (it.n <= 0) ref.arr[ref.idx] = null;
      inv.ver++;
      sim.emit('useItem', { item: it });
      return { ok: true };
    },
    sell(sim, c) {
      const inv = sim.inv;
      const ref = resolveSlotRef(inv, c);
      const it = ref.idx >= 0 ? ref.arr[ref.idx] : null;
      if (!it) return { ok: false, reason: '这一格是空的' };
      if (isUniqueItem(it)) return { ok: false, reason: `唯一道具【${it.name}】不可出售` };
      if (it.kind === 'item' && it.n > 1) it.n--; else ref.arr[ref.idx] = null;
      sim.addCopper(it.price);
      inv.ver++;
      return { ok: true, copper: it.price, item: it };
    },
    sellLowTier(sim, c) {
      const inv = sim.inv;
      const maxQ = c.maxQ ?? 0;
      let sold = 0;
      let copper = 0;
      for (let i = 0; i < inv.equipBag.length; i++) {
        const it = inv.equipBag[i];
        if (!it || it.kind !== 'equip') continue;
        if (isUniqueItem(it) || it.crafted || (it.set && it.set !== 'plain')) continue;
        if (it.q <= maxQ) {
          sold++;
          copper += it.price;
          inv.equipBag[i] = null;
        }
      }
      if (!sold) return { ok: false, reason: '没有可批量出售的低阶普通装备' };
      sim.addCopper(copper);
      inv.ver++;
      return { ok: true, sold, copper };
    },
    switchLoadout(sim, c) {
      const u = sim.byId(c.unitId);
      if (!canWear(u)) return { ok: false, reason: '该单位不能切换套装方案' };
      const idx = Math.floor(Number(c.index));
      if (!Number.isFinite(idx) || idx < 0 || idx >= LOADOUT_COUNT) return { ok: false, reason: '无效的行囊套装编号' };
      const list = loadoutsOf(sim, u.id);
      sim.inv.activeLoadout[u.id] = idx;
      sim.inv.equip[u.id] = list[idx];
      afterChange(sim, u);
      sim.emit('switchLoadout', { unit: u, index: idx });
      return { ok: true, index: idx };
    },
    sort(sim) {
      const inv = sim.inv;
      const eqs = inv.equipBag.filter(Boolean);
      eqs.sort((a, b) => (b.crafted ? 1 : 0) - (a.crafted ? 1 : 0)
        || (b.q - a.q)
        || (SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot))
        || (itemPowerScore(b) - itemPowerScore(a))
        || a.uid - b.uid);
      inv.equipBag = Array(EQUIP_BAG_SIZE).fill(null);
      eqs.forEach((x, i) => { inv.equipBag[i] = x; });

      const its = inv.itemBag.filter(Boolean);
      its.sort((a, b) => (isUniqueItem(b) ? 1 : 0) - (isUniqueItem(a) ? 1 : 0)
        || a.id.localeCompare(b.id)
        || a.uid - b.uid);
      inv.itemBag = Array(ITEM_BAG_SIZE).fill(null);
      its.forEach((x, i) => { inv.itemBag[i] = x; });

      inv.ver++;
      return { ok: true };
    },
  },
};
