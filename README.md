# 《灯骸夜行》v1.5 · Godot 版

暗夜灯笼国风 · 俯视角割草肉鸽。**运行本体已迁到 Godot 4（`godot/`），对外发布形态仍是 Web/HTML5 导出（`build/web/`）**，并预先配好了 Android 导出预设，之后可直接出 APK。
H5（Phaser）旧版原样保留在仓库根目录（`src/` `public/` `index.html`），迁移期间仍是可发布版本，本次没有改动它的任何文件。

## 1. 为什么迁 Godot

| 原因 | 说明 |
|---|---|
| 性能 | H5 版（Phaser + DOM 覆盖层）在中低端手机上靠“同屏上限 220→130、关粒子”降档保帧；Godot 的 2D 渲染把实体画在同一批次里，且规则层是纯数据（无节点），同屏 260 只妖物也不吃力 |
| 同一份规则，测的就是玩的 | 战斗/副本/飞剑全部在 `godot/src/sim/sim.gd`（不依赖节点）。游戏渲染与 headless 平衡脚本共用它，平衡数据不是“另一份近似实现”跑出来的 |
| 一份工程，多端导出 | 同一个 Godot 工程导出 Web（TapTap H5 包路径 `build/web`）与 Android（预设已配）；触屏控件、安全区、分辨率自适应在引擎侧统一处理 |
| 数据外置 | 数值、关卡、遗物、副本规则全在 `godot/data/*.json`；规则自检与平衡脚本只读这些表 |

## 2. 工程结构

```
godot/                     Godot 4.7.2 工程（GDScript，Compatibility 渲染器）
  project.godot            1280×720 基准，canvas_items + expand（宽屏手机多出的横向空间显示更多场地）
  export_presets.cfg       预设 0 = Web（无线程，输出 ../build/web）；预设 1 = Android（arm64，横屏）
  data/                    balance / waves / enemies / upgrades / meta（沿用 H5 数值）+ dungeon / relics / segments（v1.5 新增）
  assets/                  H5 版全部美术（原样复用）+ v1.5 新生成素材（裂隙 / 游商 / 飞剑 / 灯芯 / 遗物图标 / 3 张场地）
  audio/sfx/*.wav          H5 的 ZzFX 音效参数离线渲染；audio/bgm_*.mp3 为 H5 程序化编曲录制的循环
  fonts/                   马善政楷体子集（按工程实际用字裁剪，Web 导出没有系统字体）
  web/shell.html           自定义 HTML 外壳：加载过场、竖屏“请横屏”、禁滚动缩放、横屏锁定尝试
  src/sim/                 规则核心（纯数据）：sim.gd（一局）· game_data.gd（读 data）· cards.gd（卡面文本）· 实体类
  src/bot/bot.gd           平衡验证机器人（随机下限 / 真人代理 / 瞄准机器人）
  src/*.gd                 渲染与界面：world_view（世界渲染）· hud · title_screen · touch_controls · game_screen · audio · playtest …
  tests/                   selftest.gd（规则自检）· balance.gd（整局平衡）· duel.gd（单挑）
build/web/                 Web 导出产物（index.html + wasm + pck）
docs/design.md             设计文档（循环 / 爽点 / 成长 / 完整性清单 / 决策记录）
docs/balance-report.md     平衡报告（由脚本生成）
docs/verify/               手机横屏端到端验证截图与日志
tools/                     导出 / 平衡 / 字体 / 音效 / 录 BGM / 端到端验证脚本
prototype/                 设计原型（含 v1.5 新增页）
```

## 3. 怎么跑

```bash
G=~/TapCanvasAgent/.tools/godot/current/Godot.app/Contents/MacOS/Godot   # Godot 4.7.2 标准版

# 编辑器里运行
$G --path godot --editor

# headless：加载工程并跑规则自检（v1.5 规格逐条断言，退出码 0 = 全过）
$G --headless --path godot --script tests/selftest.gd

# 平衡（一条命令重跑并生成报告；--n 3000 为完整口径，约 1 小时，9 个并行进程）
python3 tools/balance_report.py --n 3000
python3 tools/balance_report.py --n 200 --bots proxy --skip-duel   # 快速检查
```

键位：`WASD / 方向键` 移动 · `空格 / Shift` 冲刺 · `E / J / 鼠标右键` 飞剑（出鞘 → 再按召回刺出） · `1/2/3` 选卡 · `Esc` 暂停 · `M` 静音。
触屏：左半屏浮动摇杆 · 右下「闪」· 拿到飞剑术后「剑」· 右上暂停。

## 4. 怎么导出 H5

```bash
tools/export_web.sh      # = godot --headless --path godot --export-release "Web" ../build/web/index.html
```

* 产物 `build/web/index.html`（+ `index.js / index.wasm / index.pck / worklet`），**资源全是相对路径**，可直接放进 TapTap H5 包路径或任意静态服务器（不需要跨源隔离头：无线程版）。
* 导出模板：`~/Library/Application Support/Godot/export_templates/4.7.2.stable/` 里需要 `web_nothreads_release.zip`（本机已装）。
* URL 参数：`?touch=1` 强制触屏模式；`?tapcanvasPlaytest=1&seed=N&ts=K` 开试玩桥（`ts` 只是 sim 加速倍率，用于脚本在限定时间内走完整局，不跳关、不无敌）。
* 平台差异：Web 版声音需首次点击/按键后才会出声（标题页的开始操作即是），存档在浏览器 IndexedDB（`user://save.json`）。

## 5. 怎么出 APK（本轮只配好预设，没出包）

预设 `Android`（`godot/export_presets.cfg` 第 2 个）：包名 `com.denghai.yexing`、arm64-v8a、横屏（`sensor_landscape`）、沉浸模式、版本 1.5.0 (code 15)。本机**缺这些东西**，出包前需补齐：

1. **JDK 17**：`brew install --cask temurin@17`，Godot 编辑器设置 → `Export > Android > Java SDK Path`。
2. **Android SDK**：装 `commandlinetools`，然后
   ```bash
   sdkmanager "platform-tools" "build-tools;34.0.0" "platforms;android-34" "cmdline-tools;latest" "cmake;3.10.2.4988893" "ndk;28.1.13356709"
   ```
   在编辑器设置里填 `Android SDK Path`（本机设置里已预填 `~/Library/Android/sdk`，目录尚不存在）。
3. **Android 导出模板**：下载同版本的 `Godot_v4.7.2-stable_export_templates.tpz`（官方 GitHub Release），解压后把 `android_release.apk`、`android_debug.apk`、`android_source.zip` 放进模板目录（本机只装了 Web 模板）。
4. **签名**：
   * 调试包：`keytool -genkeypair -v -keystore debug.keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"`，路径填到编辑器设置 `Export > Android > Debug Keystore`。
   * 发布包：自备 release keystore，写到预设 `keystore/release`、`keystore/release_user`、`keystore/release_password`（或用环境变量 `GODOT_ANDROID_KEYSTORE_RELEASE_PATH / _USER / _PASSWORD`，**不要把口令提交进仓库**）。
5. 图标：预设里 `launcher_icons/*` 为空时用默认图标；要发布请补 192×192 与 432×432 自适应图标。
6. 导出：`godot --headless --path godot --export-release "Android" ../build/android/denghai-yexing.apk`（Google Play 需要 AAB：预设里开 `gradle_build/use_gradle_build` 并安装 Android 构建模板）。

触屏手感（摇杆曲线、闪/剑键、安全区）在 Android 上走同一套代码：安全区读 `DisplayServer.get_display_safe_area()`，Web 读 CSS `env(safe-area-inset-*)`。

## 6. v1.5 新增玩法（摘要，规格见 `docs/design.md`）

* 一局 8 分钟战斗分 **3 段场地**（荒园灯市 → 荒坟夜雾 → 焦灯市），每段后是**段间**，最后 BOSS 灯骸老祖。
* 段间清场后场地中央出现「**灯骸裂隙**」：站定进入，消耗 1 枚**灯芯**，并放弃该段间的三选一；生命低于 60% 显示“灯弱，不可入”。
* **灯芯**：开局 2 枚、BOSS 前 +1；同一资源也能在**游商**换遗物——双用途是防“每局必刷副本”的闸门。
* 守关者（跳尸王原型 + 迅捷/震地/灯焰 + 1.3 倍体型）血量 = 玩家当前 DPS × 目标击杀秒数（第 1 次 55s/限时 70s，第 2 次 70s/限时 90s），每局最多进 2 次；副本内无补给、无三选一、骨灯全熄、冲刺冷却 ×1.25、受击硬直 ×1.2。
* 失败：弹出、扣当前生命 30%、灯芯不退、该裂隙本局封闭、不结束本局；出副本后**下一段威胁预算 +1 档**。
* 唯一法宝《**飞剑术**》：出鞘绕玩家椭圆回旋并穿甲，命中叠「剑痕」（+6%/层，5 层封顶）；再按键召回、向面朝方向刺出 1.8 倍二段；召回瞬间受击则飞剑坠地 3 秒。法宝增伤与武器进化取**加算**。

## 7. 手机横屏适配（Godot 侧）

| 项 | 做法 |
|---|---|
| 分辨率 / 拉伸 | 基准 1280×720，`stretch=canvas_items`、`aspect=expand`：宽屏手机（844×390、900×414 …）横向多出的空间显示更多场地，画面不被拉伸、不留黑边；HUD 锚到视口边 |
| 安全区 / 刘海 | Web：自定义外壳 `viewport-fit=cover`，用探针元素读 `env(safe-area-inset-*)`（`SafeArea.insets`）；原生：`DisplayServer.get_display_safe_area()`。HUD、摇杆、按钮都按内缩布局 |
| 摇杆 | 左半屏浮动原点，死区 14%，加速曲线 `0.22+0.78·n^1.25`，按 touch index 追踪（可与按钮多点同时按） |
| 按钮 | 右下「闪」（带冷却环）、「剑」（拿到飞剑术后出现，随状态变“收”）、右上暂停；半径 ≥ 34 设计像素，热区外扩 14 |
| 竖屏 | 触屏设备竖屏显示“请横屏”引导层；首次手势后尝试 `screen.orientation.lock('landscape')`，不能锁则降级为提示 |
| 禁滚动缩放 | `touch-action:none`、`overscroll-behavior:none`，拦截 touchmove / 双指 / gesture / 长按菜单 |
| 手感校准 | 仅触屏生效（`balance.json → touch`）：受伤 ×0.72、受击无敌 +0.35s、移速 ×1.07、冲刺冷却 ×0.85、拾取 ×1.2、刷怪间隔 ×1.15。**平衡数据按键鼠口径** |
| 低端机 | Web 触屏同屏妖物上限 150、关余烬 |
| 桌面键鼠 | 键位与 H5 版一致，键盘有输入时以键盘为准；触屏控件只在检测到触屏（`pointer: coarse` / `?touch=1`）时创建 |

## 8. 平衡验证（不作弊）与结果

**不作弊证据**：`godot/tests/balance.gd` 的对局循环里只有 `b.act(s, dt)`（机器人只写 `in_move / in_dash / in_skill`，选卡/买遗物走 `choose / buy_relic`）与 `s.step(dt)`；没有 debug 倍率、不改血量、不在战斗间回血。`tests/selftest.gd`（69 项规则断言）为单元测试，允许直接构造场景，不计入平衡数据。

一条命令重跑：`python3 tools/balance_report.py --n 3000`（报告写入 `docs/balance-report.md`）。

### 本轮实测（真人代理 σ=0.05，键鼠口径，无局外强化）

| 档位 | 局数 | 胜率 | 断言区间 | 结论 |
|---|---|---|---|---|
| 不进副本 | 240 | 42.5% | 35%–48% | 通过 |
| 进 1 次 | 240 | 46.7% | 45%–58% | 通过（贴近下限） |
| 进 2 次 | 150（调参最终配置的采样） | 53.3% | 50%–62%，且 ≤65% | 通过 |
| 副本内死亡率 | 进 1/2 次合计 ~420 次入场 | 0% | ≤12% | 通过，但说明守关者几乎不杀人，副本失败主要靠超时 |
| 飞剑术后 BOSS 战时长下降 | 整局口径 | 约 22%–23%（有剑 41–45s vs 无剑 53–59s） | 25%–35% | **未达标** |

### 未完成 / 未达标（如实）
- **样本量不足**：要求每档 ≥3000 局，实际只跑了 150–240 局（单局 ~3 秒，3000 局×3 档约数小时，本轮提前收尾）。小样本胜率 95% 置信区间约 ±6–8 个点，**进 1 次的 46.7% 离下限 45% 很近，不能算稳**，需要用满样本复核。
- **随机下限机器人、瞄准机器人（克隆试射）没有出数据**；机器人代码已写好（`src/bot/bot.gd`），`balance_report.py` 默认会跑。
- **飞剑术 BOSS 时长下降 22%–23%，低于 25% 断言**，没有改断言迁就，需继续调飞剑数值（`data/dungeon.json → sword`）后重跑。
- 守关者血量用 `warden.eff`（各武器实战效率系数）折算 DPS；该系数是靠真人代理实测标定的，已写在 `data/dungeon.json`。

## 9. 手机横屏验证（Chrome + CDP 真实触摸，844×390 / 900×414）

`tools/e2e_phone.mjs`；截图与日志在 `docs/verify/`。已走通：标题 → 开局 → 摇杆移动自动攻击 → 升级三选一 → 暂停 → 死亡结算 → 再来一局（两个视口均无页面报错）；`phone-844x390-rift-fail-s21` 走到清场出现裂隙、进入副本击杀失败弹出；`phone-900x414-s23` 走到段间与馈赠三选一。
**未完整留档**：「进副本击杀守关者 → 拿到飞剑术」这一条在手机视口曾由脚本走通一次（日志显示 got-feijianshu、sword-out-orbiting），但截图被我清理时误删，之后重跑 6 次没能复现（脚本的躲避机器人较弱、墙钟计时有波动）。该链路的规则已由 `selftest.gd` 覆盖，手机截图证据缺这一环。
**未做**：真机；桌面键鼠端到端截图回归（只有试玩预跑）；Android 出包（本轮只配预设）。


## 10. 已知问题（验收返工记录）
- 返工修复：点到画布边缘/页面外后画布失焦，键盘事件到不了 Godot（点击后按 Enter/WASD 无反应）。`godot/web/shell.html` 现在在任何指针按下、窗口聚焦、按键时把焦点还给画布；回归脚本 `node tools/e2e_focus.mjs`（点画布右下角再按 Enter，应进入 play）。
- 构建体积 52MB：其中 `index.wasm` 39.5MB 是官方 Web 导出模板，无法裁剪（需自编译精简模板），超出标准库 40MB 预算，未解决。

## 11. v1.5.1 追加（移动手感 / 副本可见 / 存档 / 剑灵）
- 手感外置 `godot/data/movement.json`：accelTime 0.07、decelTime 0.025、camFollow 30、摇杆 deadzone/radius/curve。`tests/movement.gd` 实测：斜/直速度比 1.000，松键 2 帧停（旧 1 帧瞬停，起步延迟 1 帧）。
- 副本：段末 20 秒预告横幅、段间横幅提示、紫色光柱 + 屏幕边箭头指向裂隙。
- 存档：自动（每段开场/进出副本/升级后）+ 暂停菜单「手动存档」；标题页「继续本局 / 清空存档 / 怎么玩·存档」。Web 存 localStorage 键 `denghai_yexing_save_v15`（同写 user://save.json）。`selftest.gd` 含存档往返断言。
- 副本守关者改为专属「剑灵」（御剑环身、回鞘突刺后露破绽、剑雨），新素材 `boss_swordwarden.png`；玩家飞剑可击落灵剑。血量系数 `dungeon.json → warden.eff` 重新标定（×0.875），真人代理进 1 次实测 n=120：胜率 51.7%，副本通关率 50.4%。
- **未完成/未验证**：完整自动化试玩与截图/录像（用户中途要求停止，`tools/e2e_full.mjs` 已写好但未跑通整链，桌面走位实测不可靠，因机器被其他进程占满）；进 0/2 次档与随机/瞄准机器人、3000 局满样本未重跑；性能、探索地图、遗物进化、彩虹葫芦、30 分钟时间轴等 design-v2 内容未做。

## 12. 朝左偏移修复（含怪物、剑灵）与按键卡住
- **根因**：Godot `draw_texture_rect*` 遇负宽度只翻转贴图、位置不动（覆盖 `[x, x+|w|]`）。旧代码写成 `Rect2(x0+w, …, -w)`，朝左时整张图多推一个身宽。同时绕帧中心镜像，身体不在帧中心的贴图还会再偏。
- **改法**：`src/anchors.gd`（`Anchors.rect`）按引擎语义放置，并绕“身体中轴”镜像；中轴比例由 `tools/gen_anchors.py` 写入 `godot/data/anchors.json`。主角、残影、所有怪物、精英、BOSS、剑灵都走这一个函数。
- **实测**（`godot --headless --path godot --script tests/facing_anchor.gd`，游戏像素；844×390 手机约 ×0.54）：朝左偏差 旧→新：主角 +71.1→0，纸扎人 +53.5→0，狐火 +46.9→0，破灯笼妖 +43.5→0，跳尸 +62.4→0，爆竹鬼 +47.3→0，跳尸王 +124.3→0，灯骸老祖 +155.8→0，剑灵 +105.6→0；朝右原有 ≤10px 的中轴偏差也归 0。
- **修复前对照图**：用户截图即为修复前（身体偏右约 70px）；修复后图在 `docs/verify/facing/`。未另导出旧版构建做同场景对拍。
- **按键卡住（截图后不能左转）**：截图/切窗口时浏览器收不到 keyup，D 被判为仍按住，与 A 抵消。`main.gd` 失焦时释放全部输入动作；`web/shell.html` 在 blur/切后台时补发 keyup。回归：`node tools/e2e_facing.mjs`（按住 D→模拟失焦→按 A，位移 −178 判通过）。
- 未做：边跑边转身/贴墙/进副本切场景的专项逐帧回归（只验证了站立与行走）；手机横屏为同一比例换算，没单独截图。
