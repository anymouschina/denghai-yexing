# 「守灯·镇夜」代码结构与接口约定（M2–M5 并行开发的合同）

## 目录
```
src/guard/
  data/*.json          数值（代码不写死数值）。各系统用自己的 json，不改别人的。
  sim/Sim.js           模拟核心（纯 JS，Node 可跑）。固定步长 1/30 秒，sim.step() / sim.advance(秒)。
  sim/map.js           地图几何：REALMS（四角秘境）、HIDDEN（隐藏秘境）、WALLS、FOUNDATIONS、gateCenter、realmAt
  sim/systems/*.js     系统模块，注册在 sim/systems/index.js（追加 import + 数组项）
  sim/kits/*.js        技能实现，注册在 sim/kits/index.js（KITS[单位key] = {q,e,r,f,u}）
  scenes/              GuardSelect（选英雄/模式）、GuardGame（驱动+渲染+输入）、GuardHUD（HUD/菜单/结算）
  render/fx.js         registerFx(type, (scene, f) => {})       一次性特效（消费 sim.fx 队列）
  render/zones.js      registerZoneVis(vis, (g, z, sim) => {})   持续区域画法
  render/index.js      registerLayer((scene, sim, inView, dt) => {}) 每帧世界层绘制；模块在 render/extensions.js 里 import
  ui/index.js          PANELS：HUD 面板（按键打开，不暂停）与常驻小部件（always: true）
tests/guard/*.test.mjs node --test 无头测试；tests/browser/*.mjs 真实浏览器（CDP）脚本
```

## 系统模块
```js
export default {
  id: 'loot',
  init(sim) {},                 // 构造时调用：挂 sim.xxx 状态、sim.on(...) 监听、sim.statSources.push(...)
  preUpdate(sim, dt) {},        // 每 tick 在单位/妖物更新之前
  update(sim, dt) {},           // 每 tick 在之后
  commands: { equip(sim, cmd) { return { ok: true } } },   // UI 与机器人都走 sim.command({type:'equip', ...})
};
```
失败时返回 `{ ok: false, reason: '中文原因' }`，HUD 会把 reason 弹成提示。

## Sim 常用字段与方法
- 状态：`t` 秒、`rng()`（唯一随机源，禁止 Math.random）、`copper`、`wave {n, nextAt, lanes, spawnLeft, hpMul, atkMul}`、`mode 'story'|'endless'`、`over {win, reason, wave, t}`
- 实体数组：`units`（友军：孔明/英雄/雇佣兵/神兽）、`enemies`、`projs`、`zones`、`buildings`、`foundations [{id,lane,x,y,bid}]`
- 单位：`{id, side:'ally', kind:'hero'|'merc'|'beast'|'kongming', key, def, x,y,r,h, hp,maxHp, stats, base, lv, cds{atk,q,e,r,f}, energy, alive, downT, ctrl, buffs, shield, invuln, st{stun}, realm, dash}`
- 妖物：`{id, side:'enemy', type, def, x,y,r,h, hp,maxHp, atk, armor, spd, range, cd, cdMax, ai, lane, tgt, st{slow,burn,stun,freeze,root,taunt}, elite, boss, realm, home, flying, copper, xp, update?}`
  `e.update(sim, e, dt, frozen)` 存在时跳过通用 AI（BOSS、秘境守护用）。
- 建筑：`{id, side:'ally', kind:'building', type, x,y,r,h, hp,maxHp, def, lv, fid, block, alive, tex, scale}` 放进 `sim.buildings`
- `spawnUnit(kind, key, x, y)`、`spawnEnemy(type, x, y, {lane, hpMul, atkMul, scale, elite, boss, realm, home, def, name, tint, extra})`
- `damage(src, tgt, amount, {skill, basic, tag, bldMul, canCrit, noEnergy, pierceArmor})` → 实际伤害；死亡自动走 `kill()`
- `heal(tgt, amt, src)`、`applyStatus(e, 'slow'|'stun'|'freeze'|'root'|'burn', t, v)`（burn 的 v = {dps, src: 单位id}）
- `addProj({side, src, x, y, a, speed, life, dmg, r, pierce, splash, tex, tint, scale, slow, slowT, skill, tag, basic, onHit(sim,p,e)})`
- `addZone({x, y, r, t, vis, color, tick, onTick(sim,z), update(sim,z,dt), onEnd(sim,z), follow: unitId, block})`
- `telegraph(x, y, r, warnSec, fn)` 红圈预警后执行（BOSS/精英大招必须用）
- `addBuff(u, id, sec, [{stat, add, mul}])`；属性键：maxHp atk def spd aspd crit critDmg cdr dmg skillDmg dmgTaken ultGain regen
- `statSources.push((unit, sim) => [{stat, add|mul}])`；装备变化后调 `sim.markDirty(unit)`（或不传参全部重算）
- 查询：`nearestEnemy(x,y,r,filter)`、`enemiesIn(x,y,r)`、`alliesIn(x,y,r,withBuildings)`、`bestCluster(x,y,range,r)`、`aimPoint(u)`
- `addCopper(n, x?, y?)`、`gainXp(n)`、`banner(text, color, big)`、`pushFx({t:'类型', x, y, ...})`、`end(win, reason)`
- 位移技能：给单位设 `u.dash = {vx, vy, t, hitR, hit: new Set(), onHit(sim,u,e), onEnd(sim,u)}`

## 事件（sim.on / sim.emit）——跨系统只靠事件和命令通信
| 事件 | 数据 | 谁发 |
| --- | --- | --- |
| waveStart / waveClear | {n, lanes, boss} / {n} | 核心 waves |
| enemySpawn / kill | e / {enemy, src} | 核心 |
| damage / basicHit / heal | {src,tgt,dmg,crit,o} / {src,tgt,dmg} / {src,tgt,v} | 核心 |
| unitSpawn / unitDown / respawn / switch / levelUp | u | 核心 |
| kongmingHit | {src, dmg} | 核心 |
| realmMove | {u, from, to}（单位进出秘境区域） | 核心 |
| buildingDestroyed | b | 核心 |
| cast | {u, slot} | 核心 |
| command | cmd（任意命令成功后） | 核心 |
| bossSpawn / bossKill / eliteSpawn | e | M2 战斗 |
| itemGain / equip / unequip / setActive / useItem | {item} / {unit, item, slot} / … / {unit, set, pieces} / {item} | M3 成长 |
| realmEnter / realmClear / tame / hiddenOpen | {id} / {id} / {beast: u} / {} | M4 秘境 |
| build / upgrade / demolish / hire / questNew / questDone | {b} / {b} / {b} / {u} / {q} / {q} | M5 经营 |

## 跨系统 API（用可选链调用，没合并时也不崩）
- M3 提供 `sim.loot = { roll({wave, minQ, set, slot}) → item, give(item) → bool, chest(n, opts) }`，`sim.inv = {bag: Array(30), equip: {[unitId]: {weapon, armor, accessory, treasure}}}`，`sim.activeSets(unit?) → ['卧龙4', …]`，`sim.bestSetText()`
- M4 提供 `sim.realms = {state: {xuanwu: 'open'|'active'|'cleared', …}, hiddenOpen: bool}`
- M5 提供 `sim.quests = {active: [], done: n}`
- M2 提供 `KITS`，以及 `sim.bossesKilled`；剧情胜利由 M2 在第 30 波终极 BOSS 死亡时 `sim.end(true, …)`

## UI 面板
```js
// ui/bag.js
export default { name: 'bag', key: 'b', create(hud) { const c = hud.add.container(0, 0); …; return { c, refresh() {}, open(arg) {}, close() {}, key(e) { return false } } } }
```
- 面板打开时战斗不暂停。面板放在屏幕中部，不要挡住孔明血条（顶部 0–70px）和头像栏/技能栏（底部 600–720px）。
- 用 `widgets.js` 的 makeButton / drawPanel，字体：标题 TF、正文 BF、数字 NF（见 src/fonts.js）。
- 用 `hud.gg.cmd({...})` 发命令（失败会自动弹出原因）；`hud.toast(text)`、`hud.banner(text)`。

## 规则
- 只用 `sim.rng()`；不改别的里程碑的文件，共享注册表只追加一行。
- 不改原模式文件（src/scenes、src/game、src/data 等）。
- 每个系统写 `tests/guard/<里程碑>-*.test.mjs`（node:test），`npm test` 全绿；`npx vite build` 通过。
