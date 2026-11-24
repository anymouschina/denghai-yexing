// 新模式的试玩快照（只在 URL 带 tapcanvasPlaytest=1 时由 main.js 调用）
export function guardSnapshot(game) {
  const sc = game.scene;
  if (sc.isActive('GuardSelect')) return { scene: 'select', mode: 'guard' };
  const gg = sc.getScene('GuardGame');
  const hud = sc.getScene('GuardHUD');
  if (!gg || !gg.sim || !(sc.isActive('GuardGame') || sc.isPaused('GuardGame'))) return null;
  const s = gg.sim;
  const u = s.ctrl;
  return {
    scene: hud && hud.playtestState ? hud.playtestState() : 'play', mode: 'guard', gameMode: s.mode, hero: s.heroId,
    wave: s.wave.n, t: Math.round(s.t), kmHp: Math.round(s.kongming.hp), kmMax: s.kongming.maxHp, copper: s.copper,
    ctrl: u ? `${u.kind}:${u.key}` : null, party: s.party.length, kills: s.stats.kills, enemies: s.enemies.filter((e) => e.alive).length,
    buildings: s.buildings.filter((b) => b.alive).length, mercs: s.units.filter((x) => x.kind === 'merc').length, beasts: s.units.filter((x) => x.kind === 'beast').length,
    lv: s.hero.lv, x: u ? Math.round(u.x) : 0, y: u ? Math.round(u.y) : 0, realm: u ? u.realm : null,
    quests: s.quests ? s.quests.done : 0, bag: s.inv ? s.inv.bag.filter(Boolean).length : 0, sets: s.activeSets ? s.activeSets() : [],
    kmSets: s.activeSets ? s.activeSets(s.kongming) : [], boss: (s.enemies.find((e) => e.alive && e.boss && !e.realm) || {}).name || null,
    tamed: s.units.filter((x) => x.kind === 'beast').map((x) => x.key), realms: s.realms ? { ...s.realms.state } : null,
    // 交战中：操控单位 520 像素内有 ≥4 只主线妖物（试玩脚本用它等到接敌再截图）
    fight: u ? s.enemies.filter((e) => e.alive && !e.realm && (e.x - u.x) ** 2 + (e.y - u.y) ** 2 < 520 * 520).length >= 4 : false,
    kmEquip: s.inv ? Object.values(s.inv.equip.kongming || {}).filter(Boolean).length : 0, over: s.over ? (s.over.win ? 'win' : 'lose') : null,
  };
}

// 压力/泄漏监测钩子（同样只在 tapcanvasPlaytest=1 时由 main.js 挂载）：
// metrics() 给出 Phaser 对象数 / 纹理数 / tween·timer 数 / sim 各数组长度 / 错误计数；
// fastForward(sec) 在页面内直接推 sim（不走渲染），用于把局面快速推到高波次。
export function guardDebug(game) {
  const gg = () => game.scene.getScene('GuardGame');
  const hud = () => game.scene.getScene('GuardHUD');
  const sceneStat = (sc) => {
    if (!sc || !sc.sys) return null;
    const tw = sc.tweens;
    const tm = sc.time;
    return {
      children: sc.children ? sc.children.length : 0,
      tweens: tw && tw.getTweens ? tw.getTweens().length : 0,
      timers: tm ? (tm._active ? tm._active.length : 0) + (tm._pendingInsertion ? tm._pendingInsertion.length : 0) : 0,
      inputKb: sc.input && sc.input.keyboard ? sc.input.keyboard.listenerCount('keydown') : 0,
      inputPtr: sc.input ? sc.input.listenerCount('pointerdown') : 0,
      sprites: sc.sprites ? sc.sprites.size : 0,
      pooled: sc.pools ? [...sc.pools.values()].reduce((a, p) => a + p.length, 0) : 0,
      vfxActive: sc.__vfxActive ? sc.__vfxActive.length : 0,
      errors: sc.errorCount || 0,
    };
  };
  return {
    metrics() {
      const g = gg();
      const s = g && g.sim;
      const mem = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const sim = s ? {
        enemies: s.enemies.length, projs: s.projs.length, zones: s.zones.length, fx: s.fx.length, ground: (s.groundItems || []).length,
        units: s.units.length, buildings: s.buildings.length,
        listeners: Object.values(s.listeners).reduce((a, l) => a + l.length, 0), wave: s.wave.n, t: Math.round(s.t),
      } : null;
      return {
        heap: mem, textures: Object.keys(game.textures.list).length, gg: sceneStat(g), hud: sceneStat(hud()), sim,
        winErrors: (globalThis.__guardWinErrors || 0),
      };
    },
    fastForward(sec) { const g = gg(); if (g && g.sim) g.sim.advance(sec); return g && g.sim ? g.sim.t : 0; },
  };
}
