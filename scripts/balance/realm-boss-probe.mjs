// 秘境 BOSS 平衡探针：英雄按推荐等级 + 推荐成型装备单挑项羽/刑天，统计 DPS、击杀用时与阵亡次数。
// 用法：node scripts/balance/realm-boss-probe.mjs [heroId] [weaponId]
import { Sim } from '../../src/guard/sim/Sim.js';

const heroId = process.argv[2] || 'huoqing';
const weaponId = process.argv[3] || 'pangu_axe';
const GEAR_Q = Number(process.env.GEAR_Q ?? 3);
const GEAR_WAVE = Number(process.env.GEAR_WAVE ?? 20);
const LVS = (process.env.LVS || '28,30,34').split(',').map(Number);

function setup(realmId, lv, seed) {
  const s = new Sim({ seed, heroId, mode: 'story', fx: false });
  s.wave.nextAt = 1e9;
  s.wave.n = 20;
  const h = s.hero;
  while (h.lv < lv) s.gainXp(s.xpNeed() - h.xp);
  for (const slot of ['u', 'q', 'e', 'f', 'r']) while (s.upgradeSkill(slot).ok);
  // 中等成型：指定神兵 + 其余三格 GEAR_Q 品质（默认仙宝）普通装备
  const gear = [s.loot.roll({ artifactId: weaponId })];
  for (const slot of ['armor', 'accessory', 'treasure']) gear.push(s.loot.roll({ slot, q: GEAR_Q, wave: GEAR_WAVE }));
  for (const it of gear) {
    s.loot.give(it);
    const idx = s.inv.equipBag.indexOf(it);
    s.command({ type: 'equip', bagIdx: idx, unitId: h.id });
  }
  s.calcStats(h);
  h.hp = h.maxHp;
  return s;
}

function fight(realmId, lv, seed) {
  const s = setup(realmId, lv, seed);
  const h = s.hero;
  const er = s.command({ type: 'enterRealm', id: realmId });
  if (!er.ok) throw new Error(`enterRealm failed: ${er.reason}`);
  for (let i = 0; i < 200 && !s.realms.run[realmId]?.boss; i++) {
    for (const e of s.enemies) if (e.alive && e.realm === realmId && !e.realmBoss) s.kill(e, h);
    s.advance(0.2);
  }
  const boss = s.enemies.find((e) => e.alive && e.realmBoss === realmId);
  if (!boss) throw new Error('boss not spawned');
  s.input.autoAttack = true;
  let deaths = 0;
  let t = 0;
  const T = 180;
  const hp0 = boss.maxHp;
  while (t < T && boss.alive) {
    if (!h.alive) { deaths++; h.alive = true; h.hp = h.maxHp; h.downT = 0; }
    s.input.cast = (heroId === 'huoqing' ? ['q', 'e', 'f', 'u', 'r'] : ['q', 'e', 'u', 'r']).map((slot) => ({ slot, aim: { x: boss.x, y: boss.y } }));
    s.input.aim = { x: boss.x, y: boss.y };
    const d = Math.hypot(boss.x - h.x, boss.y - h.y);
    const want = (h.stats && heroId === 'huoqing') ? 90 : 360;
    if (d > want) { s.input.mx = (boss.x - h.x) / d; s.input.my = (boss.y - h.y) / d; } else { s.input.mx = 0; s.input.my = 0; }
    s.advance(0.1);
    t += 0.1;
  }
  const dealt = hp0 - Math.max(0, boss.hp);
  return { realmId, lv, atk: Math.round(h.stats.atk), maxHp: h.maxHp, bossHp: hp0, dps: Math.round(dealt / t), t: Math.round(t), killed: boss.hp <= 0, bossLeft: Math.round(Math.max(0, boss.hp)), realmState: s.realms.state[realmId], heroInRealm: h.realm || null, deaths };
}

for (const [r, lv] of LVS.flatMap((lv) => [['xiangyu', lv], ['xingtian', lv]])) {
  console.log(JSON.stringify(fight(r, lv, 7)));
}
