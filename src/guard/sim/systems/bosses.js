// BOSS 与精英（M2 战斗）
// - 第 10/20/30 波：灯骸老祖 / 旱魃 / 夜帝·无光（自带 e.update：沿北路推进、招式轮换、大招先红圈预警）
// - 无尽模式 30 波后每 10 波轮换三只 BOSS，按波次成长加血加攻
// - 每第 5 波（非 BOSS 波）刷 1 只精英：体型 ×1.6、血 ×8、额外一个带预警的重击
// - 剧情模式第 30 波终极 BOSS 伏诛 → 胜利
import BAL from '../../data/balance.json' with { type: 'json' };
import BD from '../../data/bosses.json' with { type: 'json' };
import ENEMIES from '../../data/enemies.json' with { type: 'json' };
import { poolFor, isBossWave } from './waves.js';
import { pushOutOfWalls } from '../map.js';
import { regFn } from '../../persist/fnRegistry.js';

const W = BAL.waves;
const TAU = Math.PI * 2;

// 本波该出哪只 BOSS：{key, base}（base = 该 BOSS 首次出场波次，用于无尽加成）
export function bossFor(n, mode) {
  const o = BD.order.find((x) => x.wave === n);
  if (o) return { key: o.key, base: o.wave };
  const last = BD.order[BD.order.length - 1].wave;
  if (mode === 'endless' && n > last && n % BD.endless.every === 0) {
    const rot = BD.endless.rotation;
    const key = rot[((n - last) / BD.endless.every - 1) % rot.length];
    return { key, base: BD.order.find((x) => x.key === key).wave };
  }
  return null;
}

function hitAllies(sim, e, x, y, r, dmg) {
  if (!e.alive || sim.over) return;
  for (const u of sim.alliesIn(x, y, r, true)) if (!u.realm) sim.damage(e, u, dmg, { bldMul: 1.5 });
}

// 预警后结算：BOSS 死了就取消
function warnThen(sim, e, x, y, r, warn, fn, color) {
  sim.telegraph(x, y, r, warn, () => { if (e.alive && !sim.over) fn(); }, color);
}

function spawnMinion(sim, e, type, x, y) {
  const wv = sim.wave;
  const m = sim.spawnEnemy(type, x, y, { lane: e.lane, hpMul: wv.hpMul || 1, atkMul: wv.atkMul || 1 });
  m.wp = e.wp;
  m.ox = sim.rand(-50, 50);
  m.oy = sim.rand(-50, 50);
  m.copper = 0; // 召唤物不给钱，避免刷钱
  return m;
}

// ---------------- BOSS 招式 ----------------
const MOVES = {
  slam(sim, e, s) { // 以自身为圆心的震地
    e.busy = s.warn;
    warnThen(sim, e, e.x, e.y, s.r, s.warn, () => {
      hitAllies(sim, e, e.x, e.y, s.r, e.atk * s.coef);
      sim.pushFx({ t: 'boom', x: e.x, y: e.y, r: s.r });
    });
  },
  volley(sim, e, s, tp) { // 目标周围 n 个落点
    e.busy = 0.4;
    for (let i = 0; i < s.n; i++) {
      const a = sim.rng() * TAU;
      const d = i === 0 ? 0 : sim.rand(60, s.spread);
      const x = tp.x + Math.cos(a) * d;
      const y = tp.y + Math.sin(a) * d * 0.7;
      warnThen(sim, e, x, y, s.r, s.warn + i * 0.08, () => {
        hitAllies(sim, e, x, y, s.r, e.atk * s.coef);
        sim.pushFx({ t: 'boom', x, y, r: s.r, small: true });
        sim.pushFx({ t: 'drop', x, y, tex: 'proj_ghostfire', tint: 0xff5ad0 });
      }, 0xb05aff);
    }
  },
  summon(sim, e, s) {
    e.busy = s.warn;
    warnThen(sim, e, e.x, e.y, 140, s.warn, () => {
      for (let i = 0; i < s.n; i++) {
        const a = (i / s.n) * TAU;
        const type = e.phase2 && s.type2 && i % 2 ? s.type2 : s.type;
        spawnMinion(sim, e, type, e.x + Math.cos(a) * 120, e.y + Math.sin(a) * 80);
      }
      sim.pushFx({ t: 'ring', x: e.x, y: e.y, r: 160, color: 0xb05aff, dur: 0.6 });
      sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 20, text: s.name, color: '#d8a0ff', size: 24 });
    }, 0xb05aff);
  },
  firerain(sim, e, s, tp) { // 旱魃：火雨，落地留火
    e.busy = 0.5;
    for (let i = 0; i < s.n; i++) {
      const a = sim.rng() * TAU;
      const d = i === 0 ? 0 : sim.rand(80, s.spread);
      const x = tp.x + Math.cos(a) * d;
      const y = tp.y + Math.sin(a) * d * 0.7;
      warnThen(sim, e, x, y, s.r, s.warn + i * 0.1, () => {
        hitAllies(sim, e, x, y, s.r, e.atk * s.coef);
        sim.pushFx({ t: 'drop', x, y, tex: 'proj_flame' });
        sim.pushFx({ t: 'boom', x, y, r: s.r, small: true });
        sim.addZone({ x, y, r: s.r * 0.9, t: s.zoneT, vis: 'fire', side: 'enemy', tick: 0.5,
          onTick(ss, z) { hitAllies(ss, e, z.x, z.y, z.r, e.atk * s.coef * 0.15); } });
      });
    }
  },
  charge(sim, e, s, tp) { // 旱魃：沿直线预警后冲撞
    const a = Math.atan2(tp.y - e.y, tp.x - e.x);
    e.busy = s.warn + s.dist / s.speed;
    const n = 5;
    for (let i = 1; i <= n; i++) {
      const d = (s.dist * i) / n;
      sim.telegraph(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, s.r, s.warn);
    }
    sim.telegraph(e.x, e.y, s.r, s.warn, () => {
      if (!e.alive) return;
      e.rush = { vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed, t: s.dist / s.speed, r: s.r, dmg: e.atk * s.coef, hit: new Set() };
      sim.pushFx({ t: 'sfx', name: 'roar' });
    });
  },
  nova(sim, e, s) {
    e.busy = s.warn;
    warnThen(sim, e, e.x, e.y, s.r, s.warn, () => {
      hitAllies(sim, e, e.x, e.y, s.r, e.atk * s.coef);
      sim.pushFx({ t: 'boom', x: e.x, y: e.y, r: s.r });
      sim.pushFx({ t: 'ring', x: e.x, y: e.y, r: s.r, color: 0xff7a30, dur: 0.5 });
    });
  },
  dark(sim, e, s, tp) { // 夜帝：吞光领域——持续伤害 + 区域内友军伤害降低
    e.busy = 0.5;
    warnThen(sim, e, tp.x, tp.y, s.r, s.warn, () => {
      sim.addZone({ x: tp.x, y: tp.y, r: s.r, t: s.dur, vis: 'dark', side: 'enemy', tick: s.tick,
        onTick(ss, z) {
          if (!e.alive || ss.over) return;
          for (const u of ss.alliesIn(z.x, z.y, z.r)) {
            if (u.realm) continue;
            ss.damage(e, u, e.atk * s.coef);
            if (u.alive) ss.addBuff(u, 'tunguang', s.tick + 0.1, [{ stat: 'dmg', add: -s.dmgCut }]);
          }
        } });
      sim.pushFx({ t: 'text', x: tp.x, y: tp.y - 80, text: s.name, color: '#d8a0ff', size: 26 });
    }, 0xb05aff);
  },
  eclipse(sim, e, s, tp) { // 夜帝二阶段：日蚀，巨大预警圈
    e.busy = s.warn;
    warnThen(sim, e, tp.x, tp.y, s.r, s.warn, () => {
      hitAllies(sim, e, tp.x, tp.y, s.r, e.atk * s.coef);
      sim.pushFx({ t: 'boom', x: tp.x, y: tp.y, r: s.r });
      sim.pushFx({ t: 'ring', x: tp.x, y: tp.y, r: s.r, color: 0xb05aff, dur: 0.7 });
    }, 0xb05aff);
  },
};

function pickTarget(sim, e) {
  let best = null;
  let bd = e.aggro * e.aggro;
  for (const u of sim.units) if (u.alive && !u.realm) { const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2; if (d < bd) { bd = d; best = u; } }
  for (const b of sim.buildings) if (b.alive) { const d = ((b.x - e.x) ** 2 + (b.y - e.y) ** 2) * 1.3; if (d < bd) { bd = d; best = b; } }
  return best;
}

function bossUpdate(sim, e, dt, frozen) {
  const d = e.bdef;
  const K = sim.kongming;
  // 二阶段
  if (d.phase2 && !e.phase2 && e.hp <= e.maxHp * d.phase2.at) {
    e.phase2 = true;
    e.cdMul = d.phase2.cdMul;
    e.spdMul = d.phase2.spdMul;
    e.atk *= d.phase2.atkMul;
    e.skT = Math.min(e.skT, 1);
    sim.banner(`${e.name} · 狂怒！`, '#d8a0ff', true);
    sim.pushFx({ t: 'ring', x: e.x, y: e.y, r: 320, color: 0xb05aff, dur: 0.9 });
    sim.pushFx({ t: 'sfx', name: 'roar' });
  }
  if (e.rush) { // 冲撞中（不受控制打断）
    const r = e.rush;
    e.x += r.vx * dt;
    e.y += r.vy * dt;
    r.t -= dt;
    for (const u of sim.alliesIn(e.x, e.y, r.r, true)) if (!r.hit.has(u.id) && !u.realm) { r.hit.add(u.id); sim.damage(e, u, r.dmg, { bldMul: 1.5 }); }
    pushOutOfWalls(e, e.r, sim.walls, { flying: e.flying });
    if (r.t <= 0) e.rush = null;
    return;
  }
  if (frozen) return;
  if (e.busy > 0) { e.busy -= dt; return; }
  e.tgtT -= dt;
  if (e.tgtT <= 0 || (e.tgt && !e.tgt.alive)) { e.tgtT = 0.4; e.tgt = pickTarget(sim, e); }
  const t = e.tgt;
  // 招式轮换（沉默时禁止施放技能）
  e.skT -= dt;
  const dk = (K.x - e.x) ** 2 + (K.y - e.y) ** 2;
  if (!(e.st.silence > 0) && e.skT <= 0 && (t || dk < 700 * 700)) {
    const list = d.skills.filter((s) => !s.phase2 || e.phase2);
    const s = list[e.skI++ % list.length];
    const tp = t ? { x: t.x, y: t.y } : { x: K.x, y: K.y };
    MOVES[s.id](sim, e, s, tp);
    sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 18, text: `${s.name}！`, color: '#ff9a7a', size: 22 });
    e.skT = s.cd * e.cdMul * 0.6;
    return;
  }
  // 普攻 / 推进
  const reach = t ? e.range + e.r + (t.r || 20) : 0;
  if (t && (t.x - e.x) ** 2 + (t.y - e.y) ** 2 <= reach * reach) {
    e.face = t.x >= e.x ? 1 : -1;
    if (e.cd <= 0) {
      e.cd = e.cdMax * e.cdMul;
      e.atkAnim = 0.3;
      sim.damage(e, t, e.atk, { bldMul: 1.5 });
      sim.pushFx({ t: 'slash', x: e.x, y: e.y - e.h * 0.4, a: Math.atan2(t.y - e.y, t.x - e.x), r: e.range + e.r, arc: 1.6, color: 0xff6a5a });
    }
    return;
  }
  let gx;
  let gy;
  if (t) { gx = t.x; gy = t.y; }
  else {
    const lanes = (sim.map && sim.map.lanes) || BAL.lanes;
    const path = lanes[e.lane] || Object.values(lanes)[0];
    if (path && e.wp < path.length) {
      gx = path[e.wp][0]; gy = path[e.wp][1];
      if ((e.x - gx) ** 2 + (e.y - gy) ** 2 < 80 * 80) e.wp++;
    } else { gx = K.x; gy = K.y; e.tgt = K; }
  }
  if (e.st.root > 0) return;
  const slow = e.st.slow ? 1 - Math.min(0.5, e.st.slow.v) : 1; // BOSS 减速最多 50%
  const a = Math.atan2(gy - e.y, gx - e.x);
  const sp = e.spd * e.spdMul * slow * dt;
  const nx = e.x + Math.cos(a) * sp;
  const ny = e.y + Math.sin(a) * sp;
  for (const b of sim.buildings) {
    if (!b.alive || !b.block) continue;
    const rr = b.r + e.r;
    if ((nx - b.x) ** 2 + (ny - b.y) ** 2 < rr * rr) { e.tgt = b; return; }
  }
  e.x = nx;
  e.y = ny;
  e.face = Math.cos(a) >= 0 ? 1 : -1;
  pushOutOfWalls(e, e.r, sim.walls, { flying: e.flying });
}

export function spawnBoss(sim, key, n = sim.wave.n, base = n) {
  const d = BD[key];
  const steps = Math.max(0, n - base);
  const lanes = (sim.map && sim.map.lanes) || BAL.lanes;
  const laneKey = lanes[BD.lane] ? BD.lane : ((sim.map && sim.map.laneOrder && sim.map.laneOrder[0]) || Object.keys(lanes)[0]);
  const p = lanes[laneKey][0];
  let bossName = d.name;
  if (steps > 0) {
    const roster = (BD.endlessRoster && BD.endlessRoster[key]) || [];
    bossName = sim.pickUniqueBossName ? sim.pickUniqueBossName(d.name, roster, d.name) : `${d.name}·第${n}波`;
  } else if (sim.usedBossNames) {
    sim.usedBossNames[d.name] = 1;
  }
  const useSimayi = steps > 0 && /司马|贾诩|郭嘉|荀彧|程昱|钟繇/.test(bossName);
  const def = { name: bossName, tex: useSimayi ? 'g_boss_simayi' : d.tex, h: d.h, r: d.r, hp: d.hp, atk: d.atk, def: d.def, spd: d.spd, range: d.range, cd: d.cd, ai: 'boss', copper: d.copper, xp: d.xp, aggro: d.aggro };
  const e = sim.spawnEnemy(`boss_${key}`, p[0], p[1] + 60, {
    def, name: bossName, boss: key, lane: laneKey, hpMul: W.hpGrowth ** steps, atkMul: W.atkGrowth ** steps,
    extra: { sheet: useSimayi ? null : (d.sheet || null), sheetScale: d.sheetScale || 1, bdef: d, phase2: false, skI: 0, skT: 3, busy: 0, cdMul: 1, spdMul: 1, rush: null, update: bossUpdate },
  });
  e.wp = 1;
  sim.wave.boss = e;
  const laneName = ((sim.map && sim.map.laneNames) || BAL.laneNames || { N: '北' })[laneKey] || laneKey;
  sim.banner(`BOSS · ${bossName} 现身${laneName}路！`, '#ff6a5a', true);
  sim.pushFx({ t: 'sfx', name: 'roar' });
  sim.emit('bossSpawn', e);
  return e;
}

function weighted(sim, w) {
  let tot = 0;
  for (const k in w) tot += w[k];
  let r = sim.rng() * tot;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return Object.keys(w)[0];
}

export function spawnElite(sim, n = sim.wave.n) {
  const E = BD.elite;
  const pool = { ...poolFor(n) };
  for (const k of E.exclude) delete pool[k];
  const type = weighted(sim, pool);
  const lanesMap = (sim.map && sim.map.lanes) || BAL.lanes;
  const lanes = sim.wave.lanes && sim.wave.lanes.length ? sim.wave.lanes : [Object.keys(lanesMap)[0]];
  const lane = lanes[(sim.rng() * lanes.length) | 0];
  const p = (lanesMap[lane] || Object.values(lanesMap)[0])[0];
  const wv = sim.wave;
  const roster = BD.eliteRoster || [];
  const used = (sim.usedBossNames ||= {});
  const picked = roster.find((r) => r && r.name && !used[r.name]) || null;
  let eliteName;
  let eliteSkillKind;
  let eliteSkillName;
  if (picked) {
    used[picked.name] = 1;
    eliteName = picked.name;
    eliteSkillKind = picked.skillKind || 'slam';
    eliteSkillName = picked.skillName || E.skill.name;
  } else {
    const fallbackKinds = ['slam', 'nova', 'volley', 'charge'];
    const idx = Math.floor(n / Math.max(1, E.every || 5));
    eliteName = sim.pickUniqueBossName ? sim.pickUniqueBossName(`精英·${ENEMIES[type].name}`, [], ENEMIES[type].name) : `精英·${ENEMIES[type].name}`;
    eliteSkillKind = fallbackKinds[idx % fallbackKinds.length];
    eliteSkillName = E.skill.name;
  }
  const e = sim.spawnEnemy(type, p[0] + sim.rand(-40, 40), p[1] + sim.rand(-40, 40), {
    lane, elite: true, scale: E.scale, tint: E.tint, name: eliteName,
    hpMul: (wv.hpMul || 1) * E.hpMul, atkMul: (wv.atkMul || 1) * E.atkMul,
    extra: { eliteSkillKind, eliteSkillName },
  });
  e.ox = 0;
  e.oy = 0;
  e.copper *= E.copperMul;
  e.xp *= E.xpMul;
  e.eliteT = 3;
  sim.banner(`精英首领【${e.name}】来袭！`, '#ffb070');
  sim.emit('eliteSpawn', e);
  return e;
}

function eliteSkill(sim, e, dt) {
  const S = BD.elite.skill;
  if (e.st.stun > 0 || e.st.freeze > 0 || e.st.silence > 0) return;
  e.eliteT -= dt;
  if (e.eliteT > 0) return;
  let t = e.tgt && e.tgt.alive && (e.tgt.x - e.x) ** 2 + (e.tgt.y - e.y) ** 2 <= S.range * S.range ? e.tgt : null;
  if (!t) {
    let bd = S.range * S.range;
    for (const u of sim.units) if (u.alive && !u.realm) { const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2; if (d < bd) { bd = d; t = u; } }
  }
  if (!t) { e.eliteT = 0.5; return; }
  e.eliteT = S.cd;
  const x = t.x; const y = t.y;
  const kind = e.eliteSkillKind || 'slam';
  const label = e.eliteSkillName || S.name;
  sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 14, text: `${label}！`, color: '#ffb070', size: 20 });
  if (kind === 'nova') {
    const r = S.r * 1.2;
    warnThen(sim, e, e.x, e.y, r, S.warn, () => {
      hitAllies(sim, e, e.x, e.y, r, e.atk * S.coef * 0.9);
      sim.pushFx({ t: 'boom', x: e.x, y: e.y, r, small: true });
      sim.pushFx({ t: 'ring', x: e.x, y: e.y, r, color: 0xff9a3c, dur: 0.45 });
    });
    return;
  }
  if (kind === 'volley') {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const vx = i === 0 ? x : x + Math.cos(a) * 105;
      const vy = i === 0 ? y : y + Math.sin(a) * 75;
      warnThen(sim, e, vx, vy, S.r * 0.72, S.warn + i * 0.1, () => {
        hitAllies(sim, e, vx, vy, S.r * 0.72, e.atk * S.coef * 0.7);
        sim.pushFx({ t: 'boom', x: vx, y: vy, r: S.r * 0.72, small: true });
      }, 0xb05aff);
    }
    return;
  }
  if (kind === 'charge') {
    warnThen(sim, e, x, y, S.r * 0.9, S.warn, () => {
      e.x = x; e.y = y; e.prevX = x; e.prevY = y;
      pushOutOfWalls(e, e.r, sim.walls, { flying: e.flying });
      hitAllies(sim, e, x, y, S.r * 0.9, e.atk * S.coef);
      sim.pushFx({ t: 'boom', x, y, r: S.r * 0.9, small: true });
    }, 0xff7a30);
    return;
  }
  warnThen(sim, e, x, y, S.r, S.warn, () => {
    hitAllies(sim, e, x, y, S.r, e.atk * S.coef);
    sim.pushFx({ t: 'boom', x, y, r: S.r, small: true });
  });
}

export default {
  id: 'bosses',
  init(sim) {
    sim.bossesKilled = 0;
    sim.on('waveStart', (w) => {
      const b = bossFor(w.n, sim.mode);
      if (b) spawnBoss(sim, b.key, w.n, b.base);
      else if (w.n % BD.elite.every === 0 && !isBossWave(w.n)) spawnElite(sim, w.n);
    });
    sim.on('kill', ({ enemy }) => {
      if (!enemy.boss) return;
      sim.stats.bossKills++;
      sim.bossesKilled++;
      if (sim.wave.boss === enemy) sim.wave.boss = null;
      sim.banner(`${enemy.name} 伏诛！`, '#ffd36a', true);
      sim.emit('bossKill', enemy);
      if (sim.mode === 'story' && enemy.boss === BD.final && sim.wave.n >= W.storyLast) sim.end(true, `第 ${W.storyLast} 波 · ${enemy.name} 伏诛`);
    });
  },
  update(sim, dt) {
    for (const e of sim.enemies) if (e.alive && e.elite && !e.boss) eliteSkill(sim, e, dt);
  },
};

// 存档：妖物 update 函数登记，读档时按名字还原
regFn('bosses.bossUpdate', bossUpdate);
