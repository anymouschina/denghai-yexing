// 雇佣兵技能（Q）：乡勇盾击、连弩齐发、道童八卦镜
import { cfg, atk, angTo, hitCone, fan, tgtIn, lowAlly, healUnit } from './util.js';

export const dao = {
  q: { // 盾击：前方锥形眩晕
    cast(sim, u, aim) {
      const c = cfg(u, 'q');
      const a = angTo(u, aim);
      hitCone(sim, u, a, c.r, c.arc, atk(u) * c.coef, { stun: c.stun, knock: 30, tag: 'q' });
      sim.pushFx({ t: 'slash', x: u.x, y: u.y - (u.h || 60) * 0.35, a, r: c.r, arc: c.arc, id: u.id, color: 0xd8c8a0 });
      sim.pushFx({ t: 'sfx', name: 'hit', vol: 0.6 });
    },
    ai(sim, u) { const t = tgtIn(u, cfg(u, 'q').r * 0.9); return t ? { x: t.x, y: t.y } : null; },
  },
};

export const nu = {
  q: { // 连弩齐发：间隔 gap 秒连射 n 箭
    cast(sim, u, aim) {
      const c = cfg(u, 'q');
      let left = c.n;
      const a0 = angTo(u, aim);
      sim.addZone({
        x: u.x, y: u.y, r: 1, t: c.n * c.gap + 0.2, follow: u.id, tick: c.gap, side: 'ally',
        onTick(s) {
          if (left-- <= 0 || !u.alive) return;
          const t = s.nearestEnemy(u.x, u.y, c.range);
          const a = (t ? angTo(u, t) : a0) + (s.rng() - 0.5) * 0.12;
          fan(s, u, a, 1, 0, { speed: c.speed, life: c.range / c.speed, dmg: atk(u) * c.coef, r: 14, tex: 'g_arrow', scale: 0.9, tag: 'q' });
        },
      });
      sim.pushFx({ t: 'sfx', name: 'shoot', vol: 0.5 });
    },
    ai(sim, u) { const t = tgtIn(u, cfg(u, 'q').range * 0.9); return t ? { x: t.x, y: t.y } : null; },
  },
};

export const tong = {
  q: { // 八卦镜：治疗周围友军（含孔明，按 kmMul 折算）
    cast(sim, u) {
      const c = cfg(u, 'q');
      for (const a of sim.alliesIn(u.x, u.y, c.r)) healUnit(sim, u, a, c);
      sim.addZone({ x: u.x, y: u.y, r: c.r, t: 0.8, vis: 'heal', side: 'ally' });
      sim.pushFx({ t: 'sfx', name: 'heal', vol: 0.5 });
    },
    ai(sim, u) { return lowAlly(sim, u, cfg(u, 'q').r, 0.7, 0.85) ? { x: u.x, y: u.y } : null; },
  },
};
