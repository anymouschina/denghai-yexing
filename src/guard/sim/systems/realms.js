// M4/v3.5 秘境系统（可复用 + 可重复刷 + 项羽/刑天终极秘境）：
// - 四角神兽秘境 + 隐藏麒麟秘境 + 传送挑战秘境（霸王·项羽 / 战神·刑天）均数据驱动。
// - 首通掉落唯一魂痕/战魂并收服参战；之后支持冷却自动重生或手动「再次挑战」无限重刷高阶装备/套装/铜钱（不再重复刷唯一魂痕）。
// - 主线妖物照常推进：本系统不暂停、不改波次。数值见 data/realms.json。
import BAL from '../../data/balance.json' with { type: 'json' };
import RD from '../../data/realms.json' with { type: 'json' };
import ENEMIES from '../../data/enemies.json' with { type: 'json' };
import { REALMS, HIDDEN, EXTRA_REALMS, ALL_REALMS, pushOutOfWalls, inRect } from '../map.js';
import { regFn } from '../../persist/fnRegistry.js';

const H = BAL.hiddenRealm;

function allRealmsOf(sim) {
  if (!sim || !sim.map) return ALL_REALMS;
  const out = [...(sim.map.realms || REALMS)];
  if (sim.map.hiddenRealm) out.push(sim.map.hiddenRealm);
  if (sim.map.extraRealms) out.push(...sim.map.extraRealms);
  return out;
}

function geoOf(sim, id) {
  return allRealmsOf(sim).find((r) => r.id === id) || ALL_REALMS.find((r) => r.id === id) || null;
}

export const realmDef = (id) => RD.realms[id];
export const realmGeo = (id) => ALL_REALMS.find((r) => r.id === id) || null;

const alliesInRealm = (sim, id) => sim.units.filter((u) => u.alive && u.kind !== 'kongming' && u.realm === id);
const guardsOf = (sim, id) => sim.enemies.filter((e) => e.alive && e.realm === id);

// 秘境内的「营地」中心：从秘境中心往远离门的方向偏一点
function campOf(r) {
  const [x0, y0, x1, y1] = r.rect;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (r.hidden || r.portal) return [cx + 120, cy];
  const sx = r.gate[0] === x1 ? -1 : 1;
  const sy = r.gate[1] === y1 ? -1 : 1;
  return [cx + sx * 120, cy + sy * 120];
}

function clampIn(o, rect, pad) {
  o.x = Math.max(rect[0] + pad, Math.min(rect[2] - pad, o.x));
  o.y = Math.max(rect[1] + pad, Math.min(rect[3] - pad, o.y));
}

// ---------------- 秘境 BOSS ----------------
function nearestAllyIn(sim, e, id) {
  let best = null;
  let bd = Infinity;
  for (const u of sim.units) {
    if (!u.alive || u.realm !== id) continue;
    const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

function hitArea(sim, e, x, y, r, coef) {
  if (!e.alive) return;
  for (const u of sim.alliesIn(x, y, r)) if (u.kind !== 'kongming') sim.damage(e, u, e.atk * coef, { tag: 'realm' });
}

const MOVES = {
  // 原地蓄力后震地：以自身为圆心
  nova(sim, e, m) {
    e.castT = m.warn + 0.25;
    sim.telegraph(e.x, e.y, m.r, m.warn, () => { hitArea(sim, e, e.x, e.y, m.r, m.coef); sim.pushFx({ t: 'boom', x: e.x, y: e.y, r: m.r }); }, e.realmColor);
  },
  // 指定目标脚下落击
  slam(sim, e, m, t) {
    e.castT = m.warn * 0.5;
    const x = t.x; const y = t.y;
    sim.telegraph(x, y, m.r, m.warn, () => { hitArea(sim, e, x, y, m.r, m.coef); sim.pushFx({ t: 'bolt', x1: x, y1: y - 420, x2: x, y2: y }); sim.pushFx({ t: 'boom', x, y, r: m.r, small: true }); });
  },
  // 扑向目标点（预警落点），落地范围伤害（可选 fury 狂怒加速）
  pounce(sim, e, m, t) {
    e.castT = m.warn + 0.2;
    const r = geoOf(sim, e.realm);
    const p = { x: t.x, y: t.y };
    if (r) clampIn(p, r.rect, e.r + 10);
    sim.telegraph(p.x, p.y, m.r, m.warn, () => {
      if (!e.alive) return;
      e.x = p.x; e.y = p.y;
      e.prevX = p.x; e.prevY = p.y;
      pushOutOfWalls(e, e.r, sim.walls, { flying: e.flying });
      hitArea(sim, e, p.x, p.y, m.r, m.coef);
      sim.pushFx({ t: 'boom', x: p.x, y: p.y, r: m.r, small: true });
      if (m.fury) {
        e.furyT = Math.max(e.furyT || 0, 4.5);
        sim.pushFx({ t: 'ring', x: e.x, y: e.y, r: e.r * 3.2, dur: 0.5, color: 0xff5a3a });
      }
    });
  },
  // 多点落雨（大招）
  rain(sim, e, m, t) {
    e.castT = m.warn * 0.6;
    const r = geoOf(sim, e.realm);
    for (let i = 0; i < m.n; i++) {
      const p = i === 0 ? { x: t.x, y: t.y } : { x: t.x + sim.rand(-m.spreadR, m.spreadR), y: t.y + sim.rand(-m.spreadR, m.spreadR) };
      if (r) clampIn(p, r.rect, 20);
      sim.telegraph(p.x, p.y, m.r, m.warn + i * 0.08, () => { hitArea(sim, e, p.x, p.y, m.r, m.coef); sim.pushFx({ t: 'boom', x: p.x, y: p.y, r: m.r, small: true }); }, e.realmColor);
    }
  },
  // 扇形弹幕（可见弹体，可躲）
  fan(sim, e, m, t) {
    e.castT = 0.3;
    const a0 = Math.atan2(t.y - e.y, t.x - e.x);
    for (let i = 0; i < m.n; i++) {
      const a = m.spread >= 6.2 ? a0 + (i / m.n) * Math.PI * 2 : a0 - m.spread / 2 + (m.spread * i) / Math.max(1, m.n - 1);
      sim.addProj({ side: 'enemy', src: e, x: e.x, y: e.y - e.h * 0.4, a, speed: m.speed, life: 1.5, dmg: e.atk * m.coef, r: 14, tex: m.tex || 'proj_ghostfire', tint: m.tint || 0xff5ad0 });
    }
  },
  // 硬化：加护甲 + 回血
  harden(sim, e, m) {
    e.castT = 0.4;
    e.armorBuffT = m.t;
    if (!e.armorUp) { e.armorUp = m.armor; e.armor += m.armor; }
    sim.heal(e, e.maxHp * m.heal, e);
    sim.pushFx({ t: 'ring', x: e.x, y: e.y, r: e.r * 3, dur: 0.6, color: e.realmColor });
  },
  // 战意不灭（二阶段狂暴）：回血 + 护甲 + 狂怒移速/攻速 + 冲击波
  berserk(sim, e, m) {
    e.castT = 0.45;
    e.phase2 = true;
    e.armorBuffT = Math.max(e.armorBuffT || 0, m.t || 6);
    if (!e.armorUp && m.armor) { e.armorUp = m.armor; e.armor += m.armor; }
    e.furyT = Math.max(e.furyT || 0, m.t || 6);
    if (m.heal) sim.heal(e, e.maxHp * m.heal, e);
    if (m.r && m.coef) hitArea(sim, e, e.x, e.y, m.r, m.coef);
    sim.pushFx({ t: 'ring', x: e.x, y: e.y, r: m.r || e.r * 4, dur: 0.7, color: e.realmColor || 0xc47bff });
    sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 24, text: `${m.name}！`, color: '#ff8a5a', size: 28 });
  },
  // 召唤小怪
  summon(sim, e, m) {
    e.castT = 0.5;
    const r = geoOf(sim, e.realm);
    for (let i = 0; i < m.n; i++) {
      const p = { x: e.x + sim.rand(-120, 120), y: e.y + sim.rand(-120, 120) };
      if (r) clampIn(p, r.rect, 30);
      spawnGuard(sim, e.realm, m.enemy, p.x, p.y);
    }
  },
};

function bossUpdate(sim, e, dt, frozen) {
  for (const k in e.mcd) if (e.mcd[k] > 0) e.mcd[k] -= dt;
  if (e.armorBuffT > 0) { e.armorBuffT -= dt; if (e.armorBuffT <= 0 && e.armorUp) { e.armor -= e.armorUp; e.armorUp = 0; } }
  if (e.furyT > 0) e.furyT -= dt;
  if (!e.phase2 && e.hp <= e.maxHp * 0.5) e.phase2 = true;
  if (e.castT > 0) { e.castT -= dt; return; }
  if (frozen) return;
  const d = e.def;
  const t = nearestAllyIn(sim, e, e.realm);
  e.tgt = t;
  if (!t) {
    const hx = e.home.x - e.x; const hy = e.home.y - e.y;
    const dist = Math.hypot(hx, hy);
    if (dist > 30) { e.x += (hx / dist) * e.spd * dt; e.y += (hy / dist) * e.spd * dt; e.face = hx >= 0 ? 1 : -1; }
    return;
  }
  e.face = t.x >= e.x ? 1 : -1;
  const dist = Math.hypot(t.x - e.x, t.y - e.y);
  // 招式（沉默时禁止施放技能）
  if (!(e.st.silence > 0)) {
    for (const m of d.moves) {
      if (m.phase2Only && !e.phase2) continue;
      if (e.mcd[m.id] > 0) continue;
      if (m.range && dist > m.range) continue;
      e.mcd[m.id] = m.cd;
      MOVES[m.type](sim, e, m, t);
      if (m.ult) sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 20, text: m.name, color: '#ff8a5a', size: 30 });
      return;
    }
  }
  // 普攻 / 走位
  const furyAtk = e.furyT > 0 ? 1.25 : 1;
  const furySpd = e.furyT > 0 ? 1.22 : 1;
  const reach = e.range + e.r + (t.r || 20);
  if (dist <= reach) {
    if (e.cd <= 0) {
      e.cd = e.cdMax / furySpd;
      if (d.ai === 'ranged') {
        const a = Math.atan2(t.y - e.y, t.x - e.x);
        sim.addProj({ side: 'enemy', src: e, x: e.x, y: e.y - e.h * 0.5, a, speed: 520, life: 1.2, dmg: e.atk * furyAtk, r: 14, tex: d.bullet || 'proj_ghostfire', tint: d.bulletTint || 0xff5ad0 });
      } else sim.damage(e, t, e.atk * furyAtk, { tag: 'realm' });
    }
    if (d.ai !== 'ranged' || dist > reach * 0.6) return;
  }
  if (e.st.root > 0) return;
  const slow = e.st.slow ? 1 - Math.min(0.8, e.st.slow.v) : 1;
  const sp = e.spd * furySpd * slow * dt;
  e.x += ((t.x - e.x) / Math.max(1, dist)) * sp;
  e.y += ((t.y - e.y) / Math.max(1, dist)) * sp;
  pushOutOfWalls(e, e.r, sim.walls, { flying: e.flying });
  const r = geoOf(sim, e.realm);
  if (r) clampIn(e, r.rect, e.r);
}

function adaptiveInfo(sim, id) {
  const rd = RD.realms[id];
  const R = sim.realms;
  const clears = (R && R.clearCount[id]) || 0;
  return {
    id,
    fixed: true,
    tameable: isTameableRealm(id, rd),
    adaptMul: 1,
    tierMul: rd?.tierMul ?? 1,
    copperMul: 1,
    xpMul: 1,
    copper: rd?.copper ?? 0,
    xp: rd?.xp ?? 0,
    minQ: rd?.minQ ?? 1,
    equipCount: rd?.equipCount ?? 2,
    bonusTomes: rd?.bonusTomes ?? 0,
    bossHp: Math.round((rd?.boss?.hp || 0) * (RD.bossHpScale || 1)),
    bossAtk: rd?.boss?.atk || 0,
    clears,
  };
}

// ---------------- 守卫 / 流程 ----------------
function spawnGuard(sim, id, type, x, y) {
  const rd = RD.realms[id];
  const r = geoOf(sim, id);
  const ed = ENEMIES[type];
  return sim.spawnEnemy(type, x, y, {
    hpMul: rd.minionHp,
    atkMul: rd.minionAtk,
    copper: ed?.copper || 2,
    xp: ed?.xp || 2,
    realm: id,
    home: { x, y },
    tint: r.color,
    extra: { aggro: RD.guardAggro },
  });
}

function spawnRound(sim, id, k) {
  const r = geoOf(sim, id);
  const [cx, cy] = campOf(r);
  const comp = RD.realms[id].rounds[k];
  for (const [type, n] of Object.entries(comp)) {
    for (let i = 0; i < n; i++) {
      const p = { x: cx + sim.rand(-260, 260), y: cy + sim.rand(-260, 260) };
      clampIn(p, r.rect, 60);
      spawnGuard(sim, id, type, p.x, p.y);
    }
  }
  sim.pushFx({ t: 'text', x: cx, y: cy - 120, text: `守卫 第 ${k + 1}/${RD.realms[id].rounds.length} 轮`, color: '#ffc977', size: 26 });
}

function spawnBoss(sim, id) {
  const r = geoOf(sim, id);
  const rd = RD.realms[id];
  const [cx, cy] = campOf(r);
  const b = rd.boss;
  const def = { ...b, tex: b.tex || `g_beast_${r.beast}`, aggro: 900 };
  const e = sim.spawnEnemy(`realm_${id}`, cx, cy, {
    def, name: b.name, boss: 'realm', realm: id, home: { x: cx, y: cy },
    hpMul: RD.bossHpScale,
    atkMul: 1,
    copper: b.copper || 40,
    xp: b.xp || 40,
    extra: {
      update: bossUpdate,
      realmBoss: id,
      beastKey: r.beast,
      sheetKey: b.sheetKey || null,
      realmColor: r.color,
      mcd: Object.fromEntries(b.moves.map((m) => [m.id, m.cd * 0.5])),
      castT: 1.2,
      armorUp: 0,
      armorBuffT: 0,
      furyT: 0,
      phase2: false,
    },
  });
  sim.realms.run[id].boss = e.id;
  sim.banner(`${b.name} 现身！`, '#ff8a5a', true);
  sim.pushFx({ t: 'realmBoss', x: cx, y: cy, color: r.color, key: r.beast });
  return e;
}

function activate(sim, id, u) {
  const R = sim.realms;
  const r = geoOf(sim, id);
  R.state[id] = 'active';
  R.respawnAt[id] = 0;
  R.run[id] = { round: 0, wait: 0, boss: null, since: sim.t };
  spawnRound(sim, id, 0);
  const repeatTag = R.firstCleared[id] ? '（重刷模式）' : '';
  sim.banner(`进入${r.name}${repeatTag}（主线仍在推进）`, '#ffc977');
  sim.emit('realmEnter', { id, u, repeat: !!R.firstCleared[id] });
}

function reset(sim, id) {
  const R = sim.realms;
  const r = geoOf(sim, id);
  for (const e of guardsOf(sim, id)) e.alive = false; // 守卫消散：不给奖励
  for (const z of sim.zones) if (z.alive && z.vis === 'warn' && r && inRect(z.x, z.y, r.rect)) { z.alive = false; }
  R.state[id] = 'open';
  R.run[id] = null;
  R.resets++;
  sim.emit('realmReset', { id });
}

function isTameableRealm(id, rd = RD.realms[id]) {
  if (rd && rd.tameable !== undefined) return !!rd.tameable;
  return ['xuanwu', 'baihu', 'zhuque', 'qinglong'].includes(id);
}

function giveRewards(sim, id, x, y, repeat = false, isFirst = !repeat) {
  const rd = RD.realms[id];
  const ad = adaptiveInfo(sim, id);
  const canTame = isTameableRealm(id, rd);
  const copper = ad.copper || rd.copper || 0;
  const xp = ad.xp || rd.xp || 0;
  if (copper > 0) sim.addCopper(copper, x, y);
  if (xp > 0) sim.gainXp(xp);
  const wave = Math.max(1, rd.open || 1, Math.round((rd.tierMul || 1) * 4));
  const minQ = ad.minQ;
  const extraFirstPiece = isFirst && !canTame ? 1 : 0;
  const totalEquip = ad.equipCount + extraFirstPiece;
  const L = sim.loot;
  let items = 0;
  if (L) {
    if (L.roll && L.give) {
      for (let i = 0; i < totalEquip; i++) {
        const opts = { wave, minQ, set: rd.set };
        if (i === 0 && rd.bonusSlot) opts.slot = rd.bonusSlot;
        const it = L.roll(opts);
        if (it && (L.grant ? L.grant(it, x, y) : L.give(it))) items++;
      }
      const c = L.roll({ wave, consumable: true, kind: 'consumable' });
      if (c && (L.grant ? L.grant(c, x, y) : L.give(c))) items++;
      for (let t = 0; t < ad.bonusTomes; t++) {
        const tid = t % 2 === 1 ? 'tome_omni' : sim.pick(['tome_atk', 'tome_hp', 'tome_def', 'tome_spd']);
        const tome = L.roll({ id: tid });
        if (tome && (L.grant ? L.grant(tome, x, y) : L.give(tome))) items++;
      }
      const artChance = rd.artifactChance ?? ((id === 'qilin' || id === 'xiangyu' || id === 'xingtian') ? 0.30 : 0);
      if (artChance > 0 && L.rollArtifact && sim.rng() < artChance) {
        const art = L.rollArtifact();
        if (art && (L.grant ? L.grant(art, x, y) : L.give(art))) items++;
      }
    } else if (L.chest) {
      L.chest(totalEquip, { set: rd.set, minQ, wave, x, y });
      L.chest(1, { consumable: true, kind: 'consumable', wave, x, y });
      items = totalEquip + 1;
    }
  }
  sim.emit('realmReward', {
    id,
    set: rd.set,
    setName: rd.setName,
    pieces: totalEquip,
    consumables: 1,
    tomes: ad.bonusTomes,
    copper,
    xp,
    minQ,
    fixed: true,
    tameable: canTame,
    adaptMul: ad.adaptMul,
    tierMul: ad.tierMul,
    given: items,
    repeat,
    x,
    y,
  });
}

function tame(sim, id, boss) {
  const R = sim.realms;
  const r = geoOf(sim, id);
  const rd = RD.realms[id];
  const canTame = isTameableRealm(id, rd);
  const isFirst = !R.firstCleared[id];
  R.firstCleared[id] = true;
  R.clearCount[id] = (R.clearCount[id] || 0) + 1;
  R.state[id] = 'cleared';
  R.run[id] = null;
  if (rd.repeatable) {
    R.respawnAt[id] = sim.t + (rd.respawnSec || 35);
  }
  for (const e of guardsOf(sim, id)) e.alive = false;

  const backPt = r.back || H.back;
  const x = (r.hidden || r.portal) ? backPt[0] + 60 : boss.x;
  const y = (r.hidden || r.portal) ? backPt[1] : boss.y;

  if (canTame) {
    if (isFirst) {
      // 四圣兽（青龙/白虎/朱雀/玄武）首通：掉落唯一魂痕（unique: true，清地绝不清除），并收服加入守家队伍
      const soulId = `soul_${r.beast}`;
      if (sim.ground && sim.loot && sim.loot.roll) {
        const soulItem = sim.loot.roll({ id: soulId });
        if (soulItem) {
          soulItem.unique = true;
          sim.ground.spawn(soulItem, boss.x, boss.y, { unique: true });
        }
      }
      let u = null;
      if (!sim.map || !sim.map.beastDropSoulMarkOnly) {
        u = sim.spawnUnit('beast', r.beast, x, y);
        R.tamed.push(u.id);
        const soulName = `${u.name}魂痕`;
        sim.pushFx({ t: 'tame', x: boss.x, y: boss.y, key: r.beast, color: r.color, name: u.name, id: u.id });
        sim.banner(`首通收服 · ${u.name}！并掉落唯一【${soulName}】`, '#ffd36a', true);
        sim.emit('tame', { beast: u, id });
      } else {
        sim.banner(`首通击破 · 掉落唯一【${r.name}魂痕】！已自动收入行囊，使用即可召唤`, '#ffd36a', true);
      }
    } else {
      // 重刷：不再掉落重复唯一魂痕或重复召唤，稳定产高阶装备与铜钱
      sim.pushFx({ t: 'boom', x: boss.x, y: boss.y, r: 160 });
      sim.banner(`重刷通关 · ${r.name}（第 ${R.clearCount[id]} 次）！高阶装备已发放`, '#7fe3ff', true);
    }
  } else {
    // 非四圣兽秘境（麒麟/项羽/刑天）：纯刷神装/神器/属性书副本，不加入守家单位、不掉召唤魂痕
    sim.pushFx({ t: 'boom', x: boss.x, y: boss.y, r: 180 });
    sim.banner(
      isFirst
        ? `首通击破 · ${r.name}！顶级神装与秘宝已发放（纯刷装秘境）`
        : `重刷通关 · ${r.name}（第 ${R.clearCount[id]} 次）！顶级神装已发放`,
      isFirst ? '#ffd36a' : '#7fe3ff',
      true,
    );
  }

  giveRewards(sim, id, boss.x, boss.y, !isFirst, isFirst);
  sim.emit('realmClear', { id, first: isFirst, repeat: !isFirst, clearCount: R.clearCount[id], tameable: canTame });

  if (!R.hiddenOpen && (sim.map?.realms || REALMS).filter((q) => R.firstCleared[q.id]).length >= RD.hiddenNeed) {
    R.hiddenOpen = true;
    R.state.qilin = 'open';
    sim.banner('灯坛旁浮现传送门 · 隐藏秘境「麒麟·中宫」开放', '#ffd36a', true);
    sim.pushFx({ t: 'tame', x: H.entry[0], y: H.entry[1], key: 'portal', color: 0xffc94a, portal: true });
    sim.emit('hiddenOpen', {});
  }
}

// 封印：友军走进未开放的秘境 → 推回门外
function blockOut(sim, u, id) {
  const r = geoOf(sim, id);
  if (!r || !r.gate) return;
  const [x0, y0, x1, y1] = r.rect;
  const pad = u.r + 6;
  const gx = r.gate[0];
  const gy = r.gate[1];
  const dx = Math.abs(u.x - gx);
  const dy = Math.abs(u.y - gy);
  if (dx <= dy) u.x = gx === x1 ? x1 + pad : x0 - pad; else u.y = gy === y1 ? y1 + pad : y0 - pad;
  u.dash = null;
  u.realm = null;
  const R = sim.realms;
  if (sim.t - R.lastBlockMsg > RD.blockMsgCd) {
    R.lastBlockMsg = sim.t;
    const n = RD.realms[id].open;
    const text = `${r.name}封印中 · 第 ${n} 波开放`;
    sim.pushFx({ t: 'text', x: u.x, y: u.y - 120, text, color: '#ff8a7a', size: 24 });
    sim.emit('realmBlocked', { id, wave: n, text, u });
  }
}

function teleport(sim, u, x, y, realmId = undefined) {
  u.x = x; u.y = y; u.prevX = x; u.prevY = y; u.dash = null; u.order = null; u.recall = null;
  if (realmId !== undefined) u.realm = realmId;
  sim.realms.tpCd[u.id] = sim.t + RD.teleportCd;
  sim.pushFx({ t: 'ring', x, y, r: 90, dur: 0.5, color: 0xffd36a });
}

export default {
  id: 'realms',
  init(sim) {
    const state = {};
    const firstCleared = {};
    const clearCount = {};
    const respawnAt = {};
    for (const id of RD.order) {
      const r = geoOf(sim, id);
      const rd = RD.realms[id];
      state[id] = (r && !r.hidden && rd && (rd.open || 0) <= 0) ? 'open' : 'locked';
      firstCleared[id] = false;
      clearCount[id] = 0;
      respawnAt[id] = 0;
    }
    sim.realms = {
      state,
      firstCleared,
      clearCount,
      respawnAt,
      hiddenOpen: false,
      run: {},
      tamed: [],
      resets: 0,
      lastBlockMsg: -99,
      tpCd: {},
      portal: { entry: H.entry, exit: H.exit, r: RD.portalR },
      cooldownLeft: (id) => Math.max(0, (respawnAt[id] || 0) - sim.t),
      getAdaptiveInfo: (id) => adaptiveInfo(sim, id),
    };
    sim.realmInfo = (id) => {
      const r = geoOf(sim, id);
      return { ...RD.realms[id], name: r ? r.name : id, color: r ? r.color : 0xffc94a };
    };
    sim.on('realmMove', ({ u, to }) => {
      const r = to ? geoOf(sim, to) : null;
      if (!r || u.kind === 'kongming' || u.kind === 'summon') return;
      const st = sim.realms.state[to];
      if (st === 'locked' && !r.hidden && !r.portal) { blockOut(sim, u, to); return; }
      if (st === 'open') activate(sim, to, u);
    });
    sim.on('kill', ({ enemy }) => {
      if (enemy.realmBoss && sim.realms.state[enemy.realmBoss] === 'active') tame(sim, enemy.realmBoss, enemy);
    });
  },
  update(sim, dt) {
    const R = sim.realms;
    const allR = allRealmsOf(sim);
    // 1. 按波数开放（含四角秘境 + 项羽/刑天等传送秘境）
    for (const r of allR) {
      if (r.hidden) continue;
      const rd = RD.realms[r.id];
      if (!rd) continue;
      if (R.state[r.id] === 'locked' && sim.wave.n >= rd.open) {
        R.state[r.id] = 'open';
        const where = r.portal ? '传送门已在灯坛旁开启' : '门开在朝灯坛的一角';
        sim.banner(`${r.name}已开放 · ${where}`, '#7fe3ff');
        sim.emit('realmOpen', { id: r.id });
      }
    }
    // 2. 可重复刷秘境：冷却结束后自动重置为 open（可重刷）
    for (const id of RD.order) {
      const rd = RD.realms[id];
      if (!rd || !rd.repeatable) continue;
      if (R.state[id] === 'cleared' && R.respawnAt[id] > 0 && sim.t >= R.respawnAt[id]) {
        R.state[id] = 'open';
        R.respawnAt[id] = 0;
        sim.emit('realmRespawn', { id });
        // 若已有友军守在秘境内，不自动强开，等其重进或点击「再次挑战」
      }
    }
    // 3. 进行中的秘境：轮次推进 / 全员离开则重置
    for (const id of RD.order) {
      if (R.state[id] !== 'active') continue;
      const run = R.run[id];
      if (!alliesInRealm(sim, id).length) {
        run.emptyT = (run.emptyT || 0) + dt;
        if (run.emptyT >= RD.leaveGrace) { reset(sim, id); continue; }
      } else run.emptyT = 0;
      if (run.boss) continue;
      if (guardsOf(sim, id).length) { run.wait = RD.roundDelay; continue; }
      run.wait -= dt;
      if (run.wait > 0) continue;
      run.round++;
      if (run.round < RD.realms[id].rounds.length) spawnRound(sim, id, run.round);
      else spawnBoss(sim, id);
    }
    // 4. 所有传送门秘境（麒麟隐藏秘境 + 项羽/刑天等）：踩门自动进出（路过但目标在门外的长途移动不误触发）
    const portalRealms = allR.filter((r) => (r.hidden && R.hiddenOpen) || (r.portal && !r.hidden && R.state[r.id] !== 'locked'));
    const u = sim.ctrl;
    if (u && u.alive && !u.dash && !((R.tpCd[u.id] || 0) > sim.t)) {
      const rr = RD.portalR * RD.portalR;
      const intentR2 = (RD.portalR * 1.6) ** 2;
      const wantsPt = (pt) => !u.order || (u.order.type !== 'move' && u.order.type !== 'attackMove')
        || ((u.order.x - pt[0]) ** 2 + (u.order.y - pt[1]) ** 2 <= intentR2);
      for (const r of portalRealms) {
        if (r.entry && (u.x - r.entry[0]) ** 2 + (u.y - r.entry[1]) ** 2 <= rr && wantsPt(r.entry)) {
          teleport(sim, u, r.arrive[0], r.arrive[1]);
          break;
        }
        if (r.exit && (u.x - r.exit[0]) ** 2 + (u.y - r.exit[1]) ** 2 <= rr && wantsPt(r.exit)) {
          teleport(sim, u, r.back[0], r.back[1]);
          break;
        }
      }
    }
    // 5. 传送秘境均为封闭区域：切走操控的 AI 友军 3 秒后自动送回灯坛旁
    const portalIds = new Set(allR.filter((r) => r.hidden || r.portal).map((r) => r.id));
    for (const ally of sim.units) {
      if (!ally.alive || ally.ctrl || ally.kind === 'kongming' || !portalIds.has(ally.realm)) {
        if (ally.hiddenIdle) ally.hiddenIdle = 0;
        continue;
      }
      ally.hiddenIdle = (ally.hiddenIdle || 0) + dt;
      if (ally.hiddenIdle >= 3) {
        ally.hiddenIdle = 0;
        const r = geoOf(sim, ally.realm);
        const bp = (r && r.back) || H.back;
        teleport(sim, ally, bp[0] + sim.rand(-60, 60), bp[1] + 40, null);
      }
    }
  },
  commands: {
    enterRealm(sim, c) {
      const R = sim.realms;
      const r = geoOf(sim, c.id);
      const rd = RD.realms[c.id];
      if (!R || !r || !rd) return { ok: false, reason: '未知秘境' };
      const u = sim.ctrl;
      if (!u || !u.alive || u.kind === 'kongming') return { ok: false, reason: '当前单位无法进入秘境' };
      if (r.hidden && !R.hiddenOpen) return { ok: false, reason: `需先清空 ${RD.hiddenNeed} 座神兽秘境` };
      if (R.state[r.id] === 'locked') return { ok: false, reason: `${r.name}将于第 ${rd.open} 波开放` };
      if (R.state[r.id] === 'cleared') {
        const left = R.cooldownLeft(r.id);
        if (left > 0) return { ok: false, reason: `${r.name}重刷冷却中（剩 ${Math.ceil(left)} 秒）` };
        if (rd.repeatable) { R.state[r.id] = 'open'; R.respawnAt[r.id] = 0; }
      }
      if (r.portal || r.hidden) {
        teleport(sim, u, r.arrive[0], r.arrive[1], r.id);
        if (R.state[r.id] === 'open') activate(sim, r.id, u);
        return { ok: true, id: r.id, teleported: true };
      }
      // 四角开放秘境：若已在秘境内直接开打，否则引导走过去
      if (u.realm === r.id) {
        if (R.state[r.id] === 'open') activate(sim, r.id, u);
        return { ok: true, id: r.id, activated: true };
      }
      return { ok: true, id: r.id, walkToGate: true };
    },
    resetRealm(sim, c) {
      const R = sim.realms;
      const r = geoOf(sim, c.id);
      const rd = RD.realms[c.id];
      if (!R || !r || !rd) return { ok: false, reason: '未知秘境' };
      if (!rd.repeatable) return { ok: false, reason: '该秘境不可重复挑战' };
      if (R.state[r.id] === 'locked') return { ok: false, reason: `${r.name}尚未开放` };
      if (R.state[r.id] === 'active') return { ok: false, reason: `${r.name}正在交战中` };
      const left = R.cooldownLeft(r.id);
      if (left > 0 && !c.force) return { ok: false, reason: `重刷冷却中（剩 ${Math.ceil(left)} 秒）` };
      R.state[r.id] = 'open';
      R.respawnAt[r.id] = 0;
      const u = sim.ctrl;
      if (u && u.alive && u.realm === r.id) activate(sim, r.id, u);
      sim.emit('realmRespawn', { id: r.id, manual: true });
      return { ok: true, id: r.id };
    },
    exitRealm(sim) {
      const u = sim.ctrl;
      if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
      const r = u.realm ? geoOf(sim, u.realm) : null;
      if (!r || (!r.portal && !r.hidden)) return { ok: false, reason: '当前不在传送秘境内' };
      const bp = r.back || H.back;
      teleport(sim, u, bp[0], bp[1], null);
      return { ok: true, id: r.id };
    },
  },
};

// 存档：妖物 update 函数登记，读档时按名字还原
regFn('realms.bossUpdate', bossUpdate);
