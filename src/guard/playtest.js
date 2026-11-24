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
