#!/usr/bin/env python3
"""生成 godot/data/anchors.json：每张贴图/序列帧的“身体中轴”水平锚点（占宽度比例）。
朝左翻转必须绕这条轴镜像，而不是绕帧中心，否则身体不在碰撞体中心上（偏差 = 2×(锚点−0.5)×宽）。
轴 = 每行不透明像素 (min+max)/2 的中位数（对提灯/拖尾等单侧突出物稳健）。"""
import json, os, numpy as np
from PIL import Image
A = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "godot", "assets")
def axis(im):
    a = np.array(im.convert("RGBA"))[:, :, 3] > 40
    mids = [(np.where(r)[0].min() + np.where(r)[0].max()) / 2 for r in a if r.any()]
    return float(np.median(mids)) / a.shape[1]
out = {}
for n in ["enemy_paperman","enemy_foxfire","enemy_lanternyokai","enemy_jiangshi","enemy_firecracker","boss","boss_swordwarden","merchant"]:
    out[n] = round(axis(Image.open(f"{A}/{n}.png")), 4)
def sheet(path, fw, fh, cols, n):
    im = Image.open(f"{A}/{path}"); v = []
    for i in range(n):
        v.append(axis(im.crop(((i % cols) * fw, (i // cols) * fh, (i % cols) * fw + fw, (i // cols) * fh + fh))))
    return round(float(np.mean(v)), 4)
out["hero_run"] = sheet("hero_run.png", 152, 192, 6, 12)
out["boss_idle"] = sheet("anim/boss_idle.png", 236, 384, 8, 8)
out["jiangshi_hop"] = sheet("anim/jiangshi_hop.png", 119, 200, 8, 8)
json.dump(out, open(f"{A}/../data/anchors.json", "w"), indent=1)
print(out)
