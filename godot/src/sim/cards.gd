class_name Cards
extends RefCounted
## 卡面描述全部由 upgrades.json 的数值生成，保证“写的数字 = 实际效果”

static func num(v: float) -> String:
	var r := snappedf(v, 0.01)
	if absf(r - round(r)) < 0.0001:
		return str(int(round(r)))
	return str(r)


static func pct(v: float) -> String:
	return "%d%%" % int(round(v * 100.0))


static func fmt_v(v: float, unit: String) -> String:
	if unit == "pct":
		return pct(v)
	return num(v)


static func path_get(obj: Variant, key: String) -> Variant:
	var cur: Variant = obj
	for k in key.split("."):
		if cur is Dictionary and (cur as Dictionary).has(k):
			cur = cur[k]
		else:
			return null
	return cur


## "{key}" 原值，"{key%}" 百分比；key 可带点号读 balance.json（如 {burn.time}）
static func fill(tpl: String, src: Dictionary) -> String:
	var rx := RegEx.new()
	rx.compile("\\{([\\w.]+)(%?)\\}")
	var out := tpl
	for m in rx.search_all(tpl):
		var k := m.get_string(1)
		var p := m.get_string(2) == "%"
		var v: Variant = path_get(src, k)
		if v == null:
			v = path_get(GameData.BAL, k)
		var s := ""
		if v != null:
			s = pct(float(v)) if p else num(float(v))
		out = out.replace(m.get_string(), s)
	return out


static func describe(u: Dictionary, from: int, to: int) -> String:
	if u.type == "weapon":
		var s1: Dictionary = u.stats[to - 1]
		if from == 0:
			var parts: Array = []
			for k in u.labels:
				var lb: Array = u.labels[k]
				parts.append("%s %s%s" % [lb[0], num(float(s1[k])), lb[1]])
			var a: Array = parts.slice(0, 2)
			var b: Array = parts.slice(2)
			return "%s\n%s\n%s" % [u.intro, "，".join(a), "，".join(b)]
		var s0: Dictionary = u.stats[from - 1]
		var lines: Array = []
		for k in u.labels:
			if s0[k] != s1[k]:
				var lb2: Array = u.labels[k]
				lines.append("%s %s 〉 %s%s" % [lb2[0], num(float(s0[k])), num(float(s1[k])), lb2[1]])
		return "\n".join(lines)
	var lines2: Array = []
	for ln in u.lines:
		var k2: String = ln[0]
		var tpl: String = ln[1]
		var unit: String = ln[2]
		var av: float = float(u.per[k2]) * from
		var bv: float = float(u.per[k2]) * to
		var sign := ""
		if tpl.contains("+{v}"):
			sign = "+"
		elif tpl.contains("-{v}"):
			sign = "-"
		if from == 0:
			lines2.append(tpl.replace("{v}", fmt_v(bv, unit)))
		else:
			lines2.append(tpl.replace("{v}", "%s 〉 %s%s" % [fmt_v(av, unit), sign, fmt_v(bv, unit)]))
	if u.has("note"):
		lines2.append(fill(u.note, u))
	return "\n".join(lines2)
