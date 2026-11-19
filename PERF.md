# PERF 性能报告（终版）

压测：`THROTTLE=4 node tools/bench.mjs 300,500 docs/perf/final-v2-throttle4.json 12 1`（`THROTTLE=4` 为 CDP CPU 降速 4×，模拟中低端手机）。bench 模式（`?tapcanvasPlaytest=1&bench=N`）：同屏妖物恒为 N，满级三武器+进化+飞剑，玩家不死。Chrome（Metal GPU）1280×720，本机 Apple Silicon。原始数据：`docs/perf/*.json`。

## 基线 vs 终版（4× CPU 降速）
| N | 版本 | FPS | p95 | p99 | >33ms 帧 | draw_calls | 贴图显存 |
|---|---|---|---|---|---|---|---|
| 300 | 基线（优化前） | 40.8 | 33.4 | 49.9 | 6.8% | 1142 | 76.2MB |
| 300 | **终版** | **59.9** | 16.7ms | **16.8ms** | 0.1% | 591 | **27.4MB** |
| 500 | 基线（优化前） | 29.4 | 50.0 | 50.1 | 33.3% | — | 76.2MB |
| 500 | **终版** | **48.3** | 33.4 | 33.4 | 3.2% | 592 | 27.4MB |
数据：`docs/perf/baseline-throttle4.json`、`docs/perf/final-v2-throttle4.json`。

## 达成 / 未达成
- ✅ 300 只 4× 降速：60 FPS、p99 16.8ms（<20ms）。
- ✅ 贴图显存 27.4MB（<30MB）：HUD/UI 字体改 MSDF（`fonts/MaShanZheng-subset.ttf.import`），不再为每种字号生成大字形图集。
- ❌ `draw_calls` 591（目标 <120）：MSDF 文字使用独立着色器，HUD 里每段文字提交一次，比 MSDF 前（约 320）更多；精灵合批已做（图集、阴影/掉落分批、路灯前置、叠加循环、子弹用 `draw_primitive` 一次提交），但文字逐串提交未合并。若要压到 <120，需把 HUD 文字改成 Label 节点（只在数值变化时重排）或位图字体，本轮未做。
- ❌ 500 只 4× 降速 48.3 FPS、p99 33.4ms（<20ms 未达）。
- ✅ 构建体积 39,993,142 字节（<40,000,000）：`index.wasm` 38.17MB（官方模板经 binaryen `wasm-opt -Oz`，需开启 exception-handling 等特性开关，浏览器加载与 bench 运行已验证）；`index.pck` 1.63MB（图片有损 WebP、音效 WAV→QOA 单声道 16kHz 且只留一套变体、排除未引用旧图、字体子集只含源码字符串与数据里的字）；`index.js` 经 esbuild 压缩。
- 关 MSDF 实测 draw_calls 降到约 244–270，但贴图显存回到 37MB，取舍后保留 MSDF（贴图达标）。

## 已做的优化清单
1. 视口裁剪；排序改原生 `PackedInt64Array.sort()`；去逐帧临时数组/字典（`_enemy_cache`、`PICKUP_TEX`）。
2. 阴影单独一遍；掉落物按贴图种类分批；5 种小怪合并为 `enemy_atlas.png`；路灯在排序前统一绘制。
3. 血条/剑痕/符印移到统一叠加循环，关闭逐线抗锯齿；飘字最多 12 条，描边与正文分两遍。
4. 子弹/剑轮/剑气用 `draw_primitive` 四顶点提交（无 `draw_set_transform`）。
5. 小地图探索迷雾缓存为 36×24 `ImageTexture`（仅探索格变化时重建），每帧一次提交。
6. 背景降到 1024×576，只驻留当前 1 张，镜像平铺 3600×2400。
