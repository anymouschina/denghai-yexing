#!/bin/bash
# 导出 Web（无线程）到 build/web：tools/export_web.sh
set -e
cd "$(dirname "$0")/.."
G=${GODOT:-/Users/libiqiang/TapCanvasAgent/.tools/godot/current/Godot.app/Contents/MacOS/Godot}
rm -rf build/web && mkdir -p build/web
(cd godot && "$G" --headless --path . --export-release "Web" ../build/web/index.html 2>&1 | tail -3)
ls -la build/web
