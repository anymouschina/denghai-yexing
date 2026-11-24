// 波次导演：定时开波（实时，不等清场）、多路分配、类型池、血量成长、提前召唤奖励。
// M1 基础版；BOSS / 精英由战斗系统（M2）通过 sim.on('waveStart') 挂接。
import BAL from '../../data/balance.json' with { type: 'json' };
import ENEMIES from '../../data/enemies.json' with { type: 'json' };
import WV from '../../data/waves.json' with { type: 'json' };

const W = BAL.waves;

export function lanesFor(n, map = null) {
  const lanesAt = (map && map.lanesAt) || W.lanesAt;
  const order = (map && map.laneOrder) || BAL.laneOrder;
  let k = 1;
  for (const [from, c] of lanesAt) if (n >= from) k = c;
  return order.slice(0, Math.min(k, order.length));
}

export function poolFor(n) {
  let p = WV.pools[0];
  for (const x of WV.pools) if (n >= x.from) p = x;
  return p.weights;
}

export function isBossWave(n) { return n % 10 === 0; }

function weighted(sim, w) {
  let tot = 0;
  for (const k in w) tot += w[k];
  let r = sim.rng() * tot;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return Object.keys(w)[0];
}

export function startWave(sim) {
  const wv = sim.wave;
  wv.n++;
  const n = wv.n;
  wv.lanes = lanesFor(n, sim.map);
  wv.spawnTotal = Math.round(W.countBase + W.countPerWave * (n - 1));
  wv.spawnLeft = wv.spawnTotal;
  wv.spawnT = 0;
  wv.startedAt = sim.t;
  wv.hpMul = W.hpGrowth ** (n - 1);
  wv.atkMul = W.atkGrowth ** (n - 1);
  wv.armorBonus = (W.armorPerWave || 0) * Math.max(0, n - 1);
  wv.nextAt = sim.t + (isBossWave(n) ? W.bossInterval : W.interval);
  wv.laneIdx = 0;
  // 军饷：每波开始按波数发放（持续波次很少清场，单靠清波奖励铜钱会断档）
  sim.addCopper(W.stipendBase + W.stipendPerWave * n);
  sim.emit('waveStart', { n, lanes: wv.lanes, boss: isBossWave(n) });
  const names = (sim.map && sim.map.laneNames) || BAL.laneNames || { N: '北', E: '东', W: '西', S: '南' };
  sim.banner(`第 ${n} 波 · ${wv.lanes.map((l) => names[l] || l).join('、')}路来袭`, isBossWave(n) ? '#ff6a5a' : '#ffc977', isBossWave(n));
}

export function spawnOne(sim, type, lane, o = {}) {
  const lanes = (sim.map && sim.map.lanes) || BAL.lanes;
  const p = (lanes[lane] || Object.values(lanes)[0])[0];
  const wv = sim.wave;
  const d = ENEMIES[type];
  const isCustom = !!(o.boss || o.elite);
  const sHp = isCustom ? 1 : (W.swarmHpMul ?? 1);
  const sAtk = isCustom ? 1 : (W.swarmAtkMul ?? 1);
  let copper = o.copper ?? (d ? d.copper || 0 : 0);
  let xp = o.xp ?? (d ? d.xp || 0 : 0);
  if (o.copper === undefined && !isCustom && (W.swarmCopperMul ?? 1) !== 1) {
    wv._cAcc = (wv._cAcc || 0) + copper * W.swarmCopperMul;
    copper = Math.floor(wv._cAcc);
    wv._cAcc -= copper;
  }
  if (o.xp === undefined && !isCustom && (W.swarmXpMul ?? 1) !== 1) {
    wv._xAcc = (wv._xAcc || 0) + xp * W.swarmXpMul;
    xp = Math.floor(wv._xAcc);
    wv._xAcc -= xp;
  }
  const e = sim.spawnEnemy(type, p[0] + sim.rand(-75, 75), p[1] + sim.rand(-75, 75), {
    ...o,
    lane,
    hpMul: (wv.hpMul || 1) * sHp * (o.hpMul || 1),
    atkMul: (wv.atkMul || 1) * sAtk * (o.atkMul || 1),
    armorBonus: o.armorBonus ?? wv.armorBonus ?? 0,
    copper,
    xp,
  });
  e.ox = sim.rand(-65, 65);
  e.oy = sim.rand(-65, 65);
  return e;
}

export default {
  id: 'waves',
  update(sim, dt) {
    const wv = sim.wave;
    const last = sim.mode === 'story' ? W.storyLast : Infinity;
    if (wv.n < last && sim.t >= wv.nextAt) startWave(sim);
    if (wv.spawnLeft > 0) {
      wv.spawnT -= dt;
      if (wv.spawnT <= 0) {
        const interval = W.spawnDur / Math.max(1, wv.spawnTotal);
        let alive = 0;
        for (const e of sim.enemies) if (e.alive) alive++;
        while (wv.spawnLeft > 0 && wv.spawnT <= 0) {
          if (alive >= BAL.enemyCap) {
            wv.spawnT = 0.4;
            break;
          }
          const lane = wv.lanes[wv.laneIdx++ % wv.lanes.length];
          spawnOne(sim, weighted(sim, poolFor(wv.n)), lane);
          wv.spawnLeft--;
          alive++;
          wv.spawnT += interval;
        }
      }
    }
    // 清波奖励：本波刷完且场上主线妖物清空
    if (wv.n > 0 && wv.spawnLeft === 0 && !wv.cleared) {
      if (!sim.enemies.some((e) => e.alive && !e.realm)) {
        wv.cleared = true;
        sim.addCopper(W.clearBonusBase + W.clearBonusPerWave * wv.n);
        sim.emit('waveClear', { n: wv.n });
      }
    }
    if (wv.spawnLeft > 0) wv.cleared = false;
  },
  commands: {
    callWave(sim) {
      const wv = sim.wave;
      const last = sim.mode === 'story' ? W.storyLast : Infinity;
      if (wv.n >= last) return { ok: false, reason: '已是最后一波' };
      const left = Math.max(0, wv.nextAt - sim.t);
      const bonus = Math.round(left * W.earlyBonusPerSec);
      if (bonus > 0) sim.addCopper(bonus);
      startWave(sim);
      return { ok: true, bonus };
    },
  },
};
