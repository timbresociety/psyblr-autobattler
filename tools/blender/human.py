"""
The arena's characters (R24): a MakeHuman (MPFB) body per hero, rigged and animated for the game, dressed, given hair
and a face from a generated portrait, baked into one textured mesh and exported as a GLB.

    Blender -b --python tools/blender/human.py -- --hero huang --out public/heroes/huang.glb [--sheet dir] [--render png]
    Blender -b --python tools/blender/human.py -- --base m-medium --out public/heroes/m-medium.glb   (writes m-medium.kit.json too)
    Blender -b --python tools/blender/human.py -- --face-basis public/kit/face-basis   (the face basis, .bin and .json)

Every body shares one surface. The proxy faces it refines and the faces of its photo island are stored in
humanlib/topology.json, written once from the reference body:

    Blender -b --python tools/blender/human.py -- --base m-medium --write-topology --out public/heroes/m-medium.glb

One-time landmark binding (ties MediaPipe's face landmarks to the MakeHuman mesh; writes humanlib/face_bind.json):

    Blender -b --python tools/blender/human.py -- --bind-render /tmp/bind.png
    uv run --python 3.12 --with mediapipe==0.10.14 --with numpy --with pillow python tools/textures/landmarks.py /tmp/bind.png /tmp/bind.lm.json
    Blender -b --python tools/blender/human.py -- --bind-finish /tmp/bind.png

Needs the MPFB extension and its makehuman_system_assets pack (for the proxy topology) installed in this Blender.
"""

import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from humanlib import body as B  # noqa: E402
from humanlib import face as F  # noqa: E402

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


def bind_render(path):
    """The neutral MakeHuman face, front-on and orthographic, lit plainly so MediaPipe finds every landmark."""
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    B.clear_scene()
    human = HumanService.create_human(macro_detail_dict=TargetService.get_default_macro_info_dict())
    frame = F.bind_frame(human)

    def mat(name, col, rough=0.6):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*col, 1)
        b.inputs['Roughness'].default_value = rough
        return m

    me = human.data
    for m in (mat('skin', (0.62, 0.42, 0.32)), mat('lips', (0.45, 0.18, 0.16)), mat('eye', (0.02, 0.015, 0.01), 0.2)):
        me.materials.append(m)
    lips = F.group_members(human, ['lips'])
    eyes = F.group_members(human, ['helper-l-eye', 'helper-r-eye'])
    for p in me.polygons:
        if all(v in lips for v in p.vertices):
            p.material_index = 1
        elif all(v in eyes for v in p.vertices):
            p.material_index = 2
    show = human.vertex_groups.new(name='show')
    show.add(sorted(F.group_members(human, ['body', 'helper-l-eye', 'helper-r-eye'])), 1.0, 'REPLACE')
    human.modifiers['Hide helpers'].vertex_group = 'show'
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    cam = B.link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = frame['size']
    cam.location = (frame['cx'], -2.0, frame['cz'])
    cam.rotation_euler = (math.radians(90), 0, 0)
    sun = B.link(bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')))
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(70), 0, math.radians(10))
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.5, 0.5, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    scene.world = w
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    with open(path + '.frame.json', 'w') as f:
        json.dump(frame, f)


def bind_finish(path):
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    B.clear_scene()
    human = HumanService.create_human(macro_detail_dict=TargetService.get_default_macro_info_dict())
    with open(path + '.frame.json') as f:
        frame = json.load(f)
    base = os.path.splitext(path)[0]
    with open(base + '.lm.json') as f:
        lm = json.load(f)
    bind = F.bind_landmarks(human, frame, lm)
    with open(F.BIND_FILE, 'w') as f:
        json.dump(bind, f, separators=(',', ':'))
    print('bound', sum(1 for b in bind if b), 'of', len(bind), 'landmarks ->', F.BIND_FILE)


if __name__ == '__main__':
    if 'bind-render' in opts:
        bind_render(opts['bind-render'])
    elif 'bind-finish' in opts:
        bind_finish(opts['bind-finish'])
    else:
        from humanlib import build

        build.main(opts)
