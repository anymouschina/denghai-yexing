// 整图快照：把 Sim 里「会随游戏进行变化的状态」序列化成纯 JSON，读档时灌回一个新建的 Sim。
// 设计要点：
//  1. 对象图序列化（保留共享引用与环：妖物.tgt → 单位、地基.bid → 建筑都能还原成同一个对象）。
//  2. 函数：妖物 update 等具名函数用 fnRegistry 按 id 还原；闭包（技能回调/冲刺落地）无法序列化，
//     丢弃并在对象上记 __lost，由 restoreSim 做善后（移除对应 buff、取消冲刺）。
//  3. 瞬时表现层状态不存：projs（弹体）、zones（区域/预警圈）、fx 队列、input、listeners。
//  4. 读档 = new Sim(同种子同英雄同模式) 再把状态灌进现有的系统对象（保留系统自带的 API 函数与闭包身份）。
import { fnId, fnById } from './fnRegistry.js';
import './registerAll.js';

export const SAVE_VERSION = 1;

// 不进存档的 Sim 顶层字段
const SKIP = new Set([
  'rng', 'listeners', 'handlers', 'statSources', 'beforeDeath', 'systems', 'grid', 'map', 'fx', 'fxOn',
  'input', 'projs', 'zones', 'seed', 'heroId', 'mode',
]);
// 不进存档的单位/妖物字段（含不可序列化的临时闭包状态）
const SKIP_UNIT_KEYS = new Set(['dash']);

const isPlain = (o) => { const p = Object.getPrototypeOf(o); return p === Object.prototype || p === null; };

/** 对象图 → { nodes, root }；nodes[i] = {t:'o'|'a'|'s', v}，引用写成 {"$":i} */
export function encodeGraph(root, opts = {}) {
  const ids = new Map();
  const nodes = [];
  const lost = opts.lost || [];
  const enc = (v, path) => {
    if (v === null || v === undefined) return null;
    const ty = typeof v;
    if (ty === 'number') return Number.isFinite(v) ? v : { $n: String(v) };
    if (ty === 'string' || ty === 'boolean') return v;
    if (ty === 'bigint' || ty === 'symbol') return null;
    if (ty === 'function') {
      const id = fnId(v);
      if (id) return { $f: id };
      lost.push(path);
      return undefined;
    }
    if (ids.has(v)) return { $: ids.get(v) };
    const n = nodes.length;
    ids.set(v, n);
    if (Array.isArray(v)) {
      const node = { t: 'a', v: [] };
      nodes.push(node);
      for (let i = 0; i < v.length; i++) { const e = enc(v[i], `${path}[${i}]`); node.v.push(e === undefined ? null : e); }
    } else if (v instanceof Set) {
      const node = { t: 's', v: [] };
      nodes.push(node);
      for (const x of v) { const e = enc(x, `${path}{}`); if (e !== undefined) node.v.push(e); }
    } else if (v instanceof Map) {
      const node = { t: 'm', v: [] };
      nodes.push(node);
      for (const [k, x] of v) { const e = enc(x, `${path}<${k}>`); if (e !== undefined) node.v.push([k, e]); }
    } else {
      const node = { t: 'o', v: {} };
      nodes.push(node);
      const skipKeys = opts.skipKeys;
      let lostHere = null;
      for (const k of Object.keys(v)) {
        if (skipKeys && skipKeys.has(k) && (v.side || v.kind || v.dash !== undefined)) continue;
        const desc = Object.getOwnPropertyDescriptor(v, k);
        if (desc && desc.get) continue; // 派生属性（如 inv.bag）读档后由系统自己重建
        const x = v[k];
        // 系统对象（$.loot / $.shop …）上的 API 函数由各系统 init 重建，不算丢失
        if (typeof x === 'function' && !fnId(x) && /^\$\.\w+$/.test(path)) continue;
        if (typeof x === 'function' && !fnId(x)) { (lostHere ||= []).push(k); lost.push(`${path}.${k}`); continue; }
        const e = enc(x, `${path}.${k}`);
        if (e !== undefined) node.v[k] = e;
      }
      if (lostHere) node.v.__lost = lostHere;
    }
    return { $: n };
  };
  const rootRef = enc(root, '$');
  return { nodes, root: rootRef };
}

/** 反向：还原对象图。preset: { 顶层键: 已存在的活对象/数组 }，用它们作为对应节点的容器以保留身份与函数成员 */
export function decodeGraph(g, preset = {}) {
  const objs = new Array(g.nodes.length);
  const rootNode = g.nodes[g.root.$];
  const presetByNode = new Map();
  if (rootNode && rootNode.t === 'o') {
    for (const k of Object.keys(preset)) {
      const ref = rootNode.v[k];
      if (ref && typeof ref === 'object' && ref.$ !== undefined && preset[k] && typeof preset[k] === 'object') presetByNode.set(ref.$, preset[k]);
    }
  }
  g.nodes.forEach((n, i) => {
    const live = presetByNode.get(i);
    if (n.t === 'a') { if (live && Array.isArray(live)) { live.length = 0; objs[i] = live; } else objs[i] = []; }
    else if (n.t === 's') objs[i] = new Set();
    else if (n.t === 'm') objs[i] = new Map();
    else objs[i] = live && isPlain(live) && !Array.isArray(live) ? live : {};
  });
  const dec = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (v.$ !== undefined) return objs[v.$];
    if (v.$n !== undefined) return Number(v.$n);
    if (v.$f !== undefined) return fnById(v.$f) || undefined;
    return v;
  };
  g.nodes.forEach((n, i) => {
    const o = objs[i];
    if (n.t === 'a') for (const e of n.v) o.push(dec(e));
    else if (n.t === 's') for (const e of n.v) o.add(dec(e));
    else if (n.t === 'm') for (const [k, e] of n.v) o.set(k, dec(e));
    else for (const k of Object.keys(n.v)) o[k] = dec(n.v[k]);
  });
  return dec(g.root);
}

/** 抓取当前对局快照（纯 JSON 可序列化对象） */
export function captureSim(sim) {
  const state = {};
  for (const k of Object.keys(sim)) {
    if (SKIP.has(k)) continue;
    const v = sim[k];
    if (typeof v === 'function') continue;
    state[k] = v;
  }
  const lost = [];
  const graph = encodeGraph(state, { lost, skipKeys: SKIP_UNIT_KEYS });
  return {
    sim: { seed: sim.seed, heroId: sim.heroId, mode: sim.mode },
    rng: sim.rng.getState ? sim.rng.getState() : null,
    graph,
    lostCount: lost.length,
  };
}

/** 把快照灌进一个新建的 Sim（需同 seed/heroId/mode 构造）。返回 sim。 */
export function restoreSim(sim, snap) {
  const preset = {};
  for (const k of Object.keys(sim)) {
    if (SKIP.has(k) || k === 'hero' || k === 'kongming') continue;
    const v = sim[k];
    if (v && typeof v === 'object') preset[k] = v;
  }
  // units/enemies/buildings 等容器用新对象即可（里面的单位全部来自快照）；保留系统对象的身份
  const state = decodeGraph(snap.graph, preset);
  for (const k of Object.keys(state)) {
    if (SKIP.has(k)) continue;
    if (preset[k] && preset[k] === state[k]) continue; // 已就地灌入
    sim[k] = state[k];
  }
  if (snap.rng !== null && snap.rng !== undefined && sim.rng.setState) sim.rng.setState(snap.rng);
  // 善后：丢失闭包的 buff 直接移除、冲刺取消；清掉所有瞬时表现层状态
  for (const u of sim.units) {
    u.dash = null;
    if (Array.isArray(u.buffs)) {
      const keep = [];
      for (const b of u.buffs) {
        if (b && b.__lost) { if (b.id === 'guijia') u.shield = 0; continue; }
        keep.push(b);
      }
      u.buffs = keep;
    }
    u.prevX = u.x; u.prevY = u.y;
  }
  for (const e of sim.enemies) { e.prevX = e.x; e.prevY = e.y; }
  sim.projs.length = 0;
  sim.zones.length = 0;
  sim.fx.length = 0;
  sim.input.cast.length = 0;
  // 重算属性（statSources 依赖已还原的装备/套装），但生命值必须与存档逐位一致
  for (const u of sim.units) {
    if (!u.alive) continue;
    const hp = u.hp;
    sim.calcStats(u);
    u.hp = Math.min(u.maxHp, hp);
  }
  sim.grid.rebuild(sim.enemies);
  sim.hero = sim.byId(sim.hero && sim.hero.id) || sim.units.find((u) => u.kind === 'hero') || sim.hero;
  sim.kongming = sim.units.find((u) => u.kind === 'kongming') || sim.kongming;
  sim.emit('restored', { t: sim.t, wave: sim.wave.n });
  return sim;
}
