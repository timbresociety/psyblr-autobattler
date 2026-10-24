"""Assemble one character: body, face, rig, clothes, gear, hair, bake, clips, export (see human.py)."""

import json
import math
import os
import time

import bpy
from mathutils import Vector

from . import bake as K
from . import body as B
from . import clips as C
from . import face as F
from . import garments as G
from . import hair as H
from . import heroes
from . import rig as R
from . import sockets as S

HERE = os.path.dirname(os.path.abspath(__file__))
PORTRAITS = os.path.join(os.path.dirname(HERE), 'portraits')


def log(*a):
    print('[human]', *a, flush=True)


def portrait_of(spec):
    pid = spec.get('portrait')
    if not pid:
        return None, None
    img = os.path.join(PORTRAITS, pid + '.webp')
    lm = os.path.join(PORTRAITS, pid + '.lm.json')
    if not (os.path.exists(img) and os.path.exists(lm)):
        log('no portrait for', pid, '- building without a face texture')
        return None, None
    with open(lm) as f:
        return img, json.load(f)


def define_materials(spec, skin_rgb):
    mats = G.Materials()
    tinted_skin = spec.get('base', False)
    region_default = 'baked' if not spec.get('base') else None
    mats.get('skin', paint='skin', color=skin_rgb, region='skin' if tinted_skin else 'baked', tint=tinted_skin)
    mats.get('face', paint='face', color=skin_rgb, region='skin' if tinted_skin else 'baked', tint=tinted_skin)
    mats.get('eye', paint='eye', color=(0.93, 0.92, 0.9), region='eye' if tinted_skin else 'baked', tint=tinted_skin)
    for name, m in spec['mats'].items():
        props = dict(m)
        props.setdefault('paint', 'fabric')
        if region_default:
            # a real person's outfit keeps its baked colours; leather and silk shine, bronze is metal
            props.setdefault('region', {'leather': 'baked_gloss', 'silk': 'baked_gloss', 'metal': 'baked_metal'}.get(props['paint'], 'baked'))
        else:
            props.setdefault('region', 'metal' if props['paint'] == 'metal' else 'suit')
        mats.get(name, **props)
    return mats


def main(opts):
    t0 = time.time()
    spec = heroes.spec(opts.get('hero') or opts.get('base'))
    size = int(opts.get('size', spec.get('atlas', 1024)))
    img_path, lm = portrait_of(spec)
    fitted = {}

    def extra(human):
        if lm is not None:
            fitted.update(F.fit_face(human, lm, log=log))

    body = B.make_body(spec['macro'], spec.get('targets', {}), spec.get('proxy', 'male1591'), height=spec.get('height', 1.8), extra=extra, head_scale=spec.get('head_scale', 1.08))
    B.refine_head(body)
    rig = R.build_rig(body)
    R.merge_weights(body.mesh)
    log('body', B.triangles([body.mesh]), 'tris', f'{time.time() - t0:.1f}s')

    # the face: the portrait warped onto this head, and its skin colour for the rest of the body
    head_frame = None
    face_img = None
    hair_img = None
    hair_cols = None
    skin_rgb = tuple(spec.get('skin', (0.78, 0.58, 0.46)))
    if img_path and body.lm is not None:
        (el, _), (er, _) = body.eyes
        eyes = (el + er) / 2
        head_frame = F.HeadFrame(eyes.x, eyes.z - 0.03, 0.30, 1024)
        tmp = os.path.join(bpy.app.tempdir or '/tmp', f"face_{spec['id']}.png")
        hair_tmp = os.path.join(bpy.app.tempdir or '/tmp', f"hair_{spec['id']}.png")
        made = F.face_texture(img_path, lm, body.lm, head_frame, tmp, delight=spec.get('delight', 0.5), neutral=bool(spec.get('base')), hair_out=None if spec.get('base') else hair_tmp)
        skin, hair_cols = made if isinstance(made, tuple) and len(made) == 2 and not isinstance(made[0], float) else (made, None)
        if 'skin' not in spec:
            skin_rgb = tuple(float(x) for x in skin)
        face_img = bpy.data.images.load(tmp)
        face_img.colorspace_settings.name = 'sRGB'
        if hair_cols:
            hair_img = bpy.data.images.load(hair_tmp)
            hair_img.colorspace_settings.name = 'sRGB'
        log('face texture', tmp, 'skin', [round(x, 3) for x in skin_rgb], 'hair', hair_cols and [round(x, 3) for x in hair_cols[0]])

    mats = define_materials(spec, skin_rgb)
    d = G.Dresser(body.mesh, rig, mats)
    d.dress(spec['layers'])
    if spec.get('smooth'):
        d.smooth_region(spec['smooth'], iterations=2, factor=0.35)
    # head skin takes the face material (the portrait projects only there)
    me = body.mesh.data
    me.materials.append(mats.mats['face'])
    face_slot = len(me.materials) - 1
    skin_slot = [i for i, m in enumerate(me.materials) if m.name == 'skin'][0]
    for p in me.polygons:
        if p.material_index == skin_slot and d.face_bone(p) == 'head':
            p.material_index = face_slot
    me.materials[skin_slot]  # keep
    head = H.Head(body, body.mesh)
    sockets = S.body_sockets(rig, head, body.mesh) if spec.get('base') else None
    for m in mats.mats.values():
        if m.get('paint') == 'hair':
            m['centre'] = tuple(head.centre)
            if hair_cols and not spec.get('keep_hair_color'):
                # the portrait knows the hair colour better than a guess
                m['color'], m['color2'] = hair_cols
            if hair_img is not None:
                m['front'] = True
    parts = []
    hs = spec.get('hair')
    if hs:
        h = H.make_hair(d, head, **hs)
        if h:
            parts.append(h)
    if spec.get('beard'):
        style, depth = spec['beard'] if isinstance(spec['beard'], tuple) else (spec['beard'], None)
        b = H.make_beard(d, head, style, depth=depth)
        if b:
            parts.append(b)
    for kind, args in spec.get('gear', []):
        made = GEAR[kind](d, head, body, **args)
        parts.extend([x for x in (made if isinstance(made, list) else [made]) if x])
    if spec.get('parts'):
        parts.extend(base_parts(d, head, body, mats))
    eyes = B.make_eyes(body)
    for e in eyes:
        e.data.materials.append(mats.mats['eye'])
        d.skin_weights(e, rigid='head')
    tris = B.triangles([body.mesh] + parts + eyes)
    log('dressed', tris, 'tris', [p.name for p in parts], f'{time.time() - t0:.1f}s')
    for p in parts + eyes:
        K.unwrap_part(p)
    bpy.data.objects.remove(body.hires, do_unlink=True)
    hero = K.join([body.mesh] + parts + eyes)
    face_mats = {i for i, m in enumerate(hero.data.materials) if m.get('paint') in ('face', 'eye')}
    hair_mats = {i for i, m in enumerate(hero.data.materials) if m.get('paint') == 'hair'}
    if head_frame:
        K.projection_uvs(hero, head_frame)
        # the face gets its own island, laid out exactly as the portrait projects (no stretch, the most texels)
        me = hero.data
        atlas_uv = me.uv_layers['atlas']
        for p in me.polygons:
            if p.material_index in face_mats and p.normal.y < -0.3 and me.materials[p.material_index].get('paint') == 'face':
                for li in p.loop_indices:
                    atlas_uv.data[li].uv = head_frame.uv(me.vertices[me.loops[li].vertex_index].co)

    def density(faces):
        idx = [f.material_index for f in faces]
        if sum(1 for i in idx if i in face_mats) > len(idx) * 0.5:
            front = sum(f.normal.y for f in faces) / len(faces) < -0.3
            return spec.get('face_density', 3.4) if front else 1.1
        if sum(1 for i in idx if i in hair_mats) > len(idx) * 0.5:
            return 0.9
        return 1.0

    K.layout_atlas(hero, density)
    face_meta = F.face_meta(head_frame, body.lm, size) if head_frame and body.lm is not None else None
    out = opts.get('out')
    png = (os.path.splitext(out)[0] + '_atlas.png') if opts.get('keep-atlas') and out else None
    log('laid out', f'{time.time() - t0:.1f}s')
    atlas, normal = K.bake(hero, size, face_img, ao_samples=int(opts.get('ao', 24)), out_png=png, log=log, hair_img=hair_img, normal_size=int(opts.get('normal', 512)))
    K.final_material(hero, atlas, normal)
    R.bind(rig, [hero])
    C.author(rig, arms_out=spec.get('arms_out', 0.0))
    log('baked', f'{time.time() - t0:.1f}s', 'tris', B.triangles([hero]), 'verts', len(hero.data.vertices))
    if out:
        export(out, size)
        log('wrote', out, os.path.getsize(out), 'bytes', f'{time.time() - t0:.1f}s')
        if face_meta and spec.get('base'):
            # the body's kit sidecar: where a photo face goes (src/arena/client/face/) and where gear hangs
            # (src/arena/client/gear.ts)
            meta_path = os.path.splitext(out)[0] + '.kit.json'
            with open(meta_path, 'w') as f:
                json.dump(dict(face_meta, sockets=sockets), f, separators=(',', ':'))
            log('kit meta', meta_path, sum(1 for p in face_meta['landmarks'] if p), 'landmarks', len(sockets or {}), 'sockets')
    if opts.get('sheet'):
        sheet(opts['sheet'], rig)
    if opts.get('render'):
        portrait_render(opts['render'], rig, head)


def export(path, size):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_skins=True,
        export_extras=False,
        export_apply=False,
        export_yup=True,
        export_vertex_color='NONE',
        export_image_format='WEBP',
        export_image_quality=int(os.environ.get('HERO_WEBP_QUALITY', '86')),
        export_meshopt_compression_enable=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
    )


# ------------------------------------------------------------------------------------------------ generic body parts


# every hair style and beard a body carries, switched per hero by its look (PARTS in bake.py and character-look.ts)
BASE_HAIR = ('crop', 'spiky', 'long', 'buzz', 'short', 'curly', 'swept', 'bob', 'volume')
BASE_BEARDS = ('full', 'goatee', 'chin_curtain')


def base_parts(d, head, body, mats):
    """The switchable parts of a body: its hair styles and beards, a helmet, armour and a cape (see PARTS)."""
    out = []
    hair_props = dict(heroes.BASE_MATS['hair'])
    for style in BASE_BEARDS:
        mats.get(f'beard_{style}', **dict(hair_props, part=f'beard:{style}', centre=tuple(head.centre)))
        b = H.make_beard(d, head, style, mat=f'beard_{style}')
        if b:
            b.name = f'beard_{style}'
            out.append(b)
    for style in BASE_HAIR:
        mats.get(f'hair_{style}', **dict(hair_props, part=f'hair:{style}', centre=tuple(head.centre)))
        h = H.make_hair(d, head, style, mat=f'hair_{style}')
        if h:
            h.name = f'hair_{style}'
            out.append(h)
    mats.get('helmet', **dict(heroes.BASE_MATS['metal'], part='hair:helmet'))
    mats.get('crest', **dict(heroes.BASE_MATS['cape'], part='hair:helmet'))
    out.extend(H.make_helmet(d, head, mat='helmet', crest='crest'))
    mats.get('armour', **dict(heroes.BASE_MATS['metal'], part='armour'))
    for side in 'LR':
        out.extend(gear_pauldron(d, head, body, side=side, mat='armour', layers=2, size=0.14))
    mats.get('cape_part', **dict(heroes.BASE_MATS['cape'], part='cape'))
    out.append(gear_cape(d, head, body, mat='cape_part'))
    return out


# ------------------------------------------------------------------------------------------------ gear


def gear_belt(d, head, body, mat='belt', buckle='bronze', height=0.05):
    z = d.waist_z - 0.035
    torso = {p.index for p in d.obj.data.polygons if d.face_bone(p) in ('hips', 'spine')}
    belt = d.band('belt', Vector((0, d.bones['hips'][0].y, z)), Vector((0, 0, 1)), Vector((1, 0, 0)), height, 0.006, mat, count=22, faces=torso)
    parts = [belt]
    if buckle:
        front = min(v.co.y for v in belt.data.vertices)
        b = G.mesh_box('buckle', (0.05, 0.012, height * 1.05), Vector((0, front - 0.004, z + height / 2)), d.mats.mats[buckle])
        d.skin_weights(b, rigid='hips')
        parts.append(b)
    return parts


def gear_pauldron(d, head, body, side='L', mat='bronze', layers=2, size=0.13, trim=None):
    bone = f'upper_arm_{side}'
    j = d.bones[bone][0]
    out = []
    for k in range(layers):
        r = size * (1 - 0.18 * k)
        cz = j.z + 0.03 - 0.035 * k

        def pick(poly, r=r, cz=cz):
            c = poly.center
            b = d.face_bone(poly)
            if b not in (bone, f'clavicle_{side}', 'upper_chest'):
                return False
            if (c - Vector((j.x * 0.95, j.y, cz))).length > r:
                return False
            return c.z > cz - r * 0.55 and abs(c.x) > abs(j.x) * 0.55

        shell = d.shell(f'pauldron_{side}{k}', pick, 0.028 + 0.012 * (layers - 1 - k), 0.008, mat if k == 0 or not trim else trim)
        if shell:
            out.append(shell)
    return out


def gear_bracers(d, head, body, mat='leather_dark', start=0.42, end=0.92, sides='LR'):
    out = []
    for side in sides:
        bone = f'forearm_{side}'

        def pick(poly, bone=bone):
            return d.face_bone(poly) == bone and start <= d.along(bone, poly.center) <= end

        s = d.shell(f'bracer_{side}', pick, 0.011, 0.006, mat)
        if s:
            out.append(s)
    return out


def gear_greaves(d, head, body, mat='bronze', sides='LR'):
    out = []
    for side in sides:
        bone = f'shin_{side}'

        def pick(poly, bone=bone):
            return d.face_bone(poly) == bone and 0.12 <= d.along(bone, poly.center) <= 0.78 and poly.normal.y < 0.25

        s = d.shell(f'greave_{side}', pick, 0.013, 0.006, mat)
        if s:
            out.append(s)
    return out


def gear_sash(d, head, body, mat='accent', width=0.045, side='R'):
    """A baldric over one shoulder to the opposite hip, front and back: the hero's colour, worn into battle."""
    s = -1 if side == 'R' else 1
    sh = d.bones[f'upper_arm_{side if side else "R"}'][0]
    top = Vector((sh.x * 0.72, d.neck.y + 0.01, sh.z + 0.035))
    hip = Vector((-s * 0.13, d.bones['hips'][0].y, d.waist_z - 0.06))
    torso = {p.index for p in d.obj.data.polygons if d.face_bone(p) in G.TORSO}
    parts = []
    for face, ydir in (('front', 1), ('back', -1)):
        path = [top.lerp(hip, t / 9) for t in range(10)]

        def snap(i, p, ydir=ydir):
            return Vector((0, ydir, 0))

        def across(i, q, n):
            along = (hip - top).normalized()
            return n.cross(along)

        parts.append(d.strip(f'sash_{face}', path, [(width, width)] * len(path), across, 0.006, mat, faces=torso, snap_dir=snap, thickness=0.003))
    return parts


def gear_cape(d, head, body, mat='accent', length=0.95, flare=0.5):
    """A cloth panel from the shoulders down the back, tied at the collar (rides the upper chest)."""
    import bmesh as bm_

    sh = d.bones['upper_arm_L'][0]
    rows, cols = 8, 7
    back = max(v.co.y for v in d.obj.data.vertices if v.co.z > d.neck.z - 0.25 and v.co.z < d.neck.z - 0.05)
    bm = bm_.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = []
    for r in range(rows + 1):
        t = r / rows
        width = (sh.x + 0.03) * (1 + flare * t)
        z = d.neck.z - 0.02 - length * t
        row = []
        for c in range(cols + 1):
            u = c / cols * 2 - 1
            y = back + 0.035 + 0.06 * t + 0.035 * (1 - u * u) * (1 - t * 0.5)
            row.append(bm.verts.new((u * width, y, z)))
        grid.append(row)
    for r in range(rows):
        for c in range(cols):
            f = bm.faces.new((grid[r][c], grid[r + 1][c], grid[r + 1][c + 1], grid[r][c + 1]))
            for loop, (uu, vv) in zip(f.loops, ((c, r), (c, r + 1), (c + 1, r + 1), (c + 1, r))):
                loop[uv].uv = (uu / cols, vv / rows)
    G.solidify(bm, 0.008)
    return d._finish('cape', bm, mat, rigid='upper_chest')


def gear_collar(d, head, body, mat='shirt', height=0.04, gap=0.18, offset=0.007, drop=0.02, tilt=0.3, flare=0.006, name='collar'):
    """A collar standing round the neck (open at the front when `gap` > 0); a thin one is a tee's ribbed neckband."""
    n = d.neck
    gapf = (lambda k, cnt: abs(((k + 0.5) / cnt) - 0.75) < gap / 2) if gap else None
    # aim only at the neck itself, so rays from the front never land on the chest
    faces = {p.index for p in d.obj.data.polygons if p.center.z > n.z - 0.11 and d.face_bone(p) in ('neck', 'upper_chest', 'clavicle_L', 'clavicle_R', 'head') and abs(p.center.x) < 0.11}
    return d.band(name, Vector((0, n.y + 0.012, n.z - drop)), Vector((0, -tilt, 1)), Vector((1, 0, 0)), height, offset, mat, count=18, flare=flare, gap=gapf, radius=0.14, faces=faces, round_to=0.012)


def gear_hem(d, head, body, mat='jacket', at='hip', height=0.035, offset=0.02, flare=0.01):
    """The bottom edge of a jacket or coat standing off the hips."""
    z = {'waist': d.waist_z - 0.02, 'hip': d.hip_z - 0.04, 'crotch': d.hip_z - 0.12, 'thigh': d.hip_z - 0.24}[at]
    return d.band('hem', Vector((0, d.bones['hips'][0].y, z - 0.005)), Vector((0, 0, 1)), Vector((1, 0, 0)), height, offset, mat, count=24, flare=flare, radius=0.34)


def gear_trouser_hems(d, head, body, mat='trousers', at=0.93, offset=0.008):
    out = []
    for side in 'LR':
        bone = f'shin_{side}'
        h, t = d.bones[bone]
        faces = {p.index for p in d.obj.data.polygons if d.face_bone(p) == bone}
        out.append(d.band(f'trouser_hem_{side}', h.lerp(t, at), h - t, Vector((0, -1, 0)), 0.025, offset, mat, count=12, faces=faces, flare=0.002, radius=0.3))
    return out


def gear_tie(d, head, body, mat='tie', width=0.04, length=None):
    n = d.neck
    top = Vector((0, n.y, n.z - 0.045))
    bottom_z = d.waist_z + 0.02 if length is None else n.z - length
    path = [Vector((0, top.y, top.z + (bottom_z - top.z) * t / 10)) for t in range(11)]
    widths = [(0.012 + (width - 0.012) * min(1, t / 3) if t < 10 else 0.004,) * 2 for t in range(11)]
    torso = {p.index for p in d.obj.data.polygons if d.face_bone(p) in G.TORSO}
    tie = d.strip('tie', path, widths, lambda i, q, nrm: Vector((1, 0, 0)), 0.008, mat, faces=torso, snap_dir=lambda i, p: Vector((0, 1, 0)), thickness=0.003)
    knot = G.mesh_box('knot', (0.03, 0.02, 0.026), Vector((0, min(v.co.y for v in tie.data.vertices) + 0.004, top.z + 0.008)), d.mats.mats[mat])
    d.skin_weights(knot, rigid='upper_chest')
    return [tie, knot]


def gear_bowtie(d, head, body, mat='bowtie'):
    import bmesh as bm_

    n = d.neck
    y = min(v.co.y for v in d.obj.data.vertices if abs(v.co.z - (n.z - 0.03)) < 0.015 and abs(v.co.x) < 0.03) - 0.012
    z = n.z - 0.03
    bm = bm_.new()
    for s in (1, -1):
        pts = [(0.006 * s, 0, 0.008), (0.05 * s, 0, 0.022), (0.05 * s, 0, -0.022), (0.006 * s, 0, -0.008)]
        front = [bm.verts.new(Vector(p) + Vector((0, y, z))) for p in pts]
        back = [bm.verts.new(Vector(p) + Vector((0, y + 0.012, z))) for p in pts]
        bm.faces.new(front)
        bm.faces.new(back[::-1])
        for k in range(4):
            bm.faces.new((front[k], back[k], back[(k + 1) % 4], front[(k + 1) % 4]))
    bm_.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bow = d._finish('bowtie', bm, mat, rigid='upper_chest')
    knot = G.mesh_box('bowknot', (0.016, 0.016, 0.02), Vector((0, y - 0.002, z)), d.mats.mats[mat])
    d.skin_weights(knot, rigid='upper_chest')
    return [bow, knot]


def gear_lapels(d, head, body, mat='jacket', width=0.06, button=None):
    """Notched lapels along an open jacket's V, from the collar down to the top button."""
    n = d.neck
    bottom_z = d.waist_z + 0.03 if button is None else button
    torso = {p.index for p in d.obj.data.polygons if d.face_bone(p) in G.TORSO}
    out = []
    for s in (1, -1):
        top = Vector((s * 0.05, n.y - 0.02, n.z - 0.005))
        bot = Vector((s * 0.008, n.y - 0.1, bottom_z))
        path = [top.lerp(bot, t / 8) for t in range(9)]
        widths = [(0.0, width * (1 - t / 8) ** 0.8 + 0.006) if s > 0 else (width * (1 - t / 8) ** 0.8 + 0.006, 0.0) for t in range(9)]

        def across(i, q, nrm):
            along = (bot - top).normalized()
            return nrm.cross(along) * -1

        out.append(d.strip(f'lapel_{"L" if s > 0 else "R"}', path, widths, across, 0.005, mat, faces=torso, snap_dir=lambda i, p: Vector((0, 1, 0)), thickness=0.004))
    return out


def gear_glasses(d, head, body, shape='round', mat='glasses'):
    return H.make_glasses(d, head, shape, mat)


def gear_top_hat(d, head, body, mat='hat'):
    return H.make_top_hat(d, head, mat)


def gear_cigar(d, head, body, mat='cigar'):
    return H.make_cigar(d, head, mat)


def gear_cuffs(d, head, body, mat='shirt', at=0.9, height=0.035, offset=0.006, bone='forearm'):
    out = []
    for side in 'LR':
        b = f'{bone}_{side}'
        h, t = d.bones[b]
        faces = {p.index for p in d.obj.data.polygons if d.face_bone(p) == b}
        c = h.lerp(t, at)
        out.append(d.band(f'cuff_{side}', c - (t - h).normalized() * height, t - h, Vector((0, 0, 1)), height, offset, mat, count=12, faces=faces, radius=0.3))
    return out


GEAR = {
    'belt': gear_belt,
    'pauldron': gear_pauldron,
    'bracers': gear_bracers,
    'greaves': gear_greaves,
    'sash': gear_sash,
    'cape': gear_cape,
    'collar': gear_collar,
    'hem': gear_hem,
    'trouser_hems': gear_trouser_hems,
    'tie': gear_tie,
    'bowtie': gear_bowtie,
    'lapels': gear_lapels,
    'glasses': gear_glasses,
    'top_hat': gear_top_hat,
    'cigar': gear_cigar,
    'cuffs': gear_cuffs,
}


# ------------------------------------------------------------------------------------------------ previews


def _camera(scene, loc, target, lens=50, ortho=None):
    cam = bpy.data.objects.get('cam') or B.link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    scene.camera = cam
    return cam


def _lights(scene):
    if bpy.data.objects.get('key'):
        return
    for name, energy, rot, color in (('key', 3.2, (55, 0, 35), (1.0, 0.92, 0.84)), ('rim', 2.2, (60, 0, 200), (0.7, 0.8, 1.0)), ('fill', 0.8, (80, 0, -60), (0.9, 0.85, 1.0))):
        l = B.link(bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN')))
        l.data.energy = energy
        l.data.color = color
        l.rotation_euler = tuple(math.radians(a) for a in rot)
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.32, 0.29, 0.4, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7
    scene.world = w


def play(rig, name):
    for t in rig.animation_data.nla_tracks:
        t.mute = True
    act = bpy.data.actions[name]
    rig.animation_data.action = act
    if getattr(act, 'slots', None) and hasattr(rig.animation_data, 'action_slot'):
        rig.animation_data.action_slot = act.slots[0]


def preview_engine(scene):
    """Previews render on the CPU with Cycles: EEVEE can stall in a background Blender while browsers hold the GPU."""
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False


def portrait_render(path, rig, head):
    scene = bpy.context.scene
    preview_engine(scene)
    _lights(scene)
    play(rig, 'idle')
    scene.frame_set(1)
    e = head.eyes
    scene.render.resolution_x = scene.render.resolution_y = 900
    for name, loc, lens in (('face', (e.x + 0.18, e.y - 0.62, e.z + 0.02), 70), ('full', (1.3, -3.6, 1.15), 45)):
        _camera(scene, loc, (e.x, e.y, e.z - 0.04) if name == 'face' else (0, 0, 0.92), lens)
        scene.render.filepath = path.replace('.png', f'_{name}.png')
        bpy.ops.render.render(write_still=True)


SHEET = [('idle', 0), ('run', 0.17), ('slash', 0.2), ('shoot', 0.1), ('cast', 0.3), ('ultimate', 0.5), ('hurt', 0.06), ('fall', 0.9)]


def sheet(folder, rig):
    os.makedirs(folder, exist_ok=True)
    scene = bpy.context.scene
    preview_engine(scene)
    _lights(scene)
    scene.render.resolution_x, scene.render.resolution_y = 360, 420
    _camera(scene, (1.9, -3.3, 1.3), (0, 0, 0.95), 50)
    for i, (name, t) in enumerate(SHEET):
        play(rig, name)
        scene.frame_set(round(t * 30) + 1)
        scene.render.filepath = f'{folder}/{i:02d}_{name}_{t}.png'
        bpy.ops.render.render(write_still=True)
