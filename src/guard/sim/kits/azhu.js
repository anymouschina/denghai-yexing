// 阿烛 · 远程术士：符箓弹幕 + 落雷 + 环绕狐火 + 闪现 + 符雨大招
import { cfg, atk, angTo, clampAim, hitCircle, fan, tgtIn, clusterAim, ultAim, countNear } from './util.js';
import { resolveBlinkPosition } from '../walls.js';

export default {
  q: { // 三连符：扇形 n 张符箓
    cast(sim, u, aim) {
      const c = cfg(u, 'q');
      fan(sim, u, angTo(u, aim), c.n, c.spread, { speed: c.speed, life: c.range / c.speed, dmg: atk(u) * c.coef, r: 16, pierce: c.pierce, tex: 'proj_talisman', scale: 0.62, tag: 'q' });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y - 24, r: 48, color: 0xffd36a, dur: 0.22, awakened: !!u.awakened });
      sim.pushFx({ t: 'sfx', name: 'shoot', vol: 0.5 });
    },
    ai(sim, u) { const t = tgtIn(u, cfg(u, 'q').range * 0.9); return t ? { x: t.x, y: t.y } : null; },
  },
  e: { // 掌心雷：指定点落雷
    cast(sim, u, aim) {
      const c = cfg(u, 'e');
      const p = clampAim(u, aim, c.range);
      const awk = !!u.awakened;
      hitCircle(sim, u, p.x, p.y, c.r, atk(u) * c.coef, { stun: c.stun, tag: 'e' });
      sim.pushFx({ t: 'thunder', x: p.x, y: p.y, r: c.r, rune: true, awakened: awk });
      sim.pushFx({ t: 'bolt', x1: p.x + 20, y1: p.y - 520, x2: p.x, y2: p.y, color: 0xbff4ff, rune: true });
      sim.pushFx({ t: 'ring', x: p.x, y: p.y, r: c.r, color: 0xbff4ff, dur: 0.35, rune: true, awakened: awk });
    },
    ai(sim, u) { const c = cfg(u, 'e'); return clusterAim(sim, u, c.range, c.r, 3); },
  },
  r: { // 狐火环：身周环绕狐火，持续灼伤
    cast(sim, u) {
      const c = cfg(u, 'r');
      sim.addZone({
        x: u.x, y: u.y, r: c.r, t: c.dur, total: c.dur, vis: 'foxring', follow: u.id, tick: c.tick, side: 'ally',
        onTick(s, z) { if (u.alive) hitCircle(s, u, z.x, z.y, z.r, atk(u) * c.coef, { tag: 'r' }); },
      });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r, color: 0xff7a30, dur: 0.42, rune: true, awakened: !!u.awakened });
      sim.pushFx({ t: 'sfx', name: 'dash', vol: 0.5 });
    },
    ai(sim, u) { return countNear(sim, u.x, u.y, cfg(u, 'r').r + 30) >= 2 ? { x: u.x, y: u.y } : null; },
  },
  f: { // 灯影步：向瞄准方向合法穿墙闪现 + 无敌；原地留下一张爆符
    cast(sim, u, aim) {
      const c = cfg(u, 'f');
      const a = angTo(u, aim);
      const awk = !!u.awakened;
      hitCircle(sim, u, u.x, u.y, c.r, atk(u) * c.coef, { tag: 'f' });
      sim.pushFx({ t: 'boom', x: u.x, y: u.y, r: c.r, small: true, color: 0xffd36a });
      const ox = u.x; const oy = u.y;
      const farAim = { x: u.x + Math.cos(a) * c.dist, y: u.y + Math.sin(a) * c.dist };
      const res = resolveBlinkPosition(sim, u, farAim, { range: c.dist });
      if (res.ok) { u.x = res.x; u.y = res.y; u.prevX = u.x; u.prevY = u.y; }
      sim.collideUnit(u);
      u.invuln = Math.max(u.invuln, c.invuln);
      u.face = Math.cos(a) >= 0 ? 1 : -1;
      sim.pushFx({ t: 'beam', x1: ox, y1: oy - 40, x2: u.x, y2: u.y - 40, w: 18, color: 0xffd36a, dur: 0.3, sonic: true, awakened: awk });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: 72, color: 0xffd36a, dur: 0.3, rune: true, awakened: awk });
    },
    // 残血且被贴身时，朝孔明方向闪开
    ai(sim, u) {
      if (u.hp / u.maxHp > 0.4) return null;
      const near = sim.nearestEnemy(u.x, u.y, 140);
      if (!near) return null;
      const K = sim.kongming;
      return { x: K.x, y: K.y };
    },
  },
  u: { // 万符朝宗：身周符雨
    cast(sim, u) {
      const c = cfg(u, 'u');
      sim.addZone({
        x: u.x, y: u.y, r: c.r, t: c.dur, total: c.dur, vis: 'furain', follow: u.id, tick: c.tick, side: 'ally',
        onTick(s, z) {
          if (!u.alive) return;
          const es = s.enemiesIn(z.x, z.y, z.r);
          for (let i = 0; i < c.hits && es.length; i++) {
            const e = es.splice((s.rng() * es.length) | 0, 1)[0];
            s.damage(u, e, atk(u) * c.coef, { skill: true, tag: 'u', noEnergy: true });
            s.pushFx({ t: 'drop', x: e.x, y: e.y, tex: 'proj_talisman', color: 0xffd36a });
          }
        },
      });
      sim.pushFx({ t: 'ult', x: u.x, y: u.y, text: '万符朝宗', color: '#ffd36a', awakened: !!u.awakened, heroKey: 'azhu' });
    },
    ai(sim, u) { const c = cfg(u, 'u'); return ultAim(sim, u, c.r, c.r, 6) && { x: u.x, y: u.y }; },
  },
};
