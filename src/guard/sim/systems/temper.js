// 挨打升级 + 挨打练体系统（纯数据驱动，配置见 balance.json.temper）：
// - 英雄受到敌方攻击（满足 hitThrottle）直接累计挨打次数、获得经验升级与大招充能。
// - 每 perHits 层获得永久攻防血叠层，达成 5 阶里程碑解锁称号、高额双防/减伤、反伤射线、受击回血与金钟震波。
import BAL from '../../data/balance.json' with { type: 'json' };

function recomputeBonus(T) {
  const cfg = T.cfg;
  const ps = cfg.perStack || { maxHp: 12, def: 1, atk: 2 };
  let maxHp = T.stacks * (ps.maxHp ?? 12);
  let def = T.stacks * (ps.def ?? 1);
  let atk = T.stacks * (ps.atk ?? 2);
  let dmgCut = 0;
  let thorns = 0;
  let hitHealPct = 0;
  let hitHealCd = 0.5;
  let novaEvery = 0;

  for (const m of T.milestones) {
    if (!T.unlockedIds[m.hits]) continue;
    maxHp += m.maxHp || 0;
    def += m.def || 0;
    dmgCut += m.dmgCut || 0;
    if (m.thorns) thorns = m.thorns;
    if (m.hitHealPct) {
      hitHealPct = m.hitHealPct;
      hitHealCd = m.hitHealCd ?? 0.5;
    }
    if (m.novaEvery) novaEvery = m.novaEvery;
  }

  T.bonus = { maxHp, def, atk, dmgCut };
  T.thorns = thorns;
  T.hitHealPct = hitHealPct;
  T.hitHealCd = hitHealCd;
  T.novaEvery = novaEvery;
}

export default {
  id: 'temper',
  init(sim) {
    const cfg = BAL.temper || {
      hitThrottle: 0.06,
      xpPerHit: 4,
      xpPerWave: 0.35,
      perHits: 10,
      perStack: { maxHp: 12, def: 1, atk: 2 },
      ultPerHit: 2,
      milestones: [],
    };
    const milestones = cfg.milestones || [];
    const T = {
      cfg,
      milestones,
      hits: 0,
      dmgTaken: 0,
      stacks: 0,
      xpGained: 0,
      thornsDmg: 0,
      milestoneIdx: -1,
      unlockedIds: {},
      unlocked: [],
      currentTitle: null,
      nextMilestone: milestones[0] || null,
      thorns: 0,
      hitHealPct: 0,
      hitHealCd: 0.5,
      novaEvery: 0,
      lastHitAt: -99,
      lastHealAt: -99,
      bonus: { maxHp: 0, def: 0, atk: 0, dmgCut: 0 },
      summary() {
        return {
          hits: T.hits,
          stacks: T.stacks,
          dmgTaken: Math.round(T.dmgTaken),
          xpGained: T.xpGained,
          thornsDmg: Math.round(T.thornsDmg),
          milestoneIdx: T.milestoneIdx,
          currentTitle: T.currentTitle,
          nextMilestone: T.nextMilestone,
          thorns: T.thorns,
          hitHealPct: T.hitHealPct,
          novaEvery: T.novaEvery,
          bonus: { ...T.bonus },
        };
      },
    };
    sim.temper = T;

    sim.statSources.push((u) => {
      if (u.kind !== 'hero' || !sim.temper) return null;
      const b = sim.temper.bonus;
      const out = [];
      if (b.maxHp) out.push({ stat: 'maxHp', add: b.maxHp });
      if (b.def) out.push({ stat: 'def', add: b.def });
      if (b.atk) out.push({ stat: 'atk', add: b.atk });
      if (b.dmgCut) out.push({ stat: 'dmgTaken', mul: b.dmgCut });
      return out.length ? out : null;
    });

    sim.on('damage', ({ src, tgt, dmg, o }) => {
      if (!sim.temper || !tgt || tgt.kind !== 'hero' || !src || src.side !== 'enemy') return;
      if (o && o.tag === 'thorns') return;
      const throttle = cfg.hitThrottle ?? 0.06;
      if (sim.t - T.lastHitAt < throttle) return;

      T.lastHitAt = sim.t;
      T.hits++;
      T.dmgTaken += dmg;

      const xpGain = Math.max(1, Math.round((cfg.xpPerHit ?? 4) + (sim.wave.n || 1) * (cfg.xpPerWave ?? 0.35)));
      T.xpGained += xpGain;
      sim.gainXp(xpGain);

      if (tgt.alive && tgt.energy !== undefined) {
        tgt.energy = Math.min(BAL.hero.ultEnergy, tgt.energy + (cfg.ultPerHit ?? 2));
      }

      const perHits = cfg.perHits || 10;
      const newStacks = Math.floor(T.hits / perHits);
      let changed = newStacks !== T.stacks;
      T.stacks = newStacks;

      const newlyUnlocked = [];
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        if (T.hits >= m.hits && !T.unlockedIds[m.hits]) {
          T.unlockedIds[m.hits] = true;
          T.unlocked.push(m);
          T.milestoneIdx = i;
          T.currentTitle = m.name;
          T.nextMilestone = milestones[i + 1] || null;
          newlyUnlocked.push({ m, i });
          changed = true;
        }
      }

      if (changed) {
        recomputeBonus(T);
        sim.markDirty(tgt);
        sim.calcStats(tgt);
      }

      for (const { m, i } of newlyUnlocked) {
        if (m.copper) sim.addCopper(m.copper, tgt.x, tgt.y);
        sim.pushFx({ t: 'temperBreak', x: tgt.x, y: tgt.y, name: m.name, hits: m.hits, idx: i });
        sim.banner(`挨打练体突破【${m.name}】（${m.hits} 击）！`, '#ffd36a', true);
        sim.emit('temperMilestone', { unit: tgt, milestone: m, index: i, hits: T.hits });
      }

      if (T.thorns > 0 && src.alive) {
        const tdmg = (dmg + (tgt.stats?.def || 0) * 0.8) * T.thorns;
        const dealt = sim.damage(tgt, src, tdmg, { canCrit: false, tag: 'thorns', noEnergy: true });
        if (dealt > 0) {
          T.thornsDmg += dealt;
          sim.pushFx({ t: 'thornsRay', x1: tgt.x, y1: tgt.y - 44, x2: src.x, y2: src.y - 36 });
        }
      }

      if (T.hitHealPct > 0 && tgt.alive && tgt.hp > 0 && sim.t - T.lastHealAt >= T.hitHealCd) {
        T.lastHealAt = sim.t;
        sim.heal(tgt, tgt.maxHp * T.hitHealPct, tgt);
      }

      if (T.novaEvery > 0 && T.hits % T.novaEvery === 0 && tgt.alive && tgt.hp > 0) {
        const r = 220;
        const ndmg = (tgt.stats?.def || 0) * 3.5 + (tgt.stats?.atk || 0) * 1.4;
        for (const e of sim.enemiesIn(tgt.x, tgt.y, r)) {
          sim.damage(tgt, e, ndmg, { skill: true, tag: 'temperNova', noEnergy: true });
        }
        sim.pushFx({ t: 'goldenNova', x: tgt.x, y: tgt.y, r });
      }

      sim.pushFx({ t: 'temperHit', x: tgt.x, y: tgt.y - 52, hits: T.hits, xp: xpGain });
      sim.emit('temperProgress', {
        unit: tgt,
        hits: T.hits,
        stacks: T.stacks,
        dmgTaken: T.dmgTaken,
        xp: xpGain,
        milestoneIdx: T.milestoneIdx,
        currentTitle: T.currentTitle,
        nextMilestone: T.nextMilestone,
      });
    });
  },
};
