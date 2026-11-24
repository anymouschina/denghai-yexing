// v3.5 世界场景扩展渲染层：左上强盗营寨（吕达+箭塔）、西南猎人营地（老猎人NPC）、BOSS房传送阵、项羽/刑天秘境传送门
import { registerLayer } from './index.js';
import RD from '../data/realms.json' with { type: 'json' };

const KAI = '"Ma Shan Zheng", "STKaiti", serif';
const INK = '#0b0d18';

function setup(sc, sim) {
  const g = sc.add.graphics().setDepth(-9540);
  const labels = {};
  const map = sim.map || {};

  if (map.banditCamp) {
    const bc = map.banditCamp;
    labels.bandit = sc.add.text(bc.x, bc.y - bc.r - 18, '左上强盗营寨 · 吕达', {
      fontFamily: KAI, fontSize: '28px', color: '#ff9a5a', stroke: INK, strokeThickness: 6,
    }).setOrigin(0.5).setDepth(9000);
  }
  if (map.hunterCamp) {
    const hc = map.hunterCamp;
    const nx = hc.x - 170; const ny = hc.y + 40;
    const npcImg = sc.textures.exists('g_merc_nu')
      ? sc.add.image(nx, ny, 'g_merc_nu').setOrigin(0.5, 0.92).setScale(0.46).setTint(0xc8ffd8).setDepth(ny)
      : null;
    labels.hunterNpc = sc.add.text(nx, ny - 86, hc.npcName || '老猎人·陈老汉', {
      fontFamily: KAI, fontSize: '22px', color: '#9ff0b8', stroke: INK, strokeThickness: 5,
    }).setOrigin(0.5).setDepth(9000);
    labels.hunterArea = sc.add.text(hc.x, hc.y - hc.r - 16, '西南猎场 · 猎人任务', {
      fontFamily: KAI, fontSize: '26px', color: '#9ff0b8', stroke: INK, strokeThickness: 6,
    }).setOrigin(0.5).setDepth(9000);
    labels._npcImg = npcImg;
  }
  if (map.bossRoom) {
    const br = map.bossRoom;
    labels.brEntry = sc.add.text(br.entry[0], br.entry[1] - 66, 'BOSS房传送阵', {
      fontFamily: KAI, fontSize: '22px', color: '#ff8a7a', stroke: INK, strokeThickness: 5,
    }).setOrigin(0.5).setDepth(9000);
    labels.brExit = sc.add.text(br.exit[0], br.exit[1] - 66, '返回灯坛', {
      fontFamily: KAI, fontSize: '22px', color: '#7fe3ff', stroke: INK, strokeThickness: 5,
    }).setOrigin(0.5).setDepth(9000);
  }
  labels.extraPortals = [];
  for (const er of (map.extraRealms || [])) {
    const en = sc.add.text(er.entry[0], er.entry[1] - 68, er.name, {
      fontFamily: KAI, fontSize: '22px', color: '#ffd36a', stroke: INK, strokeThickness: 5,
    }).setOrigin(0.5).setDepth(9000);
    const ex = sc.add.text(er.exit[0], er.exit[1] - 68, '返回灯坛', {
      fontFamily: KAI, fontSize: '22px', color: '#7fe3ff', stroke: INK, strokeThickness: 5,
    }).setOrigin(0.5).setDepth(9000);
    labels.extraPortals.push({ er, en, ex });
  }
  return { sim, g, labels };
}

function drawPortal(g, x, y, r, color, t, locked = false) {
  const col = locked ? 0x7a4858 : color;
  const k = (t * 0.85) % 1;
  g.fillStyle(col, locked ? 0.14 : 0.24).fillEllipse(x, y, r * 2, r * 1.05);
  g.lineStyle(3.5, col, locked ? 0.55 : 0.92).strokeEllipse(x, y, r * 2, r * 1.05);
  if (!locked) {
    g.lineStyle(2, 0xffd36a, 0.8 * (1 - k)).strokeEllipse(x, y, r * 2 * (1 - k * 0.65), r * 1.05 * (1 - k * 0.65));
  }
}

function frame(sc, sim, inView) {
  let V = sc.__worldExtrasVis;
  if (!V || V.sim !== sim || !V.g.scene) V = sc.__worldExtrasVis = setup(sc, sim);
  const g = V.g.clear();
  const t = sim.t;
  const map = sim.map || {};

  // 1. 左上强盗营寨（吕达）
  if (map.banditCamp && sim.bandits) {
    const bc = map.banditCamp;
    const B = sim.bandits;
    if (inView({ x: bc.x, y: bc.y, r: bc.r + 120 })) {
      g.fillStyle(0x5a2414, 0.22).fillCircle(bc.x, bc.y, bc.r);
      g.lineStyle(4, B.state === 'alive' ? 0xff7a3a : 0x7a6a58, 0.78).strokeCircle(bc.x, bc.y, bc.r);
      g.lineStyle(2, 0xffc977, 0.45).strokeCircle(bc.x, bc.y, bc.r - 18);
    }
    if (V.labels.bandit) {
      const txt = B.state === 'alive'
        ? `左上强盗营寨 · 吕达（已讨伐 ${B.clears} 次）`
        : `左上强盗营寨 · 吕达重生中 ${Math.ceil(B.cooldownLeft())}s`;
      if (V.labels.bandit.text !== txt) V.labels.bandit.setText(txt);
    }
  }

  // 2. 西南猎人营地（老猎人 NPC + 野狼猎场）
  if (map.hunterCamp && sim.hunter) {
    const hc = map.hunterCamp;
    const H = sim.hunter;
    if (inView({ x: hc.x, y: hc.y, r: hc.r + 160 })) {
      g.fillStyle(0x1b4d32, 0.2).fillCircle(hc.x, hc.y, hc.r);
      g.lineStyle(3.5, 0x5fe08a, 0.72).strokeCircle(hc.x, hc.y, hc.r);
      // NPC 脚下光环
      g.fillStyle(0x5fe08a, 0.24).fillEllipse(H.npc.x, H.npc.y, 72, 34);
      g.lineStyle(2.5, 0xffd36a, 0.85).strokeEllipse(H.npc.x, H.npc.y, 72, 34);
    }
    if (V.labels.hunterArea) {
      const txt = `西南猎场 · 猎人任务（${H.prog}/${H.need} · 已完成 ${H.clears} 轮）`;
      if (V.labels.hunterArea.text !== txt) V.labels.hunterArea.setText(txt);
    }
  }

  // 3. BOSS 房传送阵
  if (map.bossRoom) {
    const br = map.bossRoom;
    const r = br.portalR || 76;
    if (inView({ x: br.entry[0], y: br.entry[1], r: 220 })) drawPortal(g, br.entry[0], br.entry[1], r, br.color || 0xff6a5a, t, false);
    if (inView({ x: br.exit[0], y: br.exit[1], r: 220 })) drawPortal(g, br.exit[0], br.exit[1], r, 0x7fe3ff, t, false);
  }

  // 4. 项羽 / 刑天挑战秘境传送门
  for (const item of V.labels.extraPortals) {
    const { er, en } = item;
    const st = sim.realms?.state?.[er.id] || 'locked';
    const locked = st === 'locked';
    const rd = RD.realms[er.id] || {};
    const cd = sim.realms ? Math.ceil(sim.realms.cooldownLeft(er.id)) : 0;
    const labelTxt = locked
      ? `${er.name}（第${rd.open}波开放）`
      : st === 'active'
        ? `${er.name}（交战中）`
        : st === 'cleared' && cd > 0
          ? `${er.name}（冷却 ${cd}s）`
          : sim.realms?.firstCleared?.[er.id]
            ? `${er.name}（可重刷）`
            : `${er.name}（可进入）`;
    if (en.text !== labelTxt) en.setText(labelTxt).setColor(locked ? '#9aa3cf' : '#ffd36a');
    if (inView({ x: er.entry[0], y: er.entry[1], r: 220 })) drawPortal(g, er.entry[0], er.entry[1], RD.portalR || 80, er.color || 0xffc94a, t, locked);
    if (inView({ x: er.exit[0], y: er.exit[1], r: 220 })) drawPortal(g, er.exit[0], er.exit[1], RD.portalR || 80, 0x7fe3ff, t, false);
  }
}

registerLayer(frame);
