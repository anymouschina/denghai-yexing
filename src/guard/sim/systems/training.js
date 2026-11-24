// 可复用《守卫剑阁》风格练功房系统（纯数据驱动，配置见 map.trainingRoom / balance.json）：
// - 基地旁设有练功房传送阵，同时支持快捷键 / 按钮一键进出。
// - 房内按所选难度（初阶/中阶/高阶）持续刷新演武木人/妖兵，绝不离开练功房、绝不攻击孔明。
// - 击杀稳产经验、铜钱与装备掉落，支持边刷练功房边回防主线！
import ENEMIES from '../../data/enemies.json' with { type: 'json' };
import { inRect, pushOutOfWalls } from '../map.js';
import { regFn } from '../../persist/fnRegistry.js';

function clampIn(o, rect, pad) {
  o.x = Math.max(rect[0] + pad, Math.min(rect[2] - pad, o.x));
  o.y = Math.max(rect[1] + pad, Math.min(rect[3] - pad, o.y));
}

function trainingMobs(sim) {
  return sim.enemies.filter((e) => e.alive && e.training);
}

function alliesInTraining(sim, id) {
  return sim.units.filter((u) => u.alive && u.kind !== 'kongming' && u.realm === id);
}

function teleportUnit(sim, u, x, y, realmId) {
  u.x = x;
  u.y = y;
  u.prevX = x;
  u.prevY = y;
  u.dash = null;
  u.order = null;
  u.recall = null;
  u.realm = realmId;
  sim.training.tpCd[u.id] = sim.t + 1.5;
  sim.pushFx({ t: 'ring', x, y, r: 90, dur: 0.45, color: 0x50fa7a });
}

function effectiveTrainingXp(sim, td) {
  const base = td.xp || 7;
  const lv = sim.hero ? sim.hero.lv : 1;
  const cap = td.softCapLv || 8;
  if (lv <= cap) return base;
  const over = lv - cap;
  const mul = Math.max(0.25, 0.55 - over * 0.06);
  return Math.max(2, Math.round(base * mul));
}

function temperArcherUpdate(sim, e, dt, frozen) {
  if (frozen) return;
  const cfg = sim.training && sim.training.cfg;
  let t = null;
  let bd = Infinity;
  for (const u of sim.units) {
    if (!u.alive || u.kind === 'kongming' || u.realm !== e.realm) continue;
    const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
    if (d < bd) { bd = d; t = u; }
  }
  e.tgt = t;
  if (!t) {
    if (e.home) {
      const hx = e.home.x - e.x; const hy = e.home.y - e.y;
      const hd = Math.hypot(hx, hy);
      if (hd > 30) {
        const sp = e.spd * dt;
        e.x += (hx / hd) * sp;
        e.y += (hy / hd) * sp;
        e.face = hx >= 0 ? 1 : -1;
        if (cfg) clampIn(e, cfg.rect, e.r + 12);
      }
    }
    return;
  }
  e.face = t.x >= e.x ? 1 : -1;
  const dist = Math.hypot(t.x - e.x, t.y - e.y);
  const range = e.range || 380;
  if (dist <= range + (t.r || 20)) {
    if (e.cd <= 0) {
      e.cd = e.cdMax;
      const a = Math.atan2(t.y - e.y, t.x - e.x);
      sim.addProj({
        side: 'enemy',
        src: e,
        x: e.x,
        y: e.y - (e.h || 60) * 0.5,
        a,
        speed: e.bulletSpeed || 560,
        life: 1.05,
        dmg: e.atk,
        r: 12,
        tex: 'g_arrow',
        tint: 0xffb870,
        realm: e.realm,
      });
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

function spawnTrainingMob(sim, cfg, tierDef) {
  const [x0, y0, x1, y1] = cfg.rect;
  const cx = (x0 + x1) * 0.5 - 60;
  const cy = (y0 + y1) * 0.5;
  const p = { x: cx + sim.rand(-170, 210), y: cy + sim.rand(-180, 180) };
  clampIn(p, cfg.rect, 70);
  const mobKey = tierDef.mob || 'paperman';
  const baseDef = ENEMIES[mobKey];
  const mobDef = tierDef.ranged && baseDef
    ? {
        ...baseDef,
        ai: 'ranged',
        range: tierDef.range || 380,
        cd: tierDef.cd || 0.32,
        bulletSpeed: tierDef.bulletSpeed || 560,
      }
    : baseDef;
  const tint = tierDef.id === 'temper'
    ? 0xff9a5a
    : tierDef.id === 'high'
      ? 0xffc94a
      : tierDef.id === 'mid'
        ? 0x7fe3ff
        : 0x9ff0b8;
  const e = sim.spawnEnemy(mobKey, p.x, p.y, {
    def: mobDef,
    name: tierDef.mobName || '演武木人',
    hpMul: tierDef.hpMul || 1,
    atkMul: tierDef.atkMul || 0.4,
    realm: cfg.id,
    home: { x: p.x, y: p.y },
    tint,
    extra: {
      training: true,
      trainingTier: tierDef.id,
      copper: tierDef.copper || 12,
      xp: effectiveTrainingXp(sim, tierDef),
      aggro: 900,
      bulletSpeed: tierDef.bulletSpeed || 560,
      update: tierDef.ranged ? temperArcherUpdate : undefined,
    },
  });
  return e;
}

function enterTrainingRoom(sim, c = {}) {
  const T = sim.training;
  if (!T) return { ok: false, reason: '当前地图未配置练功房' };
  const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
  if (!u || !u.alive || u.kind === 'kongming') return { ok: false, reason: '当前单位无法进入练功房' };
  const cfg = T.cfg;
  const prevTier = T.tier;
  if (c.tier && cfg.tiers[c.tier]) T.tier = c.tier;
  teleportUnit(sim, u, cfg.arrive[0], cfg.arrive[1], cfg.id);
  if (T.tier !== prevTier) {
    for (const m of trainingMobs(sim)) m.alive = false;
    T.spawnT = 0;
  }
  const td = T.tierDef();
  if (trainingMobs(sim).length === 0) {
    const initN = td.id === 'temper' ? Math.min(5, td.maxAlive || 8) : Math.min(4, td.maxAlive || 6);
    for (let i = 0; i < initN; i++) spawnTrainingMob(sim, cfg, td);
  }
  sim.banner(`进入${cfg.name} · ${td.name}（主线仍在推进）`, td.id === 'temper' ? '#ffb870' : '#9ff0b8');
  sim.emit('trainingEnter', { u, tier: T.tier });
  return { ok: true, tier: T.tier };
}

export default {
  id: 'training',
  init(sim) {
    const cfg = sim.map && sim.map.trainingRoom;
    if (!cfg) {
      sim.training = null;
      return;
    }
    const tierKeys = Object.keys(cfg.tiers || {});
    const defaultTier = tierKeys[0] || 'low';
    sim.training = {
      cfg,
      tier: defaultTier,
      spawnT: 0,
      emptyT: 0,
      kills: 0,
      tpCd: {},
      inRoom: (u = sim.ctrl) => !!(u && u.alive && u.realm === cfg.id),
      tierDef: () => cfg.tiers[sim.training.tier] || cfg.tiers[defaultTier],
    };

    sim.on('kill', ({ enemy: e }) => {
      if (!e.training || !sim.training) return;
      sim.training.kills++;
      const td = cfg.tiers[e.trainingTier] || sim.training.tierDef();
      if (sim.loot && sim.rng() < (td.equipChance || 0.2)) {
        const wave = Math.max(td.waveBase || 1, sim.wave.n || 1);
        const setPool = ['plain', 'plain', 'baihu', 'zhuque', 'xuanwu', 'qinglong', 'xiangyu', 'xingtian', 'lvbu'];
        const set = sim.pick(setPool);
        const eq = sim.loot.roll({ wave, minQ: td.minQ || 0, set });
        sim.inv.gained++;
        sim.loot.grant(eq, e.x, e.y);
      }
    });
  },
  update(sim, dt) {
    const T = sim.training;
    if (!T) return;
    const cfg = T.cfg;
    const u = sim.ctrl;
    // 传送阵踩点自动进出（仅当前操控单位）
    if (u && u.alive && !u.dash && !((T.tpCd[u.id] || 0) > sim.t)) {
      const rr = (cfg.portalR || 76) ** 2;
      if ((u.x - cfg.entry[0]) ** 2 + (u.y - cfg.entry[1]) ** 2 <= rr) {
        teleportUnit(sim, u, cfg.arrive[0], cfg.arrive[1], cfg.id);
        sim.banner(`进入${cfg.name} · ${T.tierDef().name}`, '#9ff0b8');
        sim.emit('trainingEnter', { u, tier: T.tier });
      } else if ((u.x - cfg.exit[0]) ** 2 + (u.y - cfg.exit[1]) ** 2 <= rr) {
        teleportUnit(sim, u, cfg.back[0], cfg.back[1], null);
        sim.emit('trainingExit', { u });
      }
    }

    const inside = alliesInTraining(sim, cfg.id);
    if (!inside.length) {
      T.emptyT += dt;
      if (T.emptyT >= 5) {
        for (const m of trainingMobs(sim)) m.alive = false;
      }
      return;
    }
    T.emptyT = 0;

    // 维持房内练功目标数量
    const td = T.tierDef();
    const cur = trainingMobs(sim);
    if (cur.length < (td.maxAlive || 6)) {
      T.spawnT -= dt;
      if (T.spawnT <= 0) {
        const toSpawn = cur.length === 0 ? Math.min(3, td.maxAlive || 6) : 1;
        for (let i = 0; i < toSpawn; i++) spawnTrainingMob(sim, cfg, td);
        T.spawnT = td.spawnInterval || 1.1;
      }
    }

    // 兜底：确保练功怪绝不离开练功房矩形
    for (const m of cur) {
      if (!inRect(m.x, m.y, cfg.rect, -10)) clampIn(m, cfg.rect, m.r + 12);
    }

    // 练功房是封闭区域：若玩家切走操控其他单位，留守房内的 AI 友军 3 秒后自动送回灯坛旁，避免顶墙卡住
    for (const ally of sim.units) {
      if (!ally.alive || ally.ctrl || ally.kind === 'kongming' || ally.realm !== cfg.id) {
        if (ally.trainingIdle) ally.trainingIdle = 0;
        continue;
      }
      ally.trainingIdle = (ally.trainingIdle || 0) + dt;
      if (ally.trainingIdle >= 3) {
        ally.trainingIdle = 0;
        teleportUnit(sim, ally, cfg.back[0] + sim.rand(-60, 60), cfg.back[1] + 40, null);
      }
    }
  },
  commands: {
    enterTraining(sim, c) {
      return enterTrainingRoom(sim, c);
    },
    enterTemper(sim, c) {
      return enterTrainingRoom(sim, { ...c, tier: 'temper' });
    },
    exitTraining(sim, c) {
      const T = sim.training;
      if (!T) return { ok: false, reason: '当前地图未配置练功房' };
      const u = c.unitId ? sim.byId(c.unitId) : sim.ctrl;
      if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
      const cfg = T.cfg;
      teleportUnit(sim, u, cfg.back[0], cfg.back[1], null);
      sim.emit('trainingExit', { u });
      return { ok: true };
    },
    setTrainingTier(sim, c) {
      const T = sim.training;
      if (!T) return { ok: false, reason: '当前地图未配置练功房' };
      const cfg = T.cfg;
      if (!c.tier || !cfg.tiers[c.tier]) return { ok: false, reason: '无效练功阶层' };
      T.tier = c.tier;
      for (const m of trainingMobs(sim)) m.alive = false;
      T.spawnT = 0;
      const td = T.tierDef();
      if (alliesInTraining(sim, cfg.id).length > 0) {
        for (let i = 0; i < Math.min(4, td.maxAlive || 6); i++) spawnTrainingMob(sim, cfg, td);
      }
      sim.emit('trainingTier', { tier: T.tier, name: td.name });
      return { ok: true, tier: T.tier, name: td.name };
    },
  },
};

// 存档：妖物 update 函数登记，读档时按名字还原
regFn('training.temperArcherUpdate', temperArcherUpdate);
