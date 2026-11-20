class_name SafeArea
extends RefCounted
## 安全区（刘海 / 圆角 / 手势条）：Web 读 CSS env(safe-area-inset-*)，原生读 DisplayServer 的安全区。
## 返回的是「设计分辨率坐标」下的四边内缩（left, top, right, bottom）。

static func insets_px() -> Vector4:
	if OS.has_feature("web"):
		var js := """(function(){var d=document.getElementById('__sa');if(!d){d=document.createElement('div');d.id='__sa';
d.style.cssText='position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';document.body.appendChild(d);}
var c=getComputedStyle(d);return [parseFloat(c.paddingLeft)||0,parseFloat(c.paddingTop)||0,parseFloat(c.paddingRight)||0,parseFloat(c.paddingBottom)||0].join(',');})()"""
		var r := str(JavaScriptBridge.eval(js, true))
		var p := r.split(",")
		if p.size() == 4:
			return Vector4(float(p[0]), float(p[1]), float(p[2]), float(p[3]))
		return Vector4.ZERO
	var win := DisplayServer.window_get_size()
	var sa := DisplayServer.get_display_safe_area()
	if sa.size.x <= 0 or win.x <= 0:
		return Vector4.ZERO
	return Vector4(maxf(0, sa.position.x), maxf(0, sa.position.y), maxf(0, win.x - sa.end.x), maxf(0, win.y - sa.end.y))


## 换算到设计坐标（stretch 后的视口单位）
static func insets(vp: Viewport) -> Vector4:
	var px := insets_px()
	var win := DisplayServer.window_get_size()
	var vis := vp.get_visible_rect().size
	if win.x <= 0 or win.y <= 0:
		return Vector4.ZERO
	var sx := vis.x / float(win.x)
	var sy := vis.y / float(win.y)
	if OS.has_feature("web"):
		# CSS 像素 〉 画布像素（devicePixelRatio）〉 视口单位
		var dpr := float(JavaScriptBridge.eval("window.devicePixelRatio||1", true))
		return Vector4(px.x * dpr * sx, px.y * dpr * sy, px.z * dpr * sx, px.w * dpr * sy)
	return Vector4(px.x * sx, px.y * sy, px.z * sx, px.w * sy)
