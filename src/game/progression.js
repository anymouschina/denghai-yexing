// 成长：掉落拾取与磁吸、经验升级、三选一抽取与应用、宝箱、结算
// 以 Object.assign 混入 Game.prototype，方法里的 this 即 Game 场景
// 卡面描述全部由 upgrades.json 的数值生成（describe），保证“写的数字 = 实际效果”
import { UP, BAL, UPS, EVOS, TAU } from './shared.js';
import { loadSave, writeSave } from '../save.js';
import { sfx } from '../audio.js';

const SCHOOL_WEAPON = Object.fromEntries(UP.list.filter((u) => u.type === 'weapon').map((u) => [u.school, u.id]));
const RARITY =['white', 'blue', 'purple', 'gold'];
const bump = (r) => RARITY[Math.min(2, RARITY.indexOf(r) + 1)]; // 宝箱升一档，但金色只留给进化
const num = (v) => String(Math.round(v * 100) / 100);
const pct = (v) => `${Math.round(v * 100)}%`;
const fmtV = (v, unit) => (unit === 'pct' ? pct(v) : num(v));
const path = (obj, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

// "{key}" 原值，"{key%}" 百分比；key 可带点号读 balance.json（如 {burn.time}）
function fill(tpl, src) {
  return tpl.replace(/\{([\w.]+)(%?)\}/g, (_, k, p) => {
    const v = path(src, k) ?? path(BAL, k);
    return p ? pct(v) : num(v);
  });
}

// 升级 u 从 from 级升到 to 级的卡面描述
export function describe(u, from, to) {
  if (u.type === 'weapon') {
    const s1 = u.stats[to - 1];
    if (from === 0) {
      const parts = Object.entries(u.labels).map(([k, [name, unit]]) => `${name} ${num(s1[k])}${unit}`);
      return `${u.intro}\n${parts.slice(0, 2).join('，')}\n${parts.slice(2).join('，')}`;
    }
    const s0 = u.stats[from - 1];
    const lines = Object.entries(u.labels)
      .filter(([k]) => s0[k] !== s1[k])
      .map(([k, [name, unit]]) => `${name} ${num(s0[k])} → ${num(s1[k])}${unit}`);
    return lines.join('\n');
  }
  const lines = u.lines.map(([k, tpl, unit]) => {
    const a = u.per[k] * from;
    const b = u.per[k] * to;
    const sign = (tpl.match(/([+-])\{v\}/) || [])[1] || '';
    return from === 0 ? tpl.replace('{v}', fmtV(b, unit)) : tpl.replace('{v}', `${fmtV(a, unit)} → ${sign}${fmtV(b, unit)}`);
  });
  if (u.note) lines.push(fill(u.note, u));
  return lines.join('\n');
}

export const progressionMethods = {
  // ---------------- 掉落 ----------------
  spawnPickup(kind, x, y, val) {
    if (kind === 'soul' && (this.gemCount || 0) >= BAL.drops.maxGems) {
      // 超过上限：并入离掉落点最近、还没被吸走的魂晶，数值累加、外观升档
      let best = null;
      let bd = Infinity;
      for (const k of this.pickups) {
        if (k.kind !== 'soul' || k.mag) continue;
        const d = (k.x - x) ** 2 + (k.y - y) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      if (best) {
        best.val += val;
        this.gemLook(best);
        best.setScale(best.sc * 1.35);
        this.tweens.add({ targets: best, scale: best.sc, duration: 180, ease: 'Quad.easeOut' });
        return;
      }
    }
    let k = this.pkPool.pop();
    const tex = { soul: 'drop_soul', coin: 'drop_coin', oil: 'drop_oil', chest: 'drop_chest' }[kind];
    if (!k) k = this.add.image(0, 0, tex);
    this.tweens.killTweensOf(k);
    k.setTexture(tex).setPosition(x, y - 18).setVisible(true).setAlpha(1).setDepth(y - 40).clearTint();
    Object.assign(k, { kind, val, mag: false, spd: 0, sc: { coin: 0.42, oil: 0.62, chest: 0.75 }[kind] || 0.42, bob: this.rng() * TAU, taken: false });
    if (kind === 'soul') { this.gemCount = (this.gemCount || 0) + 1; this.gemLook(k); }
    // 出生弹跳：从 0 弹到目标尺寸（只动 scale，不和磁吸抢坐标）
    k.setScale(0);
    this.tweens.add({ targets: k, scale: k.sc, duration: kind === 'chest' ? 520 : 320, ease: 'Back.easeOut' });
    this.pickups.push(k);
  },

  // 魂晶按数值分档：小蓝 / 大蓝 / 金 / 大金
  gemLook(k) {
    const v = k.val;
    k.sc = v >= 25 ? 0.7 : v >= 10 ? 0.6 : v >= 4 ? 0.52 : 0.42;
    k.setTint(v >= 10 ? 0xffd36a : 0xffffff);
  },

  updatePickups(dt) {
    const p = this.p;
    const B = BAL.player;
    const pr = p.stats.pickup;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      const dx = p.x - k.x;
      const dy = p.y - 30 - k.y;
      const d = Math.hypot(dx, dy) || 1;
      if (!this.over) {
        if (!k.mag && d < pr) {
          // 进入拾取范围：先往外弹一下再被吸回来（经典的“啵”一下）
          k.mag = true;
          k.spd = -BAL.drops.magnetPop;
        }
        if (k.mag) {
          k.spd = Math.min(B.magnetSpeed, k.spd + 1600 * dt);
          k.x += (dx / d) * k.spd * dt;
          k.y += (dy / d) * k.spd * dt;
        } else if (k.kind === 'soul' && d < B.lightPull) {
          // 魂晶被灯光吸引：灯光范围内缓慢漂向主角
          k.x += (dx / d) * B.lightPullSpeed * dt;
          k.y += (dy / d) * B.lightPullSpeed * dt;
        }
        if (d < 22 && k.spd >= 0) { this.pickups.splice(i, 1); this.collect(k); continue; }
      }
      k.bob += dt * 4;
      k.rotation = k.kind === 'soul' ? Math.sin(k.bob) * 0.15 : 0;
    }
    // 宝箱排队打开：同一帧捡到多个也逐个弹出，且优先于升级弹窗
    if (!this.over && !this.modal && this.pendingChest > 0) {
      this.pendingChest--;
      this.openChoice('chest');
    }
  },

  collect(k) {
    if (k.taken) return;
    k.taken = true;
    // 拾取瞬间放大淡出，结束后再回池（回池前不会被复用）
    this.tweens.killTweensOf(k);
    this.tweens.add({
      targets: k, scale: k.sc * 1.8, alpha: 0, duration: 140, ease: 'Quad.easeOut',
      onComplete: () => { k.setVisible(false); this.pkPool.push(k); },
    });
    if (k.kind === 'soul') {
      this.gemCount = Math.max(0, (this.gemCount || 0) - 1);
      sfx('pickup', 0.6);
      if (k.val >= 10) this.floatText(this.p.x, this.p.y - 90, `+${k.val} 魂`, '#7fe3ff', 18);
      this.gainXp(k.val);
    } else if (k.kind === 'coin') {
      sfx('coin');
      this.coins += k.val;
      this.floatText(this.p.x, this.p.y - 90, `+${k.val} 铜钱`, '#ffd36a', 18);
    } else if (k.kind === 'oil') {
      sfx('heal');
      const h = Math.min(BAL.drops.oilHeal, this.p.maxHp - this.p.hp);
      this.p.hp += h;
      this.floatText(this.p.x, this.p.y - 90, `+${Math.round(h)}`, '#7dff9a', 24);
      this.pSpark.explode(10, this.p.x, this.p.y - 40);
    } else if (k.kind === 'chest') {
      sfx('chest');
      this.pGold.explode(40, this.p.x, this.p.y - 40);
      this.cameras.main.flash(180, 255, 210, 120);
      this.pendingChest = (this.pendingChest || 0) + 1;
    }
  },

  gainXp(v) {
    this.xp += v;
    while (this.xp >= this.need) {
      this.xp -= this.need;
      this.level++;
      this.need = this.reqFor(this.level);
      this.pendingLv++;
    }
  },

  // ---------------- 三选一 ----------------
  openLevelUp() {
    this.pendingLv--;
    sfx('levelup');
    this.ringFx(this.p.x, this.p.y - 30, 160, 0x7fe3ff);
    this.pGold.explode(30, this.p.x, this.p.y - 40);
    this.openChoice('level');
  },

  openChoice(kind) {
    this.modal = true;
    const isChest = kind === 'chest';
    const shownTo = this.level - this.pendingLv;
    const info = isChest
      ? { title: '宝 箱 开 启', sub: `精英遗宝 · 已有构筑一次 +${BAL.drops.chestLevels} 级 · 选择一项` }
      : { title: '灯 火 渐 盛', sub: `Lv ${shownTo - 1} → ${shownTo} · 选择一项` };
    this.ui.showChoices(info, this.rollChoices(isChest), this.rerolls, {
      pick: (c) => this.applyChoice(c),
      reroll: () => {
        if (this.rerolls <= 0) return null;
        this.rerolls--;
        return { choices: this.rollChoices(isChest), rerolls: this.rerolls };
      },
    });
    this.scene.pause();
  },

  rollChoices(isChest) {
    const out = [];
    // 1) 满足条件的进化必出、排最前（换一批也不会被刷掉）
    for (const e of UP.evolutions) {
      if (!this.evo[e.weapon] && this.lv(e.weapon) >= UPS[e.weapon].max && this.lv(e.needs) >= 1) {
        out.push({
          kind: 'evo', id: e.id, weapon: e.weapon, icon: e.icon, name: e.name, school: e.school, rarity: 'gold',
          lvText: `${UPS[e.weapon].name} Lv${UPS[e.weapon].max} + ${UPS[e.needs].name} → 进化`, desc: fill(e.desc, e.stats),
        });
      }
    }
    // 2) 未满级的升级按权重无放回抽取（已有的更容易出；宝箱更偏向已有）
    const cand = UP.list.filter((u) => this.lv(u.id) < u.max && !(u.type === 'weapon' && this.evo[u.id]));
    const weights = cand.map((u) => {
      const l = this.lv(u.id);
      let w = u.type === 'weapon' ? (l === 0 ? 1.3 : 1.6) : 1;
      if (l > 0) w *= isChest ? 3 : 1.4;
      // 进化差一步（武器满级缺被动 / 被动有了武器差级）时加权，让目标看得见
      const evoNeed = UP.evolutions.find((e) => e.needs === u.id && !this.evo[e.weapon] && this.lv(e.weapon) >= 3);
      if (evoNeed && l === 0) w *= 2;
      // 专属被动（符/火/雷）在没有对应武器时少出，避免抽到用不上的卡
      if (u.type === 'passive' && SCHOOL_WEAPON[u.school] && !this.lv(SCHOOL_WEAPON[u.school])) w *= 0.4;
      return w;
    });
    const picked = [];
    while (out.length + picked.length < 3 && cand.length) {
      // 宝箱第一张保证是已有构筑的 +2（有的话）：只在已有项里抽
      const ownedOnly = isChest && picked.length === 0 && cand.some((u) => this.lv(u.id) > 0);
      const w = ownedOnly ? weights.map((x, j) => (this.lv(cand[j].id) > 0 ? x : 0)) : weights;
      const total = w.reduce((a, b) => a + b, 0);
      let r = this.rng() * total;
      let idx = 0;
      for (; idx < cand.length - 1; idx++) { r -= w[idx]; if (r <= 0 && w[idx] > 0) break; }
      if (!(w[idx] > 0)) idx = w.findLastIndex((x) => x > 0);
      const u = cand.splice(idx, 1)[0];
      weights.splice(idx, 1);
      const from = this.lv(u.id);
      // 宝箱：已有的直接 +2 级（不超过满级），新拿的 +1 级
      const to = Math.min(u.max, from + (isChest && from > 0 ? BAL.drops.chestLevels : 1));
      let rarity = u.type === 'weapon' && from === 0 ? 'blue' : to >= u.max ? 'purple' : to >= 3 ? 'blue' : 'white';
      if (isChest) rarity = bump(rarity);
      picked.push({
        kind: 'up', id: u.id, icon: u.icon, name: u.name, school: u.school, rarity, from, to,
        lvText: from === 0 ? (u.type === 'weapon' ? '新武器 · Lv 1' : '新被动 · Lv 1') : `Lv ${from} → ${to}${to >= u.max ? '（满级）' : ''}`,
        desc: describe(u, from, to),
      });
    }
    // 宝箱：稀有的排前面
    if (isChest) picked.sort((a, b) => RARITY.indexOf(b.rarity) - RARITY.indexOf(a.rarity));
    out.push(...picked);
    // 3) 构筑快满时用补给卡补足三张
    const D = BAL.drops;
    const fillers = [
      { kind: 'heal', id: 'heal', icon: 'yupei', name: '灯火续命', school: 'gen', rarity: 'white', lvText: '补给', desc: `回复 ${D.fillerHeal} 生命` },
      { kind: 'soul', id: 'soul', icon: 'huanhun', name: '守夜魂火', school: 'gen', rarity: 'white', lvText: '补给', desc: `结算魂火 +${BAL.soul.fillerSoul}` },
      { kind: 'coin', id: 'coin', icon: 'tongqian', name: '铜钱满袋', school: 'gen', rarity: 'white', lvText: '补给', desc: `铜钱 +${D.fillerCoins}\n（每枚结算魂火 +${BAL.soul.perCoin}）` },
    ];
    for (const f of fillers) if (out.length < 3) out.push(f);
    return out.slice(0, 3);
  },

  applyChoice(c) {
    if (c.kind === 'up') {
      const u = UPS[c.id];
      const from = this.lv(c.id);
      const to = Math.min(u.max, c.to || from + 1);
      this.levels[c.id] = to;
      if (u.per && u.per.maxHp) this.p.hp += u.per.maxHp * (to - from);
      if (c.id === 'lei' && from === 0) this.wTimers.lei = 0.3;
    } else if (c.kind === 'evo') {
      this.evo[c.weapon] = true;
      this.cameras.main.flash(300, 255, 220, 140);
      this.ui.banner(`进化 · ${c.name}`, '#ffcf5a', true);
    } else if (c.kind === 'heal') {
      this.p.hp += BAL.drops.fillerHeal;
    } else if (c.kind === 'soul') {
      this.bonusSoul = (this.bonusSoul || 0) + BAL.soul.fillerSoul;
    } else if (c.kind === 'coin') {
      this.coins += BAL.drops.fillerCoins;
    }
    this.recalc();
    this.p.hp = Math.min(this.p.hp, this.p.maxHp);
    this.p.invuln = Math.max(this.p.invuln, 0.5);
    this.modal = false;
    this.scene.resume();
  },

  owned() {
    const list = [];
    for (const u of UP.list) {
      const l = this.lv(u.id);
      if (!l) continue;
      const evo = u.type === 'weapon' && this.evo[u.id];
      list.push({ icon: evo ? EVOS[u.id].icon : u.icon, lv: evo ? '★' : String(l), weapon: u.type === 'weapon', name: evo ? EVOS[u.id].name : u.name });
    }
    return list.sort((a, b) => Number(b.weapon) - Number(a.weapon));
  },

  // ---------------- 结算 ----------------
  // 魂火 = 存活秒数×perSecond + 击杀×perKill + 铜钱×perCoin + 补给卡；胜利 (+Boss 奖励)×winMul；再乘铜钱串加成
  soulPayout(victory) {
    const S = BAL.soul;
    let soul = this.t * S.perSecond + this.kills * S.perKill + this.coins * S.perCoin + (this.bonusSoul || 0);
    if (victory) soul = (soul + S.bossBonus) * S.winMul;
    return Math.round(soul * this.p.stats.soulMul);
  },

  endRun(victory) {
    if (this.ended) return;
    this.ended = true;
    this.over = true;
    const soul = this.soulPayout(victory);
    const save = loadSave();
    save.soul += soul;
    save.best = Math.max(save.best || 0, Math.floor(this.t));
    save.runs += 1;
    if (victory) save.wins += 1;
    writeSave(save);
    let top = 'fu';
    for (const [k, v] of Object.entries(this.dmgBy)) if (k in UPS && v > (this.dmgBy[top] || 0)) top = k;
    const topName = this.evo[top] ? EVOS[top].name : UPS[top] ? UPS[top].name : '驱邪符';
    this.time.delayedCall(victory ? 900 : 700, () => {
      this.slowmo = 0;
      this.ui.showResult({
        victory, time: this.t, level: this.level, kills: this.kills, top: topName, soul, build: this.owned(), seed: this.seed,
      });
      this.scene.pause();
    });
  },
};
