// 战斗：伤害结算、暴击、灼烧、击杀与掉落、三种武器与进化形态
// 以 Object.assign 混入 Game.prototype，方法里的 this 即 Game 场景
import { BAL, EVOS, TAU } from './shared.js';
import { sfx } from '../audio.js';

export const combatMethods = {
  damage(e, base, weapon, o = {}) {
    if (!e.alive) return;
    const s = this.p.stats;
    let dmg = base * (weapon === 'burn' || weapon === 'blast' ? 1 : s.dmgMul);
    let crit = false;
    if (!o.noCrit && (o.forceCrit || this.rng() < s.crit)) { crit = true; dmg *= s.critMul; }
    // 联动：被灼烧的妖物受雷伤 +30%（雷引）
    const synergy = weapon === 'lei' && e.burnT > 0 && this.lv('leiyin') > 0;
    if (synergy) dmg *= 1 + BAL.lei.burnBonus;
    e.hp -= dmg;
    const key = weapon === 'burn' ? (this.evo.huanhuo ? 'huanhuo' : this.lv('huanhuo') ? 'huanhuo' : 'fu') : weapon === 'mark' ? 'fu' : weapon;
    this.dmgBy[key] = (this.dmgBy[key] || 0) + dmg;
    if (!o.noFlash) { e.setTintFill(0xffffff); e.flash = 0.08; }
    if (o.kx !== undefined && !e.boss) {
      const l = Math.hypot(o.kx, o.ky) || 1;
      const kb = (o.kb || BAL.knockback) * (e.elite ? 0.15 : e.def.knock);
      e.kvx += (o.kx / l) * kb;
      e.kvy += (o.ky / l) * kb;
    }
    this.floatText(e.x + (this.rng() - 0.5) * 20, e.y - e.displayHeight * 0.75, crit ? `${Math.round(dmg)}!` : `${Math.round(dmg)}`,
      crit ? '#ffc977' : synergy ? '#c9a6ff' : o.color || '#ffffff', crit ? 32 : o.size || 22);
    if (synergy) this.pSpark.explode(4, e.x, e.y - e.displayHeight * 0.5);
    if (crit) {
      sfx('crit');
      this.hitStopFx(BAL.player.hitStopCrit);
    } else if (!o.noFlash) sfx('hit', 0.7);
    if (weapon !== 'burn' && weapon !== 'huanhuo' && s.ignite > 0 && this.rng() < s.ignite) this.ignite(e);
    if (e.hp <= 0) this.kill(e, weapon);
  },

  // 顿帧：限频，避免五雷正法这类高频暴击把画面卡成幻灯片
  hitStopFx(ms, force) {
    const P = BAL.player;
    if (this.over) return;
    if (!force && this.time.now - (this.lastStopAt || 0) < P.hitStopGap * 1000) return;
    this.hitStop = Math.max(this.hitStop, ms);
    this.lastStopAt = this.time.now;
  },

  // 轻震屏：已有更强的震动在进行时不打断
  lightShake(ms, amt) {
    const cam = this.cameras.main;
    if (cam.shakeEffect.isRunning && cam.shakeEffect.intensity.x > amt) return;
    cam.shake(ms, amt);
  },

  ignite(e) {
    if (this.p.stats.burnDps <= 0) return;
    if (e.burnT <= 0) e.burnTick = BAL.burn.tick;
    e.burnT = BAL.burn.time;
    e.burnDps = this.p.stats.burnDps;
  },

  kill(e, weapon) {
    if (!e.alive) return;
    e.alive = false;
    this.kills++;
    const fx = e.boss ? 'spark' : e.def.fx;
    const em = fx === 'paper' ? this.pPaper : fx === 'wisp' ? this.pWisp : this.pSpark;
    em.explode(e.boss ? 80 : e.elite ? 40 : 12, e.x, e.y - e.displayHeight * 0.45);
    sfx('kill', 0.8);
    e.markT = 0;
    if (e.boss || e.elite) {
      this.hitStopFx(BAL.player.hitStopKill, true);
      this.cameras.main.shake(400, BAL.player.shakeBig);
      this.pGold.explode(50, e.x, e.y - 60);
      this.boomFx(e.x, e.y - 40, 1.6);
      sfx('boom');
    }
    // 掉落
    if (e.elite) this.spawnPickup('chest', e.x, e.y, 1);
    if (e.xpv > 0) {
      if (e.elite) for (let i = 0; i < 8; i++) this.spawnPickup('soul', e.x + (this.rng() - 0.5) * 80, e.y + (this.rng() - 0.5) * 60, Math.ceil(e.xpv / 8));
      else this.spawnPickup('soul', e.x, e.y, e.xpv);
    }
    const r = this.rng();
    if (r < BAL.drops.oil) this.spawnPickup('oil', e.x + 10, e.y, 1);
    else if (r < BAL.drops.oil + this.p.stats.coinChance) this.spawnPickup('coin', e.x - 10, e.y, 1 + Math.floor(this.t / 120));
    // 死亡动画
    const startScale = e.scaleX;
    this.tweens.add({
      targets: e, alpha: 0, scaleX: startScale * 1.3, scaleY: e.scaleY * 0.4, duration: e.boss ? 1200 : 180, ease: 'Quad.easeIn',
      onComplete: () => this.releaseEnemy(e),
    });
    if (e === this.boss) {
      this.ui.hideBoss();
      this.slowmo = 0.3;
      this.time.delayedCall(450, () => this.endRun(true));
    }
  },

  updateWeapons(dt) {
    const p = this.p;
    const s = p.stats;
    const W = this.wTimers;
    this.drawMarks();
    // 驱邪符
    if (this.lv('fu')) {
      W.fu -= dt;
      const st = this.wstat('fu');
      if (W.fu <= 0) {
        const tgt = this.nearestEnemy(p.x, p.y - 30, BAL.fu.range);
        if (tgt) {
          W.fu = st.cd * s.fuCdMul;
          const n = st.count + s.fuCount;
          const base = Math.atan2(tgt.y - tgt.displayHeight * 0.4 - (p.y - 40), tgt.x - p.x);
          for (let i = 0; i < n; i++) this.fireTalisman(base + (i - (n - 1) / 2) * BAL.fu.spread, st);
          sfx('shoot');
        } else W.fu = 0.1;
      }
      if (this.evo.fu) {
        W.fuRing -= dt;
        const ev = EVOS.fu.stats;
        if (W.fuRing <= 0) {
          W.fuRing = ev.ringCd * s.fuCdMul;
          for (let i = 0; i < ev.ringCount; i++) this.fireTalisman((i / ev.ringCount) * TAU + this.t, st);
          this.ringFx(p.x, p.y - 40, 90, 0xffd36a);
          sfx('shoot', 0.8);
        }
      }
    }
    // 灯火环
    if (this.orbs.length) {
      const st = this.evo.huanhuo ? EVOS.huanhuo.stats : this.wstat('huanhuo');
      const radius = st.radius * s.orbRadiusMul;
      this.orbAngle += BAL.huanhuo.spin * s.orbSpinMul * dt;
      const n = this.orbs.length;
      if (this.evo.huanhuo) W.trail -= dt;
      for (let i = 0; i < n; i++) {
        const o = this.orbs[i];
        const a = this.orbAngle + (i / n) * TAU;
        o.x = p.x + Math.cos(a) * radius;
        o.y = p.y - 30 + Math.sin(a) * radius * 0.8;
        o.setScale(0.5 + Math.sin(this.t * 14 + i) * 0.05);
        o.setDepth(o.y + 30);
        o.glow.setPosition(o.x, o.y);
        this.query(o.x, o.y + 20, 60, (e) => {
          if (this.time.now - e.orbHit < BAL.huanhuo.hitInterval * 1000) return;
          if (Math.hypot(e.x - o.x, e.y - e.displayHeight * 0.4 - o.y) > e.r + 26) return;
          e.orbHit = this.time.now;
          if (e.markT > 0) this.detonateMark(e);
          if (!e.alive) return;
          this.damage(e, st.dmg, 'huanhuo', { kx: e.x - p.x, ky: e.y - p.y, kb: BAL.huanhuo.knock });
          if (e.alive && this.lv('zhuohun')) this.ignite(e);
        });
        if (this.evo.huanhuo && W.trail <= 0) this.trails.push({ x: o.x, y: o.y + 20, life: EVOS.huanhuo.stats.trailLife, tick: 0 });
      }
      if (this.evo.huanhuo && W.trail <= 0) W.trail = EVOS.huanhuo.stats.trailEvery;
    }
    // 火路
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      tr.life -= dt;
      if (tr.life <= 0) { this.trails.splice(i, 1); continue; }
      tr.tick -= dt;
      if (tr.tick <= 0) {
        tr.tick = 0.5;
        this.query(tr.x, tr.y, 40 + 30, (e) => {
          if (Math.hypot(e.x - tr.x, e.y - tr.y) >= 30 + e.r) return;
          // 灯火碰到符印：提前引爆
          if (e.markT > 0) this.detonateMark(e);
          if (!e.alive) return;
          this.damage(e, EVOS.huanhuo.stats.trailDmg, 'huanhuo', { noFlash: true, noCrit: true, color: '#ff9a3c', size: 16 });
          if (e.alive && this.lv('zhuohun')) this.ignite(e);
        });
      }
    }
    // 掌心雷
    if (this.lv('lei')) {
      W.lei -= dt;
      if (W.lei <= 0) {
        const st = this.wstat('lei');
        const ev = this.evo.lei ? EVOS.lei.stats : null;
        const cands = [];
        this.query(p.x, p.y, BAL.lei.range, (e) => { if (Math.hypot(e.x - p.x, e.y - p.y) < BAL.lei.range) cands.push(e); });
        if (cands.length) {
          W.lei = ev ? ev.cd : st.cd;
          const strikes = ev ? ev.strikes : st.strikes;
          const chain = st.chain + s.chainBonus + (ev ? ev.chainBonus : 0);
          const hitSet = new Set();
          for (let k = 0; k < strikes && cands.length; k++) {
            const idx = Math.floor(this.rng() * cands.length);
            const tgt = cands.splice(idx, 1)[0];
            this.time.delayedCall(k * BAL.lei.strikeGap * 1000, () => { if (!this.over) this.thunder(tgt, st.dmg, chain, hitSet, !!ev); });
          }
        } else W.lei = 0.2;
      }
    }
  },

  fireTalisman(angle, st) {
    const p = this.p;
    let b = this.bPool.pop();
    if (!b) b = this.add.image(0, 0, 'proj_talisman').setScale(0.48);
    const sp = BAL.fu.speed * p.stats.fuSpeedMul;
    b.setPosition(p.x, p.y - 40).setVisible(true).setRotation(angle).setDepth(8000);
    Object.assign(b, {
      vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp, life: BAL.fu.life, dmg: st.dmg,
      pierce: st.pierce + (this.evo.fu ? EVOS.fu.stats.pierceBonus : 0), hits: new Set(), mark: !!this.evo.fu,
    });
    this.bullets.push(b);
  },

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead) {
        this.query(b.x, b.y, 70, (e) => {
          if (b.hits.has(e.uid)) return;
          const cy = e.y - e.displayHeight * 0.45;
          if (Math.abs(e.x - b.x) > e.r + 16 || Math.abs(cy - b.y) > e.displayHeight * 0.5 + 6) return;
          b.hits.add(e.uid);
          if (b.mark && !(e.markT > 0)) { e.markT = EVOS.fu.stats.markDelay; e.markDmg = b.dmg; }
          this.damage(e, b.dmg, 'fu', { kx: b.vx, ky: b.vy });
          this.pSpark.explode(3, b.x, b.y);
          b.pierce--;
          if (b.pierce < 0) { dead = true; return false; }
          return undefined;
        });
      }
      if (dead) {
        b.setVisible(false);
        this.bullets.splice(i, 1);
        this.bPool.push(b);
      }
    }
  },

  detonateMark(e) {
    const ev = EVOS.fu.stats;
    const dmg = (e.markDmg || 10) * ev.markRatio;
    e.markT = 0;
    const x = e.x;
    const y = e.y - e.displayHeight * 0.4;
    this.ringFx(x, y, ev.markRadius, 0xffd36a);
    this.pGold.explode(8, x, y);
    sfx('boom', 0.35);
    const hits = [];
    this.query(x, y + 40, ev.markRadius + 80, (o) => {
      if (Math.hypot(o.x - x, o.y - o.displayHeight * 0.4 - y) < ev.markRadius + o.r) hits.push(o);
    });
    for (const o of hits) this.damage(o, dmg, 'mark', { noCrit: true, color: '#ffd36a', size: 18, kx: o.x - x, ky: o.y - y, kb: BAL.knockback * 0.6 });
  },

  thunder(tgt, dmg, chain, hitSet, evo) {
    if (!tgt.alive) return;
    const fx = this.getFx('fx_thunder');
    fx.setPosition(tgt.x, tgt.y + 6).setOrigin(0.5, 1).setScale(0.95).setAlpha(1).setDepth(8800).setBlendMode('ADD');
    this.tweens.add({ targets: fx, alpha: 0, scaleX: 0.5, duration: 260, onComplete: () => this.freeFx(fx) });
    this.pWisp.explode(8, tgt.x, tgt.y);
    sfx('thunder', 0.7);
    this.lightShake(70, BAL.player.shakeLight);
    hitSet.add(tgt.uid);
    this.damage(tgt, dmg, 'lei', { forceCrit: evo, kx: tgt.x - this.p.x, ky: tgt.y - this.p.y, kb: BAL.lei.knock });
    let from = tgt;
    let d = dmg;
    for (let c = 0; c < chain; c++) {
      let next = null;
      let bd = BAL.lei.chainRange ** 2;
      this.query(from.x, from.y, BAL.lei.chainRange, (e) => {
        if (hitSet.has(e.uid)) return;
        const dd = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
        if (dd < bd) { bd = dd; next = e; }
      });
      if (!next) break;
      hitSet.add(next.uid);
      d *= BAL.lei.chainRatio;
      this.bolts.push({ x1: from.x, y1: from.y - 40, x2: next.x, y2: next.y - 40, life: 0.18, seed: this.rng() });
      this.damage(next, d, 'lei', { forceCrit: evo });
      from = next;
    }
  },

  // 符印：头顶金色符圈，外圈弧线显示引爆倒计时
  drawMarks() {
    if (!this.markG) {
      this.markG = this.add.graphics().setDepth(8900).setBlendMode('ADD');
      this.events.once('shutdown', () => { this.markG = null; this.ghostPool = null; });
    }
    const g = this.markG.clear();
    if (!this.evo.fu) return;
    const delay = EVOS.fu.stats.markDelay;
    for (const e of this.enemies) {
      if (!e.alive || !(e.markT > 0)) continue;
      const x = e.x;
      const y = e.y - e.displayHeight * 0.45;
      const r = 16 + e.r * 0.4;
      const k = 1 - e.markT / delay;
      g.lineStyle(2, 0xffd36a, 0.55).strokeCircle(x, y, r);
      g.lineStyle(4, 0xffe9a8, 0.95).beginPath().arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + k * TAU).strokePath();
      g.fillStyle(0xffd36a, 0.5 + k * 0.4).fillRect(x - 4, y - 7, 8, 14);
    }
  },

  syncOrbs() {
    const want = this.evo.huanhuo ? EVOS.huanhuo.stats.orbs : this.lv('huanhuo') ? this.wstat('huanhuo').orbs : 0;
    while (this.orbs && this.orbs.length < want) {
      const glow = this.add.image(0, 0, 'glow').setTint(0xff8a30).setBlendMode('ADD').setScale(1.4).setAlpha(0.8).setDepth(8500);
      const o = this.add.image(this.p.x, this.p.y, 'proj_flame').setScale(0.5);
      o.glow = glow;
      this.orbs.push(o);
    }
  },
};
