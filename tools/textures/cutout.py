"""
Turn a generated foliage painting on a flat white background into a leaf-card texture (R25): the white keyed out to
alpha with a soft, slightly choked edge, the spray cropped to its bounds and squared, then sized for the scenery
budget. Colour bleeds outward under the transparent pixels so mipmaps never fringe white.

    uv run --with numpy --with pillow python tools/textures/cutout.py <in.png> <out.webp> [--size 512]
"""

import sys

import numpy as np
from PIL import Image, ImageFilter

args = sys.argv[1:]
src, out = args[0], args[1]
size = int(args[args.index('--size') + 1]) if '--size' in args else 512

img = np.asarray(Image.open(src).convert('RGB'), dtype=np.float32) / 255.0
# distance from white, in a way that keeps pale, sunlit leaves: low saturation and high value is background
mx = img.max(axis=2)
mn = img.min(axis=2)
sat = (mx - mn) / np.maximum(mx, 1e-3)
whiteness = np.clip((mn - 0.82) / 0.13, 0, 1) * np.clip(1 - sat * 4, 0, 1)
alpha = 1 - whiteness
a_img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
alpha = np.asarray(a_img, dtype=np.float32) / 255.0

# crop to the spray and square it, keeping the bottom (where a card's stem meets the tree) at the bottom
ys, xs = np.where(alpha > 0.5)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
side = max(y1 - y0, x1 - x0)
cx = (x0 + x1) // 2
canvas_rgb = np.zeros((side, side, 3), dtype=np.float32)
canvas_a = np.zeros((side, side), dtype=np.float32)
sx0 = max(0, cx - side // 2)
crop_rgb = img[y0:y1, sx0 : sx0 + side]
crop_a = alpha[y0:y1, sx0 : sx0 + side]
h, w = crop_a.shape
oy, ox = side - h, (side - w) // 2
canvas_rgb[oy : oy + h, ox : ox + w] = crop_rgb
canvas_a[oy : oy + h, ox : ox + w] = crop_a

# bleed colour into the transparent area: unknown pixels take the blurred colour of the known ones around them
def gblur(a, r):
    """Three passes of a separable box blur (close to a gaussian of radius r)."""
    out = a.astype(np.float32)
    r = max(1, int(r))
    for _ in range(3):
        for axis in (0, 1):
            pad = [(r + 1, r) if k == axis else (0, 0) for k in range(2)]
            c = np.cumsum(np.pad(out, pad, mode='edge'), axis=axis)
            hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
            out = (hi - lo) / (2 * r + 1)
    return out


col = canvas_rgb.copy()
known = (canvas_a > 0.5).astype(np.float32)
for radius in (2, 4, 8, 16, 32, 64):
    k = gblur(known, radius)
    fill = (known < 0.5) & (k > 0.01)
    for c in range(3):
        blurred = gblur(col[..., c] * known, radius) / np.maximum(k, 1e-6)
        col[..., c] = np.where(fill, blurred, col[..., c])
    known = np.maximum(known, fill.astype(np.float32))
final_rgb = col
rgba = np.concatenate([np.clip(final_rgb, 0, 1), canvas_a[..., None]], axis=2)
Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA').resize((size, size), Image.LANCZOS).save(out, quality=90)
print('wrote', out, size)
