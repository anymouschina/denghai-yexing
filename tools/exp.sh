#!/bin/bash
# 后台调参实验：tools/exp.sh <名字> <bot> <tier> <n> "<set>"  → 输出 /private/tmp/claude-501/tune/<名字>.json（摘要）
name=$1; bot=$2; tier=$3; n=$4; set=$5
cd "$(dirname "$0")/.."
python3 tools/run_balance.py --bot $bot --tier $tier --n $n --set "$set" > /private/tmp/claude-501/tune/$name.json 2>/private/tmp/claude-501/tune/$name.err
