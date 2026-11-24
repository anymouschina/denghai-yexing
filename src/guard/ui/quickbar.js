// 常驻 HUD 快捷道具栏（x 912–1264、y 554–602）：
// 位于右侧军令追踪（底边 540）下方、右下技能栏（顶边 612）上方，桌面与触屏均零重叠。
// 点击或按 F2-F7 立即使用对应功能道具；数量为 0 时点击直接打开商店购买。
import { BF, NF, INK } from '../../fonts.js';
import { ITEMS as IT } from '../sim/systems/loot.js';
import { QUICK_ITEM_IDS, countItemInBag } from '../sim/systems/shop.js';
import { touch } from '../../touch.js';

const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({ fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 3, ...extra });
const SHORT_NAME = {
  pill: '回春',
  oil: '灯油',
  recall_scroll: '回城',
  blink_scroll: '缩地',
  km_shield: '金钟',
  repair_kit: '修塔',
  stun_charm: '定身',
  swift: '神行',
};

export default {
  name: 'quickbar',
  always: true,
  create(hud) {
    const sim = hud.sim;
    const c = hud.add.container(0, 0);
    if (touch.enabled) {
      c.setVisible(false);
      return { c, refresh() {} };
    }
    const g = hud.add.graphics();
    c.add(g);

    const slotW = 50;
    const slotH = 44;
    const gap = 6;
    const totalW = QUICK_ITEM_IDS.length * slotW + (QUICK_ITEM_IDS.length - 1) * gap;
    const X0 = 800 - totalW; // x: 470..800，位于底部头像（24..444）与加大版 MOBA 技能轮盘（821..1262）之间，零重叠
    const Y0 = 640;

    const slots = QUICK_ITEM_IDS.map((id, i) => {
      const def = IT.consumables[id];
      const x = X0 + i * (slotW + gap);
      const y = Y0;
      const icon = hud.add.image(x + slotW / 2, y + 18, def.tex);
      const fr = icon.frame;
      icon.setScale(26 / Math.max(fr.width || 26, fr.height || 26));
      if (def.tint) icon.setTint(parseInt(def.tint, 16));
      const keyTxt = hud.add.text(x + 3, y + 2, `F${i + 2}`, st(9, '#9aa3cf', NF, { strokeThickness: 2 }));
      const cntTxt = hud.add.text(x + slotW - 3, y + 2, '0', st(11, '#ffd36a', NF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(1, 0);
      const lblTxt = hud.add.text(x + slotW / 2, y + slotH - 2, SHORT_NAME[id] || def.name.slice(0, 2), st(10, '#f3e6c8', BF, { strokeThickness: 2 })).setOrigin(0.5, 1);
      const hit = hud.add.rectangle(x + slotW / 2, y + slotH / 2, slotW, slotH, 0, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => hud.tip(`${def.name}（F${i + 2}）：${def.desc}`));
      hit.on('pointerdown', () => {
        if (hud.modal || hud.gg.paused || hud.gg.panelPaused || sim.over) return;
        const n = countItemInBag(sim, id);
        if (n <= 0) {
          hud.togglePanel('shop');
          hud.toast(`${def.name} 已用完，已在商店中为您打开购买页`, '#ffc977');
          return;
        }
        hud.gg.cmd({ type: 'useQuickItem', itemId: id });
      });
      c.add([icon, keyTxt, cntTxt, lblTxt, hit]);
      return { id, def, x, y, icon, cntTxt, lblTxt };
    });

    let lastSig = '';
    return {
      c,
      refresh() {
        if (!sim.inv) return;
        const counts = slots.map((sl) => countItemInBag(sim, sl.id));
        const sig = counts.join(',');
        if (sig === lastSig) return;
        lastSig = sig;
        g.clear();
        g.fillStyle(0x0b0d18, 0.78).fillRoundedRect(X0 - 6, Y0 - 4, totalW + 12, slotH + 8, 10);
        g.lineStyle(2, 0x343c70, 0.9).strokeRoundedRect(X0 - 6, Y0 - 4, totalW + 12, slotH + 8, 10);
        slots.forEach((sl, i) => {
          const n = counts[i];
          const has = n > 0;
          g.fillStyle(has ? 0x22295a : 0x131730, 0.92).fillRoundedRect(sl.x, sl.y, slotW, slotH, 7);
          g.lineStyle(1.8, has ? 0xffc977 : 0x2c335c, has ? 0.95 : 0.7).strokeRoundedRect(sl.x, sl.y, slotW, slotH, 7);
          sl.icon.setAlpha(has ? 1 : 0.32);
          sl.cntTxt.setText(has ? String(n) : '').setColor(has ? '#ffd36a' : '#6c739e');
          sl.lblTxt.setColor(has ? '#f3e6c8' : '#7f86b8');
        });
      },
    };
  },
};
