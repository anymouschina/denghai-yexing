# 《灯骸夜行》v2.0 · Godot 版

暗夜灯笼国风 · 俯视角割草肉鸽。运行本体是 Godot 4.7.2（`godot/`），发布形态是 Web/HTML5 导出（`build/web/`），Android 导出预设已配（本轮未出包）。H5（Phaser）旧版原样保留在仓库根目录（`src/` `public/` `index.html`）。历史迭代记录（v1.5–v1.7 的逐轮说明）归档在 `docs/history-README-v1.5-v1.7.md`，其中的「未做/未收敛」是当时状态，以本页和下面三份报告为准。

## 报告索引
- 设计：`docs/design-v2.md`；平衡：`docs/balance-report.md`（原始 JSON 在 `docs/balance/`）；性能：`PERF.md`；自检清单：`docs/standards-review.md`；验证截图：`docs/verify/`。

## 怎么跑
```bash
G=~/TapCanvasAgent/.tools/godot/current/Godot.app/Contents/MacOS/Godot
$G --headless --path godot --script tests/selftest.gd        # 规则自检（133 项，0 失败）
python3 tools/run_balance.py --bot proxy --tier 0 --n 300 --procs 10   # 平衡（tier 0/1/2 = 不进/进1/进2 次剑冢）
tools/export_web.sh                                           # 导出 build/web
THROTTLE=4 node tools/bench.mjs 300,500 out.json 12 1         # 性能压测
node tools/e2e_facing.mjs                                     # 朝左/失焦防卡键回归
```
键位：WASD/方向键移动、空格冲刺、E/J 飞剑、Q/R 葫芦合击（触屏「葫」键）、1/2/3 选卡、Esc 暂停（暂停里 X 或按钮=结算本局）。标题页 Enter/点空白=**新开一局**，「继续本局」是单独按钮；存档在 localStorage 键 `denghai_yexing_save_v15`（同写 `user://save.json`），「清空存档」在标题页。手感参数在 `godot/data/movement.json`。

## 玩法（v2.0）
- 地图 3600×2400，小地图、探索足迹、4 象限地标；POI：2 处剑冢裂隙（战剑灵，通关飞剑 +1 阶）、游商灯摊、2 处葫芦灵藤、古药葫芦秘境、镇魂宝库。
- 模式：完整夜行 30 分钟（6 段主题 + 每 5 分钟阶梯小 BOSS：跳尸王/破灯笼王/剑冢真主/纸轿冥娘/百灯鬼王，灯骸老祖压轴）/ 疾速试炼 10 分钟；融合按真实战斗时钟 5:30 必现。
- 飞剑 5 阶累加（回旋刺出→双剑→剑轮→追踪剑气→剑阵）；铜钱商店（白50/蓝110/紫200/金340）、16 件遗物、8 组套装（含机制效果）、4 把满级进化配件；7 色葫芦→葫芦小金刚（Q 合击、45s 复活冷却、掉印记）。
- 副本剑灵专属机制（御剑环身/回鞘突刺/剑雨）。

## 实测结果（终版）
- **平衡**（经典 8 分钟口径，真人代理 σ=0.05，每档 300 局）：不进副本 40.7%（35–48 ✅）/ 进 1 次 49.0%（45–58 ✅）/ 进 2 次 56.3%（50–62 ✅）；随机下限 0%。飞剑降时：进 1 次档约 −20%（未达 25%）、进 2 次档约 −41%（超过 35%）。**未做**：满 3000 局、瞄准机器人、30/10 分钟整局计时曲线、3 局事件日志。详见 `docs/balance-report.md`。
- **性能**（4× 降速）：300 只 58.8 FPS/p99 33.3ms/draw_calls 342/贴图 38.4MB（基线 40.8 FPS/1142/76MB）；500 只 48.6 FPS。**未达**：draw_calls<120、tex<30MB、p99<20ms。体积 ≈46MB（wasm 39.5MB 为引擎固定体积）。详见 `PERF.md`。
- **回归**：`selftest.gd` 133 项通过；`e2e_facing.mjs`（按住 D→失焦→按 A）通过；朝左偏移修复与 12 步试玩剧本预跑通过。手机横屏 844×390：`docs/verify/phone/` 有标题、开局（摇杆/闪/小地图/葫芦珠/箭头）、移动战斗、三选一、暂停共 5 张，无裁切无报错；脚本在暂停后卡住（旧脚本的“继续”按钮坐标因暂停面板新增按钮失效），因此**手机上的副本/商店/结算/存档未重跑**。
- **与 prototype/index.html 的演进**：原型三屏（标题/对局/结算）→ 成品保持画风与 HUD，新增：双模式标题、大地图+小地图、副本/秘境、商店、葫芦与小金刚、5 阶飞剑、6 段主题与小 BOSS。

## 试玩剧本（artifact.playtest，12 张截图）
标题双模式 → 全新开局 → 朝左 → 朝右 → 升级三选一 → 铜钱商店 → 葫芦灵藤 → 剑冢裂隙战剑灵 → 暂停构筑 → 中段激战 → 结算（暂停里 X「结算本局」，因为早期站桩不易阵亡）→ 再来一局。`?tapcanvasPlaytest=1` 时：开局清存档、默认 2× 节奏、第 2 次起升级三选一自动选第 1 张（保证走位不被弹窗打断）；不跳关、不无敌。

## 已知缺口
7 色葫芦合成小金刚、5:30 融合、阶梯小 BOSS 的整局实机截图（`docs/verify/full/`）本轮没有产出，由 `selftest.gd` 逐条断言覆盖；古药葫芦秘境/镇魂宝库未进试玩剧本。
