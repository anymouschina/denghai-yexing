// 妖物：刷怪波次、事件（精英/Boss）、各 AI、敌弹、预警圈、冲击波
// 以 Object.assign 混入 Game.prototype，方法里的 this 即 Game 场景
import Phaser from 'phaser';
import { UP, EN, WV, BAL, META, UPS, EVOS, CELL, TAU, FX_TINT } from './shared.js';
import { loadSave, writeSave } from '../save.js';
import { sfx, music } from '../audio.js';
import { touch } from '../touch.js';

const BOSS_AT = (WV.events.find((ev) => ev.kind === 'boss') || { at: Infinity }).at;

export const enemiesMethods = {
  updateSpawns(dt) {
    const min = this.t / 60;
    while (this.eventIdx < WV.events.length && this.t >= WV.events[this.eventIdx].at) {
      this.fireEvent(WV.events[this.eventIdx]);
      this.eventIdx++;
    }
    // Boss 登场后停止刷普通妖物（只剩 Boss 自己召唤的纸扎人）
    if (this.boss || this.t >= BOSS_AT) return;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(WV.minInterval, WV.baseInterval * Math.pow(WV.intervalMulPerMin, min)) * (touch.enabled ? BAL.touch.spawnIntervalMul : 1);
      const batch = 1 + Math.floor(min * WV.batchPerMin);
      const pool = [...WV.pools].reverse().find((pl) => this.t >= pl.from).weights;
      for (let i = 0; i < batch && this.enemies.length < this.maxEn; i++) this.spawnEnemy(this.pickWeighted(pool));
    }
    if (this.t >= WV.packs.from) {
      this.packT -= dt;
      if (this.packT <= 0) {
        this.packT = WV.packs.every;
        const [a, b] = WV.packs.size;
        const n = a + Math.floor(this.rng() * (b - a + 1)) + Math.floor(min);
        const ang = this.rng() * TAU;
        for (let i = 0; i < n && this.enemies.length < this.maxEn; i++) {
          this.spawnEnemy(WV.packs.type, ang + (this.rng() - 0.5) * 0.4, WV.spawnDist + this.rng() * 80);
        }
      }
    }
  },

  pickWeighted(weights) {
    const entries = Object.entries(weights);
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.rng() * total;
    for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
    return entries[0][0];
  },

  fireEvent(ev) {
    if (ev.kind === 'banner') this.ui.banner(ev.text, '#ffc977');
    else if (ev.kind === 'elite') {
      this.ui.banner(`${ev.text} 来袭`, '#ff7a6a');
      sfx('roar', 0.6);
      this.spawnEnemy(ev.type, undefined, undefined, { elite: true });
    } else if (ev.kind === 'boss') {
      this.ui.banner(ev.text, '#ff7a6a', true);
      sfx('roar');
      this.cameras.main.shake(700, 0.006);
      music.play('boss');
      this.spawnEnemy('boss', undefined, 620, { boss: true });
      // 场上的普通妖物在 Boss 降临时退散成纸灰，让出决战空间
      for (const o of this.enemies) {
        if (!o.alive || o.boss || o.elite) continue;
        if (Math.hypot(o.x - this.p.x, o.y - this.p.y) > 260) {
          o.alive = false;
          this.pPaper.explode(4, o.x, o.y - 30);
          this.tweens.add({ targets: o, alpha: 0, duration: 500, onComplete: () => this.releaseEnemy(o) });
        }
      }
    }
  },

  spawnPoint(angle, dist) {
    for (let i = 0; i < 6; i++) {
      const a = angle !== undefined && i === 0 ? angle : this.rng() * TAU;
      const x = Phaser.Math.Clamp(this.p.x + Math.cos(a) * dist, this.walk.x0 - 60, this.walk.x1 + 60);
      const y = Phaser.Math.Clamp(this.p.y + Math.sin(a) * dist, this.walk.y0 - 60, this.walk.y1 + 60);
      if ((x - this.p.x) ** 2 + (y - this.p.y) ** 2 > 520 * 520 || i === 5) return [x, y];
    }
    return [this.p.x + dist, this.p.y];
  },

  spawnEnemy(type, angle, dist = WV.spawnDist, opts = {}) {
    const isBoss = !!opts.boss;
    const def = isBoss ? EN.boss : EN[type];
    const el = opts.elite ? EN.elites[type] : null;
    const [x, y] = this.spawnPoint(angle, dist);
    let e = this.ePool.pop();
    if (!e) e = this.add.sprite(0, 0, def.tex);
    // Boss / 跳尸王用序列帧图，其余用静态立绘（池里的精灵可能还在播放上一只的动画，先停）
    const sheet = (el && el.sheet) || (isBoss && def.sheet) || null;
    e.anims.stop();
    if (sheet && this.textures.exists(sheet)) {
      e.setTexture(sheet, 0);
      if (!(el && el.sheetDriven)) e.play({ key: sheet, startFrame: (this.rng() * 8) | 0 });
    } else e.setTexture(def.tex);
    e.setPosition(x, y).setVisible(true).setActive(true).setAlpha(1).clearTint().setRotation(0).setOrigin(0.5, 0.95);
    if (e.preFX) e.preFX.clear();
    const hpMul = Math.pow(WV.hpMulPerMin, this.t / 60);
    const scaleMul = el ? el.scale : 1;
    const usingSheet = !!sheet && this.textures.exists(sheet);
    e.base = (def.h / e.height) * scaleMul * (usingSheet ? ((el || def).sheetScale || 1) : 1);
    e.setScale(e.base);
    Object.assign(e, {
      uid: ++this.uid, type, def, el, alive: true, boss: isBoss, elite: !!el,
      hp: isBoss ? def.hp : el ? el.hp : def.hp * hpMul,
      speed: (el ? el.speed : def.speed) * (0.9 + this.rng() * 0.2),
      dmg: el ? el.dmg : def.dmg,
      xpv: el ? el.xp : def.xp,
      r: def.r * scaleMul,
      kvx: 0, kvy: 0, flash: 0, burnT: 0, burnTick: 0, orbHit: 0, trailHit: 0, contactCd: 0,
      phase: this.rng() * TAU, state: 'move', timer: 0, hopT: this.rng(),
      ai: isBoss ? 'boss' : def.ai,
      shootT: (el ? el.shootCd : def.shootCd || 0) * (0.5 + this.rng() * 0.5),
      slamT: el ? el.slamCd : 0, atkT: isBoss ? 2.5 : 0, atkIdx: 0, summoned: 0,
      sheetDriven: usingSheet && !!(el && el.sheetDriven),
      ringT: el && el.ringCd ? el.ringCd * 0.6 : 0, warnT: 0,
    });
    e.maxHp = e.hp;
    if ((el || isBoss) && e.preFX) e.preFX.addGlow(isBoss ? 0x9a5cff : el.glow, 4, 0, false, 0.1, 12);
    if (isBoss) {
      this.boss = e;
      this.ui.showBoss(def.name);
    } else if (el) {
      this.ui.trackElite(e, el.name);
    }
    this.enemies.push(e);
    return e;
  },

  updateEnemies(dt) {
    const p = this.p;
    const list = this.enemies;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.alive) { list.splice(i, 1); continue; }
      const dx = p.x - e.x;
      const dy = p.y - 20 - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      let vx = 0;
      let vy = 0;
      let squash = 1;
      let lift = 0;

      if (e.burnT > 0) {
        e.burnT -= dt;
        e.burnTick -= dt;
        if (e.burnTick <= 0) {
          e.burnTick = BAL.burn.tick;
          this.damage(e, e.burnDps * BAL.burn.tick, 'burn', { noFlash: true, noCrit: true, color: '#ff9a3c', size: 16 });
          if (!e.alive) continue;
        }
      }
      if (e.markT > 0) {
        e.markT -= dt;
        if (e.markT <= 0) this.detonateMark(e);
        if (!e.alive) continue;
      }

      switch (e.ai) {
        case 'chase':
          vx = ux * e.speed; vy = uy * e.speed;
          break;
        case 'hop': {
          const per = e.def.hopPeriod;
          e.hopT += dt / per;
          const ph = e.hopT % 1;
          if (ph < 0.6) {
            const s = Math.sin((ph / 0.6) * Math.PI);
            vx = ux * e.speed * 2.2 * s; vy = uy * e.speed * 2.2 * s;
            lift = s * 16;
          } else squash = 1 - Math.sin(((ph - 0.6) / 0.4) * Math.PI) * 0.12;
          // 跳尸王序列帧：0 蹲 → 1~3 起跳上升 → 4~6 下落 → 7 落地，与位移相位对齐
          if (e.sheetDriven) {
            e.setFrame(ph < 0.6 ? 1 + Math.min(5, Math.floor((ph / 0.6) * 6)) : ph < 0.8 ? 7 : 0);
            squash = 1 + (squash - 1) * 0.5;
            lift *= 0.6;
          }
          if (e.elite) this.eliteSlam(e, dt, dist);
          break;
        }
        case 'ranged': {
          const keep = e.def.keep;
          const sp = e.speed;
          if (e.state === 'charge') {
            e.timer -= dt;
            squash = 1.15 + Math.sin(this.t * 40) * 0.05;
            e.setTint(0xff6060);
            if (e.timer <= 0) { this.enemyShoot(e, ux, uy); e.state = 'move'; e.clearTint(); }
          } else {
            if (dist > keep + 40) { vx = ux * sp; vy = uy * sp; } else if (dist < keep - 40) { vx = -ux * sp; vy = -uy * sp; } else { vx = -uy * sp * 0.5; vy = ux * sp * 0.5; }
            e.shootT -= dt;
            if (e.el && e.el.ringCd) this.eliteRing(e, dt);
            if (e.shootT <= 0 && dist < 620) {
              e.shootT = e.el ? e.el.shootCd : e.def.shootCd;
              e.state = 'charge';
              e.timer = e.el ? e.el.charge : e.def.charge;
            }
          }
          if (e.warnT > 0) { e.warnT -= dt; squash = 1.12 + Math.sin(this.t * 40) * 0.05; vx *= 0.2; vy *= 0.2; e.setTint(0xff6060); if (e.warnT <= 0 && e.state !== 'charge') e.clearTint(); }
          lift = Math.sin(this.t * 3 + e.phase) * 6;
          break;
        }
        case 'bomber':
          if (e.state === 'fuse') {
            e.timer -= dt;
            squash = 1 + (1 - e.timer / e.def.fuse) * 0.3;
            if (Math.floor(e.timer * 14) % 2) e.setTintFill(0xffffff); else e.setTint(0xff5050);
            if (e.timer <= 0) { this.explodeBomber(e); continue; }
          } else {
            vx = ux * e.speed; vy = uy * e.speed;
            if (dist < e.def.trigger) {
              e.state = 'fuse';
              e.timer = e.def.fuse;
              this.addTele(e.x, e.y, e.def.blastR, e.def.fuse, null, e);
              sfx('warn');
            }
          }
          break;
        case 'boss':
          this.bossAI(e, dt, ux, uy, dist);
          if (e.warnT > 0) { e.warnT -= dt; squash = 1.06 + Math.sin(this.t * 40) * 0.03; e.setTint(0xff6060); if (e.warnT <= 0) e.clearTint(); }
          vx = ux * e.speed * (e.warnT > 0 ? 0.2 : 1); vy = uy * e.speed * (e.warnT > 0 ? 0.2 : 1);
          lift = Math.sin(this.t * 1.6) * 10;
          break;
        default:
          break;
      }

      // 击退衰减 + 同格分离
      e.kvx *= Math.pow(0.0015, dt);
      e.kvy *= Math.pow(0.0015, dt);
      let sx = 0;
      let sy = 0;
      const arr = this.grid.get(((e.x / CELL) | 0) * 4096 + ((e.y / CELL) | 0));
      if (arr && arr.length > 1) {
        for (const o of arr) {
          if (o === e) continue;
          const ox = e.x - o.x;
          const oy = e.y - o.y;
          const d2 = ox * ox + oy * oy;
          const rr = e.r + o.r;
          if (d2 < rr * rr && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (rr - d) / rr;
            sx += (ox / d) * push * 90;
            sy += (oy / d) * push * 90;
          }
        }
      }
      e.x += (vx + e.kvx + sx) * dt;
      e.y += (vy + e.kvy + sy) * dt;
      if (e.boss || e.elite) {
        e.x = Phaser.Math.Clamp(e.x, this.walk.x0 - 40, this.walk.x1 + 40);
        e.y = Phaser.Math.Clamp(e.y, this.walk.y0 - 40, this.walk.y1 + 40);
      }

      // 接触伤害
      e.contactCd -= dt;
      if (!this.over && e.contactCd <= 0 && dist < e.r + BAL.player.radius + 6) {
        this.hurtPlayer(e.dmg, e.x, e.y);
        e.contactCd = 0.5;
      }

      // 画面：朝向、挤压、白闪
      if (Math.abs(vx) > 4) e.setFlipX((vx > 0) !== e.def.faceRight);
      const wob = e.ai === 'hop' ? 1 : 1 + Math.sin(this.t * 9 + e.phase) * 0.05;
      e.setScale(e.base * (2 - squash) * (e.ai === 'hop' ? 1 : 1 / wob), e.base * squash * wob);
      e.liftY = lift;
      e.displayOriginY = e.height * 0.95 + lift / e.scaleY;
      if (e.flash > 0) {
        e.flash -= dt;
        if (e.flash <= 0) {
          e.clearTint();
          if (e.burnT > 0) e.setTint(0xffb080);
        }
      } else if (e.burnT <= 0 && e.state !== 'charge' && e.state !== 'fuse' && !(e.warnT > 0) && e.tintTopLeft !== 0xffffff) e.clearTint();
      e.setDepth(e.y);

      // 离太远的普通妖物回收（重新从前方刷出）
      if (!e.boss && !e.elite && dist > 1500) this.releaseEnemy(e);
    }
  },

  eliteSlam(e, dt, dist) {
    e.slamT -= dt;
    if (e.slamT <= 0 && dist < 420) {
      e.slamT = e.el.slamCd;
      const x = e.x;
      const y = e.y;
      this.addTele(x, y, e.el.slamR, e.el.slamWarn, () => {
        if (!e.alive) return;
        this.shockwave(x, y, e.el.slamR, 0, 0xff7a6a);
        if (Math.hypot(this.p.x - x, this.p.y - y) < e.el.slamR + 10) this.hurtPlayer(e.el.slamDmg, x, y);
      });
    }
  },

  // 破灯笼王额外技能：周期性 0.5s 预警后放一圈鬼火
  eliteRing(e, dt) {
    if (e.warnT > 0) return;
    e.ringT -= dt;
    if (e.ringT > 0) return;
    e.ringT = e.el.ringCd;
    e.warnT = e.el.ringWarn;
    sfx('warn', 0.7);
    this.addTele(e.x, e.y, e.el.ringTeleR, e.el.ringWarn, () => {
      if (!e.alive) return;
      sfx('eshot');
      const n = e.el.ringCount;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + this.t;
        this.spawnEBullet(e.x, e.y - e.displayHeight * 0.5, Math.cos(a) * e.el.bulletSpeed * 0.8, Math.sin(a) * e.el.bulletSpeed * 0.8, e.el.bulletDmg);
      }
    }, e);
  },

  bossAI(e, dt, ux, uy, dist) {
    const B = EN.boss;
    const ph = this.bossPhase ? 1 : 0;
    if (!this.bossPhase && e.hp < e.maxHp * 0.5) {
      this.bossPhase = true;
      this.ui.banner('灯骸老祖 · 灯火尽燃', '#ff7a6a');
      sfx('roar');
      this.cameras.main.shake(600, 0.007);
      e.speed *= 1.3;
      if (e.preFX) { e.preFX.clear(); e.preFX.addGlow(0xff5a2a, 6, 0, false, 0.1, 14); }
    }
    e.atkT -= dt;
    if (e.atkT > 0) return;
    e.atkT = B.cd[ph];
    const move = e.atkIdx++ % 3;
    if (move === 0) {
      // 环形弹幕：先 0.5s 红色蓄力（Boss 泛红 + 脚下预警圈），二阶段双层交错
      const n = B.ringCount[ph];
      const rings = this.bossPhase ? 2 : 1;
      e.warnT = B.ringWarn;
      sfx('warn');
      for (let r = 0; r < rings; r++) {
        this.addTele(e.x, e.y, r === 0 ? B.ringTeleR : 0, B.ringWarn + r * 0.32, () => {
          if (!e.alive) return;
          sfx('eshot');
          const sp = B.ringSpeed * (r === 0 ? 1 : 0.78);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + r * (Math.PI / n) + this.t * 0.3;
            this.spawnEBullet(e.x, e.y - 120, Math.cos(a) * sp, Math.sin(a) * sp, B.bulletDmg);
          }
        }, e);
      }
    } else if (move === 1) {
      for (let i = 0; i < B.slamCount[ph]; i++) {
        const x = this.p.x + (i === 0 ? 0 : (this.rng() - 0.5) * 360);
        const y = this.p.y + (i === 0 ? 0 : (this.rng() - 0.5) * 260);
        this.addTele(x, y, B.slamR, B.slamWarn[ph] + i * 0.12, () => {
          this.shockwave(x, y, B.slamR, 0, 0xb36bff);
          if (Math.hypot(this.p.x - x, this.p.y - y) < B.slamR + 8) this.hurtPlayer(B.slamDmg, x, y);
        });
      }
      sfx('warn');
    } else if (this.enemies.length < B.summonCap) {
      const cnt = B.summon + (this.bossPhase ? 4 : 0);
      for (let i = 0; i < cnt; i++) {
        const a = (i / cnt) * TAU;
        const m = this.spawnEnemy('paperman', 0, 0);
        m.x = e.x + Math.cos(a) * 140;
        m.y = e.y + Math.sin(a) * 100;
        m.setAlpha(0);
        this.tweens.add({ targets: m, alpha: 1, duration: 400 });
      }
      this.pWisp.explode(24, e.x, e.y - 100);
    }
  },

  enemyShoot(e, ux, uy) {
    const s = e.el || e.def;
    const n = e.el ? e.el.fan : 1;
    const base = Math.atan2(uy, ux);
    sfx('eshot');
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * (e.el ? e.el.fanSpread : 0);
      this.spawnEBullet(e.x, e.y - e.displayHeight * 0.5, Math.cos(a) * s.bulletSpeed, Math.sin(a) * s.bulletSpeed, s.bulletDmg);
    }
  },

  explodeBomber(e) {
    const d = e.def;
    this.boomFx(e.x, e.y - 20, 0.85);
    sfx('boom');
    this.cameras.main.shake(180, 0.005);
    if (Math.hypot(this.p.x - e.x, this.p.y - e.y) < d.blastR + 10) this.hurtPlayer(d.blastDmg, e.x, e.y);
    const x = e.x;
    const y = e.y;
    this.kill(e, 'blast');
    this.query(x, y, d.blastR + 30, (o) => {
      if (Math.hypot(o.x - x, o.y - y) < d.blastR + o.r) this.damage(o, d.blastEnemyDmg, 'blast', { kx: o.x - x, ky: o.y - y, noCrit: true });
    });
  },

  releaseEnemy(e) {
    e.alive = false;
    e.markT = 0;
    e.setVisible(false).setActive(false);
    if (!this.ePool.includes(e)) this.ePool.push(e);
  },

  spawnEBullet(x, y, vx, vy, dmg) {
    let b = this.ebPool.pop();
    if (!b) b = this.add.image(0, 0, 'proj_ghostfire').setScale(0.42);
    b.setPosition(x, y).setVisible(true).setDepth(8900);
    Object.assign(b, { vx, vy, life: 5, dmg });
    this.ebullets.push(b);
  },

  updateEnemyBullets(dt) {
    const p = this.p;
    for (let i = this.ebullets.length - 1; i >= 0; i--) {
      const b = this.ebullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rotation += dt * 6;
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && !this.over && Math.hypot(b.x - p.x, b.y - (p.y - 34)) < 26) {
        this.hurtPlayer(b.dmg, b.x, b.y);
        dead = true;
      }
      if (dead) {
        b.setVisible(false);
        this.ebullets.splice(i, 1);
        this.ebPool.push(b);
      }
    }
  },

  addTele(x, y, r, dur, onDone, follow) {
    this.teles.push({ x, y, r, t: 0, dur, onDone, follow });
  },

  updateTeles(dt) {
    for (let i = this.teles.length - 1; i >= 0; i--) {
      const t = this.teles[i];
      t.t += dt;
      if (t.follow) {
        if (!t.follow.alive) { this.teles.splice(i, 1); continue; }
        t.x = t.follow.x;
        t.y = t.follow.y;
      }
      if (t.t >= t.dur) {
        this.teles.splice(i, 1);
        if (t.onDone) t.onDone();
      }
    }
  },

  shockwave(x, y, r, dmgToEnemies, color) {
    this.ringFx(x, y, r, color);
    this.boomFx(x, y - 10, r / 140);
    sfx('boom', 0.8);
    this.cameras.main.shake(200, 0.005);
    if (dmgToEnemies > 0) {
      this.query(x, y, r, (e) => { if (!e.boss) this.damage(e, dmgToEnemies, 'blast', { kx: e.x - x, ky: e.y - y, noCrit: true }); });
    }
  },
};
