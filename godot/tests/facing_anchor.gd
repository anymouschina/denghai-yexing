extends SceneTree
## 朝左/朝右时“身体中轴”相对站位中心(cx=碰撞体/脚底中心)的横向偏差，修复前(绕帧中心镜像) vs 修复后(绕身体中轴镜像)。单位：游戏像素；
## 竖屏幕折算：Godot canvas_items 以高 720 为基准，844×390 手机约 ×0.54 屏幕像素。断言：修复后两个朝向偏差都 ≤ 0.5px。
func _init() -> void:
	GameData.load_all()
	var rows := [  # key, 贴图宽高比(w/h), 画高
		["hero_run", 152.0 / 192.0, 192.0 * 0.44], ["enemy_paperman", 190.0 / 256.0, 66.0], ["enemy_foxfire", 219.0 / 256.0, 52.0],
		["enemy_lanternyokai", 159.0 / 256.0, 70.0], ["enemy_jiangshi", 189.0 / 256.0, 98.0], ["enemy_firecracker", 191.0 / 256.0, 62.0],
		["jiangshi_hop", 119.0 / 200.0, 98.0 * 1.65 * 1.35], ["boss_idle", 236.0 / 384.0, 250.0 * 1.05], ["boss_swordwarden", 238.0 / 384.0, 170.0]]
	var worst := 0.0
	for r in rows:
		var w: float = r[1] * r[2]
		var ax: float = float(GameData.ANCH[r[0]])
		var old_r := (ax - 0.5) * w          # 旧：朝右，轴相对中心
		# 旧：朝左 Rect2(-w/2+w, .., -w)：引擎实际覆盖 [+w/2, +w/2+w]，翻转后轴在 起点+(1-ax)*w
		var old_l := (w / 2.0) + (1.0 - ax) * w
		var nr := Anchors.rect(0.0, 0.0, w, 10.0, r[0], false)
		var nl := Anchors.rect(0.0, 0.0, w, 10.0, r[0], true)
		var new_r := nr.position.x + ax * w
		var new_l := nl.position.x + (1.0 - ax) * w   # 引擎语义：负宽只翻转，覆盖 [x, x+|w|]，轴在 x+(1-ax)w
		worst = maxf(worst, maxf(absf(new_r), absf(new_l)))
		print("AN %-20s 旧 右=%+.1f 左=%+.1f (朝左比朝右多偏 %.1f)  新 右=%+.2f 左=%+.2f" % [r[0], old_r, old_l, absf(old_l - old_r), new_r, new_l])
	print("worst new offset = %.3f px" % worst)
	quit(0 if worst <= 0.5 else 1)
