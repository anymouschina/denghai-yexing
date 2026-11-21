class_name SimBullet
extends RefCounted
## 己方符箓 / 敌方鬼火弹

var x := 0.0
var y := 0.0
var vx := 0.0
var vy := 0.0
var life := 1.0
var dmg := 10.0
var pierce := 1
var hits: Dictionary = {}
var mark := false
var ang := 0.0
var frost := false
var slow_dur := 0.0
var wound_dur := 0.0
