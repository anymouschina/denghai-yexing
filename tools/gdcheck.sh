#!/bin/bash
# 解析检查：加载主场景若干帧，打印 SCRIPT ERROR / ERROR（含位置）
cd "$(dirname "$0")/../godot"
G=${GODOT:-/Users/libiqiang/TapCanvasAgent/.tools/godot/current/Godot.app/Contents/MacOS/Godot}
"$G" --headless --path . --quit-after ${1:-90} > /tmp/gdcheck.log 2>&1 &
pid=$!
( sleep 80; kill -9 $pid 2>/dev/null ) & w=$!
wait $pid 2>/dev/null; kill $w 2>/dev/null
grep -E -A1 "ERROR|Parse Error|WARNING: " /tmp/gdcheck.log | grep -v "^--" | head -${2:-40}
