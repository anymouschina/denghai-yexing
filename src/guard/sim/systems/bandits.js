// 可复用《守卫剑阁》强盗任务系统（数据驱动，配置见 map.banditCamp / balance.json）：
// - 左上角强盗营寨由「山贼喽啰」与首领「强盗头目·吕达」镇守，绝不进攻孔明（带营地仇恨与牵引半径）。
// - 击杀吕达立即发放高额铜钱 + 保底装备 + 道具/成长书卷奖励；冷却后自动重生，支持反复讨伐！
import { pushOutOfWalls } from '../map.js';
import ENEMIES from '../../data/enemies.json' with { type: 'json' };
import { ITEMS } from './loot.js';
import { regFn } from '../../persist/fnRegistry.js';

function adaptiveInfo(sim) {
  const B = sim.bandits;
  const cfg = B?.cfg;
  const bd = cfg?.boss || {};
  const rw = cfg?.reward || {};
  const clears = B ? B.clears : 0;
  return {
    fixed: true,
    adaptMul: 1,
    tierMul: rw.tierMul ?? cfg?.tierMul ?? 1.4,
    copperMul: 1,
    xpMul: 1,
    copper: rw.copper ?? 420,
    xp: rw.xp ?? 300,
    minQ: rw.minQ ?? 2,
    equipCount: rw.equipCount ?? 2,
    bonusTomes: rw.bonusTomes ?? 1,
    bossHp: bd.hp || 4600,
    bossAtk: bd.atk || 54,
    clears,
  };
}

function nearestAllyNear(sim, e, range) {
  let best = null;
  let bd = range * range;
  for (const u of sim.units) {
    if (!u.alive || u.kind === 'kongming' || u.realm) continue;
    const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

function banditUnitUpdate(sim, e, dt, frozen) {
  if (e.mcd) for (const k in e.mcd) if (e.mcd[k] > 0) e.mcd[k] -= dt;
  if (e.castT > 0) { e.castT -= dt; return; }
  if (frozen) return;
  const home = e.home || { x: e.x, y: e.y };
  const leash = e.leash || 520;
  const distHome = Math.hypot(e.x - home.x, e.y - home.y);
  let t = nearestAllyNear(sim, e, e.aggro || 420);
  if (t && Math.hypot(t.x - home.x, t.y - home.y) > leash + 120) t = null;
  if (!t || distHome > leash + 80) {
    if (distHome > 24) {
      const sp = e.spd * dt;
      e.x += ((home.x - e.x) / distHome) * sp;
      e.y += ((home.y - e.y) / distHome) * sp;
      e.face = home.x >= e.x ? 1 : -1;
      pushOutOfWalls(e, e.r, sim.walls);
    }
    return;
  }
  e.tgt = t;
  e.face = t.x >= e.x ? 1 : -1;
  const dist = Math.hypot(t.x - e.x, t.y - e.y);

  // 首领技能（沉默时禁止施放）；山贼喽啰亦可释放自身技能
  if (!(e.st.silence > 0) && e.def && e.def.moves && e.mcd) {
    for (const m of e.def.moves) {
      if (e.mcd[m.id] > 0) continue;
      if (m.range && dist > m.range) continue;
      e.mcd[m.id] = m.cd;
      if (m.type === 'nova') {
        e.castT = m.warn + 0.2;
        sim.telegraph(e.x, e.y, m.r, m.warn, () => {
          if (!e.alive) return;
          for (const u of sim.alliesIn(e.x, e.y, m.r)) if (u.kind !== 'kongming') sim.damage(e, u, e.atk * m.coef, { tag: 'bandit' });
          sim.pushFx({ t: 'boom', x: e.x, y: e.y, r: m.r });
        }, 0xff7a3a);
        if (m.ult) sim.pushFx({ t: 'text', x: e.x, y: e.y - e.h - 20, text: m.name, color: '#ff8a5a', size: 28 });
        return;
      }
      if (m.type === 'slam') {
        e.castT = m.warn * 0.5;
        const sx = t.x; const sy = t.y;
        sim.telegraph(sx, sy, m.r, m.warn, () => {
          if (!e.alive) return;
          for (const u of sim.alliesIn(sx, sy, m.r)) if (u.kind !== 'kongming') sim.damage(e, u, e.atk * m.coef, { tag: 'bandit' });
          sim.pushFx({ t: 'boom', x: sx, y: sy, r: m.r, small: true });
        }, 0xff9a3c);
        return;
      }
    }
  } else if (!e.banditBoss && sim.tryEnemySkill && sim.tryEnemySkill(e, dt)) {
    return;
  }

  const reach = e.range + e.r + (t.r || 20);
  if (dist <= reach) {
    if (e.cd <= 0) {
      e.cd = e.cdMax;
      sim.damage(e, t, e.atk, { tag: 'bandit' });
    }
    return;
  }
  if (e.st.root > 0) return;
  const slow = e.st.slow ? 1 - Math.min(0.8, e.st.slow.v) : 1;
  const sp = e.spd * slow * dt;
  e.x += ((t.x - e.x) / Math.max(1, dist)) * sp;
  e.y += ((t.y - e.y) / Math.max(1, dist)) * sp;
  pushOutOfWalls(e, e.r, sim.walls);
}

function towerUpdate(sim, e, dt, frozen) {
  if (frozen) return;
  const t = nearestAllyNear(sim, e, e.range || 380);
  e.tgt = t;
  if (!t) return;
  e.face = t.x >= e.x ? 1 : -1;
  if (e.cd <= 0) {
    e.cd = e.cdMax;
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    sim.addProj({
      side: 'enemy',
      src: e,
      x: e.x,
      y: e.y - e.h * 0.6,
      a,
      speed: 620,
      life: 1.0,
      dmg: e.atk,
      r: 12,
      tex: 'g_arrow',
      tint: 0xff6a5a,
    });
  }
}

function spawnCamp(sim, cfg) {
  const B = sim.bandits;
  // 清理旧残余强盗与箭塔
  for (const e of sim.enemies) {
    if (e.alive && e.banditCamp === cfg.id) e.alive = false;
  }
  // 刷敌方箭塔（通往左上强盗营寨的必经哨塔）
  B.towerIds = [];
  for (const td of (cfg.enemyTowers || [])) {
    const tDef = { ...td, tex: 'g_bld_arrow', spd: 0, ai: 'ranged' };
    const tw = sim.spawnEnemy('enemy_tower', td.x, td.y, {
      def: tDef,
      name: td.name || '敌方箭塔',
      realm: 'bandit_camp',
      home: { x: td.x, y: td.y },
      hpMul: 1,
      atkMul: 1,
      copper: td.copper || 140,
      xp: td.xp || 110,
      tint: 0xff7a6a,
      extra: {
        banditCamp: cfg.id,
        openCamp: true,
        enemyTower: true,
        towerKey: td.id,
        update: towerUpdate,
        aggro: td.range || 380,
      },
    });
    B.towerIds.push(tw.id);
  }
  // 刷山贼喽啰
  for (const m of (cfg.minions || [])) {
    const mType = m.type || 'bandit';
    const ed = ENEMIES[mType];
    for (let i = 0; i < (m.count || 0); i++) {
      const ang = (i / Math.max(1, m.count)) * Math.PI * 2 + 0.4;
      const mx = cfg.x + Math.cos(ang) * 135;
      const my = cfg.y + Math.sin(ang) * 105;
      sim.spawnEnemy(mType, mx, my, {
        hpMul: m.hpMul || 1,
        atkMul: m.atkMul || 1,
        copper: ed?.copper || 18,
        xp: ed?.xp || 22,
        realm: 'bandit_camp',
        home: { x: mx, y: my },
        tint: 0xd99b66,
        extra: {
          banditCamp: cfg.id,
          openCamp: true,
          update: banditUnitUpdate,
          leash: cfg.boss?.leash || 520,
          aggro: 380,
        },
      });
    }
  }
  // 刷首领（首次固定为强盗头目·吕达，之后重生轮换不同名号的匪首）
  const bd = cfg.boss;
  const bossDef = { ...bd, ai: 'melee' };
  let bossName = bd.name || '强盗头目·吕达';
  if (B.clears === 0) {
    if (sim.usedBossNames) sim.usedBossNames[bossName] = 1;
  } else if (sim.pickUniqueBossName) {
    bossName = sim.pickUniqueBossName(bossName, bd.bossRoster || [], '黑风匪首');
  }
  const boss = sim.spawnEnemy('boss_lvda', cfg.x, cfg.y, {
    def: bossDef,
    name: bossName,
    boss: null,
    elite: true,
    realm: 'bandit_camp',
    home: { x: cfg.x, y: cfg.y },
    hpMul: 1,
    atkMul: 1,
    copper: bd.copper || 260,
    xp: bd.xp || 220,
    extra: {
      banditCamp: cfg.id,
      openCamp: true,
      banditBoss: true,
      beastKey: 'lvda',
      sheetKey: bd.sheetKey || 'boss_lvda',
      update: banditUnitUpdate,
      leash: bd.leash || 540,
      aggro: bd.aggro || 460,
      mcd: Object.fromEntries((bd.moves || []).map((mv) => [mv.id, mv.cd * 0.5])),
      castT: 0.4,
    },
  });
  B.bossId = boss.id;
  B.state = 'alive';
  B.respawnAt = 0;
  return boss;
}

export default {
  id: 'bandits',
  init(sim) {
    const cfg = sim.map && sim.map.banditCamp;
    if (!cfg) {
      sim.bandits = null;
      return;
    }
    sim.bandits = {
      cfg,
      state: 'alive', // 'alive' | 'respawning'
      bossId: null,
      clears: 0,
      respawnAt: 0,
      cooldownLeft: () => Math.max(0, (sim.bandits.respawnAt || 0) - sim.t),
      getBoss: () => sim.enemies.find((e) => e.alive && e.id === sim.bandits.bossId) || null,
      getAdaptiveInfo: () => adaptiveInfo(sim),
    };
    spawnCamp(sim, cfg);

    sim.on('kill', ({ enemy }) => {
      if (enemy.enemyTower && enemy.banditCamp === cfg.id) {
        sim.pushFx({ t: 'boom', x: enemy.x, y: enemy.y, r: 120 });
        sim.banner(`摧毁【${enemy.name}】！攻破强盗哨卡 +${enemy.copper || 95} 铜钱`, '#ffc977');
        sim.emit('enemyTowerDestroyed', { tower: enemy, camp: cfg.id });
        return;
      }
      if (!enemy.banditBoss || enemy.banditCamp !== cfg.id || !sim.bandits) return;
      const B = sim.bandits;
      const ad = adaptiveInfo(sim);
      B.clears++;
      B.state = 'respawning';
      B.bossId = null;
      B.respawnAt = sim.t + (cfg.respawnSec || 45);

      const copper = ad.copper;
      const xp = ad.xp;
      if (copper > 0) sim.addCopper(copper, enemy.x, enemy.y);
      if (xp > 0) sim.gainXp(xp);

      let equipGiven = 0;
      const L = sim.loot;
      if (L && L.roll && L.grant) {
        const rollWave = Math.max(3, cfg.reward?.waveBase || 6);
        const sets = (ITEMS.drops && ITEMS.drops.bossSets) || ['baihu', 'xuanwu', 'zhuque', 'qinglong', 'xiangyu', 'xingtian', 'lvbu', 'plain'];
        for (let i = 0; i < ad.equipCount; i++) {
          const it = L.roll({ wave: rollWave, minQ: ad.minQ, set: sim.pick(sets) });
          if (it) { L.grant(it, enemy.x, enemy.y); equipGiven++; }
        }
        // 固定掉落成长书卷
        for (let t = 0; t < ad.bonusTomes; t++) {
          const tomeId = t % 2 === 1 ? 'tome_omni' : sim.pick(['tome_atk', 'tome_hp', 'tome_def']);
          const tome = L.roll({ id: tomeId });
          if (tome) L.grant(tome, enemy.x, enemy.y);
        }
        // 概率掉落挨打成长神装礼盒（龙鳞铠甲 / 的卢马）
        if (sim.rng() < 0.28) {
          const box = L.roll({ id: sim.pick(['growth_dragonscale_box', 'growth_dilu_box']) });
          if (box) L.grant(box, enemy.x, enemy.y);
        }
      }

      sim.pushFx({ t: 'boom', x: enemy.x, y: enemy.y, r: 140 });
      sim.banner(`讨伐成功 · 击杀【${enemy.name}】！铜钱 +${copper} · 经验 +${xp} · 保底装备×${equipGiven} + 成长书×${ad.bonusTomes}`, '#ffd36a', true);
      sim.emit('banditBossKill', { boss: enemy, clears: B.clears, copper, xp, equipGiven, bonusTomes: ad.bonusTomes, fixed: true, adaptMul: ad.adaptMul });
    });
  },
  update(sim) {
    const B = sim.bandits;
    if (!B) return;
    if (B.state === 'respawning' && B.respawnAt > 0 && sim.t >= B.respawnAt) {
      const nb = spawnCamp(sim, B.cfg);
      sim.banner(`左上强盗营寨重聚 · 新匪首【${nb.name}】率众再袭，可重复讨伐！`, '#ff9a5a');
      sim.emit('banditRespawn', { camp: B.cfg.id, clears: B.clears, bossName: nb.name });
    }
  },
  commands: {
    guideBandit(sim) {
      const B = sim.bandits;
      if (!B) return { ok: false, reason: '当前地图未配置强盗营寨' };
      const u = sim.ctrl;
      if (!u || !u.alive) return { ok: false, reason: '当前单位已倒下' };
      const r = sim.command({ type: 'attackMove', x: B.cfg.x, y: B.cfg.y });
      return { ok: !!(r && r.ok), x: B.cfg.x, y: B.cfg.y, state: B.state, cooldown: B.cooldownLeft() };
    },
  },
};

// 存档：妖物 update 函数登记，读档时按名字还原
regFn('bandits.banditUnitUpdate', banditUnitUpdate);
regFn('bandits.towerUpdate', towerUpdate);
