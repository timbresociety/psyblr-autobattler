"""
Face landmarks for the likeness pipeline: MediaPipe's 478-point face mesh on a portrait (or on a render of the MPFB
head), written as JSON pixel coordinates [[x, y, z], ...] plus the image size. The legacy face-mesh solution ships its
model inside the wheel, so nothing else is downloaded.

    uv run --python 3.12 --with mediapipe==0.10.14 --with numpy --with pillow python tools/textures/landmarks.py in.png out.json [--overlay out.png]

With `--portrait out.webp`, the image is first squared to 768 px and saved as the portrait the character pipeline reads
(tools/blender/portraits/<hero>.webp), and the landmarks are measured on that.
"""

import json
import sys

import numpy as np
from PIL import Image, ImageDraw

import mediapipe as mp

args = sys.argv[1:]
src, out = args[0], args[1]
img = Image.open(src).convert('RGB')
if '--portrait' in args:
    side = min(img.size)
    img = img.crop(((img.width - side) // 2, (img.height - side) // 2, (img.width + side) // 2, (img.height + side) // 2)).resize((768, 768), Image.LANCZOS)
    img.save(args[args.index('--portrait') + 1], quality=90)
with mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.2) as fm:
    res = fm.process(np.asarray(img))
if not res.multi_face_landmarks:
    print('no face found in', src)
    sys.exit(1)
pts = [[p.x * img.width, p.y * img.height, p.z * img.width] for p in res.multi_face_landmarks[0].landmark]
json.dump({'width': img.width, 'height': img.height, 'points': pts}, open(out, 'w'))
if '--overlay' in args:
    d = ImageDraw.Draw(img)
    for x, y, _ in pts:
        d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(0, 255, 0))
    img.save(args[args.index('--overlay') + 1])
print('landmarks', len(pts), out)
