// 《守卫剑阁》剧情与世界观 UI：
// 1) storyStrip（常驻非阻塞对白条）：展示当前触发的剧情台词（孔明/英雄/南华/司马懿/四圣兽/BOSS），点击即可跳过，不阻断操作
// 2) storyPanel（「剑阁录 [I]」完整设定与剧情面板）：剧情纪要与对话日志 / 剑阁世界观与人物志 / 神兽与名将妖录
import { TF, BF, NF, INK } from '../../fonts.js';
import { makeButton, drawPanel } from '../../widgets.js';
import STORY from '../data/story.json' with { type: 'json' };
import { touch } from '../../touch.js';

const st = (size, color = '#f3e6c8', font = BF, extra = {}) => ({
  fontFamily: font, fontSize: `${size}px`, color, stroke: INK, strokeThickness: 3, ...extra,
});

function portraitForSpeaker(hud, speaker) {
  const s = String(speaker || '');
  const map = [
    [/孔明|诸葛/, 'g_kongming'],
    [/南华/, 'g_npc_nanhua'],
    [/陈老汉|猎人/, 'g_npc_hunter'],
    [/司马/, 'g_boss_simayi'],
    [/关羽|武圣/, 'g_hero_guanyu'],
    [/旱魃|项羽/, 'g_boss_hanba'],
    [/夜帝|刑天/, 'g_boss_yedi'],
    [/老祖/, 'boss'],
    [/吕达|山贼/, 'g_enemy_bandit'],
    [/白虎/, 'g_beast_baihu'],
    [/朱雀/, 'g_beast_zhuque'],
    [/玄武/, 'g_beast_xuanwu'],
    [/青龙/, 'g_beast_qinglong'],
    [/麒麟/, 'g_beast_qilin'],
  ];
  for (const [re, key] of map) {
    if (re.test(s) && hud.textures.exists(key)) return key;
  }
  const heroKey = hud.sim && hud.sim.hero && hud.sim.hero.def && (hud.sim.hero.def.portrait || hud.sim.hero.def.tex);
  if (heroKey && hud.textures.exists(heroKey)) return heroKey;
  return hud.textures.exists('g_kongming') ? 'g_kongming' : null;
}

// ---------------- 1) 常驻非阻塞剧情对白条 ----------------
export const storyStrip = {
  name: 'storyStrip',
  always: true,
  create(hud) {
    const c = hud.add.container(0, 0).setDepth(520).setVisible(false);
    const W = touch.enabled ? 720 : 770;
    const H = touch.enabled ? 68 : 66;
    const x = Math.round((1280 - W) / 2);
    const y = touch.enabled ? 98 : 104;

    const bg = hud.add.graphics();
    const avatar = hud.add.image(x + 35, y + H / 2, 'g_kongming').setVisible(false);
    const badge = hud.add.text(x + 70, y + 12, '', st(15, '#ffd36a', TF, { fontStyle: 'bold' }));
    const role = hud.add.text(x + 70, y + 37, '', st(11, '#b8b0cc'));
    const body = hud.add.text(x + 206, y + 12, '', st(14, '#f7efdc', BF, { wordWrap: { width: W - 236, useAdvancedWrap: true }, lineSpacing: 2 }));
    const skipHint = hud.add.text(x + W - 14, y + H - 10, '点击跳过 ›', st(11, '#9aa3cf')).setOrigin(1, 1);

    const hit = hud.add.rectangle(x + W / 2, y + H / 2, W, H, 0x000000, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', (p) => {
      if (p && p.event && p.event.stopPropagation) p.event.stopPropagation();
      hud.gg.cmd({ type: 'skipStory' });
    });

    c.add([bg, avatar, badge, role, body, skipHint, hit]);

    let lastSig = '';
    const refresh = () => {
      const S = hud.sim.story;
      const a = S && S.active;
      if (!a || hud.panel) {
        if (c.visible) c.setVisible(false);
        return;
      }
      if (!c.visible) c.setVisible(true);
      const sig = `${a.speaker}|${a.text}`;
      if (sig === lastSig) return;
      lastSig = sig;
      const accent = Number.parseInt(String(a.color || '#ffd36a').replace('#', ''), 16) || 0xffd36a;
      bg.clear();
      bg.fillStyle(0x101325, 0.90).fillRoundedRect(x, y, W, H, 12);
      bg.lineStyle(2, accent, 0.92).strokeRoundedRect(x, y, W, H, 12);
      bg.fillStyle(accent, 0.20).fillRoundedRect(x + 6, y + 6, 188, H - 12, 8);
      bg.fillStyle(0x0b0d18, 0.85).fillRoundedRect(x + 10, y + 8, 50, H - 16, 8);
      bg.lineStyle(1.5, accent, 0.78).strokeRoundedRect(x + 10, y + 8, 50, H - 16, 8);
      const pk = portraitForSpeaker(hud, a.speaker);
      if (pk) {
        avatar.setTexture(pk).setVisible(true);
        const tw = Math.max(1, avatar.width);
        const th = Math.max(1, avatar.height);
        const fit = Math.min(44 / tw, (H - 22) / th);
        avatar.setScale(fit).setPosition(x + 35, y + H / 2);
      } else {
        avatar.setVisible(false);
      }
      badge.setText(a.speaker).setColor(a.color || '#ffd36a');
      role.setText(a.role || '剑阁剧情');
      body.setText(a.text);
    };

    return { c, refresh };
  },
};

// ---------------- 2) 剑阁录 [I] 面板 ----------------
export default {
  name: 'story',
  key: 'i',
  create(hud) {
    const c = hud.add.container(0, 0).setDepth(610).setVisible(false);
    const W = 940;
    const H = 566;
    const X = Math.round((1280 - W) / 2);
    const Y = Math.round((720 - H) / 2);

    const bg = hud.add.graphics();
    drawPanel(bg, X, Y, W, H, 16);
    c.add(bg);

    c.add(hud.add.text(X + 26, Y + 18, `剑阁录 · ${STORY.title}`, st(24, '#ffd36a', TF)));
    const actBadge = hud.add.text(X + W - 110, Y + 22, '', st(14, '#7fe3ff', BF, { fontStyle: 'bold' })).setOrigin(1, 0);
    c.add(actBadge);

    const closeBtn = makeButton(hud, X + W - 54, Y + 32, 68, 30, '关闭', () => hud.closePanel(), { fontSize: 13 });
    c.add(closeBtn);

    let tab = 'acts'; // 'acts' | 'world' | 'codex'
    const tabDefs = [
      { id: 'acts', label: '五幕剧情与纪要' },
      { id: 'world', label: '剑阁世界观与英杰' },
      { id: 'codex', label: '神兽与名将妖录' },
    ];
    const tabBtns = [];
    tabDefs.forEach((td, i) => {
      const bx = X + 112 + i * 184;
      const by = Y + 66;
      const btn = makeButton(hud, bx, by, 172, 32, td.label, () => {
        tab = td.id;
        refresh();
      }, { fontSize: 14 });
      c.add(btn);
      tabBtns.push({ id: td.id, btn });
    });

    const body = hud.add.container(0, 0);
    c.add(body);

    const clearBody = () => {
      body.removeAll(true);
    };

    const renderActs = () => {
      const S = hud.sim.story;
      const curWave = Math.max(1, hud.sim.wave ? hud.sim.wave.n : 1);
      const curActId = S ? S.act : 1;

      // 左侧：五幕 + 无尽总览
      const lx = X + 24;
      let ly = Y + 96;
      body.add(hud.add.text(lx, ly, '主线五幕进程', st(16, '#ffd36a', TF)));
      ly += 26;
      for (const act of (STORY.acts || [])) {
        const active = act.id === curActId;
        const done = curWave > act.waves[1];
        const cardG = hud.add.graphics();
        cardG.fillStyle(active ? 0x262d4d : 0x16192c, 0.92).fillRoundedRect(lx, ly, 430, 68, 8);
        cardG.lineStyle(active ? 2 : 1, active ? 0xffd36a : (done ? 0x5fe08a : 0x454e75), 0.9).strokeRoundedRect(lx, ly, 430, 68, 8);
        body.add(cardG);
        const tag = done ? '✓ 已通关' : (active ? '▶ 进行中' : `第${act.waves[0]}-${act.waves[1] >= 999 ? '∞' : act.waves[1]}波`);
        const tagColor = done ? '#5fe08a' : (active ? '#ffd36a' : '#9aa3cf');
        body.add(hud.add.text(lx + 12, ly + 7, act.name, st(14, active ? '#ffd36a' : '#f3e6c8', TF)));
        body.add(hud.add.text(lx + 418, ly + 8, tag, st(12, tagColor)).setOrigin(1, 0));
        body.add(hud.add.text(lx + 12, ly + 29, act.summary, st(11, '#d2cce0', BF, { wordWrap: { width: 406, useAdvancedWrap: true }, lineSpacing: 2 })));
        ly += 74;
      }

      // 右侧：本局剧情对白日志
      const rx = X + 474;
      let ry = Y + 96;
      body.add(hud.add.text(rx, ry, '本局剧情纪要（最新在前）', st(16, '#7fe3ff', TF)));
      ry += 26;
      const logs = (S && S.log) ? [...S.log].reverse().slice(0, 8) : [];
      if (!logs.length) {
        body.add(hud.add.text(rx, ry + 12, '暂无剧情记录，推进波次或探索秘境将触发角色对白。', st(13, '#9aa3cf')));
      } else {
        for (const item of logs) {
          const headT = hud.add.text(rx + 10, ry + 6, `${item.speaker} · 第${item.wave}波`, st(12, item.color || '#ffd36a', BF, { fontStyle: 'bold' }));
          const bodyT = hud.add.text(rx + 10, ry + 24, item.text, st(11, '#efe7d2', BF, { wordWrap: { width: 422, useAdvancedWrap: true }, lineSpacing: 2 }));
          const cardH = Math.max(48, Math.ceil(24 + bodyT.height + 8));
          if (ry + cardH > Y + H - 12) {
            headT.destroy();
            bodyT.destroy();
            break;
          }
          const g = hud.add.graphics();
          g.fillStyle(0x14182b, 0.9).fillRoundedRect(rx, ry, 442, cardH, 8);
          g.lineStyle(1, 0x3b446b, 0.8).strokeRoundedRect(rx, ry, 442, cardH, 8);
          body.add([g, headT, bodyT]);
          ry += cardH + 6;
        }
      }
    };

    const renderWorld = () => {
      const lx = X + 24;
      let ly = Y + 96;
      body.add(hud.add.text(lx, ly, '剑阁背景 · 七星续命之劫', st(16, '#ffd36a', TF)));
      ly += 26;
      const g = hud.add.graphics();
      g.fillStyle(0x16192c, 0.92).fillRoundedRect(lx, ly, 436, 224, 10);
      g.lineStyle(1.5, 0x4b5582, 0.9).strokeRoundedRect(lx, ly, 436, 224, 10);
      body.add(g);
      let py = ly + 10;
      for (const p of (STORY.worldLore || [])) {
        const t = hud.add.text(lx + 14, py, p, st(11, '#ebe2cc', BF, { wordWrap: { width: 408, useAdvancedWrap: true }, lineSpacing: 2 }));
        body.add(t);
        py += t.height + 6;
      }

      // 左侧下方：四位守阁英雄小传
      let hy = ly + 236;
      body.add(hud.add.text(lx, hy, '四方守阁英杰', st(15, '#7fe3ff', TF)));
      hy += 24;
      const heroEntries = Object.entries(STORY.heroes || {});
      heroEntries.forEach(([hid, h], idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const cx = lx + col * 222;
        const cy = hy + row * 88;
        const isCur = hud.sim.heroId === hid;
        const hg = hud.add.graphics();
        hg.fillStyle(isCur ? 0x262e52 : 0x15182b, 0.92).fillRoundedRect(cx, cy, 214, 82, 8);
        hg.lineStyle(isCur ? 2 : 1, isCur ? 0xffd36a : 0x454e75, 0.9).strokeRoundedRect(cx, cy, 214, 82, 8);
        body.add(hg);
        body.add(hud.add.text(cx + 10, cy + 6, `${h.title}${isCur ? '（当前）' : ''}`, st(12, isCur ? '#ffd36a' : '#7fe3ff', BF, { fontStyle: 'bold' })));
        body.add(hud.add.text(cx + 10, cy + 25, h.bio, st(11, '#d8d2e6', BF, { wordWrap: { width: 194, useAdvancedWrap: true }, lineSpacing: 2 })));
      });

      // 右侧：剑阁核心人物与势力志
      const rx = X + 478;
      let ry = Y + 96;
      body.add(hud.add.text(rx, ry, '剑阁人物与势力志', st(16, '#9ff0b8', TF)));
      ry += 26;
      for (const item of (STORY.cast || [])) {
        const cg = hud.add.graphics();
        cg.fillStyle(0x16192c, 0.92).fillRoundedRect(rx, ry, 438, 58, 8);
        cg.lineStyle(1, 0x414a70, 0.85).strokeRoundedRect(rx, ry, 438, 58, 8);
        body.add(cg);
        body.add(hud.add.text(rx + 12, ry + 6, `${item.name}  ·  ${item.role}`, st(13, item.color || '#ffd36a', BF, { fontStyle: 'bold' })));
        body.add(hud.add.text(rx + 12, ry + 26, item.desc, st(11, '#dcd6ea', BF, { wordWrap: { width: 416, useAdvancedWrap: true }, lineSpacing: 1 })));
        ry += 62;
      }
    };

    const renderCodex = () => {
      const S = hud.sim.story;
      const defeated = (S && S.defeatedBosses) || [];
      const lx = X + 24;
      let ly = Y + 96;
      body.add(hud.add.text(lx, ly, '神兽、妖尊与怪物主动技设定', st(16, '#ffd36a', TF)));
      ly += 26;

      const codexNotes = [
        { title: '普通妖物主动技', color: '#ffb070', text: '纸扎人【符纸斩】、狐火【鬼火闪袭】、破灯笼妖【幽火三散】、跳尸【尸煞震踏】、鬼车【冥轮轰击】、夜鸦【黑羽俯冲】、魂兵【魂刃斩】、山贼【乱刀连斩】、野狼【恶狼扑咬】，均受沉默与眩晕打断。' },
        { title: '精英先锋与独特名号', color: '#ff9a5a', text: '每5波先锋精英皆以幽冥魏将独立命名（乐进骸、于禁影、李典傀、曹仁煞、张辽影等），各自施放破阵突袭、镇军重锤、鬼火齐射或铁壁震煞。' },
        { title: '主线与无尽独名 BOSS', color: '#ff6a5a', text: '第10/20/30波为灯骸老祖、旱魃、夜帝·无光；无尽40+波轮番降临贾诩影、夏侯渊骸、司马懿冢虎残魂、郭嘉魂等绝不重名的幽冥统帅！' },
        { title: 'BOSS房 / 强盗寨 / 狼王 / 秘境重战', color: '#c47bff', text: '强盗寨首战吕达后依次由杜远、胡才、波才等接管；BOSS房与重刷秘境亦轮换独特名号首领，并保留各自多段预警大招与沉默反制机制。' },
        { title: '四圣兽与武圣关羽助战', color: '#5fe0b8', text: '白虎【虎扑/啸风】、朱雀【离火/焚天】、玄武【龟甲/蛇缠】、青龙【惊雷/龙吟】、麒麟【祥瑞/麟角】与武圣关羽【青龙偃月/威震华夏】均会自动施法助阵！' },
      ];
      for (const n of codexNotes) {
        const g = hud.add.graphics();
        g.fillStyle(0x16192c, 0.92).fillRoundedRect(lx, ly, 444, 80, 8);
        g.lineStyle(1, 0x454e75, 0.9).strokeRoundedRect(lx, ly, 444, 80, 8);
        body.add(g);
        body.add(hud.add.text(lx + 12, ly + 7, n.title, st(13, n.color, BF, { fontStyle: 'bold' })));
        body.add(hud.add.text(lx + 12, ly + 26, n.text, st(11, '#ded8ec', BF, { wordWrap: { width: 420, useAdvancedWrap: true }, lineSpacing: 1 })));
        ly += 85;
      }

      // 右侧：本局已讨伐名将/BOSS 名录
      const rx = X + 486;
      let ry = Y + 96;
      body.add(hud.add.text(rx, ry, `本局已讨伐首领名录（${defeated.length} 名）`, st(16, '#7fe3ff', TF)));
      ry += 28;
      const panelG = hud.add.graphics();
      panelG.fillStyle(0x14182b, 0.92).fillRoundedRect(rx, ry, 430, 408, 10);
      panelG.lineStyle(1.5, 0x3b446b, 0.9).strokeRoundedRect(rx, ry, 430, 408, 10);
      body.add(panelG);

      if (!defeated.length) {
        body.add(hud.add.text(rx + 18, ry + 20, '尚未斩获具名首领。\n\n讨伐西北强盗头目·吕达、西南银背狼王、第5波先锋精英、BOSS房首领或秘境神兽后，其名号将永久铭刻于此。', st(13, '#9aa3cf', BF, { wordWrap: { width: 394, useAdvancedWrap: true }, lineSpacing: 5 })));
      } else {
        defeated.slice(-24).reverse().forEach((name, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const bx = rx + 14 + col * 204;
          const by = ry + 14 + row * 31;
          const pill = hud.add.graphics();
          pill.fillStyle(0x23294a, 0.9).fillRoundedRect(bx, by, 194, 26, 6);
          pill.lineStyle(1, 0x5c689c, 0.8).strokeRoundedRect(bx, by, 194, 26, 6);
          body.add(pill);
          body.add(hud.add.text(bx + 10, by + 5, `⚔ ${name}`, st(12, '#ffd36a', NF)));
        });
      }
    };

    const refresh = () => {
      if (!c.visible) return;
      const S = hud.sim.story;
      actBadge.setText(S ? `${S.actName} · 第 ${Math.max(1, hud.sim.wave?.n || 1)} 波` : '剑阁纪元');
      for (const tb of tabBtns) {
        tb.btn.setAlpha(tb.id === tab ? 1 : 0.72);
      }
      clearBody();
      if (tab === 'acts') renderActs();
      else if (tab === 'world') renderWorld();
      else renderCodex();
    };

    const open = (arg) => {
      if (typeof arg === 'string' && ['acts', 'world', 'codex'].includes(arg)) tab = arg;
      hud.gg.cmd({ type: 'markStoryRead' });
      c.setVisible(true);
      refresh();
    };
    const close = () => {
      c.setVisible(false);
    };

    return { c, open, close, refresh };
  },
};
