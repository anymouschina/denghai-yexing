// 特效渲染：消费 sim.fx 队列（一次性事件）+ 绘制持续中的短特效（预警圈）。
// 新增特效类型：在 HANDLERS 里加 t: (scene, f) => {}。只对镜头附近的事件出表现（屏外剔除）。
import { sfx } from '../../audio.js';
import {
  spawnSlashVfx,
  spawnBoltVfx,
  spawnRingVfx,
  spawnStarSparks,
} from './vfx.js';

function fxVisible(f, inView) {
  if (f.t === 'banner' || f.global) return true;
  if (f.x !== undefined) return inView(f);
  if (f.x1 !== undefined && f.x2 !== undefined) {
    return inView({ x: f.x1, y: f.y1 })
      || inView({ x: f.x2, y: f.y2 })
      || inView({ x: (f.x1 + f.x2) * 0.5, y: (f.y1 + f.y2) * 0.5 });
  }
  return true;
}

const HANDLERS = {
  dmg(sc, f) {
    if (f.side === 'enemy') {
      const fanX = f.crit ? (Math.random() - 0.5) * 34 : (Math.random() - 0.5) * 12;
      const fanY = f.crit ? -8 - Math.random() * 10 : 0;
      sc.floatText(f.x + fanX, f.y + fanY, f.crit ? `${f.v}!` : `${f.v}`, f.crit ? '#ffd36a' : '#ffffff', f.crit ? 27 : 18);
      if (f.crit) {
        spawnStarSparks(sc, f.x, f.y - 6, {
          count: 5,
          color: 0xffd36a,
          dist: 58,
          dur: 240,
          scale: 0.46,
          priority: 1,
        });
        sc.feel?.feedback('medium', { x: f.x, y: f.y }, {
          trauma: 0.22,
          hitStop: 0.038,
          flash: false,
          particles: 0,
        });
      }
    } else {
      sc.floatText(f.x, f.y, `-${f.v}`, f.km ? '#ff4a3a' : '#ff8a7a', f.km ? 24 : 18);
      if (f.km) {
        sc.feel?.feedback('small', f, { trauma: 0.18, particles: 0 });
      }
    }
    if (f.crit) sfx('crit', 0.6); else if (f.side === 'enemy') sfx('hit', 0.35);
  },
  heal(sc, f) {
    sc.floatText(f.x, f.y, `+${f.v}`, '#5fe08a', 18);
    sc.pHeal?.explode(5, f.x, f.y + 30);
    if (f.v >= 40) {
      spawnStarSparks(sc, f.x, f.y + 8, { count: 3, color: 0x5fe08a, dist: 34, dur: 250, scale: 0.32 });
    }
  },
  coin(sc, f) {
    if (f.v >= 5) sc.floatText(f.x, f.y - 20, `+${f.v} 钱`, '#ffd36a', 15);
    if (f.v >= 30) spawnStarSparks(sc, f.x, f.y - 16, { count: 3, color: 0xffd36a, dist: 30, dur: 220, scale: 0.28 });
  },
  die(sc, f) {
    sc.pPaper?.explode(f.boss ? 40 : f.elite ? 18 : 6, f.x, f.y - 30);
    sc.pSpark?.explode(f.boss ? 40 : 4, f.x, f.y - 30);
    sfx('kill', 0.5);
    if (f.boss) {
      spawnRingVfx(sc, { x: f.x, y: f.y, r: 195, color: 0xffd36a, dur: 0.65, rune: true, awakened: true });
      spawnStarSparks(sc, f.x, f.y - 36, { count: 14, color: 0xffd36a, dist: 140, dur: 440, scale: 0.68, priority: 3 });
      if (sc.feel) {
        sc.feel.feedback('large', f, {
          trauma: 0.88,
          hitStop: 0.12,
          zoom: 0.055,
          flash: { color: 0xffd36a, alpha: 0.24, dur: 170 },
          particles: 0,
        });
      } else {
        sc.cameras.main.shake(400, 0.008);
      }
      sfx('boom');
    } else if (f.elite) {
      spawnRingVfx(sc, { x: f.x, y: f.y, r: 95, color: 0xff9a3c, dur: 0.38 });
      spawnStarSparks(sc, f.x, f.y - 28, { count: 6, color: 0xff9a3c, dist: 72, dur: 290, scale: 0.46, priority: 2 });
      sc.feel?.feedback('medium', f, { trauma: 0.34, hitStop: 0.042, flash: false, particles: 0 });
    }
  },
  boom(sc, f) {
    const r = f.r || 80;
    const col = f.color || 0xff9a3c;
    if (sc.textures.exists('fx_boom') && (!sc.__vfxActive || sc.__vfxActive.length < 156)) {
      const img = sc.add.image(f.x, f.y - 20, 'fx_boom')
        .setDepth(9100).setBlendMode('ADD').setScale(r / 120);
      if (f.color) img.setTint(f.color);
      sc.tweens.add({
        targets: img, scale: img.scale * 1.55, alpha: 0, duration: 380, ease: 'Cubic.easeOut',
        onComplete: () => { if (img.scene) img.destroy(); },
      });
    }
    spawnRingVfx(sc, { x: f.x, y: f.y, r, color: col, dur: f.small ? 0.28 : 0.42, rune: !f.small });
    spawnStarSparks(sc, f.x, f.y - 18, { count: f.small ? 4 : 8, color: col, dist: r * 0.7, dur: 280 });
    if (!f.small) {
      sfx('boom', 0.7);
      if (sc.feel) sc.feel.feedback('medium', f, { trauma: 0.34, hitStop: false, flash: false, particles: 0 });
      else sc.cameras.main.shake(140, 0.003);
    }
  },
  slash(sc, f) {
    spawnSlashVfx(sc, f);
    sfx('dash', 0.25);
  },
  bolt(sc, f) {
    spawnBoltVfx(sc, f);
    sfx('thunder', 0.35);
  },
  ring(sc, f) {
    spawnRingVfx(sc, f);
  },
  warnRing(sc, f) {
    sc.fxItems.push({ k: 'warn', ...f, life: f.dur, max: f.dur });
    if (sc.fxItems.length > 120) sc.fxItems.shift(); // 预警圈上限：超限丢最旧
  },
  charge() {},
  levelup(sc, f) {
    sc.pGold?.explode(30, f.x, f.y - 40);
    sc.floatText(f.x, f.y - 120, '升级！', '#ffd36a', 26);
    spawnRingVfx(sc, { x: f.x, y: f.y, r: 120, color: 0xffd36a, dur: 0.55, rune: true });
    spawnStarSparks(sc, f.x, f.y - 45, { count: 8, color: 0xffd36a, dist: 88, dur: 360, priority: 2 });
    const sp = sc.sprites?.get(f.id);
    if (sp) sc.feel?.popSprite(sp, 1.24, 0.78, 220);
    sc.feel?.feedback('medium', f, {
      trauma: 0.32, hitStop: false, zoom: 0.024, flash: { color: 0xffd36a, alpha: 0.14, dur: 140 }, particles: 0,
    });
    sfx('levelup');
  },
  down(sc, f) {
    sc.pSpark?.explode(14, f.x, f.y - 30);
    spawnRingVfx(sc, { x: f.x, y: f.y, r: 78, color: 0xff5a4a, dur: 0.38 });
    sc.feel?.feedback('medium', f, { trauma: 0.38, hitStop: false, flash: { color: 0xff4a3a, alpha: 0.16, dur: 120 }, particles: 0 });
    sfx('hurt', 0.6);
  },
  respawn(sc, f) {
    sc.pGold?.explode(16, f.x, f.y - 30);
    spawnRingVfx(sc, { x: f.x, y: f.y, r: 95, color: 0x7fe3ff, dur: 0.5, rune: true });
  },
  kmDie(sc, f) {
    sc.pSpark?.explode(60, f.x, f.y - 60);
    spawnRingVfx(sc, { x: f.x, y: f.y, r: 220, color: 0xff4a3a, dur: 0.7, rune: true });
    sfx('death');
    if (sc.feel) {
      sc.feel.feedback('large', f, {
        trauma: 0.95, hitStop: 0.12, zoom: -0.04, flash: { color: 0xff3020, alpha: 0.28, dur: 220 }, particles: 0,
      });
    } else {
      sc.cameras.main.shake(500, 0.01);
    }
  },
  text(sc, f) { sc.floatText(f.x, f.y, f.text, f.color || '#ffffff', f.size || 22); },
  banner(sc, f) { if (sc.hud) sc.hud.banner(f.text, f.color, f.big); },
  sfx(sc, f) { sfx(f.name, f.vol || 1); },
};

export function registerFx(type, fn) { HANDLERS[type] = fn; }

export function drawFx(sc, s, dt, inView) {
  const q = s.fx;
  for (let i = 0; i < q.length; i++) {
    const f = q[i];
    const h = HANDLERS[f.t];
    if (!h) continue;
    if (!fxVisible(f, inView)) continue;
    h(sc, f);
  }
  q.length = 0;
  const g = sc.fxG.clear();
  for (let i = sc.fxItems.length - 1; i >= 0; i--) {
    const it = sc.fxItems[i];
    it.life -= dt;
    if (it.life <= 0) { sc.fxItems.splice(i, 1); continue; }
    const k = it.life / it.max;
    if (it.k === 'warn') {
      g.fillStyle(0xe0463a, 0.18 + (1 - k) * 0.25).fillEllipse(it.x, it.y, it.r * 2 * (1 - k), it.r * (1 - k));
      g.lineStyle(3, 0xff5a4a, 0.85).strokeEllipse(it.x, it.y, it.r * 2, it.r);
    }
  }
}
