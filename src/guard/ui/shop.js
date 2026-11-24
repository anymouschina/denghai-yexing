// 铜钱商店 & 藏经书店面板（P 打开，打开自动暂停）：
// - 页签 1「百宝道具」：功能道具 + 杀敌成长神兵匣（噬魂剑 / 镇夜成长灯），支持 1-8 快捷购买与一键清地。
// - 页签 2「藏经书店」：永久属性书卷（武勇/体魄/玄甲/迅捷/天悟/经验之书），支持「买1本 / 连买5本」直服加属性！
import { TF, BF, NF, INK } from '../../fonts.js';
import { makeButton, drawPanel } from '../../widgets.js';

const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({ fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 3, ...extra });
const X0 = 190; const Y0 = 86; const W = 900; const H = 548;

export default {
  name: 'shop',
  key: 'p',
  create(hud) {
    const c = hud.add.container(0, 0);
    const dim = hud.add.rectangle(640, 360, 1280, 720, 0x05061a, 0.58).setInteractive();
    const bg = drawPanel(hud.add.graphics(), X0, Y0, W, H, { glow: 0xffc94a });
    const title = hud.add.text(X0 + 22, Y0 + 14, '行商百宝阁 · 藏经书店', st(26, '#ffc977', TF, { strokeThickness: 5 }));
    const pausePill = hud.add.text(X0 + 318, Y0 + 20, '⏸ 战斗已暂停 · 可从容选购', st(12, '#9ff0b8', BF, { strokeThickness: 2, backgroundColor: '#163828', padding: { x: 8, y: 3 } }));
    const sub = hud.add.text(X0 + 22, Y0 + 48, '', st(13, '#d8d2f5'));

    let tab = 'items'; // 'items' | 'books'
    const tabItemsBtn = makeButton(hud, X0 + 96, Y0 + 88, 148, 32, '✦ 百宝道具·成长匣', () => { tab = 'items'; self.sig = ''; self.refresh(); }, { size: 13, font: BF, primary: true });
    const tabBooksBtn = makeButton(hud, X0 + 256, Y0 + 88, 148, 32, '藏经书店·吃书', () => { tab = 'books'; self.sig = ''; self.refresh(); }, { size: 13, font: BF });

    const clearBtn = makeButton(hud, X0 + W - 134, Y0 + 30, 148, 34, '一键清地 [L]', () => {
      const r = hud.gg.cmd({ type: 'clearGroundItems' });
      if (r && r.ok) {
        const msg = r.cleared > 0
          ? `已清理 ${r.cleared} 件地面道具${r.keptUnique ? `（保留 ${r.keptUnique} 件唯一道具）` : ''}`
          : (r.keptUnique ? `地面仅剩 ${r.keptUnique} 件唯一道具，已受保护` : '地面当前很干净，无需清理');
        hud.toast(msg, r.cleared > 0 ? '#9ff0b8' : '#7fe3ff');
        self.sig = '';
      }
    }, { size: 13, font: BF });
    const closeBtn = makeButton(hud, X0 + W - 30, Y0 + 30, 38, 34, '×', () => hud.closePanel(), { size: 22, font: BF });
    const body = hud.add.container(0, 0);
    const footer = hud.add.text(640, Y0 + H - 18, '百宝道具支持 1-8 快捷购买 · 藏经书店买后立即为当前单位永久加属性 · P / Esc 关闭', st(12, '#9aa3cf')).setOrigin(0.5);
    c.add([dim, bg, title, pausePill, sub, tabItemsBtn, tabBooksBtn, clearBtn, closeBtn, body, footer]);

    const self = { c, sig: '' };
    const sim = () => hud.sim;

    function buy(entry) {
      const r = hud.gg.cmd({ type: 'buyItem', itemId: entry.id });
      if (r && r.ok) {
        hud.toast(`购入 ${entry.name}（-${entry.buy} 钱）`, '#ffd36a');
        self.sig = '';
      }
    }

    function buyBook(entry, count) {
      const r = hud.gg.cmd({ type: 'buyBook', itemId: entry.id, count });
      if (r && r.ok) {
        hud.toast(`研读【${entry.name}】×${count}（-${r.cost} 钱），永久属性已生效！`, '#ffd36a');
        self.sig = '';
      }
    }

    function rebuild() {
      body.removeAll(true);
      const s = sim();
      tabItemsBtn.setLabel(tab === 'items' ? '✦ 百宝道具·成长匣' : '百宝道具·成长匣');
      tabBooksBtn.setLabel(tab === 'books' ? '✦ 藏经书店·吃书' : '藏经书店·吃书');

      if (tab === 'books') {
        const books = s.shop && s.shop.books ? s.shop.books() : [];
        const cols = 3;
        const cw = 274;
        const ch = 186;
        const gx = 14;
        const gy = 14;
        const startX = X0 + (W - (cols * cw + (cols - 1) * gx)) / 2;
        const startY = Y0 + 118;
        books.forEach((entry, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = startX + col * (cw + gx);
          const y = startY + row * (ch + gy);
          const ok1 = s.copper >= entry.buy;
          const ok5 = s.copper >= entry.buy * 5;
          const g = hud.add.graphics();
          g.fillStyle(0x0b0d18).fillRoundedRect(x, y + 4, cw, ch, 11);
          g.fillStyle(ok1 ? 0x241d46 : 0x1a1d34).fillRoundedRect(x, y, cw, ch, 11);
          g.lineStyle(2.5, ok1 ? 0xffd36a : 0x343a66).strokeRoundedRect(x, y, cw, ch, 11);

          const icon = hud.add.image(x + 34, y + 34, entry.tex);
          const fr = icon.frame;
          icon.setScale(42 / Math.max(fr.width || 42, fr.height || 42));
          if (entry.tint) icon.setTint(parseInt(entry.tint, 16));
          const nm = hud.add.text(x + 64, y + 12, entry.name, st(18, '#ffd36a', TF));
          const price = hud.add.text(x + 64, y + 38, `${entry.buy} 钱 / 本`, st(14, ok1 ? '#ffd36a' : '#ff8a7a', NF, { fontStyle: 'bold' }));
          const desc = hud.add.text(x + 12, y + 66, entry.desc, st(12, '#e8e4d8', BF, {
            strokeThickness: 2, lineSpacing: 3, wordWrap: { width: cw - 24, useAdvancedWrap: true },
          }));
          const b1 = makeButton(hud, x + 72, y + ch - 26, 118, 34, '买 1 本', () => buyBook(entry, 1), { size: 14, primary: ok1, font: BF });
          const b5 = makeButton(hud, x + cw - 72, y + ch - 26, 118, 34, `连买 5 本`, () => buyBook(entry, 5), { size: 14, primary: ok5, font: BF });
          b1.setEnabled(ok1);
          b5.setEnabled(ok5);
          body.add([g, icon, nm, price, desc, b1, b5]);
        });
        return;
      }

      const list = s.shop ? s.shop.catalog().filter((x) => !x.book).slice(0, 8) : [];
      const cols = 4;
      const cw = 206;
      const ch = 186;
      const gx = 10;
      const gy = 14;
      const startX = X0 + (W - (cols * cw + (cols - 1) * gx)) / 2;
      const startY = Y0 + 118;

      list.forEach((entry, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * (cw + gx);
        const y = startY + row * (ch + gy);
        const ok = s.copper >= entry.buy;
        const owned = s.shop ? s.shop.count(entry.id) : 0;

        const g = hud.add.graphics();
        g.fillStyle(0x0b0d18).fillRoundedRect(x, y + 4, cw, ch, 11);
        g.fillStyle(ok ? 0x202654 : 0x1a1d34).fillRoundedRect(x, y, cw, ch, 11);
        g.lineStyle(2.5, entry.grantGrowth ? 0xffd36a : (ok ? 0xffc977 : 0x343a66)).strokeRoundedRect(x, y, cw, ch, 11);

        const icon = hud.add.image(x + 32, y + 32, entry.tex);
        const fr = icon.frame;
        icon.setScale(38 / Math.max(fr.width || 38, fr.height || 38));
        if (entry.tint) icon.setTint(parseInt(entry.tint, 16));
        if (!ok) icon.setAlpha(0.65);

        const nm = hud.add.text(x + 58, y + 12, entry.name, st(15, ok ? '#ffc977' : '#8d94b8', TF));
        const price = hud.add.text(x + 58, y + 34, `${entry.buy} 钱`, st(14, ok ? '#ffd36a' : '#ff8a7a', NF, { fontStyle: 'bold' }));
        const ownTxt = hud.add.text(x + cw - 10, y + 12, owned > 0 ? `持有 ${owned}` : '', st(11, '#9ff0b8', NF)).setOrigin(1, 0);
        const desc = hud.add.text(x + 10, y + 60, entry.desc, st(11, '#d8d2f5', BF, {
          strokeThickness: 2, lineSpacing: 2, wordWrap: { width: cw - 20, useAdvancedWrap: true },
        }));
        const btn = makeButton(hud, x + cw / 2, y + ch - 24, cw - 20, 32, `购买 [${i + 1}]`, () => buy(entry), { size: 14, primary: ok, font: BF });
        btn.setEnabled(ok);
        body.add([g, icon, nm, price, ownTxt, desc, btn]);
      });
    }

    self.open = (arg) => {
      if (arg && arg.tab === 'books') tab = 'books';
      else if (arg && arg.tab === 'items') tab = 'items';
      self.sig = '';
      self.refresh();
    };
    self.refresh = () => {
      const s = sim();
      const u = s.ctrl || s.hero;
      const ts = s.inv?.tomeStats?.[u?.id];
      const bookCnt = ts ? (ts.count || 0) : 0;
      const gCount = s.groundItems ? s.groundItems.length : 0;
      const uCount = s.ground ? s.ground.uniqueCount() : 0;
      const sig = `${tab}|${s.copper}|${bookCnt}|${gCount}|${uCount}|${s.inv?.ver || 0}`;
      sub.setText(`铜钱 ${s.copper}   ·   ${u?.name || '英雄'}已服书卷 ${bookCnt} 本   ·   地面道具 ${gCount} 件${uCount ? `（含 ${uCount} 件唯一）` : ''}`);
      clearBtn.setLabel(gCount > 0 ? `清地 (${gCount}) [L]` : '一键清地 [L]');
      if (sig !== self.sig) {
        self.sig = sig;
        rebuild();
      }
    };
    self.key = (e) => {
      const k = (e.key || '').toLowerCase();
      if (tab === 'items') {
        const idx = '12345678'.indexOf(k);
        if (idx >= 0) {
          const list = sim().shop ? sim().shop.catalog().filter((x) => !x.book).slice(0, 8) : [];
          if (list[idx]) { buy(list[idx]); return true; }
        }
      }
      if (k === 'l') {
        const r = hud.gg.cmd({ type: 'clearGroundItems' });
        if (r && r.ok) hud.toast(r.cleared > 0 ? `已清理 ${r.cleared} 件地面道具` : '没有可清理的普通地面道具', '#9ff0b8');
        self.sig = '';
        return true;
      }
      return false;
    };
    return self;
  },
};
