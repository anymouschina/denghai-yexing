#!/bin/bash
# 把 H5 版的程序化 BGM（Web Audio 现场编曲）在无头 Chrome 里录下来，做成可无缝循环的 ogg（Godot 用）。
# 不改动 H5 源码：在临时目录拷一份 audio.js，附加一行暴露接口后单独构建。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=${TMPDIR_BGM:-/private/tmp/claude-501/bgm_build}
rm -rf "$TMP"; mkdir -p "$TMP/src" "$TMP/out"
cp "$ROOT/src/audio.js" "$TMP/src/audio.js"
echo 'window.__A = { ctx, master, music, unlockAudio, setMuted };' >> "$TMP/src/audio.js"
cp "$ROOT/package.json" "$TMP/"; ln -s "$ROOT/node_modules" "$TMP/node_modules"
cat > "$TMP/bgm.html" <<'H'
<!doctype html><meta charset=utf-8><script type="module" src="./src/audio.js"></script>
H
cat > "$TMP/vite.config.js" <<'V'
import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { outDir: 'out', rollupOptions: { input: 'bgm.html' } } });
V
(cd "$TMP" && "$ROOT/node_modules/.bin/vite" build >/dev/null 2>&1)
node "$ROOT/tools/record_bgm.mjs" "$TMP/out" "$ROOT/godot/audio"
