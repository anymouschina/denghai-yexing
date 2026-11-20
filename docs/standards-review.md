# 标准库自检（game-delivery / game-design），对照实测

| 条目 | 状态 | 证据 |
|---|---|---|
| 浏览器可直接打开、相对路径 | 通过 | build/web/index.html；预跑 playtest 无报错 |
| 标题→游玩→成长→结算→重来；Esc 暂停 | 通过 | 预跑：标题、开局、升级、暂停、继续；结算/重来见 docs/verify 旧截图 |
| 生成素材原样入包 | 通过 | godot/assets 全部由 asset 生成或复用上游；含新增剑灵 boss_swordwarden.png |
| 试玩桥 + seed | 通过 | godot/src/playtest.gd，scene 名 title/play/levelup/paused/result |
| 规则 headless 实测 | 通过 | tests/selftest.gd 75 项全过；tests/movement.gd |
| 平衡不作弊 | 部分 | balance.gd 无倍率/改血量/回血；样本仅 60–240 局，未满 3000，飞剑 BOSS 时长降幅约 22%（<25%） |
| 数值外置 | 通过 | godot/data/*.json（含 movement.json） |
| 存档 | 通过 | localStorage denghai_yexing_save_v15 + user://save.json |
| 触屏/安全区/横屏 | 通过（未真机） | 手机 844×390 / 900×414 CDP 触摸验证，docs/verify |
| 构建体积 ≤40MB | **未达标** | 52MB，index.wasm 39.5MB 为官方模板，需自编译精简模板 |
| 音乐 | 变通 | 账号无音乐模型，用 H5 程序化编曲录制 mp3 |
| 设计文档 docs/design.md | 通过 | v1.5 规格；design-v2（探索/遗物进化/葫芦）未写 |
