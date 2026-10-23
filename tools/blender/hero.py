"""
Stylised hero bodies for the arena (R24): sculpted, rigged and animated in Blender by script, exported as GLB.

Run:  Blender -b --python tools/blender/hero.py -- --body athletic --out public/heroes/athletic.glb [--sheet folder]

Each body is one skinned mesh in named material slots (skin, suit, trim, pants, glove, boot, hair, metal, eye, iris,
brow) so the game recolours it per hero, plus optional parts (hair styles, helmet, pauldrons, cape) as separate
meshes the game shows or hides. Every body shares one skeleton and one set of animation clips, kept under the arena's
8k-triangle budget. Pure procedural: no downloaded assets.
"""

import math
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

# ---------------------------------------------------------------------------------------------- arguments

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
opts = {'body': 'athletic', 'out': '', 'render': '', 'budget': '7600'}
for i in range(0, len(argv) - 1, 2):
    opts[argv[i].lstrip('-')] = argv[i + 1]

# ---------------------------------------------------------------------------------------------- body specs

# Joints of a T-posed body in metres (x right, -y forward, z up) and skin radii (side, depth). Body types scale them.
BODIES = {
    # athletic: broad chest, narrow waist, slightly oversized hands and feet (the Overwatch read)
    'athletic': dict(height=1.0, chest=1.0, waist=1.0, hips=1.0, arm=1.0, leg=1.0, head=1.0),
    # lithe: narrower shoulders and waist, fuller hips, a touch shorter
    'lithe': dict(height=0.95, chest=0.82, waist=0.82, hips=1.08, arm=0.85, leg=0.95, head=0.98),
    # heavy: tank build, huge torso and arms, shorter legs
    'heavy': dict(height=1.04, chest=1.35, waist=1.25, hips=1.15, arm=1.4, leg=1.15, head=0.95),
    # lean: assassin build, wiry and long-legged
    'lean': dict(height=1.02, chest=0.86, waist=0.82, hips=0.9, arm=0.85, leg=0.9, head=0.97),
}
B = BODIES[opts['body']]
H = B['height']


def j(x, y, z):
    return Vector((x, y, z * H))


JOINTS = {
    'hips': (j(0, 0, 0.98), (0.15 * B['hips'], 0.11 * B['hips'])),
    'spine': (j(0, 0.005, 1.12), (0.125 * B['waist'], 0.095 * B['waist'])),
    'chest': (j(0, 0, 1.29), (0.165 * B['chest'], 0.115 * B['chest'])),
    'upper': (j(0, 0.005, 1.42), (0.19 * B['chest'], 0.105 * B['chest'])),
    'neck': (j(0, 0.01, 1.53), (0.058 * B['chest'] ** 0.5, 0.058 * B['chest'] ** 0.5)),
}
for side, s in (('L', 1), ('R', -1)):
    shoulder_x = 0.175 * B['chest']
    JOINTS.update(
        {
            f'shoulder_{side}': (j(s * shoulder_x, 0.005, 1.445), (0.098 * B['arm'], 0.096 * B['arm'])),
            f'elbow_{side}': (j(s * (shoulder_x + 0.27), 0.01, 1.445), (0.064 * B['arm'], 0.064 * B['arm'])),
            f'wrist_{side}': (j(s * (shoulder_x + 0.52), 0.01, 1.445), (0.052 * B['arm'], 0.045 * B['arm'])),
            f'hand_{side}': (j(s * (shoulder_x + 0.63), 0.0, 1.445), (0.062 * B['arm'] ** 0.6, 0.03 * B['arm'] ** 0.6)),
            f'thumb_{side}': (j(s * (shoulder_x + 0.58), -0.06, 1.445), (0.026 * B['arm'] ** 0.6, 0.024 * B['arm'] ** 0.6)),
            f'hip_{side}': (j(s * 0.1 * B['hips'], 0, 0.95), (0.108 * B['leg'], 0.11 * B['leg'])),
            f'knee_{side}': (j(s * 0.108 * B['hips'], -0.01, 0.52), (0.07 * B['leg'], 0.074 * B['leg'])),
            f'ankle_{side}': (j(s * 0.112 * B['hips'], 0.01, 0.1), (0.06 * B['leg'], 0.062 * B['leg'])),
            f'toe_{side}': (j(s * 0.118 * B['hips'], -0.17, 0.04), (0.06 * B['leg'], 0.042 * B['leg'])),
        }
    )
EDGES = [('hips', 'spine'), ('spine', 'chest'), ('chest', 'upper'), ('upper', 'neck')]
for side in 'LR':
    EDGES += [
        ('upper', f'shoulder_{side}'),
        (f'shoulder_{side}', f'elbow_{side}'),
        (f'elbow_{side}', f'wrist_{side}'),
        (f'wrist_{side}', f'hand_{side}'),
        (f'wrist_{side}', f'thumb_{side}'),
        ('hips', f'hip_{side}'),
        (f'hip_{side}', f'knee_{side}'),
        (f'knee_{side}', f'ankle_{side}'),
        (f'ankle_{side}', f'toe_{side}'),
    ]

# Bones: name -> (head joint/point, tail joint/point, parent). Names avoid dots so three.js keeps them intact.
HEAD_TOP = j(0, 0, 1.86)
BONES = {
    'hips': ('hips', 'spine', None),
    'spine': ('spine', 'chest', 'hips'),
    'chest': ('chest', 'upper', 'spine'),
    'upper_chest': ('upper', 'neck', 'chest'),
    'neck': ('neck', j(0, 0.01, 1.6), 'upper_chest'),
    'head': (j(0, 0.01, 1.6), HEAD_TOP, 'neck'),
}
for side in 'LR':
    BONES.update(
        {
            f'clavicle_{side}': ('upper', f'shoulder_{side}', 'upper_chest'),
            f'upper_arm_{side}': (f'shoulder_{side}', f'elbow_{side}', f'clavicle_{side}'),
            f'forearm_{side}': (f'elbow_{side}', f'wrist_{side}', f'upper_arm_{side}'),
            f'hand_{side}': (f'wrist_{side}', f'hand_{side}', f'forearm_{side}'),
            f'thigh_{side}': (f'hip_{side}', f'knee_{side}', 'hips'),
            f'shin_{side}': (f'knee_{side}', f'ankle_{side}', f'thigh_{side}'),
            f'foot_{side}': (f'ankle_{side}', f'toe_{side}', f'shin_{side}'),
        }
    )


def point(p):
    return JOINTS[p][0].copy() if isinstance(p, str) else p.copy()


# ---------------------------------------------------------------------------------------------- scene helpers


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, rough=0.6, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emit
    return m


# Base colours only: the game recolours suit, trim, pants, hair per hero (R24).
MATS = {}


def mats():
    MATS.update(
        skin=material('skin', (0.80, 0.56, 0.42), 0.55),
        suit=material('suit', (0.10, 0.32, 0.80), 0.45),
        trim=material('trim', (0.95, 0.78, 0.30), 0.35, 0.6),
        pants=material('pants', (0.10, 0.11, 0.16), 0.6),
        glove=material('glove', (0.92, 0.92, 0.95), 0.5),
        boot=material('boot', (0.12, 0.10, 0.10), 0.5),
        hair=material('hair', (0.10, 0.07, 0.06), 0.45),
        metal=material('metal', (0.80, 0.62, 0.32), 0.3, 0.9),
        eye=material('eye', (0.96, 0.96, 0.96), 0.2),
        iris=material('iris', (0.08, 0.20, 0.40), 0.15),
        brow=material('brow', (0.08, 0.05, 0.04), 0.6),
        cape=material('cape', (0.65, 0.08, 0.08), 0.7),
    )


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def assign_material(obj, mat_name):
    obj.data.materials.clear()
    obj.data.materials.append(MATS[mat_name])


def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def shade_smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


# ---------------------------------------------------------------------------------------------- body


def build_body():
    names = list(JOINTS)
    me = bpy.data.meshes.new('body')
    me.from_pydata([JOINTS[n][0] for n in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
    obj = link(bpy.data.objects.new('body', me))
    skin = obj.modifiers.new('skin', 'SKIN')
    skin.use_smooth_shade = True
    skin.branch_smoothing = 0.6
    layer = me.skin_vertices[0].data
    for i, n in enumerate(names):
        layer[i].radius = JOINTS[n][1]
        layer[i].use_root = n == 'hips'
    sub = obj.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2
    apply_all(obj)
    shade_smooth(obj)
    # material regions by where each face sits on the body
    order = ['skin', 'suit', 'trim', 'pants', 'glove', 'boot']
    for n in order:
        obj.data.materials.append(MATS[n])
    shoulder_x = 0.175 * B['chest']
    for p in obj.data.polygons:
        c = p.center
        ax = abs(c.x)
        if c.z > 1.505 * H:
            region = 'skin'  # neck
        elif ax > shoulder_x + 0.52:
            region = 'glove'  # hands
        elif ax > shoulder_x + 0.3 and c.z > 1.3 * H:
            region = 'glove' if opts['body'] == 'heavy' else 'skin'  # forearms: bare, or gauntlets on a heavy build
        elif c.z < 0.42 * H:
            region = 'boot'
        elif c.z < 1.0 * H and ax < 0.3:
            region = 'pants'
        else:
            region = 'suit'
        p.material_index = order.index(region)
    return obj


def uv_sphere(name, radius, scale, at, segments=24, rings=14, mat='skin'):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])) + at
    obj = mesh_object(name, bm)
    shade_smooth(obj)
    assign_material(obj, mat)
    return obj


def build_head():
    head_c = j(0, 0.0, 1.68)
    parts = []
    hs = B['head']
    head = uv_sphere('head', 0.118 * hs, (0.9, 0.98, 1.08), head_c, 28, 18)
    # a soft jaw and chin pulled forward and down
    bm = bmesh.new()
    bm.from_mesh(head.data)
    for v in bm.verts:
        local = v.co - head_c
        if local.z < -0.02 * hs:
            t = min(1, (-local.z - 0.02 * hs) / (0.1 * hs))
            v.co.x *= 1 - 0.18 * t
            v.co.y -= 0.012 * t * (1 if local.y < 0 else 0)
    bm.to_mesh(head.data)
    bm.free()
    parts.append(head)
    # nose and ears
    nose = uv_sphere('nose', 0.02 * hs, (0.8, 1.0, 1.25), head_c + Vector((0, -0.112 * hs, -0.005 * hs)), 10, 8)
    parts.append(nose)
    for s in (1, -1):
        parts.append(uv_sphere('ear', 0.026 * hs, (0.45, 0.8, 1.15), head_c + Vector((s * 0.104 * hs, 0.005, 0.0)), 10, 8))
    # big readable cartoon eyes: white, iris, a dark pupil, and a brow above
    for s in (1, -1):
        eye_c = head_c + Vector((s * 0.042 * hs, -0.098 * hs, 0.018 * hs))
        parts.append(uv_sphere('eye', 0.032 * hs, (0.95, 0.5, 1.2), eye_c, 14, 10, 'eye'))
        parts.append(uv_sphere('iris', 0.019 * hs, (0.95, 0.38, 1.15), eye_c + Vector((s * -0.004, -0.014 * hs, -0.003)), 12, 8, 'iris'))
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.046 * hs, v.co.y * 0.012, v.co.z * 0.011)) + eye_c + Vector((s * 0.002, -0.006, 0.037 * hs))
        brow = mesh_object('brow', bm)
        brow.rotation_euler = (0, s * -0.18, 0)
        assign_material(brow, 'brow')
        parts.append(brow)
    # a small mouth: a soft dark line under the nose
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.034 * hs, v.co.y * 0.008, v.co.z * 0.0065)) + head_c + Vector((0, -0.108 * hs, -0.048 * hs))
    mouth = mesh_object('mouth', bm)
    assign_material(mouth, 'brow')
    parts.append(mouth)
    return parts


def hair_style(style):
    """Separate hair or helmet meshes the game can switch per hero."""
    head_c = j(0, 0.0, 1.68)
    hs = B['head']
    out = []
    if style == 'crop':
        cap = uv_sphere('hair_crop', 0.126 * hs, (0.93, 1.02, 1.0), head_c + Vector((0, 0.008, 0.012)), 24, 12, 'hair')
        trim_below(cap, head_c.z - 0.005, front_cut=head_c.z + 0.035)
        out.append(cap)
    elif style == 'spiky':
        cap = uv_sphere('hair_spiky', 0.124 * hs, (0.93, 1.02, 1.0), head_c + Vector((0, 0.01, 0.012)), 20, 10, 'hair')
        trim_below(cap, head_c.z, front_cut=head_c.z + 0.04)
        bm = bmesh.new()
        bm.from_mesh(cap.data)
        # anime spikes swept up and back
        # anime spikes: big ones swept up and back off the crown, smaller ones fanning out at the sides and front
        spikes = [(0.0, 0.03, 1.0, 0.2), (0.35, 0.02, 0.9, 0.17), (-0.35, 0.02, 0.9, 0.17), (0.6, 0.05, 0.75, 0.15), (-0.6, 0.05, 0.75, 0.15), (0.2, 0.08, 0.95, 0.18), (-0.2, 0.08, 0.95, 0.18), (0.0, 0.1, 0.85, 0.16), (0.85, 0.06, 0.6, 0.12), (-0.85, 0.06, 0.6, 0.12), (0.15, -0.06, 0.7, 0.12), (-0.25, -0.05, 0.7, 0.11)]
        for sx, sy, up, length in spikes:
            tilt = Vector((sx * 0.9, 0.55 + sy * 3, up)).normalized()
            base = head_c + Vector((sx * 0.08, sy + 0.01, 0.075)) * hs
            ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.05 * hs, radius2=0.0, depth=length * hs)
            rot = tilt.to_track_quat('Z', 'Y').to_matrix().to_4x4()
            bmesh.ops.transform(bm, matrix=Matrix.Translation(base + tilt * 0.06 * hs) @ rot, verts=ret['verts'])
        bm.to_mesh(cap.data)
        bm.free()
        shade_smooth(cap)
        out.append(cap)
    elif style == 'long':
        cap = uv_sphere('hair_long', 0.127 * hs, (0.95, 1.03, 1.02), head_c + Vector((0, 0.01, 0.01)), 24, 12, 'hair')
        trim_below(cap, head_c.z - 0.02, front_cut=head_c.z + 0.03)
        out.append(cap)
        back = uv_sphere('hair_long_back', 0.11 * hs, (1.05, 0.55, 1.9), head_c + Vector((0, 0.07, -0.12)), 16, 10, 'hair')
        out.append(back)
    elif style == 'helmet':
        # a Roman galea: bronze dome, cheek guards and a crest
        dome = uv_sphere('helmet', 0.132 * hs, (0.95, 1.04, 1.0), head_c + Vector((0, 0.005, 0.015)), 24, 12, 'metal')
        trim_below(dome, head_c.z - 0.01, front_cut=head_c.z + 0.025)
        out.append(dome)
        crest = uv_sphere('helmet_crest', 0.1 * hs, (0.18, 1.35, 0.55), head_c + Vector((0, 0.02, 0.14 * hs)), 16, 8, 'cape')
        out.append(crest)
        for s in (1, -1):
            out.append(uv_sphere('helmet_cheek', 0.045 * hs, (0.3, 0.9, 1.2), head_c + Vector((s * 0.105 * hs, -0.03, -0.035)), 10, 8, 'metal'))
    return out


def trim_below(obj, z, front_cut=None):
    """Remove the faces of a cap below `z` (and, at the front, below `front_cut`, so the face stays clear)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    dead = [f for f in bm.faces if f.calc_center_median().z < z or (front_cut is not None and f.calc_center_median().y < -0.04 and f.calc_center_median().z < front_cut)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    shade_smooth(obj)


def armour():
    out = []
    shoulder_x = 0.175 * B['chest']
    for s in (1, -1):
        # a Roman lorica pauldron: three overlapping shallow plates, each a little smaller and further down the arm,
        # flat enough to read as plate rather than a ball on the shoulder
        for k in range(3):
            r = 0.095 * B['arm'] * (1 - 0.1 * k)
            pad = uv_sphere('pauldron', r, (1.15, 1.05, 0.4), j(s * (shoulder_x + 0.045 + 0.04 * k), 0.005, 1.49 - 0.04 * k), 18, 8, 'metal' if k == 0 else 'trim')
            trim_below(pad, (1.475 - 0.04 * k) * H)
            out.append(pad)
    # a belt and a chest emblem: small details that read at arena distance
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=0.158 * B['hips'], radius2=0.15 * B['hips'], depth=0.07)
    for v in bm.verts:
        v.co = Vector((v.co.x, v.co.y * 0.78, v.co.z)) + j(0, 0, 1.02)
    belt = mesh_object('belt', bm)
    shade_smooth(belt)
    assign_material(belt, 'boot')
    out.append(belt)
    out.append(uv_sphere('emblem', 0.045 * B['chest'], (1, 0.25, 1), j(0, -0.118 * B['chest'], 1.36), 14, 8, 'trim'))
    return out


def cape():
    bm = bmesh.new()
    # a cloth panel from the shoulders down the back, slightly curved and flared
    rows, cols = 8, 6
    shoulder_x = 0.175 * B['chest']
    verts = []
    for r in range(rows + 1):
        t = r / rows
        width = (shoulder_x + 0.04) * (1 + 0.5 * t)
        z = (1.48 - 0.95 * t) * H
        row = []
        for c in range(cols + 1):
            u = c / cols * 2 - 1
            y = 0.13 * B['chest'] + 0.05 * t + 0.03 * (1 - u * u)
            row.append(bm.verts.new((u * width, y, z)))
        verts.append(row)
    for r in range(rows):
        for c in range(cols):
            bm.faces.new((verts[r][c], verts[r][c + 1], verts[r + 1][c + 1], verts[r + 1][c]))
    obj = mesh_object('cape', bm)
    solid = obj.modifiers.new('thick', 'SOLIDIFY')
    solid.thickness = 0.012
    apply_all(obj)
    shade_smooth(obj)
    assign_material(obj, 'cape')
    return obj


# ---------------------------------------------------------------------------------------------- rig


def build_rig():
    arm_data = bpy.data.armatures.new('rig')
    rig = link(bpy.data.objects.new('rig', arm_data))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (head, tail, parent) in BONES.items():
        b = arm_data.edit_bones.new(name)
        b.head = point(head)
        b.tail = point(tail)
        # arms and legs roll so their local X points forward-ish; keeps keyframed rotations predictable
        b.roll = 0
        if parent:
            b.parent = arm_data.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def skin_to(rig, objs, bone_for=None):
    """Bind meshes: automatic weights for the body, a single bone for rigid parts (hair, armour, eyes)."""
    for o in objs:
        if bone_for and bone_for(o):
            bone = bone_for(o)
            g = o.vertex_groups.new(name=bone)
            g.add(range(len(o.data.vertices)), 1.0, 'REPLACE')
            mod = o.modifiers.new('rig', 'ARMATURE')
            mod.object = rig
            o.parent = rig
        else:
            for x in bpy.context.selected_objects:
                x.select_set(False)
            o.select_set(True)
            rig.select_set(True)
            bpy.context.view_layer.objects.active = rig
            bpy.ops.object.parent_set(type='ARMATURE_AUTO')


# ---------------------------------------------------------------------------------------------- animation

# Poses: bone -> (x, y, z) degrees, applied in armature space about the bone's head (converted to bone space below),
# in the order y, then x, then z. The character faces -y; its left is +x.
#   x (pitch): positive bends forward - spine and head bow, a leg or a lowered arm swings back, a shin bends the knee.
#   y (side):  for arms, positive lowers the arm toward the body (both sides, mirrored below); for the trunk, a side bend.
#   z (yaw):   turn about the vertical.
# Right-side bones are authored like the left and mirrored here, so one set of numbers means the same on both sides:
#   arms (rest pointing out sideways): y lowers toward the body, then x swings forward (-) or back (+), then z sweeps
#   the arm outward (+) or across the body (-); a forearm's z bends the elbow forward (-).
#   legs: x swings forward (-) or back (+); y splays the leg outward (-); a shin's x bends the knee (+).
MIRROR = {'clavicle_R', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_R', 'shin_R', 'foot_R'}


def merged(*poses):
    out = {}
    for p in poses:
        for k, v in p.items():
            base = out.get(k, (0, 0, 0))
            out[k] = (base[0] + v[0], base[1] + v[1], base[2] + v[2])
    return out


def over(base, *poses):
    """`base` with each later pose's bones replacing it outright: for absolute poses, where adding would double up."""
    out = dict(base)
    for p in poses:
        out.update(p)
    return out


def arm_space_to_local(pb, deg):
    x, y, z = deg
    if pb.name in MIRROR:
        y, z = -y, -z
    q = Euler((math.radians(x), math.radians(y), math.radians(z)), 'YXZ').to_quaternion()
    rest = pb.bone.matrix_local.to_quaternion()
    return rest.inverted() @ q @ rest


def key_pose(rig, action, frame, pose, root_z=0.0, root_y=0.0):
    for pb in rig.pose.bones:
        deg = pose.get(pb.name, (0, 0, 0))
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = arm_space_to_local(pb, deg)
        pb.keyframe_insert('rotation_quaternion', frame=frame, group=pb.name)
    hips = rig.pose.bones['hips']
    hips.location = rest_offset(hips, Vector((0, root_y, root_z)))
    hips.keyframe_insert('location', frame=frame, group='hips')


def rest_offset(pb, v):
    return pb.bone.matrix_local.to_3x3().inverted() @ v


def make_action(rig, name, keys, fps=30, loop=True):
    """keys: list of (time_seconds, pose_dict, root_z, root_y)."""
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    for t, pose, rz, ry in keys:
        key_pose(rig, act, round(t * fps) + 1, pose, rz, ry)
    # smooth, slightly eased interpolation reads as weight; loops get cyclic extrapolation
    for fc in act_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.easing = 'AUTO'
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, act)
    strip.action_frame_end = round(keys[-1][0] * fps) + 1
    rig.animation_data.action = None
    act.use_fake_user = True
    return act


def act_fcurves(act):
    # Blender 4.4+ layered actions keep curves in channelbags; older ones on the action
    if hasattr(act, 'fcurves') and len(act.fcurves):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def both(arm=None, forearm=None, thigh=None, shin=None, foot=None, hand=None):
    """The same values on both sides (mirroring makes them symmetric)."""
    out = {}
    for name, v in (('upper_arm', arm), ('forearm', forearm), ('thigh', thigh), ('shin', shin), ('foot', foot), ('hand', hand)):
        if v is not None:
            out[f'{name}_L'] = v
            out[f'{name}_R'] = v
    return out


def animations(rig):
    # a relaxed guard: arms down with a soft forward bend at the elbow, feet a little apart
    down = merged(both(arm=(0, 72, 0), forearm=(0, 0, -18), thigh=(0, -4, 0)), {})

    # idle: breathing, a slow weight shift and a little arm drift
    idle_a = merged(down, {'chest': (-2, 0, 0), 'upper_chest': (-1.5, 0, 0), 'head': (2, 0, 0), 'hips': (0, 2, 0), 'spine': (0, -2, 0)})
    idle_b = merged(down, both(arm=(4, -3, 0)), {'chest': (1.5, 0, 0), 'upper_chest': (1, 0, 0), 'head': (-1, 0, 0), 'hips': (0, -2, 0), 'spine': (0, 2, 0)})
    make_action(rig, 'idle', [(0, idle_a, 0, 0), (1.3, idle_b, -0.012, 0), (2.6, idle_a, 0, 0)])

    # run: contact and passing poses, arms counter-swinging with bent elbows, shoulders twisting against the hips
    def contact(s):
        lead, trail = ('L', 'R') if s > 0 else ('R', 'L')
        return merged(
            down,
            both(forearm=(0, 0, -70)),
            {
                f'thigh_{lead}': (-42, -4, 0),
                f'shin_{lead}': (12, 0, 0),
                f'foot_{lead}': (-12, 0, 0),
                f'thigh_{trail}': (32, -4, 0),
                f'shin_{trail}': (75, 0, 0),
                f'foot_{trail}': (25, 0, 0),
                f'upper_arm_{lead}': (38, 0, 0),
                f'upper_arm_{trail}': (-45, 0, 0),
                'hips': (0, 0, 7 * s),
                'spine': (10, 0, -4 * s),
                'chest': (4, 0, -10 * s),
                'head': (-8, 0, 7 * s),
            },
        )

    def passing(s):
        lead, trail = ('L', 'R') if s > 0 else ('R', 'L')
        return merged(
            down,
            both(forearm=(0, 0, -70)),
            {
                f'thigh_{lead}': (2, -4, 0),
                f'shin_{lead}': (14, 0, 0),
                f'thigh_{trail}': (-22, -4, 0),
                f'shin_{trail}': (100, 0, 0),
                f'foot_{trail}': (20, 0, 0),
                f'upper_arm_{lead}': (8, 0, 0),
                f'upper_arm_{trail}': (-12, 0, 0),
                'spine': (10, 0, 0),
                'chest': (4, 0, 0),
                'head': (-8, 0, 0),
            },
        )

    make_action(rig, 'run', [(0, contact(1), -0.045, 0), (0.17, passing(1), 0.035, 0), (0.34, contact(-1), -0.045, 0), (0.51, passing(-1), 0.035, 0), (0.68, contact(1), -0.045, 0)])

    # fly: the Superman pose - body flat out, one fist leading, the other arm swept back, legs trailing, a slow bob
    fly_a = merged(
        both(thigh=(6, -2, 0), shin=(28, 0, 0), foot=(40, 0, 0)),
        {
            'hips': (78, 0, 0),
            'spine': (-8, 0, 0),
            'chest': (-4, 0, 0),
            'neck': (-20, 0, 0),
            'head': (-35, 0, 0),
            'upper_arm_R': (0, -88, 0),
            'forearm_R': (0, 0, -6),
            'upper_arm_L': (25, 80, 0),
            'forearm_L': (0, 0, -25),
        },
    )
    fly_b = merged(fly_a, {'spine': (2, 2, 0), 'thigh_L': (8, 0, 0), 'thigh_R': (-6, 0, 0), 'upper_arm_L': (-5, 0, 0)})
    make_action(rig, 'fly', [(0, fly_a, 0.25, 0), (0.9, fly_b, 0.31, 0), (1.8, fly_a, 0.25, 0)])

    # hover: upright in the air, knees drawn up a little, arms loose and out, bobbing
    hover_a = merged(both(arm=(-10, 52, 0), forearm=(0, 0, -30), thigh=(-25, -6, 0), shin=(45, 0, 0), foot=(25, 0, 0)), {'spine': (4, 0, 0)})
    hover_b = merged(hover_a, both(arm=(0, 6, 0), thigh=(5, 0, 0), shin=(-8, 0, 0)), {'spine': (-2, 0, 0), 'head': (3, 0, 0)})
    make_action(rig, 'hover', [(0, hover_a, 0.0, 0), (0.8, hover_b, 0.07, 0), (1.6, hover_a, 0.0, 0)])

    # slash: wind up over the right shoulder, a fast diagonal cut across, follow through, recover (fits the 0.45 s cast)
    guard_l = {'upper_arm_L': (-30, 50, 0), 'forearm_L': (0, 0, -95)}
    wind = over(down, guard_l, {'upper_arm_R': (20, -45, 0), 'forearm_R': (0, 0, -105), 'spine': (0, 0, -22), 'chest': (0, 0, -18), 'thigh_L': (-28, -6, 0), 'shin_L': (28, 0, 0), 'thigh_R': (18, -6, 0), 'shin_R': (18, 0, 0)})
    strike = over(down, guard_l, {'upper_arm_R': (-70, 40, -45), 'forearm_R': (0, 0, -15), 'spine': (8, 0, 28), 'chest': (4, 0, 22), 'thigh_L': (-38, -6, 0), 'shin_L': (34, 0, 0), 'thigh_R': (22, -6, 0), 'shin_R': (16, 0, 0)})
    follow = over(down, guard_l, {'upper_arm_R': (-40, 72, -75), 'forearm_R': (0, 0, -22), 'spine': (6, 0, 38), 'chest': (4, 0, 28), 'thigh_L': (-34, -6, 0), 'shin_L': (32, 0, 0), 'thigh_R': (20, -6, 0), 'shin_R': (16, 0, 0)})
    make_action(rig, 'slash', [(0, down, 0, 0), (0.1, wind, -0.03, 0.02), (0.2, strike, -0.07, -0.12), (0.32, follow, -0.06, -0.14), (0.5, down, 0, 0)], loop=False)

    # shoot: arm snaps up to aim straight ahead, the shot kicks it up, it settles, then drops back to guard
    aim = over(down, {'upper_arm_R': (-90, 90, 0), 'forearm_R': (0, 0, 0), 'upper_arm_L': (-35, 62, 0), 'forearm_L': (0, 0, -95), 'chest': (0, 0, -10), 'head': (0, 0, 10)})
    recoil = merged(aim, {'upper_arm_R': (-16, 0, 0), 'forearm_R': (0, 0, -18), 'spine': (-4, 0, 0)})
    make_action(rig, 'shoot', [(0, down, 0, 0), (0.08, aim, 0, 0), (0.15, recoil, 0, 0.025), (0.28, aim, 0, 0), (0.45, down, 0, 0)], loop=False)

    # cast: gather energy at the hip with both hands, then thrust both palms forward - the energy-blast pose
    stance = {'thigh_L': (-22, -12, 0), 'shin_L': (26, 0, 0), 'thigh_R': (16, -12, 0), 'shin_R': (16, 0, 0)}
    gather = merged(stance, {'upper_arm_L': (10, 72, -40), 'forearm_L': (0, 0, -110), 'upper_arm_R': (25, 75, 12), 'forearm_R': (0, 0, -100), 'spine': (4, 0, -28), 'chest': (0, 0, -10)})
    thrust = merged(stance, {'upper_arm_L': (-88, 88, -10), 'forearm_L': (0, 0, -4), 'upper_arm_R': (-88, 88, -10), 'forearm_R': (0, 0, -4), 'spine': (8, 0, 4), 'chest': (6, 0, 0)})
    make_action(rig, 'cast', [(0, down, 0, 0), (0.15, gather, -0.06, 0.03), (0.28, thrust, -0.08, -0.07), (0.45, thrust, -0.08, -0.07), (0.6, down, 0, 0)], loop=False)

    # ultimate: drop into a crouch with arms crossed, then explode upward, arms flung wide, head thrown back
    crouch = merged(both(arm=(-20, 55, -35), forearm=(0, 0, -120), thigh=(-72, -14, 0), shin=(115, 0, 0), foot=(-35, 0, 0)), {'spine': (28, 0, 0), 'chest': (8, 0, 0), 'head': (-10, 0, 0)})
    burst = merged(both(arm=(-5, -38, 18), forearm=(0, 0, -6), thigh=(-4, -14, 0), shin=(6, 0, 0)), {'spine': (-16, 0, 0), 'chest': (-10, 0, 0), 'head': (-28, 0, 0)})
    make_action(rig, 'ultimate', [(0, down, 0, 0), (0.25, crouch, -0.3, 0), (0.45, burst, 0.12, 0), (0.85, burst, 0.1, 0), (1.1, down, 0, 0)], loop=False)

    # hurt: snapped back by the hit, arms up to guard, then recover
    flinch = over(down, both(arm=(-25, 55, 0), forearm=(0, 0, -75)), {'spine': (-15, 0, 8), 'chest': (-10, 0, 0), 'head': (-20, 0, 12)})
    make_action(rig, 'hurt', [(0, down, 0, 0), (0.06, flinch, 0, 0.07), (0.3, down, 0, 0)], loop=False)

    # stunned: a dazed sway, knees soft, head lolling side to side
    daze_a = merged(down, both(arm=(8, 6, 0), thigh=(-10, 0, 0), shin=(20, 0, 0)), {'spine': (8, 6, 0), 'head': (18, 12, 0)})
    daze_b = merged(down, both(arm=(-8, 6, 0), thigh=(-10, 0, 0), shin=(20, 0, 0)), {'spine': (8, -6, 0), 'head': (18, -12, 0)})
    make_action(rig, 'stunned', [(0, daze_a, -0.04, 0), (0.6, daze_b, -0.04, 0), (1.2, daze_a, -0.04, 0)])

    # fall: buckled by the blow, then down flat on the back, arms flung out
    buckle = over(down, both(arm=(-40, 30, 0), forearm=(0, 0, -40)), {'spine': (-22, 0, 8), 'head': (-25, 0, 0), 'thigh_L': (-30, 0, 0), 'shin_L': (60, 0, 0)})
    flat = merged(both(arm=(0, 15, 10), forearm=(0, 0, -20)), {'hips': (-90, 0, 0), 'spine': (-4, 0, 0), 'head': (-12, 0, 22), 'thigh_L': (8, -10, 0), 'thigh_R': (22, -8, 0), 'shin_R': (32, 0, 0)})
    make_action(rig, 'fall', [(0, down, 0, 0), (0.2, buckle, -0.1, 0.1), (0.55, flat, -0.86, 0.6), (1.2, flat, -0.86, 0.6)], loop=False)


# ---------------------------------------------------------------------------------------------- build


def triangles(objs):
    total = 0
    for o in objs:
        for p in o.data.polygons:
            total += len(p.vertices) - 2
    return total


def decimate_to(obj, target):
    tris = triangles([obj])
    if tris <= target:
        return
    mod = obj.modifiers.new('dec', 'DECIMATE')
    mod.ratio = target / tris
    apply_all(obj)


def build():
    reset()
    mats()
    body = build_body()
    head_parts = build_head()
    hair = {s: hair_style(s) for s in ('crop', 'spiky', 'long', 'helmet')}
    gear = armour()
    cloak = cape()
    budget = int(opts['budget'])
    # the body takes what the always-on parts leave of the budget (one hair style shows at a time)
    fixed = triangles(head_parts + gear + [cloak]) + max(triangles(v) for v in hair.values())
    decimate_to(body, budget - fixed)
    rig = build_rig()
    # body gets automatic weights; head, face, hair and armour ride one bone each
    head_bone = lambda o: 'head' if o.name.startswith(('head', 'nose', 'ear', 'eye', 'iris', 'brow', 'mouth', 'hair', 'helmet')) else None

    def bone_for(o):
        if head_bone(o):
            return 'head'
        if o.name.startswith('pauldron'):
            return 'upper_arm_L' if o.location.x + o.data.vertices[0].co.x > 0 else 'upper_arm_R'
        if o.name.startswith(('belt',)):
            return 'hips'
        if o.name.startswith(('emblem', 'cape')):
            return 'upper_chest'
        return None

    skin_to(rig, [body], None)
    for o in head_parts + [x for v in hair.values() for x in v] + gear + [cloak]:
        skin_to(rig, [o], bone_for)
    # tag optional parts so the game can switch them
    for style, objs in hair.items():
        for o in objs:
            o['part'] = f'hair:{style}'
    for o in gear:
        o['part'] = 'armour' if o.name.startswith(('pauldron', 'emblem')) else 'base'
    cloak['part'] = 'cape'
    tris = triangles([body] + head_parts + gear + [cloak]) + max(triangles(v) for v in hair.values())
    hero = join_parts(body, head_parts + [x for v in hair.values() for x in v] + gear + [cloak])
    animations(rig)
    print('TRIANGLES', tris)
    return rig, hero


# Regions and parts travel to the game in one UV channel, so the whole hero is one mesh and one draw call:
# u = region (which colour the game paints it), v = part (which switchable piece it belongs to).
REGIONS = ['skin', 'suit', 'trim', 'pants', 'glove', 'boot', 'hair', 'metal', 'eye', 'iris', 'brow', 'cape']
PARTS = ['base', 'hair:crop', 'hair:spiky', 'hair:long', 'hair:helmet', 'armour', 'cape']


def join_parts(body, parts):
    for o in [body] + parts:
        me = o.data
        uv = me.uv_layers.new(name='meta')
        col = me.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
        part = PARTS.index(o.get('part', 'base'))
        for poly in me.polygons:
            mat = o.material_slots[poly.material_index].material if o.material_slots else None
            region = REGIONS.index(mat.name.split('.')[0]) if mat and mat.name.split('.')[0] in REGIONS else 1
            base = mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value if mat else (1, 1, 1, 1)
            for li in poly.loop_indices:
                uv.data[li].uv = (region + 0.5, part + 0.5)
                col.data[li].color = base
    for x in bpy.context.selected_objects:
        x.select_set(False)
    for o in [body] + parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    hero = bpy.context.view_layer.objects.active
    hero.name = 'hero'
    # one material: the colours ride on the vertices and the game repaints them per hero
    hero.data.materials.clear()
    m = bpy.data.materials.new('hero')
    m.use_nodes = True
    nodes = m.node_tree.nodes
    attr = nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Color'
    m.node_tree.links.new(attr.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
    nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.55
    hero.data.materials.append(m)
    for poly in hero.data.polygons:
        poly.material_index = 0
    return hero


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_skins=True,
        export_extras=True,
        export_apply=False,
        export_yup=True,
        export_vertex_color='ACTIVE',
        export_meshopt_compression_enable=True,
    )


def render(path, action_name=None, frame=1):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new('cam')
    cam = link(bpy.data.objects.new('cam', cam_data))
    cam.location = (1.6, -3.2, 1.35)
    cam.rotation_euler = (math.radians(86), 0, math.radians(27))
    cam_data.lens = 50
    scene.camera = cam
    sun = link(bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.3, 0.45, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.world = world
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.filepath = path
    scene.render.engine = 'BLENDER_EEVEE'
    rig = bpy.data.objects['rig']
    if action_name:
        rig.animation_data.action = bpy.data.actions[action_name]
        for t in rig.animation_data.nla_tracks:
            t.mute = True
    scene.frame_set(frame)
    # show one hair style
    for o in bpy.data.objects:
        part = o.get('part', '')
        if part.startswith('hair:'):
            o.hide_render = part != f"hair:{opts.get('hair', 'spiky')}"
    bpy.ops.render.render(write_still=True)


SHEET = [('idle', 0), ('idle', 1.3), ('run', 0), ('run', 0.17), ('run', 0.34), ('fly', 0.4), ('hover', 0.4), ('slash', 0.1), ('slash', 0.2), ('slash', 0.32), ('shoot', 0.1), ('cast', 0.15), ('cast', 0.3), ('ultimate', 0.25), ('ultimate', 0.5), ('hurt', 0.06), ('stunned', 0.3), ('fall', 0.2), ('fall', 0.9)]


def sheet(folder):
    """Render every clip at a few key moments, three-quarter view, into `folder` as numbered PNGs."""
    render_setup()
    scene = bpy.context.scene
    scene.render.resolution_x = 360
    scene.render.resolution_y = 420
    rig = bpy.data.objects['rig']
    for t in rig.animation_data.nla_tracks:
        t.mute = True
    for i, (name, t) in enumerate(SHEET):
        rig.animation_data.action = bpy.data.actions[name]
        scene.frame_set(round(t * 30) + 1)
        scene.render.filepath = f'{folder}/{i:02d}_{name}_{t}.png'
        bpy.ops.render.render(write_still=True)


def render_setup():
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new('cam')
    cam = link(bpy.data.objects.new('cam', cam_data))
    if opts.get('view') == 'side':
        cam.location = (4.2, 0, 1.15)
        cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    else:
        cam.location = (1.9, -3.3, 1.3)
        cam.rotation_euler = (math.radians(88), 0, math.radians(30))
    cam_data.lens = 50
    scene.camera = cam
    sun = link(bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.3, 0.45, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.world = world
    scene.render.engine = 'BLENDER_EEVEE'
    for o in bpy.data.objects:
        part = o.get('part', '')
        if part.startswith('hair:'):
            o.hide_render = part != f"hair:{opts.get('hair', 'spiky')}"


if __name__ == '__main__':
    rig, body = build()
    if opts['out']:
        export(opts['out'])
    if opts['render']:
        render(opts['render'], opts.get('action') or None, int(opts.get('frame', 1)))
    if opts.get('sheet'):
        sheet(opts['sheet'])
