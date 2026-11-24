// 暂停式行囊与神兵合成面板（B / K）：
// - 打开时自动冻结战斗（GuardHUD.panelPaused），玩家可从容对比装备属性与锻造神兵。
// - 装备栏（30 格）与道具/魂痕栏（24 格）严格分离，掉落道具绝不挤占装备。
// - 点击任意格先选中并在右侧展示大号属性对比卡片（相对当前穿戴槽位的绿增/红减），明确提供穿戴/卸下/使用/出售按钮。
// - 彻底去掉无意义的装备 Lv 标签，采用经典 5 阶（凡铁/精钢/灵器/仙宝/神兵）与精确属性数值。
// - 唯一道具（魂痕/灯魂印信等）在指令层与 UI 层双重禁止出售。
import { TF, BF, NF, INK } from '../../fonts.js';
import { makeButton, drawPanel } from '../../widgets.js';
import {
  ITEMS as IT, SLOTS, ARTIFACT_IDS, LOADOUT_COUNT, EQUIP_BAG_SIZE, ITEM_BAG_SIZE,
  qColor, qHex, qName, fmtMod, setCounts, itemMods, isUniqueItem, itemPowerScore,
} from '../sim/systems/loot.js';
import { touch } from '../../touch.js';

const INK_N = 0x0b0d18;
const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({
  fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 3, ...extra,
});
const X0 = 90; const Y0 = 66; const W = 1100; const H = 588;
const SLOT_SHORT = { weapon: '武器', armor: '护甲', accessory: '饰品', treasure: '法宝' };
const PAGE_SIZE = 15; // 5 列 × 3 行

function fitImage(img, box) {
  const fr = img.frame;
  img.setScale(box / Math.max(fr.width || box, fr.height || box));
  return img;
}

export function wearers(sim) {
  const out = [sim.hero, sim.kongming];
  for (const u of sim.units) if (u.kind === 'beast') out.push(u);
  return out.filter(Boolean);
}

function aggregateMods(it) {
  const map = {};
  for (const m of itemMods(it)) {
    const cur = map[m.stat] || { add: 0, mul: 0 };
    if (m.add !== undefined) cur.add += m.add;
    if (m.mul !== undefined) cur.mul += m.mul;
    map[m.stat] = cur;
  }
  return map;
}

function fmtDelta(stat, dVal, isPct) {
  if (Math.abs(dVal) < 1e-4) return null;
  const sign = dVal > 0 ? '▲ +' : '▼ ';
  const num = isPct
    ? `${(dVal * 100).toFixed(1).replace(/\.0$/, '')}%`
    : `${dVal % 1 ? dVal.toFixed(1) : Math.round(dVal)}`;
  return { text: `${sign}${num}`, color: dVal > 0 ? '#5fe08a' : '#ff6a5a' };
}

function shortMainText(it) {
  if (!it || it.kind !== 'equip' || !it.main) return '';
  const mods = itemMods(it);
  const main = mods[0] || it.main;
  const S = IT.stats[main.stat];
  if (!S) return '';
  const nm = S.name.slice(0, 2);
  if (main.add !== undefined) return `${nm}+${Math.round(main.add)}`;
  return `${nm}+${Math.round(main.mul * 100)}%`;
}

function isArtifact(it) {
  return !!(it && (it.artifact || ARTIFACT_IDS.includes(it.legendaryId) || ARTIFACT_IDS.includes(it.id)));
}

export default {
  name: 'bag',
  key: 'b',
  create(hud) {
    const sim = hud.sim;
    const c = hud.add.container(0, 0);
    // 全屏半透明遮罩，拦截背景点击/触控穿透
    const dim = hud.add.rectangle(640, 360, 1280, 720, 0x05061a, 0.62).setInteractive();
    const bg = drawPanel(hud.add.graphics(), X0, Y0, W, H, { glow: 0xffc94a });
    c.add([dim, bg]);

    const title = hud.add.text(X0 + 20, Y0 + 12, '行囊与神兵锻造', st(26, '#ffc977', TF, { strokeThickness: 5 }));
    const pausePill = hud.add.text(X0 + 230, Y0 + 18, '⏸ 战斗已暂停 · 可从容对比属性与合成', st(13, '#9ff0b8', BF, {
      strokeThickness: 2, backgroundColor: '#163828', padding: { x: 10, y: 4 },
    }));
    const copperTxt = hud.add.text(X0 + W - 124, Y0 + 26, '', st(17, '#ffd36a', NF, { fontStyle: 'bold' })).setOrigin(1, 0.5);
    const closeBtn = makeButton(hud, X0 + W - 56, Y0 + 28, 92, 34, '关闭 [Esc]', () => hud.closePanel(), { size: 13, font: BF });
    c.add([title, pausePill, copperTxt, closeBtn]);

    let mode = 'equip'; // 'equip' | 'items' | 'craft'
    let tabId = sim.hero.id;
    let eqPage = 0;
    let itPage = 0;
    let craftFilter = 'all'; // 'all' | 'legend' | 'artifact'
    let craftPage = 0;
    let selected = null; // { source: 'equipBag'|'itemBag'|'equipped', idx?, slot? }
    let dirty = true;
    let ver = -1;
    let sig = '';

    const curUnit = () => wearers(sim).find((u) => u.id === tabId) || sim.hero;
    const curEq = () => (sim.inv.equip[curUnit().id] ||= { weapon: null, armor: null, accessory: null, treasure: null });
    const curLoadout = () => (sim.inv.activeLoadout && sim.inv.activeLoadout[curUnit().id]) || 0;

    const dynC = hud.add.container(0, 0);
    c.add(dynC);

    function getSelectedItem() {
      if (!selected) return null;
      if (selected.source === 'equipBag') return sim.inv.equipBag[selected.idx] || null;
      if (selected.source === 'itemBag') return sim.inv.itemBag[selected.idx] || null;
      if (selected.source === 'equipped') return curEq()[selected.slot] || null;
      return null;
    }

    const autoEquip = () => {
      const u = curUnit();
      let n = 0;
      for (let i = 0; i < sim.inv.equipBag.length; i++) {
        const it = sim.inv.equipBag[i];
        if (!it || it.kind !== 'equip') continue;
        const cur = curEq()[it.slot];
        if (itemPowerScore(it) <= itemPowerScore(cur)) continue;
        if (hud.gg.cmd({ type: 'equip', bagIdx: i, unitId: u.id }).ok) n++;
      }
      hud.toast(n ? `${u.name} 一键穿戴 ${n} 件更强装备！` : '当前已穿戴最优装备', n ? '#ffc977' : '#9aa3cf');
    };

    const sellLow = () => {
      const r = hud.gg.cmd({ type: 'sellLowTier', maxQ: 0 });
      if (r && r.ok) hud.toast(`已批量出售 ${r.sold} 件普通凡铁装备，获得 +${r.copper} 钱`, '#ffd36a');
    };

    // 底部快捷工具栏
    const autoBtn = makeButton(hud, X0 + 96, Y0 + H - 28, 152, 36, '一键穿戴最优', autoEquip, { size: 14, font: BF, primary: true });
    const sortBtn = makeButton(hud, X0 + 244, Y0 + H - 28, 120, 36, '整理行囊', () => { hud.gg.cmd({ type: 'sort' }); hud.toast('已按品阶与部位整理', '#7fe3ff'); }, { size: 14, font: BF });
    const sellLowBtn = makeButton(hud, X0 + 408, Y0 + H - 28, 178, 36, '一键卖普通凡铁', sellLow, { size: 13, font: BF });
    const nanhuaBtn = makeButton(hud, X0 + 576, Y0 + H - 28, 134, 36, '南华强化 [O]', () => hud.togglePanel('nanhua'), { size: 13, font: BF });
    c.add([autoBtn, sortBtn, sellLowBtn, nanhuaBtn]);

    function drawTopTabs() {
      const eqN = sim.inv.equipBag.filter(Boolean).length;
      const itN = sim.inv.itemBag.filter(Boolean).length;
      const craftN = sim.craft ? sim.craft.craftableCount() : 0;
      const tabs = [
        { id: 'equip', label: `装备栏 (${eqN}/${EQUIP_BAG_SIZE})` },
        { id: 'items', label: `道具·魂痕 (${itN}/${ITEM_BAG_SIZE})` },
        { id: 'craft', label: craftN > 0 ? `神兵合成 (可合成 ${craftN})` : '神兵合成 [K]', highlight: craftN > 0 },
      ];
      tabs.forEach((tb, i) => {
        const on = mode === tb.id;
        const bx = X0 + 20 + i * 212;
        const by = Y0 + 54;
        const bw = 200;
        const bh = 36;
        const g = hud.add.graphics();
        g.fillStyle(on ? 0x3b4888 : (tb.highlight ? 0x3b2e16 : 0x161b3a)).fillRoundedRect(bx, by, bw, bh, 8);
        g.lineStyle(2, on ? 0xffd36a : (tb.highlight ? 0x5fe08a : 0x343c70)).strokeRoundedRect(bx, by, bw, bh, 8);
        const t = hud.add.text(bx + bw / 2, by + bh / 2, tb.label, st(14, on ? '#ffd36a' : (tb.highlight ? '#9ff0b8' : '#b8c0e6'), BF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(0.5);
        const hit = hud.add.rectangle(bx + bw / 2, by + bh / 2, bw, bh, 0, 0.001).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => { mode = tb.id; selected = null; dirty = true; });
        dynC.add([g, t, hit]);
      });
    }

    function drawInspector(u, eq) {
      const IX = X0 + 634;
      const IY = Y0 + 100;
      const IW = 446;
      const IH = 434;
      const g = hud.add.graphics();
      g.fillStyle(0x121633, 0.96).fillRoundedRect(IX, IY, IW, IH, 12);
      g.lineStyle(2.5, 0x3d4880).strokeRoundedRect(IX, IY, IW, IH, 12);
      dynC.add(g);

      const it = getSelectedItem();
      if (!it) {
        dynC.add(hud.add.text(IX + IW / 2, IY + IH / 2 - 14, '点击左侧装备或道具\n查看详细属性对比与操作', st(16, '#8d96c4', BF, { align: 'center', lineSpacing: 8 })).setOrigin(0.5));
        return;
      }

      // 物品头图与标题
      const iconBg = hud.add.graphics();
      const borderCol = it.kind === 'equip' ? qHex(it.q) : (isUniqueItem(it) ? 0xffd36a : 0x5fe08a);
      iconBg.fillStyle(0x1b2148).fillRoundedRect(IX + 16, IY + 16, 72, 72, 10);
      iconBg.lineStyle(2.5, borderCol).strokeRoundedRect(IX + 16, IY + 16, 72, 72, 10);
      const img = fitImage(hud.add.image(IX + 52, IY + 52, it.tex), 58);
      if (it.tint) img.setTint(parseInt(it.tint, 16));
      dynC.add([iconBg, img]);

      if (it.kind === 'equip') {
        const tierLabel = qName(it.q);
        const col = qColor(it.q);
        const slotLabel = SLOT_SHORT[it.slot] || it.slot;
        const srcTag = selected.source === 'equipped' ? ' [已穿戴]' : '';
        const enhTag = it.enhanceLv ? ` +${it.enhanceLv}` : '';
        const artTag = isArtifact(it) ? ' · 上古神器' : '';
        dynC.add(hud.add.text(IX + 100, IY + 14, `${it.name}${enhTag}${srcTag}`, st(21, col, TF, { strokeThickness: 4 })));
        const setStr = it.set && it.set !== 'plain' && IT.sets[it.set] ? ` · ${IT.sets[it.set].name}套` : '';
        dynC.add(hud.add.text(IX + 100, IY + 44, `品阶：${tierLabel}${it.enhanceLv ? ` · 强化+${it.enhanceLv}` : ''} · 部位：${slotLabel}${setStr}${artTag}`, st(12, '#d8d2f5', BF, { strokeThickness: 2 })));
        dynC.add(hud.add.text(IX + 100, IY + 66, `战力评分 ${itemPowerScore(it)}   ·   售价 ${it.price} 铜钱`, st(12, '#ffd36a', NF, { strokeThickness: 2 })));

        // 属性详情 + 与当前穿戴槽位对比
        const curWorn = selected.source === 'equipped' ? null : eq[it.slot];
        const selMap = aggregateMods(it);
        const curMap = curWorn ? aggregateMods(curWorn) : {};
        const allStats = [...new Set([...Object.keys(selMap), ...Object.keys(curMap)])];

        let sy = IY + 94;
        dynC.add(hud.add.text(IX + 18, sy, curWorn ? `属性对比（相对当前穿戴：${qName(curWorn.q)}·${curWorn.name}${curWorn.enhanceLv ? `+${curWorn.enhanceLv}` : ''}）` : '装备属性（当前槽位为空，穿戴直接生效）', st(12, '#7fe3ff', BF, { strokeThickness: 2 })));
        sy += 21;

        const rowH = allStats.length > 4 ? 19 : 22;
        for (const stat of allStats.slice(0, 6)) {
          const S = IT.stats[stat];
          if (!S) continue;
          const isPct = !S.flat;
          const vNew = isPct ? (selMap[stat]?.mul || 0) : (selMap[stat]?.add || 0);
          const vOld = isPct ? (curMap[stat]?.mul || 0) : (curMap[stat]?.add || 0);
          const valStr = vNew > 0
            ? (isPct ? `+${(vNew * 100).toFixed(1).replace(/\.0$/, '')}%` : `+${vNew % 1 ? vNew.toFixed(1) : Math.round(vNew)}`)
            : '+0';
          dynC.add(hud.add.text(IX + 22, sy, `${S.name}  ${valStr}`, st(14, vNew > 0 ? '#ffffff' : '#7f86b8', BF, { fontStyle: 'bold', strokeThickness: 2 })));
          if (selected.source !== 'equipped') {
            const d = fmtDelta(stat, vNew - vOld, isPct);
            if (d) {
              dynC.add(hud.add.text(IX + IW - 20, sy, d.text, st(14, d.color, NF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(1, 0));
            }
          }
          sy += rowH;
        }

        // 成长装备进度条与说明（支持杀敌成长与挨打成长）
        if (it.growth) {
          sy += 4;
          const isHits = it.growthType === 'hits';
          const progTxt = isHits
            ? (it.nextHits
              ? `✦ 挨打成长 阶${it.stage}/${it.maxStage} · 挨打 ${it.hitsTaken || 0}/${it.nextHits} 次升阶`
              : `✦ 挨打成长 已满阶（阶${it.stage}/${it.maxStage} · 累计挨打 ${it.hitsTaken || 0} 次）`)
            : (it.nextKills
              ? `✦ 杀敌成长 阶${it.stage}/${it.maxStage} · 击杀 ${it.kills || 0}/${it.nextKills} → 下一阶`
              : `✦ 杀敌成长 已满阶（阶${it.stage}/${it.maxStage} · 累计击杀 ${it.kills || 0}）`);
          const gTxt = dynC.add(hud.add.text(IX + 18, sy, progTxt, st(12, isHits ? '#7fe3ff' : '#9ff0b8', BF, {
            fontStyle: 'bold', strokeThickness: 2, wordWrap: { width: IW - 36, useAdvancedWrap: true },
          })));
          sy += gTxt.height + 4;
        }

        // 神兵 / 上古神器被动说明
        if (it.passive) {
          sy += 2;
          const pTxt = dynC.add(hud.add.text(IX + 18, sy, `${isArtifact(it) ? '✦ 上古神器' : '✦ 神兵被动'}：${it.passive}`, st(12, isArtifact(it) ? '#9ff0b8' : '#ffd36a', BF, {
            strokeThickness: 2, wordWrap: { width: IW - 36, useAdvancedWrap: true },
          })));
          sy += pTxt.height + 4;
        }

        // 套装效果说明（动态测量行高避免与底部按钮重叠）
        if (it.set && it.set !== 'plain' && IT.sets[it.set]) {
          const S = IT.sets[it.set];
          const cnt = setCounts(sim, u)[it.set] || 0;
          sy = Math.max(sy + 4, IY + 244);
          const sHead = dynC.add(hud.add.text(IX + 18, sy, `【${S.name}套装】（${u.name} 已穿 ${cnt}/4 件）`, st(12, S.color, BF, { fontStyle: 'bold', strokeThickness: 2 })));
          sy += sHead.height + 2;
          const b2Txt = dynC.add(hud.add.text(IX + 18, sy, `2件：${S.b2.text}`, st(11, cnt >= 2 ? '#9ff0b8' : '#9aa3cf', BF, { strokeThickness: 2, wordWrap: { width: IW - 36, useAdvancedWrap: true } })));
          sy += b2Txt.height + 2;
          dynC.add(hud.add.text(IX + 18, sy, `4件：${S.b4.text}`, st(11, cnt >= 4 ? '#ffd36a' : '#8d96c4', BF, { strokeThickness: 2, wordWrap: { width: IW - 36, useAdvancedWrap: true } })));
        }

        // 底部操作按钮
        const by = IY + IH - 34;
        if (selected.source === 'equipped') {
          const unBtn = makeButton(hud, IX + IW / 2, by, 210, 40, '卸下放回装备栏', () => {
            const r = hud.gg.cmd({ type: 'unequip', unitId: u.id, slot: selected.slot });
            if (r && r.ok) { selected = null; hud.toast(`已卸下 ${it.name}`, '#7fe3ff'); }
          }, { size: 15, font: BF, primary: true });
          dynC.add(unBtn);
        } else {
          const eqBtn = makeButton(hud, IX + 114, by, 194, 40, curWorn ? `为${u.name.slice(0, 2)}替换穿戴` : `为${u.name.slice(0, 2)}穿戴`, () => {
            const r = hud.gg.cmd({ type: 'equip', bagIdx: selected.idx, unitId: u.id });
            if (r && r.ok) {
              selected = { source: 'equipped', slot: it.slot };
              hud.toast(`${u.name} 已穿戴【${tierLabel}·${it.name}】`, col);
            }
          }, { size: 15, font: BF, primary: true });
          const unique = isUniqueItem(it);
          const sellBtn = makeButton(hud, IX + 332, by, 190, 40, unique ? '唯一不可出售' : `出售 (+${it.price} 钱)`, () => {
            if (unique) { hud.toast(`唯一装备【${it.name}】不可出售`, '#ff8a7a'); return; }
            const r = hud.gg.cmd({ type: 'sell', bagIdx: selected.idx });
            if (r && r.ok) {
              selected = null;
              hud.toast(`已出售【${tierLabel}·${it.name}】+${r.copper} 钱`, '#ffd36a');
            }
          }, { size: 14, font: BF });
          if (unique) sellBtn.setEnabled(false);
          dynC.add([eqBtn, sellBtn]);
        }
        return;
      }

      // 道具 / 唯一魂痕详情
      const C = IT.consumables[it.id] || {};
      const unique = isUniqueItem(it);
      dynC.add(hud.add.text(IX + 100, IY + 18, `${it.name} ×${it.n || 1}`, st(22, unique ? '#ffd36a' : '#9ff0b8', TF, { strokeThickness: 4 })));
      dynC.add(hud.add.text(IX + 100, IY + 50, unique ? '✦ 唯一奇珍 / 神兽魂痕 · 严格受保护不可出售' : `消耗道具 · 售价 ${it.price} 铜钱`, st(12, unique ? '#ffd36a' : '#d8d2f5', BF, { strokeThickness: 2 })));
      dynC.add(hud.add.text(IX + 20, IY + 114, C.desc || '功能道具', st(15, '#f3e6c8', BF, {
        strokeThickness: 2, lineSpacing: 6, wordWrap: { width: IW - 40, useAdvancedWrap: true },
      })));
      if (unique) {
        dynC.add(hud.add.text(IX + 20, IY + 210, '提示：唯一道具已锁定防误售，一键清地与出售均不会销毁。点击下方「立即使用」即可生效。', st(12, '#9ff0b8', BF, {
          strokeThickness: 2, lineSpacing: 4, wordWrap: { width: IW - 40, useAdvancedWrap: true },
        })));
      }
      const by = IY + IH - 34;
      const useBtn = makeButton(hud, IX + 114, by, 194, 40, '立即使用', () => {
        const r = hud.gg.cmd({ type: 'useItem', itemIdx: selected.idx });
        if (r && r.ok) {
          if (!sim.inv.itemBag[selected.idx]) selected = null;
          hud.toast(`已使用【${it.name}】`, '#9ff0b8');
        }
      }, { size: 15, font: BF, primary: true });
      const sellBtn = makeButton(hud, IX + 332, by, 190, 40, unique ? '唯一不可出售' : `出售 (+${it.price} 钱)`, () => {
        if (unique) { hud.toast(`唯一道具【${it.name}】不可出售`, '#ff8a7a'); return; }
        const r = hud.gg.cmd({ type: 'sell', itemIdx: selected.idx });
        if (r && r.ok) {
          if (!sim.inv.itemBag[selected.idx]) selected = null;
          hud.toast(`已出售【${it.name}】+${r.copper} 钱`, '#ffd36a');
        }
      }, { size: 14, font: BF });
      if (unique) sellBtn.setEnabled(false);
      dynC.add([useBtn, sellBtn]);
    }

    function drawBagMode() {
      const u = curUnit();
      const eq = curEq();
      const list = wearers(sim);
      const LX = X0 + 20;

      // 1. 穿戴单位页签 + 行囊套1/2/3
      const tw = Math.min(82, Math.floor(340 / Math.max(1, list.length)) - 4);
      list.forEach((w, i) => {
        const on = w.id === u.id;
        const x = LX + i * (tw + 4);
        const y = Y0 + 100;
        const g = hud.add.graphics();
        g.fillStyle(on ? 0x34407a : 0x161b3a).fillRoundedRect(x, y, tw, 28, 6);
        g.lineStyle(1.5, on ? 0xffc977 : 0x343c70).strokeRoundedRect(x, y, tw, 28, 6);
        const t = hud.add.text(x + tw / 2, y + 14, w.name.slice(0, 3), st(13, on ? '#ffc977' : '#aeb6de')).setOrigin(0.5);
        const hit = hud.add.rectangle(x + tw / 2, y + 14, tw, 28, 0, 0.001).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => { tabId = w.id; if (selected?.source === 'equipped') selected = null; dirty = true; });
        dynC.add([g, t, hit]);
      });

      const activeL = curLoadout();
      for (let i = 0; i < LOADOUT_COUNT; i++) {
        const on = i === activeL;
        const lx = LX + 372 + i * 76;
        const ly = Y0 + 100;
        const g = hud.add.graphics();
        g.fillStyle(on ? 0x523c1a : 0x161b3a).fillRoundedRect(lx, ly, 70, 28, 6);
        g.lineStyle(1.5, on ? 0xffd36a : 0x343c70).strokeRoundedRect(lx, ly, 70, 28, 6);
        const t = hud.add.text(lx + 35, ly + 14, `方案${i + 1}`, st(12, on ? '#ffd36a' : '#b8c0e6', BF, { strokeThickness: 2 })).setOrigin(0.5);
        const hit = hud.add.rectangle(lx + 35, ly + 14, 70, 28, 0, 0.001).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => {
          const r = hud.gg.cmd({ type: 'switchLoadout', unitId: u.id, index: i });
          if (r && r.ok) hud.toast(`${u.name} 切换至【方案${i + 1}】`, '#ffd36a');
        });
        dynC.add([g, t, hit]);
      }

      // 2. 当前已穿 4 装备槽 + 属性摘要
      SLOTS.forEach((slot, i) => {
        const sx = LX + i * 150;
        const sy = Y0 + 136;
        const sw = 142;
        const sh = 62;
        const it = eq[slot];
        const isSel = selected && selected.source === 'equipped' && selected.slot === slot;
        const g = hud.add.graphics();
        g.fillStyle(isSel ? 0x2a3366 : 0x141833).fillRoundedRect(sx, sy, sw, sh, 8);
        g.lineStyle(isSel ? 3 : 2, isSel ? 0xffd36a : (it ? qHex(it.q) : 0x343c70)).strokeRoundedRect(sx, sy, sw, sh, 8);
        dynC.add(g);
        if (it) {
          const img = fitImage(hud.add.image(sx + 28, sy + 31, it.tex), 42);
          if (it.tint) img.setTint(parseInt(it.tint, 16));
          const enhTxt = it.enhanceLv ? `+${it.enhanceLv}` : '';
          const nm = hud.add.text(sx + 54, sy + 9, `${it.name.slice(0, 4)}${enhTxt}`, st(12, qColor(it.q), BF, { fontStyle: 'bold', strokeThickness: 2 }));
          const subLine = it.growth
            ? (it.growthType === 'hits'
              ? `阶${it.stage} 挨打${it.hitsTaken || 0}/${it.nextHits || '满'}`
              : `阶${it.stage} 杀${it.kills || 0}/${it.nextKills || '满'}`)
            : `${isArtifact(it) ? '神器' : qName(it.q)}·${shortMainText(it)}`;
          const sub = hud.add.text(sx + 54, sy + 30, subLine, st(11, it.growth ? '#7fe3ff' : '#f3e6c8', BF, { strokeThickness: 2 }));
          dynC.add([img, nm, sub]);
        } else {
          dynC.add(hud.add.text(sx + sw / 2, sy + sh / 2, `${SLOT_SHORT[slot]}（空）`, st(13, '#555d86', BF)).setOrigin(0.5));
        }
        const hit = hud.add.rectangle(sx + sw / 2, sy + sh / 2, sw, sh, 0, 0.001).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => {
          if (it) { selected = { source: 'equipped', slot }; dirty = true; }
        });
        dynC.add(hit);
      });

      const sets = sim.activeSets(u);
      const ts = sim.inv.tomeStats && sim.inv.tomeStats[u.id];
      const mPow = u.kind === 'hero' && sim.mirror ? sim.mirror.totalPowerBonus : 0;
      const temperStr = u.kind === 'hero' && sim.temper
        ? `挨打${sim.temper.hits}次(${sim.temper.currentTitle || '凡躯'})`
        : '';
      const ascStr = u.kind === 'hero' && sim.nanhua && sim.nanhua.ascendLv > 0
        ? `渡劫${sim.nanhua.ascendLv}重`
        : '';
      const extraTag = [
        temperStr,
        ascStr,
        ts && ts.count ? `书卷×${ts.count}` : '',
        mPow > 0 ? `镜像+${mPow}` : '',
        u.awakened ? '⚡30级觉醒' : '',
      ].filter(Boolean).join(' ');
      const statStr = `${u.name}：攻${Math.round(u.stats.atk)} 血${u.maxHp} 防${Math.round(u.stats.def)} 技+${Math.round(u.stats.skillDmg * 100)}%${extraTag ? ` · ${extraTag}` : ''}${sets.length ? ` ✦ ${sets.join(' ')}` : ''}`;
      dynC.add(hud.add.text(LX, Y0 + 202, statStr, st(11, sets.length || extraTag ? '#ffd36a' : '#d8d2f5', BF, {
        strokeThickness: 2, wordWrap: { width: 604, useAdvancedWrap: true },
      })));

      // 3. 分页切换 + 15 格大号背包网格（5×3）
      const isEquipTab = mode === 'equip';
      const arr = isEquipTab ? sim.inv.equipBag : sim.inv.itemBag;
      const totalPages = Math.ceil(arr.length / PAGE_SIZE);
      const curPage = isEquipTab ? eqPage : itPage;
      for (let p = 0; p < totalPages; p++) {
        const on = p === curPage;
        const px = LX + p * 116;
        const py = Y0 + 232;
        const cnt = arr.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).filter(Boolean).length;
        const g = hud.add.graphics();
        g.fillStyle(on ? 0x2a356e : 0x141833).fillRoundedRect(px, py, 108, 26, 6);
        g.lineStyle(1.5, on ? 0x7fe3ff : 0x343c70).strokeRoundedRect(px, py, 108, 26, 6);
        const t = hud.add.text(px + 54, py + 13, `第${p + 1}页 (${cnt})`, st(12, on ? '#7fe3ff' : '#9aa3cf', BF, { strokeThickness: 2 })).setOrigin(0.5);
        const hit = hud.add.rectangle(px + 54, py + 13, 108, 26, 0, 0.001).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => { if (isEquipTab) eqPage = p; else itPage = p; dirty = true; });
        dynC.add([g, t, hit]);
      }
      dynC.add(hud.add.text(LX + 244, Y0 + 234, isEquipTab ? '点装备查看右侧对比卡片，确认后再穿戴/出售' : '道具与唯一魂痕独立存放，绝不挤占装备栏', st(11, '#8d96c4', BF, { strokeThickness: 2 })));

      const cellW = 114;
      const cellH = 82;
      const gapX = 7;
      const gapY = 8;
      const gx0 = LX;
      const gy0 = Y0 + 262;
      const source = isEquipTab ? 'equipBag' : 'itemBag';
      for (let sIdx = 0; sIdx < PAGE_SIZE; sIdx++) {
        const realIdx = curPage * PAGE_SIZE + sIdx;
        if (realIdx >= arr.length) break;
        const col = sIdx % 5;
        const row = Math.floor(sIdx / 5);
        const cx = gx0 + col * (cellW + gapX);
        const cy = gy0 + row * (cellH + gapY);
        const it = arr[realIdx];
        const isSel = selected && selected.source === source && selected.idx === realIdx;
        const g = hud.add.graphics();
        g.fillStyle(isSel ? 0x2a356e : 0x141833).fillRoundedRect(cx, cy, cellW, cellH, 9);
        const bCol = isSel ? 0xffd36a : (it ? (it.kind === 'equip' ? qHex(it.q) : (isUniqueItem(it) ? 0xffd36a : 0x5fe08a)) : 0x2c335c);
        g.lineStyle(isSel ? 3 : 2, bCol).strokeRoundedRect(cx, cy, cellW, cellH, 9);
        dynC.add(g);

        if (it) {
          const img = fitImage(hud.add.image(cx + 26, cy + 36, it.tex), 42);
          if (it.tint) img.setTint(parseInt(it.tint, 16));
          const nmCol = it.kind === 'equip' ? qColor(it.q) : (isUniqueItem(it) ? '#ffd36a' : '#9ff0b8');
          const nm = hud.add.text(cx + 50, cy + 10, it.name.slice(0, 4), st(12, nmCol, BF, { fontStyle: 'bold', strokeThickness: 2 }));
          const enhStr = it.enhanceLv ? ` +${it.enhanceLv}` : '';
          const line2 = it.kind === 'equip'
            ? `${qName(it.q)}${enhStr}${isArtifact(it) ? '·神器' : ''}`
            : (isUniqueItem(it) ? '唯一' : `×${it.n || 1}`);
          const sub = hud.add.text(cx + 50, cy + 30, line2, st(11, it.enhanceLv ? '#ffd36a' : (it.kind === 'equip' ? qColor(it.q) : '#ffd36a'), BF, { strokeThickness: 2 }));
          const line3 = it.kind === 'equip'
            ? (it.growth
              ? (it.growthType === 'hits'
                ? `打${it.hitsTaken || 0}/${it.nextHits || '满'}`
                : `杀${it.kills || 0}/${it.nextKills || '满'}`)
              : shortMainText(it))
            : (isUniqueItem(it) ? '不可售' : `${it.price}钱`);
          const foot = hud.add.text(cx + 50, cy + 50, line3, st(11, it.growth ? '#7fe3ff' : '#d8d2f5', NF, { strokeThickness: 2 }));
          dynC.add([img, nm, sub, foot]);
        } else {
          dynC.add(hud.add.text(cx + cellW / 2, cy + cellH / 2, `${realIdx + 1}`, st(13, '#2d345c', NF)).setOrigin(0.5));
        }
        const hit = hud.add.rectangle(cx + cellW / 2, cy + cellH / 2, cellW, cellH, 0, 0.001).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => {
          if (!it) { selected = null; dirty = true; return; }
          selected = { source, idx: realIdx };
          dirty = true;
        });
        dynC.add(hit);
      }

      drawInspector(u, eq);
    }

    function drawCraftMode() {
      const LX = X0 + 20;
      const CY = Y0 + 100;
      const CH = 434;

      // 左侧：同阶二合一升阶
      const LW = 368;
      const lg = hud.add.graphics();
      lg.fillStyle(0x121633, 0.95).fillRoundedRect(LX, CY, LW, CH, 12);
      lg.lineStyle(2, 0x3d4880).strokeRoundedRect(LX, CY, LW, CH, 12);
      dynC.add(lg);
      dynC.add(hud.add.text(LX + 16, CY + 12, '同阶升阶合成（2合1）', st(18, '#7fe3ff', TF, { strokeThickness: 3 })));
      dynC.add(hud.add.text(LX + 16, CY + 38, '两件同部位同品阶装备 + 铜钱 → 必出高一阶装备', st(11, '#9aa3cf', BF, { strokeThickness: 2 })));

      const tierUps = sim.craft ? sim.craft.tierUps() : [];
      if (!tierUps.length) {
        dynC.add(hud.add.text(LX + LW / 2, CY + 200, '暂无可升阶的成对装备\n\n收集 2 件同部位同品阶装备即可升阶\n建议进【练功房】快速刷取材料！', st(13, '#8d96c4', BF, {
          align: 'center', lineSpacing: 6, wordWrap: { width: LW - 40, useAdvancedWrap: true },
        })).setOrigin(0.5));
      } else {
        tierUps.slice(0, 5).forEach((tu, i) => {
          const y = CY + 66 + i * 70;
          const cg = hud.add.graphics();
          cg.fillStyle(tu.canAfford ? 0x1d2b46 : 0x171b33).fillRoundedRect(LX + 12, y, LW - 24, 62, 9);
          cg.lineStyle(2, tu.canAfford ? 0x5fe08a : 0x3a4068).strokeRoundedRect(LX + 12, y, LW - 24, 62, 9);
          dynC.add(cg);
          dynC.add(hud.add.text(LX + 22, y + 10, tu.label, st(13, qColor(tu.nextQ), BF, { fontStyle: 'bold', strokeThickness: 2 })));
          dynC.add(hud.add.text(LX + 22, y + 34, `持有 ${tu.owned}/${tu.need} · 耗 ${tu.cost} 钱`, st(12, tu.canAfford ? '#9ff0b8' : '#ff8a7a', NF, { strokeThickness: 2 })));
          const btn = makeButton(hud, LX + LW - 58, y + 31, 80, 34, '升阶', () => {
            const r = hud.gg.cmd({ type: 'craftTierUp', slot: tu.slot, q: tu.q });
            if (r && r.ok) hud.toast(`升阶成功！获得【${qName(r.item.q)}·${r.item.name}】`, qColor(r.item.q));
          }, { size: 13, font: BF, primary: tu.canAfford });
          btn.setEnabled(tu.canAfford);
          dynC.add(btn);
        });
      }

      // 右侧：13 件传说神兵 & 上古神器定向锻造（分类筛选 + 分页，每页 2 列 × 3 行）
      const RX = LX + LW + 16;
      const RW = W - 40 - LW - 16;
      const rg = hud.add.graphics();
      rg.fillStyle(0x121633, 0.95).fillRoundedRect(RX, CY, RW, CH, 12);
      rg.lineStyle(2, 0xffc94a, 0.7).strokeRoundedRect(RX, CY, RW, CH, 12);
      dynC.add(rg);
      dynC.add(hud.add.text(RX + 14, CY + 12, '传说神兵 & 上古神器锻造', st(17, '#ffc977', TF, { strokeThickness: 3 })));

      const allList = sim.craft ? sim.craft.recipes() : [];
      const artList = allList.filter((ev) => ev.recipe.artifact || ARTIFACT_IDS.includes(ev.recipe.id));
      const legList = allList.filter((ev) => !ev.recipe.artifact && !ARTIFACT_IDS.includes(ev.recipe.id));
      const filtered = craftFilter === 'artifact' ? artList : craftFilter === 'legend' ? legList : allList;

      const fTabs = [
        { id: 'all', label: `全部(${allList.length})`, w: 72 },
        { id: 'legend', label: `名将(${legList.length})`, w: 72 },
        { id: 'artifact', label: `神器(${artList.length})`, w: 72 },
      ];
      let fx = RX + 236;
      for (const ft of fTabs) {
        const on = craftFilter === ft.id;
        const g2 = hud.add.graphics();
        g2.fillStyle(on ? 0x3b4888 : 0x161b3a).fillRoundedRect(fx, CY + 10, ft.w, 26, 6);
        g2.lineStyle(1.5, on ? 0xffd36a : 0x343c70).strokeRoundedRect(fx, CY + 10, ft.w, 26, 6);
        const t2 = hud.add.text(fx + ft.w / 2, CY + 23, ft.label, st(11, on ? '#ffd36a' : '#b8c0e6', BF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(0.5);
        const h2 = hud.add.rectangle(fx + ft.w / 2, CY + 23, ft.w, 26, 0, 0.001).setInteractive({ useHandCursor: true });
        h2.on('pointerdown', () => { craftFilter = ft.id; craftPage = 0; dirty = true; });
        dynC.add([g2, t2, h2]);
        fx += ft.w + 6;
      }

      const CRAFT_PER_PAGE = 6;
      const craftTotalPages = Math.max(1, Math.ceil(filtered.length / CRAFT_PER_PAGE));
      if (craftPage >= craftTotalPages) craftPage = craftTotalPages - 1;
      const cPrev = makeButton(hud, RX + RW - 102, CY + 23, 30, 24, '◀', () => { if (craftPage > 0) { craftPage--; dirty = true; } }, { size: 11, font: NF });
      cPrev.setEnabled(craftPage > 0);
      const cPageTxt = hud.add.text(RX + RW - 66, CY + 23, `${craftPage + 1}/${craftTotalPages}`, st(11, '#d8d2f5', NF, { fontStyle: 'bold' })).setOrigin(0.5);
      const cNext = makeButton(hud, RX + RW - 30, CY + 23, 30, 24, '▶', () => { if (craftPage < craftTotalPages - 1) { craftPage++; dirty = true; } }, { size: 11, font: NF });
      cNext.setEnabled(craftPage < craftTotalPages - 1);
      dynC.add([cPrev, cPageTxt, cNext]);

      const cw = 322;
      const ch = 122;
      const gx = 10;
      const gy = 8;
      filtered.slice(craftPage * CRAFT_PER_PAGE, (craftPage + 1) * CRAFT_PER_PAGE).forEach((ev, i) => {
        const r = ev.recipe;
        const isArt = !!(r.artifact || ARTIFACT_IDS.includes(r.id));
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = RX + 12 + col * (cw + gx);
        const y = CY + 46 + row * (ch + gy);
        const cg = hud.add.graphics();
        cg.fillStyle(ev.canCraft ? 0x262848 : (isArt ? 0x1b183a : 0x171b36)).fillRoundedRect(x, y, cw, ch, 10);
        cg.lineStyle(2, ev.canCraft ? 0x5fe08a : (isArt ? 0xffd36a : 0x3b4372)).strokeRoundedRect(x, y, cw, ch, 10);
        dynC.add(cg);

        const icon = fitImage(hud.add.image(x + 34, y + 36, r.tex), 52);
        if (r.tint) icon.setTint(parseInt(r.tint, 16));
        dynC.add(icon);
        dynC.add(hud.add.text(x + 68, y + 8, r.name, st(16, isArt ? '#9ff0b8' : '#ffc94a', TF, { strokeThickness: 3 })));
        if (ev.canCraft) {
          dynC.add(hud.add.text(x + cw - 10, y + 10, '✦ 可合成', st(11, '#5fe08a', BF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(1, 0));
        } else if (isArt) {
          dynC.add(hud.add.text(x + cw - 10, y + 10, '上古神器', st(10, '#ffd36a', BF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(1, 0));
        }
        const statPreview = [fmtMod(r.main), ...r.subs.slice(0, 2).map(fmtMod)].join(' · ');
        dynC.add(hud.add.text(x + 68, y + 30, statPreview, st(11, '#f3e6c8', BF, { strokeThickness: 2, wordWrap: { width: cw - 76, useAdvancedWrap: true } })));

        const matStr = ev.mats.map((m) => `${m.label.replace(' ×1', '')}(${m.owned}/${m.need})`).join(' + ');
        dynC.add(hud.add.text(x + 12, y + 66, `材料：${matStr}`, st(11, ev.hasMaterials ? '#9ff0b8' : '#ff9a8a', BF, { strokeThickness: 2, wordWrap: { width: cw - 106, useAdvancedWrap: true } })));
        dynC.add(hud.add.text(x + 12, y + 98, `铜钱：${r.copper} 钱`, st(12, ev.hasCopper ? '#ffd36a' : '#ff6a5a', NF, { fontStyle: 'bold', strokeThickness: 2 })));

        const btn = makeButton(hud, x + cw - 48, y + ch - 24, 82, 34, '锻造', () => {
          const res = hud.gg.cmd({ type: 'craftRecipe', recipeId: r.id });
          if (res && res.ok) {
            hud.toast(`神兵锻成【${res.item.name}】！已放入装备栏`, '#ffd36a');
            dirty = true;
          }
        }, { size: 13, font: BF, primary: ev.canCraft });
        btn.setEnabled(ev.canCraft);
        dynC.add(btn);
      });
    }

    function redraw() {
      dynC.removeAll(true);
      copperTxt.setText(`铜钱 ${sim.copper}`);
      drawTopTabs();
      if (mode === 'craft') drawCraftMode();
      else drawBagMode();
    }

    return {
      c,
      open(arg) {
        if (arg && typeof arg === 'object' && arg.tab) {
          mode = arg.tab;
          if (arg.unitId) tabId = arg.unitId;
          if (arg.craftFilter) craftFilter = arg.craftFilter;
        } else {
          const cu = sim.ctrl;
          tabId = (typeof arg === 'number') ? arg : (cu && cu.kind === 'beast' ? cu.id : sim.hero.id);
          mode = 'equip';
        }
        craftPage = 0;
        selected = null;
        dirty = true;
        ver = -1;
      },
      close() { selected = null; },
      refresh() {
        const selKey = selected ? `${selected.source}:${selected.idx ?? selected.slot}` : '';
        const curSig = `${mode}|${tabId}|${eqPage}|${itPage}|${craftFilter}|${craftPage}|${curLoadout()}|${sim.copper}|${sim.temper?.hits || 0}|${sim.nanhua?.ascendLv || 0}|${sim.nanhua?.enhanceCount || 0}|${selKey}|${wearers(sim).map((u) => u.id).join(',')}`;
        if (dirty || ver !== sim.inv.ver || curSig !== sig) {
          ver = sim.inv.ver;
          sig = curSig;
          dirty = false;
          redraw();
        }
      },
      key(e) {
        const k = e.key;
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
          const list = wearers(sim);
          const i = Math.max(0, list.findIndex((u) => u.id === tabId));
          tabId = list[(i + (k === 'ArrowRight' ? 1 : list.length - 1)) % list.length].id;
          dirty = true;
          return true;
        }
        if (k === 'Enter') { autoEquip(); return true; }
        return false;
      },
      get tabId() { return tabId; },
      setTab(id) { tabId = id; dirty = true; },
      setMode(m) { mode = m; selected = null; dirty = true; },
    };
  },
};

// 常驻小部件（桌面端显示，触屏端收进顶部快捷按钮保持画面清爽）
export const bagWidget = {
  name: 'bagWidget',
  always: true,
  create(hud) {
    const sim = hud.sim;
    const c = hud.add.container(16 - 1050, 112 - 246);
    hud.sim.on('bagFull', ({ item, copper }) => hud.toast(`${item.kind === 'equip' ? '装备栏' : '道具栏'}已满：${item.name} 自动卖出 +${copper} 钱`, '#ffd36a'));
    hud.sim.on('setActive', ({ unit, set, pieces }) => hud.toast(`${unit.name} 激活 ${IT.sets[set].name}${pieces}件套：${IT.sets[set][pieces === 4 ? 'b4' : 'b2'].text}`, IT.sets[set].color));
    if (touch.enabled) {
      c.setVisible(false);
      return { c, refresh() {} };
    }
    const g = hud.add.graphics();
    const title = hud.add.text(1062, 254, '', st(14, '#f3e6c8', BF));
    const key = hud.add.text(1254, 254, '[B] 行囊', st(12, '#7fe3ff', NF)).setOrigin(1, 0);
    const lines = hud.add.text(1062, 278, '', st(12, '#ffc977', BF, { lineSpacing: 3, wordWrap: { width: 194, useAdvancedWrap: true } }));
    const hit = hud.add.rectangle(1158, 270, 216, 44, 0, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => hud.togglePanel('bag'));
    c.add([g, title, key, lines, hit]);
    let sig = '';
    return {
      c,
      refresh() {
        const inv = sim.inv;
        if (!inv) return;
        const eqN = inv.equipBag.filter(Boolean).length;
        const itN = inv.itemBag.filter(Boolean).length;
        const rows = [];
        for (const u of wearers(sim)) { const a = sim.activeSets(u); if (a.length) rows.push(`${u.name}：${a.join(' ')}`); }
        const s = `${eqN}|${itN}|${rows.join('/')}`;
        if (s === sig) return;
        sig = s;
        title.setText(`装 ${eqN}/${EQUIP_BAG_SIZE} · 具 ${itN}/${ITEM_BAG_SIZE}`).setColor(eqN >= EQUIP_BAG_SIZE ? '#ff8a7a' : '#f3e6c8');
        const shown = rows.slice(0, 2);
        lines.setText(shown.join('\n'));
        const h = 34 + (shown.length ? shown.length * 18 + 4 : 0);
        g.clear().fillStyle(0x0f1128, 0.82).fillRoundedRect(1050, 246, 216, h, 12).lineStyle(2.5, INK_N).strokeRoundedRect(1050, 246, 216, h, 12);
      },
    };
  },
};
