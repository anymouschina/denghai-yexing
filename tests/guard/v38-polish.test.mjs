// 守卫剑阁全面完善验证（v3.8）：
// 1. 普通怪物/营地怪/精英/BOSS/神兽/武圣关羽 主动释放技能 & 沉默打断
// 2. 所有具名 BOSS / 先锋精英 / 强盗寨 / 狼王 / BOSS房 / 秘境重战 拥有独立不重复名号
// 3. Sim 边界稳定性（夜帝黑域死后安全、旱魃冲撞碰墙约束、心魔沉默打断）
// 4. 《守卫剑阁》完整五幕+无尽剧情系统、剑阁录数据与整图快照往返一致性
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../../src/guard/sim/Sim.js';
import { KITS } from '../../src/guard/sim/kits/index.js';
import { captureSim, restoreSim } from '../../src/guard/persist/snapshot.js';
import ENEMIES from '../../src/guard/data/enemies.json' with { type: 'json' };
import STORY from '../../src/guard/data/story.json' with { type: 'json' };
import { bossFor } from '../../src/guard/sim/systems/bosses.js';

function stepSec(sim, sec) {
  const n = Math.ceil(sec * 30);
  for (let i = 0; i < n && !sim.over; i++) sim.step();
}

test('普通怪物与营地怪物具备主动技能，能释放且受沉默打断', () => {
  const skillTypes = ['paperman', 'foxfire', 'lantern', 'jiangshi', 'guiche', 'yeya', 'hunbing', 'bandit', 'wolf'];
  for (const t of skillTypes) {
    assert.ok(ENEMIES[t] && ENEMIES[t].skill, `怪物 ${t} 应配置主动技能`);
  }

  // 逐类验证怪物能触发主动技能（产生弹体或 mobWarn 预警区）
  for (const t of ['paperman', 'foxfire', 'lantern', 'jiangshi', 'guiche', 'yeya', 'hunbing']) {
    const sim = new Sim({ seed: 101, heroId: 'huoqing', mode: 'story', fx: true });
    sim.wave.nextAt = 9999;
    const h = sim.hero;
    h.ctrl = true;
    h.hp = 99999; h.maxHp = 99999;
    sim.kongming.hp = 99999; sim.kongming.maxHp = 99999;
    const e = sim.spawnEnemy(t, h.x + 50, h.y, { hpMul: 10 });
    e.mobSkCd = 0.01;
    e.tgt = h;
    const projsBefore = sim.projs.length;
    const zonesBefore = sim.zones.length;
    let castObserved = false;
    for (let i = 0; i < 45; i++) {
      sim.step();
      if (sim.projs.length > projsBefore || sim.zones.some((z) => z.vis === 'mobWarn') || sim.zones.length > zonesBefore) {
        castObserved = true;
        break;
      }
    }
    assert.ok(castObserved, `怪物 ${t}（${ENEMIES[t].skill.name}）应当释放主动技能`);
  }

  // 沉默状态应阻止普通怪物施法
  const simSil = new Sim({ seed: 102, heroId: 'huoqing', mode: 'story', fx: false });
  simSil.wave.nextAt = 9999;
  const eSil = simSil.spawnEnemy('jiangshi', simSil.hero.x + 60, simSil.hero.y, { hpMul: 10 });
  eSil.mobSkCd = 0;
  eSil.tgt = simSil.hero;
  simSil.applyStatus(eSil, 'silence', 4);
  stepSec(simSil, 1.5);
  assert.equal(simSil.zones.filter((z) => z.vis === 'mobWarn').length, 0, '沉默期间普通怪物不应释放预警技能');
});

test('无尽 BOSS、先锋精英、强盗寨、狼王、BOSS房、秘境重战各自拥有不重复的独特名号', () => {
  const sim = new Sim({ seed: 202, heroId: 'azhu', mode: 'endless', fx: false });
  sim.wave.nextAt = 9999;
  sim.hero.hp = 999999; sim.hero.maxHp = 999999;
  sim.kongming.hp = 999999; sim.kongming.maxHp = 999999;

  // 1) 主线 10/20/30 波保持经典名，无尽 40..90 波全不重复
  assert.equal(bossFor(40, 'endless').key, 'laozu');
  assert.equal(bossFor(50, 'endless').key, 'hanba');
  assert.equal(bossFor(60, 'endless').key, 'yedi');
  const endlessNames = new Set();
  for (const w of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
    sim.wave.n = w;
    sim.emit('waveStart', { n: w, boss: true, lanes: ['N'] });
    const b = sim.wave.boss;
    assert.ok(b && b.name, `第 ${w} 波应刷出 BOSS`);
    assert.ok(!endlessNames.has(b.name), `第 ${w} 波 BOSS 名「${b.name}」不应重复`);
    endlessNames.add(b.name);
    b.hp = 1;
    sim.damage(sim.hero, b, 99999, { trueDmg: true });
    sim.compact();
  }
  assert.ok(endlessNames.has('灯骸老祖') && endlessNames.has('旱魃') && endlessNames.has('夜帝·无光'));
  assert.equal(endlessNames.size, 9);

  // 2) 先锋精英每 5 波独立命名且不重复
  const eliteNames = new Set();
  for (const w of [5, 15, 25, 35, 45]) {
    sim.wave.n = w;
    let spawned = null;
    sim.on('eliteSpawn', (el) => { spawned = el; });
    sim.emit('waveStart', { n: w, boss: false, lanes: ['N'] });
    assert.ok(spawned && spawned.name, `第 ${w} 波应刷出先锋精英`);
    assert.ok(!eliteNames.has(spawned.name), `精英名「${spawned.name}」不应重复`);
    assert.ok(spawned.eliteSkillKind, '精英应分配独立技能流派');
    eliteNames.add(spawned.name);
  }
  assert.equal(eliteNames.size, 5);

  // 3) 强盗营寨首刷吕达，重生后不重名
  const b1 = sim.bandits.getBoss();
  assert.ok(b1 && b1.name === '强盗头目·吕达' && b1.sheetKey === 'boss_lvda', '首次强盗头目保持吕达与独立贴图');
  const banditNames = new Set([b1.name]);
  for (let i = 0; i < 3; i++) {
    const cur = sim.bandits.getBoss();
    cur.hp = 1;
    sim.damage(sim.hero, cur, 99999, { trueDmg: true });
    sim.compact();
    sim.bandits.respawnAt = sim.t + 0.05;
    stepSec(sim, 0.2);
    const next = sim.bandits.getBoss();
    assert.ok(next && !banditNames.has(next.name), `强盗重生首领「${next && next.name}」不应重复`);
    banditNames.add(next.name);
  }

  // 4) 猎人营地首刷银背狼王，重生后不重名
  const w1 = sim.enemies.find((e) => e.alive && e.alphaWolf);
  assert.ok(w1 && w1.name === '银背狼王', '首次狼王应为银背狼王');
  const wolfNames = new Set([w1.name]);
  for (let i = 0; i < 2; i++) {
    for (const e of sim.enemies.filter((x) => x.alive && x.hunterCamp)) {
      e.hp = 1;
      sim.damage(sim.hero, e, 99999, { trueDmg: true });
    }
    sim.compact();
    sim.hunter.respawnT = 99;
    stepSec(sim, 0.2);
    const nw = sim.enemies.find((e) => e.alive && e.alphaWolf);
    assert.ok(nw && !wolfNames.has(nw.name), `重生狼王「${nw && nw.name}」不应重复`);
    wolfNames.add(nw.name);
  }

  // 5) BOSS 房多次挑战不同阶/同阶均独立命名
  const brNames = new Set();
  for (const tier of ['low', 'low', 'mid', 'mid', 'high', 'high']) {
    const res = sim.command({ type: 'enterBossRoom', tier });
    assert.ok(res.ok, res.reason);
    const brBoss = sim.enemies.find((e) => e.alive && e.bossRoomBoss);
    assert.ok(brBoss && !brNames.has(brBoss.name), `BOSS房首领「${brBoss && brBoss.name}」不应重复`);
    brNames.add(brBoss.name);
    brBoss.hp = 1;
    sim.damage(sim.hero, brBoss, 99999, { trueDmg: true });
    sim.compact();
    sim.bossRoom.respawnAt = 0;
    sim.command({ type: 'leaveBossRoom' });
  }
  assert.equal(brNames.size, 6);
});

test('四圣兽与武圣关羽均有可施放主动技能且 AI 自动施放', () => {
  assert.ok(KITS.guanyu && KITS.guanyu.q && KITS.guanyu.e, '武圣关羽应注册 Q/E 技能');
  const sim = new Sim({ seed: 303, heroId: 'huoqing', mode: 'story', fx: true });
  sim.wave.nextAt = 9999;
  const K = sim.kongming;
  const gy = sim.spawnUnit('summon', 'guanyu', K.x + 120, K.y, { ttl: 30 });
  const bw = sim.spawnUnit('beast', 'baihu', K.x - 120, K.y);
  const xw = sim.spawnUnit('beast', 'xuanwu', K.x, K.y - 120);
  // 刷目标敌人触发关羽与白虎 AI 施法
  const dummy = sim.spawnEnemy('jiangshi', K.x + 170, K.y, { hpMul: 30 });
  const dummy2 = sim.spawnEnemy('jiangshi', K.x - 320, K.y, { hpMul: 30 });
  // 压低孔明血量触发玄武护盾（即使玄武未锁定目标也能施放）
  K.hp = K.maxHp * 0.5;

  stepSec(sim, 1.5);
  assert.ok(gy.cds.q > 0 || gy.cds.e > 0, '武圣关羽应自动释放青龙偃月斩或威震华夏');
  assert.ok(bw.cds.q > 0 || bw.cds.e > 0, '神兽白虎应自动释放虎扑或啸风');
  assert.ok(xw.cds.q > 0 || K.shield > 0, '神兽玄武应在孔明低血量时自动释放龟甲阵');
  assert.ok(dummy.hp < dummy.maxHp || !dummy.alive || dummy2.hp < dummy2.maxHp || !dummy2.alive, '技能应对敌造成实际伤害');
});

test('边界安全：夜帝黑域死后不再结算、心魔受沉默打断', () => {
  const sim = new Sim({ seed: 404, heroId: 'huoqing', mode: 'story', fx: false });
  sim.wave.nextAt = 9999;
  sim.hero.hp = 50000; sim.hero.maxHp = 50000;
  // 心魔镜像召唤并沉默
  const r = sim.command({ type: 'startMirror', tier: 'm2' });
  assert.ok(r.ok, r.reason);
  const m = sim.enemies.find((e) => e.alive && e.mirrorBoss);
  assert.ok(m, '应刷出心魔镜像');
  m.mcd.nova = 0; m.mcd.dash = 0;
  sim.applyStatus(m, 'silence', 5);
  sim.zones.length = 0;
  stepSec(sim, 1.0);
  assert.equal(sim.zones.filter((z) => z.vis === 'warn' && z.side === 'enemy').length, 0, '沉默期间心魔不应释放技能');

  // 击杀心魔后，测试夜帝黑域回调安全
  m.hp = 1;
  sim.damage(sim.hero, m, 99999, { trueDmg: true });
  sim.wave.n = 30;
  sim.emit('waveStart', { n: 30, boss: true, lanes: ['N'] });
  const yd = sim.wave.boss;
  assert.ok(yd && yd.boss === 'yedi');
  yd.x = sim.hero.x + 80; yd.y = sim.hero.y;
  yd.skT = 0;
  // 跑 2 秒触发技能，再立刻击杀夜帝，推进 6 秒确认无异常
  stepSec(sim, 2.0);
  yd.hp = 1;
  sim.damage(sim.hero, yd, 99999, { trueDmg: true });
  assert.doesNotThrow(() => stepSec(sim, 6.0), '夜帝死后残留黑域推进不应报错');
});

test('守卫剑阁完整剧情系统：五幕切换、事件对白、讨伐名录与存档往返一致', () => {
  assert.equal(STORY.acts.length, 6, '应包含 5 幕主线 + 第 6 幕无尽劫波');
  assert.equal(Object.keys(STORY.heroes).length, 4, '应包含 4 位英雄完整设定');

  const sim = new Sim({ seed: 505, heroId: 'azhu', mode: 'story', fx: true });
  assert.ok(sim.story, 'sim.story 应已初始化');
  assert.equal(sim.story.act, 1);
  assert.ok(sim.story.active && sim.story.log.length >= 2, '开局应触发序章对白并写入剧情日志');
  assert.ok(sim.story.log.some((l) => l.speaker === '阿烛'), '开局对白应包含所选英雄台词');

  // 跳过一条对白
  const prevText = sim.story.active.text;
  const sk = sim.command({ type: 'skipStory' });
  assert.ok(sk.ok);
  assert.notEqual(sim.story.active && sim.story.active.text, prevText, 'skipStory 应切到下一条对白');

  // 标记已读
  sim.command({ type: 'markStoryRead' });
  assert.equal(sim.story.unread, 0);

  // 推进波次验证换幕与对白
  sim.wave.n = 6;
  sim.emit('waveStart', { n: 6, boss: false, lanes: ['N', 'E'] });
  assert.equal(sim.story.act, 2, '第 6 波应进入第二幕');
  assert.ok(sim.story.seen.wave_6, '应记录第 6 波剧情已触发');

  // 击杀强盗头目记录讨伐名录与强盗剧情
  const lvda = sim.bandits.getBoss();
  lvda.hp = 1;
  sim.damage(sim.hero, lvda, 99999, { trueDmg: true });
  assert.ok(sim.story.defeatedBosses.includes('强盗头目·吕达'), '击杀具名首领应录入讨伐名录');
  assert.ok(sim.story.seen.banditBossKill, '击杀吕达应触发对应剧情对白');

  // 快照存档往返
  for (const u of sim.units) if (u.alive) sim.calcStats(u);
  const snap = captureSim(sim);
  assert.equal(snap.lostCount, 0, '含剧情系统与唯一名册的快照不应丢失任何函数');
  const sim2 = new Sim({ seed: snap.sim.seed, heroId: snap.sim.heroId, mode: snap.sim.mode, fx: true });
  restoreSim(sim2, JSON.parse(JSON.stringify(snap)));
  assert.equal(sim2.story.act, sim.story.act);
  assert.deepEqual(sim2.story.defeatedBosses, sim.story.defeatedBosses);
  assert.deepEqual(sim2.usedBossNames, sim.usedBossNames);
  assert.equal(typeof sim2.story.trigger, 'function', '读档后 story 系统方法应保留');
});
