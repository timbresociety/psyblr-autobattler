"""
The toy-scale casino's look test (docs/plans/2026-11-04-feel-and-toy-casino.md): one corner of a real casino and
pachinko parlour at 1:15, so a 1.8 m hero is a 12 cm action figure. It has a roulette table's rail and wheel, chip
stacks as stairs, a ball tray full of pachinko balls, a stool, a stepladder, a row of pachinko machines, slot machines
behind, cards, a promo die and cardboard boxes. Pastel colours on real materials, in daylight from high windows and
fluorescent panels. Rendered from a hero's shoulder and from above, for the owner to judge before the map is rebuilt.

    Blender -b --python tools/blender/toy-look.py -- [--out .scratch/toy] [--samples 96] [--size 1600x900]

Everything is built in game metres (real size x 15), Blender z-up.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

S = 15  # 1:15
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    o = {'out': os.path.join(ROOT, '.scratch', 'toy'), 'samples': '96', 'size': '1600x900'}
    for i in range(0, len(argv), 2):
        o[argv[i].lstrip('-')] = argv[i + 1]
    w, h = o['size'].split('x')
    return o['out'], int(o['samples']), int(w), int(h)


def lin(hexstr):
    h = PASTEL.get(hexstr, hexstr).lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c) + (1.0,)


# the §1 palette in its pastel range, with the real materials' own colours
PASTEL = {
    'cream': '#F3ECDF', 'blush': '#F2B8B5', 'rose': '#E99A9A', 'mint': '#A9D8C5', 'felt': '#8CC5A8', 'powder': '#A9C7E8',
    'butter': '#F4DC8E', 'lavender': '#C9B8E6', 'peach': '#F6C6A0', 'graphite': '#6B7480', 'wood': '#B97A56',
    'kraft': '#C9A27A', 'tile': '#EEE6DA', 'grout': '#D4CABC', 'hazard': '#F1C84B', 'ink': '#3E4450',
}


def material(name, color, rough=0.45, metal=0.0, coat=0.0, emit=None, emit_strength=0.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(PASTEL.get(color, color))
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
    if emit:
        b.inputs['Emission Color'].default_value = lin(PASTEL.get(emit, emit))
        b.inputs['Emission Strength'].default_value = emit_strength
    return m


MATS = {}


def wood(name, light='#C98E62', dark='#9A5E3C'):
    # lacquered wood: long grain bands stretched along x, a little noise through them, under a clear coat
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (0.05, 1.0, 1.0)
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.6
    noise.inputs['Detail'].default_value = 6
    nt.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    # fine grain lines running along the boards (x), one board's figure swaying gently through them
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 3.0
    wave.inputs['Distortion'].default_value = 1.5
    wave.inputs['Detail'].default_value = 3
    nt.links.new(mapping.outputs['Vector'], wave.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = lin(dark)
    ramp.color_ramp.elements[1].color = lin(light)
    mix = nt.nodes.new('ShaderNodeMath')
    mix.operation = 'MULTIPLY'
    nt.links.new(wave.outputs['Fac'], mix.inputs[0])
    nt.links.new(noise.outputs['Fac'], mix.inputs[1])
    nt.links.new(mix.outputs[0], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.35
    b.inputs['Coat Weight'].default_value = 0.9
    b.inputs['Coat Roughness'].default_value = 0.06
    return m


def mat(key):
    if key == 'wood' and key not in MATS:
        MATS[key] = wood('wood')
    if key not in MATS:
        spec = {
            'tile': ('tile', 0.35, 0, 0.3), 'felt': ('felt', 0.95, 0, 0), 'wood': ('wood', 0.25, 0, 0.8), 'brass': ('#E2C27A', 0.22, 1, 0),
            'chrome': ('#E8ECF0', 0.08, 1, 0), 'alu': ('#C9CED4', 0.3, 1, 0), 'kraft': ('kraft', 0.8, 0, 0), 'tape': ('#E8D9B8', 0.4, 0, 0),
            'cushion': ('rose', 0.55, 0, 0.2), 'tray': ('blush', 0.35, 0, 0.4), 'steel': ('#D9DDE2', 0.12, 1, 0), 'cream': ('cream', 0.35, 0, 0.5),
            'powder': ('powder', 0.35, 0, 0.5), 'lavender': ('lavender', 0.35, 0, 0.5), 'mint': ('mint', 0.35, 0, 0.5), 'butter': ('butter', 0.35, 0, 0.5),
            'peach': ('peach', 0.35, 0, 0.5), 'ink': ('ink', 0.4, 0, 0.2), 'hazard': ('hazard', 0.5, 0, 0), 'card': ('#FBF8F2', 0.3, 0, 0.3),
            'cardback': ('powder', 0.3, 0, 0.3), 'die': ('blush', 0.15, 0, 0.6), 'wall': ('cream', 0.7, 0, 0),
        }.get(key, (key, 0.35, 0, 0.5))
        MATS[key] = material(key, spec[0], spec[1], spec[2], spec[3])
    return MATS[key]


def glow(name, color, strength):
    return material(name, color, 0.3, 0, 0, emit=color, emit_strength=strength)


def glass():
    m = material('glass', '#FFFFFF', 0.02, 0, 0, transmission=1.0)
    m.node_tree.nodes['Principled BSDF'].inputs['IOR'].default_value = 1.45
    return m


def bevel(obj, width, segments=3):
    md = obj.modifiers.new('bevel', 'BEVEL')
    md.width = width
    md.segments = segments
    md.limit_method = 'ANGLE'
    return obj


def put(obj, m):
    obj.data.materials.append(m)
    return obj


def box(name, size, at, m, bev=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    put(o, m)
    if bev:
        bevel(o, bev)
    return o


def cyl(name, r, h, at, m, verts=48, bev=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=at, rotation=rot)
    o = bpy.context.object
    o.name = name
    put(o, m)
    if bev:
        bevel(o, bev)
    bpy.ops.object.shade_smooth()
    return o


def torus(name, R, r, at, m):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=at, major_segments=64, minor_segments=16)
    o = bpy.context.object
    o.name = name
    put(o, m)
    bpy.ops.object.shade_smooth()
    return o


def sphere(name, r, at, m, sub=3):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=sub, location=at)
    o = bpy.context.object
    o.name = name
    put(o, m)
    bpy.ops.object.shade_smooth()
    return o


def array(o, count, offset, axis_count2=None, offset2=None):
    md = o.modifiers.new('array', 'ARRAY')
    md.count = count
    md.use_relative_offset = False
    md.use_constant_offset = True
    md.constant_offset_displace = offset
    if axis_count2:
        m2 = o.modifiers.new('array2', 'ARRAY')
        m2.count = axis_count2
        m2.use_relative_offset = False
        m2.use_constant_offset = True
        m2.constant_offset_displace = offset2
    return o


# --- the pieces, real size x S -----------------------------------------------------------------------------------


def floor():
    # 30 cm porcelain tiles with grout, and a strip of hazard tape
    m = bpy.data.materials.new('tiles')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexBrick')
    tex.offset = 0
    tex.inputs['Color1'].default_value = lin(PASTEL['tile'])
    tex.inputs['Color2'].default_value = lin('#F6F0E6')
    tex.inputs['Mortar'].default_value = lin(PASTEL['grout'])
    tex.inputs['Scale'].default_value = 1.0
    tex.inputs['Mortar Size'].default_value = 0.012
    tex.inputs['Brick Width'].default_value = 0.30 * S
    tex.inputs['Row Height'].default_value = 0.30 * S
    coord = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(coord.outputs['Object'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.16
    b.inputs['Coat Weight'].default_value = 0.6
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
    f = bpy.context.object
    f.scale = (12 * S, 12 * S, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    put(f, m)
    for k in range(8):
        box(f'hazard{k}', (0.05 * S, 0.012 * S, 0.0004 * S), (-0.9 * S + k * 0.1 * S, 0.55 * S, 0.003), mat('hazard' if k % 2 == 0 else 'ink'))


def roulette(x, y):
    # a table 2.4 x 1.2 m, top at 0.75 m: wooden apron and padded rail, mint felt, the wheel's dish at one end
    top = 0.75 * S
    L, W = 2.4 * S, 1.2 * S
    box('table_body', (L, W, top - 0.06 * S), (x, y, (top - 0.06 * S) / 2), mat('wood'), bev=0.3)
    box('table_felt', (L - 0.16 * S, W - 0.16 * S, 0.02 * S), (x, y, top - 0.02 * S), mat('felt'), bev=0.05)
    # the padded rail round the edge
    for (sx, sy, dx, dy) in [(L, 0.09 * S, 0, (W - 0.09 * S) / 2), (L, 0.09 * S, 0, -(W - 0.09 * S) / 2), (0.09 * S, W, (L - 0.09 * S) / 2, 0), (0.09 * S, W, -(L - 0.09 * S) / 2, 0)]:
        box('rail', (sx, sy, 0.07 * S), (x + dx, y + dy, top + 0.02 * S), mat('wood'), bev=0.45)
    # the wheel: a sunken dish 0.8 m across with a brass turret, numbered pockets round it
    wx = x - L / 2 + 0.5 * S
    cyl('wheel_bowl', 0.42 * S, 0.12 * S, (wx, y, top + 0.02 * S), mat('wood'), verts=96, bev=0.2)
    cyl('wheel_track', 0.36 * S, 0.02 * S, (wx, y, top + 0.085 * S), mat('cream'), verts=96)
    for k in range(37):
        a = k / 37 * math.tau
        r = 0.28 * S
        p = box(f'pocket{k}', (0.045 * S, 0.06 * S, 0.012 * S), (wx + r * math.cos(a), y + r * math.sin(a), top + 0.1 * S), mat('felt') if k == 0 else mat('rose') if k % 2 else mat('ink'))
        p.rotation_euler.z = a
    cyl('wheel_cone', 0.18 * S, 0.05 * S, (wx, y, top + 0.11 * S), mat('wood'), verts=64, bev=0.1)
    cyl('turret', 0.02 * S, 0.12 * S, (wx, y, top + 0.17 * S), mat('brass'), verts=24)
    for k in range(4):
        a = k * math.pi / 2
        arm = cyl(f'turret_arm{k}', 0.008 * S, 0.12 * S, (wx + 0.06 * S * math.cos(a), y + 0.06 * S * math.sin(a), top + 0.2 * S), mat('brass'), verts=16, rot=(0, math.pi / 2, a))
    sphere('turret_cap', 0.025 * S, (wx, y, top + 0.24 * S), mat('brass'))
    return top


CHIP_COLORS = ['blush', 'powder', 'mint', 'butter', 'lavender', 'cream']


def chip_material(color):
    key = f'chip_{color}'
    if key in MATS:
        return MATS[key]
    # clay chip: its colour with six white edge inserts, round its side
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.55
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Object'], sep.inputs[0])
    at = nt.nodes.new('ShaderNodeMath')
    at.operation = 'ARCTAN2'
    nt.links.new(sep.outputs['Y'], at.inputs[0])
    nt.links.new(sep.outputs['X'], at.inputs[1])
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = 6 / math.pi
    nt.links.new(at.outputs[0], mul.inputs[0])
    fr = nt.nodes.new('ShaderNodeMath')
    fr.operation = 'FRACT'
    nt.links.new(mul.outputs[0], fr.inputs[0])
    st = nt.nodes.new('ShaderNodeMath')
    st.operation = 'GREATER_THAN'
    st.inputs[1].default_value = 0.6
    nt.links.new(fr.outputs[0], st.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = lin(PASTEL[color])
    mix.inputs['B'].default_value = lin('#FFFFFF')
    nt.links.new(st.outputs[0], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    MATS[key] = m
    return m


def chips(x, y, z, count, color, tilt=0.0):
    # a stack of clay chips, 39 mm across and 3.3 mm thick, each a little off true
    r, t = 0.0195 * S, 0.0033 * S
    for k in range(count):
        c = cyl(f'chip_{color}', r, t * 0.96, (x + math.sin(k * 1.7) * 0.012, y + math.cos(k * 2.3) * 0.012, z + t * (k + 0.5)), chip_material(color), verts=40, bev=0.02)
        c.rotation_euler.z = k * 0.9
    return z + t * count


def ball_tray(x, y, rot=0.0):
    # a pachinko ball basket, 40 x 30 x 15 cm with 6 mm walls, heaped with 11 mm steel balls; all of it turns as one
    w, d, h, t = 0.4 * S, 0.3 * S, 0.15 * S, 0.006 * S
    bpy.ops.object.empty_add(location=(x, y, 0))
    root = bpy.context.object
    root.name = 'tray'
    parts = [box('tray_floor', (w, d, t), (0, 0, t / 2), mat('tray'), bev=0.05)]
    for (sx, sy, dx, dy) in [(w, t, 0, (d - t) / 2), (w, t, 0, -(d - t) / 2), (t, d, (w - t) / 2, 0), (t, d, -(w - t) / 2, 0)]:
        parts.append(box('tray_wall', (sx, sy, h), (dx, dy, h / 2), mat('tray'), bev=0.04))
    # the heap: packed layers filled up to a dome that rises above the rim in the middle, as a full basket is
    rb = 0.0055 * S
    hx, hy = w / 2 - t - rb, d / 2 - t - rb
    verts = []
    for layer in range(24):
        z = t + rb + layer * rb * 1.63
        off = (layer % 2) * rb
        yy = -hy + off
        row = 0
        while yy <= hy:
            xx = -hx + off + (row % 2) * rb
            while xx <= hx:
                dome = h * 0.8 + h * 0.45 * (1 - (xx / hx) ** 2) * (1 - (yy / hy) ** 2)
                if z <= dome:
                    verts.append((xx, yy, z))
                xx += 2 * rb
            yy += 2 * rb * 0.866
            row += 1
    mesh = bpy.data.meshes.new('heap')
    mesh.from_pydata(verts, [], [])
    heap = bpy.data.objects.new('heap', mesh)
    bpy.context.collection.objects.link(heap)
    # vertex instancing puts a copy of the child on every point, at the child's own offset from the heap
    ball = sphere('ball', rb, (0, 0, 0), mat('steel'), sub=3)
    ball.parent = heap
    heap.instance_type = 'VERTS'
    parts.append(heap)
    for o in parts:
        o.parent = root
    root.rotation_euler.z = rot
    return root


def stool(x, y):
    # a parlour stool: chrome pole, a foot ring at 30 cm, a padded seat at 75 cm
    cyl('stool_base', 0.22 * S, 0.03 * S, (x, y, 0.015 * S), mat('chrome'), verts=64, bev=0.2)
    cyl('stool_pole', 0.025 * S, 0.72 * S, (x, y, 0.36 * S), mat('chrome'), verts=32)
    torus('stool_ring', 0.16 * S, 0.008 * S, (x, y, 0.3 * S), mat('chrome'))
    for k in range(4):
        a = k * math.pi / 2
        cyl(f'stool_spoke{k}', 0.006 * S, 0.16 * S, (x + 0.08 * S * math.cos(a), y + 0.08 * S * math.sin(a), 0.3 * S), mat('chrome'), verts=12, rot=(0, math.pi / 2, a))
    cyl('stool_seat', 0.19 * S, 0.08 * S, (x, y, 0.75 * S), mat('cushion'), verts=64, bev=0.6)


def ladder(x, y, lean=0.2):
    # an aluminium stepladder 1.8 m high, its treads 28 cm apart: front and back legs lean in to meet at the top
    parts = []
    H = 1.8 * S
    run = H * math.tan(lean)
    length = H / math.cos(lean)
    for side in (-1, 1):
        rail = box('ladder_rail', (0.06 * S, 0.025 * S, length), (x + side * 0.22 * S, y + run / 2, H / 2), mat('alu'), bev=0.05)
        rail.rotation_euler.x = -lean
        back = box('ladder_back', (0.05 * S, 0.02 * S, length), (x + side * 0.22 * S, y + 1.5 * run, H / 2), mat('alu'), bev=0.05)
        back.rotation_euler.x = lean
        parts += [rail, back]
    for k in range(1, 7):
        z = k * 0.28 * S
        t = box(f'ladder_tread{k}', (0.44 * S, 0.09 * S, 0.02 * S), (x, y + z * math.tan(lean) + 0.03 * S, z), mat('alu'), bev=0.05)
        parts.append(t)
    box('ladder_top', (0.5 * S, 0.25 * S, 0.04 * S), (x, y + run, H + 0.02 * S), mat('powder'), bev=0.1)
    return parts


def pachinko(x, y, k):
    # a pachinko machine 50 x 85 x 25 cm: cream cabinet, chrome frame, a playfield behind glass, the ball tray below
    w, h, d = 0.5 * S, 0.85 * S, 0.25 * S
    base = 0.95 * S  # they stand on a counter
    body_col = ['cream', 'mint', 'powder', 'lavender', 'peach'][k % 5]
    box('pachi_body', (w, d, h), (x, y, base + h / 2), mat(body_col), bev=0.2)
    box('pachi_frame', (w * 0.9, 0.02 * S, h * 0.62), (x, y - d / 2 - 0.005 * S, base + h * 0.62), mat('chrome'), bev=0.1)
    face = bpy.data.materials.new(f'playfield{k}')
    face.use_nodes = True
    nt = face.node_tree
    b = nt.nodes['Principled BSDF']
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'RINGS'
    wave.inputs['Scale'].default_value = 2.0
    wave.inputs['Distortion'].default_value = 3.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = lin(['butter', 'blush', 'mint', 'powder', 'lavender'][k % 5])
    ramp.color_ramp.elements[1].color = lin(['peach', 'lavender', 'butter', 'blush', 'mint'][k % 5])
    nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 0.6
    pf = cyl('pachi_field', w * 0.4, 0.01 * S, (x, y - d / 2 - 0.012 * S, base + h * 0.62), face, verts=64, rot=(math.pi / 2, 0, 0))
    # brass pins over the field, and the glass
    pin = cyl('pachi_pins', 0.0012 * S, 0.012 * S, (x - w * 0.3, y - d / 2 - 0.02 * S, base + h * 0.42), mat('brass'), verts=8, rot=(math.pi / 2, 0, 0))
    array(pin, 12, (w * 0.6 / 11, 0, 0), 14, (0, 0, h * 0.4 / 13))
    box('pachi_glass', (w * 0.82, 0.004 * S, h * 0.56), (x, y - d / 2 - 0.03 * S, base + h * 0.62), glass())
    box('pachi_screen', (w * 0.24, 0.004 * S, h * 0.12), (x, y - d / 2 - 0.035 * S, base + h * 0.64), glow(f'screen{k}', ['powder', 'blush', 'mint'][k % 3], 4))
    # the ball tray lip: the ledge a hero hangs from
    box('pachi_tray', (w * 0.85, 0.08 * S, 0.06 * S), (x, y - d / 2 - 0.04 * S, base + h * 0.2), mat('chrome'), bev=0.3)
    cyl('pachi_lamp', 0.05 * S, 0.04 * S, (x, y, base + h + 0.02 * S), glow(f'lamp{k}', 'butter', 6), verts=32)


def slot(x, y, k):
    # a slot machine 60 x 180 x 60 cm, its reels lit, its topper sign
    w, h, d = 0.6 * S, 1.8 * S, 0.6 * S
    box('slot_body', (w, d, h * 0.8), (x, y, h * 0.4), mat(['powder', 'blush', 'mint'][k % 3]), bev=0.25)
    box('slot_reels', (w * 0.7, 0.02 * S, h * 0.14), (x, y - d / 2, h * 0.52), glow(f'reels{k}', 'cream', 3))
    for r in range(3):
        box('slot_seven', (w * 0.1, 0.022 * S, h * 0.06), (x + (r - 1) * w * 0.22, y - d / 2 - 0.001, h * 0.52), glow(f'seven{k}{r}', 'rose', 2.5))
    box('slot_top', (w * 0.9, d * 0.6, h * 0.2), (x, y + d * 0.1, h * 0.9), glow(f'topper{k}', 'butter', 1.5), bev=0.3)
    box('slot_ledge', (w, 0.18 * S, 0.03 * S), (x, y - d / 2 - 0.06 * S, h * 0.36), mat('chrome'), bev=0.1)


def card(x, y, z, rx=0.0, rz=0.0, face_up=True):
    c = box('card', (0.063 * S, 0.088 * S, 0.0006 * S), (x, y, z), mat('card' if face_up else 'cardback'), bev=0.02)
    c.rotation_euler = (rx, 0, rz)
    return c


def die(x, y, size=0.18):
    # a promotional die: soft-edged acrylic, white pips
    d = box('die', (size * S, size * S, size * S), (x, y, size * S / 2), mat('die'), bev=size * S * 0.12)
    s = size * S
    pips = {(0, 0, 1): [(0, 0)], (1, 0, 0): [(-0.25, -0.25), (0.25, 0.25)], (0, -1, 0): [(-0.25, -0.25), (0, 0), (0.25, 0.25)]}
    for (nx, ny, nz), spots in pips.items():
        for (u, v) in spots:
            if nz:
                at = (x + u * s, y + v * s, s + 0.001)
            elif nx:
                at = (x + s / 2 + 0.001, y + u * s, s / 2 + v * s)
            else:
                at = (x + u * s, y - s / 2 - 0.001, s / 2 + v * s)
            p = cyl('pip', s * 0.08, s * 0.02, at, mat('card'), verts=24, rot=(0 if nz else math.pi / 2, 0 if not nx else math.pi / 2, 0) if not nz else (0, 0, 0))
            if nx:
                p.rotation_euler = (0, math.pi / 2, 0)
            elif ny:
                p.rotation_euler = (math.pi / 2, 0, 0)


def carton(x, y, z, size, rot=0.0):
    w, d, h = (v * S for v in size)
    b = box('carton', (w, d, h), (x, y, z + h / 2), mat('kraft'), bev=0.04)
    b.rotation_euler.z = rot
    t = box('carton_tape', (w * 1.002, d * 0.18, h * 1.002), (x, y, z + h / 2), mat('tape'))
    t.rotation_euler.z = rot


def counter(x, y):
    # the parlour counter the pachinko row stands on, and the cashier's beyond: 1.1 m, a wooden top
    box('counter', (3.2 * S, 0.5 * S, 0.95 * S), (x, y, 0.475 * S), mat('cream'), bev=0.2)
    box('counter_kick', (3.2 * S, 0.02 * S, 0.1 * S), (x, y - 0.25 * S, 0.05 * S), mat('graphite') if 'graphite' in MATS else mat('ink'))


def hall():
    # the parlour round the corner: a back wall of tall windows open to the sky, so the low sun lays their shapes across
    # the tiles, side walls, and a ceiling of fluorescent panels
    W, H = 6 * S, 3.6 * S
    wy = 4.2 * S
    sill, head, ww = 1.0 * S, 3.0 * S, 0.9 * S
    box('wall_low', (2 * W, 0.2 * S, sill), (0, wy, sill / 2), mat('wall'))
    box('wall_high', (2 * W, 0.2 * S, H - head), (0, wy, (head + H) / 2), mat('wall'))
    xs = [k * 1.3 * S for k in range(-4, 5)]
    edges = [-W] + [e for x in xs for e in (x - ww / 2, x + ww / 2)] + [W]
    for a, b in zip(edges[0::2], edges[1::2]):
        box('wall_pier', (b - a, 0.2 * S, head - sill), ((a + b) / 2, wy, (sill + head) / 2), mat('wall'))
    for x in xs:
        box('mullion', (0.03 * S, 0.22 * S, head - sill), (x, wy, (sill + head) / 2), mat('alu'))
        box('transom', (ww, 0.22 * S, 0.03 * S), (x, wy, sill + (head - sill) * 0.62), mat('alu'))
    for side in (-1, 1):
        box('wall_side', (0.2 * S, 2 * wy, H), (side * W, 0, H / 2), mat('wall'))
    box('ceiling', (2 * W, 2 * wy, 0.1 * S), (0, 0, H + 0.05 * S), mat('wall'))
    for k in range(-3, 4):
        box('panel', (1.2 * S, 0.3 * S, 0.01 * S), (k * 1.6 * S, 0.5 * S, H - 0.005 * S), glow(f'tube{k}', '#FFF8EE', 3))
        bpy.ops.object.light_add(type='AREA', location=(k * 1.6 * S, 0.5 * S, H - 0.03 * S))
        l = bpy.context.object
        l.data.shape = 'RECTANGLE'
        l.data.size = 1.2 * S
        l.data.size_y = 0.3 * S
        l.data.energy = 6000
        l.data.color = (1.0, 0.97, 0.92)


def hero(x, y, rot=0.0):
    # a 1.8 m figure for scale: the size a hero is on this floor
    c = cyl('hero_legs', 0.13, 0.9, (x, y, 0.45), mat('ink'), verts=24)
    t = cyl('hero_body', 0.22, 0.75, (x, y, 1.27), mat('blush'), verts=24, bev=0.05)
    sphere('hero_head', 0.14, (x, y, 1.78), mat('peach'))


def build():
    floor()
    hall()
    top = roulette(-1.2 * S, -0.2 * S)
    # chip stacks climbing beside the table, one step each
    for k, (dx, n) in enumerate([(0.0, 10), (0.05, 20), (0.1, 32), (0.15, 46), (0.2, 64)]):
        chips(-1.2 * S + 1.3 * S + dx * S, -0.75 * S, 0, n, CHIP_COLORS[k % len(CHIP_COLORS)])
    for k in range(6):
        chips(-1.2 * S + (k - 3) * 0.06 * S, -0.2 * S + 0.3 * S, top, 6 + k * 3, CHIP_COLORS[(k + 2) % len(CHIP_COLORS)])
    ball_tray(0.45 * S, -0.55 * S, 0.2)
    ball_tray(0.95 * S, -0.35 * S, -0.1)
    stool(1.1 * S, 0.5 * S)
    stool(1.7 * S, 0.5 * S)
    ladder(-0.2 * S, -1.2 * S)
    counter(1.4 * S, 1.2 * S)
    for k in range(5):
        pachinko(0.4 * S + k * 0.52 * S, 1.2 * S, k)
    for k in range(4):
        slot(-2.4 * S + k * 0.65 * S, 2.6 * S, k)
    die(0.15 * S, -1.0 * S)
    die(0.38 * S, -1.05 * S, 0.12)
    carton(-0.6 * S, -1.6 * S, 0, (0.4, 0.3, 0.3), 0.2)
    carton(-0.62 * S, -1.6 * S, 0.3 * S, (0.3, 0.25, 0.22), -0.1)
    card(0.6 * S, -1.0 * S, 0.002 * S, 0, 0.3)
    card(0.7 * S, -1.05 * S, 0.003 * S, 0, -0.4, False)
    # a card leaned from the floor onto an eight-chip stack: a ramp a hero runs up
    rise = 8 * 0.0033 * S
    chips(0.8 * S, -0.6 * S, 0, 8, 'lavender')
    card(0.8 * S, -0.6 * S - 0.042 * S, rise / 2, math.asin(rise / (0.088 * S)), 0.0, False)
    for k, (dx, dy, r) in enumerate([(0.2, -0.85, 0.0), (0.25, -0.7, 1.4), (0.85, -0.85, 2.6), (1.1, -0.66, 1.9)]):
        hero(dx * S, dy * S, r)


def world():
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.78, 0.85, 0.95, 1)
    bg.inputs['Strength'].default_value = 0.9
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 50))
    sun = bpy.context.object
    sun.data.energy = 6.0
    sun.data.angle = math.radians(2)
    sun.data.color = (1.0, 0.88, 0.72)
    # low afternoon sun from behind the windows, long shadows across the tiles toward the camera
    sun.rotation_euler = (math.radians(62), 0, math.radians(165))


def camera(name, at, look):
    bpy.ops.object.camera_add(location=at)
    c = bpy.context.object
    c.name = name
    d = Vector(look) - Vector(at)
    c.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    c.data.lens = 24
    c.data.clip_start = 0.05
    c.data.clip_end = 2000
    return c


def main():
    out, samples, w, h = args()
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('[toy] gpu off:', e)
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    world()
    build()
    shots = {
        # over a hero's shoulder at the foot of the chip stairs, looking across the floor to the table and the pachinko row
        'shoulder': ((21.5, -11.5, 2.6), (-18.0, -1.0, 7.0)),
        'low': ((1.6 * S, -1.5 * S, 1.2), (-0.6 * S, 0.3 * S, 8.0)),
        'above': ((2.6 * S, -3.4 * S, 2.8 * S), (0.2 * S, 0.2 * S, 0.3 * S)),
    }
    # a close look for checking one piece: TOY_SHOT='x,y,z;lx,ly,lz' renders that view alone, as toy-check.png
    if os.environ.get('TOY_SHOT'):
        at, look = (tuple(float(v) for v in part.split(',')) for part in os.environ['TOY_SHOT'].split(';'))
        shots = {'check': (at, look)}
    for name, (at, look) in shots.items():
        sc.camera = camera(name, at, look)
        sc.render.filepath = os.path.join(out, f'toy-{name}.png')
        bpy.ops.render.render(write_still=True)
        print('[toy] wrote', sc.render.filepath, flush=True)


main()
