// 「守灯·镇夜」模拟层：纯 JS，不依赖 Phaser，可在浏览器和 Node 里跑（无头平衡/整局机器人）。
// 固定步长 BAL.tick（1/30 秒）。渲染层只读字段 + 消费 fx 队列；所有玩家操作都走 command()。
//
// 扩展点（各系统模块 src/guard/sim/systems/*.js 使用）：
//   sim.on(evt, fn) / sim.emit(evt, data)           事件总线
//   sim.handlers[type] = (sim, cmd) => ({ok, reason}) 命令处理（UI 与机器人共用）
//   sim.statSources.push((unit) => [{stat, add, mul}]) 属性来源（装备、套装、光环）
//   KITS[key] = { q:{cast, ai}, e:…, r:…, f:…, u:… } 技能实现（src/guard/sim/kits/）
import BAL from '../data/balance.json' with { type: 'json' };
import HEROES from '../data/heroes.json' with { type: 'json' };
import UNITS from '../data/units.json' with { type: 'json' };
import ENEMIES from '../data/enemies.json' with { type: 'json' };
import { mulberry32 } from '../../rng.js';
import { Grid } from './grid.js';
import { DEFAULT_MAP, createMap, pushOutOfWalls, clampWorld, realmAt } from './map.js';
import { normalizeWall, segmentHitsWall } from './walls.js';
import { SYSTEMS } from './systems/index.js';
import { KITS } from './kits/index.js';

export const TICK = BAL.tick;
const TAU = Math.PI * 2;
const STAT_KEYS = ['maxHp', 'atk', 'def', 'spd', 'aspd', 'crit', 'critDmg', 'cdr', 'dmg', 'skillDmg', 'dmgTaken', 'ultGain', 'regen'];

export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

export class Sim {
  /** @param {{seed:number, heroId:string, mode:'story'|'endless', fx?:boolean}} o */
  constructor(o) {
    this.seed = o.seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.heroId = o.heroId;
    this.mode = o.mode || 'story';
    this.fxOn = o.fx !== false;
    this.t = 0;
    this.tickN = 0;
    this.uid = 1;
    this.over = null;
    this.copper = BAL.start.copper;
    this.map = o.map ? (o.map.world && o.map.lanes && o.map.walls ? o.map : createMap(o.map)) : DEFAULT_MAP;
    this.walls = this.map.walls.map((w, i) => normalizeWall(w, i));
    this.units = [];
    this.enemies = [];
    this.projs = [];
    this.zones = [];
    this.buildings = [];
    this.foundations = this.map.foundations.map((f) => ({ ...f, bid: null }));
    this.fx = [];
    this.listeners = {};
    this.handlers = {};
    this.statSources = [];
    this.beforeDeath = [];
    this.systems = [];
    this.grid = new Grid();
    this.input = { mx: 0, my: 0, attack: false, aim: null, cast: [], autoAttack: false };
    this.kmAlert = { t: -99, x: 0, y: 0, lastWarn: -99 };
    this.stats = { kills: 0, killsBy: {}, dmgBy: {}, kmDmgTaken: 0, bossKills: 0, copperEarned: 0, maxEnemies: 0 };
    this.wave = { n: 0, nextAt: BAL.waves.firstDelay, spawnLeft: 0, spawnT: 0, lanes: [], boss: null, alive: 0, cleared: true };
    this.usedBossNames = {};
    this._mobSkillLast = {};

    const K = BAL.kongming;
    this.kongming = this.spawnUnit('kongming', 'kongming', K.x, K.y);
    this.hero = this.spawnUnit('hero', o.heroId, K.x, K.y + 150);
    this.party = [this.hero.id];
    this.ctrlId = this.hero.id;
    this.hero.ctrl = true;

    this.handlers.switch = (s, c) => s.switchTo(c.id ?? s.party[c.index]);
    this.handlers.cycle = (s, c) => s.cycle(c.dir || 1);
    this.handlers.moveTo = (s, c) => s.issueOrder({ type: 'move', x: c.x, y: c.y });
    this.handlers.attackMove = (s, c) => s.issueOrder({ type: 'attackMove', x: c.x, y: c.y });
    this.handlers.attackTarget = (s, c) => s.issueOrder({ type: 'attack', targetId: c.targetId });
    this.handlers.hold = (s) => s.issueOrder({ type: 'hold' });
    this.handlers.stop = (s) => s.issueOrder(null);
    this.handlers.buildMove = (s, c) => s.issueOrder({ type: 'buildMove', fid: c.fid });
    this.handlers.pickupMove = (s, c) => s.issueOrder({ type: 'pickupMove', gid: c.gid });
    this.handlers.rallyKongming = (s) => s.issueOrder({ type: 'move', x: s.kongming.x, y: s.kongming.y + 130 });
    this.handlers.upgradeSkill = (s, c) => s.upgradeSkill(c.slot, c.unitId);
    this.handlers.castSkill = (s, c) => {
      const u = c.unitId ? s.byId(c.unitId) : s.ctrl;
      if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
      if (u.kind === 'hero' && u.skillLvs && (u.skillLvs[c.slot] || 0) <= 0) {
        return { ok: false, reason: '该技能尚未学习，请点击 + 号加点学习' };
      }
      const aim = (c.x !== undefined && c.y !== undefined)
        ? { x: Number(c.x), y: Number(c.y) }
        : (c.autoAim ? s.autoAimPoint(u) : null);
      const ok = s.castSkill(u, c.slot, aim);
      if (ok) return { ok: true, slot: c.slot };
      if (c.slot === 'u' && u.energy < BAL.hero.ultEnergy) return { ok: false, reason: `大招能量不足（${Math.floor(u.energy)}%）` };
      if (c.slot !== 'u' && (u.cds[c.slot] || 0) > 0) return { ok: false, reason: `技能冷却中（${u.cds[c.slot].toFixed(1)}s）` };
      return { ok: false, reason: '附近没有可攻击的妖物' };
    };
    this.handlers.basicAttack = (s, c) => {
      const u = c.unitId ? s.byId(c.unitId) : s.ctrl;
      if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
      const aim = (c.x !== undefined && c.y !== undefined)
        ? { x: Number(c.x), y: Number(c.y) }
        : (c.autoAim ? s.autoAimPoint(u) : s.aimPoint(u));
      const ok = s.basicAttack(u, aim);
      return { ok };
    };
    for (const S of SYSTEMS) {
      this.systems.push(S);
      if (S.commands) Object.assign(this.handlers, S.commands);
      if (S.init) S.init(this);
    }
  }

  // ---------------- 事件 / 命令 / 特效 ----------------
  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, data) {
    const ls = this.listeners[evt]; if (ls) for (const f of ls) f(data, this);
    const any = this.listeners['*']; if (any) for (const f of any) f(evt, data, this);
  }
  command(cmd) {
    if (this.over) return { ok: false, reason: '本局已结束' };
    const h = this.handlers[cmd.type];
    if (!h) return { ok: false, reason: `未知命令 ${cmd.type}` };
    const r = h(this, cmd) || { ok: true };
    if (r.ok) this.emit('command', cmd);
    return r;
  }
  pushFx(f) { if (this.fxOn && this.fx.length < 600) this.fx.push(f); }
  banner(text, color = '#ffc977', big = false) { this.pushFx({ t: 'banner', text, color, big }); this.emit('banner', { text }); }

  get ctrl() { return this.byId(this.ctrlId); }
  byId(id) { return this.units.find((u) => u.id === id) || null; }
  rand(a, b) { return a + (b - a) * this.rng(); }
  pick(arr) { return arr[(this.rng() * arr.length) | 0]; }

  // ---------------- 单位 ----------------
  spawnUnit(kind, key, x, y, extra = {}) {
    const def = kind === 'hero'
      ? HEROES[key]
      : kind === 'kongming'
        ? UNITS.kongming
        : kind === 'merc'
          ? UNITS.mercs[key]
          : kind === 'summon'
            ? UNITS.summons?.[key]
            : UNITS.beasts[key];
    if (!def) throw new Error(`未知单位 ${kind}:${key}`);
    const K = BAL.kongming;
    const base = kind === 'kongming'
      ? { maxHp: K.hp, atk: K.atk, def: K.def, spd: 0 }
      : { maxHp: def.hp, atk: def.atk, def: def.def, spd: def.spd };
    const u = {
      id: this.uid++, side: 'ally', kind, key, def, name: kind === 'kongming' ? '孔明' : def.name, x, y, prevX: x, prevY: y, r: kind === 'kongming' ? K.r : def.r, h: def.h,
      base: { aspd: 1, crit: 0.05, critDmg: 1.6, cdr: 0, dmg: 0, skillDmg: 0, dmgTaken: 0, ultGain: 0, regen: 0, ...base },
      stats: null, hp: 0, maxHp: 0, lv: 1, xp: 0, cds: { atk: 0, q: 0, e: 0, r: 0, f: 0, recall: 0, blink: 0 }, energy: 0,
      skillPoints: kind === 'hero' ? 1 : 0,
      skillLvs: kind === 'hero' ? { q: 0, e: 0, r: 0, f: 0, u: 0 } : null,
      awakened: false,
      alive: true, downT: 0, face: 1, ctrl: false, buffs: [], shield: 0, invuln: 0, st: {}, tgt: null, aiT: 0, moving: false,
      flying: !!def.flying, realm: null, home: { x, y }, dirty: true, castAnim: 0, order: null, recall: null, dash: null, deadAnimT: 0, _actionSeq: 0,
      action: { state: 'idle', t: 0, dur: 0, slot: null, ang: 0, seq: 0 }, ...extra,
    };
    this.calcStats(u);
    u.hp = u.maxHp;
    this.units.push(u);
    if (kind === 'beast' || kind === 'merc') this.party.push(u.id);
    this.emit('unitSpawn', u);
    return u;
  }

  markDirty(u) { if (u) u.dirty = true; else for (const x of this.units) x.dirty = true; }

  calcStats(u) {
    const b = u.base;
    const lvl = u.kind === 'hero' ? u.lv - 1 : 0;
    const add = {};
    const mul = {};
    for (const k of STAT_KEYS) { add[k] = 0; mul[k] = 0; }
    const apply = (m) => { if (m.add) add[m.stat] += m.add; if (m.mul) mul[m.stat] += m.mul; };
    for (const bf of u.buffs) for (const m of bf.mods) apply(m);
    if (u.kind === 'hero' && u.awakened && BAL.hero.awakenBonus) {
      const ab = BAL.hero.awakenBonus;
      if (ab.atk) add.atk += ab.atk;
      if (ab.maxHp) add.maxHp += ab.maxHp;
      if (ab.def) add.def += ab.def;
      if (ab.skillDmg) mul.skillDmg += ab.skillDmg;
    }
    for (const src of this.statSources) { const ms = src(u, this); if (ms) for (const m of ms) apply(m); }
    const s = {};
    for (const k of STAT_KEYS) s[k] = (b[k] || 0) + add[k];
    s.maxHp *= 1 + BAL.hero.hpPerLv * lvl;
    s.atk *= 1 + BAL.hero.atkPerLv * lvl;
    s.def *= 1 + (BAL.hero.defPerLv || 0.04) * lvl;
    for (const k of ['maxHp', 'atk', 'def', 'spd', 'aspd', 'critDmg']) s[k] *= 1 + mul[k];
    for (const k of ['crit', 'cdr', 'dmg', 'skillDmg', 'dmgTaken', 'ultGain', 'regen']) s[k] += mul[k];
    s.cdr = Math.min(0.6, s.cdr);
    s.dmgTaken = Math.min(0.78, s.dmgTaken);
    const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    u.stats = s;
    u.maxHp = Math.round(s.maxHp);
    if (u.stats && u.hp > 0) u.hp = Math.min(u.maxHp, Math.max(1, ratio * u.maxHp));
    u.dirty = false;
  }

  addBuff(u, id, t, mods, extra = {}) {
    const old = u.buffs.find((b) => b.id === id);
    if (old) { old.t = Math.max(old.t, t); old.mods = mods; Object.assign(old, extra); } else u.buffs.push({ id, t, mods, ...extra });
    u.dirty = true;
  }

  switchTo(id) {
    const u = this.byId(id);
    if (!u || !u.alive || u.kind === 'kongming' || !this.party.includes(id)) return { ok: false, reason: '该单位不可操控' };
    const cur = this.ctrl;
    if (cur) { cur.ctrl = false; cur.order = null; }
    u.ctrl = true;
    u.order = null;
    this.ctrlId = id;
    this.input.cast.length = 0;
    this.emit('switch', u);
    return { ok: true };
  }

  getHomeAnchor() {
    const a = this.map.homeAnchor;
    if (a && a.x !== undefined && a.y !== undefined) return { x: a.x, y: a.y, r: a.r || 80 };
    return { x: this.kongming.x, y: this.kongming.y + 130, r: 80 };
  }

  getRevivePoint() {
    const rp = this.map.revivePoint;
    if (rp && rp.x !== undefined && rp.y !== undefined) return rp;
    return { x: this.kongming.x, y: this.kongming.y + 160, r: 120, healPct: 0.08, name: '续命泉·复活点' };
  }

  isRegionLocked(x, y) {
    const r = realmAt(x, y, this.map);
    if (!r || !this.realms) return false;
    if (r.hidden) return !this.realms.hiddenOpen;
    return this.realms.state[r.id] === 'locked';
  }

  addWall(wallDef) {
    const w = normalizeWall(wallDef, this.walls.length);
    this.walls.push(w);
    this.emit('wallAdd', w);
    return w;
  }

  damageWall(w, amount, src = null) {
    if (!w || !w.destructible || !w.alive || amount <= 0) return 0;
    const dmg = amount * (100 / (100 + (w.def || 0)));
    w.hp = Math.max(0, w.hp - dmg);
    w.hitT = 0.12;
    this.emit('wallDamage', { wall: w, dmg, src });
    if (w.hp <= 0) {
      w.alive = false;
      this.pushFx({ t: 'boom', x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2, r: 80 });
      this.emit('wallBreach', { wall: w, src });
    }
    return dmg;
  }

  repairWall(wid, amt) {
    const w = this.walls.find((x) => x.id === wid);
    if (!w || !w.destructible || !w.repairable) return { ok: false, reason: '该墙体不可修复' };
    const before = w.hp;
    w.hp = Math.min(w.maxHp, w.hp + Math.max(1, amt ?? w.maxHp));
    w.alive = w.hp > 0;
    const healed = Math.round(w.hp - before);
    if (healed > 0) this.pushFx({ t: 'heal', x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 - 20, v: healed });
    this.emit('wallRepair', { wall: w, healed });
    return { ok: true, wall: w, healed };
  }

  issueOrder(order) {
    const u = this.ctrl;
    if (!u || !u.alive) return { ok: false, reason: '当前无存活操控单位' };
    if (u.recall && order && this.cancelRecall) this.cancelRecall(u, '移动打断');
    if (!order) {
      u.order = null;
      this.emit('order', { u, order: null });
      return { ok: true };
    }
    if (order.type === 'move' || order.type === 'attackMove') {
      const pt = { x: Number(order.x) || u.x, y: Number(order.y) || u.y };
      clampWorld(pt, u.r, this.map);
      u.order = { type: order.type, x: pt.x, y: pt.y };
    } else if (order.type === 'attack') {
      const e = this.enemies.find((x) => x.id === order.targetId && x.alive);
      if (!e) return { ok: false, reason: '目标已消失' };
      u.order = { type: 'attack', targetId: e.id };
    } else if (order.type === 'buildMove') {
      const f = this.foundations.find((x) => x.id === order.fid);
      if (!f) return { ok: false, reason: '无效地基' };
      u.order = { type: 'buildMove', fid: f.id, x: f.x, y: f.y };
    } else if (order.type === 'pickupMove') {
      const g = (this.groundItems || []).find((x) => x.id === order.gid);
      if (!g) return { ok: false, reason: '地面道具已消失' };
      u.order = { type: 'pickupMove', gid: g.id, x: g.x, y: g.y };
    } else if (order.type === 'hold') {
      u.order = { type: 'hold' };
    }
    this.emit('order', { u, order: u.order });
    return { ok: true, order: u.order };
  }

  cycle(dir) {
    const alive = this.party.filter((id) => { const u = this.byId(id); return u && u.alive; });
    if (alive.length < 2) return { ok: false, reason: '没有其他可操控单位' };
    const i = alive.indexOf(this.ctrlId);
    return this.switchTo(alive[(i + dir + alive.length) % alive.length]);
  }

  gainXp(n) {
    const h = this.hero;
    const H = BAL.hero;
    if (h.lv >= H.maxLv) return;
    h.xp += n;
    let need = Math.round(H.xpBase * H.xpGrowth ** (h.lv - 1));
    while (h.xp >= need && h.lv < H.maxLv) {
      h.xp -= need;
      h.lv++;
      h.skillPoints = (h.skillPoints || 0) + 1;
      const awakenLv = H.awakenLv || 30;
      let justAwakened = false;
      if (h.lv >= awakenLv && !h.awakened) {
        h.awakened = true;
        if (h.skillLvs && (h.skillLvs.u || 0) <= 0) h.skillLvs.u = 1;
        justAwakened = true;
      }
      h.dirty = true;
      this.calcStats(h);
      if (h.alive) h.hp = justAwakened ? h.maxHp : Math.min(h.maxHp, h.hp + h.maxHp * 0.3);
      this.pushFx({ t: 'levelup', id: h.id, x: h.x, y: h.y });
      this.emit('levelUp', h);
      if (justAwakened) {
        const ultName = (h.def.skills && h.def.skills.u && h.def.skills.u.name) || '绝技';
        this.pushFx({ t: 'tame', x: h.x, y: h.y, key: h.key, color: 0xffd36a, portal: true });
        this.banner(`⚡ ${h.name} 达到 ${awakenLv} 级 · 解锁觉醒技能【觉醒·${ultName}】！`, '#ffd36a', true);
        this.emit('heroAwaken', { hero: h, lv: h.lv });
      }
      need = Math.round(H.xpBase * H.xpGrowth ** (h.lv - 1));
    }
  }
  xpNeed() { return Math.round(BAL.hero.xpBase * BAL.hero.xpGrowth ** (this.hero.lv - 1)); }

  canUpgradeSkill(u, slot) {
    if (!u || u.kind !== 'hero' || !u.skillLvs || (u.skillPoints || 0) <= 0) return false;
    if (!(slot in u.skillLvs)) return false;
    const H = BAL.hero;
    const cur = u.skillLvs[slot] ?? 0;
    const maxLv = slot === 'u' ? (H.ultMaxLv || 3) : (H.skillMaxLv || 5);
    if (cur >= maxLv) return false;
    if (slot === 'u') {
      const req = (H.ultReqLv || [6, 12, 18])[cur] ?? 99;
      if (u.lv < req) return false;
    }
    return true;
  }

  upgradeSkill(slot, unitId = null) {
    const u = unitId ? this.byId(unitId) : this.hero;
    if (!u || u.kind !== 'hero' || !u.skillLvs) return { ok: false, reason: '只有英雄可升级技能' };
    if (!(slot in u.skillLvs)) return { ok: false, reason: '无效技能槽位' };
    if ((u.skillPoints || 0) <= 0) return { ok: false, reason: '没有可用技能点' };
    const H = BAL.hero;
    const cur = u.skillLvs[slot] ?? 0;
    const maxLv = slot === 'u' ? (H.ultMaxLv || 3) : (H.skillMaxLv || 5);
    if (cur >= maxLv) return { ok: false, reason: '该技能已满级' };
    if (slot === 'u') {
      const req = (H.ultReqLv || [6, 12, 18])[cur] ?? 99;
      if (u.lv < req) return { ok: false, reason: `大招${cur === 0 ? '学习' : `升至 ${cur + 1} 级`}需英雄达到 ${req} 级` };
    }
    u.skillLvs[slot] = cur + 1;
    u.skillPoints--;
    const skName = (u.def.skills && u.def.skills[slot] && u.def.skills[slot].name) || slot.toUpperCase();
    this.pushFx({ t: 'text', x: u.x, y: u.y - 110, text: cur === 0 ? `习得 ${skName} Lv.1` : `${skName} Lv.${cur + 1}`, color: '#ffd36a', size: 20 });
    this.emit('skillUpgrade', { u, slot, lv: cur + 1, learned: cur === 0, skillPoints: u.skillPoints });
    return { ok: true, slot, lv: cur + 1, learned: cur === 0, skillPoints: u.skillPoints };
  }

  // 保证不同 BOSS / 精英首领各自拥有唯一不重复名字（读档可持久化）
  pickUniqueBossName(baseName, roster = [], fallbackPrefix = '冥界煞将') {
    const used = (this.usedBossNames ||= {});
    if (Array.isArray(roster)) {
      for (const cand of roster) {
        if (cand && !used[cand]) {
          used[cand] = 1;
          return cand;
        }
      }
    }
    if (baseName && !used[baseName]) {
      used[baseName] = 1;
      return baseName;
    }
    const titles = ['九幽', '天煞', '玄阴', '劫火', '镇魂', '赤冥', '沧渊', '断魄', '幽都', '蚀月', '焚空', '无常'];
    const roots = ['典军', '鬼帅', '魔校', '煞魁', '妖督', '战灵', '夜叉', '罗刹', '阎将', '冥侯', '暗卫', '冥尊'];
    for (let i = 0; i < titles.length * roots.length; i++) {
      const name = `${titles[i % titles.length]}${roots[Math.floor(i / titles.length) % roots.length]}·${baseName || fallbackPrefix}`;
      if (!used[name]) {
        used[name] = 1;
        return name;
      }
    }
    let idx = 2;
    while (used[`${baseName || fallbackPrefix}·${idx}号`]) idx++;
    const finalName = `${baseName || fallbackPrefix}·${idx}号`;
    used[finalName] = 1;
    return finalName;
  }

  // ---------------- 妖物 ----------------
  spawnEnemy(type, x, y, o = {}) {
    const d = o.def || ENEMIES[type];
    if (!d) throw new Error(`未知妖物 ${type}`);
    const hpMul = o.hpMul || 1;
    const atkMul = o.atkMul || 1;
    const e = {
      id: this.uid++, side: 'enemy', type, def: d, name: o.name || d.name, x, y, prevX: x, prevY: y, r: (d.r || 18) * (o.scale || 1), h: (d.h || 60) * (o.scale || 1), scale: o.scale || 1,
      hp: d.hp * hpMul, maxHp: d.hp * hpMul, atk: d.atk * atkMul, armor: (d.def || 0) * (o.armorMul || 1) + (o.armorBonus || 0), spd: d.spd, range: d.range, cdMax: d.cd, cd: this.rng() * 0.5,
      ai: d.ai, lane: o.lane || null, wp: 1, tgt: null, tgtT: 0, alive: true, st: {}, flying: !!d.flying, copper: o.copper ?? (d.copper || 0), xp: o.xp ?? (d.xp || 0),
      aggro: d.aggro || 200, elite: !!o.elite, boss: o.boss || null, realm: o.realm || null, home: o.home || null, charge: 0, fuse: 0,
      mobSkCd: d.skill ? (2.2 + this.rng() * d.skill.cd) : 0,
      tint: o.tint || null, wave: this.wave.n, face: 1, hitT: 0, ...(o.extra || {}),
    };
    this.enemies.push(e);
    this.emit('enemySpawn', e);
    return e;
  }

  applyStatus(e, kind, t, v = 0) {
    if (!e.alive) return;
    if (e.boss && (kind === 'stun' || kind === 'freeze' || kind === 'root' || kind === 'silence')) t *= 0.35; // BOSS 控制抗性
    const cur = e.st[kind];
    if (kind === 'slow') { if (!cur || cur.v <= v || cur.t < t) e.st.slow = { t: Math.max(t, cur ? cur.t : 0), v: Math.max(v, cur ? cur.v : 0) }; }
    else if (kind === 'burn') { e.st.burn = { t, dps: Math.max(v.dps || 0, cur ? cur.dps : 0), src: v.src, tick: cur ? cur.tick : 0.5 }; }
    else e.st[kind] = Math.max(cur || 0, t);
  }

  // ---------------- 伤害 / 治疗 ----------------
  damage(src, tgt, amount, o = {}) {
    if (!tgt || !tgt.alive || this.over) return 0;
    let dmg = amount;
    let crit = false;
    // trueDmg：真实伤害（百分比斩杀类），不吃暴击/增伤乘区，也无视敌方护甲
    const ss = !o.trueDmg && src && src.stats;
    if (ss) {
      if (o.canCrit !== false && this.rng() < ss.crit) { crit = true; dmg *= ss.critDmg; }
      dmg *= 1 + ss.dmg;
      if (o.skill) {
        dmg *= 1 + ss.skillDmg;
        if (this.hasLegendary && this.hasLegendary(src, 'yanyuedao')) dmg *= 1.25;
      }
    }
    if (tgt.side === 'enemy') {
      if (!o.trueDmg) {
        const pierce = o.pierceArmor || (o.skill && this.hasLegendary && this.hasLegendary(src, 'yanyuedao'));
        dmg *= 100 / (100 + tgt.armor * (pierce ? 0.5 : 1));
      }
    } else {
      if (tgt.invuln > 0) return 0;
      const def = tgt.kind === 'building' ? tgt.def || 0 : tgt.stats.def;
      dmg *= 100 / (100 + def);
      if (tgt.stats) dmg *= 1 - tgt.stats.dmgTaken;
      if (tgt.kind === 'building' && o.bldMul) dmg *= o.bldMul;
      if (tgt.shield > 0) { const a = Math.min(tgt.shield, dmg); tgt.shield -= a; dmg -= a; }
    }
    if (dmg <= 0) return 0;
    tgt.hp -= dmg;
    tgt.hitT = 0.12;
    if (tgt.side === 'ally' && tgt.kind !== 'building' && tgt.hp > 0 && (!tgt.action || (tgt.action.state !== 'ult' && tgt.action.state !== 'cast'))) {
      tgt._actionSeq = (tgt._actionSeq || 0) + 1;
      const hang = src ? Math.atan2(tgt.y - src.y, tgt.x - src.x) : (tgt.face >= 0 ? Math.PI : 0);
      tgt.action = { state: 'hurt', t: 0.18, dur: 0.18, slot: null, ang: hang, seq: tgt._actionSeq };
    }
    const key = src ? (src.kind === 'building' ? `bld:${src.type}` : src.side === 'enemy' ? `enemy:${src.type}` : `${src.kind}:${src.key}`) + (o.tag ? `/${o.tag}` : '') : 'env';
    if (tgt.side === 'enemy') this.stats.dmgBy[key] = (this.stats.dmgBy[key] || 0) + dmg;
    if (src && src.side === 'ally' && src.kind !== 'building' && src.kind !== 'kongming' && tgt.side === 'enemy' && !o.noEnergy) {
      src.energy = Math.min(BAL.hero.ultEnergy, src.energy + dmg * BAL.hero.ultPerDmg * (1 + src.stats.ultGain));
    }
    if (tgt === this.kongming) {
      this.stats.kmDmgTaken += dmg;
      this.kmAlert.t = this.t;
      if (src) { this.kmAlert.x = src.x; this.kmAlert.y = src.y; }
      this.emit('kongmingHit', { src, dmg });
    }
    this.pushFx({ t: 'dmg', x: tgt.x, y: tgt.y - (tgt.h || 60) * 0.8, v: Math.round(dmg), crit, side: tgt.side, km: tgt === this.kongming });
    this.emit('damage', { src, tgt, dmg, crit, o });
    if (tgt.hp <= 0) {
      const ctx = { src, tgt, dmg, o, handled: false };
      for (const fn of this.beforeDeath) {
        fn(ctx, this);
        if (ctx.handled) break;
      }
      if (!ctx.handled) this.kill(tgt, src, o);
    }
    return dmg;
  }

  heal(tgt, amt, src) {
    if (!tgt || !tgt.alive || amt <= 0) return 0;
    const before = tgt.hp;
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + amt);
    const v = tgt.hp - before;
    if (v >= 1) this.pushFx({ t: 'heal', x: tgt.x, y: tgt.y - (tgt.h || 60) * 0.8, v: Math.round(v) });
    this.emit('heal', { src, tgt, v });
    return v;
  }

  kill(tgt, src, o = {}) {
    if (!tgt.alive) return;
    tgt.alive = false;
    tgt.hp = 0;
    if (tgt.side === 'enemy') {
      this.stats.kills++;
      this.stats.killsBy[tgt.type] = (this.stats.killsBy[tgt.type] || 0) + 1;
      if (tgt.copper) this.addCopper(tgt.copper, tgt.x, tgt.y);
      this.gainXp(tgt.xp || 0);
      if (src && src.side === 'ally' && src.energy !== undefined && src.kind !== 'kongming') src.energy = Math.min(BAL.hero.ultEnergy, src.energy + BAL.hero.ultPerKill);
      this.pushFx({ t: 'die', x: tgt.x, y: tgt.y, type: tgt.type, boss: !!tgt.boss, elite: tgt.elite });
      this.emit('kill', { enemy: tgt, src, o });
      return;
    }
    if (tgt.kind === 'building') {
      this.pushFx({ t: 'boom', x: tgt.x, y: tgt.y, r: 90 });
      this.emit('buildingDestroyed', tgt);
      return;
    }
    if (tgt === this.kongming) {
      this.pushFx({ t: 'kmDie', x: tgt.x, y: tgt.y });
      this.end(false, src ? `第 ${this.wave.n} 波 · 孔明被${src.name || '妖物'}所伤` : `第 ${this.wave.n} 波 · 孔明阵亡`);
      return;
    }
    // 友方单位倒下
    tgt.buffs = [];
    tgt.shield = 0;
    tgt.order = null;
    tgt.recall = null;
    tgt.deadAnimT = 0.65;
    tgt._actionSeq = (tgt._actionSeq || 0) + 1;
    tgt.action = { state: 'dead', t: 0.65, dur: 0.65, slot: null, ang: 0, seq: tgt._actionSeq };
    this.pushFx({ t: 'down', id: tgt.id, x: tgt.x, y: tgt.y });
    if (tgt.kind === 'merc') {
      this.party = this.party.filter((id) => id !== tgt.id);
      this.units = this.units.filter((u) => u !== tgt);
    } else if (tgt.kind === 'summon') {
      tgt.downT = 0;
      tgt.ttl = 0;
    } else {
      const R = BAL.respawn;
      tgt.downT = tgt.kind === 'hero' ? R.heroBase + R.heroPerWave * this.wave.n : R.beast;
    }
    this.emit('unitDown', tgt);
    if (tgt.id === this.ctrlId) {
      tgt.ctrl = false;
      const next = this.party.map((id) => this.byId(id)).find((u) => u && u.alive);
      if (next) this.switchTo(next.id);
    }
  }

  addCopper(n, x, y) {
    n = Math.round(n);
    this.copper += n;
    this.stats.copperEarned += n;
    if (x !== undefined) this.pushFx({ t: 'coin', x, y, v: n });
    this.emit('copper', n);
  }

  end(win, reason) {
    if (this.over) return;
    this.over = { win, reason, wave: this.wave.n, t: this.t };
    this.emit('end', this.over);
  }

  // ---------------- 查询 ----------------
  nearestEnemy(x, y, r, filter) {
    let best = null;
    let bd = r * r;
    this.grid.query(x, y, r, (e) => {
      if (filter && !filter(e)) return;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }
  enemiesIn(x, y, r, out = []) {
    this.grid.query(x, y, r + 40, (e) => { if ((e.x - x) ** 2 + (e.y - y) ** 2 <= (r + e.r) ** 2) out.push(e); });
    return out;
  }
  alliesIn(x, y, r, withBuildings = false) {
    const out = [];
    for (const u of this.units) if (u.alive && (u.x - x) ** 2 + (u.y - y) ** 2 <= (r + u.r) ** 2) out.push(u);
    if (withBuildings) for (const b of this.buildings) if (b.alive && (b.x - x) ** 2 + (b.y - y) ** 2 <= (r + b.r) ** 2) out.push(b);
    return out;
  }
  // 敌人数密度最高的点（技能 AI 用）：以候选敌人为圆心统计半径 r 内数量
  bestCluster(x, y, range, r) {
    let best = null;
    let bestN = 0;
    const cands = this.enemiesIn(x, y, range);
    for (let i = 0; i < cands.length; i += Math.max(1, (cands.length / 12) | 0)) {
      const c = cands[i];
      const n = this.enemiesIn(c.x, c.y, r).length;
      if (n > bestN) { bestN = n; best = c; }
    }
    return best ? { x: best.x, y: best.y, n: bestN } : null;
  }

  // 当前操控单位的瞄准点：鼠标优先，否则最近敌人，否则面朝方向
  aimPoint(u) {
    if (u.ctrl && this.input.aim) return this.input.aim;
    return this.autoAimPoint(u);
  }

  // 智能索敌瞄准点（忽略鼠标悬停 HUD 按钮位置，优先同秘境最近敌人，否则面朝方向）
  autoAimPoint(u) {
    const e = this.nearestEnemy(u.x, u.y, 700, (x) => (u.realm ? x.realm === u.realm : (!x.realm || x.openCamp)));
    if (e) return { x: e.x, y: e.y };
    return { x: u.x + u.face * 200, y: u.y };
  }

  // ---------------- 攻击 ----------------
  basicAttack(u, aim) {
    const d = u.def.basic;
    if (!d || u.cds.atk > 0) return false;
    const s = u.stats;
    u.cds.atk = d.cd / s.aspd;
    const a = Math.atan2(aim.y - u.y, aim.x - u.x);
    u.face = Math.cos(a) >= 0 ? 1 : -1;
    u.castAnim = 0.22;
    u._actionSeq = (u._actionSeq || 0) + 1;
    u.action = { state: 'attack', t: 0.28, dur: 0.28, slot: 'atk', ang: a, seq: u._actionSeq };
    const dmg = s.atk * d.coef;
    if (d.type === 'proj') {
      this.addProj({
        side: 'ally', src: u, x: u.x + Math.cos(a) * 20, y: u.y - (u.h || 60) * 0.45 + Math.sin(a) * 20, a, speed: d.speed, life: d.life || (d.range / d.speed),
        dmg, r: 14, pierce: d.pierce || 0, splash: d.splash || 0, tex: d.tex, tint: d.tint, slow: d.slow, slowT: d.slowT, basic: true,
      });
    } else if (d.type === 'melee') {
      const hits = this.enemiesIn(u.x, u.y, d.range);
      for (const e of hits) {
        if (Math.abs(angDiff(Math.atan2(e.y - u.y, e.x - u.x), a)) <= d.arc / 2 || dist2(u, e) < (u.r + e.r) ** 2) this.hitBasic(u, e, dmg);
      }
      this.pushFx({ t: 'slash', x: u.x, y: u.y - (u.h || 60) * 0.35, a, r: d.range, arc: d.arc, id: u.id });
    } else if (d.type === 'chain') {
      let cur = this.nearestEnemy(aim.x, aim.y, 160) || this.nearestEnemy(u.x, u.y, d.range);
      if (!cur || dist2(u, cur) > (d.range + 60) ** 2) { u.cds.atk = 0.15; return false; }
      const hit = new Set();
      let px = u.x; let py = u.y - (u.h || 60) * 0.5;
      for (let j = 0; j <= d.jumps && cur; j++) {
        hit.add(cur.id);
        this.pushFx({ t: 'bolt', x1: px, y1: py, x2: cur.x, y2: cur.y - cur.h * 0.4 });
        this.hitBasic(u, cur, dmg * (j === 0 ? 1 : 0.7));
        px = cur.x; py = cur.y - cur.h * 0.4;
        cur = this.nearestEnemy(cur.x, cur.y, d.jumpR, (e) => !hit.has(e.id));
      }
    }
    return true;
  }

  hitBasic(u, e, dmg) {
    const v = this.damage(u, e, dmg, { basic: true });
    if (v > 0) this.emit('basicHit', { src: u, tgt: e, dmg: v });
    return v;
  }

  castSkill(u, slot, aim) {
    const cfg = u.def.skills && u.def.skills[slot];
    const kit = KITS[u.key] && KITS[u.key][slot];
    if (!cfg || !kit || !u.alive || u.st.stun > 0) return false;
    if (u.kind === 'hero' && u.skillLvs && (u.skillLvs[slot] || 0) <= 0) return false;
    if (slot === 'u') {
      if (u.energy < BAL.hero.ultEnergy) return false;
    } else if (u.cds[slot] > 0) return false;
    const resolvedAim = aim || this.aimPoint(u);
    if (kit.cast(this, u, resolvedAim) === false) return false;
    const ang = Math.atan2(resolvedAim.y - u.y, resolvedAim.x - u.x);
    u.face = Math.cos(ang) >= 0 ? 1 : -1;
    const skLv = (u.skillLvs && u.skillLvs[slot]) || 1;
    const lvCdMul = 1 - Math.min(0.3, (skLv - 1) * (BAL.hero.skillCdCutPerLv || 0.05));
    if (slot === 'u') u.energy = 0; else u.cds[slot] = cfg.cd * lvCdMul * (1 - u.stats.cdr);
    const dur = slot === 'u' ? 0.55 : 0.36;
    u.castAnim = dur;
    u._actionSeq = (u._actionSeq || 0) + 1;
    u.action = { state: slot === 'u' ? 'ult' : 'cast', t: dur, dur, slot, ang, seq: u._actionSeq };
    this.emit('cast', { u, slot, aim: resolvedAim, ang });
    return true;
  }

  addProj(p) {
    if (this.projs.length >= BAL.projCap) return null;
    p.id = this.uid++;
    p.prevX = p.x;
    p.prevY = p.y;
    p.vx = Math.cos(p.a) * p.speed;
    p.vy = Math.sin(p.a) * p.speed;
    p.hit = p.pierce ? new Set() : null;
    p.alive = true;
    this.projs.push(p);
    return p;
  }

  // zone：持续区域（技能范围、陷阱、冰墙、预警圈）。z.tick 秒触发一次 z.onTick(sim,z)；z.block 为真时阻挡地面妖物
  addZone(z) {
    z.id = this.uid++;
    z.alive = true;
    if (z.t === undefined) z.t = z.life ?? 0.5;
    z.tickT = z.tickT ?? 0;
    z.age = 0;
    this.zones.push(z);
    return z;
  }

  // 预警后结算（BOSS/精英大招用）：先画红圈 warn 秒，再执行 fn
  telegraph(x, y, r, warn, fn, color = 0xe0463a) {
    return this.addZone({ x, y, r, t: warn, vis: 'warn', color, total: warn, onEnd: fn, side: 'enemy' });
  }

  // ---------------- 主循环 ----------------
  step() {
    if (this.over) return;
    const dt = TICK;
    // 记录上一 tick 位置，供渲染层 60/120fps 帧间插值
    for (const u of this.units) { u.prevX = u.x; u.prevY = u.y; }
    for (const e of this.enemies) { e.prevX = e.x; e.prevY = e.y; }
    for (const p of this.projs) { p.prevX = p.x; p.prevY = p.y; }
    this.t += dt;
    this.tickN++;
    this.grid.rebuild(this.enemies);
    for (const S of this.systems) if (S.preUpdate) S.preUpdate(this, dt);
    this.updateUnits(dt);
    this.updateEnemies(dt);
    this.updateProjs(dt);
    this.updateZones(dt);
    for (const S of this.systems) if (S.update) S.update(this, dt);
    this.input.cast.length = 0;
    if (this.tickN % 15 === 0) this.compact();
    const n = this.enemies.length;
    if (n > this.stats.maxEnemies) this.stats.maxEnemies = n;
  }

  advance(sec) { const n = Math.round(sec / TICK); for (let i = 0; i < n && !this.over; i++) this.step(); }

  compact() {
    this.units = this.units.filter((u) => u.kind !== 'summon' || u.alive || (u.deadAnimT || 0) > 0);
    this.enemies = this.enemies.filter((e) => e.alive);
    this.projs = this.projs.filter((p) => p.alive);
    this.zones = this.zones.filter((z) => z.alive);
    this.buildings = this.buildings.filter((b) => b.alive || b.keep);
  }

  updateUnits(dt) {
    const inp = this.input;
    for (const u of this.units) {
      if (!u.alive) {
        if (u.deadAnimT > 0) u.deadAnimT = Math.max(0, u.deadAnimT - dt);
        if (u.downT > 0) {
          u.downT -= dt;
          if (u.downT <= 0) this.respawn(u);
        }
        continue;
      }
      if (u.kind === 'summon' && u.ttl !== undefined) {
        u.ttl -= dt;
        if (u.ttl <= 0) {
          u.alive = false;
          u.deadAnimT = 0;
          u.ttl = 0;
          this.pushFx({ t: 'ring', x: u.x, y: u.y, r: 70, dur: 0.4, color: 0x5fe0b8 });
          this.emit('unitDespawn', u);
          continue;
        }
      }
      if (u.dirty) this.calcStats(u);
      for (let i = u.buffs.length - 1; i >= 0; i--) {
        const b = u.buffs[i];
        b.t -= dt;
        if (b.t <= 0) {
          u.buffs.splice(i, 1);
          u.dirty = true;
          if (b.shieldRemove) u.shield = Math.max(0, (u.shield || 0) - b.shieldRemove);
          if (b.onEnd) b.onEnd(this, u);
        }
      }
      for (const k in u.cds) if (u.cds[k] > 0) u.cds[k] -= dt;
      if (u.invuln > 0) u.invuln -= dt;
      if (u.castAnim > 0) u.castAnim -= dt;
      if (u.hitT > 0) u.hitT -= dt;
      if (u.action && u.action.t > 0) {
        u.action.t -= dt;
        if (u.action.t <= 0) u.action = { state: 'idle', t: 0, dur: 0, slot: null, ang: u.action.ang || 0 };
      }
      if (u.st.stun > 0) u.st.stun -= dt;
      if (u.stats.regen > 0) u.hp = Math.min(u.maxHp, u.hp + u.stats.regen * dt);
      if (u.kind === 'kongming') { this.kongmingAct(u, dt); continue; }
      // 复活点续命泉眼：友军站在复活点范围内持续回血
      const rp = this.getRevivePoint();
      if (rp && rp.healPct > 0 && u.hp < u.maxHp && (u.x - rp.x) ** 2 + (u.y - rp.y) ** 2 <= (rp.r || 130) ** 2) {
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * rp.healPct * dt);
      }
      if (u.dash) { this.updateDash(u, dt); continue; }
      if (u.st.stun > 0) continue;
      if (u.ctrl) {
        const len = Math.hypot(inp.mx, inp.my);
        if (len > 0.01) {
          if (u.recall && this.cancelRecall) this.cancelRecall(u, '移动打断');
          u.order = null;
          u.moving = true;
          const sp = u.stats.spd * Math.min(1, len) * dt;
          u.x += (inp.mx / Math.max(1, len)) * sp;
          u.y += (inp.my / Math.max(1, len)) * sp;
          if (Math.abs(inp.mx) > 0.1) u.face = inp.mx > 0 ? 1 : -1;
        } else if (u.recall) {
          u.moving = false;
        } else if (u.order) {
          this.stepOrder(u, dt);
        } else {
          u.moving = false;
          if (!inp.attack && inp.autoAttack) this.autoBasicAttack(u);
        }
        if (!u.recall && inp.attack) this.basicAttack(u, this.aimPoint(u));
        for (const item of inp.cast) {
          if (typeof item === 'string') this.castSkill(u, item, this.aimPoint(u));
          else if (item && item.slot) this.castSkill(u, item.slot, item.aim || this.aimPoint(u));
        }
      } else {
        if (!u.recall) this.aiUnit(u, dt);
      }
      this.collideUnit(u);
      // 同步动画状态机（非动作期间按移动/回城/待机切换）
      if (!u.action || u.action.t <= 0) {
        const nextSt = u.recall ? 'recall' : u.moving ? 'walk' : 'idle';
        if (!u.action || u.action.state !== nextSt) {
          u.action = { state: nextSt, t: 0, dur: 0, slot: null, ang: u.face >= 0 ? 0 : Math.PI };
        }
      }
    }
  }

  // WC3 风格平滑移动 + 遇墙切向滑行，避免沿秘境围墙直线卡死
  moveToward(u, gx, gy, dt) {
    const dx = gx - u.x;
    const dy = gy - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) { u.moving = false; return 0; }
    const sp = Math.min(d, u.stats.spd * dt);
    const ox = u.x; const oy = u.y;
    u.x += (dx / d) * sp;
    u.y += (dy / d) * sp;
    pushOutOfWalls(u, u.r, this.walls, { flying: u.flying });
    clampWorld(u, u.r, this.map);
    // 若被围墙明显阻挡，尝试沿切向方向滑行绕边
    const moved = Math.hypot(u.x - ox, u.y - oy);
    if (moved < sp * 0.35 && sp > 1) {
      const a = Math.atan2(dy, dx);
      let bestX = u.x; let bestY = u.y; let bestDist = (u.x - gx) ** 2 + (u.y - gy) ** 2;
      for (const da of [Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2]) {
        const probe = { x: ox + Math.cos(a + da) * sp, y: oy + Math.sin(a + da) * sp };
        pushOutOfWalls(probe, u.r, this.walls, { flying: u.flying });
        clampWorld(probe, u.r, this.map);
        const pd = (probe.x - gx) ** 2 + (probe.y - gy) ** 2;
        if (pd < bestDist - 0.5) { bestDist = pd; bestX = probe.x; bestY = probe.y; }
      }
      u.x = bestX; u.y = bestY;
    }
    u.moving = true;
    if (Math.abs(u.x - ox) > 0.2) u.face = u.x > ox ? 1 : -1;
    return Math.hypot(gx - u.x, gy - u.y);
  }

  autoBasicAttack(u) {
    const range = (u.def.basic && u.def.basic.range) || 120;
    const e = this.nearestEnemy(u.x, u.y, range + 36, (x) => (u.realm ? x.realm === u.realm : (!x.realm || x.openCamp)));
    if (e && dist2(u, e) <= (range + e.r + 12) ** 2) this.basicAttack(u, e);
  }

  stepOrder(u, dt) {
    const o = u.order;
    if (!o) { u.moving = false; return; }
    const range = (u.def.basic && u.def.basic.range) || 120;
    if (o.type === 'hold') {
      u.moving = false;
      this.autoBasicAttack(u);
      return;
    }
    if (o.type === 'move') {
      const ox = u.x; const oy = u.y;
      const rem = this.moveToward(u, o.x, o.y, dt);
      if (rem <= 14) { u.order = null; u.moving = false; return; }
      o.stuckT = Math.hypot(u.x - ox, u.y - oy) < 0.8 ? (o.stuckT || 0) + dt : 0;
      if (o.stuckT >= 0.45) { u.order = null; u.moving = false; }
      return;
    }
    if (o.type === 'buildMove') {
      const f = this.foundations.find((x) => x.id === o.fid);
      if (!f) { u.order = null; u.moving = false; return; }
      const d = Math.hypot(f.x - u.x, f.y - u.y);
      if (d <= 190) {
        u.order = null;
        u.moving = false;
        this.emit('arrivedFoundation', { u, f });
        return;
      }
      const ox = u.x; const oy = u.y;
      this.moveToward(u, f.x, f.y, dt);
      o.stuckT = Math.hypot(u.x - ox, u.y - oy) < 0.8 ? (o.stuckT || 0) + dt : 0;
      if (o.stuckT >= 0.6) { u.order = null; u.moving = false; }
      return;
    }
    if (o.type === 'pickupMove') {
      const g = (this.groundItems || []).find((x) => x.id === o.gid);
      if (!g) { u.order = null; u.moving = false; return; }
      const d = Math.hypot(g.x - u.x, g.y - u.y);
      const maxR = (BAL.groundDrops && BAL.groundDrops.pickupRange) || 110;
      if (d <= maxR * 0.85) {
        u.order = null;
        u.moving = false;
        if (this.ground) this.ground.pickup(g.id, u);
        return;
      }
      const ox = u.x; const oy = u.y;
      this.moveToward(u, g.x, g.y, dt);
      o.stuckT = Math.hypot(u.x - ox, u.y - oy) < 0.8 ? (o.stuckT || 0) + dt : 0;
      if (o.stuckT >= 0.6) { u.order = null; u.moving = false; }
      return;
    }
    if (o.type === 'attack') {
      const tgt = this.enemies.find((e) => e.id === o.targetId && e.alive);
      if (!tgt) { u.order = null; u.moving = false; return; }
      const reach = range + tgt.r;
      if (dist2(u, tgt) <= reach * reach) {
        u.moving = false;
        this.basicAttack(u, tgt);
      } else {
        this.moveToward(u, tgt.x, tgt.y, dt);
      }
      return;
    }
    if (o.type === 'attackMove') {
      const aggroR = Math.max(420, range + 140);
      const tgt = this.nearestEnemy(u.x, u.y, aggroR, (x) => (u.realm ? x.realm === u.realm : (!x.realm || x.openCamp)));
      if (tgt) {
        const reach = range + tgt.r;
        if (dist2(u, tgt) <= reach * reach) {
          u.moving = false;
          this.basicAttack(u, tgt);
        } else {
          this.moveToward(u, tgt.x, tgt.y, dt);
        }
        return;
      }
      const ox = u.x; const oy = u.y;
      const rem = this.moveToward(u, o.x, o.y, dt);
      if (rem <= 18) { u.order = null; u.moving = false; return; }
      o.stuckT = Math.hypot(u.x - ox, u.y - oy) < 0.8 ? (o.stuckT || 0) + dt : 0;
      if (o.stuckT >= 0.5) { u.order = null; u.moving = false; }
    }
  }

  collideUnit(u) {
    pushOutOfWalls(u, u.r, this.walls, { flying: u.flying });
    clampWorld(u, u.r, this.map);
    const r = realmAt(u.x, u.y, this.map);
    const id = r ? r.id : null;
    if (id !== u.realm) {
      const prev = u.realm;
      u.realm = id;
      this.emit('realmMove', { u, from: prev, to: id });
    }
  }

  // 位移技能：u.dash = {vx, vy, t, onHit?, hitR, hit:Set}
  updateDash(u, dt) {
    const d = u.dash;
    u.x += d.vx * dt;
    u.y += d.vy * dt;
    d.t -= dt;
    if (d.onHit) {
      for (const e of this.enemiesIn(u.x, u.y, d.hitR || 60)) if (!d.hit.has(e.id)) { d.hit.add(e.id); d.onHit(this, u, e); }
    }
    this.collideUnit(u);
    if (d.t <= 0) { u.dash = null; if (d.onEnd) d.onEnd(this, u); }
  }

  respawn(u) {
    const rp = this.getRevivePoint();
    const spread = Math.max(24, (rp.r || 120) * 0.35);
    u.alive = true;
    u.hp = u.maxHp;
    u.x = rp.x + this.rand(-spread, spread);
    u.y = rp.y + this.rand(-spread * 0.5, spread * 0.5);
    clampWorld(u, u.r, this.map);
    pushOutOfWalls(u, u.r, this.walls, { flying: u.flying });
    u.prevX = u.x;
    u.prevY = u.y;
    u.invuln = 2;
    u.downT = 0;
    u.deadAnimT = 0;
    u.st = {};
    u.realm = null;
    u.order = null;
    u.recall = null;
    u.action = { state: 'idle', t: 0, dur: 0, slot: null, ang: 0, seq: u._actionSeq || 0 };
    if (u.id === this.ctrlId) u.ctrl = true;
    this.pushFx({ t: 'respawn', id: u.id, x: u.x, y: u.y });
    this.emit('respawn', u);
  }

  kongmingAct(u) {
    if (u.cds.atk > 0) return;
    const K = BAL.kongming;
    const e = this.nearestEnemy(u.x, u.y, K.range);
    if (!e) return;
    u.cds.atk = K.cd / u.stats.aspd;
    const a = angleTo(u, e);
    u.face = Math.cos(a) >= 0 ? 1 : -1;
    u.castAnim = 0.34;
    u._actionSeq = (u._actionSeq || 0) + 1;
    u.action = { state: 'attack', t: 0.34, dur: 0.34, slot: 'atk', ang: a, seq: u._actionSeq };
    this.addProj({ side: 'ally', src: u, x: u.x, y: u.y - 70, a, speed: 560, life: 0.75, dmg: u.stats.atk, r: 18, pierce: 2, tex: 'proj_ghostfire', tint: 0xbfe8ff, basic: true });
  }

  // 非操控友军 AI：守在孔明附近，打离自己/孔明最近的妖物；技能由 KITS[key][slot].ai 决定是否释放
  aiUnit(u, dt) {
    const K = this.kongming;
    if (u.kind === 'summon') {
      const owner = u.ownerId ? this.byId(u.ownerId) : null;
      if (owner && owner.alive && (owner.realm || null) !== (u.realm || null)) {
        u.realm = owner.realm || null;
        u.x = owner.x + this.rand(-40, 40);
        u.y = owner.y + this.rand(-30, 30);
        u.prevX = u.x;
        u.prevY = u.y;
        u.tgt = null;
      }
      u.aiT -= dt;
      const rFilter = (e) => (u.realm ? e.realm === u.realm : (!e.realm || e.openCamp));
      if (u.aiT <= 0 || !u.tgt || !u.tgt.alive || (u.tgt.realm || null) !== (u.realm || null)) {
        u.aiT = 0.2 + this.rng() * 0.1;
        u.tgt = this.nearestEnemy(u.x, u.y, 750, rFilter)
          || (owner && owner.alive ? this.nearestEnemy(owner.x, owner.y, 750, rFilter) : null);
      }
      const summonKit = KITS[u.key];
      if (summonKit) {
        for (const slot of ['u', 'q', 'e', 'r', 'f']) {
          const k = summonKit[slot];
          if (!k || !k.ai) continue;
          if (slot === 'u' ? u.energy < BAL.hero.ultEnergy : u.cds[slot] > 0) continue;
          const aim = k.ai(this, u);
          if (aim && this.castSkill(u, slot, aim)) break;
        }
        if (u.dash) return;
      }
      const range = (u.def.basic && u.def.basic.range) || 120;
      let gx;
      let gy;
      if (u.tgt) {
        const d = Math.sqrt(dist2(u, u.tgt));
        const want = Math.max(40, range * 0.85 + u.tgt.r * 0.5);
        if (d > want) { gx = u.tgt.x; gy = u.tgt.y; }
        if (d <= range + u.tgt.r) this.basicAttack(u, u.tgt);
      } else if (owner && owner.alive) {
        if ((u.x - owner.x) ** 2 + (u.y - owner.y) ** 2 > 110 * 110) { gx = owner.x + 50; gy = owner.y; }
      } else if (!u.realm) {
        if ((u.x - K.x) ** 2 + (u.y - K.y) ** 2 > 180 * 180) { gx = K.x; gy = K.y + 120; }
      }
      u.moving = gx !== undefined;
      if (u.moving) {
        const a = Math.atan2(gy - u.y, gx - u.x);
        const sp = u.stats.spd * dt;
        u.x += Math.cos(a) * sp;
        u.y += Math.sin(a) * sp;
        u.face = Math.cos(a) >= 0 ? 1 : -1;
      }
      return;
    }
    const leash = u.kind === 'merc' ? 650 : BAL.party.leash;
    u.aiT -= dt;
    if (u.aiT <= 0 || (u.tgt && !u.tgt.alive)) {
      u.aiT = 0.3 + this.rng() * 0.1;
      // 优先：正在打孔明的妖物 → 自己附近 → 孔明附近
      let t = null;
      if (this.t - this.kmAlert.t < 1.5) t = this.nearestEnemy(K.x, K.y, 420, (e) => !e.realm);
      if (!t) t = this.nearestEnemy(u.x, u.y, 520, (e) => !e.realm && (e.x - K.x) ** 2 + (e.y - K.y) ** 2 < leash * leash);
      if (!t) t = this.nearestEnemy(K.x, K.y, leash, (e) => !e.realm);
      u.tgt = t;
    }
    const kit = KITS[u.key];
    if (kit) {
      for (const slot of ['u', 'q', 'e', 'r', 'f']) {
        const k = kit[slot];
        if (!k || !k.ai) continue;
        if (slot === 'u' ? u.energy < BAL.hero.ultEnergy : u.cds[slot] > 0) continue;
        const aim = k.ai(this, u);
        if (aim && this.castSkill(u, slot, aim)) break;
      }
      if (u.dash) return;
    }
    const range = (u.def.basic && u.def.basic.range) || 100;
    let gx;
    let gy;
    if (u.tgt) {
      const d = Math.sqrt(dist2(u, u.tgt));
      const want = Math.max(40, range * 0.85 + u.tgt.r * 0.5);
      if (d > want) { gx = u.tgt.x; gy = u.tgt.y; }
      else if (u.def.basic.type !== 'melee' && d < range * 0.35) { gx = u.x * 2 - u.tgt.x; gy = u.y * 2 - u.tgt.y; } // 远程拉开
      if (d <= range + u.tgt.r) this.basicAttack(u, u.tgt);
    } else {
      // 回到孔明周围的站位
      const idx = this.party.indexOf(u.id);
      const ang = (idx * 2.399) % TAU;
      const hx = K.x + Math.cos(ang) * (150 + (idx % 3) * 50);
      const hy = K.y + Math.sin(ang) * (130 + (idx % 3) * 40);
      if ((u.x - hx) ** 2 + (u.y - hy) ** 2 > 40 * 40) { gx = hx; gy = hy; }
    }
    u.moving = gx !== undefined;
    if (u.moving) {
      const a = Math.atan2(gy - u.y, gx - u.x);
      const sp = u.stats.spd * dt;
      u.x += Math.cos(a) * sp;
      u.y += Math.sin(a) * sp;
      u.face = Math.cos(a) >= 0 ? 1 : -1;
    }
  }

  // ---------------- 妖物 AI ----------------
  updateEnemies(dt) {
    const K = this.kongming;
    const blockers = [];
    for (const b of this.buildings) if (b.alive && b.block) blockers.push(b);
    for (const z of this.zones) if (z.alive && z.block) blockers.push(z);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.hitT > 0) e.hitT -= dt;
      const st = e.st;
      // 状态
      if (st.burn) {
        st.burn.t -= dt;
        st.burn.tick -= dt;
        if (st.burn.tick <= 0) { st.burn.tick = 0.5; this.damage(st.burn.src ? this.byId(st.burn.src) || null : null, e, st.burn.dps * 0.5, { canCrit: false, tag: 'burn', noEnergy: true }); }
        if (st.burn && st.burn.t <= 0) st.burn = null;
        if (!e.alive) continue;
      }
      if (st.slow) { st.slow.t -= dt; if (st.slow.t <= 0) st.slow = null; }
      let frozen = false;
      for (const k of ['stun', 'freeze', 'root', 'silence']) if (st[k] > 0) { st[k] -= dt; if (k === 'stun' || k === 'freeze') frozen = true; }
      if (st.taunt) { st.taunt.t -= dt; if (st.taunt.t <= 0 || !this.byId(st.taunt.id)?.alive) st.taunt = null; }
      if (e.cd > 0) e.cd -= dt;
      if (e.st.silence > 0) {
        if (e.skT !== undefined && e.skT < dt + 0.05) e.skT = dt + 0.05;
        if (e.eliteT !== undefined && e.eliteT < dt + 0.05) e.eliteT = dt + 0.05;
        if (e.mobSkCd !== undefined && e.mobSkCd < dt + 0.05) e.mobSkCd = dt + 0.05;
        if (e.mcd) for (const k in e.mcd) if (e.mcd[k] < dt + 0.05) e.mcd[k] = dt + 0.05;
      }
      if (e.update) { e.update(this, e, dt, frozen); continue; } // BOSS/特殊妖物自带逻辑
      if (frozen) continue;
      this.enemyThink(e, dt, K);
      if (this.tryEnemySkill(e, dt)) continue;
      this.enemyMove(e, dt, K, blockers);
    }
  }

  // 普通怪物与营地小怪主动技能（遵守沉默/眩晕、秘境隔离与群怪节流，避免刷屏卡顿或破坏数值）
  tryEnemySkill(e, dt) {
    const sk = e.def && e.def.skill;
    if (!sk || e.boss || e.training) return false;
    if (this.map && this.map.trainingRoom && e.realm === this.map.trainingRoom.id) return false;
    if (e.st.silence > 0 || e.st.stun > 0 || e.st.freeze > 0) return false;
    if (e.mobSkCd > 0) { e.mobSkCd -= dt; return false; }
    const t = e.tgt;
    if (!t || !t.alive) return false;
    if (e.openCamp && t.kind === 'kongming') return false;
    const range = sk.range || 200;
    if (dist2(e, t) > range * range) return false;
    // 群怪按类型节流：主线普通群怪每种每 2.5 秒最多 1 次施法（精英/营地怪不受限），既清晰展示各类怪物技能，又不因群怪刷屏破坏数值或卡顿
    if (!e.openCamp && !e.elite && !e.realm) {
      if (sk.kind === 'pounce' && t.kind === 'kongming') return false;
      const lastByType = (this._mobSkillLast ||= {});
      const prev = lastByType[e.type] ?? -99;
      if (this.t - prev < 4.5) { e.mobSkCd = 1.2 + this.rng() * 0.8; return false; }
      lastByType[e.type] = this.t;
    }
    e.mobSkCd = sk.cd * (0.9 + this.rng() * 0.25);
    e.face = t.x >= e.x ? 1 : -1;
    const dmg = e.atk * (sk.coef || 1.2);
    if (sk.kind === 'proj') {
      const a = Math.atan2(t.y - e.y, t.x - e.x);
      this.addProj({ side: 'enemy', src: e, x: e.x, y: e.y - e.h * 0.5, a, speed: sk.speed || 320, life: 1.3, dmg, r: 11, tex: sk.tex || 'proj_ghostfire', tint: sk.tint || 0xffd36a });
      return true;
    }
    if (sk.kind === 'fan') {
      const a0 = Math.atan2(t.y - e.y, t.x - e.x);
      const n = sk.n || 3;
      const spread = sk.spread || 0.6;
      for (let i = 0; i < n; i++) {
        const a = a0 - spread * 0.5 + (spread * i) / Math.max(1, n - 1);
        this.addProj({ side: 'enemy', src: e, x: e.x, y: e.y - e.h * 0.5, a, speed: sk.speed || 300, life: 1.25, dmg, r: 10, tex: sk.tex || 'proj_ghostfire', tint: sk.tint || 0xff5ad0 });
      }
      return true;
    }
    if (sk.kind === 'slam' || sk.kind === 'pounce') {
      const tx = t.x; const ty = t.y;
      const r = sk.r || 80;
      const warn = Math.max(0.55, sk.warn || 0.55);
      const color = sk.color || 0xff8a5a;
      this.pushFx({ t: 'warnRing', x: tx, y: ty, r, dur: warn, color });
      this.addZone({
        vis: 'mobWarn', side: 'enemyMob', x: tx, y: ty, r, t: warn, total: warn, color,
        mobSkill: { kind: sk.kind, srcId: e.id, dmg, bldMul: sk.bldMul || 1, color },
      });
      return true;
    }
    if (sk.kind === 'nova') {
      const r = sk.r || 100;
      const warn = Math.max(0.55, sk.warn || 0.55);
      const color = sk.color || 0x80e8ff;
      this.pushFx({ t: 'warnRing', x: e.x, y: e.y, r, dur: warn, color });
      this.addZone({
        vis: 'mobWarn', side: 'enemyMob', x: e.x, y: e.y, r, t: warn, total: warn, color,
        mobSkill: { kind: 'nova', srcId: e.id, dmg, bldMul: sk.bldMul || 1, color },
      });
      return true;
    }
    return false;
  }

  enemyThink(e, dt, K) {
    e.tgtT -= dt;
    if (e.tgt && !e.tgt.alive) e.tgt = null;
    if (e.st.taunt) { e.tgt = this.byId(e.st.taunt.id); return; }
    if (e.tgtT > 0) return;
    e.tgtT = 0.3 + this.rng() * 0.2;
    if (e.ai === 'flyer') { e.tgt = K; return; }
    if (e.realm) {
      // 秘境守卫：只在秘境里追打，离家太远就回去
      let best = null;
      let bd = (e.aggro + 300) ** 2;
      for (const u of this.units) if (u.alive && u.realm === e.realm) { const d = dist2(u, e); if (d < bd) { bd = d; best = u; } }
      e.tgt = best;
      return;
    }
    let best = null;
    let bd = e.aggro * e.aggro;
    if (e.ai === 'siege') {
      for (const b of this.buildings) if (b.alive) { const d = dist2(b, e); if (d < bd) { bd = d; best = b; } }
      e.tgt = best || (dist2(e, K) < 500 * 500 ? K : null);
      return;
    }
    for (const u of this.units) if (u.alive && !u.realm) { const d = dist2(u, e); if (d < bd) { bd = d; best = u; } }
    for (const b of this.buildings) if (b.alive) { const d = dist2(b, e) * 1.3; if (d < bd) { bd = d; best = b; } }
    e.tgt = best;
  }

  enemyMove(e, dt, K, blockers) {
    const slow = e.st.slow ? 1 - Math.min(0.8, e.st.slow.v) : 1;
    let gx;
    let gy;
    const t = e.tgt;
    const reach = t ? e.range + e.r + (t.r || 20) : 0;
    if (t && dist2(e, t) <= reach * reach) {
      this.enemyAttack(e, t);
      e.face = t.x >= e.x ? 1 : -1;
      return;
    }
    if (e.charge > 0) { this.enemyAttack(e, t); return; }
    if (e.fuse > 0) { this.enemyAttack(e, t); return; }
    if (t) { gx = t.x; gy = t.y; }
    else if (e.realm && e.home) { gx = e.home.x; gy = e.home.y; if (dist2(e, e.home) < 30 * 30) return; }
    else if (e.lane) {
      const path = this.map.lanes[e.lane];
      if (path && e.wp < path.length) {
        gx = path[e.wp][0] + (e.ox || 0);
        gy = path[e.wp][1] + (e.oy || 0);
        if ((e.x - gx) ** 2 + (e.y - gy) ** 2 < 70 * 70) e.wp++;
      } else { e.tgt = K; gx = K.x; gy = K.y; }
    } else { gx = K.x; gy = K.y; }
    if (e.st.root > 0) return;
    const a = Math.atan2(gy - e.y, gx - e.x);
    let sp = e.spd * slow * dt;
    if (e.def.hop) sp *= 0.45 + 1.1 * Math.max(0, Math.sin((this.t / e.def.hop) * Math.PI + e.id));
    const nx = e.x + Math.cos(a) * sp;
    const ny = e.y + Math.sin(a) * sp;
    if (!e.flying) {
      for (const b of blockers) {
        const rr = b.r + e.r;
        if ((nx - b.x) ** 2 + (ny - b.y) ** 2 < rr * rr && (e.x - b.x) ** 2 + (e.y - b.y) ** 2 >= (rr - 4) * (rr - 4)) {
          if (b.kind === 'building') e.tgt = b; // 被拒马挡住：先拆它；冰墙只挡不拆，等它化掉
          e.face = b.x >= e.x ? 1 : -1;
          return;
        }
      }
    }
    e.x = nx;
    e.y = ny;
    e.face = Math.cos(a) >= 0 ? 1 : -1;
    // 轻量分离：避免叠成一团
    if ((this.tickN + e.id) % 3 === 0) {
      let n = 0;
      this.grid.query(e.x, e.y, e.r * 2, (o) => {
        if (o === e || n > 5) return;
        const dx = e.x - o.x; const dy = e.y - o.y; const rr = e.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < rr * rr) { const d = Math.sqrt(d2); const p = (rr - d) * 0.5; e.x += (dx / d) * p; e.y += (dy / d) * p; n++; }
      });
    }
    pushOutOfWalls(e, e.r, this.walls, { flying: e.flying });
    if (this.map.trainingRoom && (e.training || e.realm === this.map.trainingRoom.id)) {
      const [tx0, ty0, tx1, ty1] = this.map.trainingRoom.rect;
      e.x = Math.max(tx0 + e.r + 12, Math.min(tx1 - e.r - 12, e.x));
      e.y = Math.max(ty0 + e.r + 12, Math.min(ty1 - e.r - 12, e.y));
    }
  }

  enemyAttack(e, t) {
    const d = e.def;
    if (e.ai === 'bomber') {
      if (e.fuse <= 0) { e.fuse = d.fuse; this.pushFx({ t: 'warnRing', x: e.x, y: e.y, r: d.blastR, dur: d.fuse }); return; }
      e.fuse -= TICK;
      if (e.fuse <= 0) {
        for (const u of this.alliesIn(e.x, e.y, d.blastR, true)) this.damage(e, u, e.atk, { bldMul: d.bldMul });
        this.pushFx({ t: 'boom', x: e.x, y: e.y, r: d.blastR });
        e.copper = Math.ceil(e.copper / 2);
        this.kill(e, null);
      }
      return;
    }
    if (e.ai === 'ranged') {
      if (e.st.silence > 0) {
        e.charge = 0;
        return;
      }
      if (e.charge > 0) {
        e.charge -= TICK;
        if (e.charge <= 0 && t && t.alive) {
          const a = Math.atan2(t.y - e.y, t.x - e.x);
          this.addProj({ side: 'enemy', src: e, x: e.x, y: e.y - e.h * 0.5, a, speed: d.bulletSpeed, life: 1.6, dmg: e.atk, r: 12, tex: 'proj_ghostfire', tint: 0xff5ad0 });
          e.cd = e.cdMax;
        }
        return;
      }
      if (e.cd <= 0 && t) { e.charge = d.charge; this.pushFx({ t: 'charge', id: e.id, dur: d.charge }); }
      return;
    }
    if (e.cd > 0 || !t) return;
    e.cd = e.cdMax;
    e.atkAnim = 0.2;
    this.damage(e, t, e.atk, { bldMul: d.bldMul });
  }

  // ---------------- 弹体 ----------------
  updateProjs(dt) {
    for (const p of this.projs) {
      if (!p.alive) continue;
      const ox = p.x; const oy = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (this.walls && this.walls.length) {
        const hitW = segmentHitsWall(ox, oy, p.x, p.y, this.walls, (w) => !!w.blocksProj, p.r * 0.4);
        if (hitW) {
          if (hitW.wall.destructible && p.side === 'enemy') this.damageWall(hitW.wall, p.dmg, p.src);
          p.alive = false;
          continue;
        }
      }
      if (p.life <= 0) { if (p.splash && p.side === 'ally') this.splash(p); p.alive = false; continue; }
      if (p.side === 'ally') {
        let hitOne = null;
        this.grid.query(p.x, p.y, p.r + 40, (e) => {
          if ((e.x - p.x) ** 2 + (e.y - e.h * 0.4 - p.y) ** 2 > (p.r + e.r) ** 2) return;
          if (p.hit && p.hit.has(e.id)) return;
          hitOne = e;
          return false;
        });
        if (hitOne) {
          const e = hitOne;
          const src = p.src && p.src.alive !== undefined ? p.src : null;
          if (p.onHit) p.onHit(this, p, e);
          else if (p.basic) this.hitBasic(src, e, p.dmg);
          else this.damage(src, e, p.dmg, { skill: p.skill, tag: p.tag });
          if (p.slow) this.applyStatus(e, 'slow', p.slowT || 1.5, p.slow);
          if (p.splash) { this.splash(p, e); p.alive = false; continue; }
          if (p.hit && p.hit.size < p.pierce) p.hit.add(e.id); else p.alive = false;
        }
      } else {
        for (const u of this.units) {
          if (!u.alive) continue;
          if (p.realm && (u.realm || null) !== p.realm) continue;
          if ((u.x - p.x) ** 2 + (u.y - (u.h || 60) * 0.4 - p.y) ** 2 <= (p.r + u.r) ** 2) { this.damage(p.src, u, p.dmg); p.alive = false; break; }
        }
        if (p.alive) {
          for (const b of this.buildings) {
            if (b.alive && (b.x - p.x) ** 2 + (b.y - 30 - p.y) ** 2 <= (p.r + b.r) ** 2) { this.damage(p.src, b, p.dmg); p.alive = false; break; }
          }
        }
      }
    }
  }

  splash(p, center) {
    const x = center ? center.x : p.x;
    const y = center ? center.y : p.y;
    for (const e of this.enemiesIn(x, y, p.splash)) if (e !== center) this.damage(p.src, e, p.dmg * 0.6, { tag: 'splash' });
    this.pushFx({ t: 'boom', x, y, r: p.splash, small: true });
  }

  finishMobSkillZone(z) {
    const ms = z.mobSkill;
    if (!ms || this.over) return;
    const e = this.enemies.find((en) => en.id === ms.srcId);
    if (!e || !e.alive) return;
    const eRealm = e.openCamp ? null : (e.realm || null);
    const hitFilter = (u) => {
      if (!u.alive) return false;
      if (e.openCamp && u.kind === 'kongming') return false;
      return (u.realm || null) === eRealm;
    };
    const cx = ms.kind === 'nova' ? e.x : z.x;
    const cy = ms.kind === 'nova' ? e.y : z.y;
    if (ms.kind === 'pounce') {
      e.x = cx; e.y = cy; e.prevX = cx; e.prevY = cy;
      pushOutOfWalls(e, e.r, this.walls, { flying: e.flying });
    }
    for (const u of this.alliesIn(cx, cy, z.r, true)) {
      if (hitFilter(u)) this.damage(e, u, ms.dmg, { bldMul: ms.bldMul || 1 });
    }
    if (ms.kind === 'nova') {
      this.pushFx({ t: 'ring', x: cx, y: cy, r: z.r, color: ms.color, dur: 0.4 });
    } else {
      this.pushFx({ t: 'boom', x: cx, y: cy, r: z.r, small: true, color: ms.color });
    }
  }

  updateZones(dt) {
    for (const z of this.zones) {
      if (!z.alive) continue;
      z.age += dt;
      z.t -= dt;
      if (z.follow) { const f = this.byId(z.follow); if (f && f.alive) { z.x = f.x; z.y = f.y; } }
      if (z.update) z.update(this, z, dt);
      if (z.onTick && z.tick) {
        z.tickT -= dt;
        if (z.tickT <= 0) { z.tickT += z.tick; z.onTick(this, z); }
      }
      if (z.block && z.hp !== undefined && z.hp <= 0) z.t = 0;
      if (z.t <= 0) {
        z.alive = false;
        if (z.mobSkill) this.finishMobSkillZone(z);
        if (z.onEnd) z.onEnd(this, z);
      }
    }
  }
}

export { BAL, HEROES, UNITS, ENEMIES };
