class_name SimEnemy
extends RefCounted
## 妖物实体（纯数据，渲染层按需读取）

const AI_CHASE := 0
const AI_HOP := 1
const AI_RANGED := 2
const AI_BOMBER := 3
const AI_SWORDWARDEN := 4
const AI_SWORDLORD := 5
const AI_SEDAN := 6
const AI_LAMPS := 7
const AI_BOSS := 8

const ST_MOVE := 0
const ST_CHARGE := 1
const ST_FUSE := 2
const ST_LUNGE := 3
const ST_AIM := 4

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
var dmg_mul := 1.0
var xpv := 1
var r := 18.0
var h := 66.0
var armor := 0.0
var knock := 1.0
var hop_period := 1.0
var keep_dist := 0.0
var trigger_dist := 0.0
var fuse_dur := 0.0
var blast_r := 0.0
var kvx := 0.0
var kvy := 0.0
var ai := "chase"
var ai_id := AI_CHASE
var state := "move"
var state_id := ST_MOVE
var grid_idx := 0
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
var orb_hits := PackedFloat32Array([-10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0])
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
var stagger_t := 0.0
var blades_t := 0.0
var blade_ang := 0.0
var blade_down: Array = [0.0, 0.0, 0.0]
var blade_hit_cd := 0.0
var lunge_dir := Vector2.RIGHT
var lunge_hit := false
var swift := false
var quake := false
var ember := false
var ember_t := 0.0
# 异常体系（data/ailments.json）：层数与各自剩余时间；ail_mul 是“受到伤害倍率”的缓存，只在层数变化时重算（Mindustry StatusComp 的做法）
var burn_n := 0
var shock_n := 0
var shock_t := 0.0
var seal_n := 0
var seal_t := 0.0
var bind_t := 0.0
var ail_mul := 1.0
var ail_kinds := 0
var collapse_cd := 0.0


static func ai_to_id(s: String) -> int:
	match s:
		"chase":
			return AI_CHASE
		"hop":
			return AI_HOP
		"ranged":
			return AI_RANGED
		"bomber":
			return AI_BOMBER
		"swordwarden":
			return AI_SWORDWARDEN
		"swordlord":
			return AI_SWORDLORD
		"sedan":
			return AI_SEDAN
		"lamps":
			return AI_LAMPS
		"boss":
			return AI_BOSS
	return AI_CHASE


func set_ai(s: String) -> void:
	ai = s
	ai_id = ai_to_id(s)


func set_state(s: String, sid: int) -> void:
	state = s
	state_id = sid


func copy() -> SimEnemy:
	var c := SimEnemy.new()
	for pr in get_property_list():
		if pr.usage & PROPERTY_USAGE_SCRIPT_VARIABLE:
			var v: Variant = get(pr.name)
			if v is PackedFloat32Array or v is Array:
				v = v.duplicate()
			c.set(pr.name, v)
	return c
