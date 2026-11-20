#!/usr/bin/env python3
"""把 @fontsource/ma-shan-zheng 的分片字体按工程里实际用到的汉字合并裁剪成一个 TTF（Web 导出没有系统字体）。
用法：python3 tools/make_font.py   （改了界面文案后重跑）"""
import glob, io, os, re, sys
from fontTools.ttLib import TTFont
from fontTools import subset, merge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = os.path.join(ROOT, "node_modules/@fontsource/ma-shan-zheng/files")
OUT = os.path.join(ROOT, "godot/fonts/MaShanZheng-subset.ttf")

# 需要的字符：工程文本 + 常用标点 + ASCII
chars = set(chr(c) for c in range(0x20, 0x7f))
import re as _re
for f in glob.glob(os.path.join(ROOT, "godot/src/**/*.gd"), recursive=True):
    for lit in _re.findall(r'"((?:[^"\\\n]|\\.)*)"', open(f, encoding="utf-8").read()):   # 只取双引号字符串字面量（排除注释里的汉字）
        chars |= set(lit)
import json as _json
def _strings(v, key=""):
    # 只收会显示的字符串：键名以 "_" 开头的（_doc 等说明）与 desc/src 说明不进字体
    if isinstance(v, dict):
        for k, x in v.items():
            if k.startswith("_") or k in ("src",):
                continue
            yield from _strings(x, k)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x, key)
    elif isinstance(v, str):
        yield v
for f in glob.glob(os.path.join(ROOT, "godot/data/*.json")):
    for st in _strings(_json.load(open(f, encoding="utf-8"))):
        chars |= set(st)
chars |= set("，。、；：？！“”‘’（）【】《》…—·×→←↑↓★☆●○◆◇■□▲△▼▽❚⏸▶◀✕✓" "０１２３４５６７８９")
chars = {c for c in chars if not c.isspace() or c == " "}

slices = sorted(glob.glob(os.path.join(FILES, "*-400-normal.woff2")))
per = []
covered = set()
for f in slices:
    font = TTFont(f)
    cmap = font.getBestCmap()
    want = {c for c in chars if ord(c) in cmap} - covered
    if not want:
        continue
    covered |= want
    opts = subset.Options()
    opts.layout_features = []
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = [1, 2]
    opts.notdef_outline = True
    opts.drop_tables += ["DSIG"]
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(sorted(want)))
    sub.subset(font)
    font.flavor = None
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    per.append(buf)

if not per:
    sys.exit("no glyphs")
if len(per) == 1:
    merged = TTFont(per[0])
else:
    merged = merge.Merger().merge([per_i for per_i in per])
os.makedirs(os.path.dirname(OUT), exist_ok=True)
merged.save(OUT)
missing = sorted(c for c in chars if c not in covered and ord(c) > 0x7f)
print("glyphs:", len(covered), "bytes:", os.path.getsize(OUT), "missing(non-ascii):", "".join(missing))
