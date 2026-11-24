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
    sim.spawnEnemy(cfg.mobType || 'wolf', wx, wy, {
      name: isAlpha ? (cfg.alphaName || '银背狼王') : (cfg.mobName || '苍原野狼'),
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
