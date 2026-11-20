#!/usr/bin/env python3
"""并行跑 Godot headless 平衡模拟并汇总。
用法：python3 tools/run_balance.py --bot proxy --tier 0 --n 300 [--procs 9] [--set "WV.hpMulPerMin=1.3"] [--out file.json]
不作弊：模拟脚本只经 Sim 的输入口/选择口操作（见 godot/tests/balance.gd），没有 debug 倍率/改血量/战斗间回血。"""
import argparse, json, os, subprocess, sys, time, collections, statistics
from concurrent.futures import ThreadPoolExecutor

GODOT = os.environ.get("GODOT", "/Users/libiqiang/TapCanvasAgent/.tools/godot/current/Godot.app/Contents/MacOS/Godot")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.join(ROOT, "godot")


def run_chunk(args, frm, n):
    cmd = [GODOT, "--headless", "--path", PROJ, "--script", "tests/balance.gd", "--",
           f"--bot={args.bot}", f"--tier={args.tier}", f"--from={frm}", f"--n={n}", f"--dt={args.dt}"]
    if args.set:
        cmd.append(f"--set={args.set}")
    if getattr(args, "mode", "classic") != "classic":
        cmd.append(f"--mode={args.mode}")
    if args.touch:
        cmd.append("--touch")
    if args.plan is not None:
        cmd.append(f"--plan={args.plan}")
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=1500)
    except subprocess.TimeoutExpired:
        sys.stderr.write('chunk timeout\n')
        return []
    out = []
    for line in p.stdout.splitlines():
        if line.startswith("RES "):
            out.append(json.loads(line[4:]))
    if p.returncode != 0 and not out:
        sys.stderr.write(p.stderr[-800:])
    return out


def preflight():
    """先空跑一次（n=0）：脚本有解析错误时 Godot 会卡住不退出，这里 25 秒内发现并直接报错。"""
    cmd = [GODOT, "--headless", "--path", PROJ, "--script", "tests/balance.gd", "--", "--n=0"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
        out = p.stdout + p.stderr
    except subprocess.TimeoutExpired as e:
        out = ((e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or "")) + ((e.stderr or b"").decode() if isinstance(e.stderr, bytes) else (e.stderr or ""))
    if "SCRIPT ERROR" in out or "Parse Error" in out:
        sys.exit("GDScript 解析错误：\n" + "\n".join(l for l in out.splitlines() if "ERROR" in l or "at:" in l)[:1500])


def cause_group(c):
    if not c:
        return "-"
    src, kind = (c.split(":") + [""])[:2]
    return c


def summarize(runs):
    n = len(runs)
    wins = sum(1 for r in runs if r["win"])
    res = {"n": n, "win_rate": wins / n if n else 0}
    # 95% 置信区间（Wilson）
    if n:
        z = 1.96
        p = wins / n
        den = 1 + z * z / n
        c = (p + z * z / (2 * n)) / den
        h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / den
        res["ci95"] = [round(c - h, 4), round(c + h, 4)]
    res["mean_t"] = round(statistics.mean(r["t"] for r in runs), 1) if n else 0
    deaths = [r for r in runs if not r["win"]]
    res["death_causes"] = dict(collections.Counter(r["cause"] for r in deaths).most_common(12))
    res["death_by_seg"] = dict(collections.Counter(("S%d" % (r["seg"] + 1)) if r["phase"] != 3 else "BOSS" for r in deaths))
    bt = [r["boss_time"] for r in runs if r["boss_time"] > 0]
    res["boss_time_mean"] = round(statistics.mean(bt), 1) if bt else None
    res["boss_reached"] = sum(1 for r in runs if r["boss_time"] > 0 or r["phase"] == 3 or (r["seg"] == 2 and r["t"] >= 478))
    rl = [e for r in runs for e in r["rift"] if "entry" in e]   # 只统计剑冢裂隙（秘境 gourd/vault 记录无 entry 字段）
    res["rift_entries"] = len(rl)
    if rl:
        ok = [e for e in rl if e["ok"]]
        res["rift_clear_rate"] = round(len(ok) / len(rl), 3)
        res["rift_death_rate"] = round(sum(1 for e in rl if e["how"] == "death") / len(rl), 3)
        res["rift_timeout_rate"] = round(sum(1 for e in rl if e["how"] == "timeout") / len(rl), 3)
        res["rift_clear_t_mean"] = round(statistics.mean(e["t"] for e in ok), 1) if ok else None
        for k in (1, 2):
            ek = [e for e in rl if e["entry"] == k]
            if ek:
                okk = [e for e in ek if e["ok"]]
                res[f"rift{k}"] = {"n": len(ek), "clear": round(len(okk) / len(ek), 3),
                                   "t_clear": round(statistics.mean(e["t"] for e in okk), 1) if okk else None,
                                   "death": round(sum(1 for e in ek if e["how"] == "death") / len(ek), 3)}
    res["sword_runs"] = sum(1 for r in runs if r["art"] == "sword")
    sw_boss = [r["boss_time"] for r in runs if r["boss_time"] > 0 and r["art"] == "sword"]
    no_boss = [r["boss_time"] for r in runs if r["boss_time"] > 0 and r["art"] != "sword"]
    res["boss_time_sword"] = round(statistics.mean(sw_boss), 1) if sw_boss else None
    res["boss_time_nosword"] = round(statistics.mean(no_boss), 1) if no_boss else None
    for lab, cond in (("rc0", lambda r: r.get("rift_clears", 0) == 0), ("rc1p", lambda r: r.get("rift_clears", 0) >= 1)):
        bt2 = [r["boss_time"] for r in runs if r["boss_time"] > 0 and cond(r)]
        res["boss_time_" + lab] = round(statistics.mean(bt2), 1) if bt2 else None
        res["boss_n_" + lab] = len(bt2)
    res["ms_per_run"] = round(statistics.mean(r["ms"] for r in runs))
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bot", default="proxy")
    ap.add_argument("--tier", type=int, default=0)
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--from", dest="frm", type=int, default=0)
    ap.add_argument("--procs", type=int, default=9)
    ap.add_argument("--dt", type=float, default=0.0666667)
    ap.add_argument("--set", default="")
    ap.add_argument("--plan", default=None)
    ap.add_argument("--mode", default="classic")
    ap.add_argument("--touch", action="store_true")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    preflight()
    chunk = max(1, args.n // (args.procs * 3))
    jobs = []
    f = args.frm
    left = args.n
    while left > 0:
        k = min(chunk, left)
        jobs.append((f, k))
        f += k
        left -= k
    t0 = time.time()
    with ThreadPoolExecutor(args.procs) as ex:
        results = list(ex.map(lambda j: run_chunk(args, *j), jobs))
    runs = [r for part in results for r in part]
    summ = summarize(runs)
    summ["wall_s"] = round(time.time() - t0, 1)
    summ["args"] = {k: v for k, v in vars(args).items()}
    print(json.dumps(summ, ensure_ascii=False, indent=1))
    if args.out:
        with open(args.out, "w") as fh:
            json.dump({"summary": summ, "runs": runs}, fh, ensure_ascii=False)


if __name__ == "__main__":
    main()
