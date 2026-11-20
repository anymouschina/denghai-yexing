#!/usr/bin/env python3
"""把 @fontsource/ma-shan-zheng 的分片字体按工程里实际用到的字符合并裁剪成 MaShanZheng-subset.ttf，
并将 MaShanZheng 缺失的字符从系统字体裁剪成 Fallback-subset.ttf（Web 导出没有系统字体）。
用法：python3 tools/make_font.py   （改了界面文案或数据配置后重跑）"""
import glob
import io
import json
import os
import re
import sys
from fontTools import merge, subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = os.path.join(ROOT, "node_modules/@fontsource/ma-shan-zheng/files")
OUT_PRIMARY = os.path.join(ROOT, "godot/fonts/MaShanZheng-subset.ttf")
OUT_FALLBACK = os.path.join(ROOT, "godot/fonts/Fallback-subset.ttf")

FALLBACK_CANDIDATES = [
    ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", {}),
    ("/System/Library/Fonts/STHeiti Medium.ttc", {"fontNumber": 0}),
]

EXTRA_PUNCT = (
    "，。、；：？！“”‘’（）【】《》「」『』…—·•"
    "×÷±≥≤→←↑↓★☆●○◆◇■□▲△▼▽❚▶◀✕✓"
    "０１２３４５６７８９"
)


def _json_strings(v):
    """递归提取 JSON 中所有可显示字符串（跳过以下划线开头的文档键与 src 路径）。"""
    if isinstance(v, dict):
        for k, x in v.items():
            if k.startswith("_") or k in ("src",):
                continue
            yield from _json_strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _json_strings(x)
    elif isinstance(v, str):
        yield v


def collect_chars():
    gd_chars = set()
    gd_files = sorted(glob.glob(os.path.join(ROOT, "godot/src/**/*.gd"), recursive=True))
    for path in gd_files:
        src = open(path, encoding="utf-8").read()
        for lit in re.findall(r'"((?:[^"\\\n]|\\.)*)"', src):
            gd_chars |= set(lit)
        for lit in re.findall(r"'((?:[^'\\\n]|\\.)*)'", src):
            gd_chars |= set(lit)

    json_chars = set()
    json_files = sorted(glob.glob(os.path.join(ROOT, "godot/data/**/*.json"), recursive=True))
    for path in json_files:
        data = json.load(open(path, encoding="utf-8"))
        for st in _json_strings(data):
            json_chars |= set(st)

    ascii_chars = {chr(c) for c in range(0x20, 0x7F)}
    punct_chars = set(EXTRA_PUNCT)

    clean = lambda s: {c for c in s if not c.isspace() or c == " "}
    gd_chars = clean(gd_chars)
    json_chars = clean(json_chars)
    project_chars = gd_chars | json_chars
    all_chars = clean(project_chars | ascii_chars | punct_chars)
    return {
        "gd_files": len(gd_files),
        "json_files": len(json_files),
        "project": project_chars,
        "all": all_chars,
    }


def make_subset_options():
    opts = subset.Options()
    opts.layout_features = []
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = [1, 2]
    opts.notdef_outline = True
    opts.drop_tables += ["DSIG"]
    return opts


def build_primary(chars):
    slices = sorted(glob.glob(os.path.join(FILES, "*-400-normal.woff2")))
    if not slices:
        sys.exit(f"ERROR: no woff2 slices found under {FILES}")
    per = []
    covered = set()
    for path in slices:
        font = TTFont(path)
        cmap = font.getBestCmap() or {}
        want = {c for c in chars if ord(c) in cmap} - covered
        if not want:
            continue
        covered |= want
        sub = subset.Subsetter(make_subset_options())
        sub.populate(text="".join(sorted(want)))
        sub.subset(font)
        font.flavor = None
        buf = io.BytesIO()
        font.save(buf)
        buf.seek(0)
        per.append(buf)
    if not per:
        sys.exit("ERROR: primary font produced 0 glyphs")
    merged = TTFont(per[0]) if len(per) == 1 else merge.Merger().merge(per)
    os.makedirs(os.path.dirname(OUT_PRIMARY), exist_ok=True)
    merged.save(OUT_PRIMARY)
    return covered


def build_fallback(missing_chars):
    if not missing_chars:
        return set(), None
    for path, kwargs in FALLBACK_CANDIDATES:
        if not os.path.exists(path):
            continue
        font = TTFont(path, **kwargs)
        cmap = font.getBestCmap() or {}
        want = {c for c in missing_chars if ord(c) in cmap}
        if not want:
            continue
        if len(want) < len(missing_chars):
            # Prefer a candidate that covers all missing glyphs if available
            continue
        sub = subset.Subsetter(make_subset_options())
        sub.populate(text="".join(sorted(want)))
        sub.subset(font)
        font.flavor = None
        os.makedirs(os.path.dirname(OUT_FALLBACK), exist_ok=True)
        font.save(OUT_FALLBACK)
        return want, path

    # Partial coverage fallback across candidates (merge if needed)
    per = []
    covered = set()
    used = []
    for path, kwargs in FALLBACK_CANDIDATES:
        if not os.path.exists(path):
            continue
        font = TTFont(path, **kwargs)
        cmap = font.getBestCmap() or {}
        want = {c for c in missing_chars if ord(c) in cmap} - covered
        if not want:
            continue
        covered |= want
        used.append(path)
        sub = subset.Subsetter(make_subset_options())
        sub.populate(text="".join(sorted(want)))
        sub.subset(font)
        font.flavor = None
        buf = io.BytesIO()
        font.save(buf)
        buf.seek(0)
        per.append(buf)
    if not per:
        sys.exit("ERROR: no fallback system font found for missing glyphs")
    merged = TTFont(per[0]) if len(per) == 1 else merge.Merger().merge(per)
    os.makedirs(os.path.dirname(OUT_FALLBACK), exist_ok=True)
    merged.save(OUT_FALLBACK)
    return covered, ", ".join(used)


def verify_output(project_chars, all_chars):
    primary_cmap = set((TTFont(OUT_PRIMARY).getBestCmap() or {}).keys())
    fallback_cmap = set()
    if os.path.exists(OUT_FALLBACK):
        fallback_cmap = set((TTFont(OUT_FALLBACK).getBestCmap() or {}).keys())
    combined = primary_cmap | fallback_cmap
    missing_project = sorted(c for c in project_chars if ord(c) not in combined)
    missing_all = sorted(c for c in all_chars if ord(c) not in combined)
    return primary_cmap, fallback_cmap, missing_project, missing_all


def main():
    info = collect_chars()
    all_chars = info["all"]
    project_chars = info["project"]

    primary_covered = build_primary(all_chars)
    missing_from_primary = sorted(all_chars - primary_covered)
    fallback_covered, fb_source = build_fallback(missing_from_primary)

    primary_cmap, fallback_cmap, missing_project, missing_all = verify_output(
        project_chars, all_chars
    )
    ascii_chars = [chr(c) for c in range(0x20, 0x7F)]
    missing_primary_ascii = [c for c in ascii_chars if ord(c) not in primary_cmap]

    print("=== Font Subset Build & Verification ===")
    print(f"Scanned: {info['gd_files']} .gd files, {info['json_files']} .json files")
    print(f"Target chars: {len(all_chars)} total ({len(project_chars)} from src/**/*.gd + data/**/*.json)")
    print(
        f"MaShanZheng-subset.ttf: {len(primary_cmap)} glyphs, "
        f"{os.path.getsize(OUT_PRIMARY):,} bytes "
        f"(ASCII {len(ascii_chars) - len(missing_primary_ascii)}/{len(ascii_chars)})"
    )
    if os.path.exists(OUT_FALLBACK):
        fb_chars = "".join(sorted(fallback_covered))
        print(
            f"Fallback-subset.ttf:    {len(fallback_cmap)} glyphs, "
            f"{os.path.getsize(OUT_FALLBACK):,} bytes (source: {os.path.basename(fb_source or '')})"
        )
        print(f"Fallback chars ({len(fallback_covered)}): {fb_chars}")
    print(f"Verified missing (src + data): {len(missing_project)}")
    print(f"Verified missing (all target): {len(missing_all)}")

    if missing_primary_ascii:
        bad_ascii = "".join(missing_primary_ascii)
        sys.exit(f"ERROR: MaShanZheng-subset.ttf missing ASCII glyphs: {bad_ascii}")

    if missing_project or missing_all:
        bad = "".join(missing_all)
        codes = [f"U+{ord(c):04X}" for c in missing_all]
        sys.exit(f"ERROR: {len(missing_all)} missing glyphs remain: {bad} ({', '.join(codes)})")


if __name__ == "__main__":
    main()
