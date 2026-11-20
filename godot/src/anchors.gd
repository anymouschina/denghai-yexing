class_name Anchors
extends RefCounted
## 以“身体中轴”(data/anchors.json，tools/gen_anchors.py 生成) 为锚点放置/镜像贴图：
## 朝左朝右时中轴都落在 cx（= 碰撞体/脚底中心）上。旧做法绕帧中心镜像，身体不在帧中心时朝左会整体错位 2×(轴−0.5)×宽。
##
## 重要（根因）：Godot 的 draw_texture_rect* 遇到负宽度只是“打翻转标志并取绝对值”，**不会**把矩形向左挪：
## 实际覆盖 [position.x, position.x+|w|]。旧代码按“负宽 = 以 position 为右边缘”写成 Rect2(x0+w, …, -w)，
## 朝左时整张图被多推了一个身宽（hero ≈ 67px，与截图一致）。这里按引擎真实语义放置。
static func rect(cx: float, top: float, w: float, h: float, key: String, flip: bool) -> Rect2:
	var ax: float = float(GameData.ANCH.get(key, 0.5))
	if flip:
		# 覆盖 [cx-(1-ax)w, cx+ax·w]，翻转后身体中轴落在 cx
		return Rect2(cx - (1.0 - ax) * w, top, -w, h)
	return Rect2(cx - ax * w, top, w, h)
