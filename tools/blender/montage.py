"""Tile the PNGs in a folder into one contact sheet: python3 tools/blender/montage.py <folder> <out.png> [columns]."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

folder, out = Path(sys.argv[1]), sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 7
files = sorted(folder.glob('*.png'))
tiles = [Image.open(f).convert('RGB') for f in files]
w, h = tiles[0].size
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h), (40, 36, 52))
draw = ImageDraw.Draw(sheet)
for i, (f, t) in enumerate(zip(files, tiles)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(t, (x, y))
    draw.text((x + 8, y + 6), f.stem.split('_', 1)[1], fill=(255, 255, 255))
sheet.save(out)
print('sheet', out, sheet.size)
