# 平衡报告（终版，自动生成）

* 模拟：`godot/tests/balance.gd`，只经 `Sim` 的输入口(`in_move/in_dash/in_skill/in_combo`)与选择口(`choose/buy_relic/close_shop`)操作；没有 debug 倍率、不改血量、不在战斗间回血、不改随机数（证据：`balance.gd` 循环里只有 `b.act(s, dt)` 与 `s.step(dt)`）。
* 口径：键鼠、无局外强化、8 分钟经典时间轴（`mode=classic`，3 段 + 灯骸老祖）；30/10 分钟模式只是把战斗节奏钟拉伸 3.75×/1.25×（`Sim.stretch`），规则与数值表不变。
* 一条命令重跑：`python3 tools/run_balance.py --bot proxy --tier 0 --n 3000 --procs 10`。

## 整局结果

| 机器人 | 档位 | 局数 | 胜率 | 95%CI | 断言区间 | 达标 | 平均存活(s) | 副本通关率 | 副本内死亡率 | BOSS 时长(未通关剑冢) | BOSS 时长(通关≥1 次) | 死因 Top3 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 真人代理(σ=0.05) | 不进副本 | 300 | 40.7% | 35.3–46.3% | 35–48% | ✅ | 467.2 | 0.453 | 0.057 | 66.6 | 61.8 | lantern:bullet×143、boss:slam×15、jiangshi:contact×9 |
| 真人代理(σ=0.05) | 进 1 次 | 300 | 49.0% | 43.4–54.6% | 45–58% | ✅ | 467.3 | 0.638 | 0.0 | 67.1 | 53.8 | lantern:bullet×120、boss:slam×15、jiangshi:contact×6 |
| 真人代理(σ=0.05) | 进 2 次 | 300 | 56.3% | 50.7–61.8% | 50–62% | ✅ | 470.5 | 0.764 | 0.0 | 88.8 | 52.7 | lantern:bullet×111、boss:slam×8、foxfire:contact×6 |
| 随机下限 | 不进副本 | 120 | 0.0% | -0.0–3.1% | 35–48% | — | 125.6 | 0.0 | 1.0 | - | - | paperman:contact×64、foxfire:contact×39、jiangshi:contact×13 |
| 随机下限 | 进 1 次 | 120 | 0.0% | -0.0–3.1% | 45–58% | — | 119.0 | 0.0 | 0.889 | - | - | paperman:contact×64、foxfire:contact×41、jiangshi:contact×11 |
| 随机下限 | 进 2 次 | 120 | 0.0% | -0.0–3.1% | 50–62% | — | 119.0 | 0.0 | 0.889 | - | - | paperman:contact×64、foxfire:contact×41、jiangshi:contact×11 |
