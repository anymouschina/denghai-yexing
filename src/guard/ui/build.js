// 建造面板（G 或点地基）：空地基显示 5 种建筑卡；已建地基显示等级数值与 升级 / 拆除。打开时战斗不暂停。
// 面板区域 x 250–1030、y 120–560：不挡顶部孔明血条（0–70）、右侧小地图/秘境/军令栏（x ≥ 1050）与底部头像技能栏（≥ 600）。
import { TF, BF, NF, INK } from '../../fonts.js';
import { makeButton, drawPanel } from '../../widgets.js';
import BD from '../data/buildings.json' with { type: 'json' };
import { BUILD_TYPES, upgradeCost, lvVal, canReach, nearestFoundation, buildingAt } from '../sim/systems/buildings.js';

const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({ fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 4, ...extra });
const X0 = 250; const Y0 = 120; const W = 780; const H = 440;

function statLines(b) {
  const d = b.def0;
  const L = [`耐久 ${Math.ceil(b.hp)} / ${b.maxHp}`];
  if (d.dmg) L.push(`伤害 ${lvVal(d.dmg, b.lv)}（随波数成长）  射程 ${d.range}  间隔 ${d.cd}s`);
  if (d.splash) L.push(`溅射半径 ${lvVal(d.splash, b.lv)}`);
  if (d.jumps) L.push(`连锁 ${lvVal(d.jumps, b.lv)} 次`);
  if (d.thorns) L.push(`阻挡地面妖物 · 反伤 ${Math.round(lvVal(d.thorns, b.lv) * 100)}%`);
  if (d.heal) L.push(`治疗 ${lvVal(d.heal, b.lv)}/秒  范围 ${d.range}`);
  return L;
}

export default {
  name: 'build',
  key: 'g',
  create(hud) {
    const c = hud.add.container(0, 0);
    const bg = drawPanel(hud.add.graphics(), X0, Y0, W, H, { glow: 0xff9a3c });
    const title = hud.add.text(640, Y0 + 28, '建造', st(28, '#ffc977', TF, { strokeThickness: 6 })).setOrigin(0.5);
    const sub = hud.add.text(640, Y0 + 60, '', st(14, '#9aa3cf')).setOrigin(0.5);
    const body = hud.add.container(0, 0);
    const prevBtn = makeButton(hud, X0 + 72, Y0 + 30, 108, 32, '◀ 上一地基', () => stepFoundation(-1), { size: 14, font: BF });
    const nextBtn = makeButton(hud, X0 + 188, Y0 + 30, 108, 32, '下一地基 ▶', () => stepFoundation(1), { size: 14, font: BF });
    const close = makeButton(hud, X0 + W - 34, Y0 + 30, 40, 36, '×', () => hud.closePanel(), { size: 24, font: BF });
    c.add([bg, title, sub, body, prevBtn, nextBtn, close]);
    const self = { c, f: null, sig: '', hpText: null };

    const sim = () => hud.sim;
    const cmd = (o) => hud.gg.cmd(o);

    function stepFoundation(dir) {
      const s = sim();
      if (!s.foundations.length) return;
      const idx = self.f ? s.foundations.findIndex((x) => x.id === self.f.id) : 0;
      self.f = s.foundations[(idx + dir + s.foundations.length) % s.foundations.length];
      self.sig = '';
      self.refresh();
    }

    function buildEmpty(f) {
      const s = sim();
      const reach = canReach(s, f);
      const questBld = s.quests?.active?.find((q) => q.type === 'buildType')?.build || null;
      const cw = 140; const gap = 12;
      const x0 = 640 - (BUILD_TYPES.length * cw + (BUILD_TYPES.length - 1) * gap) / 2;
      BUILD_TYPES.forEach((t, i) => {
        const d = BD.types[t];
        const x = x0 + i * (cw + gap);
        const y = Y0 + 90;
        const ok = reach && s.copper >= d.cost;
        const isQuest = questBld === t;
        const g = hud.add.graphics();
        g.fillStyle(0x0b0d18).fillRoundedRect(x, y + 5, cw, 290, 12);
        g.fillStyle(ok ? 0x262b5e : 0x24263a).fillRoundedRect(x, y, cw, 290, 12);
        g.lineStyle(isQuest ? 4 : 3, isQuest ? 0xffd36a : ok ? 0xffc977 : 0x343a66).strokeRoundedRect(x, y, cw, 290, 12);
        const img = hud.add.image(x + cw / 2, y + 106, d.tex).setOrigin(0.5, 1);
        img.setScale(Math.min(92 / img.width, 92 / img.height));
        if (!ok) img.setTint(0x777777).setAlpha(0.6);
        const nm = hud.add.text(x + cw / 2, y + 114, d.name, st(21, ok ? '#ffc977' : '#80839c', TF)).setOrigin(0.5, 0);
        const cost = hud.add.text(x + cw / 2, y + 144, `${d.cost} 钱`, st(15, s.copper >= d.cost ? '#ffd36a' : '#ff8a7a', NF, { fontStyle: 'bold' })).setOrigin(0.5, 0);
        const desc = hud.add.text(x + cw / 2, y + 168, d.desc, st(12, '#d8d2f5', BF, { strokeThickness: 3, align: 'center', lineSpacing: 2, wordWrap: { width: cw - 14, useAdvancedWrap: true } })).setOrigin(0.5, 0);
        const btn = makeButton(hud, x + cw / 2, y + 260, cw - 20, 40, `建造 ${i + 1}`, () => {
          const r = cmd({ type: 'build', fid: f.id, bld: t });
          if (r && r.ok) { hud.toast(`${d.name} 建成`, '#ffc977'); self.sig = ''; }
        }, { size: 18, primary: ok, font: BF });
        btn.setEnabled(ok);
        body.add([g, img, nm, cost, desc, btn]);
        if (isQuest) {
          const qg = hud.add.graphics();
          qg.fillStyle(0xe0463a).fillRoundedRect(x + cw - 52, y + 6, 46, 20, 6);
          const qt = hud.add.text(x + cw - 29, y + 16, '军令', st(12, '#fff4d8', BF, { strokeThickness: 2, fontStyle: 'bold' })).setOrigin(0.5);
          body.add([qg, qt]);
        }
      });
      if (!reach) {
        body.add(hud.add.text(X0 + 300, Y0 + 408, '离此地基过远，可自动走近后再建', st(14, '#ff8a7a')).setOrigin(0.5));
        const goBtn = makeButton(hud, X0 + 575, Y0 + 408, 176, 36, '走近此地基建造', () => {
          cmd({ type: 'buildMove', fid: f.id });
          hud.gg.addOrderRipple?.(f.x, f.y, 0xffc977, 'guide');
          hud.closePanel();
          hud.toast('正在前往地基…到达后自动打开建造', '#ffc977');
        }, { size: 15, primary: true, font: BF });
        body.add(goBtn);
      } else {
        body.add(hud.add.text(640, Y0 + 408, '点卡片或按 1-5 建造 · 战斗照常进行 · G / Esc 关闭', st(13, '#9aa3cf')).setOrigin(0.5));
      }
    }

    function buildExisting(b) {
      const s = sim();
      const d = b.def0;
      const g = hud.add.graphics();
      g.fillStyle(0x262b5e).fillRoundedRect(X0 + 36, Y0 + 90, 220, 300, 14).lineStyle(3, 0xffc977).strokeRoundedRect(X0 + 36, Y0 + 90, 220, 300, 14);
      const img = hud.add.image(X0 + 146, Y0 + 296, d.tex).setOrigin(0.5, 1);
      img.setScale(Math.min(176 / img.width, 184 / img.height));
      const nm = hud.add.text(X0 + 146, Y0 + 312, `${d.name}`, st(26, '#ffc977', TF)).setOrigin(0.5, 0);
      const stars = hud.add.text(X0 + 146, Y0 + 348, '★'.repeat(b.lv) + '☆'.repeat(3 - b.lv), st(20, '#ffd36a', BF)).setOrigin(0.5, 0);
      const info = hud.add.text(X0 + 286, Y0 + 96, '', st(16, '#f3e6c8', BF, { lineSpacing: 6, wordWrap: { width: W - 310, useAdvancedWrap: true } }));
      self.hpText = info;
      const upC = upgradeCost(b.type, b.lv);
      const refund = Math.round(b.spent * BD.refund);
      const lines = [`等级 ${b.lv} / 3`, '', ...statLines(b)];
      if (upC != null) {
        const nb = { ...b, lv: b.lv + 1 };
        const next = statLines(nb).slice(1).join('；');
        lines.push('', `下一级：${next}`);
      }
      self.baseLines = lines;
      const up = makeButton(hud, X0 + 382, Y0 + 360, 178, 52, upC != null ? `升级（${upC}）U` : '已满级', () => {
        const r = cmd({ type: 'upgrade', bid: b.id });
        if (r && r.ok) { hud.toast(`${d.name} 升到 ${b.lv} 级`, '#ffc977'); self.sig = ''; }
      }, { size: 17, primary: true });
      up.setEnabled(upC != null && s.copper >= upC);
      const needRepair = b.hp < b.maxHp - 1;
      const repCost = needRepair ? Math.max(10, Math.ceil(d.cost * 0.35 * ((b.maxHp - b.hp) / b.maxHp))) : 0;
      const rep = makeButton(hud, X0 + 556, Y0 + 360, 146, 52, needRepair ? `修复（${repCost}）R` : '耐久已满', () => {
        const r = cmd({ type: 'repair', bid: b.id });
        if (r && r.ok) { hud.toast(`已修复 ${d.name}（+${r.healed} 耐久）`, '#9ff0b8'); self.sig = ''; }
      }, { size: 16 });
      rep.setEnabled(needRepair && s.copper >= repCost);
      const dm = makeButton(hud, X0 + 696, Y0 + 360, 118, 52, `拆（+${refund}）X`, () => {
        const r = cmd({ type: 'demolish', bid: b.id });
        if (r && r.ok) { hud.toast(`已拆除，返还 ${r.refund} 钱`); self.sig = ''; }
      }, { size: 15 });
      body.add([g, img, nm, stars, info, up, rep, dm]);
    }

    self.open = (f) => {
      const s = sim();
      const u = s.ctrl || s.hero;
      self.f = f || nearestFoundation(s, u.x, u.y);
      self.sig = '';
      self.refresh();
    };
    self.close = () => { self.f = null; };
    self.refresh = () => {
      const s = sim();
      const f = self.f;
      if (!f) return;
      const b = buildingAt(s, f);
      const reach = canReach(s, f);
      const aff = BUILD_TYPES.map((t) => (s.copper >= BD.types[t].cost ? 1 : 0)).join('');
      const upAff = b ? (s.copper >= (upgradeCost(b.type, b.lv) ?? Infinity) ? 1 : 0) : 0;
      const repFlag = b && b.hp < b.maxHp - 1 ? 1 : 0;
      const sig = `${f.id}|${b ? `${b.id}:${b.lv}:${upAff}:${repFlag}` : `e:${aff}:${reach}`}`;
      if (sig !== self.sig) {
        self.sig = sig;
        body.removeAll(true);
        self.hpText = null;
        const laneName = { N: '北', E: '东', S: '南', W: '西' }[f.lane];
        sub.setText(`${laneName}路 · ${f.id + 1} 号地基　铜钱 ${s.copper}`);
        title.setText(b ? '建筑' : '建造');
        if (b) buildExisting(b); else buildEmpty(f);
      }
      sub.setText(`${{ N: '北', E: '东', S: '南', W: '西' }[f.lane]}路 · ${f.id + 1} 号地基　铜钱 ${s.copper}`);
      if (b && self.hpText) {
        const L = self.baseLines.slice();
        L[2] = `耐久 ${Math.ceil(b.hp)} / ${b.maxHp}`;
        const txt = L.join('\n');
        if (self.hpText.text !== txt) self.hpText.setText(txt);
      }
    };
    self.key = (e) => {
      const s = sim();
      const b = self.f && buildingAt(s, self.f);
      const k = (e.key || '').toLowerCase();
      // 1–5：在当前地基建造对应建筑（面板打开时数字键归面板，不切换单位）
      const ti = '12345'.indexOf(k);
      if (ti >= 0 && self.f && !b && BUILD_TYPES[ti]) { const r = cmd({ type: 'build', fid: self.f.id, bld: BUILD_TYPES[ti] }); if (r && r.ok) { hud.toast(`${BD.types[BUILD_TYPES[ti]].name} 建成`, '#ffc977'); self.sig = ''; } return true; }
      if (b && k === 'u') { const r = cmd({ type: 'upgrade', bid: b.id }); if (r && r.ok) self.sig = ''; return true; }
      if (b && k === 'r') { const r = cmd({ type: 'repair', bid: b.id }); if (r && r.ok) { hud.toast(`已修复 ${b.name}`, '#9ff0b8'); self.sig = ''; } return true; }
      if (b && k === 'x') { const r = cmd({ type: 'demolish', bid: b.id }); if (r && r.ok) self.sig = ''; return true; }
      return false;
    };
    return self;
  },
};
