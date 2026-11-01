"""
The Psyblr Human bodies (docs/plans/2026-10-31-canon-psyblr-human.md, phase 1): a MakeHuman body on its full mesh,
rigged on the Psyblr Human rig (humanlib/standard.py, src/kit/rig/standard.json) with MakeHuman's own weights, its
face fitted to a portrait and the portrait projected on, its physique morphs, baked into one atlas and exported as a
GLB with a kit sidecar (version 3). Clips are not authored here: every move is motion capture retargeted by
scripts/rpm-anim.ts onto this rig.

    Blender -b --python tools/blender/human2.py -- --base m-medium --out public/heroes/v2/m-medium.glb [--size 2048] [--render dir]
"""

import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from humanlib import bake as K  # noqa: E402
from humanlib import body as B  # noqa: E402
from humanlib import build as BL  # noqa: E402
from humanlib import face as F  # noqa: E402
from humanlib import garments as G  # noqa: E402
from humanlib import hair as H  # noqa: E402
from humanlib import heroes  # noqa: E402
from humanlib import sockets as S  # noqa: E402
from humanlib import standard as R  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
opts = {}
i = 0
while i < len(argv):
    key = argv[i].lstrip('-')
    if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
        opts[key] = argv[i + 1]
        i += 2
    else:
        opts[key] = '1'
        i += 1

log = BL.log


def build_body(spec, targets, extra=None, scale=None, macro=None, head_scale=1.0):
    return B.make_body(macro or spec['macro'], targets, spec['proxy'], height=spec.get('height', 1.8), extra=extra, head_scale=head_scale, scale=scale, rig_name='mixamo', full_mesh=True)


def trunk_attributes(obj):
    """Per-vertex trunk membership the base layer is masked by (bake.base_layer), on the contract's bones."""
    me = obj.data
    low = [sum(x) for x in zip(*(R.group_weight(obj, g) for g in ('Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg')))]
    high = [sum(x) for x in zip(*(R.group_weight(obj, g) for g in ('Spine', 'Spine1', 'Spine2')))]
    for name, vals in (('trunk_low', low), ('trunk_high', high)):
        a = me.attributes.get(name) or me.attributes.new(name, 'FLOAT', 'POINT')
        for i, v in enumerate(vals):
            a.data[i].value = min(1.0, v)


def under_layer(rig, gender):
    z = lambda bone: rig.data.bones[bone].head_local.z
    out = {'shorts': (z('LeftUpLeg') - 0.2, z('Spine') + 0.01)}
    if gender == 'f':
        out['top'] = (z('Spine2'), z('Spine2') + 0.18)
    return out


def iris_split(eye, centre, iris_deg=24.0, forward=Vector((0, -1, 0))):
    """
    Give an eyeball its iris: the cap of faces within `iris_deg` of the forward pole takes the iris material (the
    game tints it the hero's eye colour, region 'iris'), the rest stays the white. Each vertex gets iris_r (0 at the
    pole, 1 at the cap's edge) and iris_a (its angle round the pole, 0 to 1) for the bake to draw the iris with.
    """
    me = eye.data
    cos_edge = math.cos(math.radians(iris_deg))
    r = me.attributes.new('iris_r', 'FLOAT', 'POINT')
    a = me.attributes.new('iris_a', 'FLOAT', 'POINT')
    for v in me.vertices:
        d = (v.co - centre).normalized()
        c = max(-1.0, min(1.0, d.dot(forward)))
        r.data[v.index].value = min(1.0, math.degrees(math.acos(c)) / iris_deg)
        a.data[v.index].value = (math.atan2(d.x, d.z) / (2 * math.pi)) % 1.0
    for p in me.polygons:
        d = (p.center - centre).normalized()
        p.material_index = 1 if d.dot(forward) > cos_edge else 0


def triangulate(obj):
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3], quad_method='FIXED', ngon_method='BEAUTY')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def face_basis(out):
    """
    The face basis for the Psyblr Human bodies (public/kit/v2/face-basis.*), as build.face_basis makes the first
    bodies': how each fit group moves every vertex of the reference body, on the head alone, over the full target
    set (face.use_full_candidates), plus each MediaPipe landmark bound to the surface. Same file layout (face-basis.ts).
    """
    import struct

    t0 = time.time()
    F.use_full_candidates()
    spec = heroes.spec(opts.get('base', 'm-medium'))
    head_scale = float(opts.get('head-scale', 1.08))
    plain = build_body(spec, {}, head_scale=head_scale)
    scale = plain.scale
    eyes = B.make_eyes(plain)
    eye_verts = [B.positions(e) for e in eyes]
    base_eyes = BL.eye_frames(plain)
    body_pos = B.positions(plain.mesh)
    p0 = BL.hero_positions(body_pos, base_eyes, eye_verts, base_eyes)
    me = plain.mesh.data
    bvh = BVHTree.FromObject(plain.mesh, bpy.context.evaluated_depsgraph_get())
    marks = []
    for (x, y, z), ok in zip(plain.lm[0], plain.lm[1]):
        if not ok:
            marks.append(None)
            continue
        loc, _n, poly, _d = bvh.find_nearest(Vector((x, y, z)))
        vs = list(me.polygons[poly].vertices)
        best = None
        for k in range(1, len(vs) - 1):
            tri = (vs[0], vs[k], vs[k + 1])
            bc = F.barycentric(np.array(loc), *(np.array(me.vertices[i].co) for i in tri))
            if bc is not None and (best is None or min(bc) > min(best[1])):
                best = (tri, bc)
        marks.append([int(i) for i in best[0]] + [round(float(w), 5) for w in best[1]])
    # the plain body still carries MPFB's prefixed groups (merge_weights renames them only on the body that ships)
    head_w = np.concatenate([np.array(R.group_weight(plain.mesh, R.PREFIX + 'Head')), np.ones(len(p0) - len(body_pos))])[:, None]
    if head_w[: len(body_pos)].max() <= 0:
        raise RuntimeError('no head weights on the plain body')
    groups = F.group_names()
    blobs = []
    for gi, group in enumerate(F.CANDIDATES):
        v = build_body(spec, {name: 1.0 for name in group if F.TargetService.target_full_path(name)}, scale=scale, head_scale=head_scale)
        d = (BL.hero_positions(B.positions(v.mesh), BL.eye_frames(v), eye_verts, base_eyes) - p0) * head_w
        g = np.stack([d[:, 0], d[:, 2], -d[:, 1]], axis=1) * 1e5
        ids = np.nonzero(np.abs(g).max(axis=1) >= 2)[0]
        q = np.clip(np.round(g[ids]), -32767, 32767).astype('<i2')
        blobs.append(struct.pack('<I', len(ids)) + ids.astype('<u2').tobytes() + q.tobytes())
        if gi % 20 == 0:
            log('basis', gi, groups[gi], len(ids), 'vertices', f'max {np.abs(d).max() * 1000:.1f} mm', f'{time.time() - t0:.1f}s')
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    with open(out + '.bin', 'wb') as f:
        f.write(b'PFB1' + struct.pack('<IH', len(p0), len(groups)) + b''.join(blobs))
    with open(out + '.json', 'w') as f:
        json.dump({'version': 1, 'rig': 'standard', 'from': spec['id'], 'vertices': len(p0), 'faceScale': round(scale * head_scale, 6), 'groups': groups, 'landmarks': marks}, f, separators=(',', ':'))
    log('wrote', out + '.bin', os.path.getsize(out + '.bin'), 'bytes', len(groups), 'groups', sum(1 for m in marks if m), 'landmarks', f'{time.time() - t0:.1f}s')


def main():
    t0 = time.time()
    if opts.get('face-basis'):
        return face_basis(opts['face-basis'])
    spec = heroes.spec(opts.get('base', 'm-medium'))
    if opts.get('portrait'):
        spec['portrait'] = opts['portrait']
    size = int(opts.get('size', 2048))
    head_scale = float(opts.get('head-scale', 1.08))
    img_path, lm = BL.portrait_of(spec)
    if img_path is None and spec.get('portrait'):
        # a demo hero's portrait lives with the game (public/kit/faces), its landmarks beside the body portraits
        pid = spec['portrait']
        img = os.path.join(os.path.dirname(BL.PORTRAITS), '..', '..', 'public', 'kit', 'faces', pid + '.webp')
        lmp = os.path.join(BL.PORTRAITS, pid + '.lm.json')
        if os.path.exists(img) and os.path.exists(lmp):
            with open(lmp) as f:
                lm = json.load(f)
            img_path = os.path.normpath(img)
    log('opts', opts, 'portrait', img_path)
    fitted = {}
    # the full target set, so a head can leave the mean (the creator goal); --targets few keeps the first fit's 39
    if opts.get('targets', 'full') == 'full':
        log('fit groups', len(F.use_full_candidates()))
    depth = float(opts.get('depth', 0.5))
    lam = float(opts.get('ridge', 1e-5))

    def extra(human):
        if lm is not None:
            fitted.update(F.fit_face(human, lm, log=log, depth=depth, lam=lam, iters=1500))

    probe = build_body(spec, spec.get('targets', {}), extra=extra, head_scale=head_scale)
    scale = probe.scale
    targets = dict(spec.get('targets', {}), **F.fitted_targets(fitted))
    variants = []
    for name, change in heroes.MORPHS:
        v = build_body(spec, targets, scale=scale, macro=dict(spec['macro'], **change), head_scale=head_scale)
        variants.append((name, B.positions(v.mesh), BL.eye_frames(v)))
    body = build_body(spec, targets, scale=scale, head_scale=head_scale)
    chin = Vector(body.lm[0][152]) if body.lm is not None and body.lm[1][152] else None
    rig = R.build_rig(body, chin)
    R.merge_weights(body.mesh, rig)
    log('body', B.triangles([body.mesh]), 'tris', len(rig.data.bones), 'bones', f'{time.time() - t0:.1f}s')
    body_pos = B.positions(body.mesh)
    body_eyes = BL.eye_frames(body)
    spec = dict(spec, under=under_layer(rig, spec['id'][0]))

    head_frame = None
    face_img = None
    skin_rgb = tuple(spec.get('skin', (0.78, 0.58, 0.46)))
    if img_path and body.lm is not None:
        (el, _), (er, _) = body.eyes
        eyes = (el + er) / 2
        head_frame = F.HeadFrame(eyes.x, eyes.z - 0.03, 0.30, 1024)
        tmp = os.path.join(bpy.app.tempdir or '/tmp', f"face2_{spec['id']}.png")
        skin = F.face_texture(img_path, lm, body.lm, head_frame, tmp, delight=spec.get('delight', 0.5))
        if 'skin' not in spec:
            skin_rgb = tuple(float(x) for x in skin)
        face_img = bpy.data.images.load(tmp)
        face_img.colorspace_settings.name = 'sRGB'
        log('face texture', tmp, 'skin', [round(x, 3) for x in skin_rgb])

    mats = BL.define_materials(spec, skin_rgb)
    me = body.mesh.data
    me.materials.append(mats.mats['skin'])
    me.materials.append(mats.mats['face'])
    head_w = R.group_weight(body.mesh, 'Head')
    for p in me.polygons:
        p.material_index = 1 if all(head_w[v] > 0.5 for v in p.vertices) else 0
    head = H.Head(body, body.mesh, group='Head')
    sockets = R.sockets(rig, head, body.mesh, S.PIECE_HEAD_HALF_WIDTH)
    eyes = B.make_eyes(body)
    mats.get('sclera', paint='sclera', color=(0.94, 0.93, 0.91), region='eye', tint=True)
    mats.get('iris', paint='iris', color=(0.86, 0.86, 0.86), region='iris', tint=True)
    for e, bone, (centre, _r) in zip(eyes, ('LeftEye', 'RightEye'), body.eyes):
        e.data.materials.append(mats.mats['sclera'])
        e.data.materials.append(mats.mats['iris'])
        iris_split(e, centre)
        R.bind_rigid(rig, e, bone)
    # the join keeps only the active mesh's attributes, so the body carries empty ones for the eyes' to land in
    for name in ('iris_r', 'iris_a'):
        body.mesh.data.attributes.new(name, 'FLOAT', 'POINT')
    eye_verts = [B.positions(e) for e in eyes]
    trunk_attributes(body.mesh)
    for e in eyes:
        K.unwrap_part(e)
    bpy.data.objects.remove(body.hires, do_unlink=True)
    hero = K.join([body.mesh] + eyes)
    assert np.abs(B.positions(hero)[: len(body_pos)] - body_pos).max() < 1e-6, 'join reordered the skin'
    face_mats = {i for i, m in enumerate(hero.data.materials) if m.get('paint') in ('face', 'sclera', 'iris')}
    if head_frame:
        K.projection_uvs(hero, head_frame)
        me = hero.data
        atlas_uv = me.uv_layers['atlas']
        island = [p.index for p in me.polygons if p.material_index in face_mats and p.normal.y < -0.3 and me.materials[p.material_index].get('paint') == 'face']
        for i in island:
            for li in me.polygons[i].loop_indices:
                atlas_uv.data[li].uv = head_frame.uv(me.vertices[me.loops[li].vertex_index].co)

    def density(faces):
        idx = [f.material_index for f in faces]
        if sum(1 for i in idx if i in face_mats) > len(idx) * 0.5:
            front = sum(f.normal.y for f in faces) / len(faces) < -0.3
            return spec.get('face_density', 3.4) if front else 1.1
        return 1.0

    K.layout_atlas(hero, density)
    face_meta = F.face_meta(head_frame, body.lm, size) if head_frame and body.lm is not None else None
    out = opts.get('out')
    png = (os.path.splitext(out)[0] + '_atlas.png') if opts.get('keep-atlas') and out else None
    log('laid out', f'{time.time() - t0:.1f}s')
    atlas, normal = K.bake(hero, size, face_img, ao_samples=int(opts.get('ao', 24)), out_png=png, log=log, normal_size=int(opts.get('normal', 1024)))
    K.final_material(hero, atlas, normal)
    for name in ('trunk_low', 'trunk_high', 'iris_r', 'iris_a'):
        hero.data.attributes.remove(hero.data.attributes[name])
    triangulate(hero)
    vid = hero.data.attributes.new('_vid', 'INT', 'POINT')
    vid.data.foreach_set('value', list(range(len(hero.data.vertices))))
    base_all = BL.hero_positions(body_pos, body_eyes, eye_verts, body_eyes)
    BL.add_morphs(hero, base_all, [(name, BL.hero_positions(pos, ey, eye_verts, body_eyes)) for name, pos, ey in variants])
    R.bind(rig, [hero])
    log('baked', f'{time.time() - t0:.1f}s', 'tris', B.triangles([hero]), 'verts', len(hero.data.vertices))
    if out:
        os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
        BL.export(out, size)
        log('wrote', out, os.path.getsize(out), 'bytes', f'{time.time() - t0:.1f}s')
        kit = dict(face_meta or {'version': 1, 'atlas': size, 'landmarks': []})
        kit.update(version=3, rig='standard', sockets=sockets, morphs=[n for n, _ in heroes.MORPHS], faceScale=round(body.scale * head_scale, 6), fit=[round(fitted.get(g, 0.0), 3) for g in F.group_names()], bones=[b.name for b in rig.data.bones], rest={b.name: R.gltf(b.head_local) for b in rig.data.bones})
        with open(os.path.splitext(out)[0] + '.kit.json', 'w') as f:
            json.dump(kit, f, separators=(',', ':'))
        log('kit meta', len(sockets), 'sockets')
    if opts.get('render'):
        render(opts['render'], rig, head, hero)


def render(folder, rig, head, hero):
    """A look at the bare body: face, full figure and the left hand, at rest and with the forearm twisted."""
    os.makedirs(folder, exist_ok=True)
    scene = bpy.context.scene
    BL.preview_engine(scene)
    BL._lights(scene)
    e = head.eyes
    scene.render.resolution_x = scene.render.resolution_y = 900
    shots = [('face', (e.x + 0.18, e.y - 0.62, e.z + 0.02), (e.x, e.y, e.z - 0.04), 70), ('front', (e.x, e.y - 0.9, e.z - 0.03), (e.x, e.y, e.z - 0.03), 85), ('profile', (e.x + 0.9, e.y + 0.02, e.z - 0.03), (e.x, e.y + 0.02, e.z - 0.03), 85), ('full', (1.3, -3.6, 1.15), (0, 0, 0.92), 45)]
    hand = rig.data.bones['LeftHand'].head_local
    shots.append(('hand', (hand.x + 0.35, hand.y - 0.45, hand.z + 0.1), tuple(hand), 70))
    for name, loc, target, lens in shots:
        BL._camera(scene, loc, target, lens)
        scene.render.filepath = os.path.join(folder, f'{name}.png')
        bpy.ops.render.render(write_still=True)
    # the forearm twist: the hand rolled 90 degrees about the forearm with the twist bone taking half of it
    pb = rig.pose.bones
    pb['LeftHand'].rotation_mode = 'XYZ'
    pb['LeftHand'].rotation_euler = (0, math.radians(90), 0)
    pb['LeftForeArmTwist'].rotation_mode = 'XYZ'
    pb['LeftForeArmTwist'].rotation_euler = (0, math.radians(45), 0)
    BL._camera(scene, (hand.x + 0.35, hand.y - 0.45, hand.z + 0.1), tuple(hand), 70)
    scene.render.filepath = os.path.join(folder, 'hand_twisted.png')
    bpy.ops.render.render(write_still=True)


main()
