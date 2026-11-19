# 平衡报告（终版，自动生成）

* 模拟：`godot/tests/balance.gd`，只经 `Sim` 的输入口(`in_move/in_dash/in_skill/in_combo`)与选择口(`choose/buy_relic/close_shop`)操作；没有 debug 倍率、不改血量、不在战斗间回血、不改随机数（证据：`balance.gd` 循环里只有 `b.act(s, dt)` 与 `s.step(dt)`）。
* 口径：键鼠、无局外强化、8 分钟经典时间轴（`mode=classic`，3 段 + 灯骸老祖）；30/10 分钟模式只是把战斗节奏钟拉伸 3.75×/1.25×（`Sim.stretch`），规则与数值表不变。
* 一条命令重跑：`python3 tools/run_balance.py --bot proxy --tier 0 --n 3000 --procs 10`。

## 整局结果

| 机器人 | 档位 | 局数 | 胜率 | 95%CI | 断言区间 | 达标 | 平均存活(s) | 副本通关率 | 副本内死亡率 | BOSS 时长(未通关剑冢) | BOSS 时长(通关≥1 次) | 死因 Top3 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 真人代理(σ=0.05) | 不进副本 | 3000 | 40.7% | 39.0–42.5% | 35–48% | ✅ | 470.6 | 0.375 | 0.016 | 66.8 | 54.3 | lantern:bullet×1433、boss:slam×163、jiangshi:contact×108 |
| 真人代理(σ=0.05) | 进 1 次 | 1000 | 53.7% | 50.6–56.8% | 45–58% | ✅ | 471.5 | 0.642 | 0.003 | 68.3 | 50.3 | lantern:bullet×371、boss:slam×48、jiangshi:contact×19 |
| 真人代理(σ=0.05) | 进 2 次 | 1000 | 55.5% | 52.4–58.6% | 50–62% | ✅ | 467.5 | 0.767 | 0.001 | 75.4 | 50.3 | lantern:bullet×372、jiangshi:contact×27、boss:slam×17 |
| 随机下限 | 不进副本 | 200 | 0.0% | 0.0–1.9% | 35–48% | — | 126.7 | 0.0 | 1.0 | - | - | paperman:contact×114、foxfire:contact×58、jiangshi:contact×19 |
| 随机下限 | 进 1 次 | 200 | 0.0% | 0.0–1.9% | 45–58% | — | 120.6 | 0.0 | 0.914 | - | - | paperman:contact×115、foxfire:contact×58、jiangshi:contact×17 |
| 随机下限 | 进 2 次 | 200 | 0.0% | 0.0–1.9% | 50–62% | — | 120.6 | 0.0 | 0.914 | - | - | paperman:contact×115、foxfire:contact×58、jiangshi:contact×17 |

## 飞剑降时（真人代理三档合并，按剑冢通关次数分组的 BOSS 击杀时长）

| 剑冢通关次数 | 样本 | 平均 BOSS 时长(s) | 相对 0 次下降 | 目标 |
|---|---|---|---|---|
| 0 | 1258 | 67.0 | - | - |
| 1 | 608 | 52.3 | 22.0% | 25–35%（1 次） |
| 2 | 448 | 48.4 | 27.8% | 25–35%（2 次） |

* 瞄准机器人(克隆试射) 不进副本：60 局，胜率 45.0%，平均战斗时钟(节奏钟) 495.1，BOSS 平均时长 69.6。

* 疾速模式(10分钟) 进 1 次，真人代理：60 局，胜率 91.7%，平均战斗时钟(节奏钟) 507.8，BOSS 平均时长 48.5。

* 完整模式(30分钟) 进 1 次，真人代理：20 局，胜率 100.0%，平均战斗时钟(节奏钟) 492.3，BOSS 平均时长 46.1。

## 完整模式 3 局事件日志（`tests/sword_report.gd --mode=full`）

```
SW {"boss_time":38.0,"cause":"","clock_end":1838.0,"dmg_share_pct":{"sw_array":9.3,"sw_qi":13.4,"sw_thrust2":1.6,"sw_wheel":1.1,"sword":8.8},"end_real_s":2051.0,"fusion":"fu","fusion_t":473.9,"gourds":0,"level":46,"mini_idx":5,"mode":"full","pet":false,"plan":[0,1],"relics":["part_huanhuo","army1","part_fu","talisman","soul1","coin","part_sword","blade","mirror","part_lei","gold2","ember","gold1","purse","army2"],"rifts":[{"dur":60.1,"how":"clear","ok":true},{"dur":72.1,"how":"clear","ok":true},{"dur":25.2,"how":"clear","ok":true}],"seed":1,"sets":["flame","burst","army"],"sword_kills":4800,"sword_log":[{"src":"副本守关者","stage":2,"t":282.3},{"branch":"count","t":282.3},{"src":"副本守关者","stage":3,"t":440.9},{"branch":"count","t":440.9},{"fusion":"fu","t":473.9},{"src":"剑意(击杀)","stage":4,"t":880.7},{"branch":"count","t":880.7},{"src":"剑意(击杀)","stage":5,"t":1115.1},{"branch":"radius","t":1115.1
SW {"boss_time":39.0,"cause":"","clock_end":1839.0,"dmg_share_pct":{"sw_array":8.8,"sw_qi":13.0,"sw_thrust2":0.5,"sw_wheel":0.6,"sword":6.2},"end_real_s":2046.0,"fusion":"fu","fusion_t":404.7,"gourds":1,"level":46,"mini_idx":5,"mode":"full","pet":false,"plan":[0,1],"relics":["army1","bell","gold2","soul1","part_fu","gold1","shade","part_sword","purse","thunder","part_lei","army2","horse"],"rifts":[{"dur":66.5,"how":"clear","ok":true},{"dur":58.7,"how":"clear","ok":true},{"dur":24.9,"how":"clear","ok":true}],"seed":2,"sets":["wealth","burst","army"],"sword_kills":4800,"sword_log":[{"src":"副本守关者","stage":2,"t":372.0},{"branch":"count","t":372.0},{"fusion":"fu","t":404.7},{"src":"剑意(击杀)","stage":3,"t":620.5},{"branch":"count","t":620.5},{"src":"副本守关者","stage":4,"t":740.3},{"branch":"count","t":740.3},{"src":"剑意(击杀)","stage":5,"t":1076.5},{"branch":"radius","t":1076.5}],"sword_stage":5,"win"
SW {"boss_time":43.0,"cause":"","clock_end":1843.0,"dmg_share_pct":{"sw_array":8.4,"sw_qi":14.8,"sw_thrust2":1.5,"sw_wheel":2.3,"sword":13.5},"end_real_s":2070.0,"fusion":"fu","fusion_t":408.7,"gourds":0,"level":45,"mini_idx":5,"mode":"full","pet":false,"plan":[0,1],"relics":["part_sword","bell","gold2","part_huanhuo","coin","part_fu","horse","shade","part_lei","mirror","talisman","army1","soul1","ember"],"rifts":[{"dur":70.0,"how":"timeout","ok":false},{"dur":77.3,"how":"clear","ok":true},{"dur":24.2,"how":"clear","ok":true}],"seed":3,"sets":["flame","ward"],"sword_kills":4800,"sword_log":[{"src":"融合保底(剑冢遗赠)","stage":1,"t":408.7},{"fusion":"fu","t":408.7},{"src":"剑意(击杀)","stage":2,"t":485.4},{"branch":"count","t":485.4},{"src":"剑意(击杀)","stage":3,"t":638.5},{"branch":"count","t":638.5},{"src":"副本守关者","stage":4,"t":760.5},{"branch":"count","t":760.5},{"src":"剑意(击杀)","stage":5,"t":1128.6},
```

## 结论与未达标项（如实）
* ✅ 真人代理三档胜率 40.7%（3000 局）/ 53.7%（1000 局）/ 55.5%（1000 局），均在断言区间且逐档递增；副本内死亡率 ≤1.6%。
* ⚠ 样本量：不进副本档 3000 局，进 1/2 次档各 1000 局（原目标每档 3000，后两档为控制时长缩减）；随机下限每档 200 局、瞄准机器人 60 局（仅不进副本档，且克隆试射很慢）。
* ❌ 飞剑降时：通关剑冢 1 次相对 0 次下降 22.0%（目标 25–35%，**未达标**）；2 次下降 27.8%（达标）。按通关次数分组是观察性比较（非对照实验）。
* ❌ 完整(30 分钟)/疾速(10 分钟)模式**未校准**：只是把战斗节奏钟拉伸，机器人胜率 100%（20 局）/ 91.7%（60 局），明显偏易；完整模式 3 局日志显示战斗时钟约 1838–1843s 结束（最终 BOSS 压轴，约 30:40）、5 位阶梯小 BOSS 全部刷出，融合在战斗时钟 330s 触发；但机器人 3 局里小金刚均未合成（机器人不主动收集葫芦，`gourds` 0–1）。
* 调参：`EN.boss.hp=120000`，`waves.hpMulPerMin=1.42`，`late.hpPerMin=1.36`；飞剑伤害 `1+0.3×(阶−1)+[0,0.5,0.6][通关次数]`（`Sim._sword_strike`）。
