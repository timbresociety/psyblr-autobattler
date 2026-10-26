"""
The texture atlas: every part of the hero joined into one mesh, unwrapped into one atlas with the face given the most
room, and painted by baking: skin, the projected portrait, fabrics, leather, bronze and hair are shader networks
(procedural detail, no downloaded art) rendered into the atlas with Cycles, then darkened by a baked ambient occlusion.

Regions and parts ride a second UV channel, as they did on the first characters, so the game still tints, hides and
lights regions per hero: u = region index, v = part index (see REGIONS and PARTS, shared with character-look.ts).
"""

import os

import bmesh
import bpy
import numpy as np

REGIONS = ['skin', 'suit', 'trim', 'pants', 'glove', 'boot', 'hair', 'metal', 'eye', 'iris', 'brow', 'cape', 'baked', 'baked_gloss', 'baked_metal']
PARTS = ['base', 'hair:crop', 'hair:spiky', 'hair:long', 'hair:helmet', 'armour', 'cape']


def srgb_to_linear(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def lin_to_srgb_np(a):
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.clip(a, 0, None), 1 / 2.4) - 0.055)


def srgb_to_lin_np(a):
    return np.where(a <= 0.04045, a / 12.92, np.power((a + 0.055) / 1.055, 2.4))


# ------------------------------------------------------------------------------------------------ joining


def unwrap_part(obj):
    """Smart-project a part's own UVs (accessories, hair, eyes) before it joins the body's layout."""
    me = obj.data
    if 'UVMap' not in me.uv_layers:
        while len(me.uv_layers):
            me.uv_layers.remove(me.uv_layers[0])
        me.uv_layers.new(name='UVMap')
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.01, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)


def join(objs, name='hero'):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    hero = bpy.context.view_layer.objects.active
    hero.name = name
    hero.data.name = name
    me = hero.data
    if me.uv_layers:
        me.uv_layers[0].name = 'atlas'
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])
    return hero


# ------------------------------------------------------------------------------------------------ atlas layout


def uv_islands(bm, uv):
    """Faces grouped into UV islands (faces sharing an edge with matching UVs on both sides)."""
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    bm.faces.ensure_lookup_table()
    for e in bm.edges:
        lf = e.link_loops
        if len(lf) != 2:
            continue
        a, b = lf
        # loops on an edge run in opposite directions
        if (a[uv].uv - b.link_loop_next[uv].uv).length < 1e-5 and (a.link_loop_next[uv].uv - b[uv].uv).length < 1e-5:
            ra, rb = find(a.face.index), find(b.face.index)
            if ra != rb:
                parent[ra] = rb
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())


def layout_atlas(hero, density_of, margin=0.004):
    """
    Give each island the texel density its content deserves (density_of(faces) -> linear factor), then pack every
    island into the unit square.
    """
    me = hero.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv['atlas']
    for faces in uv_islands(bm, uv):
        area3 = sum(f.calc_area() for f in faces)
        area2 = 0.0
        for f in faces:
            pts = [l[uv].uv for l in f.loops]
            for k in range(1, len(pts) - 1):
                a, b, c = pts[0], pts[k], pts[k + 1]
                area2 += abs((b - a).cross(c - a)) / 2
        if area3 <= 0:
            continue
        cen = sum((l[uv].uv for f in faces for l in f.loops), type(faces[0].loops[0][uv].uv)((0, 0))) / sum(len(f.loops) for f in faces)
        want = (density_of(faces) ** 2) * area3
        s = (want / area2) ** 0.5 if area2 > 1e-12 else 1.0
        for f in faces:
            for l in f.loops:
                l[uv].uv = cen + (l[uv].uv - cen) * s
    bm.to_mesh(me)
    bm.free()
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = hero
    hero.select_set(True)
    me.uv_layers.active = me.uv_layers['atlas']
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=margin, scale=True, shape_method='CONCAVE', merge_overlap=False)
    bpy.ops.object.mode_set(mode='OBJECT')


# ------------------------------------------------------------------------------------------------ bake materials


def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return nt, emit


def _rgb(nt, c):
    n = nt.nodes.new('ShaderNodeRGB')
    n.outputs[0].default_value = (*srgb_to_linear(c), 1)
    return n.outputs[0]


def _noise(nt, scale, detail=4.0, stretch=(1, 1, 1), distortion=0.0):
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = stretch
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = scale
    tex.inputs['Detail'].default_value = detail
    tex.inputs['Distortion'].default_value = distortion
    nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    return tex.outputs['Fac']


def _voronoi(nt, scale):
    coord = nt.nodes.new('ShaderNodeTexCoord')
    tex = nt.nodes.new('ShaderNodeTexVoronoi')
    tex.feature = 'DISTANCE_TO_EDGE'
    tex.inputs['Scale'].default_value = scale
    nt.links.new(coord.outputs['Object'], tex.inputs['Vector'])
    return tex.outputs['Distance']


def _wave(nt, scale, axis='X', distortion=2.0):
    coord = nt.nodes.new('ShaderNodeTexCoord')
    tex = nt.nodes.new('ShaderNodeTexWave')
    tex.wave_type = 'BANDS'
    tex.bands_direction = axis
    tex.inputs['Scale'].default_value = scale
    tex.inputs['Distortion'].default_value = distortion
    tex.inputs['Detail'].default_value = 2.0
    nt.links.new(coord.outputs['Object'], tex.inputs['Vector'])
    return tex.outputs['Fac']


def _math(nt, op, a, b=None, clamp=False):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            nt.links.new(x, n.inputs[i])
    return n.outputs[0]


def _mix(nt, fac, a, b, blend='MIX'):
    n = nt.nodes.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    n.blend_type = blend
    for sock, x in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(x, (int, float)):
            sock.default_value = x
        elif isinstance(x, tuple):
            sock.default_value = (*x, 1) if len(x) == 3 else x
        else:
            nt.links.new(x, sock)
    return n.outputs[2]


def _scale_color(nt, col, fac):
    """col * fac (fac a scalar socket)."""
    n = nt.nodes.new('ShaderNodeVectorMath')
    n.operation = 'SCALE'
    nt.links.new(col, n.inputs[0])
    if isinstance(fac, (int, float)):
        n.inputs['Scale'].default_value = fac
    else:
        nt.links.new(fac, n.inputs['Scale'])
    return n.outputs[0]


def _range(nt, x, a, b, lo, hi):
    n = nt.nodes.new('ShaderNodeMapRange')
    n.clamp = True
    nt.links.new(x, n.inputs['Value'])
    n.inputs['From Min'].default_value = a
    n.inputs['From Max'].default_value = b
    n.inputs['To Min'].default_value = lo
    n.inputs['To Max'].default_value = hi
    return n.outputs['Result']


def paint_material(mat, face_img=None, hair_img=None):
    """Turn a region material into an emission network the bake renders (see the 'paint' kinds below)."""
    paint = mat.get('paint', 'flat')
    color = tuple(mat.get('color', (0.7, 0.7, 0.7)))
    color2 = tuple(mat.get('color2', color))
    tint = bool(mat.get('tint', False))
    nt, emit = _nodes(mat)
    if tint:
        # tinted regions bake their detail in grey; the game multiplies in the hero's colour
        color = color2 = (1.0, 1.0, 1.0) if paint != 'metal' else (0.95, 0.95, 0.95)
    base = _rgb(nt, color)
    if paint == 'flat':
        col = _scale_color(nt, base, _range(nt, _noise(nt, 40), 0.3, 0.7, 0.95, 1.03))
    elif paint in ('fabric', 'wool', 'cotton'):
        weave = _wave(nt, 420, 'X', 0.0)
        weave2 = _wave(nt, 420, 'Z', 0.0)
        mottle = _range(nt, _noise(nt, 25, 6), 0.3, 0.7, 0.9, 1.05)
        f = _math(nt, 'MULTIPLY', _range(nt, _math(nt, 'ADD', weave, weave2), 0.0, 2.0, 0.93, 1.03), mottle)
        col = _scale_color(nt, base, f)
    elif paint == 'knit':
        rib = _range(nt, _wave(nt, 260, 'X', 0.4), 0.0, 1.0, 0.86, 1.04)
        col = _scale_color(nt, base, _math(nt, 'MULTIPLY', rib, _range(nt, _noise(nt, 30), 0.3, 0.7, 0.94, 1.04)))
    elif paint == 'denim':
        twill = _range(nt, _wave(nt, 300, 'Z', 0.6), 0.0, 1.0, 0.9, 1.05)
        fade = _range(nt, _noise(nt, 6, 3), 0.4, 0.7, 0.0, 0.12)
        col = _mix(nt, fade, _scale_color(nt, base, twill), _scale_color(nt, base, 1.6))
    elif paint == 'leather':
        grain = _range(nt, _voronoi(nt, 160), 0.0, 0.12, 0.88, 1.0)
        wear = _range(nt, _noise(nt, 9, 5), 0.35, 0.75, 0.82, 1.22)
        col = _scale_color(nt, base, _math(nt, 'MULTIPLY', grain, wear))
    elif paint == 'metal':
        ham = _range(nt, _noise(nt, 70, 3), 0.3, 0.7, 0.8, 1.15)
        tarn = _range(nt, _noise(nt, 6, 4), 0.45, 0.7, 0.0, 0.45)
        col = _mix(nt, tarn, _scale_color(nt, base, ham), _rgb(nt, (0.28, 0.24, 0.16)) if not tint else (0.6, 0.6, 0.6))
    elif paint == 'hair':
        # strands run along the head's meridians (crown to nape): texture on (bearing, height) around its centre
        cx, cy, cz = mat.get('centre', (0.0, 0.0, 1.65))
        coord = nt.nodes.new('ShaderNodeTexCoord')
        sub = nt.nodes.new('ShaderNodeVectorMath')
        sub.operation = 'SUBTRACT'
        sub.inputs[1].default_value = (cx, cy, cz)
        nt.links.new(coord.outputs['Object'], sub.inputs[0])
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(sub.outputs[0], sep.inputs[0])
        bearing = _math(nt, 'ARCTAN2', sep.outputs['X'], sep.outputs['Y'])

        def flow(k_bearing, k_height):
            comb = nt.nodes.new('ShaderNodeCombineXYZ')
            nt.links.new(_math(nt, 'MULTIPLY', bearing, k_bearing), comb.inputs['X'])
            nt.links.new(_math(nt, 'MULTIPLY', sep.outputs['Z'], k_height), comb.inputs['Y'])
            return comb.outputs[0]

        broad = nt.nodes.new('ShaderNodeTexNoise')
        broad.inputs['Scale'].default_value = 1.0
        broad.inputs['Detail'].default_value = 3.0
        nt.links.new(flow(9.0, 6.0), broad.inputs['Vector'])
        fine = nt.nodes.new('ShaderNodeTexNoise')
        fine.inputs['Scale'].default_value = 1.0
        fine.inputs['Detail'].default_value = 2.0
        nt.links.new(flow(70.0, 8.0), fine.inputs['Vector'])
        strands = _range(nt, broad.outputs['Fac'], 0.35, 0.68, 0.0, 1.0)
        col = _mix(nt, strands, _rgb(nt, color), _rgb(nt, color2))
        col = _scale_color(nt, col, _range(nt, fine.outputs['Fac'], 0.3, 0.7, 0.78, 1.12))
        if hair_img is not None and mat.get('front'):
            # where the portrait shows the hair front-on, paint it from the portrait
            uvn = nt.nodes.new('ShaderNodeUVMap')
            uvn.uv_map = 'proj'
            img = nt.nodes.new('ShaderNodeTexImage')
            img.image = hair_img
            img.extension = 'EXTEND'
            nt.links.new(uvn.outputs['UV'], img.inputs['Vector'])
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            sepn = nt.nodes.new('ShaderNodeSeparateXYZ')
            nt.links.new(geo.outputs['Normal'], sepn.inputs['Vector'])
            facing = _range(nt, _math(nt, 'MULTIPLY', sepn.outputs['Y'], -1.0), 0.05, 0.45, 0.0, 1.0)
            col = _mix(nt, _math(nt, 'MULTIPLY', img.outputs['Alpha'], facing), col, img.outputs['Color'])
    elif paint == 'dots':
        # polka dots (Churchill's bow tie)
        coord = nt.nodes.new('ShaderNodeTexCoord')
        vor = nt.nodes.new('ShaderNodeTexVoronoi')
        vor.feature = 'F1'
        vor.inputs['Scale'].default_value = 90.0
        vor.inputs['Randomness'].default_value = 0.0
        nt.links.new(coord.outputs['Object'], vor.inputs['Vector'])
        dot = _range(nt, vor.outputs['Distance'], 0.22, 0.28, 1.0, 0.0)
        col = _mix(nt, dot, base, _rgb(nt, color2))
    elif paint == 'silk':
        sheen = _range(nt, _noise(nt, 14, 3), 0.3, 0.7, 0.88, 1.12)
        col = _scale_color(nt, base, sheen)
    elif paint == 'skin':
        blotch = _range(nt, _noise(nt, 22, 5), 0.3, 0.7, 0.95, 1.03)
        col = _scale_color(nt, base, blotch)
    elif paint in ('face', 'eye'):
        skin = _scale_color(nt, base, _range(nt, _noise(nt, 22, 5), 0.3, 0.7, 0.96, 1.02))
        if face_img is None:
            col = skin
        else:
            uvn = nt.nodes.new('ShaderNodeUVMap')
            uvn.uv_map = 'proj'
            img = nt.nodes.new('ShaderNodeTexImage')
            img.image = face_img
            img.extension = 'EXTEND'
            nt.links.new(uvn.outputs['UV'], img.inputs['Vector'])
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            sep = nt.nodes.new('ShaderNodeSeparateXYZ')
            nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
            facing = _range(nt, _math(nt, 'MULTIPLY', sep.outputs['Y'], -1.0), 0.12, 0.5, 0.0, 1.0)
            fac = _math(nt, 'MULTIPLY', img.outputs['Alpha'], facing)
            if paint == 'eye':
                fac = img.outputs['Alpha']
            col = _mix(nt, fac, skin, img.outputs['Color'])
    else:
        col = base
    nt.links.new(col, emit.inputs['Color'])
    emit.inputs['Strength'].default_value = 1.0
    return nt


def add_relief(mat):
    """
    A second network on each material for the normal bake: a Principled BSDF whose normal is bumped by the surface's
    own small relief (cloth folds and weave, leather grain and creases, hammered bronze, hair strands, skin pores).
    """
    nt = mat.node_tree
    paint = mat.get('paint', 'flat')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.name = 'relief'
    bump = nt.nodes.new('ShaderNodeBump')

    def folds(scale=6.0):
        # soft folds that ring the limbs and drape on the body
        return _range(nt, _noise(nt, scale, 3, stretch=(1, 1, 3.5), distortion=0.6), 0.25, 0.75, 0.0, 1.0)

    if paint in ('fabric', 'wool', 'cotton', 'flat', 'silk', 'dots'):
        weave = _range(nt, _wave(nt, 420, 'X', 0.0), 0.0, 1.0, 0.0, 0.08)
        h = _math(nt, 'ADD', folds(), weave)
        strength, distance = 0.45, 0.012
    elif paint == 'knit':
        h = _math(nt, 'ADD', folds(), _range(nt, _wave(nt, 260, 'X', 0.4), 0.0, 1.0, 0.0, 0.25))
        strength, distance = 0.5, 0.012
    elif paint == 'denim':
        h = _math(nt, 'ADD', folds(), _range(nt, _wave(nt, 300, 'Z', 0.6), 0.0, 1.0, 0.0, 0.15))
        strength, distance = 0.45, 0.012
    elif paint == 'leather':
        grain = _range(nt, _voronoi(nt, 160), 0.0, 0.12, 0.0, 0.3)
        h = _math(nt, 'ADD', folds(8.0), grain)
        strength, distance = 0.55, 0.01
    elif paint == 'metal':
        h = _range(nt, _noise(nt, 70, 3), 0.3, 0.7, 0.0, 1.0)
        strength, distance = 0.3, 0.006
    elif paint == 'hair':
        h = _range(nt, _noise(nt, 40, 4, stretch=(50, 50, 4), distortion=1.0), 0.3, 0.7, 0.0, 1.0)
        strength, distance = 0.6, 0.008
    else:
        # skin: the faintest pores, so painted faces keep their paint
        h = _range(nt, _noise(nt, 380, 2), 0.3, 0.7, 0.0, 1.0)
        strength, distance = 0.06, 0.002
    nt.links.new(h, bump.inputs['Height'])
    bump.inputs['Strength'].default_value = strength
    bump.inputs['Distance'].default_value = distance
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return bsdf


def show(mat, which):
    """Route the material output to the emission (albedo bake) or the relief BSDF (normal bake)."""
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    src = nt.nodes.get('relief') if which == 'relief' else next(n for n in nt.nodes if n.type == 'EMISSION')
    nt.links.new(src.outputs[0], out.inputs['Surface'])


def setup_cycles(samples=1):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
        scene.cycles.device = 'GPU'
    except Exception:
        scene.cycles.device = 'CPU'


def bake(hero, size, face_img=None, ao_samples=24, ao_strength=0.55, out_png=None, log=print, hair_img=None, normal_size=512):
    """Bake the albedo (and multiply in ambient occlusion); returns the atlas image."""
    me = hero.data
    for m in me.materials:
        paint_material(m, face_img, hair_img)
    albedo = bpy.data.images.new('albedo', size, size, alpha=False)
    ao = bpy.data.images.new('ao', size, size, alpha=False, float_buffer=True)
    ao.colorspace_settings.name = 'Non-Color'

    def target(img):
        for m in me.materials:
            nt = m.node_tree
            node = nt.nodes.get('bake_target') or nt.nodes.new('ShaderNodeTexImage')
            node.name = 'bake_target'
            node.image = img
            for n in nt.nodes:
                n.select = False
            node.select = True
            nt.nodes.active = node

    for o in bpy.context.selected_objects:
        o.select_set(False)
    hero.select_set(True)
    bpy.context.view_layer.objects.active = hero
    import time

    t0 = time.time()
    setup_cycles(1)
    target(albedo)
    bpy.ops.object.bake(type='EMIT', uv_layer='atlas', margin=6, margin_type='EXTEND', use_clear=True)
    log('albedo bake', f'{time.time() - t0:.1f}s', bpy.context.scene.cycles.device)
    if ao_samples:
        setup_cycles(ao_samples)
        target(ao)
        bpy.context.scene.world = bpy.context.scene.world or bpy.data.worlds.new('w')
        bpy.ops.object.bake(type='AO', uv_layer='atlas', margin=6, margin_type='EXTEND', use_clear=True)
        log('ao bake', f'{time.time() - t0:.1f}s')
    normal = None
    if normal_size:
        normal = bpy.data.images.new('normal', normal_size, normal_size, alpha=False)
        normal.colorspace_settings.name = 'Non-Color'
        for m in me.materials:
            add_relief(m)
            show(m, 'relief')
        setup_cycles(4)
        target(normal)
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', uv_layer='atlas', margin=4, margin_type='EXTEND', use_clear=True)
        log('normal bake', f'{time.time() - t0:.1f}s')
        for m in me.materials:
            show(m, 'emit')
        normal.pack()
    n = size * size * 4
    a = np.empty(n, dtype=np.float32)
    albedo.pixels.foreach_get(a)
    a = a.reshape(size, size, 4)
    if ao_samples:
        o = np.empty(n, dtype=np.float32)
        ao.pixels.foreach_get(o)
        occ = o.reshape(size, size, 4)[..., :1]
        lin = srgb_to_lin_np(a[..., :3]) * (1 - ao_strength + ao_strength * occ)
        a[..., :3] = lin_to_srgb_np(lin)
    a[..., 3] = 1
    atlas = bpy.data.images.new('atlas', size, size, alpha=False)
    atlas.pixels.foreach_set(a.reshape(-1))
    if out_png:
        atlas.filepath_raw = out_png
        atlas.file_format = 'PNG'
        atlas.save()
    atlas.pack()
    return atlas, normal


def final_material(hero, atlas, normal=None):
    """One material for export: the atlas as base colour; the game's own material takes over from here."""
    me = hero.data
    regions = [m.get('region', 'baked') for m in me.materials]
    parts = [m.get('part', 'base') for m in me.materials]
    face_region = [regions[p.material_index] for p in me.polygons]
    face_part = [parts[p.material_index] for p in me.polygons]
    meta = me.uv_layers.new(name='meta')
    for p in me.polygons:
        r = REGIONS.index(face_region[p.index]) if face_region[p.index] in REGIONS else REGIONS.index('baked')
        k = PARTS.index(face_part[p.index]) if face_part[p.index] in PARTS else 0
        for li in p.loop_indices:
            meta.data[li].uv = (r + 0.5, k + 0.5)
    if 'proj' in me.uv_layers:
        me.uv_layers.remove(me.uv_layers['proj'])
    me.materials.clear()
    m = bpy.data.materials.new('hero')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = atlas
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = 'atlas'
    nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.6
    if normal is not None:
        ntex = nt.nodes.new('ShaderNodeTexImage')
        ntex.image = normal
        nt.links.new(uvn.outputs['UV'], ntex.inputs['Vector'])
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.uv_map = 'atlas'
        nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    me.materials.append(m)
    for p in me.polygons:
        p.material_index = 0
    me.uv_layers.active = me.uv_layers['atlas']
    me.uv_layers['atlas'].active_render = True


def projection_uvs(hero, frame):
    me = hero.data
    proj = me.uv_layers.new(name='proj')
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            proj.data[li].uv = frame.uv(co)
