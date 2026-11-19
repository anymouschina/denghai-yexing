#!/usr/bin/env python3
"""把 run_balance.py 的汇总 JSON 写成 docs/balance-report.md。用法：python3 tools/make_balance_md.py <目录> """
import json, os, sys
D = sys.argv[1]
names = {"proxy": "真人代理(σ=0.05)", "random": "随机下限"}
tiers = ["不进副本", "进 1 次", "进 2 次"]
rng = {0: (35, 48), 1: (45, 58), 2: (50, 62)}
out = ["# 平衡报告（终版，自动生成）\n",
       "* 模拟：`godot/tests/balance.gd`，只经 `Sim` 的输入口(`in_move/in_dash/in_skill/in_combo`)与选择口(`choose/buy_relic/close_shop`)操作；没有 debug 倍率、不改血量、不在战斗间回血、不改随机数（证据：`balance.gd` 循环里只有 `b.act(s, dt)` 与 `s.step(dt)`）。",
       "* 口径：键鼠、无局外强化、8 分钟经典时间轴（`mode=classic`，3 段 + 灯骸老祖）；30/10 分钟模式只是把战斗节奏钟拉伸 3.75×/1.25×（`Sim.stretch`），规则与数值表不变。",
       "* 一条命令重跑：`python3 tools/run_balance.py --bot proxy --tier 0 --n 3000 --procs 10`。\n",
       "## 整局结果\n", "| 机器人 | 档位 | 局数 | 胜率 | 95%CI | 断言区间 | 达标 | 平均存活(s) | 副本通关率 | 副本内死亡率 | BOSS 时长(未通关剑冢) | BOSS 时长(通关≥1 次) | 死因 Top3 |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
for bot in ("proxy", "random"):
    for t in range(3):
        f = os.path.join(D, f"f_{bot}_t{t}.json")
        if not os.path.exists(f):
            continue
        s = json.load(open(f))["summary"]
        ci = s.get("ci95", [0, 0]); lo, hi = rng[t]; wr = s["win_rate"] * 100
        ok = ("✅" if lo <= wr <= hi else "❌") if bot == "proxy" else "—"
        top = "、".join(f"{k}×{v}" for k, v in list(s["death_causes"].items())[:3])
        fm = lambda x: "-" if x is None else x
        out.append(f"| {names[bot]} | {tiers[t]} | {s['n']} | {wr:.1f}% | {ci[0]*100:.1f}–{ci[1]*100:.1f}% | {lo}–{hi}% | {ok} | {s['mean_t']} | {s.get('rift_clear_rate','-')} | {s.get('rift_death_rate','-')} | {fm(s.get('boss_time_rc0'))} | {fm(s.get('boss_time_rc1p'))} | {top} |")
open(os.path.join(os.path.dirname(D.rstrip('/')) if False else "docs", "balance-report.md"), "w").write("\n".join(out) + "\n")
print("\n".join(out))
