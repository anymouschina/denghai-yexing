// 无头"玩家"机器人：只通过 sim.input 与 sim.command() 操作（和真人同一套接口），不改数值、不读未来。
// 三档：
//   random  随机下限：乱走、乱按技能、随机买东西（不能躺赢）
//   proxy   真人代理：聪明决策 + 瞄准高斯误差 σ（默认 0.05 弧度）+ 反应间隔
//   perfect 上限：同 proxy 决策，σ=0、反应 0、提前量预判
import { KITS } from '../../../src/guard/sim/kits/index.js';
import { REALMS, HIDDEN, gateCenter, FOUNDATIONS } from '../../../src/guard/sim/map.js';
import BAL from '../../../src/guard/data/balance.json' with { type: 'json' };
import UNITS from '../../../src/guard/data/units.json' with { type: 'json' };

const SLOT_ORDER = ['u', 'q', 'e', 'r', 'f'];

export class PlayerBot {
  constructor(sim, { kind = 'proxy', sigma = 0.05, seed = 1, economy = true, realms = true, log = false, growth = false } = {}) {
    this.growth = growth; // v3.7：是否使用 v3.4+ 成长系统（南华渡劫 + 书店永久书卷）
    this.sim = sim;
    this.kind = kind;
    this.sigma = kind === 'perfect' ? 0 : sigma;
    this.react = kind === 'perfect' ? 0 : 0.18; // 决策间隔（秒）
    let a = seed >>> 0;
    this.r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.economy = economy;
    this.realmsOn = realms;
    this.log = log;
    this.thinkT = 0;
    this.ecoT = 0;
    this.goal = null; // {x,y,why}
    this.mode = 'defend'; // defend | realm
    this.realmTarget = null;
    this.events = [];
    this.randDir = [0, 0];
    sim.on('end', (o) => this.note(`结束：${o.win ? '胜' : '负'} ${o.reason}`));
  }

  note(s) { if (this.log) this.events.push(`[${this.sim.t.toFixed(1)}] ${s}`); }

  gauss() { const u = 1 - this.r(); const v = this.r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // 把瞄准点绕施法者旋转一个高斯角误差（σ 弧度），距离也带 5% 误差
  noisyAim(u, p) {
    if (!p) return null;
    if (this.sigma === 0) return { x: p.x, y: p.y };
    const a = Math.atan2(p.y - u.y, p.x - u.x) + this.gauss() * this.sigma;
    const d = Math.hypot(p.x - u.x, p.y - u.y) * (1 + this.gauss() * 0.05);
    return { x: u.x + Math.cos(a) * d, y: u.y + Math.sin(a) * d };
  }

  lead(u, e) {
    // 完美机器人：按弹速预判（近似：只对移动中的妖物加提前量）
    if (this.kind !== 'perfect' || !e || !u.def.basic || u.def.basic.type !== 'proj') return { x: e.x, y: e.y };
    const t = Math.hypot(e.x - u.x, e.y - u.y) / u.def.basic.speed;
    const tgt = e.tgt || this.sim.kongming;
    const a = Math.atan2(tgt.y - e.y, tgt.x - e.x);
    return { x: e.x + Math.cos(a) * e.spd * t, y: e.y + Math.sin(a) * e.spd * t };
  }

  step() {
    const s = this.sim;
    if (s.over) return;
    this.thinkT -= 1 / 30;
    this.ecoT -= 1 / 30;
    if (this.kind === 'random') { this.stepRandom(); return; }
    if (this.thinkT <= 0) { this.thinkT = this.react; this.think(); }
    if (this.economy && this.ecoT <= 0) { this.ecoT = 1; this.manage(); }
    this.drive();
  }

  // ---------------- 随机下限 ----------------
  stepRandom() {
    const s = this.sim;
    const u = s.ctrl;
    if (!u) return;
    if (this.thinkT <= 0) {
      this.thinkT = 0.5 + this.r();
      const a = this.r() * Math.PI * 2;
      this.randDir = this.r() < 0.25 ? [0, 0] : [Math.cos(a), Math.sin(a)];
      // 别跑出灯坛太远（真人新手也会回来），否则就是纯挂机
      if (Math.hypot(u.x - s.kongming.x, u.y - s.kongming.y) > 700) {
        const b = Math.atan2(s.kongming.y - u.y, s.kongming.x - u.x);
        this.randDir = [Math.cos(b), Math.sin(b)];
      }
      s.input.aim = { x: u.x + Math.cos(this.r() * 6.283) * 300, y: u.y + Math.sin(this.r() * 6.283) * 300 };
      if (this.r() < 0.3) s.input.cast.push(SLOT_ORDER[(this.r() * 5) | 0]);
      if (this.economy && this.r() < 0.15) this.randomEconomy();
    }
    s.input.mx = this.randDir[0];
    s.input.my = this.randDir[1];
    s.input.attack = this.r() < 0.6;
  }

  randomEconomy() {
    const s = this.sim;
    const r = this.r();
    if (r < 0.4) {
      const f = this.nearestFreeFoundation(s.ctrl);
      if (f) { const kind = ['arrow', 'fu', 'lei', 'wall', 'lamp'][(this.r() * 5) | 0]; s.command({ type: 'build', fid: f.id, kind, bld: kind }); }
    } else if (r < 0.7) s.command({ type: 'hire', key: ['dao', 'nu', 'tong'][(this.r() * 3) | 0] });
    else if (s.inv) { const i = s.inv.bag.findIndex(Boolean); if (i >= 0) s.command({ type: this.r() < 0.5 ? 'useItem' : 'equip', bagIdx: i, unitId: s.hero.id }); }
  }

  // ---------------- 真人代理 / 完美 ----------------
  autoLearnSkills() {
    const s = this.sim;
    const h = s.hero;
    if (!h || !h.alive || !h.skillPoints || !s.canUpgradeSkill) return;
    // 优先学大招，再逐个解锁未学基础技能，最后均衡加点
    const learnOrder = ['u', 'q', 'e', 'r', 'f'];
    let guard = 10;
    while (h.skillPoints > 0 && guard-- > 0) {
      let picked = null;
      if (s.canUpgradeSkill(h, 'u')) picked = 'u';
      if (!picked) picked = learnOrder.find((sl) => sl !== 'u' && (h.skillLvs[sl] || 0) === 0 && s.canUpgradeSkill(h, sl));
      if (!picked) {
        let minLv = 99;
        for (const sl of ['q', 'e', 'r', 'f']) {
          if (s.canUpgradeSkill(h, sl) && (h.skillLvs[sl] || 0) < minLv) {
            minLv = h.skillLvs[sl] || 0;
            picked = sl;
          }
        }
      }
      if (!picked) break;
      const r = s.command({ type: 'upgradeSkill', slot: picked });
      if (!r || !r.ok) break;
    }
  }

  think() {
    const s = this.sim;
    const u = s.ctrl;
    if (!u) return;
    this.autoLearnSkills();
    const K = s.kongming;
    // 1) 战略：守家 or 刷秘境
    this.chooseMode();
    // 2) 选目标
    let tgt = null;
    if (this.mode === 'realm' && u.realm) {
      tgt = s.nearestEnemy(u.x, u.y, 900, (e) => e.realm === u.realm);
    }
    if (!tgt && this.mode !== 'realm') {
      if (s.t - s.kmAlert.t < 2) tgt = s.nearestEnemy(K.x, K.y, 520, (e) => !e.realm);
      if (!tgt) {
        const boss = s.enemies.find((e) => e.alive && e.boss && !e.realm);
        if (boss && Math.hypot(boss.x - K.x, boss.y - K.y) < 1600) tgt = boss;
      }
      if (!tgt) tgt = s.nearestEnemy(u.x, u.y, 650, (e) => !e.realm);
      if (!tgt) tgt = s.nearestEnemy(K.x, K.y, 1300, (e) => !e.realm);
    }
    this.tgt = tgt;
    u.tgt = tgt; // 技能 AI（tgtIn 等）读 u.tgt：操控单位的目标由玩家（这里是机器人）决定
    // 3) 技能：用技能自带的 AI 判断"值不值得放"，瞄准加误差
    const kit = KITS[u.key];
    if (kit) {
      for (const slot of SLOT_ORDER) {
        const k = kit[slot];
        if (!k || !k.ai) continue;
        if (u.kind === 'hero' && u.skillLvs && (u.skillLvs[slot] || 0) <= 0) continue;
        if (slot === 'u' ? u.energy < BAL.hero.ultEnergy : (u.cds[slot] > 0 || !u.def.skills?.[slot])) continue;
        const aim = k.ai(s, u);
        if (!aim) continue;
        s.input.aim = this.noisyAim(u, aim);
        s.input.cast.push(slot);
        this.castThisTick = true;
        break;
      }
    }
    // 4) 道具
    if (s.inv) {
      const bag = s.inv.bag;
      const find = (id) => bag.findIndex((it) => it && (it.id === id || it.key === id || it.kind === id));
      if (u.hp / u.maxHp < 0.35) { const i = find('pill'); if (i >= 0) s.command({ type: 'useItem', bagIdx: i }); }
      if (K.hp / K.maxHp < 0.5) { const i = find('oil'); if (i >= 0) s.command({ type: 'useItem', bagIdx: i }); }
      const p = find('purse'); if (p >= 0) s.command({ type: 'useItem', bagIdx: p });
    }
  }

  chooseMode() {
    const s = this.sim;
    const K = s.kongming;
    const u = s.ctrl;
    if (!this.realmsOn || !s.realms) { this.mode = 'defend'; return; }
    const kmOk = K.hp / K.maxHp > 0.55;
    const bossOut = s.enemies.some((e) => e.alive && e.boss && !e.realm);
    if (this.mode === 'realm') {
      const st = s.realms.state[this.realmTarget];
      if (st === 'cleared' || !kmOk || bossOut || u.hp / u.maxHp < 0.25) {
        this.note(`离开秘境 ${this.realmTarget}（${st}）`);
        this.mode = 'defend';
        this.realmTarget = null;
      }
      return;
    }
    if (!kmOk || bossOut) return;
    // 刷秘境的时机：刚开新波（家里还有时间）、建筑够、英雄等级够
    const sinceWave = s.t - (s.wave.startedAt || 0);
    const towers = s.buildings.filter((b) => b.alive).length;
    if (sinceWave > 20 || towers < 3) return;
    const order = ['xuanwu', 'baihu', 'zhuque', 'qinglong', 'qilin'];
    for (const id of order) {
      if (s.realms.firstCleared && s.realms.firstCleared[id]) continue;
      const st = s.realms.state[id];
      if (st === 'open' || st === 'active') {
        if (id === 'qilin' && !s.realms.hiddenOpen) continue;
        const need = { xuanwu: 5, baihu: 7, zhuque: 10, qinglong: 13, qilin: 17 }[id];
        if (s.hero.lv < need) return;
        this.mode = 'realm';
        this.realmTarget = id;
        this.note(`前往秘境 ${id}（Lv${s.hero.lv}，波 ${s.wave.n}）`);
        return;
      }
    }
  }

  // 每 tick：移动与普攻
  drive() {
    const s = this.sim;
    const u = s.ctrl;
    if (!u) return;
    const inp = s.input;
    let gx;
    let gy;
    const tgt = this.tgt && this.tgt.alive ? this.tgt : null;
    if (this.mode === 'realm' && (!u.realm || !tgt)) {
      // 秘境模式：还没进门就沿门路走；进了门但这一刻没目标（刚进门、轮次之间）就往秘境深处走，别退回家里触发重置
      const p = this.realmPath(u);
      gx = p.x; gy = p.y;
    } else if (this.goal) {
      gx = this.goal.x; gy = this.goal.y;
      if (Math.hypot(u.x - gx, u.y - gy) < 60) { const g = this.goal; this.goal = null; if (g.done) g.done(); }
    } else if (tgt) {
      const range = u.def.basic.range;
      const d = Math.hypot(tgt.x - u.x, tgt.y - u.y);
      const want = u.def.basic.type === 'melee' ? range * 0.6 : range * 0.75;
      if (d > want) { gx = tgt.x; gy = tgt.y; }
      else if (u.def.basic.type !== 'melee' && d < range * 0.4) { gx = u.x * 2 - tgt.x; gy = u.y * 2 - tgt.y; }
      // 躲红圈：站在预警圈里就往外走
      for (const z of s.zones) {
        if (z.alive && z.vis === 'warn' && Math.hypot(z.x - u.x, z.y - u.y) < z.r + u.r) {
          const a = Math.atan2(u.y - z.y, u.x - z.x);
          gx = u.x + Math.cos(a) * 200; gy = u.y + Math.sin(a) * 200;
        }
      }
    } else {
      const K = s.kongming;
      gx = K.x; gy = K.y + 160;
      if (Math.hypot(u.x - gx, u.y - gy) < 80) gx = undefined;
    }
    if (gx !== undefined) {
      const a = Math.atan2(gy - u.y, gx - u.x);
      inp.mx = Math.cos(a); inp.my = Math.sin(a);
    } else { inp.mx = 0; inp.my = 0; }
    if (tgt && !this.castThisTick) {
      inp.aim = this.noisyAim(u, this.lead(u, tgt));
      inp.attack = Math.hypot(tgt.x - u.x, tgt.y - u.y) < u.def.basic.range * 1.05 + tgt.r;
    } else inp.attack = false;
    this.castThisTick = false;
  }

  realmPath(u) {
    const id = this.realmTarget;
    const s = this.sim;
    if (id === 'qilin') {
      const e = BAL.hiddenRealm.entry;
      return { x: e[0], y: e[1] };
    }
    const r = REALMS.find((x) => x.id === id);
    const [gx, gy] = gateCenter(r);
    const cx = (r.rect[0] + r.rect[2]) / 2;
    const cy = (r.rect[1] + r.rect[3]) / 2;
    // 先走到门外（朝中心偏 200），再穿门进去
    const ox = gx + Math.sign(BAL.world.cx - gx) * 220;
    const oy = gy + Math.sign(BAL.world.cy - gy) * 220;
    if (Math.hypot(u.x - gx, u.y - gy) > 260 && Math.hypot(u.x - ox, u.y - oy) > 60) return { x: ox, y: oy };
    return { x: cx, y: cy };
  }

  nearestFreeFoundation(u) {
    const s = this.sim;
    let best = null;
    let bd = Infinity;
    for (const f of s.foundations) {
      if (f.bid) continue;
      const d = Math.hypot(f.x - u.x, f.y - u.y);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  // ---------------- 经营（每秒一次） ----------------
  manage() {
    const s = this.sim;
    const u = s.ctrl;
    if (!u || this.mode === 'realm') { this.equipBest(); return; }
    const activeLanes = new Set(s.wave.lanes || []);
    const towers = s.buildings.filter((b) => b.alive);
    const mercs = s.units.filter((x) => x.kind === 'merc');
    // 优先级：每条已开的路至少一座塔 → 雇 2 名 → 每路两座 → 升级 → 雇满 → 灯柱
    const want = [];
    const free = s.foundations.filter((f) => !f.bid && (activeLanes.size === 0 || activeLanes.has(f.lane)));
    free.sort((a, b) => Math.hypot(a.x - BAL.world.cx, a.y - BAL.world.cy) - Math.hypot(b.x - BAL.world.cx, b.y - BAL.world.cy));
    const perLane = (lane) => towers.filter((b) => s.foundations.find((f) => f.id === b.fid)?.lane === lane).length;
    for (const lane of activeLanes) if (perLane(lane) < 1) { const f = free.find((x) => x.lane === lane); if (f) want.push({ t: 'build', f, kind: 'arrow' }); }
    if (mercs.length < 2) want.push({ t: 'hire', key: mercs.length === 0 ? 'dao' : 'nu' });
    for (const lane of activeLanes) if (perLane(lane) < 2) { const f = free.find((x) => x.lane === lane); if (f) want.push({ t: 'build', f, kind: perLane(lane) === 1 ? 'fu' : 'arrow' }); }
    const upg = towers.filter((b) => b.lv < 3 && b.type !== 'wall').sort((a, b) => a.lv - b.lv)[0];
    if (upg) want.push({ t: 'upgrade', b: upg });
    if (mercs.length < BAL.party.maxMercs) want.push({ t: 'hire', key: ['dao', 'nu', 'tong'][mercs.length % 3] });
    if (!towers.some((b) => b.type === 'lamp')) { const f = free[0]; if (f) want.push({ t: 'build', f, kind: 'lamp' }); }
    for (const lane of activeLanes) if (perLane(lane) < 3) { const f = free.find((x) => x.lane === lane); if (f) want.push({ t: 'build', f, kind: 'lei' }); }
    for (const w of want) {
      if (w.t === 'build') {
        const r = s.command({ type: 'build', fid: w.f.id, bld: w.kind });
        if (r.ok) { this.note(`建造 ${w.kind} @${w.f.lane}`); break; }
        if (/远|近|距离/.test(r.reason || '') && !this.goal) { this.goal = { x: w.f.x, y: w.f.y + 60, why: 'build' }; break; }
        if (/铜钱|不够|不足/.test(r.reason || '')) break;
      } else if (w.t === 'hire') {
        const r = s.command({ type: 'hire', key: w.key });
        if (r.ok) { this.note(`雇佣 ${w.key}`); break; }
        if (/铜钱|不够|不足/.test(r.reason || '')) break;
      } else if (w.t === 'upgrade') {
        const r = s.command({ type: 'upgrade', bid: w.b.id });
        if (r.ok) { this.note(`升级 ${w.b.type}→${w.b.lv}`); break; }
        if (/铜钱|不够|不足/.test(r.reason || '')) break;
      }
    }
    if (this.growth) this.spendGrowth();
    this.equipBest();
  }

  // 成长消费：能渡劫就渡劫；铜钱超过储备（留给建筑/雇佣）时给英雄买永久书卷（攻:血 = 2:1）
  spendGrowth() {
    const s = this.sim;
    if (s.command({ type: 'ascendHero' }).ok) this.note('南华渡劫');
    if (!s.shop || s.ctrl !== s.hero || !s.hero.alive) return;
    const reserve = 400 + 40 * s.wave.n;
    this.bookN = this.bookN || 0;
    while (s.copper > reserve + 120) {
      const id = this.bookN % 3 === 2 ? 'tome_hp' : 'tome_atk';
      const price = id === 'tome_hp' ? 110 : 120;
      const n = Math.min(20, Math.floor((s.copper - reserve) / price));
      if (n < 1) break;
      const r = s.command({ type: 'buyBook', itemId: id, count: n });
      if (!r.ok) break;
      this.bookN++;
      this.books = (this.books || 0) + n;
    }
  }

  // 装备：按"主属性分"选择，好的给英雄，次好的给孔明；冗余卖掉
  itemScore(it) { return (it.score ?? it.power ?? ((it.q ?? it.quality ?? 0) + 1) * (it.lv ?? it.ilvl ?? 1)); }

  equipBest() {
    const s = this.sim;
    if (!s.inv) return;
    const bag = s.inv.bag;
    const targets = [s.hero, s.kongming, ...s.units.filter((x) => x.kind === 'beast')];
    for (let i = 0; i < bag.length; i++) {
      const it = bag[i];
      if (!it || !it.slot) continue;
      let placed = false;
      for (const t of targets) {
        const cur = s.inv.equip[t.id]?.[it.slot];
        if (!cur || this.itemScore(it) > this.itemScore(cur) * 1.05 || this.betterSet(t, it, cur)) {
          const r = s.command({ type: 'equip', bagIdx: i, unitId: t.id });
          if (r.ok) { placed = true; this.note(`装备 ${it.name || it.slot} → ${t.name}`); break; }
        }
      }
      if (!placed && bag.filter(Boolean).length > 24) s.command({ type: 'sell', bagIdx: i });
    }
  }

  betterSet(unit, it, cur) {
    if (!it.set || it.set === 'plain') return false;
    const eq = this.sim.inv.equip[unit.id] || {};
    const same = Object.values(eq).filter((x) => x && x.set === it.set).length;
    return same >= 1 && (!cur || cur.set !== it.set) && this.itemScore(it) >= this.itemScore(cur || {}) * 0.7;
  }
}

// 跑一整局：返回结果摘要（不作弊：只用 input/command）
export function runGame(Sim, { seed, heroId, mode = 'story', bot = 'proxy', sigma = 0.05, maxT = 3600, log = false, realms = true, economy = true, growth = false }) {
  const s = new Sim({ seed, heroId, mode, fx: false });
  const b = new PlayerBot(s, { kind: bot, sigma, seed: seed ^ 0x9e3779b9, log, realms, economy, growth });
  const TICK = BAL.tick;
  const waveT = [];
  s.on('waveStart', (w) => waveT.push({ n: w.n, t: s.t, km: Math.round(s.kongming.hp), lv: s.hero.lv }));
  let bossFights = [];
  const bossStart = {};
  s.on('bossSpawn', (e) => { bossStart[e.id] = s.t; });
  s.on('bossKill', (e) => { bossFights.push({ name: e.name, sec: Math.round(s.t - (bossStart[e.id] ?? s.t)), wave: s.wave.n }); });
  while (!s.over && s.t < maxT) { b.step(); s.step(); }
  return {
    seed, heroId, bot, mode, win: !!(s.over && s.over.win), wave: s.wave.n, t: Math.round(s.t), reason: s.over ? s.over.reason : 'timeout',
    lv: s.hero.lv, kills: s.stats.kills, copper: s.stats.copperEarned, buildings: s.buildings.filter((x) => x.alive).length,
    mercs: s.units.filter((x) => x.kind === 'merc').length, beasts: s.units.filter((x) => x.kind === 'beast').map((x) => x.key),
    realms: s.realms ? { ...s.realms.state } : null, quests: s.quests ? s.quests.done : 0, sets: s.activeSets ? s.activeSets() : [],
    kmEquip: s.inv ? Object.values(s.inv.equip[s.kongming.id] || {}).filter(Boolean).length : 0,
    books: b.books || 0, ascend: s.nanhua ? s.nanhua.ascendLv : 0, heroAtk: Math.round(s.hero.stats?.atk || 0), heroHp: s.hero.maxHp,
    dmgBy: s.stats.dmgBy, bossFights, maxEnemies: s.stats.maxEnemies, waveT, events: b.events,
  };
}
