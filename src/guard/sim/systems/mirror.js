// 可复用《守卫剑阁》心魔镜像挑战系统（数据驱动，配置见 map.mirrorChallenge / balance.json）：
// - 挑战 2倍 / 5倍 / 10倍 自身英雄镜像，击败各阶获得巨额永久战力飞升（三阶累计提升 30,000 战力！）
// - 镜像拥有与当前英雄一致的外观与精灵图、招式与高额爆发，击败后永久计入 sim.mirror.bonus 并实时反映在属性面板。
import { pushOutOfWalls, clampWorld } from '../map.js';
import { regFn } from '../../persist/fnRegistry.js';

function mirrorTarget(sim, e) {
  const h = sim.hero;
  if (h && h.alive && (h.realm || null) === (e.realm || null)) return h;
  const c = sim.ctrl;
  if (c && c.alive && c.kind !== 'kongming' && (c.realm || null) === (e.realm || null)) return c;
  return null;
}

function mirrorUpdate(sim, e, dt, frozen) {
  for (const k in e.mcd) if (e.mcd[k] > 0) e.mcd[k] -= dt;
  if (e.castT > 0) { e.castT -= dt; return; }
  if (frozen) return;
  const t = mirrorTarget(sim, e);
  e.tgt = t;
  if (!t) return;
  e.face = t.x >= e.x ? 1 : -1;
  const dist = Math.hypot(t.x - e.x, t.y - e.y);

  // 镜像释放冲锋斩 / 镜像震击（沉默时禁止施放）
  if (!(e.st.silence > 0)) {
    if (e.mcd.nova <= 0 && dist < 240) {
      e.mcd.nova = 8;
      e.castT = 0.7;
      sim.telegraph(e.x, e.y, 190, 0.7, () => {
        if (!e.alive) return;
        for (const u of sim.alliesIn(e.x, e.y, 190)) if (u.kind !== 'kongming') sim.damage(e, u, e.atk * 1.9, { tag: 'mirror' });
        sim.pushFx({ t: 'boom', x: e.x, y: e.y, r: 190 });
      }, 0xc47bff);
      sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 20, text: '心魔爆裂！', color: '#c47bff', size: 26 });
      return;
    }
    if (e.mcd.dash <= 0 && dist < 440 && dist > 120) {
      e.mcd.dash = 6;
      e.castT = 0.55;
      const tx = t.x; const ty = t.y;
      sim.telegraph(tx, ty, 115, 0.55, () => {
        if (!e.alive) return;
        e.x = tx; e.y = ty; e.prevX = tx; e.prevY = ty;
        for (const u of sim.alliesIn(tx, ty, 115)) if (u.kind !== 'kongming') sim.damage(e, u, e.atk * 1.5, { tag: 'mirror' });
        sim.pushFx({ t: 'boom', x: tx, y: ty, r: 115, small: true });
      }, 0xff9a5a);
      return;
    }
  }

  const reach = e.range + e.r + (t.r || 20);
  if (dist <= reach) {
    if (e.cd <= 0) {
      e.cd = e.cdMax;
      sim.damage(e, t, e.atk, { tag: 'mirror' });
    }
    return;
  }
  if (e.st.root > 0) return;
  const slow = e.st.slow ? 1 - Math.min(0.8, e.st.slow.v) : 1;
  const sp = e.spd * slow * dt;
  e.x += ((t.x - e.x) / Math.max(1, dist)) * sp;
  e.y += ((t.y - e.y) / Math.max(1, dist)) * sp;
  pushOutOfWalls(e, e.r, sim.walls);
}

export default {
  id: 'mirror',
  init(sim) {
    const cfg = sim.map && sim.map.mirrorChallenge;
    if (!cfg) {
      sim.mirror = null;
      return;
    }
    sim.mirror = {
      cfg,
      cleared: {},
      activeId: null,
      activeTier: null,
      totalPowerBonus: 0,
      bonus: { atk: 0, maxHp: 0, def: 0, skillDmg: 0 },
    };

    // 将镜像永久属性飞升挂入英雄属性计算
    sim.statSources.push((u) => {
      if (u.kind !== 'hero' || !sim.mirror) return null;
      const b = sim.mirror.bonus;
      const out = [];
      if (b.atk) out.push({ stat: 'atk', add: b.atk });
      if (b.maxHp) out.push({ stat: 'maxHp', add: b.maxHp });
      if (b.def) out.push({ stat: 'def', add: b.def });
      if (b.skillDmg) out.push({ stat: 'skillDmg', mul: b.skillDmg });
      return out.length ? out : null;
    });

    sim.on('kill', ({ enemy: e }) => {
      if (!e.mirrorBoss || !sim.mirror) return;
      const M = sim.mirror;
      const tier = (cfg.tiers || []).find((t) => t.id === e.mirrorTier);
      M.activeId = null;
      M.activeTier = null;
      if (!tier) return;
      const first = !M.cleared[tier.id];
      M.cleared[tier.id] = true;
      sim.addCopper(tier.copper || 200, e.x, e.y);
      if (first) {
        M.totalPowerBonus += tier.powerBonus || 5000;
        const rw = tier.reward || {};
        M.bonus.atk += rw.atk || 0;
        M.bonus.maxHp += rw.maxHp || 0;
        M.bonus.def += rw.def || 0;
        M.bonus.skillDmg += rw.skillDmg || 0;
        sim.markDirty(sim.hero);
        sim.calcStats(sim.hero);
        if (sim.hero.alive) sim.hero.hp = sim.hero.maxHp;
        sim.pushFx({ t: 'tame', x: sim.hero.x, y: sim.hero.y, key: sim.hero.key, color: 0xffd36a, portal: true });
        sim.banner(`镜像试炼突破【${tier.name}】！永久战力 +${tier.powerBonus}（累计 +${M.totalPowerBonus}）`, '#ffd36a', true);
      } else {
        sim.banner(`再次击败【${tier.name}】！铜钱 +${tier.copper}`, '#7fe3ff');
      }
      sim.emit('mirrorClear', { tier: tier.id, first, powerBonus: first ? tier.powerBonus : 0, totalPowerBonus: M.totalPowerBonus });
    });
  },
  update(sim, dt) {
    const M = sim.mirror;
    if (!M || !M.activeId) return;
    const boss = sim.enemies.find((e) => e.alive && e.id === M.activeId);
    if (!boss) {
      M.activeId = null;
      M.activeTier = null;
      return;
    }
    if (!mirrorTarget(sim, boss)) {
      boss.idleT = (boss.idleT || 0) + dt;
      if (boss.idleT >= 6) {
        boss.alive = false;
        M.activeId = null;
        M.activeTier = null;
      }
    } else {
      boss.idleT = 0;
    }
  },
  commands: {
    startMirror(sim, c) {
      const M = sim.mirror;
      if (!M) return { ok: false, reason: '当前地图未配置镜像挑战' };
      const h = sim.hero;
      if (!h || !h.alive) return { ok: false, reason: '英雄已倒下，无法开启镜像挑战' };
      const tier = (M.cfg.tiers || []).find((t) => t.id === c.tier) || M.cfg.tiers[0];
      if (!tier) return { ok: false, reason: '无效镜像阶层' };
      // 清除旧镜像
      for (const e of sim.enemies) if (e.alive && e.mirrorBoss) e.alive = false;
      const pos = { x: h.x + 220, y: h.y };
      const r = h.r + 6;
      pushOutOfWalls(pos, r, sim.walls);
      clampWorld(pos, r, sim.map, h.realm || null);
      const sx = pos.x;
      const sy = pos.y;
      const mul = tier.mul || 2;
      const def = {
        name: `${tier.name}·${h.name}`,
        tex: h.def.tex,
        hp: Math.max(4000, Math.round(h.maxHp * (1.8 + mul * 1.1))),
        atk: Math.max(70, Math.round((h.stats?.atk || 30) * (0.85 + mul * 0.28))),
        def: Math.round((h.stats?.def || 10) * (0.85 + mul * 0.16)),
        spd: Math.min(230, Math.round((h.stats?.spd || 200) * 0.85)),
        range: 78,
        cd: 0.95,
        r: h.r + 6,
        h: h.h + 18,
        copper: tier.copper || 200,
        xp: 120 * mul,
        ai: 'melee',
      };
      const e = sim.spawnEnemy(`mirror_${tier.id}`, sx, sy, {
        def,
        name: def.name,
        boss: 'realm',
        realm: h.realm || null,
        home: { x: sx, y: sy },
        tint: 0xd0a8ff,
        extra: {
          mirrorBoss: true,
          mirrorTier: tier.id,
          beastKey: h.key,
          realmColor: 0xc47bff,
          update: mirrorUpdate,
          mcd: { nova: 3.5, dash: 2.0 },
          castT: 0.5,
        },
      });
      M.activeId = e.id;
      M.activeTier = tier.id;
      sim.pushFx({ t: 'realmBoss', x: sx, y: sy, color: 0xc47bff });
      sim.banner(`心魔镜像【${tier.name}】现身！击败永久提升 +${tier.powerBonus} 战力`, '#c47bff', true);
      sim.emit('mirrorStart', { tier: tier.id, boss: e });
      return { ok: true, tier: tier.id, bossId: e.id };
    },
  },
};

// 存档：妖物 update 函数登记，读档时按名字还原
regFn('mirror.mirrorUpdate', mirrorUpdate);
