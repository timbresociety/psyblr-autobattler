"""
Mixamo clips (FBX, exported without skin at 30 fps) to GLB for scripts/rpm-anim.ts, which reads them as it reads
Ready Player Me's library: one armature, Mixamo bone names, metres, no scaled nodes.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/mixamo.py -- <in dir> <out dir>

Every .fbx under <in dir> (packs unzipped into their own folders) becomes <out dir>/<pack>/<name>.glb. The
`mixamorig:` prefix comes off the bone names, and the armature's centimetre scale and Z-up turn are applied to its
bones, so the nodes the exporter writes are unscaled. A file already converted is skipped.
"""

import os
import sys

import bpy
from bpy_extras import anim_utils

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = (os.path.abspath(a) for a in args[:2])


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def convert(path, out):
    clear()
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False)
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if len(arms) != 1:
        raise RuntimeError(f'{path}: {len(arms)} armatures')
    arm = arms[0]
    arm.name = 'Armature'
    for bone in arm.data.bones:
        bone.name = bone.name.split(':')[-1]
    # fcurves follow bone renames; bake the object's scale and turn into the rest pose. The pose's location keys stay
    # in the old units, so they take the same scale
    scale = arm.scale[0]
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    action = arm.animation_data.action if arm.animation_data else None
    if action is None:
        raise RuntimeError(f'{path}: no action')
    # Blender 5 keeps an action's curves in a channel bag per slot
    for curve in anim_utils.action_get_channelbag_for_slot(action, arm.animation_data.action_slot).fcurves:
        if curve.data_path.endswith('.location'):
            for key in curve.keyframe_points:
                key.co[1] *= scale
                key.handle_left[1] *= scale
                key.handle_right[1] *= scale
    start, end = (int(round(v)) for v in action.frame_range)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = start, end
    bpy.context.scene.render.fps = 30
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', export_animations=True, export_skins=False, export_morph=False,
        export_force_sampling=True, export_frame_range=True, export_anim_single_armature=True, export_yup=True,
        use_selection=False, export_def_bones=False, export_optimize_animation_size=False,
    )


done = failed = 0
for root, _, files in os.walk(SRC):
    for name in sorted(files):
        if not name.lower().endswith('.fbx'):
            continue
        rel = os.path.relpath(os.path.join(root, name), SRC)
        out = os.path.join(OUT, os.path.splitext(rel)[0].replace(' ', '_').replace('(', '').replace(')', '') + '.glb')
        if os.path.exists(out):
            continue
        try:
            convert(os.path.join(root, name), out)
            done += 1
        except Exception as e:  # keep going; report at the end
            failed += 1
            print(f'FAILED {rel}: {e}')
print(f'converted {done}, failed {failed}')
