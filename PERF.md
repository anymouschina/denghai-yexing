# PERF 性能报告（终版）

压测：`node tools/bench.mjs <N列表> <out.json> [秒] [gpu=1]`（`THROTTLE=4` 为 CDP CPU 降速 4×，模拟中低端手机；`BENCH_DIR` 指定被测构建）。bench 模式（`?tapcanvasPlaytest=1&bench=N`）：同屏妖物恒为 N，满级三武器+进化+飞剑，玩家不死。Chrome（Metal GPU）1280×720，本机 Apple Silicon。原始数据：`docs/perf/*.json`。

## 基线 vs 终版（4× CPU 降速）
| N | 版本 | FPS | p95 | p99 | >33ms 帧 | draw_calls | 贴图显存 |
|---|---|---|---|---|---|---|---|
| 300 | 基线（优化前） | 40.8 | 33.4 | 49.9 | 6.8% | 1142 | 76.2MB |
| 300 | **终版** | **58.8** | 16.8 | 33.3 | 0.4% | 342 | 38.4MB |
| 500 | 基线（优化前） | 29.4 | 50.0 | 50.1 | 33.3% | — | 76.2MB |
| 500 | **终版** | **48.6** | 33.4 | 33.4 | 2.7% | 320 | 38.4MB |
本机无降速时 300 只同屏为 60 FPS（垂直同步封顶）、p99 16.8ms。原始数据：`docs/perf/baseline-throttle4.json`、`docs/perf/final-v2-throttle4.json`。

## 做了什么
1. 视口裁剪（`_visible`）；排序改原生 `PackedInt64Array.sort()`，去闭包与逐帧数组分配。
2. 阴影单独一遍、掉落物移出 y 排序并按贴图种类分批；5 种小怪合并为 `enemy_atlas.png`（仍按 `anchors.json` 中轴镜像）。
3. 血条/剑痕/符印移到统一叠加循环，叠加线条/圆弧关闭逐线抗锯齿；飘字最多画 24 条。
4. `_enemy_cache`/`PICKUP_TEX` 常量查表，消除逐帧临时分配。
5. 4 张背景降到 1024×576，只驻留当前 1 张，镜像平铺铺满 3600×2400。

## 未达成目标（如实）
- `draw_calls` 342（目标 <120）：精灵逐个提交，未改成 MultiMesh/批量几何。
- 贴图显存 38.4MB（目标 <30MB）：新增 4 张美术（小金刚与 3 位小 BOSS）、英雄/BOSS 序列帧占大头。
- 4× 降速 300 只 p99 为 33.3ms（目标 <20ms），FPS 58.8 达标；500 只 48.6 FPS。
- 构建体积约 46MB：`index.wasm` 39.5MB 是 Godot 官方 Web 模板固定体积，游戏资产约 7MB，无法再靠素材压缩降到 40MB 以下。
