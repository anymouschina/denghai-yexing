class_name SimPickup
extends RefCounted

const PK_SOUL := 0
const PK_COIN := 1
const PK_OIL := 2
const PK_CHEST := 3

var kind := "soul"
var kind_id := PK_SOUL
var x := 0.0
var y := 0.0
var val := 1
var mag := false
var spd := 0.0
var bob := 0.0
var born := 0.0
var cell := -1


static func kind_to_id(k: String) -> int:
	match k:
		"soul":
			return PK_SOUL
		"coin":
			return PK_COIN
		"oil":
			return PK_OIL
		"chest":
			return PK_CHEST
	return PK_SOUL
