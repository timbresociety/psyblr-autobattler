"""
Motion clips to GLB for scripts/rpm-anim.ts, which reads them as it reads Ready Player Me's library: one armature,
Mixamo bone names, metres, no scaled nodes (GAME.md §12).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/mixamo.py -- <in dir> <out dir> [--source <id>]

Every clip file under <in dir> (packs unzipped into their own folders) becomes <out dir>/<pack>/<name>.glb. The source
(default mixamo) picks the file format and the bone-name map in src/kit/anim/sources.json: Mixamo FBX (exported
without skin at 30 fps; the `mixamorig:` prefix comes off), a GLB holding many actions (each becomes its own file,
named by its action), or BVH motion capture. The armature's scale and turn are applied to its bones, so the nodes the
exporter writes are unscaled. A file already converted is skipped.
"""

import json
import os
import re
import sys

import bpy
from bpy_extras import anim_utils
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = (os.path.abspath(a) for a in args[:2])
SOURCE = args[args.index('--source') + 1] if '--source' in args else 'mixamo'
# a long take (motion capture runs for minutes) keeps a window: --skip seconds off the start, at most --max seconds
SKIP = float(args[args.index('--skip') + 1]) if '--skip' in args else 0
MAX = float(args[args.index('--max') + 1]) if '--max' in args else 0
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, '..', '..', 'src', 'kit', 'anim', 'sources.json')) as f:
    SPEC = json.load(f)['sources'][SOURCE]
EXTENSIONS = {'fbx': ('.fbx',), 'glb': ('.glb', '.gltf'), 'bvh': ('.bvh',)}[SPEC['format']]


def slug(s):
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    """The file's armature, every other object gone."""
    clear()
    if SPEC['format'] == 'fbx':
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False)
        bpy.context.scene.render.fps = 30
    elif SPEC['format'] == 'glb':
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        bpy.ops.import_anim.bvh(filepath=path, rotate_mode='NATIVE', update_scene_fps=True, update_scene_duration=True)
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(arms) != 1:
        raise RuntimeError(f'{path}: {len(arms)} armatures')
    for o in list(bpy.context.scene.objects):
        if o.type != 'ARMATURE':
            bpy.data.objects.remove(o, do_unlink=True)
    arm = arms[0]
    arm.name = 'Armature'
    return arm


def rename(arm):
    """The source's bones by Mixamo's names: the map's variant whose `when` bone the file has, through temporary names
    so a source that reuses a Mixamo name for another bone (100STYLE's LeftShoulder is the upper arm) can't clash."""
    names = [b.name.split(':')[-1] for b in arm.data.bones]
    for bone, name in zip(arm.data.bones, names):
        bone.name = name
    variant = next((v for v in SPEC['variants'] if 'when' not in v or v['when'] in names), None)
    if variant is None:
        raise RuntimeError(f'no {SOURCE} map fits bones {names[:8]}')
    mapping = variant['map']
    if not mapping:
        return
    for bone in arm.data.bones:
        bone.name = f'__{bone.name}'
    for bone in arm.data.bones:
        old = bone.name[2:]
        bone.name = mapping.get(old, f'src_{old}')


def bake_scale(arm):
    """The object's scale and turn into the rest pose; the pose's location keys stay in the old units, so they take
    the same scale (Blender 5 keeps an action's curves in a channel bag per slot)."""
    scale = arm.scale[0]
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if abs(scale - 1) < 1e-6:
        return
    for action in bpy.data.actions:
        for slot in action.slots:
            bag = anim_utils.action_get_channelbag_for_slot(action, slot)
            if bag is None:
                continue
            for curve in bag.fcurves:
                if curve.data_path.endswith('.location'):
                    for key in curve.keyframe_points:
                        key.co[1] *= scale
                        key.handle_left[1] *= scale
                        key.handle_right[1] *= scale


def hips_on_top(arm):
    """The hips as the bake reads them, the top bone with their rest at standing height, each action keeping the
    motion they had in the armature: a rig whose hips hang under other bones (the UE mannequin travels on `root`)
    loses the bones above, and a rig resting its hips on the floor (motion capture BVH, the height all in the motion)
    has its rest raised to where the hips stand on the action's first frame (CMU's is a T-pose)."""
    hips = arm.pose.bones.get('Hips')
    if hips is None:
        return
    above = []
    bone = hips.parent
    while bone is not None:
        above.append(bone.name)
        bone = bone.parent
    floored = arm.data.bones['Hips'].head_local.length < 1e-4
    if not above and not floored:
        return
    scene = bpy.context.scene
    actions = list(bpy.data.actions)
    use(arm, actions[0])
    scene.frame_set(int(round(actions[0].frame_range[0])))
    lift = Vector((0, 0, hips.matrix.translation.z if floored else 0))
    held = []
    for action in actions:
        use(arm, action)
        start, end = window(action)
        frames = []
        for f in range(start, end + 1):
            scene.frame_set(f)
            frames.append((f, arm.pose.bones['Hips'].matrix.copy()))
        held.append((action, frames))
    bpy.ops.object.mode_set(mode='EDIT')
    bones = arm.data.edit_bones
    bones['Hips'].parent = None
    for name in above:
        bones.remove(bones[name])
    for b in bones:
        b.head += lift
        b.tail += lift
    bpy.ops.object.mode_set(mode='OBJECT')
    hips = arm.pose.bones['Hips']
    hips.rotation_mode = 'QUATERNION'
    for action, frames in held:
        use(arm, action)
        for slot in action.slots:
            bag = anim_utils.action_get_channelbag_for_slot(action, slot)
            for c in [c for c in bag.fcurves if c.data_path.startswith('pose.bones["Hips"]')] if bag else []:
                bag.fcurves.remove(c)
        for f, m in frames:
            scene.frame_set(f)
            hips.matrix = m
            bpy.context.view_layer.update()
            hips.keyframe_insert('location', frame=f)
            hips.keyframe_insert('rotation_quaternion', frame=f)


def window(action):
    """The frames a clip keeps: --skip seconds off its start, at most --max seconds after."""
    scene = bpy.context.scene
    fps = scene.render.fps / scene.render.fps_base
    start, end = (int(round(v)) for v in action.frame_range)
    start = min(end, start + int(round(SKIP * fps)))
    if MAX:
        end = min(end, start + int(round(MAX * fps)))
    return start, end


def use(arm, action):
    arm.animation_data_create()
    arm.animation_data.action = action
    if arm.animation_data.action_slot is None and action.slots:
        arm.animation_data.action_slot = action.slots[0]


def export(arm, action, out):
    use(arm, action)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = window(action)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', export_animations=True, export_skins=False, export_morph=False,
        export_force_sampling=True, export_frame_range=True, export_anim_single_armature=True, export_yup=True,
        use_selection=False, export_def_bones=False, export_optimize_animation_size=False,
        export_animation_mode='ACTIVE_ACTIONS',
    )


def convert(path, out):
    """One clip file to one GLB, or, for a GLB of many actions, one GLB per action beside `out`. Returns the count."""
    arm = load(path)
    rename(arm)
    bake_scale(arm)
    hips_on_top(arm)
    actions = list(bpy.data.actions)
    if not actions:
        raise RuntimeError(f'{path}: no action')
    if len(actions) == 1:
        export(arm, actions[0], out)
        return 1
    folder = os.path.splitext(out)[0]
    for action in actions:
        target = os.path.join(folder, slug(action.name) + '.glb')
        if not os.path.exists(target):
            export(arm, action, target)
    return len(actions)


done = failed = 0
for root, _, files in os.walk(SRC):
    for name in sorted(files):
        if not name.lower().endswith(EXTENSIONS):
            continue
        rel = os.path.relpath(os.path.join(root, name), SRC)
        out = os.path.join(OUT, os.path.splitext(rel)[0].replace(' ', '_').replace('(', '').replace(')', '') + '.glb')
        if os.path.exists(out) or os.path.isdir(os.path.splitext(out)[0]):
            continue
        try:
            done += convert(os.path.join(root, name), out)
        except Exception as e:  # keep going; report at the end
            failed += 1
            print(f'FAILED {rel}: {e}')
print(f'converted {done}, failed {failed}')
