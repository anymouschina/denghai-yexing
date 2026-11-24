// 神兽技能（Q/E）：白虎、朱雀、玄武、青龙、麒麟
import { cfg, atk, angTo, d2, clampAim, hitCircle, hitCone, dash, tgtIn, clusterAim, countNear, lowAlly, healUnit, knock, isBig } from './util.js';

export const baihu = {
  q: { // 虎扑：扑向目标点，落地范围伤害
    cast(sim, u, aim) {
      const c = cfg(u, 'q');
      const p = clampAim(u, aim, c.range);
      const dist = Math.sqrt(d2(u, p));
      dash(u, angTo(u, p), Math.max(40, dist), c.dur, {
        onEnd(s, uu) {
          hitCircle(s, uu, uu.x, uu.y, c.r, atk(uu) * c.coef, { knock: 40, tag: 'q' });
          s.pushFx({ t: 'boom', x: uu.x, y: uu.y, r: c.r, small: true, color: 0xf0ece0 });
          s.pushFx({ t: 'slash', x: uu.x, y: uu.y - 36, a: 0, r: c.r, arc: Math.PI * 1.6, id: uu.id, color: 0xf0ece0, sparks: true });
        },
      });
    },
    ai(sim, u) { const t = tgtIn(u, cfg(u, 'q').range); return t && d2(u, t) > 120 * 120 ? { x: t.x, y: t.y } : null; },
  },
  e: { // 啸风：风刃环绕
    cast(sim, u) {
      const c = cfg(u, 'e');
      sim.addZone({ x: u.x, y: u.y, r: c.r, t: c.dur, total: c.dur, vis: 'wind', follow: u.id, tick: c.tick, side: 'ally',
        onTick(s, z) { if (u.alive) hitCircle(s, u, z.x, z.y, z.r, atk(u) * c.coef, { tag: 'e' }); } });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r, color: 0xe8f4ff, dur: 0.45 });
    },
    ai(sim, u) { return countNear(sim, u.x, u.y, cfg(u, 'e').r) >= 3 ? { x: u.x, y: u.y } : null; },
  },
};

export const zhuque = {
  q: { // 离火吐息：锥形火焰 + 灼烧
    cast(sim, u, aim) {
      const c = cfg(u, 'q');
      const a = angTo(u, aim);
      const burnMul = (1 + (u.stats?.dmg || 0)) * (1 + (u.stats?.skillDmg || 0));
      hitCone(sim, u, a, c.r, c.arc, atk(u) * c.coef, { burn: atk(u) * c.burn * burnMul, burnT: c.burnT, tag: 'q' });
      sim.pushFx({ t: 'cone', x: u.x, y: u.y - 50, a, r: c.r, arc: c.arc, color: 0xff7a30, dur: 0.35 });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: 80, color: 0xff7a30, dur: 0.3 });
    },
    ai(sim, u) { const t = tgtIn(u, cfg(u, 'q').r * 0.9); return t ? { x: t.x, y: t.y } : null; },
  },
  e: { // 焚天：指定点火雨
    cast(sim, u, aim) {
      const c = cfg(u, 'e');
      const p = clampAim(u, aim, c.range);
      const burnMul = (1 + (u.stats?.dmg || 0)) * (1 + (u.stats?.skillDmg || 0));
      sim.pushFx({ t: 'ring', x: p.x, y: p.y, r: c.r, color: 0xff7a30, dur: 0.45, rune: true });
      sim.addZone({ x: p.x, y: p.y, r: c.r, t: c.dur, total: c.dur, vis: 'fire', tick: c.tick, side: 'ally',
        onTick(s, z) {
          hitCircle(s, u, z.x, z.y, z.r, atk(u) * c.coef, { burn: atk(u) * c.burn * burnMul, burnT: 2, tag: 'e' });
          s.pushFx({ t: 'drop', x: z.x + s.rand(-z.r, z.r) * 0.7, y: z.y + s.rand(-z.r, z.r) * 0.35, tex: 'proj_flame', color: 0xff7a30 });
        } });
    },
    ai(sim, u) { const c = cfg(u, 'e'); return clusterAim(sim, u, c.range, c.r, 3); },
  },
};

export const xuanwu = {
  q: { // 龟甲阵：周围友军（含孔明）获得护盾（受技能伤害装备加成）
    cast(sim, u) {
      const c = cfg(u, 'q');
      const v = u.maxHp * c.shield * (1 + (u.stats?.skillDmg || 0));
      for (const a of sim.alliesIn(u.x, u.y, c.r)) {
        const add = Math.max(0, v - (a.shield || 0));
        a.shield = (a.shield || 0) + add;
        if (a.kind !== 'building') sim.addBuff(a, 'guijia', c.dur, [], { onEnd(s, uu) { uu.shield = Math.max(0, uu.shield - add); } });
        sim.pushFx({ t: 'ring', x: a.x, y: a.y, r: (a.r || 20) + 30, color: 0x7fd8ff, dur: 0.6, rune: true });
      }
      sim.pushFx({ t: 'text', x: u.x, y: u.y - 160, text: '龟甲阵', color: '#7fd8ff', size: 22 });
    },
    ai(sim, u) {
      const c = cfg(u, 'q');
      return lowAlly(sim, u, c.r, 0.75, 0.9) || countNear(sim, u.x, u.y, c.r) >= 6 ? { x: u.x, y: u.y } : null;
    },
  },
  e: { // 蛇缠：嘲讽 + 减速周围妖物
    cast(sim, u) {
      const c = cfg(u, 'e');
      for (const e of hitCircle(sim, u, u.x, u.y, c.r, atk(u) * c.coef, { slow: c.slow, slowT: c.tauntT, tag: 'e' })) if (!e.boss) e.st.taunt = { id: u.id, t: c.tauntT };
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r, color: 0x5fe08a, dur: 0.5, rune: true });
    },
    ai(sim, u) { return countNear(sim, u.x, u.y, cfg(u, 'e').r) >= 3 ? { x: u.x, y: u.y } : null; },
  },
};

export const qinglong = {
  q: { // 惊雷：指定点雷暴
    cast(sim, u, aim) {
      const c = cfg(u, 'q');
      const p = clampAim(u, aim, c.range);
      hitCircle(sim, u, p.x, p.y, c.r, atk(u) * c.coef, { stun: c.stun, tag: 'q' });
      sim.pushFx({ t: 'thunder', x: p.x, y: p.y, r: c.r, color: 0x5fe0b8, rune: true });
      sim.pushFx({ t: 'bolt', x1: p.x, y1: p.y - 520, x2: p.x, y2: p.y, color: 0x5fe0b8, rune: true });
    },
    ai(sim, u) { const c = cfg(u, 'q'); return clusterAim(sim, u, c.range, c.r, 3); },
  },
  e: { // 龙吟：大范围连锁闪电
    cast(sim, u) {
      const c = cfg(u, 'e');
      let cur = sim.nearestEnemy(u.x, u.y, c.range);
      if (!cur) return false;
      const hit = new Set();
      let px = u.x; let py = u.y - (u.h || 60) * 0.5;
      for (let i = 0; i < c.n && cur; i++) {
        hit.add(cur.id);
        sim.pushFx({ t: 'bolt', x1: px, y1: py, x2: cur.x, y2: cur.y - (cur.h || 60) * 0.4, color: 0x5fe0b8, rune: i === 0 });
        sim.damage(u, cur, atk(u) * c.coef, { skill: true, tag: 'e' });
        px = cur.x; py = cur.y - (cur.h || 60) * 0.4;
        cur = sim.nearestEnemy(px, py + (cur.h || 60) * 0.4, c.jumpR, (e) => !hit.has(e.id));
      }
    },
    ai(sim, u) { const c = cfg(u, 'e'); return countNear(sim, u.x, u.y, c.range * 0.7) >= 5 || (u.tgt && isBig(u.tgt)) ? { x: u.x, y: u.y } : null; },
  },
};

export const qilin = {
  q: { // 祥瑞：大范围治疗（孔明不论远近都会被治疗）
    cast(sim, u) {
      const c = cfg(u, 'q');
      const km = sim.kongming;
      for (const a of sim.alliesIn(u.x, u.y, c.r)) if (a !== km) healUnit(sim, u, a, c);
      if (km.alive) healUnit(sim, u, km, c);
      sim.addZone({ x: u.x, y: u.y, r: c.r, t: 1, vis: 'heal', side: 'ally' });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r * 0.72, color: 0xffd36a, dur: 0.65, rune: true });
      sim.pushFx({ t: 'sfx', name: 'heal', vol: 0.7 });
    },
    ai(sim, u) {
      const km = sim.kongming;
      return km.hp / km.maxHp < 0.75 || lowAlly(sim, u, cfg(u, 'q').r, 0.6) ? { x: u.x, y: u.y } : null;
    },
  },
  e: { // 麟角冲：冲锋击退
    cast(sim, u, aim) {
      const c = cfg(u, 'e');
      const a = angTo(u, aim);
      sim.pushFx({ t: 'beam', x1: u.x, y1: u.y - 50, x2: u.x + Math.cos(a) * c.dist, y2: u.y - 50 + Math.sin(a) * c.dist, w: 18, color: 0xffd36a, dur: 0.3, sonic: true });
      dash(u, a, c.dist, c.dur, {
        hitR: c.hitR,
        onHit(s, uu, e) { s.damage(uu, e, atk(uu) * c.coef, { skill: true, tag: 'e' }); knock(e, uu.x, uu.y, c.knock); },
      });
      sim.pushFx({ t: 'sfx', name: 'dash', vol: 0.6 });
    },
    ai(sim, u) { const t = tgtIn(u, cfg(u, 'e').dist); return t && countNear(sim, t.x, t.y, 120) >= 2 ? { x: t.x, y: t.y } : null; },
  },
};

export const xiangyu = {
  q: { // 霸王举鼎：震地高伤 + 眩晕
    cast(sim, u) {
      const c = cfg(u, 'q');
      hitCircle(sim, u, u.x, u.y, c.r, atk(u) * c.coef, { stun: c.stun, knock: 90, tag: 'q' });
      sim.pushFx({ t: 'boom', x: u.x, y: u.y, r: c.r, color: 0xff6a3a });
      sim.pushFx({ t: 'slash', x: u.x, y: u.y - 45, a: 0, r: c.r * 0.9, arc: Math.PI * 2, id: u.id, color: 0xff6a3a, sparks: true });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r, color: 0xff6a3a, dur: 0.45, rune: true });
      sim.pushFx({ t: 'text', x: u.x, y: u.y - 165, text: '霸王举鼎！', color: '#ff6a4a', size: 24 });
    },
    ai(sim, u) { return countNear(sim, u.x, u.y, cfg(u, 'q').r * 0.9) >= 2 ? { x: u.x, y: u.y } : null; },
  },
  e: { // 破釜沉舟：突进重砸 + 狂怒攻防
    cast(sim, u, aim) {
      const c = cfg(u, 'e');
      const p = clampAim(u, aim, c.range);
      const dist = Math.sqrt(d2(u, p));
      sim.addBuff(u, 'pofu_fury', c.buffSec || 6, [{ stat: 'atk', mul: 0.35 }, { stat: 'aspd', mul: 0.3 }]);
      sim.pushFx({ t: 'beam', x1: u.x, y1: u.y - 45, x2: p.x, y2: p.y - 45, w: 18, color: 0xff6a3a, dur: 0.28, sonic: true });
      dash(u, angTo(u, p), Math.max(60, dist), c.dur, {
        onEnd(s, uu) {
          hitCircle(s, uu, uu.x, uu.y, c.r, atk(uu) * c.coef, { knock: 70, tag: 'e' });
          s.pushFx({ t: 'boom', x: uu.x, y: uu.y, r: c.r, small: true, color: 0xffc94a });
          s.pushFx({ t: 'slash', x: uu.x, y: uu.y - 45, a: 0, r: c.r, arc: Math.PI * 1.6, id: uu.id, color: 0xffc94a, sparks: true });
          s.pushFx({ t: 'text', x: uu.x, y: uu.y - 150, text: '破釜沉舟！', color: '#ffd36a', size: 22 });
        },
      });
    },
    ai(sim, u) { const t = tgtIn(u, cfg(u, 'e').range); return t ? { x: t.x, y: t.y } : null; },
  },
};

export const xingtian = {
  q: { // 干戚旋风：持斧高速旋斩
    cast(sim, u) {
      const c = cfg(u, 'q');
      sim.addZone({
        x: u.x, y: u.y, r: c.r, t: c.dur, total: c.dur, vis: 'wind', follow: u.id, tick: c.tick, side: 'ally',
        onTick(s, z) { if (u.alive) hitCircle(s, u, z.x, z.y, z.r, atk(u) * c.coef, { tag: 'q' }); },
      });
      sim.pushFx({ t: 'slash', x: u.x, y: u.y - 50, a: 0, r: c.r, arc: Math.PI * 2, id: u.id, color: 0xc47bff, sparks: true });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r, color: 0xc47bff, dur: 0.45, rune: true });
      sim.pushFx({ t: 'text', x: u.x, y: u.y - 165, text: '干戚旋风！', color: '#c47bff', size: 24 });
    },
    ai(sim, u) { return countNear(sim, u.x, u.y, cfg(u, 'q').r) >= 2 ? { x: u.x, y: u.y } : null; },
  },
  e: { // 战意不灭：回血 + 狂暴 + 冲击波
    cast(sim, u) {
      const c = cfg(u, 'e');
      sim.heal(u, u.maxHp * (c.healPct || 0.25) * (1 + (u.stats?.skillDmg || 0)), u);
      sim.addBuff(u, 'xingtian_berserk', c.dur || 8, [{ stat: 'atk', mul: 0.4 }, { stat: 'def', add: 30 }, { stat: 'aspd', mul: 0.3 }]);
      hitCircle(sim, u, u.x, u.y, c.r, atk(u) * c.coef, { knock: 100, tag: 'e' });
      sim.pushFx({ t: 'ring', x: u.x, y: u.y, r: c.r, color: 0xc47bff, dur: 0.65, rune: true });
      sim.pushFx({ t: 'slash', x: u.x, y: u.y - 50, a: 0, r: c.r * 0.9, arc: Math.PI * 2, id: u.id, color: 0xffd36a, sparks: true });
      sim.pushFx({ t: 'text', x: u.x, y: u.y - 165, text: '战意不灭！', color: '#ffd36a', size: 24 });
    },
    ai(sim, u) { return (u.hp / u.maxHp < 0.72 || countNear(sim, u.x, u.y, cfg(u, 'e').r) >= 4) ? { x: u.x, y: u.y } : null; },
  },
};
