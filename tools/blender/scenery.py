"""
The arena's surroundings (R25), modelled by script in Blender and exported as GLBs the map instances: Italian
cypresses and olive trees with alpha leaf cards, sculpted rocks (some floating islets with grassy tops), fluted Doric
columns with capitals matching the ruins, the island's craggy underside and distant rock spires.

    Blender -b --python tools/blender/scenery.py -- --out public/scenery [--only cypress,olive,...] [--render dir]

Geometry and UVs only: materials are named (bark, cypress, olive, rock, grass, cliff, marble) and the game binds its
painted textures to them (public/textures, made from generated art by tools/textures/process.py and cutout.py).
UVs are in metres over two, the scale the ruins' painted materials tile at.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
opts = {}
for i in range(0, len(argv) - 1, 2):
    opts[argv[i].lstrip('-')] = argv[i + 1]
OUT = opts.get('out', 'public/scenery')
ONLY = set(opts['only'].split(',')) if 'only' in opts else None


MATS = {}


def reset():
    MATS.clear()
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for x in list(coll):
            coll.remove(x)


def mat(name):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        if name in ('cypress', 'olive'):
            m.blend_method = 'CLIP'
        MATS[name] = m
    return MATS[name]


def obj_from_bm(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if isinstance(material, (list, tuple)):
        for m in material:
            me.materials.append(mat(m))
    else:
        me.materials.append(mat(material))
    return o


def smooth(o, on=True):
    for p in o.data.polygons:
        p.use_smooth = on


def tris(objs):
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)


def export(path, objs):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_materials='EXPORT',
        export_image_format='NONE',
        export_texcoords=True,
        export_normals=True,
        export_vertex_color='NONE',
        export_yup=True,
        export_apply=True,
        export_meshopt_compression_enable=True,
    )
    print('SCENERY', os.path.basename(path), tris(objs), 'tris', os.path.getsize(path), 'bytes', flush=True)


def metre_uv(bm, scale=0.5, mode='box'):
    """UVs in metres (box-projected per face), so every material tiles at the ruins' scale."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        for l in f.loops:
            p = l.vert.co
            if ax == 2:
                l[uv].uv = (p.x * scale, p.y * scale)
            elif ax == 0:
                l[uv].uv = (p.y * scale, p.z * scale)
            else:
                l[uv].uv = (p.x * scale, p.z * scale)


def cylinder_uv(bm, scale=0.5):
    """UVs wrapping round the vertical axis, in metres: u along the girth, v up."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        c = f.calc_center_median()
        a0 = math.atan2(c.y, c.x)
        for l in f.loops:
            p = l.vert.co
            a = math.atan2(p.y, p.x)
            # keep a face's corners on one side of the seam
            if a - a0 > math.pi:
                a -= 2 * math.pi
            elif a0 - a > math.pi:
                a += 2 * math.pi
            r = max(0.05, (p.x * p.x + p.y * p.y) ** 0.5)
            l[uv].uv = (a * max(r, 0.3) * scale, p.z * scale)


# ------------------------------------------------------------------------------------------------ cypress


def card(bm, uv, centre, up, side, w, h, u0=0.0, u1=1.0):
    """One leaf card: a quad of size w x h, base at `centre`, rising along `up`, spread along `side`."""
    a = centre - side * (w / 2)
    b = centre + side * (w / 2)
    c = b + up * h
    d = a + up * h
    f = bm.faces.new([bm.verts.new(p) for p in (a, b, c, d)])
    for l, t in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
        l[uv].uv = t
    return f


def cypress(seed, height):
    """An Italian cypress: a short trunk, a lumpy flame-shaped crown, and leaf cards breaking its outline."""
    rnd = random.Random(seed)
    out = []
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=7, radius1=0.24, radius2=0.14, depth=2.2)
    bmesh.ops.translate(bm, vec=Vector((0, 0, 1.1)), verts=bm.verts)
    cylinder_uv(bm, 0.8)
    trunk = obj_from_bm('cypress_trunk', bm, 'bark')
    out.append(trunk)
    # the crown core: a lathed flame with lumps, dark enough inside that gaps between cards read as depth
    bm = bmesh.new()
    rings, segs = 12, 10
    radius = height * 0.085
    core_k = 0.72  # the core sits inside the cards, which carry the outline
    rows = []
    for r in range(rings + 1):
        t = r / rings
        rad = radius * math.sin(math.pi * min(1.0, 0.12 + t * 1.15)) ** 0.7 * (1 - 0.45 * t)
        z = 1.2 + (height - 1.2) * t
        row = []
        for k in range(segs):
            a = 2 * math.pi * k / segs + r * 0.4
            lump = 1 + 0.18 * noise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, t * 6 + seed)))
            row.append(bm.verts.new((math.cos(a) * rad * lump * core_k, math.sin(a) * rad * lump * core_k, z)))
        rows.append(row)
    for r in range(rings):
        for k in range(segs):
            bm.faces.new((rows[r][k], rows[r][(k + 1) % segs], rows[r + 1][(k + 1) % segs], rows[r + 1][k]))
    tip = bm.verts.new((0, 0, height + 0.3))
    for k in range(segs):
        bm.faces.new((rows[-1][k], rows[-1][(k + 1) % segs], tip))
    bm.faces.new(list(reversed(rows[0])))
    uv = bm.loops.layers.uv.verify()
    metre_uv(bm, 0.5)
    core = obj_from_bm('cypress_core', bm, 'cypress_core')
    smooth(core)
    out.append(core)
    # cards: the painted card is a whole cypress, so four big crossed cards carry the silhouette from any side,
    # and upright sprigs round the crown give it volume
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    for k in range(4):
        a = math.pi * k / 4 + rnd.uniform(-0.1, 0.1)
        side = Vector((math.cos(a), math.sin(a), 0))
        card(bm, uv, Vector((0, 0, 0.9)), Vector((0, 0, 1)), side, radius * 2.9, height - 0.5)
    count = int(14 + height * 1.5)
    for i in range(count):
        t = rnd.uniform(0.05, 0.95)
        z = 1.2 + (height - 1.2) * t
        rad = radius * math.sin(math.pi * min(1.0, 0.12 + t * 1.15)) ** 0.7 * (1 - 0.45 * t)
        a = rnd.uniform(0, 2 * math.pi)
        out_dir = Vector((math.cos(a), math.sin(a), 0))
        base = Vector((0, 0, z)) + out_dir * rad * 0.75
        up = (Vector((0, 0, 1)) + out_dir * rnd.uniform(0.15, 0.4)).normalized()
        side = Vector((-math.sin(a), math.cos(a), 0))
        side = (side + out_dir * rnd.uniform(-0.5, 0.5)).normalized()
        size = rnd.uniform(0.9, 1.5) * (1.1 - 0.4 * t)
        card(bm, uv, base - up * size * 0.35, up, side, size * 0.85, size * 1.4)
    leaves = obj_from_bm('cypress_cards', bm, 'cypress')
    out.append(leaves)
    return out


# ------------------------------------------------------------------------------------------------ olive


def tube(bm, path, radii, segs=7):
    """A tapered tube along a polyline (a branch)."""
    rings = []
    for i, p in enumerate(path):
        d = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        u = d.cross(Vector((0, 0, 1)))
        if u.length < 1e-3:
            u = d.cross(Vector((1, 0, 0)))
        u.normalize()
        v = d.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / segs) + v * math.sin(2 * math.pi * k / segs)) * radii[i]) for k in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    bm.faces.new(rings[-1])


def olive(seed):
    """A gnarled olive: a twisting trunk splitting into limbs, crowned with clusters of silvery leaf cards."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    trunk = [Vector((0, 0, 0))]
    p = Vector((0, 0, 0))
    for k in range(5):
        p = p + Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), 0.42))
        trunk.append(p.copy())
    tube(bm, trunk, [0.42, 0.34, 0.3, 0.28, 0.25, 0.22], 8)
    tips = []
    for limb in range(3):
        a = 2 * math.pi * limb / 3 + rnd.uniform(-0.4, 0.4)
        q = trunk[-1].copy()
        path = [q.copy()]
        for k in range(4):
            q = q + Vector((math.cos(a) * 0.45, math.sin(a) * 0.45, 0.45 + rnd.uniform(-0.1, 0.15)))
            a += rnd.uniform(-0.35, 0.35)
            path.append(q.copy())
        tube(bm, path, [0.2, 0.15, 0.11, 0.08, 0.05], 6)
        tips.append(q)
    cylinder_uv(bm, 0.8)
    wood = obj_from_bm('olive_trunk', bm, 'bark')
    smooth(wood)
    # the crown: leaf clusters round each limb tip and between them
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    centres = list(tips) + [(tips[i] + tips[(i + 1) % 3]) / 2 + Vector((0, 0, 0.5)) for i in range(3)] + [sum(tips, Vector()) / 3 + Vector((0, 0, 0.9))]
    for c in centres:
        for k in range(10):
            a = rnd.uniform(0, 2 * math.pi)
            el = rnd.uniform(-0.3, 0.9)
            d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
            base = c + d * rnd.uniform(0.3, 0.9)
            up = (d + Vector((0, 0, 0.6))).normalized()
            side = Vector((-math.sin(a), math.cos(a), 0)).normalized()
            size = rnd.uniform(1.0, 1.5)
            card(bm, uv, base - up * size * 0.5, up, side, size, size)
    crown = obj_from_bm('olive_cards', bm, 'olive')
    return [wood, crown]


# ------------------------------------------------------------------------------------------------ rocks


def rock(seed, size=(1.0, 1.0, 0.7), detail=3, islet=False, target=520):
    """A sculpted rock: a noisy, faceted boulder; an islet has a flat grassy top and a long craggy keel."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=detail, radius=1.0)
    off = Vector((rnd.uniform(0, 100), rnd.uniform(0, 100), rnd.uniform(0, 100)))
    for v in bm.verts:
        p = v.co.copy()
        n = noise.fractal(p * 1.3 + off, 0.6, 2.0, 4) * 0.28
        crag = noise.voronoi(p * 2.2 + off)[0][0] * -0.22
        v.co = p * (1 + n + crag)
        if islet:
            if v.co.z > 0.25:
                v.co.z = 0.25 + (v.co.z - 0.25) * 0.08  # a flat top
            else:
                v.co.z *= 1.8 + 0.6 * max(0.0, -p.z)  # a long keel
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new('rock')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(f'rock_{seed}', me)
    bpy.context.scene.collection.objects.link(o)
    tri = len(me.polygons)
    if tri > target:
        mod = o.modifiers.new('dec', 'DECIMATE')
        mod.ratio = target / tri
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='dec')
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.normal_update()
    metre_uv(bm, 0.5)
    top = []
    for f in bm.faces:
        f.material_index = 1 if islet and f.normal.z > 0.75 and f.calc_center_median().z > 0.2 * size[2] else 0
    bm.to_mesh(o.data)
    bm.free()
    o.data.materials.append(mat('rock'))
    o.data.materials.append(mat('grass'))
    for p in o.data.polygons:
        p.use_smooth = False
    return o


# ------------------------------------------------------------------------------------------------ columns


def column(height=9.0, radius=0.85, broken=False, seed=1):
    """A Doric column like the ruins': stepped base, a shaft with twenty concave flutes, echinus and abacus."""
    rnd = random.Random(seed)
    parts = []
    bm = bmesh.new()
    # base: two stepped square plinths
    for k, (w, h, z) in enumerate(((radius * 2.5, 0.28, 0.14), (radius * 2.25, 0.2, 0.38))):
        b = bmesh.ops.create_cube(bm, size=1)['verts']
        bmesh.ops.scale(bm, vec=(w, w, h), verts=b)
        bmesh.ops.translate(bm, vec=(0, 0, z), verts=b)
    shaft_h = height - (0 if broken else 0.95) - 0.48
    segs, rings = 40, 10
    rows = []
    for r in range(rings + 1):
        t = r / rings
        z = 0.48 + shaft_h * t
        rad = radius * (1 - 0.12 * t)  # entasis-free taper, as in the ruins
        row = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            flute = 1 - 0.05 * (0.5 + 0.5 * math.cos(a * 20))
            zz = z
            if broken and r == rings:
                zz = z - rnd.uniform(0, 0.9)
            row.append(bm.verts.new((math.cos(a) * rad * flute, math.sin(a) * rad * flute, zz)))
        rows.append(row)
    for r in range(rings):
        for k in range(segs):
            bm.faces.new((rows[r][k], rows[r][(k + 1) % segs], rows[r + 1][(k + 1) % segs], rows[r + 1][k]))
    bm.faces.new(rows[-1])
    if not broken:
        top = 0.48 + shaft_h
        # echinus: a cushion flaring out from the shaft to the abacus
        prof = [(radius * 0.88, 0.0), (radius * 1.02, 0.12), (radius * 1.2, 0.28), (radius * 1.3, 0.4)]
        last = None
        for rad, dz in prof:
            ring = [bm.verts.new((math.cos(2 * math.pi * k / 24) * rad, math.sin(2 * math.pi * k / 24) * rad, top + dz)) for k in range(24)]
            if last:
                for k in range(24):
                    bm.faces.new((last[k], last[(k + 1) % 24], ring[(k + 1) % 24], ring[k]))
            last = ring
        bm.faces.new(last)
        b = bmesh.ops.create_cube(bm, size=1)['verts']
        bmesh.ops.scale(bm, vec=(radius * 2.85, radius * 2.85, 0.5), verts=b)
        bmesh.ops.translate(bm, vec=(0, 0, top + 0.65), verts=b)
    bm.normal_update()
    cylinder_uv(bm, 0.6)
    o = obj_from_bm('column_broken' if broken else 'column', bm, 'marble')
    for p in o.data.polygons:
        p.use_smooth = abs(p.normal.z) < 0.5
    return o


def drum(radius=0.85, length=1.6, seed=3):
    """A fallen column drum lying on its side."""
    o = column(height=length + 0.48, radius=radius, broken=False, seed=seed)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    dead = [v for v in bm.verts if v.co.z < 0.47 or v.co.z > length + 0.48 + 0.01]
    bmesh.ops.delete(bm, geom=dead, context='VERTS')
    bmesh.ops.translate(bm, vec=(0, 0, -0.48 - length / 2), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, radius * 0.9), verts=bm.verts)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bm.normal_update()
    cylinder_uv(bm, 0.6)
    bm.to_mesh(o.data)
    bm.free()
    o.name = 'drum'
    return o


# ------------------------------------------------------------------------------------------------ the island's underside


def underside(half_x=56.0, half_z=46.0, depth=58.0, seed=5):
    """
    The rock the island floats on: a grass lip at the lawn's edge, a sheer band of cliff, then buttresses and strata
    tapering to a hanging point. Blender z is up and y is the arena's z (the export turns it).
    """
    rnd = random.Random(seed)
    bm = bmesh.new()
    segs = 96
    # (depth, radius factor) down the profile: lip, sheer cliff, shoulder, taper, point
    prof = [(0.0, 1.0), (0.7, 1.004), (3.5, 0.985), (8.0, 0.95), (13.0, 0.9), (18.0, 0.82), (24.0, 0.7), (30.0, 0.56), (36.0, 0.43), (42.0, 0.31), (48.0, 0.2), (53.0, 0.11), (depth, 0.03)]
    rows = []
    for r, (dz, k) in enumerate(prof):
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            c, s = math.cos(a), math.sin(a)
            e = 0.25
            x = math.copysign(abs(c) ** e, c) * half_x
            y = math.copysign(abs(s) ** e, s) * half_z
            if r < 2:
                row.append(bm.verts.new((x * k, y * k, -dz)))
                continue
            t = dz / depth
            # buttresses: big lobes round the island, sharper lower down
            lobe = noise.fractal(Vector((c * 1.6, s * 1.6, seed * 0.37)), 0.6, 2.0, 3)
            butt = abs(math.sin(a * 7 + seed)) ** 3 * 0.1 + abs(math.sin(a * 13 + 2 * seed)) ** 6 * 0.06
            strata = 0.035 * math.sin(dz * 1.4 + 3 * noise.noise(Vector((c * 3, s * 3, dz * 0.1))))
            kk = k * (1 + (0.16 * lobe + butt) * min(1.0, t * 3) + strata * (1 - t))
            row.append(bm.verts.new((x * kk, y * kk, -dz + rnd.uniform(-0.6, 0.6) * (r > 2))))
        rows.append(row)
    for r in range(len(rows) - 1):
        for j in range(segs):
            f = bm.faces.new((rows[r][j], rows[r][(j + 1) % segs], rows[r + 1][(j + 1) % segs], rows[r + 1][j]))
            f.material_index = 1 if r == 0 else 0
    tip = bm.verts.new((rnd.uniform(-3, 3), rnd.uniform(-3, 3), -depth - 9))
    for j in range(segs):
        bm.faces.new((rows[-1][j], rows[-1][(j + 1) % segs], tip))
    bm.normal_update()
    # cliff UVs: round the girth and down, a tile every 8 m so the painted strata sit about a metre apart
    uv = bm.loops.layers.uv.verify()
    perim = 2 * (half_x + half_z) * 1.9
    for f in bm.faces:
        cen = f.calc_center_median()
        a0 = math.atan2(cen.y, cen.x)
        for l in f.loops:
            p = l.vert.co
            a = math.atan2(p.y, p.x)
            if a - a0 > math.pi:
                a -= 2 * math.pi
            elif a0 - a > math.pi:
                a += 2 * math.pi
            l[uv].uv = (a / (2 * math.pi) * perim / 8.0, p.z / 8.0)
    o = obj_from_bm('underside', bm, ['cliff', 'grass'])
    smooth(o, False)
    return o


def spires(count=7, seed=9):
    """
    Distant rock spires rising out of the cloud sea round the island: sheer stratified pillars with grassy tops,
    their feet lost in the clouds.
    """
    rnd = random.Random(seed)
    out = bmesh.new()
    for i in range(count):
        a = 2 * math.pi * (i + rnd.uniform(-0.3, 0.3)) / count
        dist = rnd.uniform(190, 255)
        cx, cy = math.cos(a) * dist, math.sin(a) * dist
        top = rnd.uniform(-6, 30)
        base = -75.0
        rad = rnd.uniform(11, 24)
        lean = Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12)))
        bm = bmesh.new()
        segs, rings = 12, 12
        rows = []
        for r in range(rings + 1):
            t = r / rings
            z = base + (top - base) * t
            row = []
            for j in range(segs):
                ang = 2 * math.pi * j / segs
                n = noise.fractal(Vector((math.cos(ang) * 1.1, math.sin(ang) * 1.1, i * 2.3 + t * 1.4)), 0.7, 2.0, 4)
                crack = -0.12 * abs(math.sin(ang * 3 + i)) ** 8
                ledge = 0.05 * math.sin(z * 0.3 + i) + 0.04 * noise.noise(Vector((ang, z * 0.2, i)))
                rr = rad * (1.2 - 0.55 * t ** 1.4) * (1 + 0.38 * n + ledge + crack)
                off = lean * (z - base)
                row.append(bm.verts.new((cx + off.x + math.cos(ang) * rr, cy + off.y + math.sin(ang) * rr, z)))
            rows.append(row)
        for r in range(rings):
            for j in range(segs):
                bm.faces.new((rows[r][j], rows[r][(j + 1) % segs], rows[r + 1][(j + 1) % segs], rows[r + 1][j]))
        cap = bm.faces.new(rows[-1])
        cap.material_index = 1
        bm.normal_update()
        uv = bm.loops.layers.uv.verify()
        for f in bm.faces:
            cen = f.calc_center_median()
            a0 = math.atan2(cen.y - cy, cen.x - cx)
            for l in f.loops:
                p = l.vert.co
                aa = math.atan2(p.y - cy, p.x - cx)
                if aa - a0 > math.pi:
                    aa -= 2 * math.pi
                elif a0 - aa > math.pi:
                    aa += 2 * math.pi
                if f.material_index == 1:
                    l[uv].uv = ((p.x - cx) / 6.0, (p.y - cy) / 6.0)
                else:
                    # big tiles: at this distance the painted strata should read as geology, not masonry
                    l[uv].uv = (aa * rad / 26.0, p.z / 22.0)
        me = bpy.data.meshes.new('spire')
        bm.to_mesh(me)
        bm.free()
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
    o = obj_from_bm('spires', out, ['cliff', 'grass'])
    smooth(o, False)
    return o


# ------------------------------------------------------------------------------------------------ build


def main():
    os.makedirs(OUT, exist_ok=True)
    want = lambda k: ONLY is None or k in ONLY
    if want('cypress'):
        reset()
        objs = []
        for i, h in enumerate((9.0, 11.5, 13.5)):
            parts = cypress(7 + i, h)
            for o in parts:
                o.name = f'{o.name}_{i}'
            objs += parts
        export(os.path.join(OUT, 'cypress.glb'), objs)
    if want('olive'):
        reset()
        objs = []
        for i in range(2):
            parts = olive(31 + i)
            for o in parts:
                o.name = f'{o.name}_{i}'
            objs += parts
        export(os.path.join(OUT, 'olive.glb'), objs)
    if want('rocks'):
        reset()
        objs = [rock(1, (1.0, 0.8, 0.7)), rock(2, (1.2, 1.0, 0.55)), rock(3, (0.8, 0.9, 0.9)), rock(4, (1.0, 1.0, 0.6), islet=True, target=700), rock(5, (1.3, 0.9, 0.6), islet=True, target=700)]
        for i, o in enumerate(objs):
            o.name = f'rock_{i}'
        export(os.path.join(OUT, 'rocks.glb'), objs)
    if want('columns'):
        reset()
        objs = [column(9.5, 0.85), column(7.0, 0.85, broken=True, seed=2), column(4.2, 0.85, broken=True, seed=3), drum()]
        # variants by suffix: 0 standing, 1 tall broken, 2 short broken, 3 a fallen drum
        for i, o in enumerate(objs):
            o.name = f'column_{i}'
        export(os.path.join(OUT, 'columns.glb'), objs)
    if want('underside'):
        reset()
        export(os.path.join(OUT, 'underside.glb'), [underside()])
    if want('spires'):
        reset()
        export(os.path.join(OUT, 'spires.glb'), [spires()])


if __name__ == '__main__':
    main()
