class_name PerfStat
extends RefCounted
## 分项耗时累加器（微秒）：压测时通过试玩桥 snapshot().perf 读出；正常游玩只做几次 get_ticks_usec，开销可忽略。
static var sum: Dictionary = {}
static var cnt: Dictionary = {}

static func add(k: String, t0: int) -> void:
	var d := Time.get_ticks_usec() - t0
	sum[k] = int(sum.get(k, 0)) + d
	cnt[k] = int(cnt.get(k, 0)) + 1

static func peek() -> Dictionary:
	var out := {}
	for k in sum:
		out[k] = [int(sum[k]), int(cnt[k])]
	return out


static func take() -> Dictionary:
	var out := {}
	for k in sum:
		out[k] = [int(sum[k]), int(cnt[k])]
	sum = {}
	cnt = {}
	return out


## 每 120 帧结算一次“每帧平均毫秒/每帧调用次数”，供试玩桥读取（窗口平均，不依赖外部差分）
static var frames := 0
static var avg: Dictionary = {}

static func frame_done() -> void:
	frames += 1
	if frames >= 120:
		var o := {}
		for k in sum:
			o[k] = [snappedf(float(sum[k]) / 1000.0 / frames, 0.001), snappedf(float(cnt[k]) / frames, 0.01)]
		avg = o
		sum = {}
		cnt = {}
		frames = 0
