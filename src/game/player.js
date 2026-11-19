// 主角：移动、奔跑动画、冲刺残影、受伤、无敌帧、死亡
// 以 Object.assign 混入 Game.prototype，方法里的 this 即 Game 场景
import Phaser from 'phaser';
import { BAL } from './shared.js';
import { sfx } from '../audio.js';
import { touch } from '../touch.js';

export const playerMethods = {
  updatePlayer(dt) {
    if (import.meta.env.VITE_PROBE) window.__g = this; // 仅自动化测试构建（VITE_PROBE=1）暴露场景，正式构建会被剔除
    const k = this.keys;
    const p = this.p;
    const P = BAL.player;
    let mx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let my = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    let len = Math.hypot(mx, my);
    let analog = 1;
    if (len > 0) { mx /= len; my /= len; } else if (touch.mag > 0) {
      // 触屏摇杆：方向 + 力度（已含死区与加速曲线）；键盘有输入时以键盘为准
      mx = touch.mx; my = touch.my; len = 1; analog = touch.mag;
    }
    p.moving = len > 0;
    if (mx !== 0) p.faceX = mx > 0 ? 1 : -1;

    p.dashCdLeft = Math.max(0, p.dashCdLeft - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.dashInv = Math.max(0, p.dashInv - dt);
    const tDash = touch.consumeDash();
    if ((Phaser.Input.Keyboard.JustDown(k.SPACE) || Phaser.Input.Keyboard.JustDown(k.SHIFT) || tDash) && p.dashCdLeft <= 0) {
      const dx = p.moving ? mx : p.faceX;
      const dy = p.moving ? my : 0;
      p.dashT = P.dashTime;
      p.dashInv = P.dashInvuln + (touch.enabled ? BAL.touch.dashInvulnAdd : 0);
      p.dashCdLeft = p.stats.dashCd;
      p.dashDir = [dx, dy];
      p.ghostT = 0;
      sfx('dash');
      this.cameras.main.shake(90, P.shakeDash);
      this.ringFx(p.x, p.y - 6, 46, 0x7fe3ff);
    }
    let sp = p.stats.speed * (p.dashT > 0 ? 1 : analog);
    if (p.dashT > 0) {
      p.dashT -= dt;
      mx = p.dashDir[0];
      my = p.dashDir[1];
      sp *= P.dashSpeed;
      p.ghostT -= dt;
      if (p.ghostT <= 0) { p.ghostT = P.ghostEvery; this.spawnGhost(); }
      this.pDash.emitParticleAt(p.x, p.y - 30, 1);
    }
    p.x = Phaser.Math.Clamp(p.x + mx * sp * dt, this.walk.x0, this.walk.x1);
    p.y = Phaser.Math.Clamp(p.y + my * sp * dt, this.walk.y0, this.walk.y1);

    // 奔跑序列帧画的是朝右跑：朝左时水平翻转
    const spr = this.player;
    spr.setPosition(p.x, p.y);
    spr.setFlipX(p.faceX < 0);
    if (p.moving || p.dashT > 0) {
      if (spr.anims.isPaused) spr.anims.resume();
      if (!spr.anims.isPlaying) spr.anims.play('run');
      // 帧率随移速变化，草履叠高后脚步不打滑
      spr.anims.timeScale = (sp / P.speed) * (p.dashT > 0 ? 0.6 : 1);
      spr.setRotation(Math.sin(this.t * 18) * 0.04 + mx * 0.06);
      spr.setScale(P.scale);
    } else {
      if (spr.anims.isPlaying) { spr.anims.stop(); spr.setFrame(P.idleFrame); }
      spr.setRotation(0);
      spr.setScale(P.scale, P.scale * (1 + Math.sin(this.t * 4) * 0.025));
    }
    spr.setDepth(p.y);
    // 无敌帧：受伤后闪烁；冲刺无敌时半透
    spr.setAlpha(p.invuln > 0 ? (Math.floor(this.t * 20) % 2 ? 0.3 : 1) : (p.dashInv > 0 ? 0.75 : 1));
    this.lightPool.setPosition(p.x, p.y - 20).setAlpha(0.26 + Math.sin(this.t * 3.1) * 0.03);
  },

  // 冲刺残影：复制当前帧，染青色、加色混合，原地淡出
  spawnGhost() {
    const P = BAL.player;
    const spr = this.player;
    if (!this.ghostPool) this.ghostPool = [];
    let g = this.ghostPool.pop();
    if (!g) g = this.add.image(0, 0, 'hero_run', 0).setOrigin(0.5, 0.92).setBlendMode('ADD');
    g.setTexture('hero_run', spr.frame.name).setPosition(spr.x, spr.y).setFlipX(spr.flipX).setRotation(spr.rotation)
      .setScale(spr.scaleX, spr.scaleY).setDepth(spr.depth - 1).setTintFill(0x7fe3ff).setAlpha(P.ghostAlpha).setVisible(true);
    this.tweens.add({
      targets: g, alpha: 0, scaleX: spr.scaleX * 1.06, scaleY: spr.scaleY * 1.06, duration: P.ghostLife * 1000, ease: 'Quad.easeOut',
      onComplete: () => { g.setVisible(false); this.ghostPool.push(g); },
    });
  },

  hurtPlayer(dmg, fromX, fromY) {
    const p = this.p;
    const P = BAL.player;
    if (this.over || p.invuln > 0 || p.dashInv > 0) return;
    // 触屏难度校准：摇杆+触屏技能比键鼠粗，伤害降一档、受击无敌帧延长
    if (touch.enabled) dmg *= BAL.touch.dmgMul;
    p.hp -= dmg;
    p.invuln = P.invuln + (touch.enabled ? BAL.touch.invulnAdd : 0);
    sfx('hurt');
    this.cameras.main.shake(160, P.shakeHurt);
    this.player.setTintFill(0xff5050);
    this.time.delayedCall(90, () => { if (this.player.active) this.player.clearTint(); });
    this.floatText(p.x, p.y - 80, `-${Math.round(dmg)}`, '#ff6a5a', 26);
    if (fromX !== undefined) {
      const a = Math.atan2(p.y - fromY, p.x - fromX);
      p.x = Phaser.Math.Clamp(p.x + Math.cos(a) * P.hurtPush, this.walk.x0, this.walk.x1);
      p.y = Phaser.Math.Clamp(p.y + Math.sin(a) * P.hurtPush, this.walk.y0, this.walk.y1);
    }
    this.ui.flashHurt();
    if (p.hp <= 0) {
      if (p.revive > 0) {
        p.revive--;
        p.hp = Math.round(p.maxHp * 0.5);
        p.invuln = 2;
        this.shockwave(p.x, p.y, 320, 9999, 0xffd36a);
        this.ui.banner('还魂符 · 复活', '#ffd36a');
        sfx('levelup');
      } else {
        this.die();
      }
    }
  },

  // 死亡：慢动作 + 镜头推近 + 灯灭，随后进入结算
  die() {
    const P = BAL.player;
    this.over = true;
    this.p.hp = 0;
    this.hitStop = 0;
    sfx('death');
    this.slowmo = P.deathSlowmo;
    const cam = this.cameras.main;
    cam.shake(400, P.shakeDeath);
    cam.zoomTo(P.deathZoom, P.deathDelay * 1000, 'Cubic.easeOut');
    this.player.clearTint().setAlpha(1);
    this.player.anims.stop();
    this.pSpark.explode(30, this.p.x, this.p.y - 40);
    this.pPaper.explode(16, this.p.x, this.p.y - 50);
    this.tweens.add({ targets: this.lightPool, alpha: 0, scaleX: 2, scaleY: 1.6, duration: P.deathDelay * 1000, ease: 'Quad.easeIn' });
    this.tweens.add({ targets: this.player, alpha: 0.15, angle: this.p.faceX < 0 ? -90 : 90, y: this.player.y + 6, duration: P.deathDelay * 1000, ease: 'Quad.easeIn' });
    this.time.delayedCall(P.deathDelay * 1000, () => this.endRun(false));
  },
};
