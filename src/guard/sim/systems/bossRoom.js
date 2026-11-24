// 可复用《守卫剑阁》专属可重复刷 BOSS 房系统（数据驱动，配置见 map.bossRoom / balance.json）：
// - 独立封闭打宝竞技场，支持初阶 / 中阶 / 高阶三档 BOSS 切换，一键进出或踩灯坛东侧传送阵进入。
// - 击杀稳产高阶装备、套装散件、铜钱与永久成长书卷（武勇/体魄/天悟丹）；支持冷却自动重生或点击「立即再战」。
// - BOSS 绝不离开房间、绝不攻击孔明；切走操控的 AI 友军 3 秒后自动送回灯坛。
import { inRect, pushOutOfWalls } from '../map.js';
import { ITEMS } from './loot.js';
import { regFn } from '../../persist/fnRegistry.js';

function adaptiveInfo(sim, tierId) {
  const BR = sim.bossRoom;
  const td = BR ? (BR.cfg.tiers[tierId || BR.tier] || BR.tierDef()) : null;
  const clears = BR ? BR.clears : 0;
  return {
    tier: td?.id || tierId,
    fixed: true,
    adaptMul: 1,
    tierMul: td?.tierMul ?? 1,
    copperMul: 1,
    xpMul: 1,
    copper: td?.copper ?? 300,
    xp: td?.xp ?? 260,
    minQ: td?.minQ ?? 2,
    equipCount: td?.equipCount ?? 2,
    bonusTomes: td?.bonusTomes ?? 0,
    bossHp: td?.hp || 0,
    bossAtk: td?.atk || 0,
    clears,
  };
}

function clampIn(o, rect, pad) {
  o.x = Math.max(rect[0] + pad, Math.min(rect[2] - pad, o.x));
  o.y = Math.max(rect[1] + pad, Math.min(rect[3] - pad, o.y));
}

function alliesInBossRoom(sim, id) {
  return sim.units.filter((u) => u.alive && u.kind !== 'kongming' && u.realm === id);
}

function roomBosses(sim) {
  return sim.enemies.filter((e) => e.alive && e.bossRoomBoss);
}

function teleportUnit(sim, u, x, y, realmId) {
  u.x = x; u.y = y; u.prevX = x; u.prevY = y;
  u.dash = null; u.order = null; u.recall = null;
  u.realm = realmId;
  sim.bossRoom.tpCd[u.id] = sim.t + 1.5;
  sim.pushFx({ t: 'ring', x, y, r: 95, dur: 0.45, color: 0xff6a5a });
}

function roomBossUpdate(sim, e, dt, frozen) {
  for (const k in e.mcd) if (e.mcd[k] > 0) e.mcd[k] -= dt;
  if (e.castT > 0) { e.castT -= dt; return; }
  if (frozen) return;
  const cfg = sim.bossRoom && sim.bossRoom.cfg;
  const allies = cfg ? alliesInBossRoom(sim, cfg.id) : [];
  let t = null;
  let bd = Infinity;
  for (const u of allies) {
    const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
    if (d < bd) { bd = d; t = u; }
  }
  e.tgt = t;
  if (!t) {
    const hx = e.home.x - e.x; const hy = e.home.y - e.y;
    const dist = Math.hypot(hx, hy);
    if (dist > 30) { e.x += (hx / dist) * e.spd * dt; e.y += (hy / dist) * e.spd * dt; e.face = hx >= 0 ? 1 : -1; }
    return;
  }
  e.face = t.x >= e.x ? 1 : -1;
  const dist = Math.hypot(t.x - e.x, t.y - e.y);
  if (!(e.st.silence > 0)) {
    for (const m of (e.def.moves || [])) {
      if (e.mcd[m.id] > 0) continue;
      if (m.range && dist > m.range) continue;
      e.mcd[m.id] = m.cd;
      if (m.type === 'nova') {
        e.castT = m.warn + 0.25;
        sim.telegraph(e.x, e.y, m.r, m.warn, () => {
          if (!e.alive) return;
          for (const u of sim.alliesIn(e.x, e.y, m.r)) if (u.kind !== 'kongming') sim.damage(e, u, e.atk * m.coef, { tag: 'bossRoom' });
          sim.pushFx({ t: 'boom', x: e.x, y: e.y, r: m.r });
        }, 0xff5a4a);
        if (m.ult) sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 20, text: m.name, color: '#ff8a5a', size: 28 });
        return;
      }
      if (m.type === 'slam' || m.type === 'pounce') {
        e.castT = m.warn + 0.15;
        const p = { x: t.x, y: t.y };
        if (cfg) clampIn(p, cfg.rect, e.r + 14);
        sim.telegraph(p.x, p.y, m.r, m.warn, () => {
          if (!e.alive) return;
          if (m.type === 'pounce') { e.x = p.x; e.y = p.y; e.prevX = p.x; e.prevY = p.y; }
          for (const u of sim.alliesIn(p.x, p.y, m.r)) if (u.kind !== 'kongming') sim.damage(e, u, e.atk * m.coef, { tag: 'bossRoom' });
          sim.pushFx({ t: 'boom', x: p.x, y: p.y, r: m.r, small: true });
        }, 0xff7a3a);
        return;
      }
    }
  }
  const reach = e.range + e.r + (t.r || 20);
  if (dist <= reach) {
    if (e.cd <= 0) {
      e.cd = e.cdMax;
      sim.damage(e, t, e.atk, { tag: 'bossRoom' });
    }
    return;
  }
  if (e.st.root > 0) return;
  const slow = e.st.slow ? 1 - Math.min(0.8, e.st.slow.v) : 1;
  const sp = e.spd * slow * dt;
  e.x += ((t.x - e.x) / Math.max(1, dist)) * sp;
  e.y += ((t.y - e.y) / Math.max(1, dist)) * sp;
  pushOutOfWalls(e, e.r, sim.walls);
  if (cfg) clampIn(e, cfg.rect, e.r + 12);
}

function spawnRoomBoss(sim, cfg, td) {
  for (const old of roomBosses(sim)) old.alive = false;
  const [x0, y0, x1, y1] = cfg.rect;
  const cx = (x0 + x1) * 0.5 + 140;
  const cy = (y0 + y1) * 0.5;
  const def = { ...td, ai: 'melee', aggro: 950 };
  const e = sim.spawnEnemy(`bossroom_${td.id}`, cx, cy, {
    def,
    name: td.bossName || '装备BOSS',
    boss: 'realm',
    realm: cfg.id,
    home: { x: cx, y: cy },
    hpMul: 1,
    atkMul: 1,
    copper: Math.round((td.copper || 300) * 0.25),
    xp: Math.round((td.xp || 260) * 0.4),
    extra: {
      bossRoomBoss: true,
      bossRoomTier: td.id,
      realmColor: cfg.color || 0xff6a5a,
      update: roomBossUpdate,
      mcd: Object.fromEntries((td.moves || []).map((m) => [m.id, m.cd * 0.5])),
      castT: 0.6,
    },
  });
  sim.bossRoom.bossId = e.id;
  sim.bossRoom.respawnAt = 0;
  sim.pushFx({ t: 'realmBoss', x: cx, y: cy, color: cfg.color || 0xff6a5a });
  return e;
}

export default {
  id: 'bossRoom',
  init(sim) {
    const cfg = sim.map && sim.map.bossRoom;
    if (!cfg) {
      sim.bossRoom = null;
      return;
    }
    const tierKeys = Object.keys(cfg.tiers || {});
    const defaultTier = tierKeys[0] || 'low';
    sim.bossRoom = {
      cfg,
      tier: defaultTier,
      bossId: null,
      clears: 0,
      respawnAt: 0,
      emptyT: 0,
      tpCd: {},
      inRoom: (u = sim.ctrl) => !!(u && u.alive && u.realm === cfg.id),
      tierDef: () => cfg.tiers[sim.bossRoom.tier] || cfg.tiers[defaultTier],
      cooldownLeft: () => Math.max(0, (sim.bossRoom.respawnAt || 0) - sim.t),
      getAdaptiveInfo: (tierId) => adaptiveInfo(sim, tierId),
    };

    sim.on('kill', ({ enemy: e }) => {
      if (!e.bossRoomBoss || !sim.bossRoom) return;
      const BR = sim.bossRoom;
      const td = cfg.tiers[e.bossRoomTier] || BR.tierDef();
      const ad = adaptiveInfo(sim, td.id);
      BR.clears++;
      BR.bossId = null;
      BR.respawnAt = sim.t + (cfg.respawnSec || 20);

      if (ad.copper > 0) sim.addCopper(ad.copper, e.x, e.y);
      if (ad.xp > 0) sim.gainXp(ad.xp);
      const L = sim.loot;
      let eqN = 0;
      let tomeName = '';
      if (L && L.roll && L.grant) {
        const sets = (ITEMS.drops && ITEMS.drops.bossSets) || ['baihu', 'zhuque', 'xuanwu', 'qinglong', 'wolong', 'xiangyu', 'xingtian', 'lvbu'];
        const wave = td.waveBase || 6;
        for (let i = 0; i < ad.equipCount; i++) {
          const eq = L.roll({ wave, minQ: ad.minQ, set: sim.pick(sets) });
          if (eq) { L.grant(eq, e.x, e.y); eqN++; }
        }
        if (td.tome) {
          const tome = L.roll({ id: td.tome });
          if (tome) { L.grant(tome, e.x, e.y); tomeName = tome.name; }
        }
        for (let t = 0; t < ad.bonusTomes; t++) {
          const extraId = t % 2 === 1 ? 'tome_omni' : sim.pick(['tome_atk', 'tome_hp', 'tome_def', 'tome_spd']);
          const exTome = L.roll({ id: extraId });
          if (exTome) L.grant(exTome, e.x, e.y);
        }
        const boxChance = td.id === 'high' ? 0.45 : td.id === 'mid' ? 0.20 : 0;
        if (boxChance > 0 && sim.rng() < boxChance) {
          const box = L.roll({ id: sim.pick(['growth_dragonscale_box', 'growth_dilu_box']) });
          if (box) L.grant(box, e.x, e.y);
        }
        if (td.id === 'high' && L.rollArtifact && sim.rng() < 0.16) {
          const art = L.rollArtifact();
          if (art) L.grant(art, e.x, e.y);
        }
      }
      sim.banner(`BOSS房首领【${td.bossName}】击破！铜钱 +${ad.copper} · 经验 +${ad.xp} · 高阶装备×${eqN}${tomeName ? ` + 【${tomeName}】` : ''}`, '#ffd36a', true);
      sim.emit('bossRoomClear', { tier: td.id, clears: BR.clears, equipCount: eqN, bonusTomes: ad.bonusTomes, tomeName, copper: ad.copper, xp: ad.xp, fixed: true, adaptMul: ad.adaptMul });
    });
  },
  update(sim, dt) {
    const BR = sim.bossRoom;
    if (!BR) return;
    const cfg = BR.cfg;
    const u = sim.ctrl;
    if (u && u.alive && !u.dash && !((BR.tpCd[u.id] || 0) > sim.t)) {
      const rr = (cfg.portalR || 76) ** 2;
      if ((u.x - cfg.entry[0]) ** 2 + (u.y - cfg.entry[1]) ** 2 <= rr) {
        teleportUnit(sim, u, cfg.arrive[0], cfg.arrive[1], cfg.id);
        if (!roomBosses(sim).length && BR.cooldownLeft() <= 0) spawnRoomBoss(sim, cfg, BR.tierDef());
        sim.banner(`进入${cfg.name} · ${BR.tierDef().name}`, '#ff8a7a');
        sim.emit('bossRoomEnter', { u, tier: BR.tier });
      } else if ((u.x - cfg.exit[0]) ** 2 + (u.y - cfg.exit[1]) ** 2 <= rr) {
        teleportUnit(sim, u, cfg.back[0], cfg.back[1], null);
        sim.emit('bossRoomExit', { u });
      }
    }

    const inside = alliesInBossRoom(sim, cfg.id);
    if (!inside.length) {
      BR.emptyT += dt;
      if (BR.emptyT >= 6) {
        for (const b of roomBosses(sim)) b.alive = false;
        BR.bossId = null;
      }
      return;
    }
    BR.emptyT = 0;

    // 房内有人且冷却结束时自动刷出下一轮 BOSS
    if (!roomBosses(sim).length && BR.respawnAt > 0 && sim.t >= BR.respawnAt) {
      spawnRoomBoss(sim, cfg, BR.tierDef());
      sim.banner(`BOSS房重生 · 【${BR.tierDef().bossName}】再度降临！`, '#ff8a7a');
    }

    // 兜底不跑出房间
    for (const b of roomBosses(sim)) {
      if (!inRect(b.x, b.y, cfg.rect, -10)) clampIn(b, cfg.rect, b.r + 12);
    }

    // 切走操控的 AI 友军 3 秒后自动送回灯坛
    for (const ally of sim.units) {
      if (!ally.alive || ally.ctrl || ally.kind === 'kongming' || ally.realm !== cfg.id) {
        if (ally.bossRoomIdle) ally.bossRoomIdle = 0;
        continue;
      }
      ally.bossRoomIdle = (ally.bossRoomIdle || 0) + dt;
      if (ally.bossRoomIdle >= 3) {
        ally.bossRoomIdle = 0;
        teleportUnit(sim, ally, cfg.back[0] + sim.rand(-60, 60), cfg.back[1] + 40, null);
      }
    }
  },
  commands: {
    enterBossRoom(sim, c) {
      const BR = sim.bossRoom;
      if (!BR) return { ok: false, reason: '当前地图未配置 BOSS 房' };
      const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
      if (!u || !u.alive || u.kind === 'kongming') return { ok: false, reason: '当前单位无法进入 BOSS 房' };
      const cfg = BR.cfg;
      if (c.tier && cfg.tiers[c.tier]) BR.tier = c.tier;
      teleportUnit(sim, u, cfg.arrive[0], cfg.arrive[1], cfg.id);
      if (!roomBosses(sim).length && BR.cooldownLeft() <= 0) {
        spawnRoomBoss(sim, cfg, BR.tierDef());
      }
      sim.banner(`进入${cfg.name} · ${BR.tierDef().name}（主线仍在推进）`, '#ff8a7a');
      sim.emit('bossRoomEnter', { u, tier: BR.tier });
      return { ok: true, tier: BR.tier };
    },
    exitBossRoom(sim, c) {
      const BR = sim.bossRoom;
      if (!BR) return { ok: false, reason: '当前地图未配置 BOSS 房' };
      const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
      if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
      const cfg = BR.cfg;
      teleportUnit(sim, u, cfg.back[0], cfg.back[1], null);
      sim.emit('bossRoomExit', { u });
      return { ok: true };
    },
    setBossRoomTier(sim, c) {
      const BR = sim.bossRoom;
      if (!BR) return { ok: false, reason: '当前地图未配置 BOSS 房' };
      const cfg = BR.cfg;
      if (!c.tier || !cfg.tiers[c.tier]) return { ok: false, reason: '无效 BOSS 房难度' };
      BR.tier = c.tier;
      BR.respawnAt = 0;
      for (const b of roomBosses(sim)) b.alive = false;
      BR.bossId = null;
      if (alliesInBossRoom(sim, cfg.id).length > 0) spawnRoomBoss(sim, cfg, BR.tierDef());
      sim.emit('bossRoomTier', { tier: BR.tier, name: BR.tierDef().name });
      return { ok: true, tier: BR.tier, name: BR.tierDef().name };
    },
    respawnBossRoom(sim, c) {
      const BR = sim.bossRoom;
      if (!BR) return { ok: false, reason: '当前地图未配置 BOSS 房' };
      if (roomBosses(sim).length > 0) return { ok: false, reason: '当前 BOSS 仍在场' };
      const left = BR.cooldownLeft();
      if (left > 0 && !c.force) return { ok: false, reason: `BOSS 重生冷却中（剩 ${Math.ceil(left)} 秒）` };
      BR.respawnAt = 0;
      spawnRoomBoss(sim, BR.cfg, BR.tierDef());
      return { ok: true, tier: BR.tier };
    },
  },
};

// 存档：妖物 update 函数登记，读档时按名字还原
regFn('bossRoom.roomBossUpdate', roomBossUpdate);
