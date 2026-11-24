// 南华仙人系统（纯数据驱动，配置见 balance.json.nanhua）：
// - 消耗铜钱强化装备（最高 +15 级，主属性每级 +15%，副属性每级 +10%）
// - 消耗铜钱与英雄等级门槛进行四重渡劫飞升（Lv.10/20/30/40），永久大幅提升攻/血/防/技伤
import BAL from '../../data/balance.json' with { type: 'json' };

function resolveEquipTarget(sim, c) {
  if (c.unitId !== undefined && c.unitId !== null && c.slot) {
    const u = sim.byId(c.unitId);
    const eq = u && sim.inv && sim.inv.equip[u.id];
    const it = eq && eq[c.slot];
    return { it: it || null, u: u || null, slot: c.slot, bagIdx: null };
  }
  if (c.bagIdx !== undefined && c.bagIdx !== null) {
    const idx = Number(c.bagIdx);
    const it = sim.inv && sim.inv.equipBag && sim.inv.equipBag[idx];
    return { it: it || null, u: null, slot: null, bagIdx: idx };
  }
  return { it: null, u: null, slot: null, bagIdx: null };
}

export default {
  id: 'nanhua',
  init(sim) {
    const cfg = BAL.nanhua || {
      name: '南华仙人',
      x: 2260,
      y: 2140,
      r: 80,
      enhanceMax: 15,
      baseCost: 80,
      costPerLv: 65,
      mainPerLv: 0.15,
      subPerLv: 0.10,
      ascendTiers: [
        { lv: 10, name: '一重渡劫·筑基', cost: 300, atk: 60, maxHp: 700, def: 16, skillDmg: 0.10 },
        { lv: 20, name: '二重渡劫·金丹', cost: 800, atk: 140, maxHp: 1600, def: 34, skillDmg: 0.16 },
        { lv: 30, name: '三重渡劫·元婴', cost: 1800, atk: 280, maxHp: 3400, def: 68, skillDmg: 0.24 },
        { lv: 40, name: '四重渡劫·飞升', cost: 3500, atk: 520, maxHp: 6800, def: 120, skillDmg: 0.35 },
      ],
    };

    const N = {
      cfg,
      name: cfg.name || '南华仙人',
      x: cfg.x ?? 2260,
      y: cfg.y ?? 2140,
      r: cfg.r ?? 80,
      enhanceCount: 0,
      ascendLv: 0,
      bonus: { atk: 0, maxHp: 0, def: 0, skillDmg: 0 },
      enhanceCost(it) {
        if (!it || it.kind !== 'equip') return null;
        const lv = it.enhanceLv || 0;
        if (lv >= (cfg.enhanceMax ?? 15)) return null;
        return (cfg.baseCost ?? 80) + lv * (cfg.costPerLv ?? 65);
      },
      nextAscend() {
        return (cfg.ascendTiers || [])[N.ascendLv] || null;
      },
      canAscend() {
        const tier = N.nextAscend();
        const h = sim.hero;
        return !!(tier && h && h.alive && h.lv >= tier.lv && sim.copper >= tier.cost);
      },
    };
    sim.nanhua = N;

    sim.statSources.push((u) => {
      if (u.kind !== 'hero' || !sim.nanhua) return null;
      const b = sim.nanhua.bonus;
      const out = [];
      if (b.atk) out.push({ stat: 'atk', add: b.atk });
      if (b.maxHp) out.push({ stat: 'maxHp', add: b.maxHp });
      if (b.def) out.push({ stat: 'def', add: b.def });
      if (b.skillDmg) out.push({ stat: 'skillDmg', mul: b.skillDmg });
      return out.length ? out : null;
    });
  },
  commands: {
    enhanceEquip(sim, c) {
      const N = sim.nanhua;
      if (!N) return { ok: false, reason: '南华仙人系统未启用' };
      if (!sim.inv) return { ok: false, reason: '行囊未初始化' };
      const { it, u, slot, bagIdx } = resolveEquipTarget(sim, c);
      if (!it || it.kind !== 'equip') return { ok: false, reason: '未找到要强化的装备' };
      const maxLv = N.cfg.enhanceMax ?? 15;
      const curLv = it.enhanceLv || 0;
      if (curLv >= maxLv) return { ok: false, reason: `该装备已达最高强化等级 (+${maxLv})` };
      const cost = N.enhanceCost(it);
      if (sim.copper < cost) return { ok: false, reason: `铜钱不足（强化需要 ${cost}）` };

      sim.copper -= cost;
      it.enhanceLv = curLv + 1;
      N.enhanceCount++;
      sim.inv.ver++;

      if (u) {
        sim.markDirty(u);
        if (u.alive) sim.calcStats(u);
      }
      const fxX = u ? u.x : (sim.ctrl ? sim.ctrl.x : N.x);
      const fxY = u ? u.y : (sim.ctrl ? sim.ctrl.y : N.y);
      sim.pushFx({ t: 'nanhuaFx', x: fxX, y: fxY, kind: 'enhance', lv: it.enhanceLv, name: it.name, text: `${it.name} +${it.enhanceLv}` });
      sim.pushFx({ t: 'sfx', name: 'levelup', vol: 0.6 });
      sim.emit('nanhuaEnhance', { item: it, enhanceLv: it.enhanceLv, cost, unit: u, slot, bagIdx });
      return { ok: true, item: it, enhanceLv: it.enhanceLv, cost };
    },
    ascendHero(sim) {
      const N = sim.nanhua;
      if (!N) return { ok: false, reason: '南华仙人系统未启用' };
      const h = sim.hero;
      if (!h || !h.alive) return { ok: false, reason: '英雄已倒下，无法渡劫' };
      const tier = N.nextAscend();
      if (!tier) return { ok: false, reason: '已达最高渡劫飞升境界' };
      if (h.lv < tier.lv) return { ok: false, reason: `【${tier.name}】需英雄达到 ${tier.lv} 级` };
      if (sim.copper < tier.cost) return { ok: false, reason: `铜钱不足（渡劫需要 ${tier.cost}）` };

      sim.copper -= tier.cost;
      N.ascendLv++;
      N.bonus.atk += tier.atk || 0;
      N.bonus.maxHp += tier.maxHp || 0;
      N.bonus.def += tier.def || 0;
      N.bonus.skillDmg += tier.skillDmg || 0;

      sim.markDirty(h);
      sim.calcStats(h);
      if (h.alive) h.hp = h.maxHp;

      sim.pushFx({ t: 'nanhuaFx', x: h.x, y: h.y, kind: 'ascend', big: true, lv: N.ascendLv, name: tier.name, text: tier.name });
      sim.pushFx({ t: 'sfx', name: 'levelup', vol: 0.9 });
      sim.banner(`南华仙人赐福 · ${h.name} 完成【${tier.name}】！`, '#ffd36a', true);
      sim.emit('nanhuaAscend', { unit: h, ascendLv: N.ascendLv, tier, cost: tier.cost, bonus: { ...N.bonus } });
      return { ok: true, ascendLv: N.ascendLv, tier, cost: tier.cost };
    },
  },
};
