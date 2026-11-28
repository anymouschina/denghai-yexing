// 《守卫剑阁》完整剧情与设定系统（纯 JS，可确定性存档/读档）：
// - 驱动 5 幕主线 + 无尽劫波剧情演出、关键事件对白（孔明/南华/司马懿/四圣兽/吕达/陈老汉/项羽/刑天）
// - 非阻塞对白队列：战斗照常进行，支持点击跳过或打开「剑阁录 [I]」回顾剧情日志与世界观图鉴
import STORY from '../../data/story.json' with { type: 'json' };

function formatLine(sim, raw) {
  const hero = sim.hero;
  const hMeta = (STORY.heroes && STORY.heroes[sim.heroId]) || {};
  const heroName = (hero && hero.name) || '守阁英杰';
  const replace = (s) => String(s || '')
    .replaceAll('{hero}', heroName)
    .replaceAll('{heroIntro}', hMeta.intro || '末将领命，誓死护卫剑阁！')
    .replaceAll('{heroVictory}', hMeta.victory || '永夜已破，剑阁长明！');
  return {
    speaker: replace(raw.speaker),
    role: replace(raw.role),
    color: raw.color || '#ffd36a',
    dur: raw.dur || 5,
    text: replace(raw.text),
  };
}

function actForWave(n) {
  for (const a of (STORY.acts || [])) {
    if (n >= a.waves[0] && n <= a.waves[1]) return a;
  }
  return (STORY.acts && STORY.acts[0]) || { id: 1, name: '第一幕 · 星灯初燃', waves: [1, 5], summary: '' };
}

function enqueueEvent(sim, evtId, once = true) {
  const S = sim.story;
  if (!S) return false;
  if (once && S.seen[evtId]) return false;
  const lines = STORY.events && STORY.events[evtId];
  if (!lines || !lines.length) return false;
  if (once) S.seen[evtId] = 1;
  const wave = Math.max(1, sim.wave ? sim.wave.n : 1);
  for (const raw of lines) {
    const line = formatLine(sim, raw);
    const entry = { ...line, evtId, wave, t: Math.round(sim.t || 0), left: line.dur };
    S.queue.push(entry);
    S.log.push({ speaker: entry.speaker, role: entry.role, color: entry.color, text: entry.text, wave, t: entry.t, evtId });
    if (S.log.length > 60) S.log.shift();
  }
  S.unread++;
  if (!S.active && S.queue.length) S.active = S.queue.shift();
  sim.emit('storyEvent', { evtId, act: S.act, active: S.active });
  return true;
}

export default {
  id: 'story',
  init(sim) {
    const firstAct = actForWave(1);
    sim.story = {
      act: firstAct.id,
      actName: firstAct.name,
      seen: {},
      active: null,
      queue: [],
      log: [],
      unread: 0,
      defeatedBosses: [],
      trigger: (evtId, once = true) => enqueueEvent(sim, evtId, once),
      getAct: () => actForWave(Math.max(1, sim.wave ? sim.wave.n : 1)),
    };

    // 开局序章
    enqueueEvent(sim, 'start', true);

    // 单一通配监听派发，避免注册过多事件槽位（保持 sim.listeners 精简）
    sim.on('*', (evt, data) => {
      const S = sim.story;
      if (!S) return;
      switch (evt) {
        case 'waveStart': {
          const act = actForWave(data.n);
          if (act.id !== S.act) {
            S.act = act.id;
            S.actName = act.name;
            sim.banner(`【${act.name}】`, '#ffd36a');
          }
          enqueueEvent(sim, `wave_${data.n}`, true);
          break;
        }
        case 'bossKill': {
          if (!data) break;
          if (data.name && !S.defeatedBosses.includes(data.name)) S.defeatedBosses.push(data.name);
          if (data.boss) enqueueEvent(sim, `bossKill_${data.boss}`, true);
          break;
        }
        case 'kill': {
          const enemy = data && data.enemy;
          if (!enemy || !enemy.name) break;
          if ((enemy.boss || enemy.banditBoss || enemy.alphaWolf || enemy.bossRoomBoss || enemy.elite) && !S.defeatedBosses.includes(enemy.name)) {
            S.defeatedBosses.push(enemy.name);
            if (S.defeatedBosses.length > 48) S.defeatedBosses.shift();
          }
          break;
        }
        case 'escalation':
        case 'banditBossKill':
        case 'hunterQuestDone':
        case 'heroAwaken':
        case 'nanhuaAscend':
        case 'mirrorClear':
          enqueueEvent(sim, evt, true);
          break;
        case 'tame':
          if (data && data.id) enqueueEvent(sim, `tame_${data.id}`, true);
          break;
        case 'realmClear':
          if (data && data.id) enqueueEvent(sim, `realmClear_${data.id}`, true);
          break;
        case 'kongmingHit': {
          const km = sim.kongming;
          if (km && km.alive && km.hp / Math.max(1, km.maxHp) <= 0.45) enqueueEvent(sim, 'kongmingLow', true);
          break;
        }
        case 'end':
          if (data && !data.win) enqueueEvent(sim, 'defeat', true);
          break;
      }
    });
  },
  update(sim, dt) {
    const S = sim.story;
    if (!S) return;
    if (S.active) {
      S.active.left -= dt;
      if (S.active.left <= 0) {
        S.active = S.queue.length ? S.queue.shift() : null;
      }
    } else if (S.queue.length) {
      S.active = S.queue.shift();
    }
  },
  commands: {
    skipStory(sim) {
      const S = sim.story;
      if (!S) return { ok: false };
      S.active = S.queue.length ? S.queue.shift() : null;
      return { ok: true, active: S.active };
    },
    markStoryRead(sim) {
      const S = sim.story;
      if (!S) return { ok: false };
      S.unread = 0;
      return { ok: true };
    },
  },
};
