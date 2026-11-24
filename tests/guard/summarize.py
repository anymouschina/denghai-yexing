# 平衡结果摘要：python3 tests/guard/summarize.py < out.json
import json, sys
d = json.load(sys.stdin)
print('secs', d['secs'], 'N', d['N'])
for bot, rows in d['summary'].items():
    for h, r in rows.items():
        keys = [k for k in ['winPct', 'medWave', 'medSec', 'medBossHpLeft', 'reasons', 'medLv', 'beasts', 'quests', 'kmEquipPct', 'setPct'] if k in r]
        print(bot, h, {k: r[k] for k in keys}, r.get('deathCauses', ''), r.get('bossSec', ''), r.get('loseWaves', ''))
print(d['dmgShare'])
