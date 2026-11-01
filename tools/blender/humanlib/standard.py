"""
The Psyblr Human rig (src/kit/rig/standard.json; docs/plans/2026-10-31-canon-psyblr-human.md, phase 1): MakeHuman's
Mixamo rig, with MakeHuman's own skin weights, renamed to the contract and completed with a twist bone on every limb
segment, finger tips, a jaw, two eye bones and end bones. Built on MakeHuman's full body mesh, not the game proxy.

Twist bones sit halfway along their segment, oriented like it, and take the segment's weights toward its far end, so
when the runtime turns a twist bone part way toward the roll of the bone it follows (the hand for the forearm), the
skin twists smoothly along the limb instead of candy-wrapping at the joint.
"""

import json
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'src', 'kit', 'rig', 'standard.json'))
PREFIX = 'mixamorig:'

# how far along its segment (0 head, 1 tail) a twist bone's weight ramps in and reaches the segment's full weight
TWIST_RAMP = (0.3, 0.95)


def contract():
    with open(CONTRACT) as f:
        return json.load(f)


def strip(name):
    return name[len(PREFIX) :] if name.startswith(PREFIX) else name


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def build_rig(body, chin=None):
    """
    The armature on a body made with MPFB's 'mixamo' rig (body.joints and body.axes carry its bones, prefixed). `chin`
    is where the jaw bone points (a landmark), else a guess below the head.
    """
    spec = contract()
    joints = {strip(k): v for k, v in body.joints.items()}
    axes = {strip(k): v for k, v in body.axes.items()}
    arm_data = bpy.data.armatures.new('rig')
    rig = bpy.data.objects.new('rig', arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    for o in bpy.context.selected_objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones
    (el, rl), (er, rr) = body.eyes
    placed = {}
    for b in spec['bones']:
        name, parent, kind = b['name'], b['parent'], b['kind']
        if name in joints:
            head, tail = joints[name]
            z = axes[name]
        elif kind == 'twist':
            ph, pt = placed[parent]
            head = ph.lerp(pt, 0.5)
            tail = pt.copy()
            z = axes.get(parent, Vector((0, 0, 1)))
        elif kind == 'end':
            ph, pt = placed[parent]
            head = pt.copy()
            tail = pt + (pt - ph).normalized() * 0.02
            z = axes.get(parent, Vector((0, 0, 1)))
        elif name in ('LeftEye', 'RightEye'):
            c, r = (el, rl) if name == 'LeftEye' else (er, rr)
            head = c.copy()
            tail = c + Vector((0, -2 * r, 0))
            z = Vector((0, 0, 1))
        elif name == 'Jaw':
            hh, ht = placed['Head']
            head = Vector((0, hh.y + 0.035, hh.z + 0.02))
            tail = chin.copy() if chin is not None else head + Vector((0, -0.09, -0.07))
            z = Vector((0, 0, 1))
        else:
            raise KeyError(f'the contract bone {name} is not in the MPFB rig and has no rule here')
        e = eb.new(name)
        e.head = head
        e.tail = tail
        e.align_roll(z)
        e.use_connect = False
        if parent:
            e.parent = eb[parent]
        placed[name] = (head.copy(), tail.copy())
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def merge_weights(obj, rig, max_influences=4):
    """
    MPFB's prefixed groups become the contract's bones, every other group goes, twist bones take their share along
    each segment, and each vertex keeps its four strongest weights, normalised.
    """
    spec = contract()
    names = {g.index: g.name for g in obj.vertex_groups}
    twists = {b['parent']: b['name'] for b in spec['bones'] if b['kind'] == 'twist'}
    seg = {}
    for parent in twists:
        h, t = rig.data.bones[parent].head_local, rig.data.bones[parent].tail_local
        seg[parent] = (h.copy(), (t - h), (t - h).length_squared)
    per_vertex = []
    for v in obj.data.vertices:
        acc = {}
        for x in v.groups:
            n = names[x.group]
            if n.startswith(PREFIX) and x.weight > 0:
                acc[strip(n)] = acc.get(strip(n), 0.0) + x.weight
        for parent, twist in twists.items():
            w = acc.get(parent)
            if not w:
                continue
            h, d, l2 = seg[parent]
            along = (v.co - h).dot(d) / l2
            share = smoothstep(TWIST_RAMP[0], TWIST_RAMP[1], along)
            if share > 0:
                acc[twist] = w * share
                acc[parent] = w * (1 - share)
        best = sorted(acc.items(), key=lambda kv: -kv[1])[:max_influences]
        total = sum(w for _, w in best)
        per_vertex.append([(b, w / total) for b, w in best if total > 0])
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups = {}
    for b in spec['bones']:
        groups[b['name']] = obj.vertex_groups.new(name=b['name'])
    for i, ws in enumerate(per_vertex):
        for b, w in ws:
            groups[b].add([i], w, 'REPLACE')


def bind(rig, objs):
    from mathutils import Matrix

    for o in objs:
        o.parent = rig
        o.matrix_parent_inverse = Matrix()
        mod = o.modifiers.new('rig', 'ARMATURE')
        mod.object = rig


def bind_rigid(rig, obj, bone):
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    g = obj.vertex_groups.new(name=bone)
    g.add(range(len(obj.data.vertices)), 1.0, 'REPLACE')
    bind(rig, [obj])


def group_weight(obj, name):
    out = [0.0] * len(obj.data.vertices)
    g = obj.vertex_groups.get(name)
    if not g:
        return out
    for v in obj.data.vertices:
        for x in v.groups:
            if x.group == g.index:
                out[v.index] = x.weight
    return out


def gltf(v):
    """Blender (z up, facing -y) to glTF (y up, facing +z)."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def sockets(rig, head, mesh, piece_head_half_width):
    """Where gear hangs (src/arena/client/gear.ts), on the contract's bones. Hand pieces grip between thumb and palm."""
    scale = round(head.half_width / piece_head_half_width, 4)
    hat_z = head.hairline(Vector((0, head.front, head.eyes.z)), 0.0) + 0.005
    # the lenses sit a centimetre in front of the corneas, and just clear of the bridge of the nose at eye height (not
    # the nose's tip, which put them out at the end of a long nose, two centimetres off the eyes)
    bridge = [v.co.y for v in mesh.data.vertices if abs(v.co.x) < 0.008 and abs(v.co.z - head.eyes.z) < 0.012]
    bridge_y = min(bridge) if bridge else head.front
    lens_y = min(head.eye_l.y - head.eye_r_radius - 0.010, bridge_y - 0.004)
    out = {
        'head': {'bone': 'Head', 'pos': gltf(Vector((0, head.centre.y + 0.008, hat_z))), 'scale': scale},
        'face': {'bone': 'Head', 'pos': gltf(Vector((0, lens_y, (head.eye_l.z + head.eye_r.z) / 2))), 'scale': scale},
    }
    chest = rig.data.bones['Spine2'].head_local
    behind = [v.co for v in mesh.data.vertices if abs(v.co.x) < 0.06 and abs(v.co.z - chest.z) < 0.03 and v.co.y > chest.y]
    back_y = max((p.y for p in behind), default=chest.y + 0.1)
    out['back'] = {'bone': 'Spine2', 'pos': gltf(Vector((0, back_y + 0.012, chest.z)))}
    for side, slot in (('Left', 'hand_l'), ('Right', 'hand_r')):
        hand = rig.data.bones[f'{side}Hand']
        h, t = hand.head_local, hand.tail_local
        fingers = (t - h).normalized()
        # the thumb's own direction, base to tip (its base sits by the wrist, so the base alone says nothing)
        th = rig.data.bones[f'{side}HandThumb3'].tail_local - rig.data.bones[f'{side}HandThumb1'].head_local
        th = (th - fingers * th.dot(fingers)).normalized()
        back_of_hand = th.cross(fingers) if side == 'Left' else fingers.cross(th)
        grip = h.lerp(t, 0.55) - back_of_hand.normalized() * 0.02
        out[slot] = {'bone': hand.name, 'pos': gltf(grip), 'up': gltf(th), 'fwd': gltf(fingers)}
    return out
