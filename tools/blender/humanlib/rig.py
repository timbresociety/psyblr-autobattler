"""
The game rig: the arena's 20 bones (the names the clips and the game use) placed on MPFB's fitted joints, with
MakeHuman's skin weights merged onto them (fingers into the hand, the ball of the foot into the foot).

The clips were first authored for a T-posed mannequin (arms straight out, legs straight down). MakeHuman stands in an
A-pose with soft elbows and a wider stance, which deforms far better in the arms-down poses a fighter lives in. So the
limbs keep their real rest pose and each limb bone remembers the rotation C from its T-pose direction to its rest
direction; a clip's rotation q for bone b becomes C_parent * q * C_b^-1 (see clips.py), which lands every limb exactly
where the T-pose numbers meant it to. The spine, neck and head keep MakeHuman's natural posture as their reference.
"""

import bpy
from mathutils import Matrix, Quaternion, Vector

# our bone -> (head joint, tail joint, parent); joints are (MPFB bone, 'head' | 'tail')
BONES = {
    'hips': (('pelvis', 'head'), ('spine_01', 'head'), None),
    'spine': (('spine_01', 'head'), ('spine_02', 'head'), 'hips'),
    'chest': (('spine_02', 'head'), ('spine_03', 'head'), 'spine'),
    'upper_chest': (('spine_03', 'head'), ('neck_01', 'head'), 'chest'),
    'neck': (('neck_01', 'head'), ('head', 'head'), 'upper_chest'),
    'head': (('head', 'head'), ('head', 'tail'), 'neck'),
}
for side, s in (('L', 'l'), ('R', 'r')):
    BONES.update(
        {
            f'clavicle_{side}': ((f'clavicle_{s}', 'head'), (f'clavicle_{s}', 'tail'), 'upper_chest'),
            f'upper_arm_{side}': ((f'upperarm_{s}', 'head'), (f'lowerarm_{s}', 'head'), f'clavicle_{side}'),
            f'forearm_{side}': ((f'lowerarm_{s}', 'head'), (f'hand_{s}', 'head'), f'upper_arm_{side}'),
            f'hand_{side}': ((f'hand_{s}', 'head'), (f'middle_01_{s}', 'head'), f'forearm_{side}'),
            f'thigh_{side}': ((f'thigh_{s}', 'head'), (f'calf_{s}', 'head'), 'hips'),
            f'shin_{side}': ((f'calf_{s}', 'head'), (f'foot_{s}', 'head'), f'thigh_{side}'),
            f'foot_{side}': ((f'foot_{s}', 'head'), (f'ball_{s}', 'tail'), f'shin_{side}'),
        }
    )

# T-pose directions of the limb bones on the mannequin the clips were authored for (left side; x mirrors for right)
T_DIR = {
    'upper_arm': Vector((0.27, 0.005, 0.0)),
    'forearm': Vector((0.25, 0.0, 0.0)),
    'hand': Vector((0.11, -0.01, 0.0)),
    'thigh': Vector((0.008, -0.01, -0.43)),
    'shin': Vector((0.004, 0.02, -0.42)),
    'foot': Vector((0.006, -0.18, -0.06)),
}


def ours(mpfb_bone):
    """Which game bone an MPFB game_engine bone's weights belong to."""
    b = mpfb_bone.lower()
    side = 'L' if b.endswith('_l') else 'R' if b.endswith('_r') else ''
    stem = b[:-2] if side else b
    if stem in ('root', 'pelvis'):
        return 'hips'
    direct = {'spine_01': 'spine', 'spine_02': 'chest', 'spine_03': 'upper_chest', 'neck_01': 'neck', 'head': 'head'}
    if stem in direct:
        return direct[stem]
    limb = {'clavicle': 'clavicle', 'upperarm': 'upper_arm', 'lowerarm': 'forearm', 'hand': 'hand', 'thigh': 'thigh', 'calf': 'shin', 'foot': 'foot', 'ball': 'foot'}
    if stem in limb and side:
        return f'{limb[stem]}_{side}'
    if side and stem.split('_')[0] in ('thumb', 'index', 'middle', 'ring', 'pinky'):
        return f'hand_{side}'
    if 'breast' in stem:
        return 'upper_chest'
    return None


def roll0_frame(direction):
    """The 3x3 frame Blender gives a bone pointing along `direction` with roll 0 (built on a scratch armature)."""
    arm = bpy.data.armatures.new('_frame')
    obj = bpy.data.objects.new('_frame', arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones.new('b')
    eb.head = Vector((0, 0, 0))
    eb.tail = direction.normalized()
    eb.roll = 0
    bpy.ops.object.mode_set(mode='OBJECT')
    m = arm.bones['b'].matrix_local.to_3x3()
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.armatures.remove(arm)
    return m


def build_rig(body):
    """The armature, with each limb's T-pose correction stored as a custom property ('tcorr', a quaternion)."""
    corr = {}
    frames = {}
    for name, (h, t, _parent) in BONES.items():
        head = body.joint(*h)
        tail = body.joint(*t)
        stem, _, side = name.rpartition('_')
        if stem in T_DIR:
            tdir = T_DIR[stem].copy()
            if side == 'R':
                tdir.x = -tdir.x
            c = tdir.normalized().rotation_difference((tail - head).normalized())
            corr[name] = c
            frames[name] = c.to_matrix() @ roll0_frame(tdir)
    arm_data = bpy.data.armatures.new('rig')
    rig = bpy.data.objects.new('rig', arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    for o in bpy.context.selected_objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (h, t, parent) in BONES.items():
        eb = arm_data.edit_bones.new(name)
        head = body.joint(*h)
        tail = body.joint(*t)
        # a bone needs its length before a matrix can orient it (a zero-length bone ignores the direction)
        eb.head = head
        eb.tail = tail
        eb.roll = 0
        if name in frames:
            eb.matrix = Matrix.Translation(head) @ frames[name].to_4x4()
            eb.length = (tail - head).length
        if parent:
            eb.parent = arm_data.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for name, c in corr.items():
        rig.data.bones[name]['tcorr'] = list(c)
    return rig


def correction(rig, bone_name):
    b = rig.data.bones.get(bone_name)
    if b is None or 'tcorr' not in b:
        return Quaternion()
    return Quaternion(b['tcorr'])


def merge_weights(obj, max_influences=4):
    """Rename and merge MPFB groups onto the game bones, keep the four strongest per vertex, normalised."""
    names = {g.index: g.name for g in obj.vertex_groups}
    per_vertex = []
    for v in obj.data.vertices:
        acc = {}
        for x in v.groups:
            target = ours(names[x.group])
            if target and x.weight > 0:
                acc[target] = acc.get(target, 0.0) + x.weight
        best = sorted(acc.items(), key=lambda kv: -kv[1])[:max_influences]
        total = sum(w for _, w in best)
        per_vertex.append([(b, w / total) for b, w in best if total > 0])
    # drop MPFB's bone groups (other groups, such as regions, stay), then write ours
    for g in list(obj.vertex_groups):
        if ours(g.name) is not None or g.name.startswith(('joint-', 'helper-')):
            obj.vertex_groups.remove(g)
    groups = {}
    for bone in BONES:
        groups[bone] = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
    for i, ws in enumerate(per_vertex):
        for b, w in ws:
            groups[b].add([i], w, 'REPLACE')


def bind(rig, objs):
    for o in objs:
        o.parent = rig
        o.matrix_parent_inverse = Matrix()
        mod = o.modifiers.new('rig', 'ARMATURE')
        mod.object = rig


def bind_rigid(rig, obj, bone):
    """Weight a whole part (hair, a hat, glasses) to one bone."""
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    g = obj.vertex_groups.new(name=bone)
    g.add(range(len(obj.data.vertices)), 1.0, 'REPLACE')
    bind(rig, [obj])
