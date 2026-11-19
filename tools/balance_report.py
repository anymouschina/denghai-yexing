#!/usr/bin/env python3
"""一条命令重跑平衡并生成报告（不作弊：只经 Sim 的输入口/选择口操作，见 godot/tests/balance.gd、duel.gd）。

  python3 tools/balance_report.py --n 3000            # 完整口径：3 档 × 3 种机器人 × 3000 局 + 单挑
  python3 tools/balance_report.py --n 200 --bots proxy  # 快速检查

输出：docs/balance-report.md（表格 + 断言结论）、docs/balance/*.json（各格摘要）。
"""
import argparse, json, os, statistics, subprocess, sys, time, collections
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_balance as rb  # noqa: E402

ROOT = rb.ROOT
OUT = os.path.join(ROOT, "docs", "balance")
TIER_NAMES = ["不进副本", "进 1 次", "进 2 次"]
BOT_NAMES = {"proxy": "真人代理(σ=0.05)", "aim": "瞄准机器人(克隆试射)", "random": "随机下限"}


def run_cells(bots, n, procs, dt):
    cells = {}
    for bot in bots:
        for tier in (0, 1, 2):
            ns = argparse.Namespace(bot=bot, tier=tier, n=n, frm=0, procs=procs, dt=dt, set="", plan=None, touch=False)
            chunk = max(1, n // (procs * 3))
            jobs, f, left = [], 0, n
            while left > 0:
                k = min(chunk, left)
                jobs.append((f, k)); f += k; left -= k
            t0 = time.time()
            with ThreadPoolExecutor(procs) as ex:
                parts = list(ex.map(lambda j: rb.run_chunk(ns, *j), jobs))
            runs = [r for p in parts for r in p]
            s = rb.summarize(runs)
            s["wall_s"] = round(time.time() - t0, 1)
            cells[(bot, tier)] = (s, runs)
            os.makedirs(OUT, exist_ok=True)
            with open(os.path.join(OUT, f"{bot}_t{tier}.json"), "w") as fh:
                json.dump({"summary": s, "causes": dict(collections.Counter(r["cause"] for r in runs if not r["win"])),
                           "runs": [[r["seed"], int(r["win"]), r["t"], r["cause"], r["boss_time"], r["art"]] for r in runs]}, fh, ensure_ascii=False)
            print(f"[{bot} t{tier}] n={s['n']} win={s['win_rate']:.3f} wall={s['wall_s']}s", flush=True)
    return cells


def duel_chunk(kind, build, sword, entry, frm, n, bot, dt):
    cmd = [rb.GODOT, "--headless", "--path", rb.PROJ, "--script", "tests/duel.gd", "--", f"--kind={kind}", f"--build={build}",
           f"--sword={int(sword)}", f"--entry={entry}", f"--from={frm}", f"--n={n}", f"--bot={bot}", f"--dt={dt}"]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=3000)
    return [json.loads(l[4:]) for l in p.stdout.splitlines() if l.startswith("RES ")]


def run_duels(n, procs, bot, dt):
    res = {}
    jobs = []
    for build in "ABC":
        for sword in (False, True):
            jobs.append(("boss", build, sword, 1))
        for entry in (1, 2):
            for sword in ((False, True) if entry == 2 else (False,)):
                jobs.append(("warden", build, sword, entry))
    per = max(1, n // procs)
    tasks = []
    for j in jobs:
        f = 0
        while f < n:
            k = min(per, n - f)
            tasks.append((j, f, k)); f += k
    with ThreadPoolExecutor(procs) as ex:
        outs = list(ex.map(lambda t: (t[0], duel_chunk(*t[0], t[1], t[2], bot, dt)), tasks))
    for key, rs in outs:
        res.setdefault(key, []).extend(rs)
    return res


def mean(xs):
    xs = list(xs)
    return statistics.mean(xs) if xs else float("nan")


def fmt_pct(x):
    return f"{x * 100:.1f}%"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3000)
    ap.add_argument("--duel-n", type=int, default=600)
    ap.add_argument("--bots", default="proxy,aim,random")
    ap.add_argument("--procs", type=int, default=9)
    ap.add_argument("--dt", type=float, default=0.0666667)
    ap.add_argument("--skip-duel", action="store_true")
    a = ap.parse_args()
    bots = a.bots.split(",")
    rb.preflight()
    t0 = time.time()
    cells = run_cells(bots, a.n, a.procs, a.dt)
    duels = {} if a.skip_duel else run_duels(a.duel_n, a.procs, "proxy", a.dt)
    lines = []
    W = lines.append
    W("# 平衡报告（自动生成）\n")
    W(f"* 生成命令：`python3 tools/balance_report.py --n {a.n} --duel-n {a.duel_n}`；总耗时 {round(time.time() - t0)}s；模拟步长 dt={a.dt:.4f}s（15Hz）。")
    W("* **不作弊**：模拟只经 `Sim` 的输入口（移动/冲刺/主动键）与选择口（三选一/购买）操作；没有 debug 倍率、不改血量、不在战斗间回血、不改随机数。"
      "证据位置：`godot/tests/balance.gd` 第 36–44 行（循环里只有 `b.act(s, dt)` 与 `s.step(dt)`）；`godot/src/bot/bot.gd` 只写 `in_move/in_dash/in_skill` 与调用 `choose/buy_relic/close_shop`。\n")
    W("## 整局胜率 / 存活 / 死因（键鼠口径，无局外强化）\n")
    W("| 机器人 | 档位 | 局数 | 胜率 | 95%CI | 平均存活(战斗秒) | 进副本次数 | 副本通关率 | 副本内死亡率 | 副本超时率 | 死因 Top3 |")
    W("|---|---|---|---|---|---|---|---|---|---|---|")
    for (bot, tier), (s, runs) in cells.items():
        top = "、".join(f"{k}×{v}" for k, v in list(s["death_causes"].items())[:3]) or "-"
        ci = s.get("ci95", ["-", "-"])
        W(f"| {BOT_NAMES[bot]} | {TIER_NAMES[tier]} | {s['n']} | **{fmt_pct(s['win_rate'])}** | {fmt_pct(ci[0])}–{fmt_pct(ci[1])} | {s['mean_t']} | {s['rift_entries']} | "
          f"{fmt_pct(s.get('rift_clear_rate', 0))} | {fmt_pct(s.get('rift_death_rate', 0))} | {fmt_pct(s.get('rift_timeout_rate', 0))} | {top} |")
    W("\n## 死亡发生的阶段\n")
    W("| 机器人 | 档位 | S1 | S2 | S3 | BOSS |")
    W("|---|---|---|---|---|---|")
    for (bot, tier), (s, runs) in cells.items():
        d = s["death_by_seg"]
        W(f"| {BOT_NAMES[bot]} | {TIER_NAMES[tier]} | {d.get('S1', 0)} | {d.get('S2', 0)} | {d.get('S3', 0)} | {d.get('BOSS', 0)} |")
    W("\n## 整局里的击杀时长（秒）\n")
    W("| 机器人 | 档位 | 守关者第 1 次(通关均值) | 守关者第 2 次(通关均值) | 终局 BOSS 均值(无剑) | 终局 BOSS 均值(有剑) |")
    W("|---|---|---|---|---|---|")
    for (bot, tier), (s, runs) in cells.items():
        r1 = s.get("rift1", {}).get("t_clear")
        r2 = s.get("rift2", {}).get("t_clear")
        W(f"| {BOT_NAMES[bot]} | {TIER_NAMES[tier]} | {r1 if r1 is not None else '-'} | {r2 if r2 is not None else '-'} | {s['boss_time_nosword'] or '-'} | {s['boss_time_sword'] or '-'} |")
    # 单挑
    sw_red = None
    if duels:
        W("\n## 单挑（初始单挑口径：固定构筑、满血、真人代理）\n")
        W("| 对手 | 构筑 | 飞剑 | 局数 | 击杀率 | 平均击杀时长(胜局) | 平均时长(含败局) | 死亡/超时 |")
        W("|---|---|---|---|---|---|---|---|")
        agg = collections.defaultdict(list)
        for key in sorted(duels, key=lambda k: (k[0], k[3], k[1], k[2])):
            kind, build, sword, entry = key
            rs = duels[key]
            wins = [r for r in rs if r["win"]]
            label = "终局 BOSS" if kind == "boss" else f"守关者(第{entry}次)"
            W(f"| {label} | {build} | {'有' if sword else '无'} | {len(rs)} | {fmt_pct(len(wins) / max(1, len(rs)))} | {mean(r['dur'] for r in wins):.1f} | {mean(r['dur'] for r in rs):.1f} | "
              f"{len(rs) - len(wins)} |")
            if kind == "boss":
                agg[sword].extend(r["dur"] for r in wins)
        if agg[False] and agg[True]:
            sw_red = 1.0 - mean(agg[True]) / mean(agg[False])
            W(f"\n**拿到飞剑术后 BOSS 战时长：{mean(agg[False]):.1f}s → {mean(agg[True]):.1f}s，下降 {fmt_pct(sw_red)}**（3 种构筑合并，胜局均值）。")
    # 断言
    W("\n## 断言\n")
    checks = []
    for bot in bots:
        pass
    def chk(name, cond, detail):
        checks.append((name, cond, detail))
    if ("proxy", 0) in cells:
        for tier, lo, hi in ((0, 0.35, 0.48), (1, 0.45, 0.58), (2, 0.50, 0.62)):
            s = cells[("proxy", tier)][0]
            chk(f"真人代理 · {TIER_NAMES[tier]} 胜率 {int(lo*100)}%–{int(hi*100)}%", lo <= s["win_rate"] <= hi, fmt_pct(s["win_rate"]))
        chk("真人代理 · 进 2 次 胜率不得 >65%", cells[("proxy", 2)][0]["win_rate"] <= 0.65, fmt_pct(cells[("proxy", 2)][0]["win_rate"]))
        ents = sum(cells[("proxy", t)][0]["rift_entries"] for t in (1, 2))
        deaths = sum(1 for t in (1, 2) for r in cells[("proxy", t)][1] for e in r["rift"] if e["how"] == "death")
        chk("副本内死亡率 ≤12%（真人代理，进 1/2 次合并）", ents > 0 and deaths / ents <= 0.12, f"{deaths}/{ents} = {fmt_pct(deaths / max(1, ents))}")
    if sw_red is not None:
        chk("拿到飞剑术后 BOSS 战时长下降 25%–35%", 0.25 <= sw_red <= 0.35, fmt_pct(sw_red))
    chk("样本量 ≥3000 局/档", all(len(runs) >= 3000 for (_, runs) in cells.values()), f"{min(len(r) for (_, r) in cells.values())} 局/格")
    for name, cond, detail in checks:
        W(f"- {'✅' if cond else '❌'} {name}：{detail}")
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    with open(os.path.join(ROOT, "docs", "balance-report.md"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    sys.exit(0 if all(c for _, c, _ in checks) else 1)


if __name__ == "__main__":
    main()
