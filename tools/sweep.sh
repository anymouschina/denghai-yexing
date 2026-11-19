#!/bin/bash
# 顺序跑一组调参实验（后台）：tools/sweep.sh <前缀> <bot> <tier> <n> "<名1>|<set1>" "<名2>|<set2>" ...
pre=$1; bot=$2; tier=$3; n=$4; shift 4
cd "$(dirname "$0")/.."
for item in "$@"; do
  name="${pre}_${item%%|*}"; set="${item#*|}"
  tools/exp.sh $name $bot $tier $n "$set"
done
