extends Node
## 音频：音效来自 H5 版 ZzFX 参数离线渲染的 WAV（tools/make_sfx.mjs），BGM 为录制的程序化编曲。
## 浏览器要求首次用户输入后才能出声：标题页的开始操作就是这次输入。
## 零逐次闭包的池化播放器绑定 + 音乐切换防竞态 Tween + 连杀递增音高（SNKRX 手感）。

const SFX_DIR := "res://audio/sfx/"
const PENT := [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24]
const COMBO := {
	"levelup": {"gap": 0.2, "notes": [["_bell", 0.0, 0, 1.0], ["_bell", 0.07, 3, 0.9], ["_bell", 0.14, 7, 0.9], ["_bell", 0.21, 10, 0.95], ["_bell", 0.28, 12, 1.0]]},
	"chest": {"gap": 0.3, "notes": [["_bell", 0.0, -12, 0.8], ["_bell", 0.0, -5, 0.6], ["_bell", 0.06, 0, 0.8], ["_bell", 0.12, 5, 0.8], ["_bell", 0.18, 7, 0.8], ["_bell", 0.24, 12, 0.9], ["_bell", 0.3, 15, 0.8], ["_bell", 0.36, 19, 0.9], ["_bell", 0.42, 24, 0.7]]},
	"warn": {"gap": 0.25, "notes": [["_ting", 0.0, 0, 1.0], ["_ting", 0.13, 0, 0.9]]},
	"flare": {"gap": 0.25, "notes": [["_bell", 0.0, 0, 0.95], ["_bell", 0.04, 7, 0.95], ["_bell", 0.09, 12, 1.0], ["boom", 0.0, 0, 0.72]]},
	"perfect_dash": {"gap": 0.12, "notes": [["_ting", 0.0, 7, 0.9], ["_bell", 0.04, 12, 0.7], ["dash", 0.0, 2, 0.8]]},
}
const POOL_SIZE := 14

var meta: Dictionary = {}
var streams: Dictionary = {}
var pool: Array[AudioStreamPlayer] = []
var pool_names := PackedStringArray()
var voices: Dictionary = {}
var last_play: Dictionary = {}
var muted := false
var pickup_chain := 0
var pickup_last := 0.0
var music_players: Dictionary = {}
var music_tweens: Dictionary = {}
var music_cur := ""
var rng := RandomNumberGenerator.new()
var unlocked := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	rng.randomize()
	var f := FileAccess.open(SFX_DIR + "sfx.json", FileAccess.READ)
	if f != null:
		meta = JSON.parse_string(f.get_as_text())
	for name in meta:
		var arr: Array = []
		for v in range(2):
			var sp := SFX_DIR + "%s_%d.wav" % [name, v]
			if not ResourceLoader.exists(sp):
				continue
			var st: Variant = load(sp)
			if st != null:
				arr.append(st)
		streams[name] = arr
	pool_names.resize(POOL_SIZE)
	for i in range(POOL_SIZE):
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		add_child(p)
		pool.append(p)
		pool_names[i] = ""
		p.finished.connect(_on_pool_finished.bind(i))
	for m in ["title", "battle", "boss"]:
		var path := "res://audio/bgm_%s.mp3" % m
		if ResourceLoader.exists(path):
			var s: AudioStream = load(path)
			if s is AudioStreamMP3:
				s.loop = true
			var p := AudioStreamPlayer.new()
			p.stream = s
			p.volume_db = -80.0
			p.bus = "Master"
			add_child(p)
			music_players[m] = p
	var sv := SaveData.load_save()
	set_muted(bool(sv.get("mute", false)))


func _on_pool_finished(idx: int) -> void:
	var nm := pool_names[idx]
	if nm != "":
		voices[nm] = maxi(0, int(voices.get(nm, 1)) - 1)
		pool_names[idx] = ""


func set_muted(m: bool) -> void:
	muted = m
	AudioServer.set_bus_mute(0, m)


func play(name: String, vol: float = 1.0) -> void:
	if muted or (not meta.has(name) and not COMBO.has(name)):
		return
	var now := Time.get_ticks_msec() / 1000.0
	if COMBO.has(name):
		var c: Dictionary = COMBO[name]
		if now - float(last_play.get(name, -1.0)) < float(c.gap):
			return
		last_play[name] = now
		for n in c.notes:
			_delayed(String(n[0]), float(n[1]), pow(2.0, float(n[2]) / 12.0), vol * float(n[3]))
		return
	var def: Dictionary = meta[name]
	if now - float(last_play.get(name, -1.0)) < float(def.gap):
		return
	last_play[name] = now
	var rate := 1.0 + (rng.randf() * 2.0 - 1.0) * float(def.pj)
	var v := vol * (0.88 + rng.randf() * 0.12)
	if name == "pickup":
		pickup_chain = mini(pickup_chain + 1, PENT.size() - 1) if now - pickup_last < 0.45 else 0
		pickup_last = now
		rate = pow(2.0, float(PENT[pickup_chain]) / 12.0)
		v = vol
	_voice(name, v, rate)


## 连杀音高爬升（SNKRX 节奏反馈：streak 0..12 线性抬升音高）
func play_kill(streak: int = 0, vol: float = 0.8) -> void:
	if muted or not meta.has("kill"):
		return
	var now := Time.get_ticks_msec() / 1000.0
	var def: Dictionary = meta["kill"]
	if now - float(last_play.get("kill", -1.0)) < float(def.gap):
		return
	last_play["kill"] = now
	var base_rate := 1.0 + minf(float(maxi(0, streak)), 12.0) * 0.045
	var jitter := (rng.randf() * 2.0 - 1.0) * float(def.pj) * 0.5
	_voice("kill", vol * (0.9 + rng.randf() * 0.1), base_rate + jitter)


## 挑灯爆焰音效
func play_flare() -> void:
	play("flare", 1.0)


## 擦弹 / 完美闪避清脆钟铃提示
func play_perfect_dash() -> void:
	play("perfect_dash", 0.95)


func _delayed(name: String, delay: float, rate: float, vol: float) -> void:
	if delay <= 0.0:
		_voice(name, vol, rate)
	else:
		get_tree().create_timer(delay).timeout.connect(_voice.bind(name, vol, rate), CONNECT_ONE_SHOT)


func _voice(name: String, vol: float, rate: float) -> void:
	if not streams.has(name) or (streams[name] as Array).is_empty():
		return
	var def: Dictionary = meta[name]
	if int(voices.get(name, 0)) >= int(def.voices):
		return
	var slot := -1
	for i in range(POOL_SIZE):
		if not pool[i].playing:
			slot = i
			break
	if slot < 0:
		return
	var pl := pool[slot]
	if pool_names[slot] != "":
		voices[pool_names[slot]] = maxi(0, int(voices.get(pool_names[slot], 1)) - 1)
	var arr: Array = streams[name]
	pl.stream = arr[rng.randi() % arr.size()]
	pl.pitch_scale = rate
	pl.volume_db = linear_to_db(clampf(float(def.v) * vol * 0.8, 0.0001, 1.5))
	pool_names[slot] = name
	voices[name] = int(voices.get(name, 0)) + 1
	pl.play()


func music(name: String) -> void:
	if name == music_cur:
		return
	music_cur = name
	for k in music_players:
		var p: AudioStreamPlayer = music_players[k]
		var old_tw: Variant = music_tweens.get(k)
		if old_tw != null and is_instance_valid(old_tw):
			(old_tw as Tween).kill()
		var tw := create_tween()
		music_tweens[k] = tw
		if k == name:
			if not p.playing:
				p.play()
			tw.tween_property(p, "volume_db", -9.0, 1.2)
		else:
			tw.tween_property(p, "volume_db", -60.0, 1.2)
			tw.tween_callback(p.stop)
