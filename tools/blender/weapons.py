"""
The lab's weapons: meshes generated from our own prompts (scripts in the session 2 notes), shrunk to a few thousand
triangles with 1K webp textures, then turned and scaled here into the piece convention tools/blender/pieces.py models
in: the socket's point at the origin, up +z, the hero's front -y. A blade's length runs along +z (the thumb) with its
edge toward -y (the fingertips); a gun's barrel runs toward -y with its grip down through the fist; a shield faces +x.

    Blender -b --python tools/blender/weapons.py -- --src DIR [--look sheet.png] [--only katana,bow]

DIR holds one folder per weapon with its shrunk mesh as small.glb. --look renders every mesh in its own principal
frame (longest axis up, the next across) with tenths marked up the left and red at the top, green to the right, so a
weapon's grip, tip and edge can be read off before WEAPONS below says how it sits. Without --look each is written to
public/kit/weapons/<id>.glb with a thumbnail beside it, and src/kit/weapons.gen.ts lists them.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'public', 'kit', 'weapons')
MANIFEST = os.path.join(ROOT, 'src', 'kit', 'weapons.gen.ts')
V = Vector
sys.path.insert(0, HERE)
import pieces  # noqa: E402  (its render set-up and thumbnail views)

# How each sits, read off the --look sheet in its principal frame (length up +z, across +x, thinnest +y, standing on
# z = 0, length 1). `up` is the principal axis that becomes the piece's +z (a blade's point, a gun's top), `front` the
# one that becomes -y (the edge, the muzzle, the face that turns toward a foe); both may be vectors when the weapon lies
# askew. `grip` is where the fist closes: a height up the length (the band's own middle across), or an (x, z) point.
# `length` is the principal length in metres. A back piece is carried (carry.ts): its +z runs to the end a hand
# reaches for and -y faces away from the body, with its back flush on the socket.
WEAPONS = {
    'arming-sword': dict(name='Arming sword', kind='hand', length=0.9, up='+z', front='+x', grip=0.11),
    'greatsword': dict(name='Greatsword', kind='hand', length=1.5, up='+z', front='+x', grip=0.17),
    'katana': dict(name='Katana', kind='hand', length=1.0, up='+z', front='+x', grip=0.15),
    'twin-short-sword': dict(name='Short sword', kind='hand', length=0.6, up='+z', front='+x', grip=0.14),
    'kunai': dict(name='Kunai', kind='hand', length=0.25, up='+z', front='+x', grip=0.18),
    'scythe': dict(name='War scythe', kind='hand', length=1.7, up='-z', front='+x', grip=0.74),
    'warhammer': dict(name='Warhammer', kind='hand', length=1.2, up='-z', front='+x', grip=0.8),
    'spear': dict(name='Spear', kind='hand', length=2.0, up='-z', front='+x', grip=0.7),
    'bo-staff': dict(name='Bo staff', kind='hand', length=1.8, up='+z', front='+x', grip=0.43, crop=0.235),
    'whip': dict(name='Bullwhip', kind='hand', length=1.0, up='+z', front='+x', grip=0.88),
    'wand': dict(name='Wand', kind='hand', length=0.35, up='-z', front='+x', grip=0.88),
    'mage-staff': dict(name='Mage staff', kind='hand', length=1.8, up='-z', front='+x', grip=0.58),
    'pistol': dict(name='Pistol', kind='hand', length=0.245, up=(0.887, 0, 0.463), front=(-0.463, 0, 0.887), grip=(-0.09, 0.266)),
    'assault-rifle': dict(name='Assault rifle', kind='hand', length=0.9, up='-x', front='-z', grip=(0.045, 0.59)),
    'rocket-launcher': dict(name='Rocket launcher', kind='hand', length=1.1, up='-x', front='+z', grip=(0.084, 0.275)),
    'round-shield': dict(name='Round shield', kind='offhand', length=0.7, up='+z', front='+x', shield=True),
    'recurve-bow': dict(name='Recurve bow', kind='offhand', length=1.5, up='+z', front='+x', grip=(-0.06, 0.37), keep_small=True),
    'quiver': dict(name='Quiver', kind='back', length=0.7, up='-z', front='+y', grip=0.5),
}
AXES = {'+x': (1, 0, 0), '-x': (-1, 0, 0), '+y': (0, 1, 0), '-y': (0, -1, 0), '+z': (0, 0, 1), '-z': (0, 0, -1)}
# a shield's disc sits this far out from the palm, along +x (as tools/blender/pieces.py's own)
SHIELD_OUT = 0.05
# `crop` cuts away everything below that height in the principal frame (a stand it was stood on), then frames it again
# loose parts with less than this share of the surface are generation litter (stray strands, floating flecks)
LITTER = 0.004


def log(*a):
    print('[weapons]', *a, flush=True)


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {}
    i = 0
    while i < len(argv):
        key = argv[i].lstrip('-')
        if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
            opts[key] = argv[i + 1]
            i += 2
        else:
            opts[key] = True
            i += 1
    return opts


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)


def load(path):
    """The mesh at path as one object with its transforms applied."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.context.scene.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def tidy(obj, keep_small=False, longest=False):
    """
    Drops loose parts too small to be part of the weapon (and, `longest`, every part but the one reaching furthest: a
    stand the generator stood it on); returns how many went.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # the file splits its vertices at every texture seam; joined again (Blender keeps UVs per corner) each part is whole
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    seen = set()
    parts = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, part = [v], []
        seen.add(v.index)
        while stack:
            u = stack.pop()
            part.append(u)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        faces = {f for u in part for f in u.link_faces}
        reach = np.ptp(np.array([u.co for u in part]), axis=0).max()
        parts.append((sum(f.calc_area() for f in faces), part, reach))
    total = sum(a for a, _, _ in parts) or 1
    far = max(r for _, _, r in parts)
    gone = [p for a, p, r in parts if a / total < (LITTER / 20 if keep_small else LITTER) or (longest and r < far)]
    bmesh.ops.delete(bm, geom=[u for p in gone for u in p], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    return len(gone)


def principal(obj):
    """
    The rotation taking obj into its principal frame (longest axis to +z, the next to +x, the thinnest to +y), with the
    mesh then standing on z = 0, centred on x and y, and scaled to length 1. Returns the matrix and the length.
    """
    me = obj.data
    pts = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', pts)
    pts = pts.reshape(-1, 3)
    centre = pts.mean(axis=0)
    w, vecs = np.linalg.eigh(np.cov((pts - centre).T))
    order = np.argsort(w)[::-1]
    l, m, n = (vecs[:, i] for i in order)
    # each axis toward the side its far reaches lean (the third moment), so the frame comes out the same every run
    l, m = (a if (((pts - centre) @ a) ** 3).sum() >= 0 else -a for a in (l, m))
    if np.linalg.det(np.stack([m, n, l])) < 0:
        n = -n
    rot = Matrix([list(m), list(n), list(l)]).to_4x4()
    q = (pts - centre) @ np.stack([m, n, l]).T
    lo, hi = q.min(axis=0), q.max(axis=0)
    length = float(hi[2] - lo[2])
    shift = Matrix.Translation(V((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])))
    return Matrix.Scale(1 / length, 4) @ shift @ rot @ Matrix.Translation(V(-centre)), length


def framed(obj, spec):
    """obj in its principal frame, cut at its `crop` and framed again when it has one."""
    frame, length = principal(obj)
    obj.data.transform(frame)
    if spec.get('crop'):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < spec['crop']], context='VERTS')
        bm.to_mesh(obj.data)
        bm.free()
        frame, cut = principal(obj)
        obj.data.transform(frame)
        length *= cut
    return length


def profile(obj, bands=20):
    """Each twentieth up the mesh: its x span and y span, in hundredths of its length, and its x centre."""
    pts = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', pts)
    pts = pts.reshape(-1, 3)
    out = []
    for i in range(bands):
        sel = pts[(pts[:, 2] >= i / bands) & (pts[:, 2] < (i + 1) / bands)]
        if not len(sel):
            out.append(f'{i * 5}:-')
            continue
        out.append(f'{i * 5}:{round(100 * np.ptp(sel[:, 0]))}x{round(100 * np.ptp(sel[:, 1]))}@{round(100 * sel[:, 0].mean())}')
    return ' '.join(out)


def flat(name, rgb):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    return m


def marker(name, loc, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.data.materials.append(mat)
    return o


def marks():
    red, green, grey, white = flat('red', (1, 0.1, 0.1)), flat('green', (0.1, 0.9, 0.2)), flat('grey', (0.5, 0.5, 0.5)), flat('white', (1, 1, 1))
    out = [marker('top', (0, 0, 1.03), (0.04, 0.04, 0.04), red), marker('right', (0.36, 0, 0.5), (0.04, 0.04, 0.04), green)]
    for i in range(11):
        long = 0.1 if i % 5 == 0 else 0.05
        out.append(marker(f'tick{i}', (-0.42 + long / 2, 0, i / 10), (long, 0.01, 0.006), white if i % 5 == 0 else grey))
    return out


def look_render(path, view):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x, scene.render.resolution_y = 300, 400
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    cam = scene.camera
    if cam is None:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        cam.data.type = 'ORTHO'
        scene.collection.objects.link(cam)
        scene.camera = cam
    cam.data.ortho_scale = 1.2
    if view == 'front':
        cam.location = (0, -4, 0.5)
        cam.rotation_euler = (math.pi / 2, 0, 0)
    else:
        cam.location = (4, 0, 0.5)
        cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def sheet(tiles, out, cols=6):
    """Tiles (label, front.png, side.png) side by side into one PNG."""
    w, h = 300, 400
    rows = (len(tiles) + cols - 1) // cols
    canvas = np.zeros((rows * h, cols * 2 * w, 4), dtype=np.float32)
    for i, (label, front, side) in enumerate(tiles):
        r, c = divmod(i, cols)
        for j, p in enumerate((front, side)):
            img = bpy.data.images.load(p)
            px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
            y0 = (rows - 1 - r) * h
            x0 = (c * 2 + j) * w
            canvas[y0:y0 + h, x0:x0 + w] = px
            bpy.data.images.remove(img)
    img = bpy.data.images.new('sheet', cols * 2 * w, rows * h, alpha=True)
    img.pixels = canvas.ravel()
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    log('sheet', out, [t[0] for t in tiles])


def axis(a):
    return np.array(AXES[a] if isinstance(a, str) else a, dtype=float)


def placed(obj, spec):
    """The matrix taking the principal frame to the piece's: the grip to the origin, turned, and at its true size."""
    pts = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', pts)
    pts = pts.reshape(-1, 3)
    up = axis(spec['up'])
    front = axis(spec['front'])
    front /= np.linalg.norm(front)
    up -= front * up.dot(front)
    up /= np.linalg.norm(up)
    # rows: what becomes +x, +y and +z
    by = -front
    bx = np.cross(by, up)
    rot = Matrix([list(bx), list(by), list(up)]).to_4x4()
    if spec.get('shield'):
        # the palm behind the disc's middle: the rim's back a little out along +x from it
        r = np.hypot(pts[:, 0], pts[:, 2] - 0.5)
        rim = pts[r > 0.4]
        grip = np.array([0.0, 0.0, 0.5]) + bx * ((rim @ bx).min() - SHIELD_OUT / spec['length'])
    elif isinstance(spec['grip'], (int, float)):
        band = pts[np.abs(pts[:, 2] - spec['grip']) < 0.03]
        grip = np.array([band[:, 0].mean(), band[:, 1].mean(), spec['grip']])
    else:
        x, z = spec['grip']
        near = pts[np.hypot(pts[:, 0] - x, pts[:, 2] - z) < 0.05]
        grip = np.array([x, near[:, 1].mean() if len(near) else 0.0, z])
    if spec['kind'] == 'back':
        # flush on the socket: the side toward the body (+y here) at the origin
        grip[1] = 0.0
        flush = (pts - grip) @ by
        shift = Matrix.Translation(V((0, -flush.max() * spec['length'], 0)))
    else:
        shift = Matrix()
    return shift @ Matrix.Scale(spec['length'], 4) @ rot @ Matrix.Translation(V(tuple(-grip)))


def export(obj, path):
    for o in bpy.context.scene.objects:
        o.select_set(o == obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_extras=False,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_meshopt_compression_enable=True,
        export_texcoords=True,
        export_normals=True,
    )


def thumbnail(kind, obj, cam, path):
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ V(c) for c in obj.bound_box]
    centre = sum(corners, V()) / 8
    d = pieces.VIEW[kind].normalized()
    rot = (-d).to_track_quat('-Z', 'Y')
    right = rot @ V((1, 0, 0))
    upv = rot @ V((0, 1, 0))
    w = max(c.dot(right) for c in corners) - min(c.dot(right) for c in corners)
    h = max(c.dot(upv) for c in corners) - min(c.dot(upv) for c in corners)
    cam.data.ortho_scale = max(w, h) * 1.12
    cam.location = centre + d * 6
    cam.rotation_euler = rot.to_euler()
    cam.data.clip_end = 30
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def check_render(path, size):
    """The piece from the hero's right (fingertips to the left) with a fist at the origin, for --check."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = scene.render.resolution_y = 360
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    cam = scene.camera
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size * 2.2
    cam.location = (6, 0, 0)
    cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    cam.data.clip_end = 30
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def write_manifest(rows):
    lines = [
        '// Generated by tools/blender/weapons.py: the lab\'s weapons, from meshes generated off our own prompts. Edit that script, not this file.',
        "import type { PieceKind } from '../charter/look.js'",
        '',
        '/** A carried kind is stowed on a carry slot (kit/body/carry.ts), not held. */',
        "export type WeaponKind = PieceKind | 'back'",
        '',
        'export const WEAPONS: readonly { id: string; name: string; kind: WeaponKind; length: number; tris: number }[] = [',
    ]
    for wid, spec, tris in rows:
        lines.append(f"  {{ id: '{wid}', name: '{spec['name']}', kind: '{spec['kind']}', length: {spec['length']}, tris: {tris} }},")
    lines.append(']')
    with open(MANIFEST, 'w') as f:
        f.write('\n'.join(lines) + '\n')


def main():
    opts = args()
    src = opts['src']
    only = set(opts['only'].split(',')) if 'only' in opts else None
    ids = sorted(d for d in os.listdir(src) if os.path.exists(os.path.join(src, d, 'small.glb')) and (only is None or d in only))
    if 'look' in opts:
        tiles = []
        tmp = os.path.dirname(os.path.abspath(opts['look']))
        for wid in ids:
            clear()
            obj = load(os.path.join(src, wid, 'small.glb'))
            log(wid, 'litter dropped', tidy(obj, WEAPONS.get(wid, {}).get('keep_small', False), WEAPONS.get(wid, {}).get('longest', False)))
            length = framed(obj, WEAPONS.get(wid, {}))
            marks()
            log(wid, 'length in file units', round(length, 3))
            log(wid, 'profile', profile(obj))
            paths = [os.path.join(tmp, f'look-{wid}-{v}.png') for v in ('front', 'side')]
            look_render(paths[0], 'front')
            look_render(paths[1], 'side')
            tiles.append((wid, *paths))
        sheet(tiles, opts['look'])
        return
    os.makedirs(OUT, exist_ok=True)
    check = opts.get('check')
    tiles = []
    rows = []
    for wid in ids:
        spec = WEAPONS[wid]
        clear()
        cam = pieces.setup_render(int(opts.get('size', 320)))
        obj = load(os.path.join(src, wid, 'small.glb'))
        tidy(obj, spec.get('keep_small', False), spec.get('longest', False))
        framed(obj, spec)
        obj.data.transform(placed(obj, spec))
        obj.name = wid
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        path = os.path.join(OUT, f'{wid}.glb')
        export(obj, path)
        if 'no-thumbs' not in opts:
            thumbnail('back' if spec['kind'] == 'back' else spec['kind'], obj, cam, os.path.join(OUT, f'{wid}.webp'))
        log(wid, spec['kind'], tris, 'tris', os.path.getsize(path), 'bytes')
        rows.append((wid, spec, tris))
        if check:
            tmp = os.path.dirname(os.path.abspath(check))
            grey, red, green = flat('fist', (0.85, 0.7, 0.6)), flat('red', (1, 0.1, 0.1)), flat('green', (0.1, 0.9, 0.2))
            s = spec['length']
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.045, location=(0, 0, 0))
            bpy.context.active_object.data.materials.append(grey)
            marker('fingers', (0, -0.12, 0), (0.01, 0.12, 0.01), red)
            marker('thumb', (0, 0, 0.12), (0.01, 0.01, 0.12), green)
            p = os.path.join(tmp, f'check-{wid}.png')
            check_render(p, max(s * 0.6, 0.3))
            tiles.append((wid, p))
    if only is None:
        write_manifest(rows)
        log('manifest', MANIFEST, len(rows))
    if check:
        square_sheet(tiles, check)


def square_sheet(tiles, out, cols=6, px=360):
    rows = (len(tiles) + cols - 1) // cols
    canvas = np.zeros((rows * px, cols * px, 4), dtype=np.float32)
    for i, (label, p) in enumerate(tiles):
        r, c = divmod(i, cols)
        img = bpy.data.images.load(p)
        canvas[(rows - 1 - r) * px:(rows - r) * px, c * px:(c + 1) * px] = np.array(img.pixels[:], dtype=np.float32).reshape(px, px, 4)
        bpy.data.images.remove(img)
    img = bpy.data.images.new('check', cols * px, rows * px, alpha=True)
    img.pixels = canvas.ravel()
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    log('check sheet', out, [t[0] for t in tiles])


main()
