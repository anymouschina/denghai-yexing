// M5 经营 · 孔明军令（任务）：开局（布阵期）即发「筑箭楼」，之后每 2 波发布一个，最多同时 2 个，按波数计时限，过期失败。
// 按当前进度挑任务（没塔先给造塔、有神兽才给清秘境…）。奖励：铜钱 / 装备（M3 sim.loot，未接入时退化为铜钱）/ 孔明临时增益。
// 事件：questNew {q}、questDone {q}、questFail {q}。数值在 data/quests.json。
import QD from '../../data/quests.json' with { type: 'json' };
import ENEMIES from '../../data/enemies.json' with { type: 'json' };
import { poolFor } from './waves.js';

const TPL = QD.templates;

function pickNeed(sim, need) { return Array.isArray(need) ? need[0] + Math.floor(sim.rng() * (need[1] - need[0] + 1)) : need || 1; }

/** 当前局面下该模板是否适合发布 */
function eligible(sim, id) {
  const t = TPL[id];
  const n = sim.wave.n;
  if (t.minWave && n < t.minWave) return false;
  if (sim.quests.active.some((q) => q.tpl === id)) return false;
  if (t.needBuildings && sim.buildings.filter((b) => b.alive).length < t.needBuildings) return false;
  if (t.needRealms && !sim.realms) return false;
  if (t.needBeast) {
    if (!sim.realms || !sim.units.some((u) => u.kind === 'beast')) return false;
    if (sim.realms.state && Object.values(sim.realms.state).every((v) => v === 'cleared')) return false;
  }
  if (t.needInv && !sim.inv) return false;
  if (t.needSets && !sim.activeSets) return false;
  if (id === 'hire' && sim.units.filter((u) => u.kind === 'merc').length >= 6) return false;
  return id !== QD.first;
}

function chooseTemplate(sim) {
  const nb = sim.buildings.filter((b) => b.alive).length;
  // 进度引导：塔太少先造塔；没有守卫先雇人
  if (nb < 2 && eligible(sim, 'build')) return 'build';
  if (!sim.units.some((u) => u.kind === 'merc') && sim.wave.n >= 3 && eligible(sim, 'hire')) return 'hire';
  const ids = Object.keys(TPL).filter((id) => eligible(sim, id));
  if (!ids.length) return null;
  let tot = 0;
  for (const id of ids) tot += TPL[id].weight || 1;
  let r = sim.rng() * tot;
  for (const id of ids) { r -= TPL[id].weight || 1; if (r <= 0) return id; }
  return ids[ids.length - 1];
}

/** 发布任务（测试与调试也可直接调用） */
export function addQuest(sim, id) {
  const t = TPL[id];
  if (!t) return null;
  const n = sim.wave.n;
  const q = {
    id: sim.uid++, tpl: id, type: t.type, name: t.name, prog: 0, need: pickNeed(sim, t.need), issued: n, deadline: n + t.waves,
    reward: { ...t.reward, copper: (t.reward.copper || 0) + QD.rewardCopperPerWave * n }, state: 'active',
  };
  if (t.type === 'buildType') q.build = t.build;
  if (t.type === 'kill') {
    const pool = poolFor(Math.max(1, n));
    const keys = Object.keys(pool);
    q.enemy = keys[Math.floor(sim.rng() * keys.length)];
    q.enemyName = ENEMIES[q.enemy]?.name || q.enemy;
    if (q.enemy !== 'paperman' && q.enemy !== 'foxfire') q.need = Math.max(3, Math.round(q.need / 3));
  }
  if (t.type === 'kmGuard') { q.pct = t.pct; q.need = 1; q.kmStart = sim.stats.kmDmgTaken; }
  q.desc = t.desc.replace('{need}', q.need).replace('{enemyName}', q.enemyName || '').replace('{pctText}', `${Math.round((t.pct || 0) * 100)}%`);
  sim.quests.active.push(q);
  sim.emit('questNew', { q });
  sim.banner(`孔明军令 · ${q.name}`, '#7fe3ff');
  return q;
}

export function rewardText(r) {
  const out = [];
  if (r.copper) out.push(`${r.copper} 钱`);
  if (r.item) out.push('卧龙装备');
  if (r.buff) out.push(QD.buffs[r.buff]?.name || '增益');
  return out.join(' + ');
}

function finish(sim, q, ok) {
  if (q.state !== 'active') return;
  q.state = ok ? 'done' : 'fail';
  q.endT = sim.t;
  q.endWave = sim.wave.n;
  sim.quests.active = sim.quests.active.filter((x) => x !== q);
  sim.quests.history.unshift(q);
  if (sim.quests.history.length > 12) sim.quests.history.length = 12;
  if (!ok) {
    sim.quests.failed++;
    sim.emit('questFail', { q });
    sim.banner(`军令失败 · ${q.name}`, '#ff8a7a');
    return;
  }
  sim.quests.done++;
  const r = q.reward;
  let copper = r.copper || 0;
  q.got = [];
  if (r.item) {
    let gave = false;
    try {
      const it = sim.loot?.roll?.({ set: 'wolong', minQ: 2, wave: sim.wave.n });
      if (it) gave = !!sim.loot.give(it);
      if (gave) q.got.push(it.name || '卧龙装备');
    } catch { gave = false; }
    if (!gave) copper += 60; // M3 未接入或背包满：退化为铜钱
  }
  if (r.buff && QD.buffs[r.buff]) {
    const B = QD.buffs[r.buff];
    sim.addBuff(sim.kongming, `quest_${r.buff}`, B.sec, B.mods.map((m) => ({ ...m })));
    q.got.push(B.name);
  }
  if (copper) { sim.addCopper(copper, sim.kongming.x, sim.kongming.y - 120); q.got.unshift(`${copper} 钱`); }
  sim.emit('questDone', { q });
  sim.banner(`军令完成 · ${q.name}　${q.got.join(' + ')}`, '#ffd36a');
}

function progress(sim, type, inc = 1, match) {
  for (const q of [...sim.quests.active]) {
    if (q.type !== type || (match && !match(q))) continue;
    q.prog = Math.min(q.need, q.prog + inc);
    if (q.prog >= q.need) finish(sim, q, true);
  }
}

export default {
  id: 'quests',
  init(sim) {
    sim.quests = { active: [], done: 0, failed: 0, history: [] };
    sim.on('waveStart', ({ n }) => {
      // 结算「本波护灯」与过期
      for (const q of [...sim.quests.active]) {
        if (q.type === 'kmGuard' && n > q.issued) {
          const lost = sim.stats.kmDmgTaken - q.kmStart;
          finish(sim, q, lost <= q.pct * sim.kongming.maxHp);
        } else if (n > q.deadline) finish(sim, q, false);
      }
      if (n === 1) return;
      if ((n - 1) % QD.every === 0 && sim.quests.active.length < QD.maxActive) {
        const id = chooseTemplate(sim);
        if (id) addQuest(sim, id);
      }
    });
    sim.on('build', ({ b }) => { progress(sim, 'build'); progress(sim, 'buildType', 1, (q) => q.build === b.type); });
    sim.on('upgrade', () => progress(sim, 'upgrade'));
    sim.on('hire', () => progress(sim, 'hire'));
    sim.on('kill', ({ enemy }) => progress(sim, 'kill', 1, (q) => q.enemy === enemy.type));
    sim.on('realmEnter', () => progress(sim, 'realmEnter'));
    sim.on('realmClear', () => progress(sim, 'realmClear'));
    sim.on('equip', (d) => {
      const u = d && d.unit;
      const isKm = u === sim.kongming || u === sim.kongming.id || (u && u.kind === 'kongming');
      if (isKm) progress(sim, 'equipKm');
    });
    sim.on('setActive', () => progress(sim, 'set'));
    // 开局即发第一道军令（布阵期就能完成，避免开波前先造了塔却拿不到奖励）
    addQuest(sim, QD.first);
  },
};
