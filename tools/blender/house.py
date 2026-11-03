"""
The House of Instinct, dressed and lit in Blender (docs/ENGINE.md, the Blender pipeline): every piece the engine
collides with, built again with bevelled edges that catch the light and the arcade palette as real materials, then the
hall's fill light and its bounce baked into one lightmap. The key light stays live in the game (it casts the heroes'
shadows), so the bake leaves out what the key lights directly and keeps only what it, and the fill, bounce around.

    npx tsx tools/blender/house-export.ts
    Blender -b --python tools/blender/house.py -- [--in build/house.json] [--out build]
            [--size 2048] [--samples 256] [--preview preview.png]
    npx tsx tools/blender/house-pack.ts

Writes house.glb (every piece that never breaks, one mesh, a primitive per material, its lightmap UVs as TEXCOORD_0)
and lightmap.png (sRGB-encoded irradiance over LM_MAX; the game multiplies back). Breakable pieces are lit and cast
into the bake but left out of the GLB: the game builds them itself so they can shake and break.

Axes: the game is y-up with z toward the red side; Blender is z-up. A game point (x, y, z) is Blender (x, -z, y),
which glTF's export turns back into (x, y, z).
"""

import json
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
# irradiance is stored as (value / LM_MAX) ** (1 / 2.2) in 8 bits; the game decodes sRGB and scales by LM_MAX * pi
LM_MAX = 1.0
BEVEL = 0.05


def log(*a):
    print('[house]', *a, flush=True)


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'in': os.path.join(HERE, 'build', 'house.json'), 'out': os.path.join(HERE, 'build'), 'size': 2048, 'samples': 256, 'preview': None}
    i = 0
    while i < len(argv):
        k = argv[i].lstrip('-')
        opts[k] = argv[i + 1]
        i += 2
    opts['size'] = int(opts['size'])
    opts['samples'] = int(opts['samples'])
    return opts


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(hexstr):
    h = hexstr.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def g2b(x, y, z):
    return Vector((x, -z, y))


# how each palette colour is finished: roughness, metalness, a little clearcoat on lacquer (GAME.md §1 materials)
FINISH = {
    'porcelain': (0.32, 0.0),
    'graphite': (0.45, 0.35),
    'vermilion': (0.28, 0.0),
    'yellow': (0.3, 0.0),
    'cobalt': (0.3, 0.0),
    'jade': (0.34, 0.0),
    'oxblood': (0.85, 0.0),
    'champagne': (0.3, 0.55),
}


def material(name, color, rough, metal, emission=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission[0], 1)
        bsdf.inputs['Emission Strength'].default_value = emission[1]
    return m


def block_mesh(bm, piece):
    s = piece['shape']
    base, top = piece['base'], piece['top']
    x0, x1 = s['x'] - s['hx'], s['x'] + s['hx']
    z0, z1 = s['z'] - s['hz'], s['z'] + s['hz']
    slope = piece.get('slope')

    def height(x, z):
        if not slope:
            return top
        along_x = slope['rise'][0] == 'x'
        half = s['hx'] if along_x else s['hz']
        c = x - s['x'] if along_x else z - s['z']
        u = max(0.0, min(1.0, ((c if slope['rise'][1] == '+' else -c) + half) / (2 * half)))
        return slope['low'] + (top - slope['low']) * u

    corners = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    bottom = [bm.verts.new(g2b(x, base, z)) for x, z in corners]
    upper = [bm.verts.new(g2b(x, max(base + 0.01, height(x, z)), z)) for x, z in corners]
    # faces wound outward in Blender's axes (the y flip mirrors the game's handedness)
    bm.faces.new(bottom)
    bm.faces.new(list(reversed(upper)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new([bottom[j], bottom[i], upper[i], upper[j]])


def column_mesh(bm, piece):
    s = piece['shape']
    h = max(0.01, piece['top'] - piece['base'])
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=s['r'], radius2=s['r'], depth=h)
    bmesh.ops.translate(bm, verts=geom['verts'], vec=g2b(s['x'], piece['base'] + h / 2, s['z']))


def solid(piece, mat_index):
    bm = bmesh.new()
    (column_mesh if piece['shape']['kind'] == 'column' else block_mesh)(bm, piece)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # the underside of a piece on the ground is never seen: no faces, no lightmap space
    if piece['base'] <= 0.01:
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9], context='FACES')
    s = piece['shape']
    thin = min(piece['top'] - piece['base'], *( [s['r'] * 2] if s['kind'] == 'column' else [s['hx'] * 2, s['hz'] * 2]))
    offset = min(BEVEL, thin * 0.3)
    if offset > 0.004:
        edges = [e for e in bm.edges if not e.is_boundary and e.calc_face_angle(0) > math.radians(30)]
        bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    for f in bm.faces:
        f.material_index = mat_index
        f.smooth = True
    return bm


def trims(piece):
    """The yellow trim on a traversal piece, as in client/greybox.ts trim()."""
    s = piece['shape']
    t = 0.09
    out = []
    if s['kind'] == 'column':
        out.append(('ring', s['x'], piece['top'] - 0.08, s['z'], s['r'] + 0.03, 0.16))
        return out
    if piece.get('slope'):
        return out  # a ramp's side strips: left to the live view for now
    y = piece['top'] + t / 2 - 0.02
    out += [
        ('box', s['x'], y, s['z'] - s['hz'] + t / 2, s['hx'] * 2, t, t),
        ('box', s['x'], y, s['z'] + s['hz'] - t / 2, s['hx'] * 2, t, t),
        ('box', s['x'] - s['hx'] + t / 2, y, s['z'], t, t, s['hz'] * 2),
        ('box', s['x'] + s['hx'] - t / 2, y, s['z'], t, t, s['hz'] * 2),
    ]
    return out


def trim_mesh(bm, spec, mat_index):
    if spec[0] == 'ring':
        _, x, y, z, r, h = spec
        geom = bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=r, radius2=r, depth=h)
    else:
        _, x, y, z, w, h, d = spec
        geom = bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, verts=geom['verts'], vec=Vector((w, d, h)))
    bmesh.ops.translate(bm, verts=geom['verts'], vec=g2b(x, y, z))
    for f in {f for v in geom['verts'] for f in v.link_faces}:
        f.material_index = mat_index


def build(data):
    mats = []
    index = {}

    def mat_for(key, make):
        if key not in index:
            index[key] = len(mats)
            mats.append(make())
        return index[key]

    pal = data['palette']
    keep = bmesh.new()
    breakables = bmesh.new()
    for p in data['pieces']:
        if p['breakable']:
            color = {'glass': '#9fd8ff', 'card': '#f3ead6'}.get(p['look'], '#c0462e')
            mi = mat_for('break-' + p['look'], lambda c=color, l=p['look']: material('break-' + l, rgb(c), 0.1 if l == 'glass' else 0.7, 0.0))
            piece = solid(p, mi)
            target = breakables
        else:
            key = p['paint']
            rough, metal = FINISH[key]
            tone = p.get('tone', 1)
            name = key if tone == 1 else '%s-%d' % (key, round(tone * 100))
            mi = mat_for(name, lambda n=name, k=key, r=rough, m=metal, t=tone: material(n, tuple(c * t for c in rgb(pal[k])), r, m))
            piece = solid(p, mi)
            target = keep
        tmp = bpy.data.meshes.new('tmp')
        piece.to_mesh(tmp)
        piece.free()
        target.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        if p['trim']:
            yi = mat_for('trim', lambda: material('trim', rgb('#ffc820'), 0.4, 0.0, (rgb('#ffc820'), 0.6)))
            for spec in trims(p):
                trim_mesh(keep, spec, yi)

    def obj(name, bm):
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        for m in mats:
            mesh.materials.append(m)
        o = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(o)
        mesh.set_sharp_from_angle(angle=math.radians(35))
        return o

    house = obj('house', keep)
    breaks = obj('breakables', breakables)
    # a floor under everything for the bake's occlusion and bounce (the game draws its own)
    e = data['extent']
    floor = bpy.data.objects.new('floor', bpy.data.meshes.new('floor'))
    fb = bmesh.new()
    bmesh.ops.create_grid(fb, x_segments=1, y_segments=1, size=1)
    bmesh.ops.scale(fb, verts=fb.verts, vec=Vector((e['halfWidth'] + 8, e['halfLength'] + 16, 1)))
    fb.to_mesh(floor.data)
    fb.free()
    floor.data.materials.append(material('ground', rgb(pal['oxblood']), 0.9, 0.0))
    bpy.context.scene.collection.objects.link(floor)
    log('house', len(house.data.polygons), 'faces;', 'breakables', len(breaks.data.polygons), 'faces;', len(mats), 'materials')
    return house, breaks, floor


def lights(data):
    L = data['light']
    scene = bpy.context.scene
    world = bpy.data.worlds.new('fill')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = -1
    ramp.inputs['From Max'].default_value = 1
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (*rgb(L['below']), 1)
    mix.inputs['B'].default_value = (*rgb(L['above']), 1)
    bg = nt.nodes.new('ShaderNodeBackground')
    # three's hemisphere light of intensity I gives albedo * I / pi; Cycles' world of strength S gives albedo * S
    bg.inputs['Strength'].default_value = L['fill'] / math.pi
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Value'])
    nt.links.new(ramp.outputs['Result'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    sun = bpy.data.lights.new('key', 'SUN')
    sun.color = rgb(L['key'])
    # three's directional intensity is irradiance, as Blender's sun strength is
    sun.energy = L['keyIntensity']
    sun.angle = math.radians(8)
    key = bpy.data.objects.new('key', sun)
    fx, fy, fz = L['from']
    key.rotation_euler = Vector(g2b(fx, fy, fz)).to_track_quat('Z', 'Y').to_euler()
    scene.collection.objects.link(key)
    return key


def lightmap_uvs(house, size):
    bpy.context.view_layer.objects.active = house
    for o in bpy.context.scene.objects:
        o.select_set(o is house)
    house.data.uv_layers.new(name='lightmap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=4 / size, rotate=True, scale=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake(house, key, size, samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = 'GPU'
    except Exception as e:  # no GPU: the CPU bakes it, slower
        log('no Metal device:', e)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 4

    def one(name, passes, key_on):
        img = bpy.data.images.new(name, size, size, float_buffer=True)
        for m in house.data.materials:
            nodes = m.node_tree.nodes
            for n in [n for n in nodes if n.name == 'bake']:
                nodes.remove(n)
            n = nodes.new('ShaderNodeTexImage')
            n.name = 'bake'
            n.image = img
            nodes.active = n
        key.hide_render = not key_on
        for o in bpy.context.scene.objects:
            o.select_set(o is house)
        bpy.context.view_layer.objects.active = house
        t = time.time()
        bpy.ops.object.bake(type='DIFFUSE', pass_filter=passes, use_clear=True, margin=4)
        log(name, 'baked in', round(time.time() - t), 's')
        px = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        return px.reshape(size, size, 4)

    # all the light, then only what the key lights directly: the game draws that part live
    everything = one('all', {'DIRECT', 'INDIRECT'}, True)
    direct = one('key-direct', {'DIRECT'}, True)
    world_direct = one('fill-direct', {'DIRECT'}, False)
    key_direct = np.clip(direct - world_direct, 0, None)
    lm = np.clip(everything - key_direct, 0, None)
    lm[..., 3] = 1
    for m in house.data.materials:
        for n in [n for n in m.node_tree.nodes if n.name == 'bake']:
            m.node_tree.nodes.remove(n)
    return lm


def save_lightmap(lm, path):
    size = lm.shape[0]
    enc = np.clip(lm[..., :3] / LM_MAX, 0, 1) ** (1 / 2.2)
    out = np.concatenate([enc, np.ones((size, size, 1), np.float32)], axis=2)
    img = bpy.data.images.new('lightmap', size, size, alpha=False)
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    log('lightmap', path, 'mean', float(lm[..., :3].mean()), 'p99', float(np.percentile(lm[..., :3], 99)))


def export(house, path):
    # only the lightmap UVs go out, as TEXCOORD_0
    for o in bpy.context.scene.objects:
        o.select_set(o is house)
    bpy.context.view_layer.objects.active = house
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_yup=True)
    log('wrote', path, os.path.getsize(path) // 1024, 'KB')


def preview(house, path):
    scene = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.location = g2b(0, 26, -38)
    cam.rotation_euler = (g2b(0, 4, -6) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 24
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log('preview', path)


def main():
    o = args()
    data = json.load(open(o['in']))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    house, breaks, floor = build(data)
    key = lights(data)
    lightmap_uvs(house, o['size'])
    lm = bake(house, key, o['size'], o['samples'])
    os.makedirs(o['out'], exist_ok=True)
    save_lightmap(lm, os.path.join(o['out'], 'lightmap.png'))
    if o['preview']:
        preview(house, o['preview'])
    export(house, os.path.join(o['out'], 'house.glb'))


main()
