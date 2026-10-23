"""
Turn a generated painted texture into game-ready maps (R24): seamless, sized to the scenery budget, with a normal map
and a roughness map derived from the paint.

    uv run --with numpy --with pillow python tools/textures/process.py <in.png> <out_prefix> [--size 1024] [--strength 3]

Writes <out_prefix>_albedo.webp, <out_prefix>_normal.webp and <out_prefix>_rough.webp. Generated art is only roughly
seamless, so the edges are cross-faded with the opposite side over a narrow band before anything else.
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

args = sys.argv[1:]
src, prefix = args[0], args[1]
size = int(args[args.index('--size') + 1]) if '--size' in args else 1024
strength = float(args[args.index('--strength') + 1]) if '--strength' in args else 3.0

img = np.asarray(Image.open(src).convert('RGB').resize((size, size), Image.LANCZOS), dtype=np.float32) / 255.0


def make_seamless(a: np.ndarray, band: int) -> np.ndarray:
    """Cross-fade each edge band toward the pixels just past the opposite edge, so the tile wraps without a seam."""
    out = a.copy()
    n = a.shape[0]
    for k in range(band):
        w = 0.5 * (1 - k / band)  # 0.5 at the very edge, fading to 0 inside
        out[k] = a[k] * (1 - w) + a[n - 1 - k] * w
        out[n - 1 - k] = a[n - 1 - k] * (1 - w) + a[k] * w
    a = out
    out = a.copy()
    for k in range(band):
        w = 0.5 * (1 - k / band)
        out[:, k] = a[:, k] * (1 - w) + a[:, n - 1 - k] * w
        out[:, n - 1 - k] = a[:, n - 1 - k] * (1 - w) + a[:, k] * w
    return out


img = make_seamless(img, max(4, size // 48))
Image.fromarray((img * 255).clip(0, 255).astype(np.uint8)).save(f'{prefix}_albedo.webp', quality=88)

# height from luminance, softened; dark joints and pits read as low
lum = (img[..., 0] * 0.3 + img[..., 1] * 0.59 + img[..., 2] * 0.11)
height = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32) / 255.0
dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
nz = np.ones_like(dx)
length = np.sqrt(dx * dx + dy * dy + nz * nz)
normal = np.stack([(-dx / length) * 0.5 + 0.5, (dy / length) * 0.5 + 0.5, (nz / length) * 0.5 + 0.5], axis=-1)
Image.fromarray((normal * 255).astype(np.uint8)).save(f'{prefix}_normal.webp', quality=92)

# rough everywhere, rougher in the joints and pits, a touch glossier on worn high spots
rough = np.clip(0.95 - (height - height.mean()) * 0.9, 0.55, 1.0)
Image.fromarray((rough * 255).astype(np.uint8)).save(f'{prefix}_rough.webp', quality=90)
print('wrote', prefix, size)
