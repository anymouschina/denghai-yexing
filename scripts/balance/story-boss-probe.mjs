// 主线 BOSS 单挑探针：英雄指定等级、技能满点、神兵 + 3 件 GEAR_Q 品质装备，可选 BOOKS 本武勇之书，站桩输出 180 秒。
// 用法：BOOKS=80 node scripts/balance/story-boss-probe.mjs <hero> <weapon> <bossKey:laozu|hanba|yedi> <wave> <lv,lv,...>
import { Sim } from '../../src/guard/sim/Sim.js';
import { spawnBoss } from '../../src/guard/sim/systems/bosses.js';
import BAL from '../../src/guard/data/balance.json' with { type: 'json' };

const [heroId = 'huoqing', weaponId = 'pangu_axe', bossKey = 'hanba', waveArg = '20', lvArg = '22,26,30'] = process.argv.slice(2);
const GEAR_Q = Number(process.env.GEAR_Q ?? 3);
const BOOKS = Number(process.env.BOOKS ?? 0);
const wave = Number(waveArg);

function fight(lv, seed) {
  const s = new Sim({ seed, heroId, mode: 'story', fx: false });
  s.wave.nextAt = Infinity;
  s.wave.n = wave;
  const h = s.hero;
  while (h.lv < lv) s.gainXp(s.xpNeed() - h.xp);
  for (const slot of ['u', 'q', 'e', 'f', 'r']) while (s.upgradeSkill(slot).ok);
  const gear = [s.loot.roll({ artifactId: weaponId })];
  for (const slot of ['armor', 'accessory', 'treasure']) gear.push(s.loot.roll({ slot, q: GEAR_Q, wave }));
  for (const it of gear) { s.loot.give(it); s.command({ type: 'equip', bagIdx: s.inv.equipBag.indexOf(it), unitId: h.id }); }
  if (BOOKS > 0) { s.copper += BOOKS * 120; for (let n = BOOKS; n > 0; n -= 20) s.command({ type: 'buyBook', itemId: 'tome_atk', count: Math.min(20, n) }); }
  s.calcStats(h); h.hp = h.maxHp;
  h.x = BAL.world.cx; h.y = BAL.world.cy - 700;
  const boss = spawnBoss(s, bossKey, wave, wave);
  boss.x = h.x + 150; boss.y = h.y;
  s.input.autoAttack = true;
  let t = 0; let deaths = 0;
  const melee = heroId === 'huoqing';
  while (t < 180 && boss.alive) {
    if (!h.alive) { deaths++; h.alive = true; h.hp = h.maxHp; h.downT = 0; h.x = boss.x - 300; h.y = boss.y; }
    s.input.cast = (melee ? ['q', 'e', 'f', 'u', 'r'] : ['q', 'e', 'u', 'r']).map((slot) => ({ slot, aim: { x: boss.x, y: boss.y } }));
    s.input.aim = { x: boss.x, y: boss.y };
    const d = Math.hypot(boss.x - h.x, boss.y - h.y);
    const want = melee ? 90 : 360;
    if (d > want) { s.input.mx = (boss.x - h.x) / d; s.input.my = (boss.y - h.y) / d; } else { s.input.mx = 0; s.input.my = 0; }
    s.advance(0.1); t += 0.1;
  }
  return { boss: bossKey, lv, atk: Math.round(h.stats.atk), hp: h.maxHp, bossHp: boss.maxHp, killed: boss.hp <= 0, t: Math.round(t), left: `${Math.round(Math.max(0, boss.hp) / boss.maxHp * 100)}%`, deaths };
}

for (const lv of lvArg.split(',').map(Number)) console.log(JSON.stringify(fight(lv, 11)));
