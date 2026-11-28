// 可复用《守卫剑阁》猎人 NPC 与狩猎任务系统（数据驱动，配置见 map.hunterCamp / balance.json）：
// - 西南林缘驻扎「老猎人·陈老汉」与野狼群（苍原野狼 / 银背狼王），绝不进攻孔明。
// - 猎人任务可无限重复：每猎杀 questNeed 只野狼自动交付，奖励铜钱 + 永久成长书卷 + 装备！
import { pushOutOfWalls } from '../map.js';
import { regFn } from '../../persist/fnRegistry.js';

function nearestAllyNear(sim, e, range) {
  let best = null;
  let bd = range * range;
  for (const u of sim.units) {
    if (!u.alive || u.kind === 'kongming' || u.realm) continue;
    const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

function wolfUpdate(sim, e, dt, frozen) {
  if (e.mcd) for (const k in e.mcd) if (e.mcd[k] > 0) e.mcd[k] -= dt;
  if (e.castT > 0) { e.castT -= dt; return; }
  if (frozen) return;
  const home = e.home || { x: e.x, y: e.y };
  const leash = e.leash || 460;
  const distHome = Math.hypot(e.x - home.x, e.y - home.y);
  let t = nearestAllyNear(sim, e, e.aggro || 360);
  if (t && Math.hypot(t.x - home.x, t.y - home.y) > leash + 100) t = null;
  if (!t || distHome > leash + 60) {
    if (distHome > 24) {
      const sp = e.spd * dt;
      e.x += ((home.x - e.x) / distHome) * sp;
      e.y += ((home.y - e.y) / distHome) * sp;
      e.face = home.x >= e.x ? 1 : -1;
      pushOutOfWalls(e, e.r, sim.walls);
    }
    return;
  }
  e.tgt = t;
  e.face = t.x >= e.x ? 1 : -1;
  const dist = Math.hypot(t.x - e.x, t.y - e.y);

  // 狼王主动技能（群狼狂嚎 / 裂喉扑杀），普通野狼放恶狼扑咬（均遵守沉默）
  if (e.alphaWolf && e.mcd && !(e.st.silence > 0)) {
    if (e.mcd.howl <= 0 && dist < 240) {
      e.mcd.howl = 10;
      e.castT = 0.6;
      sim.telegraph(e.x, e.y, 165, 0.6, () => {
        if (!e.alive || sim.over) return;
        for (const u of sim.alliesIn(e.x, e.y, 165)) if (u.kind !== 'kongming') sim.damage(e, u, e.atk * 1.65, { tag: 'hunter' });
        sim.pushFx({ t: 'ring', x: e.x, y: e.y, r: 165, color: 0x9fd8ff, dur: 0.45 });
      }, 0x9fd8ff);
      sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 14, text: '群狼狂嚎！', color: '#9fd8ff', size: 22 });
      return;
    }
    if (e.mcd.pounce <= 0 && dist < 320 && dist > 80) {
      e.mcd.pounce = 6.5;
      e.castT = 0.5;
      const px = t.x; const py = t.y;
      sim.telegraph(px, py, 95, 0.5, () => {
        if (!e.alive || sim.over) return;
        e.x = px; e.y = py; e.prevX = px; e.prevY = py;
        pushOutOfWalls(e, e.r, sim.walls);
        for (const u of sim.alliesIn(px, py, 95)) if (u.kind !== 'kongming') sim.damage(e, u, e.atk * 1.8, { tag: 'hunter' });
        sim.pushFx({ t: 'boom', x: px, y: py, r: 95, small: true, color: 0xd8ecff });
      }, 0xd8ecff);
      sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 14, text: '裂喉扑杀！', color: '#d8ecff', size: 20 });
      return;
    }
  } else if (!e.alphaWolf && sim.tryEnemySkill && sim.tryEnemySkill(e, dt)) {
    return;
  }

  const reach = e.range + e.r + (t.r || 20);
  if (dist <= reach) {
    if (e.cd <= 0) {
      e.cd = e.cdMax;
      sim.damage(e, t, e.atk, { tag: 'hunter' });
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

function liveWolves(sim, campId) {
  return sim.enemies.filter((e) => e.alive && e.hunterCamp === campId);
}

function spawnPack(sim, cfg) {
  const H = sim.hunter;
  const scale = 1 + 0.05 * Math.max(0, (sim.wave.n || 1) - 1) + 0.1 * H.clears;
  const cur = liveWolves(sim, cfg.id).length;
  const need = Math.max(0, (cfg.packSize || 5) - cur);
  for (let i = 0; i < need; i++) {
    const isAlpha = cur === 0 && i === 0;
    const ang = sim.rng() * Math.PI * 2;
    const rad = 85 + sim.rng() * 145;
    const wx = cfg.x + Math.cos(ang) * rad;
    const wy = cfg.y + Math.sin(ang) * rad;
    let mobName = cfg.mobName || '苍原野狼';
    if (isAlpha) {
      const baseAlpha = cfg.alphaName || '银背狼王';
      if ((H.alphaSpawns || 0) === 0) {
        mobName = baseAlpha;
        if (sim.usedBossNames) sim.usedBossNames[baseAlpha] = 1;
      } else if (sim.pickUniqueBossName) {
        mobName = sim.pickUniqueBossName(baseAlpha, cfg.alphaRoster || [], '苍原狼王');
      }
      H.alphaSpawns = (H.alphaSpawns || 0) + 1;
    }
    sim.spawnEnemy(cfg.mobType || 'wolf', wx, wy, {
      name: mobName,
      hpMul: scale * (isAlpha ? 2.2 : 1),
      atkMul: (1 + 0.035 * Math.max(0, (sim.wave.n || 1) - 1)) * (isAlpha ? 1.35 : 1),
      elite: isAlpha,
      realm: 'hunter_camp',
      home: { x: wx, y: wy },
      tint: isAlpha ? 0xd8ecff : 0x9aa8c4,
      extra: {
        hunterCamp: cfg.id,
        openCamp: true,
        hunterMob: true,
        alphaWolf: isAlpha,
        mcd: isAlpha ? { howl: 4.5, pounce: 3 } : null,
        castT: 0,
        update: wolfUpdate,
        leash: 480,
        aggro: 360,
      },
    });
  }
}

export default {
  id: 'hunter',
  init(sim) {
    const cfg = sim.map && sim.map.hunterCamp;
    if (!cfg) {
      sim.hunter = null;
      return;
    }
    sim.hunter = {
      cfg,
      prog: 0,
      need: cfg.questNeed || 6,
      clears: 0,
      respawnT: 0,
      npc: { name: cfg.npcName || '老猎人·陈老汉', x: cfg.x - 170, y: cfg.y + 40 },
    };
    spawnPack(sim, cfg);

    sim.on('kill', ({ enemy }) => {
      if (!enemy.hunterMob || enemy.hunterCamp !== cfg.id || !sim.hunter) return;
      const H = sim.hunter;
      H.prog++;
      if (H.prog >= H.need) {
        H.prog = 0;
        H.clears++;
        const rw = cfg.reward || {};
        const wave = Math.max(1, sim.wave.n || 1);
        const copper = (rw.copper || 160) + (rw.copperPerWave || 10) * wave;
        sim.addCopper(copper, enemy.x, enemy.y);
        let tomeName = '';
        const L = sim.loot;
        if (L && L.roll && L.grant) {
          const pool = rw.tomePool && rw.tomePool.length ? rw.tomePool : ['tome_atk', 'tome_hp', 'tome_def'];
          const tid = sim.pick(pool);
          const tome = L.roll({ id: tid });
          if (tome) { L.grant(tome, enemy.x, enemy.y); tomeName = tome.name; }
          for (let i = 0; i < (rw.equipCount || 1); i++) {
            const eq = L.roll({ wave: Math.max(wave, 2), minQ: rw.minQ || 1 });
            if (eq) L.grant(eq, enemy.x, enemy.y);
          }
        }
        sim.banner(`猎人任务完成（第 ${H.clears} 轮）！铜钱 +${copper}${tomeName ? ` + 【${tomeName}】` : ''}`, '#9ff0b8', true);
        sim.emit('hunterQuestDone', { clears: H.clears, copper, tomeName });
      }
    });
  },
  update(sim, dt) {
    const H = sim.hunter;
    if (!H) return;
    const cfg = H.cfg;
    const cur = liveWolves(sim, cfg.id).length;
    if (cur < (cfg.packSize || 5)) {
      H.respawnT += dt;
      if (H.respawnT >= (cur === 0 ? Math.min(8, cfg.respawnSec || 18) : (cfg.respawnSec || 18))) {
        H.respawnT = 0;
        spawnPack(sim, cfg);
      }
    } else {
      H.respawnT = 0;
    }
  },
  commands: {
    guideHunter(sim) {
      const H = sim.hunter;
      if (!H) return { ok: false, reason: '当前地图未配置猎人营地' };
      const u = sim.ctrl;
      if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
      const r = sim.command({ type: 'attackMove', x: H.cfg.x, y: H.cfg.y });
      return { ok: !!(r && r.ok), x: H.cfg.x, y: H.cfg.y, prog: H.prog, need: H.need };
    },
  },
};

// 存档：妖物 update 函数登记，读档时按名字还原
regFn('hunter.wolfUpdate', wolfUpdate);
