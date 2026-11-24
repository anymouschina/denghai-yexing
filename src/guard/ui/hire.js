// 雇佣面板（H）：三种守卫卡（价格、当前数量/上限），下方是已雇守卫列表，可花铜钱升级（最高 3 级）。战斗不暂停。
import { TF, BF, NF, INK } from '../../fonts.js';
import { makeButton, drawPanel } from '../../widgets.js';
import UNITS from '../data/units.json' with { type: 'json' };
import BAL from '../data/balance.json' with { type: 'json' };
import { MERC_KEYS, MERC_MAX_LV, MERC_LV_BONUS, mercCount, mercUpCost } from '../sim/systems/mercs.js';

const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({ fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 4, ...extra });
const X0 = 250; const Y0 = 110; const W = 780; const H = 470;
// 键盘雇佣：Z/X/C 对应三种守卫（数字键已用于切换单位）
const HOTKEY = { dao: 'Z', nu: 'X', tong: 'C' };
const ROLE = { dao: '坦克 · 近战盾击', nu: '远程 · 连弩齐射', tong: '法术溅射 · 群体治疗' };

export default {
  name: 'hire',
  key: 'h',
  create(hud) {
    const c = hud.add.container(0, 0);
    const bg = drawPanel(hud.add.graphics(), X0, Y0, W, H, { glow: 0x7fe3ff });
    const title = hud.add.text(640, Y0 + 28, '雇佣守卫', st(30, '#ffc977', TF, { strokeThickness: 6 })).setOrigin(0.5);
    const sub = hud.add.text(640, Y0 + 60, '', st(14, '#9aa3cf')).setOrigin(0.5);
    const body = hud.add.container(0, 0);
    const close = makeButton(hud, X0 + W - 34, Y0 + 28, 44, 40, '×', () => hud.closePanel(), { size: 26 });
    c.add([bg, title, sub, body, close]);
    const self = { c, sig: '', hpTexts: [] };
    const sim = () => hud.sim;
    const cmd = (o) => hud.gg.cmd(o);
    const mercs = () => sim().units.filter((u) => u.kind === 'merc' && u.alive);
    const hireKey = (k) => {
      const r = cmd({ type: 'hire', key: k });
      if (r && r.ok) { hud.toast(`${UNITS.mercs[k].name} 已到孔明身边`, '#7fe3ff'); self.sig = ''; }
    };

    function rebuild() {
      const s = sim();
      const n = mercCount(s);
      const max = BAL.party.maxMercs;
      self.hpTexts = [];
      const cw = 230; const gap = 14;
      const x0 = 640 - (3 * cw + 2 * gap) / 2;
      MERC_KEYS.forEach((k, i) => {
        const d = UNITS.mercs[k];
        const x = x0 + i * (cw + gap);
        const y = Y0 + 82;
        const ok = s.copper >= d.cost && n < max;
        const g = hud.add.graphics();
        g.fillStyle(0x0b0d18).fillRoundedRect(x, y + 5, cw, 168, 12);
        g.fillStyle(ok ? 0x23304e : 0x24263a).fillRoundedRect(x, y, cw, 168, 12);
        g.lineStyle(3, ok ? 0x7fe3ff : 0x343a66).strokeRoundedRect(x, y, cw, 168, 12);
        const img = hud.add.image(x + 48, y + 148, d.tex).setOrigin(0.5, 1);
        img.setScale(Math.min(82 / img.width, 130 / img.height));
        if (!ok) img.setTint(0x777777).setAlpha(0.6);
        const nm = hud.add.text(x + 96, y + 10, d.name, st(20, ok ? '#ffc977' : '#80839c', TF));
        const info = hud.add.text(x + 96, y + 40, `${ROLE[k] || ''}\n血 ${d.hp} · 攻 ${d.atk}`, st(12, '#d8d2f5', BF, { strokeThickness: 3, lineSpacing: 3, wordWrap: { width: cw - 104, useAdvancedWrap: true } }));
        const btn = makeButton(hud, x + 166, y + 140, 108, 38, `${d.cost} 钱 [${HOTKEY[k]}]`, () => hireKey(k), { size: 15, primary: ok, font: BF });
        btn.setEnabled(ok);
        body.add([g, img, nm, info, btn]);
      });
      // 已雇守卫
      body.add(hud.add.text(X0 + 30, Y0 + 266, `已雇守卫 ${n} / ${max}（阵亡不复活；每级 生命/攻击 +${Math.round(MERC_LV_BONUS * 100)}%）`, st(14, '#ffc977')));
      const list = mercs();
      if (!list.length) body.add(hud.add.text(640, Y0 + 350, '还没有守卫。守卫会自动护卫孔明，点击头像或战场单位即可亲自操控。', st(14, '#9aa3cf')).setOrigin(0.5));
      list.forEach((u, i) => {
        const col = i % 3; const row = Math.floor(i / 3);
        const x = X0 + 30 + col * 245; const y = Y0 + 294 + row * 82;
        const g = hud.add.graphics();
        g.fillStyle(0x1a1f44).fillRoundedRect(x, y, 235, 72, 10).lineStyle(2, u.ctrl ? 0xffc977 : 0x343a66).strokeRoundedRect(x, y, 235, 72, 10);
        const img = hud.add.image(x + 28, y + 66, u.def.tex).setOrigin(0.5, 1);
        img.setScale(Math.min(44 / img.width, 60 / img.height));
        const nm = hud.add.text(x + 56, y + 6, `${u.name} ${'★'.repeat(u.lv)}`, st(13, '#ffc977'));
        const hp = hud.add.text(x + 56, y + 26, '', st(11, '#d8d2f5', NF, { strokeThickness: 3, lineSpacing: 3 }));
        self.hpTexts.push({ u, t: hp });
        const cost = mercUpCost(u);
        const btn = makeButton(hud, x + 198, y + 48, 64, 30, cost != null ? `↑${cost}` : '满级', () => {
          const r = cmd({ type: 'upgradeMerc', id: u.id });
          if (r && r.ok) { hud.toast(`${u.name} 升到 ${u.lv} 级`, '#7fe3ff'); self.sig = ''; }
        }, { size: 13, font: NF });
        btn.setEnabled(cost != null && s.copper >= cost);
        body.add([g, img, nm, hp, btn]);
      });
    }

    self.open = () => { self.sig = ''; self.refresh(); };
    self.refresh = () => {
      const s = sim();
      const list = mercs();
      const sig = `${MERC_KEYS.map((k) => (s.copper >= UNITS.mercs[k].cost ? 1 : 0)).join('')}|${list.map((u) => `${u.id}:${u.lv}:${u.ctrl ? 1 : 0}:${s.copper >= (mercUpCost(u) ?? Infinity) ? 1 : 0}`).join(',')}`;
      if (sig !== self.sig) { self.sig = sig; body.removeAll(true); rebuild(); }
      sub.setText(`铜钱 ${s.copper}　守卫 ${list.length} / ${BAL.party.maxMercs}　点击或按 Z/X/C 雇佣 · H / Esc 关闭`);
      for (const { u, t } of self.hpTexts) {
        const txt = `血 ${Math.ceil(u.hp)}/${u.maxHp}\n攻 ${Math.round(u.stats.atk)} Lv${u.lv}/${MERC_MAX_LV}`;
        if (t.text !== txt) t.setText(txt);
      }
    };
    self.key = (e) => {
      const k = (e.key || '').toUpperCase();
      const m = MERC_KEYS.find((x) => HOTKEY[x] === k);
      if (!m) return false;
      hireKey(m);
      return true;
    };
    return self;
  },
};
