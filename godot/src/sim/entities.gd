class_name SimEnemy
extends RefCounted
## 妖物实体（纯数据，渲染层按需读取）

var uid := 0
var type := ""
var def: Dictionary
var el: Dictionary
var alive := true
var boss := false
var elite := false
var warden := false
var x := 0.0
var y := 0.0
var hp := 1.0
var maxhp := 1.0
var speed := 60.0
var dmg := 5.0
var xpv := 1
var r := 18.0
var h := 66.0
var armor := 0.0
var kvx := 0.0
var kvy := 0.0
var ai := "chase"
var state := "move"
var timer := 0.0
var hop := 0.0
var shoot_t := 0.0
var slam_t := 0.0
var atk_t := 0.0
var atk_idx := 0
var ring_t := 0.0
var warn_t := 0.0
var burn_t := 0.0
var burn_tick := 0.0
var burn_dps := 0.0
var mark_t := 0.0
var mark_dmg := 0.0
var orb_hit := -10.0
var contact_cd := 0.0
var phase := 0.0
var flash := 0.0
var marks := 0       # 剑痕层数
var marks_t := 0.0   # 剑痕剩余时间
var face_right := true
var flip := false
var vx := 0.0        # 最近一帧速度（渲染用于朝向）
var vy := 0.0
var lift := 0.0
var squash := 1.0
var scale_mul := 1.0
# 守关者词缀
var swift := false
var quake := false
var ember := false
var ember_t := 0.0


func copy() -> SimEnemy:
	var c := SimEnemy.new()
	for pr in get_property_list():
		if pr.usage & PROPERTY_USAGE_SCRIPT_VARIABLE:
			c.set(pr.name, get(pr.name))
	return c
