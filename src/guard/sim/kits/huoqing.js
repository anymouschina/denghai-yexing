// 霍青 · 近战枪客：突刺冲锋 + 回旋 + 铁壁嘲讽 + 挑飞 + 七进七出
import { cfg, atk, angTo, d2, hitCircle, hitCone, dash, tgtIn, countNear, bossNear, knock } from './util.js';

function sevenStep(sim, u, c, left) {
  const t = sim.nearestEnemy(u.x, u.y, c.range);
  if (!t || left <= 0) { u.invuln = Math.max(u.invuln, 0.3); return; }
  const a = angTo(u, t);
  const dist = Math.sqrt(d2(u, t)) + 70; // 穿过目标
  const awk = !!u.awakened;
  u.invuln = Math.max(u.invuln, c.seg + 0.1);
  sim.pushFx({ t: 'beam', x1: u.x, y1: u.y - 50, x2: u.x + Math.cos(a) * dist, y2: u.y - 50 + Math.sin(a) * dist, w: awk ? 18 : 14, color: awk ? 0xffb040 : 0xffe0a0, dur: 0.22, sonic: true, awakened: awk });
  sim.pushFx({ t: 'slash', x: u.x, y: u.y - (u.h || 60) * 0.35, a, r: 120, arc: 1.5, id: u.id, color: awk ? 0xffd36a : 0xffe0a0, sparks: true, awakened: awk });
  dash(u, a, dist, c.seg, {
    hitR: c.hitR,
    onHit(s, uu, e) { s.damage(uu, e, atk(uu) * c.coef, { skill: true, tag: 'u', noEnergy: true }); },
    onEnd(s, uu) { sevenStep(s, uu, c, left - 1); },
  });
}

export default {
  q: { // 突刺：直线冲锋，沿途贯穿
    cast(sim, u, aim) {
      const c = cfg(u, 'q');
      const a = angTo(u, aim);
      const awk = !!u.awakened;
      u.invuln = Math.max(u.invuln, 0.15);
      sim.pushFx({ t: 'beam', x1: u.x, y1: u.y - 50, x2: u.x + Math.cos(a) * c.dist, y2: u.y - 50 + Math.sin(a) * c.dist, w: 16, color: awk ? 0xffb040 : 0xffe0a0, dur: 0.25, sonic: true, awakened: awk });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: 68, color: 0xffd36a, dur: 0.25, rune: awk });
      dash(u, a, c.dist, c.dur, {
        hitR: c.hitR,
        onHit(s, uu, e) { s.damage(uu, e, atk(uu) * c.coef, { skill: true, tag: 'q' }); knock(e, uu.x, uu.y, 30); },
      });
      sim.pushFx({ t: 'sfx', name: 'dash', vol: 0.6 });
    },
    ai(sim, u) {
      const t = tgtIn(u, cfg(u, 'q').dist);
      if (!t) return null;
      // 远处目标：冲锋接近；BOSS/精英：贴身也用突刺打伤害
      if (d2(u, t) < 130 * 130 && !(t.boss || t.elite)) return null;
      return { x: t.x, y: t.y };
    },
  },
  e: { // 横扫千军：360° 回旋
    cast(sim, u) {
      const c = cfg(u, 'e');
      const awk = !!u.awakened;
      hitCircle(sim, u, u.x, u.y, c.r, atk(u) * c.coef, { knock: c.knock, tag: 'e' });
      sim.pushFx({ t: 'slash', x: u.x, y: u.y - (u.h || 60) * 0.35, a: 0, r: c.r, arc: Math.PI * 2, id: u.id, color: 0xffd36a, sparks: true, awakened: awk });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r, color: 0xffe0a0, dur: 0.3, rune: awk, awakened: awk });
    },
    ai(sim, u) { const r = cfg(u, 'e').r; return countNear(sim, u.x, u.y, r) >= 3 || bossNear(sim, u, r) ? { x: u.x, y: u.y } : null; },
  },
  r: { // 铁壁：减伤 + 嘲讽周围妖物
    cast(sim, u) {
      const c = cfg(u, 'r');
      const awk = !!u.awakened;
      sim.addBuff(u, 'tiebi', c.dur, [{ stat: 'dmgTaken', add: c.dmgCut }]);
      for (const e of sim.enemiesIn(u.x, u.y, c.tauntR)) if (!e.boss) e.st.taunt = { id: u.id, t: c.tauntT };
      sim.addZone({ x: u.x, y: u.y, r: 70, t: c.dur, total: c.dur, vis: 'shield', follow: u.id, side: 'ally' });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.tauntR, color: 0xffb040, dur: 0.5, rune: true, awakened: awk });
      sim.pushFx({ t: 'text', x: u.x, y: u.y - 130, text: '铁壁！', color: '#ffc977', size: 24 });
    },
    ai(sim, u) {
      const c = cfg(u, 'r');
      const n = countNear(sim, u.x, u.y, c.tauntR * 0.75);
      const km = sim.kongming;
      const kmHit = sim.t - sim.kmAlert.t < 1 && d2(u, km) < 450 * 450;
      return n >= 4 || (kmHit && n >= 1) || (u.hp / u.maxHp < 0.5 && n >= 2) || (u.hp / u.maxHp < 0.6 && bossNear(sim, u, 300)) ? { x: u.x, y: u.y } : null;
    },
  },
  f: { // 挑枪：锥形挑飞 + 眩晕
    cast(sim, u, aim) {
      const c = cfg(u, 'f');
      const a = angTo(u, aim);
      const awk = !!u.awakened;
      u.face = Math.cos(a) >= 0 ? 1 : -1;
      const hits = hitCone(sim, u, a, c.r, c.arc, atk(u) * c.coef, { stun: c.stun, knock: c.knock, tag: 'f' });
      sim.pushFx({ t: 'slash', x: u.x, y: u.y - (u.h || 60) * 0.35, a, r: c.r, arc: c.arc, id: u.id, color: 0xffb040, sparks: true, awakened: awk });
      for (const e of hits.slice(0, 5)) sim.pushFx({ t: 'text', x: e.x, y: e.y - (e.h || 60) - 10, text: '晕', color: '#ffd36a', size: 16 });
    },
    ai(sim, u) {
      const c = cfg(u, 'f');
      const t = tgtIn(u, c.r * 0.9);
      if (!t) return null;
      return countNear(sim, t.x, t.y, 110) >= 2 || t.elite || t.boss || t.charge > 0 ? { x: t.x, y: t.y } : null;
    },
  },
  u: { // 七进七出：7 段穿刺冲锋，期间无敌
    cast(sim, u) {
      const c = cfg(u, 'u');
      if (!sim.nearestEnemy(u.x, u.y, c.range)) return false;
      sevenStep(sim, u, c, c.hits);
      sim.pushFx({ t: 'ult', x: u.x, y: u.y, text: '七进七出', color: '#ffe0a0', awakened: !!u.awakened, heroKey: 'huoqing' });
    },
    ai(sim, u) {
      const c = cfg(u, 'u');
      if (bossNear(sim, u, c.range) || countNear(sim, u.x, u.y, c.range) >= 6) return { x: u.x, y: u.y };
      return null;
    },
  },
};
