// 单挑 BOSS（不作弊：不改血量、不加倍率、不回血）。主线不开波，只放出指定 BOSS，英雄阵亡即判负（不复活），限时 240 秒。
// phase=init  ：1 级、无装备的英雄。
// phase=grown ：同一机器人先正常打一局，到该 BOSS 波开始时，把英雄的等级与身上装备原样搬进新局再单挑（搬的是正常游玩到达的状态，不改任何数值）。
import BAL from '../../../src/guard/data/balance.json' with { type: 'json' };
import { spawnBoss } from '../../../src/guard/sim/systems/bosses.js';
import { PlayerBot } from './player.mjs';

const BOSS_AT = { 10: 'laozu', 20: 'hanba', 30: 'yedi' };

function grownState(Sim, { seed, heroId, bot, sigma, bossWave }) {
  const s = new Sim({ seed, heroId, mode: 'story', fx: false });
  const b = new PlayerBot(s, { kind: bot, sigma, seed: seed ^ 0x9e3779b9 });
  let snap = null;
  s.on('waveStart', (w) => {
    if (w.n === bossWave && !snap) snap = { lv: s.hero.lv, xp: s.hero.xp, equip: { ...(s.inv?.equip[s.hero.id] || {}) } };
  });
  while (!s.over && !snap && s.t < 3600) { b.step(); s.step(); }
  return snap;
}

export function runDuel(Sim, { seed, heroId, bot = 'proxy', sigma = 0.05, bossWave = 10, phase = 'init' }) {
  let snap = null;
  if (phase === 'grown') {
    snap = grownState(Sim, { seed, heroId, bot, sigma, bossWave });
    if (!snap) return { seed, heroId, bot, phase, win: false, wave: bossWave, t: 0, reason: `没撑到第 ${bossWave} 波`, lv: 0 };
  }
  const s = new Sim({ seed, heroId, mode: 'story', fx: false });
  s.wave.nextAt = Infinity;
  if (snap) {
    s.hero.lv = snap.lv;
    s.hero.xp = snap.xp;
    if (s.inv) s.inv.equip[s.hero.id] = snap.equip;
    s.markDirty(s.hero);
    s.calcStats(s.hero);
    s.hero.hp = s.hero.maxHp;
  }
  s.hero.x = BAL.world.cx; s.hero.y = BAL.world.cy - 700;
  const boss = spawnBoss(s, BOSS_AT[bossWave], bossWave, bossWave);
  boss.x = BAL.world.cx; boss.y = BAL.world.cy - 1300;
  let dead = false;
  s.on('unitDown', (u) => { if (u === s.hero) dead = true; });
  const b = new PlayerBot(s, { kind: bot, sigma, seed: seed ^ 0x51ed, economy: false, realms: false });
  const t0 = s.t;
  while (!dead && boss.alive && !s.over && s.t - t0 < 240) { b.step(); s.step(); }
  return {
    seed, heroId, bot, phase, win: !boss.alive && !dead, wave: bossWave, t: Math.round(s.t - t0), lv: s.hero.lv,
    reason: dead ? '英雄阵亡' : boss.alive ? (s.over ? s.over.reason : '超时') : 'BOSS 被击败', bossHpLeft: Math.round(Math.max(0, boss.hp) / boss.maxHp * 100),
  };
}
