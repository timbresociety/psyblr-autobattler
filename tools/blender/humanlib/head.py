"""
The head object's parts (docs/GAME.md §9.1) for the Psyblr Human bodies, built on the reference body of a gender:

- the 52 ARKit face shapes, from MakeHuman's expression units (the three ethnic variants mixed evenly, as the bodies'
  race is), split left and right or upper and lower where ARKit splits what MakeHuman keeps whole, and a few made
  directly (cheek puff, jaw and mouth sideways, jaw forward). Written in the face basis's layout (face-basis.ts:
  'PFB1', per shape the welded vertices it moves and their deltas), so the game reads them the same way;
- the teeth (upper and lower), the tongue, the brows and the lashes, fitted by MPFB to the same body. Brows and lashes
  are cards bound to the body's surface (a welded triangle, s, t and a lift, as src/kit/wear/bind.ts evaluates), so
  they follow any hero's face; the teeth and tongue are rigid, each placed by a point bound the same way.

The eyeballs are not here: the game builds them (sclera, iris, pupil, cornea) at each hero's own eye sockets.
"""

import json
import os
import shutil
import struct
import subprocess

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

from . import body as B

ETHNIC = ('african', 'asian', 'caucasian')


def unit_paths(unit):
    """The unit's target in each ethnic set (MPFB resolves a bare name to the first set it finds)."""
    first = TargetService.target_full_path(unit)
    if not first:
        raise ValueError(f'no expression unit {unit!r}')
    root = os.path.dirname(os.path.dirname(first))
    return [os.path.join(root, e, unit + '.target.gz') for e in ETHNIC]


# ARKit shape -> its recipe: (unit, weight, mask) terms, or ('proc', kind). Masks: L/R the hero's side (+x is left),
# up/low above or below the lip line. Eye looks and tongueOut have no skin of their own: the game turns the eyes and
# moves the tongue (eyeLook* keep a little lid follow).
ARKIT = {
    'eyeBlinkLeft': [('eye-left-closure', 1, None)],
    'eyeBlinkRight': [('eye-right-closure', 1, None)],
    'eyeLookDownLeft': [('eye-left-closure', 0.25, None)],
    'eyeLookDownRight': [('eye-right-closure', 0.25, None)],
    'eyeLookInLeft': [],
    'eyeLookInRight': [],
    'eyeLookOutLeft': [],
    'eyeLookOutRight': [],
    'eyeLookUpLeft': [('eye-left-opened-up', 0.35, None)],
    'eyeLookUpRight': [('eye-right-opened-up', 0.35, None)],
    'eyeSquintLeft': [('eye-left-slit', 1, None)],
    'eyeSquintRight': [('eye-right-slit', 1, None)],
    'eyeWideLeft': [('eye-left-opened-up', 1, None)],
    'eyeWideRight': [('eye-right-opened-up', 1, None)],
    'jawForward': ('proc', 'jawForward'),
    'jawLeft': ('proc', 'jawLeft'),
    'jawRight': ('proc', 'jawRight'),
    'jawOpen': [('mouth-open', 1, None)],
    'mouthClose': [('mouth-compression', 0.6, None)],
    'mouthFunnel': [('mouth-eversion', 1, None), ('mouth-protusion', 0.4, None)],
    'mouthPucker': [('mouth-pursing', 1, None), ('mouth-protusion', 0.5, None)],
    'mouthLeft': ('proc', 'mouthLeft'),
    'mouthRight': ('proc', 'mouthRight'),
    'mouthSmileLeft': [('mouth-corner-puller', 1, 'L')],
    'mouthSmileRight': [('mouth-corner-puller', 1, 'R')],
    'mouthFrownLeft': [('mouth-depression', 1, 'L')],
    'mouthFrownRight': [('mouth-depression', 1, 'R')],
    'mouthDimpleLeft': [('mouth-retraction', 0.6, 'L')],
    'mouthDimpleRight': [('mouth-retraction', 0.6, 'R')],
    'mouthStretchLeft': [('mouth-depression-retraction', 1, 'L')],
    'mouthStretchRight': [('mouth-depression-retraction', 1, 'R')],
    'mouthRollLower': [('mouth-compression', 1, 'low')],
    'mouthRollUpper': [('mouth-compression', 1, 'up')],
    'mouthShrugLower': [('mouth-elevation', 1, None)],
    'mouthShrugUpper': [('mouth-upward-retraction', 0.5, 'up')],
    'mouthPressLeft': [('mouth-compression', 0.7, 'L')],
    'mouthPressRight': [('mouth-compression', 0.7, 'R')],
    'mouthLowerDownLeft': [('mouth-parling', 1, 'lowL')],
    'mouthLowerDownRight': [('mouth-parling', 1, 'lowR')],
    'mouthUpperUpLeft': [('mouth-upward-retraction', 1, 'L')],
    'mouthUpperUpRight': [('mouth-upward-retraction', 1, 'R')],
    'browDownLeft': [('eyebrows-left-down', 1, None)],
    'browDownRight': [('eyebrows-right-down', 1, None)],
    'browInnerUp': [('eyebrows-left-inner-up', 1, None), ('eyebrows-right-inner-up', 1, None)],
    'browOuterUpLeft': [('eyebrows-left-extern-up', 1, None)],
    'browOuterUpRight': [('eyebrows-right-extern-up', 1, None)],
    'cheekPuff': ('proc', 'cheekPuff'),
    'cheekSquintLeft': [('eye-left-slit', 0.5, 'low'), ('mouth-corner-puller', 0.3, 'upL')],
    'cheekSquintRight': [('eye-right-slit', 0.5, 'low'), ('mouth-corner-puller', 0.3, 'upR')],
    'noseSneerLeft': [('nose-left-elevation', 1, None), ('nose-left-dilatation', 0.3, None)],
    'noseSneerRight': [('nose-right-elevation', 1, None), ('nose-right-dilatation', 0.3, None)],
    'tongueOut': [],
}
assert len(ARKIT) == 52, len(ARKIT)

# MPFB asset per gender: (asset type, folder, name)
PARTS = {
    'm': {'brows': ('Eyebrows', 'eyebrows', 'eyebrow001'), 'lashes': ('Eyelashes', 'eyelashes', 'eyelashes01')},
    'f': {'brows': ('Eyebrows', 'eyebrows', 'eyebrow010'), 'lashes': ('Eyelashes', 'eyelashes', 'eyelashes02')},
}
COMMON = {'teeth': ('Teeth', 'teeth', 'teeth_base'), 'tongue': ('Tongue', 'tongue', 'tongue01')}
TEXTURE = {'teeth_base': 'teeth.png', 'tongue01': 'tongue01_diffuse.png'}

# MediaPipe landmarks on the face (face.py binds them): inner upper and lower lip, mouth corners, cheeks
LIP_UP, LIP_LOW, CORNER_L, CORNER_R, CHEEK_L, CHEEK_R = 13, 14, 291, 61, 425, 205
# both brows' upper and lower edges
BROW_MARKS = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 46, 53, 52, 65, 55, 276, 283, 282, 295, 285]


def fit_brows(pos_b, lm_b, mesh, bvh):
    """
    The brow cards onto the face's own brows (Blender coords): each side's card moved and stretched so its middle and
    width are the brow landmarks', then laid back on the skin at the height it stood off it. The portrait the bodies
    are painted with has its brows there, so the cards sit on them rather than a few millimetres above.
    """
    _tri, _st, lift = bind_points([tuple(p) for p in pos_b], mesh, bvh)
    out = pos_b.copy()
    marks = np.array([lm_b[i] for i in BROW_MARKS])
    for sign in (1, -1):
        m = marks[marks[:, 0] * sign > 0]
        sel = pos_b[:, 0] * sign > 0
        if not len(m) or not sel.any():
            continue
        card = pos_b[sel]
        span_t = np.ptp(m[:, 0])
        span_c = max(np.ptp(card[:, 0]), 1e-6)
        mid_t = (m.max(axis=0) + m.min(axis=0)) / 2
        mid_c = (card.max(axis=0) + card.min(axis=0)) / 2
        moved = card.copy()
        moved[:, 0] = mid_t[0] + (card[:, 0] - mid_c[0]) * span_t / span_c
        moved[:, 2] = card[:, 2] + (mid_t[2] - mid_c[2])
        out[sel] = moved
    for i, p in enumerate(out):
        loc, n, _poly, _d = bvh.find_nearest(tuple(p))
        out[i] = np.array(loc) + np.array(n) * lift[i]
    return out


def gltf(p):
    """Blender (z up, -y forward) to glTF (y up, +z forward)."""
    p = np.asarray(p, dtype=float)
    return np.stack([p[..., 0], p[..., 2], -p[..., 1]], axis=-1)


def smooth(x, width):
    return 1.0 / (1.0 + np.exp(-x / width))


def masks(p0, lm):
    """Per-vertex masks in glTF axes: the hero's side and above or below the lip line."""
    mouth = (lm[LIP_UP] + lm[LIP_LOW]) / 2
    left = smooth(p0[:, 0] - mouth[0], 0.004)
    up = smooth(p0[:, 1] - mouth[1], 0.0025)
    return {None: 1.0, 'L': left, 'R': 1 - left, 'up': up, 'low': 1 - up, 'lowL': (1 - up) * left, 'lowR': (1 - up) * (1 - left), 'upL': up * left, 'upR': up * (1 - left)}


def procedural(kind, p0, normals, lm, unit):
    """The shapes MakeHuman has no unit for, in metres (glTF axes)."""
    d = np.zeros_like(p0)
    if kind == 'cheekPuff':
        for c in (lm[CHEEK_L], lm[CHEEK_R]):
            r = np.linalg.norm(p0 - c, axis=1)
            fall = np.clip(1 - r / 0.036, 0, 1) ** 2 * np.clip(normals[:, 2] + 0.3, 0, 1)
            d += normals * (0.011 * fall)[:, None]
        return d
    # the jaw's own region: how far mouth-open moves each vertex, as a share of the most; the lips' from pursing
    ref = unit['mouth-open' if kind.startswith('jaw') else 'mouth-pursing']
    m = np.linalg.norm(ref, axis=1)
    m = np.clip(m / max(m.max(), 1e-9) * 1.6, 0, 1)
    move = {'jawForward': (0, 0, 0.006), 'jawLeft': (0.006, 0, 0), 'jawRight': (-0.006, 0, 0), 'mouthLeft': (0.007, 0, 0), 'mouthRight': (-0.007, 0, 0)}[kind]
    return m[:, None] * np.array(move)[None]


def bind_points(points, mesh, bvh):
    """Each point (Blender coords) on the mesh's surface: welded triangle, (s, t) and lift along the interpolated normal."""
    tri, st, lift = [], [], []
    V = mesh.vertices
    for p in points:
        loc, _n, poly, _d = bvh.find_nearest(p)
        vs = list(mesh.polygons[poly].vertices)
        best = None
        for k in range(1, len(vs) - 1):
            a, b, c = (np.array(V[i].co) for i in (vs[0], vs[k], vs[k + 1]))
            e1, e2, q = b - a, c - a, np.array(loc) - a
            m = np.array([[e1 @ e1, e1 @ e2], [e1 @ e2, e2 @ e2]])
            s, t = np.linalg.solve(m, [q @ e1, q @ e2])
            worst = min(s, t, 1 - s - t)
            if best is None or worst > best[0]:
                best = (worst, (vs[0], vs[k], vs[k + 1]), s, t)
        _w, ids, s, t = best
        na, nb, nc = (np.array(V[i].normal) for i in ids)
        a, b, c = (np.array(V[i].co) for i in ids)
        n = na + s * (nb - na) + t * (nc - na)
        at = a + s * (b - a) + t * (c - a)
        tri.append([int(i) for i in ids])
        st.append([round(float(s), 5), round(float(t), 5)])
        lift.append(round(float((np.array(p) - at) @ n / (n @ n)), 6))
    return tri, st, lift


def mesh_data(obj):
    """Positions (glTF), uvs and triangles of a plain mesh object, split at UV seams (one vertex per corner UV)."""
    me = obj.data
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data if me.uv_layers.active else None
    keys, pos, uv, tris = {}, [], [], []
    for lt in me.loop_triangles:
        out = []
        for li, vi in zip(lt.loops, lt.vertices):
            u = tuple(round(x, 5) for x in uvl[li].uv) if uvl else (0.0, 0.0)
            k = (vi, u)
            if k not in keys:
                keys[k] = len(pos)
                pos.append(tuple(me.vertices[vi].co))
                uv.append((u[0], 1 - u[1]))
            out.append(keys[k])
        tris.append(out)
    return np.array(pos), np.array(uv), np.array(tris)


def fitted_parts(gender):
    """An `extra` hook for make_body that fits the face parts to the human and keeps plain copies of them."""
    out = {}
    root = LocationService.get_user_data()
    want = dict(COMMON, **PARTS[gender])

    def extra(human):
        for key, (kind, folder, name) in want.items():
            path = os.path.join(root, folder, name, name + '.mhclo')
            obj = HumanService.add_mhclo_asset(path, human, asset_type=kind, subdiv_levels=0, material_type='NONE')
            for mod in list(obj.modifiers):
                if mod.type != 'ARMATURE':
                    obj.modifiers.remove(mod)
            out[key] = (B.plain_copy(obj, 'part_' + key, keep_groups=False), os.path.join(root, folder, name), name)
            bpy.data.objects.remove(obj, do_unlink=True)

    return out, extra


def texture(path, folder, key, size=512):
    """A part's texture beside it: a 512 WebP (alpha kept) when cwebp is installed, else the PNG as it is."""
    if shutil.which('cwebp'):
        out = os.path.join(folder, key + '.webp')
        subprocess.run(['cwebp', '-quiet', '-q', '88', '-alpha_q', '100', '-resize', str(size), '0', path, '-o', out], check=True)
        return key + '.webp'
    shutil.copy(path, os.path.join(folder, key + '.png'))
    return key + '.png'


def head_scaled(co, body, head_scale):
    """A part's points as make_body moves the head: scaled about the head joint, then the whole body scaled."""
    s = body.scale
    hk = 'head' if 'head' in body.joints else 'mixamorig:Head'
    J = np.array(body.joints[hk][0]) / s
    return (J + (co - J) * head_scale) * s


def build_head(spec, build_body, out, head_scale, log=print):
    gender = spec['id'][0]
    parts, extra = fitted_parts(gender)
    plain = build_body(spec, {}, extra=extra, head_scale=head_scale)
    me = plain.mesh.data
    n = len(me.vertices)
    p0_b = B.positions(plain.mesh)
    p0 = gltf(p0_b)
    nb = np.empty(n * 3)
    me.vertices.foreach_get('normal', nb)
    normals = gltf(nb.reshape(-1, 3))
    lm = gltf(plain.lm[0])
    # the parts, read before the next build clears the scene
    folder = out + '-parts'
    os.makedirs(folder, exist_ok=True)
    bvh = BVHTree.FromObject(plain.mesh, bpy.context.evaluated_depsgraph_get())
    pieces = {}
    for key, (obj, src, name) in parts.items():
        pos_b, uv, tris = mesh_data(obj)
        pos_b = head_scaled(pos_b, plain, head_scale)
        piece = {'texture': None}
        tex = TEXTURE.get(name, name + '.png')
        if os.path.exists(os.path.join(src, tex)):
            piece['texture'] = texture(os.path.join(src, tex), folder, key)
        if key == 'brows':
            pos_b = fit_brows(pos_b, np.array(plain.lm[0]), me, bvh)
        if key in ('brows', 'lashes'):
            tri, st, lift = bind_points([tuple(p) for p in pos_b], me, bvh)
            piece.update(tri=sum(tri, []), st=sum(st, []), lift=lift)
        pos = gltf(pos_b)
        if key == 'teeth':
            # upper and lower apart: each connected piece goes with the half its middle is in
            mouth_y = ((lm[LIP_UP] + lm[LIP_LOW]) / 2)[1]
            parent = list(range(len(pos)))

            def find(i):
                while parent[i] != i:
                    parent[i] = parent[parent[i]]
                    i = parent[i]
                return i

            for t in tris:
                for k in (1, 2):
                    parent[find(t[k])] = find(t[0])
            comp = np.array([find(i) for i in range(len(pos))])
            ys = {c: pos[comp == c][:, 1].mean() for c in set(comp)}
            for half, keep in (('upper', lambda c: ys[c] >= mouth_y), ('lower', lambda c: ys[c] < mouth_y)):
                sel = np.array([keep(c) for c in comp])
                idx = np.nonzero(sel)[0]
                remap = -np.ones(len(pos), dtype=int)
                remap[idx] = np.arange(len(idx))
                ts = [[int(remap[i]) for i in t] for t in tris if all(sel[i] for i in t)]
                pieces['teeth_' + half] = part_json(pos[idx], uv[idx], ts, dict(piece), me, bvh)
            continue
        pieces[key] = part_json(pos, uv, tris.tolist(), piece, me, bvh, rigid=key == 'tongue')
        log('part', key, len(pos), 'vertices', len(tris), 'triangles')
    # each unit's deltas on the skin, in metres, glTF axes
    units = sorted({u for r in ARKIT.values() if isinstance(r, list) for u, _w, _m in r} | {'mouth-open', 'mouth-pursing'})
    unit = {}
    for u in units:
        paths = unit_paths(u)

        def load(human, paths=paths):
            for p in paths:
                TargetService.load_target(human, p, weight=1.0 / len(paths))

        v = build_body(spec, {}, extra=load, scale=plain.scale, head_scale=head_scale)
        unit[u] = gltf(B.positions(v.mesh)) - p0
        log('unit', u, f'max {np.abs(unit[u]).max() * 1000:.1f} mm')
    mk = masks(p0, lm)
    blobs, names = [], []
    for name, recipe in ARKIT.items():
        if isinstance(recipe, tuple):
            d = procedural(recipe[1], p0, normals, lm, unit)
        else:
            d = np.zeros_like(p0)
            for u, w, m in recipe:
                mask = mk[m]
                d += unit[u] * (w * (mask if np.isscalar(mask) else mask[:, None]))
        g = d * 1e5
        ids = np.nonzero(np.abs(g).max(axis=1) >= 2)[0]
        q = np.clip(np.round(g[ids]), -32767, 32767).astype('<i2')
        blobs.append(struct.pack('<I', len(ids)) + ids.astype('<u2').tobytes() + q.tobytes())
        names.append(name)
    with open(out + '.bin', 'wb') as f:
        f.write(b'PFB1' + struct.pack('<IH', n, len(names)) + b''.join(blobs))
    meta = {
        'version': 1,
        'from': spec['id'],
        'vertices': n,
        'faceScale': round(plain.scale * head_scale, 6),
        'shapes': names,
        'mouth': [round(float(x), 5) for x in (lm[LIP_UP] + lm[LIP_LOW]) / 2],
        'parts': {k: k for k in pieces},
    }
    with open(out + '.json', 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    for k, piece in pieces.items():
        with open(os.path.join(folder, k + '.json'), 'w') as f:
            json.dump(piece, f, separators=(',', ':'))
    log('wrote', out + '.bin', os.path.getsize(out + '.bin'), 'bytes', len(names), 'shapes', len(pieces), 'parts')


def part_json(pos, uv, tris, piece, me, bvh, rigid=True):
    """A part as the game reads it; a rigid one also carries its middle bound to the face, which places it on a hero."""
    piece = dict(piece)
    piece['position'] = [round(float(x), 5) for x in pos.reshape(-1)]
    piece['uv'] = [round(float(x), 5) for x in uv.reshape(-1)]
    piece['index'] = [int(i) for t in tris for i in t]
    if rigid and 'tri' not in piece:
        mid = pos.mean(axis=0)
        # back to Blender coords for the binding
        tri, st, lift = bind_points([(mid[0], -mid[2], mid[1])], me, bvh)
        piece['anchor'] = {'tri': tri[0], 'st': st[0], 'lift': lift[0], 'at': [round(float(x), 5) for x in mid]}
    return piece

