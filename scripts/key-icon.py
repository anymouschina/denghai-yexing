# 绿幕图标抠图：估背景色 → 按色距抠透明 + 边缘去绿溢色 → 裁到主体 → 等比缩放居中到 size×size 透明画布。
# 用法：python3 scripts/key-icon.py <src> <out> [size=160]
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 160
im = Image.open(src).convert('RGBA')
w, h = im.size
px = im.load()
corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
kr = sum(c[0] for c in corners) // 4
kg = sum(c[1] for c in corners) // 4
kb = sum(c[2] for c in corners) // 4
if kg < 150 or kr > 120 or kb > 120:
    raise SystemExit(f'背景不是绿幕（角点均色 {kr},{kg},{kb}），请重新生成')
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        d = ((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2) ** 0.5
        if d < 90:
            px[x, y] = (r, g, b, 0)
        elif d < 160:
            k = (d - 90) / 70
            g2 = min(g, max(r, b) + 10)  # 去绿溢色
            px[x, y] = (r, g2, b, int(255 * k))
        elif g > max(r, b) + 30:
            px[x, y] = (r, max(r, b) + 10, b, a)
bbox = im.getbbox()
if not bbox:
    raise SystemExit('抠图后为空')
im = im.crop(bbox)
pad = int(size * 0.06)
s = (size - 2 * pad) / max(im.size)
im = im.resize((max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s))), Image.LANCZOS)
canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
canvas.paste(im, ((size - im.size[0]) // 2, (size - im.size[1]) // 2), im)
canvas.save(out)
transparent = sum(1 for p in canvas.getdata() if p[3] == 0) / (size * size)
print(f'saved {out} {size}x{size} transparent={transparent:.2f} key=({kr},{kg},{kb})')
