// M5 经营 · 雇佣：用铜钱雇佣守卫（上限 BAL.party.maxMercs），并给雇佣兵升级（最高 3 级，每级生命/攻击 +35%）。
// 命令：hire {key}、upgradeMerc {id}。数值在 data/units.json 的 mercs（cost / upCost）。
import UNITS from '../../data/units.json' with { type: 'json' };
import BAL from '../../data/balance.json' with { type: 'json' };

export const MERC_KEYS = Object.keys(UNITS.mercs);
export const MERC_MAX_LV = 3;
export const MERC_LV_BONUS = 0.35;

export function mercCount(sim) { return sim.units.filter((u) => u.kind === 'merc' && u.alive).length; }
export function mercUpCost(u) { return u.lv < MERC_MAX_LV ? u.def.upCost[u.lv - 1] : null; }

export default {
  id: 'mercs',
  init(sim) { sim.mercStats = { hired: 0, upgraded: 0 }; },
  commands: {
    hire(sim, c) {
      const d = UNITS.mercs[c.key];
      if (!d) return { ok: false, reason: '未知守卫' };
      if (mercCount(sim) >= BAL.party.maxMercs) return { ok: false, reason: `守卫已满（最多 ${BAL.party.maxMercs} 名）` };
      if (sim.copper < d.cost) return { ok: false, reason: `铜钱不足（需要 ${d.cost}）` };
      sim.copper -= d.cost;
      const K = sim.kongming;
      const a = sim.rng() * Math.PI * 2;
      const u = sim.spawnUnit('merc', c.key, K.x + Math.cos(a) * 110, K.y + 60 + Math.sin(a) * 60);
      u.spent = d.cost;
      sim.mercStats.hired++;
      sim.pushFx({ t: 'build', x: u.x, y: u.y, lv: 1, merc: true });
      sim.emit('hire', { u });
      return { ok: true, u };
    },
    upgradeMerc(sim, c) {
      const u = sim.byId(c.id);
      if (!u || u.kind !== 'merc' || !u.alive) return { ok: false, reason: '没有这名守卫' };
      const cost = mercUpCost(u);
      if (cost == null) return { ok: false, reason: '已满级' };
      if (sim.copper < cost) return { ok: false, reason: `铜钱不足（需要 ${cost}）` };
      sim.copper -= cost;
      u.lv++;
      u.spent = (u.spent || 0) + cost;
      const k = 1 + MERC_LV_BONUS * (u.lv - 1);
      u.base.maxHp = u.def.hp * k;
      u.base.atk = u.def.atk * k;
      sim.markDirty(u);
      sim.calcStats(u);
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.3);
      sim.mercStats.upgraded++;
      sim.pushFx({ t: 'build', x: u.x, y: u.y, lv: u.lv, up: true, merc: true });
      sim.emit('upgradeMerc', { u });
      return { ok: true, u };
    },
  },
};
