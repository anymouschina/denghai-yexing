#!/bin/bash
# 导出 Web（无线程）到 build/web：tools/export_web.sh
set -e
cd "$(dirname "$0")/.."
G=${GODOT:-/Users/libiqiang/TapCanvasAgent/.tools/godot/current/Godot.app/Contents/MacOS/Godot}
rm -rf build/web && mkdir -p build/web
(cd godot && "$G" --headless --path . --export-release "Web" ../build/web/index.html 2>&1 | tail -3)
# 压缩引擎 wasm（binaryen，需逐个开启模板用到的特性；失败则保留原文件），并同步 index.html 里的文件大小
if command -v wasm-opt >/dev/null; then
  wasm-opt -Oz --converge --strip-debug --strip-producers --merge-similar-functions --enable-exception-handling --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int --enable-mutable-globals --enable-simd --enable-multivalue --enable-reference-types -o build/web/index.wasm.opt build/web/index.wasm && mv build/web/index.wasm.opt build/web/index.wasm
  python3 - <<'PY'
import os, re
p = "build/web/index.html"; s = open(p).read()
n = os.path.getsize("build/web/index.wasm")
s = re.sub(r'("index\.wasm":)\s*\d+', lambda m: m.group(1) + str(n), s)
open(p, "w").write(s)
PY
fi
# 压缩引擎胶水 index.js（esbuild --minify，可选）
ES=$(command -v esbuild || ls ~/Library/pnpm/esbuild 2>/dev/null || true)
if [ -n "$ES" ]; then "$ES" --minify build/web/index.js --outfile=build/web/index.min.js --log-level=error && mv build/web/index.min.js build/web/index.js; fi
ls -la build/web
