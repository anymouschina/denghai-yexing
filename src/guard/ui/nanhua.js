// 南华仙人面板（O 或点击世界中的南华仙人）：
// - 消耗铜钱强化已穿戴或装备栏装备（+0 → +15，预览下级属性提升）
// - 消耗铜钱与等级门槛进行四重渡劫飞升（永久大幅提升攻/血/防/技伤）
// - 快捷直达 13 件传说神兵（含名将神兵与 4 件上古神器）锻造入口
import { TF, BF, NF, INK } from '../../fonts.js';
import { makeButton, drawPanel } from '../../widgets.js';
import {
  ITEMS as IT, SLOTS, ARTIFACT_IDS, qColor, qHex, qName, fmtMod, itemMods,
} from '../sim/systems/loot.js';
import { wearers } from './bag.js';

const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({
  fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 3, ...extra,
});

const X0 = 100;
const Y0 = 64;
const W = 1080;
const H = 592;
const SLOT_SHORT = { weapon: '武器', armor: '护甲', accessory: '饰品', treasure: '法宝' };
const PAGE_SIZE = 5;
const ART_TAG = {
  nuwa_stone: '涅槃复活',
  donghuang_bell: '范围沉默',
  fuxi_qin: '群疗加速',
  pangu_axe: '破甲沉默',
  xuanyuan_sword: '百分比斩妖',
};

function fitImage(img, box) {
  const fr = img.frame;
  img.setScale(box / Math.max(fr.width || box, fr.height || box));
  return img;
}

function isArtifact(it) {
  return !!(it && (it.artifact || ARTIFACT_IDS.includes(it.legendaryId) || ARTIFACT_IDS.includes(it.id)));
}

function collectTargets(sim, filter) {
  const out = [];
  if (filter !== 'bag') {
    for (const u of wearers(sim)) {
      const eq = sim.inv?.equip?.[u.id];
      if (!eq) continue;
      for (const slot of SLOTS) {
        const it = eq[slot];
        if (it && it.kind === 'equip') {
          out.push({
            key: `eq:${u.id}:${slot}`,
            kind: 'equipped',
            unit: u,
            slot,
            item: it,
            tag: `${u.name.slice(0, 2)}·已穿${SLOT_SHORT[slot] || ''}`,
          });
        }
      }
    }
  }
  if (filter !== 'equipped') {
    const bag = sim.inv?.equipBag || [];
    for (let i = 0; i < bag.length; i++) {
      const it = bag[i];
      if (it && it.kind === 'equip') {
        out.push({
          key: `bag:${i}`,
          kind: 'bag',
          bagIdx: i,
          item: it,
          tag: `装备栏#${i + 1}·${SLOT_SHORT[it.slot] || ''}`,
        });
      }
    }
  }
  return out;
}

function formatModDiff(curM, nextM) {
  if (!curM || !nextM) return '';
  if (nextM.add !== undefined && curM.add !== undefined) {
    const d = Math.round((nextM.add - curM.add) * 10) / 10;
    return `+${d % 1 ? d.toFixed(1) : Math.round(d)}`;
  }
  if (nextM.mul !== undefined && curM.mul !== undefined) {
    const d = (nextM.mul - curM.mul) * 100;
    return `+${d.toFixed(1).replace(/\.0$/, '')}%`;
  }
  return '';
}

export default {
  name: 'nanhua',
  key: 'o',
  create(hud) {
    const sim = hud.sim;
    const c = hud.add.container(0, 0);
    const dim = hud.add.rectangle(640, 360, 1280, 720, 0x05061a, 0.62).setInteractive();
    const bg = drawPanel(hud.add.graphics(), X0, Y0, W, H, { glow: 0x7fe3ff });
    c.add([dim, bg]);

    const title = hud.add.text(X0 + 20, Y0 + 12, '南华仙人 · 神兵强化 & 金币渡劫', st(25, '#ffd36a', TF, { strokeThickness: 5 }));
    const pausePill = hud.add.text(X0 + 392, Y0 + 18, '⏸ 战斗已暂停 · 铜钱强化装备 / 渡劫突破', st(12, '#9ff0b8', BF, {
      strokeThickness: 2, backgroundColor: '#163828', padding: { x: 8, y: 3 },
    }));
    const copperTxt = hud.add.text(X0 + W - 244, Y0 + 27, '', st(17, '#ffd36a', NF, { fontStyle: 'bold' })).setOrigin(1, 0.5);
    const craftTopBtn = makeButton(hud, X0 + W - 166, Y0 + 28, 134, 34, '神兵锻造 [K]', () => {
      hud.togglePanel('bag', { tab: 'craft' });
    }, { size: 13, font: BF, primary: true });
    const closeBtn = makeButton(hud, X0 + W - 52, Y0 + 28, 76, 34, '关闭 [Esc]', () => hud.closePanel(), { size: 12, font: BF });
    c.add([title, pausePill, copperTxt, craftTopBtn, closeBtn]);

    const dynC = hud.add.container(0, 0);
    c.add(dynC);

    let filter = 'all'; // 'all' | 'equipped' | 'bag'
    let page = 0;
    let sig = '';

    function rebuild() {
      dynC.removeAll(true);
      const N = sim.nanhua;
      copperTxt.setText(`铜钱 ${sim.copper}`);

      const LX = X0 + 20;
      const LY = Y0 + 62;
      const LW = 602;
      const LH = 510;
      const lg = hud.add.graphics();
      lg.fillStyle(0x121633, 0.96).fillRoundedRect(LX, LY, LW, LH, 12);
      lg.lineStyle(2.5, 0x3d4880).strokeRoundedRect(LX, LY, LW, LH, 12);
      dynC.add(lg);

      const maxLv = N?.cfg?.enhanceMax ?? 15;
      const mainPct = Math.round((N?.cfg?.mainPerLv ?? 0.15) * 100);
      const subPct = Math.round((N?.cfg?.subPerLv ?? 0.10) * 100);
      dynC.add(hud.add.text(LX + 14, LY + 10, `装备金币强化 (+0 → +${maxLv})`, st(18, '#7fe3ff', TF, { strokeThickness: 3 })));
      dynC.add(hud.add.text(LX + 14, LY + 34, `每强化 1 级：主属性 +${mainPct}%、副属性 +${subPct}%（支持已穿戴与装备栏）`, st(11, '#9aa3cf', BF, { strokeThickness: 2 })));

      const allItems = collectTargets(sim, 'all');
      const eqItems = collectTargets(sim, 'equipped');
      const bagItems = collectTargets(sim, 'bag');
      const list = filter === 'equipped' ? eqItems : filter === 'bag' ? bagItems : allItems;

      const tabs = [
        { id: 'all', label: `全部 (${allItems.length})`, w: 96 },
        { id: 'equipped', label: `已穿戴 (${eqItems.length})`, w: 106 },
        { id: 'bag', label: `装备栏 (${bagItems.length})`, w: 106 },
      ];
      let tx = LX + 14;
      for (const tb of tabs) {
        const on = filter === tb.id;
        const g = hud.add.graphics();
        g.fillStyle(on ? 0x344482 : 0x181d3e).fillRoundedRect(tx, LY + 56, tb.w, 28, 7);
        g.lineStyle(1.8, on ? 0xffd36a : 0x343c70).strokeRoundedRect(tx, LY + 56, tb.w, 28, 7);
        const t = hud.add.text(tx + tb.w / 2, LY + 70, tb.label, st(12, on ? '#ffd36a' : '#b8c0e6', BF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(0.5);
        const hit = hud.add.rectangle(tx + tb.w / 2, LY + 70, tb.w, 28, 0, 0.001).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => { filter = tb.id; page = 0; sig = ''; });
        dynC.add([g, t, hit]);
        tx += tb.w + 8;
      }

      const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      if (page >= totalPages) page = totalPages - 1;
      const prevBtn = makeButton(hud, LX + LW - 116, LY + 70, 34, 26, '◀', () => {
        if (page > 0) { page--; sig = ''; }
      }, { size: 12, font: NF });
      prevBtn.setEnabled(page > 0);
      const pageTxt = hud.add.text(LX + LW - 74, LY + 70, `${page + 1}/${totalPages}`, st(12, '#d8d2f5', NF, { fontStyle: 'bold' })).setOrigin(0.5);
      const nextBtn = makeButton(hud, LX + LW - 32, LY + 70, 34, 26, '▶', () => {
        if (page < totalPages - 1) { page++; sig = ''; }
      }, { size: 12, font: NF });
      nextBtn.setEnabled(page < totalPages - 1);
      dynC.add([prevBtn, pageTxt, nextBtn]);

      const slice = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      if (!slice.length) {
        dynC.add(hud.add.text(LX + LW / 2, LY + 275, '当前分类下暂无可强化装备\n击败妖物、进入练功房或秘境获取装备后再来强化', st(15, '#8d96c4', BF, {
          align: 'center', lineSpacing: 8,
        })).setOrigin(0.5));
      } else {
        const rx = LX + 12;
        const rw = LW - 24;
        const rh = 74;
        slice.forEach((entry, idx) => {
          const it = entry.item;
          const ry = LY + 94 + idx * (rh + 7);
          const lv = it.enhanceLv || 0;
          const isMax = lv >= maxLv;
          const cost = N && N.enhanceCost ? N.enhanceCost(it) : null;
          const canAfford = !isMax && cost !== null && sim.copper >= cost;
          const art = isArtifact(it);

          const rg = hud.add.graphics();
          rg.fillStyle(entry.kind === 'equipped' ? 0x1a2248 : 0x151936, 0.96).fillRoundedRect(rx, ry, rw, rh, 9);
          rg.lineStyle(2, art ? 0xffd36a : qHex(it.q)).strokeRoundedRect(rx, ry, rw, rh, 9);

          const ib = hud.add.graphics();
          ib.fillStyle(0x0f132b).fillRoundedRect(rx + 10, ry + 11, 52, 52, 8);
          ib.lineStyle(1.8, qHex(it.q)).strokeRoundedRect(rx + 10, ry + 11, 52, 52, 8);
          const img = fitImage(hud.add.image(rx + 36, ry + 37, it.tex), 42);
          if (it.tint) img.setTint(parseInt(it.tint, 16));
          dynC.add([rg, ib, img]);

          const lvTag = lv > 0 ? ` +${lv}` : '';
          const artBadge = art ? ' [上古神器]' : '';
          const setBadge = it.set && it.set !== 'plain' && IT.sets[it.set] ? `·${IT.sets[it.set].name}` : '';
          const titleStr = `${it.name}${lvTag}${artBadge}`;
          dynC.add(hud.add.text(rx + 72, ry + 7, titleStr, st(15, qColor(it.q), BF, { fontStyle: 'bold', strokeThickness: 2 })));
          dynC.add(hud.add.text(rx + rw - 138, ry + 9, `${qName(it.q)}${setBadge} · ${entry.tag}`, st(11, '#9aa3cf', BF, { strokeThickness: 2 })).setOrigin(1, 0));

          const curMods = itemMods(it);
          const curStr = curMods.slice(0, 3).map(fmtMod).join(' · ');
          dynC.add(hud.add.text(rx + 72, ry + 29, `当前：${curStr}`, st(11, '#f3e6c8', BF, { strokeThickness: 2 })));

          if (!isMax) {
            const nextMods = itemMods({ ...it, enhanceLv: lv + 1 });
            const delta = formatModDiff(curMods[0], nextMods[0]);
            const nextMain = nextMods[0] ? fmtMod(nextMods[0]) : '';
            dynC.add(hud.add.text(rx + 72, ry + 48, `下级(+${lv + 1})：${nextMain}（${delta}） · 副属性+${subPct}%`, st(11, '#9ff0b8', BF, { strokeThickness: 2 })));
          } else {
            dynC.add(hud.add.text(rx + 72, ry + 48, `✦ 已达最高强化 (+${maxLv})`, st(11, '#ffd36a', BF, { fontStyle: 'bold', strokeThickness: 2 })));
          }

          const btnLbl = isMax ? `已满级` : `强化 ${cost}钱`;
          const btn = makeButton(hud, rx + rw - 68, ry + rh / 2, 118, 38, btnLbl, () => {
            const cmd = entry.kind === 'equipped'
              ? { type: 'enhanceEquip', unitId: entry.unit.id, slot: entry.slot }
              : { type: 'enhanceEquip', bagIdx: entry.bagIdx };
            const r = hud.gg.cmd(cmd);
            if (r && r.ok) {
              hud.toast(`强化成功！【${r.item.name}】升至 +${r.enhanceLv}（-${r.cost} 钱）`, '#ffd36a');
              sig = '';
            }
          }, { size: 13, font: BF, primary: canAfford });
          btn.setEnabled(canAfford);
          dynC.add(btn);
        });
      }

      // 右侧上卡：金币渡劫飞升
      const RX = LX + LW + 16;
      const RY = Y0 + 62;
      const RW = W - 40 - LW - 16;
      const RH1 = 290;
      const ag = hud.add.graphics();
      ag.fillStyle(0x181738, 0.96).fillRoundedRect(RX, RY, RW, RH1, 12);
      ag.lineStyle(2.5, 0xffc94a, 0.85).strokeRoundedRect(RX, RY, RW, RH1, 12);
      dynC.add(ag);

      const h = sim.hero;
      const tiers = N?.cfg?.ascendTiers || [];
      const curAsc = N?.ascendLv || 0;
      const nextTier = N?.nextAscend ? N.nextAscend() : null;
      const bonus = N?.bonus || { atk: 0, maxHp: 0, def: 0, skillDmg: 0 };
      const curTierObj = curAsc > 0 ? tiers[curAsc - 1] : null;

      dynC.add(hud.add.text(RX + 14, RY + 10, '金币渡劫飞升', st(19, '#ffd36a', TF, { strokeThickness: 4 })));
      dynC.add(hud.add.text(RX + RW - 14, RY + 13, `境界 ${curAsc}/${tiers.length} · ${curTierObj ? curTierObj.name : '凡躯境'}`, st(12, curAsc > 0 ? '#ffd36a' : '#9aa3cf', BF, { fontStyle: 'bold' })).setOrigin(1, 0));
      dynC.add(hud.add.text(RX + 14, RY + 38, `${h.name} Lv.${h.lv} · 永久加成：攻+${bonus.atk}  血+${bonus.maxHp}  防+${bonus.def}  技伤+${Math.round((bonus.skillDmg || 0) * 100)}%`, st(11, '#9ff0b8', BF, {
        strokeThickness: 2, wordWrap: { width: RW - 28, useAdvancedWrap: true },
      })));

      tiers.forEach((tr, i) => {
        const rowY = RY + 72 + i * 28;
        const done = i < curAsc;
        const isNext = i === curAsc;
        const tg = hud.add.graphics();
        tg.fillStyle(done ? 0x1d3b2c : isNext ? 0x2c2548 : 0x141730).fillRoundedRect(RX + 12, rowY, RW - 24, 24, 6);
        tg.lineStyle(1.5, done ? 0x5fe08a : isNext ? 0xffd36a : 0x2e3562).strokeRoundedRect(RX + 12, rowY, RW - 24, 24, 6);
        dynC.add(tg);
        const mark = done ? '✔' : isNext ? '✦' : '○';
        const col = done ? '#9ff0b8' : isNext ? '#ffd36a' : '#7f86b8';
        dynC.add(hud.add.text(RX + 20, rowY + 12, `${mark} ${tr.name}`, st(12, col, BF, { fontStyle: 'bold', strokeThickness: 2 })).setOrigin(0, 0.5));
        dynC.add(hud.add.text(RX + RW - 20, rowY + 12, `Lv.${tr.lv} · ${tr.cost}钱 · 攻+${tr.atk} 血+${tr.maxHp}`, st(11, done ? '#9ff0b8' : '#d8d2f5', NF, { strokeThickness: 2 })).setOrigin(1, 0.5));
      });

      if (nextTier) {
        const lvOk = h.lv >= nextTier.lv;
        const coinOk = sim.copper >= nextTier.cost;
        const canAsc = !!(N?.canAscend ? N.canAscend() : (h.alive && lvOk && coinOk));
        dynC.add(hud.add.text(RX + 14, RY + 190, `突破门槛：英雄 Lv.${h.lv}/${nextTier.lv} ${lvOk ? '✔' : '✘'}   ·   消耗：${nextTier.cost} 铜钱 ${coinOk ? '✔' : '✘'}`, st(12, canAsc ? '#ffd36a' : '#ff8a7a', BF, { fontStyle: 'bold', strokeThickness: 2 })));
        dynC.add(hud.add.text(RX + 14, RY + 210, `飞升赐福：攻+${nextTier.atk} · 血+${nextTier.maxHp} · 防+${nextTier.def} · 技伤+${Math.round(nextTier.skillDmg * 100)}%`, st(11, '#f3e6c8', BF, { strokeThickness: 2 })));
        const ascBtn = makeButton(hud, RX + RW / 2, RY + 258, 224, 40, `渡劫突破 (${nextTier.cost}钱)`, () => {
          const r = hud.gg.cmd({ type: 'ascendHero' });
          if (r && r.ok) {
            hud.toast(`渡劫成功！【${r.tier.name}】永久属性已生效`, '#ffd36a');
            sig = '';
          }
        }, { size: 15, font: BF, primary: canAsc });
        ascBtn.setEnabled(canAsc);
        dynC.add(ascBtn);
      } else {
        dynC.add(hud.add.text(RX + RW / 2, RY + 236, '✦ 已登四重飞升绝巅 · 万法通神！', st(15, '#ffd36a', TF, { strokeThickness: 3 })).setOrigin(0.5));
      }

      // 右侧下卡：传说神兵与上古神器锻造入口（展示 13 件配方概览与直达）
      const RY2 = RY + RH1 + 12;
      const RH2 = LH - RH1 - 12;
      const cg = hud.add.graphics();
      cg.fillStyle(0x131b3a, 0.96).fillRoundedRect(RX, RY2, RW, RH2, 12);
      cg.lineStyle(2.5, 0x5fe08a, 0.85).strokeRoundedRect(RX, RY2, RW, RH2, 12);
      dynC.add(cg);

      const recipes = sim.craft ? sim.craft.recipes() : [];
      const artList = recipes.filter((ev) => ev.recipe.artifact || ARTIFACT_IDS.includes(ev.recipe.id));
      const legCnt = recipes.length - artList.length;
      const craftReady = sim.craft ? sim.craft.craftableCount() : 0;

      dynC.add(hud.add.text(RX + 14, RY2 + 10, '传说神兵 & 上古神器锻造', st(17, '#ffd36a', TF, { strokeThickness: 3 })));
      dynC.add(hud.add.text(RX + 14, RY2 + 34, `共 ${recipes.length} 件（名将神兵 ${legCnt} + 上古神器 ${artList.length}）· 当前可造 ${craftReady} 项`, st(11, craftReady > 0 ? '#9ff0b8' : '#b8c0e6', BF, { strokeThickness: 2 })));

      artList.slice(0, 4).forEach((ev, i) => {
        const r = ev.recipe;
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cw = (RW - 34) / 2;
        const ch = 44;
        const cx = RX + 12 + col * (cw + 10);
        const cy = RY2 + 56 + row * (ch + 7);
        const ag2 = hud.add.graphics();
        ag2.fillStyle(ev.canCraft ? 0x24304a : 0x171c3a).fillRoundedRect(cx, cy, cw, ch, 8);
        ag2.lineStyle(1.6, ev.canCraft ? 0x5fe08a : 0x455088).strokeRoundedRect(cx, cy, cw, ch, 8);
        const ico = fitImage(hud.add.image(cx + 22, cy + 22, r.tex), 30);
        if (r.tint) ico.setTint(parseInt(r.tint, 16));
        const nm = hud.add.text(cx + 42, cy + 6, r.name, st(13, '#ffd36a', BF, { fontStyle: 'bold', strokeThickness: 2 }));
        const sub2 = hud.add.text(cx + 42, cy + 24, `${ART_TAG[r.id] || '神器'} · ${ev.canCraft ? '可锻造' : `${r.copper}钱`}`, st(10, ev.canCraft ? '#9ff0b8' : '#9aa3cf', BF, { strokeThickness: 2 }));
        const hit = hud.add.rectangle(cx + cw / 2, cy + ch / 2, cw, ch, 0, 0.001).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => hud.togglePanel('bag', { tab: 'craft', craftFilter: 'artifact' }));
        dynC.add([ag2, ico, nm, sub2, hit]);
      });

      const goCraftBtn = makeButton(hud, RX + 108, RY2 + RH2 - 26, 186, 34, `神兵锻造 (${recipes.length}件)`, () => {
        hud.togglePanel('bag', { tab: 'craft', craftFilter: 'all' });
      }, { size: 13, font: BF, primary: true });
      const goArtBtn = makeButton(hud, RX + RW - 104, RY2 + RH2 - 26, 174, 34, `上古神器 (${artList.length}件)`, () => {
        hud.togglePanel('bag', { tab: 'craft', craftFilter: 'artifact' });
      }, { size: 13, font: BF });
      dynC.add([goCraftBtn, goArtBtn]);
    }

    return {
      c,
      open() {
        page = 0;
        sig = '';
        this.refresh();
      },
      close() {},
      refresh() {
        const N = sim.nanhua;
        const curSig = `${filter}|${page}|${sim.copper}|${sim.inv?.ver || 0}|${sim.hero?.lv || 1}|${N?.enhanceCount || 0}|${N?.ascendLv || 0}|${wearers(sim).map((u) => u.id).join(',')}`;
        if (curSig !== sig) {
          sig = curSig;
          rebuild();
        }
      },
      key(e) {
        const k = (e.key || '').toLowerCase();
        if (k === 'k') {
          hud.togglePanel('bag', { tab: 'craft' });
          return true;
        }
        return false;
      },
    };
  },
};
