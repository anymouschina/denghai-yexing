// 玄霜 · 辅助治疗：寒霜环 + 回春铃（含孔明）+ 冰墙 + 清心铃 + 冰封千里
import { cfg, atk, angTo, clampAim, d2, hitCircle, clusterAim, lowAlly, healUnit, countNear, bossNear } from './util.js';

export default {
  q: { // 寒霜环：指定点范围减速 + 伤害
    cast(sim, u, aim) {
      const c = cfg(u, 'q');
      const p = clampAim(u, aim, c.range);
      const awk = !!u.awakened;
      hitCircle(sim, u, p.x, p.y, c.r, atk(u) * c.coef, { slow: c.slow, slowT: c.slowT, tag: 'q' });
      sim.addZone({ x: p.x, y: p.y, r: c.r, t: 0.6, vis: 'ice', side: 'ally' });
      sim.pushFx({ t: 'iceBurst', x: p.x, y: p.y, r: c.r, color: 0x9fe8ff, awakened: awk });
      sim.pushFx({ t: 'ring', x: p.x, y: p.y, r: c.r, color: 0x9fe8ff, dur: 0.45, rune: true, awakened: awk });
    },
    ai(sim, u) { const c = cfg(u, 'q'); return clusterAim(sim, u, c.range, c.r, 3); },
  },
  e: { // 回春铃：治疗周围友军；孔明不论远近都会被治疗（按 kmMul 折算）
    cast(sim, u) {
      const c = cfg(u, 'e');
      const km = sim.kongming;
      for (const a of sim.alliesIn(u.x, u.y, c.r)) if (a !== km) healUnit(sim, u, a, c);
      if (km && km.alive) { healUnit(sim, u, km, c); sim.pushFx({ t: 'ring', x: km.x, y: km.y, r: 120, color: 0x5fe08a, dur: 0.6, rune: true }); }
      sim.addZone({ x: u.x, y: u.y, r: c.r, t: 0.8, vis: 'heal', follow: u.id, side: 'ally' });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r * 0.65, color: 0x5fe08a, dur: 0.5, rune: true, awakened: !!u.awakened });
      sim.pushFx({ t: 'sfx', name: 'heal', vol: 0.7 });
    },
    ai(sim, u) {
      const c = cfg(u, 'e');
      const km = sim.kongming;
      if (km.alive && km.hp / km.maxHp < 0.8) return { x: u.x, y: u.y };
      return lowAlly(sim, u, c.r, 0.6) ? { x: u.x, y: u.y } : null;
    },
  },
  r: { // 冰墙：垂直于瞄准方向竖起一排冰柱，阻挡地面妖物
    cast(sim, u, aim) {
      const c = cfg(u, 'r');
      const p = clampAim(u, aim, c.range);
      const a = angTo(u, p) + Math.PI / 2;
      for (let i = 0; i < c.seg; i++) {
        const k = i - (c.seg - 1) / 2;
        sim.addZone({ x: p.x + Math.cos(a) * c.gap * k, y: p.y + Math.sin(a) * c.gap * k, r: c.segR, t: c.dur, total: c.dur, vis: 'wall', block: true, side: 'ally' });
      }
      sim.pushFx({ t: 'iceBurst', x: p.x, y: p.y, r: 120, color: 0xbff4ff, shards: 8, awakened: !!u.awakened });
      sim.pushFx({ t: 'sfx', name: 'hit', vol: 0.6 });
    },
    // 妖群朝孔明压过来时，在妖群和孔明之间立墙
    ai(sim, u) {
      const km = sim.kongming;
      const c = sim.bestCluster(km.x, km.y, 650, 140);
      if (!c || c.n < 4 || d2(c, km) < 180 * 180) return null;
      const a = Math.atan2(c.y - km.y, c.x - km.x);
      const dk = Math.sqrt(d2(c, km));
      const p = { x: km.x + Math.cos(a) * dk * 0.6, y: km.y + Math.sin(a) * dk * 0.6 };
      return d2(p, u) < cfg(u, 'r').range ** 2 ? p : null;
    },
  },
  f: { // 清心铃：周围友军加速（移速 + 攻速）
    cast(sim, u) {
      const c = cfg(u, 'f');
      for (const a of sim.alliesIn(u.x, u.y, c.r)) {
        if (a.kind === 'kongming') sim.addBuff(a, 'qingxin', c.dur, [{ stat: 'aspd', mul: c.aspd }]);
        else sim.addBuff(a, 'qingxin', c.dur, [{ stat: 'spd', mul: c.spd }, { stat: 'aspd', mul: c.aspd }]);
      }
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r, color: 0xbff4ff, dur: 0.6, rune: true, awakened: !!u.awakened });
      sim.pushFx({ t: 'text', x: u.x, y: u.y - 130, text: '清心', color: '#bff4ff', size: 22 });
    },
    ai(sim, u) { return countNear(sim, u.x, u.y, cfg(u, 'f').r) >= 4 ? { x: u.x, y: u.y } : null; },
  },
  u: { // 冰封千里：身周大范围冻结 + 伤害
    cast(sim, u) {
      const c = cfg(u, 'u');
      const awk = !!u.awakened;
      hitCircle(sim, u, u.x, u.y, c.r, atk(u) * c.coef, { freeze: c.freeze, tag: 'u' });
      sim.addZone({ x: u.x, y: u.y, r: c.r, t: c.freeze, vis: 'ice', side: 'ally' });
      sim.pushFx({ t: 'iceBurst', x: u.x, y: u.y, r: c.r, color: 0xd8f6ff, shards: 18, awakened: awk });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r, color: 0xd8f6ff, dur: 0.8, rune: true, awakened: awk });
      sim.pushFx({ t: 'ult', x: u.x, y: u.y, text: '冰封千里', color: '#bff4ff', awakened: awk, heroKey: 'xuanshuang' });
    },
    ai(sim, u) {
      const c = cfg(u, 'u');
      return bossNear(sim, u, c.r * 0.8) || countNear(sim, u.x, u.y, c.r * 0.8) >= 6 ? { x: u.x, y: u.y } : null;
    },
  },
};
