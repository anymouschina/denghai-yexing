#!/usr/bin/env node
// Reusable 4x4 green-screen sprite sheet cutter:
// - Chroma-keys #00FF00 green background + edge despill (zero green halo, preserves teal/cyan/gold)
// - Computes union bounding box across all cells so frames never jitter
// - Outputs public/assets/guard/sheets/<key>.png + <key>.json and updates manifest.json
//
// Usage:
//   node scripts/cut-grid-sheet.mjs <inputPath> <key> [--texKey g_<key>] [--unitKey <unit>] [--cols 4] [--rows 4] [--size 220] [--outDir public/assets/guard/sheets]
//   node scripts/cut-grid-sheet.mjs --dir .tapcanvas/raw-sheets

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const DEFAULT_ANIMS = {
  idle:   { start: 0,  end: 3,  frameRate: 6,  repeat: -1 },
  walk:   { start: 4,  end: 7,  frameRate: 12, repeat: -1 },
  attack: { start: 8,  end: 11, frameRate: 14, repeat: 0 },
  cast:   { start: 12, end: 13, frameRate: 12, repeat: 0 },
  ult:    { start: 12, end: 13, frameRate: 12, repeat: 0 },
  hurt:   { start: 14, end: 14, frameRate: 12, repeat: 0 },
  dead:   { start: 15, end: 15, frameRate: 8,  repeat: 0 },
};

const UNIT_KEY_MAP = {
  azhu: { texKey: 'hero_run', unitKey: 'azhu' },
  hero_huoqing: { texKey: 'g_hero_huoqing', unitKey: 'huoqing' },
  hero_yunque: { texKey: 'g_hero_yunque', unitKey: 'yunque' },
  hero_xuanshuang: { texKey: 'g_hero_xuanshuang', unitKey: 'xuanshuang' },
  kongming: { texKey: 'g_kongming', unitKey: 'kongming' },
  boss_lvda: { texKey: 'g_boss_lvda', unitKey: 'lvda' },
  boss_xiangyu: { texKey: 'g_boss_xiangyu', unitKey: 'xiangyu' },
  boss_xingtian: { texKey: 'g_boss_xingtian', unitKey: 'xingtian' },
};

const PY_CUTTER = `
import sys, json
import numpy as np
from PIL import Image

inp, out_png, cols, rows, target_size, inset = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
im = Image.open(inp).convert("RGBA")
arr = np.array(im, dtype=np.float32)
r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

# 1. Green-screen chroma key (#00FF00):
#    greenness = g - max(r, b). Preserves cyan/teal (high b) and gold/yellow (high r).
max_rb = np.maximum(r, b)
greenness = g - max_rb

# Hard background mask: clearly green screen
bg_hard = (g > 95.0) & (greenness > 36.0)
# Soft fringe mask: anti-aliased / JPEG-ringing green halo near edges
soft_lo, soft_hi = 10.0, 36.0
alpha_factor = np.clip((soft_hi - greenness) / (soft_hi - soft_lo), 0.0, 1.0)
# Only attenuate alpha where g is dominant enough to be chroma spill, not dark charcoal ink
fringe = (~bg_hard) & (greenness > soft_lo) & (g > 65.0)

new_a = np.where(bg_hard, 0.0, np.where(fringe, a * alpha_factor, a))

# 2. Despill: clamp green channel on any pixel with green excess so zero green halo remains
spill = (new_a > 0) & (greenness > 6.0) & (g > 55.0)
new_g = np.where(spill, np.minimum(g, max_rb + 4.0), g)

# Clean isolated 1px green specks on fully transparent boundary
rgba = np.stack([r, new_g, b, new_a], axis=-1)
rgba = np.clip(rgba, 0, 255).astype(np.uint8)
# Zero RGB on fully transparent pixels for better PNG compression & zero bilinear bleed
zero_mask = rgba[..., 3] < 8
rgba[zero_mask] = 0

H, W = rgba.shape[:2]
cell_w = W // cols
cell_h = H // rows

def get_cell(r_idx, c_idx):
    raw = rgba[r_idx*cell_h:(r_idx+1)*cell_h, c_idx*cell_w:(c_idx+1)*cell_w].copy()
    if inset > 0:
        raw[:inset, :] = 0
        raw[-inset:, :] = 0
        raw[:, :inset] = 0
        raw[:, -inset:] = 0
    return raw

# 3. Compute union bounding box across all cells (relative to each cell) so frames never jitter
min_x, min_y = cell_w, cell_h
max_x, max_y = 0, 0
for row in range(rows):
    for col in range(cols):
        cell = get_cell(row, col)
        ys, xs = np.where(cell[..., 3] > 20)
        if xs.size == 0:
            continue
        min_x = min(min_x, int(xs.min()))
        min_y = min(min_y, int(ys.min()))
        max_x = max(max_x, int(xs.max()))
        max_y = max(max_y, int(ys.max()))

pad = 6
min_x = max(0, min_x - pad)
min_y = max(0, min_y - pad)
max_x = min(cell_w - 1, max_x + pad)
max_y = min(cell_h - 1, max_y + pad)

crop_w = max(1, max_x - min_x + 1)
crop_h = max(1, max_y - min_y + 1)
# Square frame preserving aspect ratio with bottom-center anchor
scale = min(target_size / crop_w, target_size / crop_h)
dst_w = max(1, int(round(crop_w * scale)))
dst_h = max(1, int(round(crop_h * scale)))
off_x = (target_size - dst_w) // 2
off_y = target_size - dst_h

out = Image.new("RGBA", (target_size * cols, target_size * rows), (0, 0, 0, 0))
for row in range(rows):
    for col in range(cols):
        cell = get_cell(row, col)
        cropped = Image.fromarray(cell[min_y:max_y+1, min_x:max_x+1], "RGBA")
        resized = cropped.resize((dst_w, dst_h), Image.Resampling.LANCZOS)
        out.paste(resized, (col * target_size + off_x, row * target_size + off_y))

out.save(out_png, "PNG", optimize=True)
print(json.dumps({
    "src": [W, H],
    "unionCrop": [min_x, min_y, crop_w, crop_h],
    "frameWidth": target_size,
    "frameHeight": target_size,
    "cols": cols,
    "rows": rows,
    "frames": cols * rows
}))
`;

function cutOne({ inputPath, key, texKey, unitKey, cols = 4, rows = 4, size = 220, inset = 4, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const outPng = join(outDir, `${key}.png`);
  const outJson = join(outDir, `${key}.json`);
  const raw = execFileSync('python3', ['-c', PY_CUTTER, inputPath, outPng, String(cols), String(rows), String(size), String(inset)], {
    encoding: 'utf8',
  }).trim();
  const info = JSON.parse(raw);

  const mapped = UNIT_KEY_MAP[key] || {};
  const finalTexKey = texKey || mapped.texKey || `g_${key}`;
  const finalUnitKey = unitKey || mapped.unitKey || key.replace(/^(hero|beast|boss|merc)_/, '');

  const meta = {
    key,
    texKey: finalTexKey,
    unitKey: finalUnitKey,
    image: `${key}.png`,
    frameWidth: info.frameWidth,
    frameHeight: info.frameHeight,
    cols: info.cols,
    rows: info.rows,
    frames: info.frames,
    anims: DEFAULT_ANIMS,
  };
  writeFileSync(outJson, `${JSON.stringify(meta, null, 2)}\n`);

  // Update manifest.json
  const manifestPath = join(outDir, 'manifest.json');
  let manifest = { sheets: {} };
  if (existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { manifest = { sheets: {} }; }
  }
  manifest.sheets ||= {};
  manifest.sheets[key] = {
    texKey: finalTexKey,
    unitKey: finalUnitKey,
    frameWidth: info.frameWidth,
    frameHeight: info.frameHeight,
    frames: info.frames,
    anims: DEFAULT_ANIMS,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`cut ${key}: ${inputPath} -> ${outPng} (${info.frameWidth}x${info.frameHeight} x${info.frames}, crop=${info.unionCrop.join(',')})`);
}

const args = process.argv.slice(2);
const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const outDir = resolve(opt('--outDir', 'public/assets/guard/sheets'));
const cols = Number(opt('--cols', '4'));
const rows = Number(opt('--rows', '4'));
const size = Number(opt('--size', '220'));
const inset = Number(opt('--inset', '4'));
const dir = opt('--dir', null);

if (dir) {
  const absDir = resolve(dir);
  const files = readdirSync(absDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  if (!files.length) {
    console.error(`No images found in ${absDir}`);
    process.exit(1);
  }
  for (const f of files) {
    const key = basename(f, extname(f));
    cutOne({ inputPath: join(absDir, f), key, cols, rows, size, inset, outDir });
  }
} else {
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { i++; continue; }
    positional.push(args[i]);
  }
  if (positional.length < 2) {
    console.error('Usage: node scripts/cut-grid-sheet.mjs <inputPath> <key> [--texKey ...] [--unitKey ...] [--cols 4] [--rows 4] [--size 220] [--inset 4] [--outDir ...]');
    console.error('   or: node scripts/cut-grid-sheet.mjs --dir <folder>');
    process.exit(1);
  }
  cutOne({
    inputPath: resolve(positional[0]),
    key: positional[1],
    texKey: opt('--texKey', null),
    unitKey: opt('--unitKey', null),
    cols,
    rows,
    size,
    inset,
    outDir,
  });
}
