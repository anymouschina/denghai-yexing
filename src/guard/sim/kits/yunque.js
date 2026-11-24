// 云鹊 · 远程射手：散射 + 贯穿重箭 + 缚灵陷阱 + 燕返后跳 + 箭雨
import { cfg, atk, angTo, clampAim, hitCircle, fan, dash, tgtIn, clusterAim, ultAim, isBig } from './util.js';

export default {
  q: { // 散射：扇形 7 箭
    cast(sim, u, aim) {
      const c = cfg(u, 'q');
      const a = angTo(u, aim);
      fan(sim, u, a, c.n, c.spread, { speed: c.speed, life: c.range / c.speed, dmg: atk(u) * c.coef, r: 14, pierce: c.pierce, tex: 'g_arrow', scale: 0.9, tag: 'q' });
      sim.pushFx({ t: 'slash', x: u.x, y: u.y - (u.h || 60) * 0.42, a, r: 72, arc: c.spread, id: u.id, color: 0x7fe3ff, sparks: true, awakened: !!u.awakened });
      sim.pushFx({ t: 'sfx', name: 'shoot', vol: 0.6 });
    },
    ai(sim, u) { const t = tgtIn(u, cfg(u, 'q').range * 0.85); return t ? { x: t.x, y: t.y } : null; },
  },
  e: { // 穿云箭：长直线贯穿重箭
    cast(sim, u, aim) {
      const c = cfg(u, 'e');
      const a = angTo(u, aim);
      const awk = !!u.awakened;
      fan(sim, u, a, 1, 0, { speed: c.speed, life: c.range / c.speed, dmg: atk(u) * c.coef, r: c.r, pierce: 999, tex: 'g_arrow', scale: 2.2, tint: 0xbff4ff, tag: 'e' });
      sim.pushFx({ t: 'beam', x1: u.x, y1: u.y - 48, x2: u.x + Math.cos(a) * c.range, y2: u.y - 48 + Math.sin(a) * c.range, w: 12, color: 0x7fe3ff, dur: 0.4, sonic: true, awakened: awk });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y - 36, r: 62, color: 0xbff4ff, dur: 0.28, rune: awk });
      sim.pushFx({ t: 'sfx', name: 'thunder', vol: 0.4 });
    },
    ai(sim, u) {
      const c = cfg(u, 'e');
      const p = clusterAim(sim, u, c.range * 0.6, 160, 3);
      if (p) return p;
      const t = tgtIn(u, c.range * 0.6);
      return t && isBig(t) ? { x: t.x, y: t.y } : null;
    },
  },
  r: { // 缚灵陷阱：布在指定点，妖物踏入即定身 + 伤害
    cast(sim, u, aim) {
      const c = cfg(u, 'r');
      const p = clampAim(u, aim, c.range);
      sim.pushFx({ t: 'ring', x: p.x, y: p.y, r: c.r * 0.65, color: 0xffd36a, dur: 0.3, rune: true });
      sim.addZone({
        x: p.x, y: p.y, r: c.r, t: c.dur, total: c.dur, vis: 'trap', side: 'ally', armT: 0.3,
        update(s, z, dt) {
          z.armT -= dt;
          if (z.armT > 0 || !s.enemiesIn(z.x, z.y, z.r * 0.8).length) return;
          hitCircle(s, u, z.x, z.y, z.r, atk(u) * c.coef, { root: c.root, tag: 'r' });
          s.pushFx({ t: 'ring', x: z.x, y: z.y, r: z.r, color: 0xffd36a, dur: 0.5, rune: true });
          s.pushFx({ t: 'text', x: z.x, y: z.y - 60, text: '缚！', color: '#ffd36a', size: 22 });
          z.t = 0;
        },
      });
    },
    ai(sim, u) {
      const c = cfg(u, 'r');
      const p = clusterAim(sim, u, c.range, c.r, 2);
      if (p) return p;
      const t = tgtIn(u, c.range);
      return t ? { x: t.x, y: t.y } : null;
    },
  },
  f: { // 燕返：背向瞄准点后跃，落地朝瞄准方向回射 3 箭
    cast(sim, u, aim) {
      const c = cfg(u, 'f');
      const a = angTo(u, aim);
      u.invuln = Math.max(u.invuln, c.invuln);
      sim.pushFx({ t: 'beam', x1: u.x, y1: u.y - 40, x2: u.x - Math.cos(a) * c.dist, y2: u.y - 40 - Math.sin(a) * c.dist, w: 9, color: 0x7fe3ff, dur: 0.24, sonic: true });
      dash(u, a + Math.PI, c.dist, c.dur, {
        onEnd(s, uu) {
          const t = s.nearestEnemy(uu.x, uu.y, 600);
          const aa = t ? angTo(uu, t) : a;
          fan(s, uu, aa, c.n, 0.25, { speed: 900, life: 0.65, dmg: atk(uu) * c.coef, r: 14, pierce: 1, tex: 'g_arrow', scale: 1, tag: 'f' });
          s.pushFx({ t: 'slash', x: uu.x, y: uu.y - 40, a: aa, r: 66, arc: 0.9, id: uu.id, color: 0xbff4ff, sparks: true, awakened: !!uu.awakened });
        },
      });
      u.face = Math.cos(a) >= 0 ? 1 : -1;
      sim.pushFx({ t: 'sfx', name: 'dash', vol: 0.6 });
    },
    // 被贴身时后跳拉开（瞄准点 = 贴身的妖物）
    ai(sim, u) { const e = sim.nearestEnemy(u.x, u.y, 110); return e ? { x: e.x, y: e.y } : null; },
  },
  u: { // 箭雨：大范围持续伤害 + 减速
    cast(sim, u, aim) {
      const c = cfg(u, 'u');
      const p = clampAim(u, aim, c.range);
      sim.addZone({
        x: p.x, y: p.y, r: c.r, t: c.dur, total: c.dur, vis: 'arrowrain', tick: c.tick, side: 'ally',
        onTick(s, z) { hitCircle(s, u, z.x, z.y, z.r, atk(u) * c.coef, { slow: c.slow, slowT: 0.6, tag: 'u' }); },
      });
      sim.pushFx({ t: 'ring', x: p.x, y: p.y, r: c.r, color: 0x7fe3ff, dur: 0.55, rune: true, awakened: !!u.awakened });
      sim.pushFx({ t: 'ult', x: u.x, y: u.y, text: '箭雨', color: '#bff4ff', awakened: !!u.awakened, heroKey: 'yunque' });
    },
    ai(sim, u) { const c = cfg(u, 'u'); return ultAim(sim, u, c.range, c.r, 6); },
  },
};
