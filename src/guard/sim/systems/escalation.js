// 可复用 BOSS 击杀联动进攻系统（《守卫剑阁》风格：击杀指定 BOSS 后，司马懿派出《魂兵》三路进攻）：
// - 规则完全由 map.bossEscalations / balance.json 数据驱动，未来任意新地图可自定义触发 BOSS、指挥官台词、兵种、路数与倍率。
import BAL from '../../data/balance.json' with { type: 'json' };

function getRules(sim) {
  if (sim.map && Array.isArray(sim.map.bossEscalations)) return sim.map.bossEscalations;
  return BAL.bossEscalations || [];
}

export function triggerEscalation(sim, rule) {
  const lanesMap = (sim.map && sim.map.lanes) || BAL.lanes;
  const lanes = (rule.lanes && rule.lanes.length ? rule.lanes : Object.keys(lanesMap)).filter((l) => !!lanesMap[l]);
  if (!lanes.length) return [];
  const count = Math.max(1, Number(rule.count || 12));
  const unitType = rule.unitType || 'hunbing';
  const wv = sim.wave;
  const tint = typeof rule.tint === 'string' ? parseInt(rule.tint, 16) : (rule.tint || 0x80e8ff);
  const spawned = [];

  for (let i = 0; i < count; i++) {
    const lane = lanes[i % lanes.length];
    const p = lanesMap[lane][0];
    const e = sim.spawnEnemy(unitType, p[0] + sim.rand(-70, 70), p[1] + sim.rand(-70, 70), {
      lane,
      name: rule.unitName || '魂兵',
      tint,
      hpMul: (wv.hpMul || 1) * (rule.hpMul || 1.3),
      atkMul: (wv.atkMul || 1) * (rule.atkMul || 1.15),
      extra: { escalationId: rule.id, commander: rule.commander || '司马懿' },
    });
    e.ox = sim.rand(-55, 55);
    e.oy = sim.rand(-55, 55);
    spawned.push(e);
  }

  for (const lane of lanes) {
    const p = lanesMap[lane][0];
    sim.pushFx({ t: 'ring', x: p[0], y: p[1], r: 180, dur: 0.9, color: tint });
  }
  sim.banner(rule.banner || `${rule.commander || '司马懿'}派出《魂兵》三路进攻！`, '#80e8ff', true);
  sim.pushFx({ t: 'sfx', name: 'roar', vol: 0.9 });
  sim.emit('escalation', { rule, spawned });
  return spawned;
}

export default {
  id: 'escalation',
  init(sim) {
    sim.escalations = { triggered: [] };
    sim.on('bossKill', (boss) => {
      if (!boss || !boss.boss) return;
      const rules = getRules(sim);
      for (const rule of rules) {
        if (rule.triggerBoss && rule.triggerBoss !== boss.boss) continue;
        if (rule.once !== false && sim.escalations.triggered.includes(rule.id)) continue;
        sim.escalations.triggered.push(rule.id);
        triggerEscalation(sim, rule);
      }
    });
  },
};
