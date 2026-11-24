# 守灯·镇夜 后期闪退 / 泄漏排查报告

方法：先量后改。无头 `Sim` 长局（`tests/guard/stress-sim.test.mjs`）+ 真实 Chrome 浸泡（`tests/browser/guard-soak.mjs`，采样 JS 堆、Phaser 显示对象、纹理、tween/timer、监听数、sim 各数组）。

## 结论先说

逐项实测后，**sim 层与渲染对象池没有无限增长型泄漏**：endless 推到 42 波、story 30 波，堆稳定在 8→11 MB（无头，`--expose-gc`），浏览器里 22 波后显示对象稳定在 ~520，纹理 449 不变，监听数不叠加。真正会让后期"闪退/卡死"的是下面两条机制问题，已根治；其余为上限加固。

## 根因清单

| # | 位置 | 为什么出问题 | 证据 | 修法 | 前 → 后 |
|---|------|--------------|------|------|---------|
| 1 | `GuardGame.update` / `GuardHUD.update`（`src/guard/scenes/`） | Phaser 主循环先调场景 `update` 再排下一帧 rAF，场景里抛出的任何异常（空引用、dead 单位引用、NaN）会令整个游戏循环永久停摆，用户看到的就是"闪退/冻屏"，且无任何计数。 | 代码路径：`update` 无任何保护；sim.step 内 emit 的监听链很长。 | 阶段性兜底（feel / sim / render / HUD 各自 try-catch），`errorCount`/`lastError` 计数并经 `__TAPCANVAS_PLAYTEST__.guard.metrics()` 暴露；sim 连续 30 帧报错则停步并提示重开，避免刷屏拖垮帧率。**仅作最后保险**，不替代下面的根因修复。 | 异常 → 停摆；现在 → 计数 + 继续渲染。浸泡 22 波 `errors=0`。 |
| 2 | `GuardGame.create`（`endShown`） | `scene.restart` 不重建场景实例，`this.endShown` 在第一局结束后保持 `true`；重开后的第二局起结算界面永不弹出，游戏停在结束画面（表现为卡死）。 | 浸泡脚本：第 1 局结算 → 重开 → 第 2 局结束：修复前 `FAIL 重开 N 局后结算界面仍会弹出`，修复后 PASS。 | `create()` 里复位 `endShown/errorCount/failStreak/halted`。 | 第 2 局起无结算 → 每局都有。 |
| 3 | `GuardGame.create` 粒子发射器（pSpark/pPaper/pGold/pHeal） | 未设 `maxAliveParticles`；怪潮连杀时每个死亡事件 `explode(6~40)`，存活粒子数仅由寿命约束。 | 850 怪满场时每秒数百次 `die` fx，理论存活粒子可达数千。 | 每发射器 `maxAliveParticles: 360`。 | 上限：无 → 4×360。 |
| 4 | `render/fx.js` `warnRing` → `sc.fxItems` | 预警圈数组无上限，高波次多 BOSS/精英并发预警时可堆积。 | 数组仅靠 `life` 到期清理。 | 超过 120 丢最旧。 | 无上限 → 120。 |
| 5 | `GuardGame` shutdown | 只 `tweens.killAll()`；`time` 事件、`sprites/pools` Map、`fxItems` 靠引擎销毁与 GC，重开时旧引用链晚释放。 | — | shutdown 里 `time.removeAllEvents()` + 清 Map/数组。 | 重开后 children 458→290，纹理 449→435。 |

## 已核查、确认**没有**问题的项（含证据）

- **sim.fx**：`pushFx` 上限 600；"不清队列"压力 18 波峰值 600 = 上限。
- **enemies**：`enemyCap=850`（BOSS/秘境可略超，实测峰值 864）；**projs**：`projCap=700`；**groundItems**：`maxItems=60`；**quests.history**：≤12。
- **sim.listeners**：构造期一次性注册，长局全程 47 恒定；重开后 46，不叠加。
- **killsBy / stats**：键数 ≤ 妖物种类（11）。
- **精灵池**：`sprites` Map 每帧按 `seen` 回收，`pools` 随同屏峰值封顶；浸泡 22 波显示对象峰值 523（前半段 537）。
- **VFX**：`MAX_ACTIVE_VFX=156` + 优先级淘汰；`floatText` 70 个对象池。
- **gameFeel**：`setTimeout` 记入 `timers` Set，shutdown `destroy()` 统一清除；`popSprite`/`flashScreen` 复用 tween 与单个 rect。
- **纹理**：`makeVfxTextures`/`ensureUnitSpriteSheet` 均先 `exists` 判断，449 张全程不变。
- **事件监听**：HUD `visibilitychange` 在 shutdown 移除；`main.js`/`touch.js`/`audio.js` 的 window 监听均在应用级只注册一次；重开后键盘/指针监听数 1→1。
- **音频**：同名音效 `voices` 限并发；音乐只有一个 `setInterval`，Seq 到期 disconnect。
- **面板 UI**：背包等面板按 `dirty/ver` 变化才重建，重建前 `removeAll(true)`。

## 压力结果（本机）

无头 Sim（`node --expose-gc --test tests/guard/stress-sim.test.mjs`，`STRESS_FULL=1` 跑满）：

| 用例 | 波次 | 模拟时长 | 墙钟 | 峰值 enemies / projs / fx / ground / units | 堆 |
|------|------|----------|------|-----------|----|
| endless fx:false | 42 | 1803s | 24s | 856 / 61 / 0 / 60 / 11 | 8→11 MB |
| story fx:true | 30 | 1247s | 18–22s | 864 / 80 / 7 / 60 / 8 | 8→9 MB |
| endless fx:true 不清队列 | 18 | 633s | 6s | 850 / 51 / **600** / 60 / 8 | 9→9 MB |

默认（不带 `STRESS_FULL`）为缩短版（≈6s），随 `npm test` 运行。

真实浏览器浸泡（`npx vite build && node tests/browser/guard-soak.mjs`，150s，ts=8）：22 波、850 妖物满场；显示对象 537→523、纹理 449→449、tween 峰值 129→25、堆窗口最低点 +14 MB（阈值 120）、`errorCount=0`、无 pageerror；重开 3 局监听/纹理不叠加，第 2、3 局结算正常弹出。报告：`tests/browser/out/guard-soak.json`。

## 调试钩子

`?tapcanvasPlaytest=1` 时 `__TAPCANVAS_PLAYTEST__.guard.metrics()` / `.fastForward(sec)`（`src/guard/playtest.js`）。正常游玩不挂载。
