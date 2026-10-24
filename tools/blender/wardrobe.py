"""
The built-in wardrobe: every item a hero can wear out of the box, built on the reference body (m-medium), the body
all twelve share a surface with, and written raw for the fit pipeline (tools/wardrobe/fit.ts), which binds each item
to that surface so one file fits every body, every physique and every face.

    Blender -b --python tools/blender/wardrobe.py -- --out .scratch/wardrobe [--only tee,kimono] [--no-thumbs]

Then `npm run wardrobe -- .scratch/wardrobe` fits them into public/kit/wear and src/kit/wear/library.gen.ts.

Each item in ITEMS is a recipe: its slot, its colour channels (a name, the colour as made, a finish), the knobs a
player may cut it with, the words a prompt may use for it, and how it's made:

  clothes   the stretch of skin a garment covers, copied off the body and pushed out by the cloth's thickness (the way
            the old heroes had their outfits baked in). Collars, cuffs, hems, lapels and ties are built on that dressed
            copy, so they stand off the cloth rather than the skin
  skirt     cloth hanging round both legs from the waist or the hips: skirts, hakama, and the lower half of robes,
            kimono, kurta and coats
  sleeves   a kimono's or a robe's wide sleeves, hanging below the arm
  cape      a panel from the shoulders down the back
  hair      the scalp lifted into a shell, in the style's shape (humanlib/hair.py), and beards from the jaw

Loose parts carry a `hang` paint (0 riding the body, 1 a free hem) that the fit turns into physics chains, and a `len`
paint (0 at the root, 1 at the longest tip) the length knob cuts along. Colours are sRGB hex.
"""

import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from humanlib import body as B  # noqa: E402
from humanlib import build  # noqa: E402
from humanlib import face as F  # noqa: E402
from humanlib import garments as G  # noqa: E402
from humanlib import hair as H  # noqa: E402
from humanlib import heroes  # noqa: E402
from humanlib import rig as R  # noqa: E402

V = Vector
ARMS = ('upper_arm', 'forearm', 'hand')


def log(*a):
    print('[wardrobe]', *a, flush=True)


def srgb(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def gltf(p):
    """Blender (z up, facing -y) to glTF (y up, facing +z)."""
    return (p.x, p.z, -p.y)


def chain_param(p, a, b, c):
    """Where p falls along the chain a, b, c: 0 at a, 0.5 at b, 1 at c (src/kit/wear/fields.ts's chainParam)."""

    def along(f, t):
        d = t - f
        s = (p - f).dot(d) / (d.length_squared or 1.0)
        return s, (p - (f + d * s)).length

    upper, up_dist = along(a, b)
    lower, low_dist = along(b, c)
    if upper <= 1 and (lower < 0 or up_dist <= low_dist):
        return 0.5 * min(1.0, max(0.0, upper))
    return 0.5 + 0.5 * max(0.0, lower)


def body_fields(w):
    """
    How far down an arm (0 shoulder, 0.5 elbow, 1 wrist) and a leg (hip, knee, ankle) each vertex of the reference
    body sits, and how far up the torso (0 crotch, 1 base of the neck, the arms reading 1): src/kit/wear/fields.ts's
    measures, the ones the sleeve, leg and hem knobs cut along.
    """
    if getattr(w, '_fields', None) is None:
        at = lambda name: w.d.bones[name][0]
        arms = [([at(f'{b}_{s}') for b in ARMS], {f'{b}_{s}' for b in ARMS}) for s in 'LR']
        legs = [([at(f'{b}_{s}') for b in ('thigh', 'shin', 'foot')], {f'{b}_{s}' for b in ('thigh', 'shin', 'foot')}) for s in 'LR']
        crotch = (at('thigh_L').z + at('thigh_R').z) / 2
        neck = at('neck').z
        arm, leg, hem = [], [], []
        for v, weights in zip(w.obj.data.vertices, w.d.vweights):
            total = sum(weights.values()) or 1.0
            on = lambda names: sum(weights.get(n, 0.0) for n in names) / total
            a = l = reach = 0.0
            for points, names in arms:
                x = on(names)
                reach += x
                if x > 0:
                    a = max(a, chain_param(v.co, *points) * x)
            for points, names in legs:
                x = on(names)
                if x > 0:
                    l = max(l, chain_param(v.co, *points) * x)
            arm.append(a)
            leg.append(l)
            hem.append((v.co.z - crotch) / (neck - crotch) * (1 - reach) + reach)
        w._fields = dict(arm=arm, leg=leg, hem=hem)
    return w._fields


# ------------------------------------------------------------------------------------------------ bodies to build on


class Surface:
    """A body to build on: the bare reference body, or a copy of it dressed in an item's own garments."""

    def __init__(self, w, obj, d):
        self.w = w
        self.obj = obj
        self.d = d
        self.head = w.head
        self.body = w.body
        self.floor = w.floor
        # the trunk and legs, arms left out: what skirts and capes must clear
        self.trunk = [v.co.copy() for v, wt in zip(obj.data.vertices, d.vweights) if sum(x for b, x in wt.items() if b.startswith(ARMS)) <= 0.2]

    def chain(self, side, s):
        """A point down an arm: 0 at the shoulder, 0.5 at the elbow, 1 at the wrist (as src/kit/wear/fields.ts measures)."""
        bones = self.d.bones
        a, b, c = bones[f'upper_arm_{side}'][0], bones[f'forearm_{side}'][0], bones[f'hand_{side}'][0]
        return a.lerp(b, s * 2) if s <= 0.5 else b.lerp(c, (s - 0.5) * 2)

    def section(self, z, band=0.025):
        """The body's horizontal cross-section at height z: trunk and leg points within `band`."""
        return [p for p in self.trunk if abs(p.z - z) <= band]

    def snap(self, p, d=None, reach=0.6):
        """Where a point lands on the surface: along `d` (from outside) or at the nearest point."""
        bvh = self.d._full_bvh()
        if d is not None:
            hit = bvh.ray_cast(p - d * reach * 0.5, d, reach)
            if hit[0] is not None:
                return hit[0], hit[1]
        loc, n, _i, _d = bvh.find_nearest(p)
        return loc, n

    def faces(self, *bones):
        return {p.index for p in self.obj.data.polygons if self.d.face_bone(p) in bones}


class Wardrobe(Surface):
    """The reference body, built exactly as build.py builds a body (same face fit, scale and topology), and rigged."""

    def __init__(self):
        spec = heroes.spec(build.REFERENCE)
        topo = build.load_topology()
        _img, lm = build.portrait_of(spec)
        fitted = {}

        def extra(human):
            if lm is not None:
                fitted.update(F.fit_face(human, lm, log=log))

        probe, split = build.build_body(spec, spec.get('targets', {}), extra=extra, faces=topo['refine'])
        targets = dict(spec.get('targets', {}), **F.fitted_targets(fitted))
        self.body, _ = build.build_body(spec, targets, scale=probe.scale, faces=split)
        self.rig = R.build_rig(self.body)
        R.merge_weights(self.body.mesh)
        obj = self.body.mesh
        mats = build.define_materials(dict(spec, mats={}), (0.62, 0.62, 0.64))
        d = G.Dresser(obj, self.rig, mats)
        d.dress([])
        me = obj.data
        me.materials.append(mats.mats['face'])
        face = len(me.materials) - 1
        skin = [i for i, m in enumerate(me.materials) if m.name == 'skin'][0]
        for p in me.polygons:
            if p.material_index == skin and d.face_bone(p) == 'head':
                p.material_index = face
        # the inside of the mouth is a piece of its own: no beard, hood or helmet may grow from it
        me.materials.append(bpy.data.materials.new('mouth'))
        mouth = len(me.materials) - 1
        for part in sorted(islands(me), key=len)[:-1]:
            for i in part:
                me.polygons[i].material_index = mouth
        self.head = H.Head(self.body, obj)
        bpy.data.objects.remove(self.body.hires, do_unlink=True)
        self.floor = min(v.co.z for v in me.vertices)
        Surface.__init__(self, self, obj, d)


class Dressed(Surface):
    """
    A copy of the body dressed in `layers` (inside out; each face takes the outermost layer covering it and every
    vertex moves out by the cloth's thickness around it). Parts built on it stand off the cloth. finish() cuts the bare
    skin away and leaves the garment: one shell however many layers, so a jacket over a shirt is a single item with a
    channel for each.
    """

    def __init__(self, w, layers, smooth=None):
        src = w.obj
        me = src.data.copy()
        obj = B.link(bpy.data.objects.new('clothes', me))
        for g in src.vertex_groups:
            if not obj.vertex_groups.get(g.name):
                obj.vertex_groups.new(name=g.name)
        me.materials.clear()
        d = G.Dresser(obj, w.rig, w.d.mats)
        d.dress(layers)
        self.layers = layers
        if smooth:
            d.smooth_region(smooth, iterations=2, factor=0.35)
        Surface.__init__(self, w, obj, d)

    def finish(self, others=()):
        """The garment alone, its edges cut clean (`others` are the item's other parts: a cuff or band over an edge)."""
        me = self.obj.data
        skin = self.d.mats.mats['skin']
        bm = bmesh.new()
        bm.from_mesh(me)
        tidy(bm)
        floor = {i: max(g.get('thick', 0.006) for g in self.layers if self.d.mats.mats[g['mat']] == m) for i, m in enumerate(me.materials) if m != skin}
        stand_off(bm, self.w, floor)
        even_edges(bm, self.w, list(me.materials).index(skin), near(others, 0.012) if others else None)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if me.materials[f.material_index] == skin], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        # humanlib eased each garment's edge down onto the skin (outfits used to be baked into the body); worn as
        # its own item, the edge must stand clear of the skin or the body shows through it (a flat face across an
        # arm sags 2 to 3 mm under the skin's curve)
        return clear_faces(clear_body(relax_edges(self.obj), self.w, margin=0.004, iterations=0), self.w)


def clothes(w, layers, smooth=None):
    return Dressed(w, layers, smooth)


# ------------------------------------------------------------------------------------------------ parts


def new_object(name, bm, mat_obj, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = B.link(bpy.data.objects.new(name, me))
    me.materials.append(mat_obj)
    for p in me.polygons:
        p.use_smooth = smooth
    return obj


def paint(obj, name, fn):
    """A per-vertex float attribute from fn(co) (the hang and len paints)."""
    me = obj.data
    a = me.attributes.get(name) or me.attributes.new(name, 'FLOAT', 'POINT')
    for v in me.vertices:
        a.data[v.index].value = max(0.0, min(1.0, fn(v.co)))
    return obj


def islands(me):
    """The mesh's pieces: polygon indices joined through shared vertices, one list per piece."""
    faces_of = [[] for _ in me.vertices]
    for p in me.polygons:
        for v in p.vertices:
            faces_of[v].append(p.index)
    seen = [False] * len(me.polygons)
    out = []
    for p in me.polygons:
        if seen[p.index]:
            continue
        seen[p.index] = True
        stack, part = [p.index], []
        while stack:
            f = stack.pop()
            part.append(f)
            for v in me.polygons[f].vertices:
                for g in faces_of[v]:
                    if not seen[g]:
                        seen[g] = True
                        stack.append(g)
        out.append(part)
    return out


def clear_body(obj, s, margin=0.004, thickness=0.0, where=None, iterations=4):
    """
    Push whatever lies in (or within `margin` of) surface `s` back out over it, smoothing the stretch it moves so the
    shape survives: long hair over the shoulders, a collar's front up the throat. A solid shell keeps its thickness:
    its outer side (facing away from the body) stops `thickness` further out. `where(point)` limits what moves.
    """
    bvh = s.d._full_bvh()
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    stand = {}
    for v in bm.verts:
        if where is None or where(v.co):
            loc, n, _i, _d = bvh.find_nearest(v.co)
            if loc is not None:
                stand[v] = margin + (thickness if v.normal.dot(n) > 0 else 0.0)

    def push(v):
        loc, n, _i, _d = bvh.find_nearest(v.co)
        gap = (v.co - loc).dot(n)
        if gap >= stand[v]:
            return False
        v.co += n * (stand[v] - gap)
        return True

    moved = {v for v in stand if push(v)}
    near = moved | {e.other_vert(v) for v in moved for e in v.link_edges if e.other_vert(v) in stand}
    for _ in range(iterations if moved else 0):
        avg = {v: sum((e.other_vert(v).co for e in v.link_edges), V()) / len(v.link_edges) for v in near if v.link_edges}
        for v, q in avg.items():
            v.co = v.co.lerp(q, 0.5)
        for v in near:
            push(v)
    bm.to_mesh(me)
    bm.free()
    me.update()
    log(f'  {obj.name}: pushed {len(moved)} vertices out of the body')
    return obj


# where on a triangle clear_faces() looks: its middle, its edges' middles and its corners' thirds
SAMPLES = ((1 / 3, 1 / 3, 1 / 3), (0.5, 0.5, 0), (0, 0.5, 0.5), (0.5, 0, 0.5), (2 / 3, 1 / 6, 1 / 6), (1 / 6, 2 / 3, 1 / 6), (1 / 6, 1 / 6, 2 / 3))


def clear_faces(obj, s, margin=0.003, iterations=4):
    """
    Lift a garment's faces, not only its corners, clear of surface `s`: a big face across a curved stretch (the cut
    leaves some round a shin) sags between its corners, and the body shows through. Each triangle is sampled across;
    where a sample sits within `margin` of the skin, its corners move out by what's missing.
    """
    bvh = s.d._full_bvh()
    me = obj.data
    for _ in range(iterations):
        me.calc_loop_triangles()
        push = {}
        for tri in me.loop_triangles:
            a, b, c = (me.vertices[i].co for i in tri.vertices)
            for x, y, z in SAMPLES:
                p = a * x + b * y + c * z
                loc, n, _i, _d = bvh.find_nearest(p)
                if loc is None:
                    continue
                off = p - loc
                # beside a corner of the body (round the toes, say) the nearest face's normal says little: there a
                # point is outside by its distance, and only one behind that face is in
                inside = off.dot(n) < -0.5 * off.length
                short = margin + off.length if inside else margin - off.length
                # a push of more than a centimetre means a face of the body wound the wrong way, not a sag
                if 0 < short < 0.012:
                    away = n if inside or off.length < 1e-6 else off.normalized()
                    for i in tri.vertices:
                        if short > push.get(i, (0.0, None))[0]:
                            push[i] = (short, away)
        if not push:
            break
        for i, (short, n) in push.items():
            me.vertices[i].co += n * short
    me.update()
    return obj


def tidy(bm, passes=3):
    """
    A garment's edge follows whole faces, so it comes out ragged: a notch of bare skin in a hem, a lone face of cloth
    out on the skin. A face that three in four of its neighbours disagree with takes their material.
    """
    for _ in range(passes):
        flips = []
        for f in bm.faces:
            around = [g.material_index for e in f.edges for g in e.link_faces if g is not f]
            if len(around) < 3:
                continue
            best = max(set(around), key=around.count)
            if best != f.material_index and around.count(best) * 4 >= len(around) * 3:
                flips.append((f, best))
        for f, m in flips:
            f.material_index = m


def stand_off(bm, w, floor):
    """
    Stand every vertex of cloth at least its cloth's thickness (`floor`, by material index) off the skin. The dressing
    eased each garment's edge down onto the skin, and tidy() may have clothed a face that was bare; either leaves the
    body poking through. Call it before the dressed copy's topology changes (vertices still match the body's).
    """
    ref = w.obj.data.vertices
    bm.verts.index_update()
    for v in bm.verts:
        t = max((floor.get(f.material_index, 0.0) for f in v.link_faces), default=0.0)
        r = ref[v.index]
        lift = (v.co - r.co).dot(r.normal)
        if lift < t:
            v.co += r.normal * (t - lift)


def near(parts, reach):
    """A test for points within `reach` of any of `parts` (a cuff or a band already covering a garment's edge)."""
    trees = []
    for p in parts:
        me = p.data
        if me.polygons:
            trees.append(BVHTree.FromPolygons([p.matrix_world @ v.co for v in me.vertices], [list(f.vertices) for f in me.polygons]))
    return lambda q: any(t.find_nearest(q, reach)[0] is not None for t in trees)


def split_along(bm, faces, val, cut):
    """
    Split `faces` along the level `cut` of the per-vertex values `val` (filled in for the vertices the split adds):
    each edge crossing it splits where it crosses, and each face it crosses splits in two. Returns the faces after
    the split and the vertices on the cut.
    """
    # nothing sits exactly on the cut, so every crossing edge splits inside itself
    for v, x in val.items():
        if abs(x - cut) < 1e-5:
            val[v] = cut - 2e-5
    faces = set(faces)
    crossing = {e for f in faces for e in f.edges if (val[e.verts[0]] <= cut) != (val[e.verts[1]] <= cut)}
    ends = set()
    for e in crossing:
        a, b = e.verts
        s = (cut - val[a]) / (val[b] - val[a])
        at = a.co.lerp(b.co, s)
        _e, nv = bmesh.utils.edge_split(e, a, s)
        nv.co = at
        val[nv] = cut
        ends.add(nv)
    for f in list(faces):
        pair = [v for v in f.verts if v in ends]
        if len(pair) == 2:
            try:
                made, _loop = bmesh.utils.face_split(f, pair[0], pair[1])
                faces.add(made)
            except ValueError:
                pass
    return faces, ends


# which measure an edge runs along: (field, least mean, most spread); a hem's mean must stay below the chest
EDGE_FIELDS = (('arm', 0.08, 0.2), ('leg', 0.08, 0.2), ('hem', None, 0.12))


def even_edges(bm, w, skin, covered=None, rings=3):
    """
    Cut each sleeve end, trouser end and hem straight along the body's own measure (how far down the arm or the leg,
    how far up the torso). A garment covers whole faces, so its edge steps a face at a time and leaves notches of bare
    skin; here the faces round such an edge are cut afresh at the edge's middle value, the notches filled with cloth at
    the garment's thickness. Necklines, armholes and open fronts follow no single measure and stay as they are, and so
    does any edge a cuff or band already covers (`covered`). `bm` is the dressed copy before its skin is cut away.
    """
    fields = body_fields(w)
    ref = w.obj.data.vertices
    orig = {v: v.index for v in bm.verts}
    owner = {}
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) == 2 and (fs[0].material_index == skin) != (fs[1].material_index == skin):
            owner[e] = fs[1].material_index if fs[0].material_index == skin else fs[0].material_index
    seen = set()
    for start, m in owner.items():
        if start in seen:
            continue
        seen.add(start)
        stack, verts = [start], set()
        while stack:
            e = stack.pop()
            for v in e.verts:
                verts.add(v)
                for g in v.link_edges:
                    if g not in seen and owner.get(g) == m:
                        seen.add(g)
                        stack.append(g)
        if len(verts) < 6:
            continue
        for name, least, spread in EDGE_FIELDS:
            vals = [fields[name][orig[v]] for v in verts]
            mean = sum(vals) / len(vals)
            if (mean > least if least is not None else mean < 0.8) and max(vals) - min(vals) < spread:
                break
        else:
            continue
        field = fields[name]
        inner = {u for v in verts for f in v.link_faces if f.material_index == m for u in f.verts} - verts
        outer = {u for v in verts for f in v.link_faces if f.material_index == skin for u in f.verts} - verts
        if not inner or not outer or (covered and sum(1 for v in verts if covered(v.co)) * 2 > len(verts)):
            continue
        below = sum(field[orig[v]] for v in inner) / len(inner) < sum(field[orig[v]] for v in outer) / len(outer)
        cut = sorted(vals)[len(vals) // 2]
        region = set()
        front = {f for v in verts for f in v.link_faces if f.material_index in (m, skin)}
        for _ in range(rings):
            region |= front
            front = {g for f in front for v in f.verts for g in v.link_faces if g not in region and g.material_index in (m, skin)}
        rverts = {v for f in region for v in f.verts}
        if any(v not in orig for v in rverts):
            continue  # another edge's cut already reached here

        def lift(v):
            r = ref[orig[v]]
            return (v.co - r.co).dot(r.normal)

        clothed = sorted(lift(v) for v in rverts if all(f.material_index != skin for f in v.link_faces))
        if not clothed:
            continue
        thick = clothed[len(clothed) // 2]
        # the cloth's edge was eased down onto the skin: stand every vertex near it at full thickness
        for v in rverts:
            if any(f.material_index == skin for f in v.link_faces):
                v.co += ref[orig[v]].normal * max(0.0, thick - lift(v))
        keep = (lambda x: x <= cut) if below else (lambda x: x >= cut)
        val = {v: field[orig[v]] for v in rverts}
        region, ends = split_along(bm, region, val, cut)
        for f in region:
            rest = [val[v] for v in f.verts if v not in ends]
            f.material_index = m if all(keep(x) for x in rest) else skin
        log(f'  {name} edge cut at {cut:.3f} ({"below" if below else "above"}), {len(ends)} edges split')


def relax_edges(obj, iterations=8, factor=0.5, ring=False):
    """
    Straighten an open edge that steps along whole faces (a hem, a sleeve end, a hairline): slide each of its vertices
    toward its two neighbours along the edge (and with `ring`, the row just inside after them), all kept on the surface
    they started on. Corners where edges meet stay.
    """
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bvh = BVHTree.FromBMesh(bm)
    nbr = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts
            nbr.setdefault(a, []).append(b)
            nbr.setdefault(b, []).append(a)
    ring = ({e.other_vert(v) for v in nbr for e in v.link_edges} - set(nbr)) if ring else set()

    def snap(p):
        hit = bvh.find_nearest(p)
        return hit[0] if hit[0] is not None else p

    for _ in range(iterations):
        moved = {v: v.co.lerp((ns[0].co + ns[1].co) / 2, factor) for v, ns in nbr.items() if len(ns) == 2}
        for v, p in moved.items():
            v.co = snap(p)
        inner = {v: v.co.lerp(sum((e.other_vert(v).co for e in v.link_edges), V()) / len(v.link_edges), 0.3) for v in ring}
        for v, p in inner.items():
            v.co = snap(p)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return obj


def hull2d(points):
    """Convex hull of (x, y) points, counter-clockwise (Andrew's monotone chain)."""
    pts = sorted(set((round(p[0], 5), round(p[1], 5)) for p in points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def hull_radius(hull, c, theta):
    """How far from c, toward bearing theta (0 the hero's front, -y; positive to the hero's left, +x), the hull reaches."""
    d = (math.sin(theta), -math.cos(theta))
    best = 0.0
    n = len(hull)
    for i in range(n):
        a = hull[i]
        b = hull[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-12:
            continue
        ax, ay = a[0] - c[0], a[1] - c[1]
        t = (ax * ey - ay * ex) / den
        u = (ax * d[1] - ay * d[0]) / den
        if t > 0 and -1e-6 <= u <= 1 + 1e-6:
            best = max(best, t)
    return best


def grid_faces(bm, grid, uv, wrap, keep=None):
    """Quads between consecutive rows of a vertex grid (wrapping round when `wrap`), with UVs across and down."""
    rows = len(grid)
    cols = len(grid[0])
    span = cols if wrap else cols - 1
    for r in range(rows - 1):
        for k in range(span):
            if keep is not None and not keep(k):
                continue
            k2 = (k + 1) % cols
            f = bm.faces.new((grid[r][k], grid[r][k2], grid[r + 1][k2], grid[r + 1][k]))
            for loop, (uu, vv) in zip(f.loops, ((k, r), (k + 1, r), (k + 1, r + 1), (k, r + 1))):
                loop[uv].uv = (uu / span, vv / (rows - 1))


def skirt(s, mat, top='waist', hem=0.45, flare=0.06, ease=0.018, pleats=0, pleat_depth=0.0, gap=0.0, segs=36, ride=0.07, name='skirt'):
    """
    Cloth hanging round both legs: rings from the top (the waist, or the hips) down to the hem, each wide enough to
    clear the legs at rest (and whatever `s` already wears there), flaring by `flare` toward the hem and never drawing
    back in. `hem` is how far down, 0 the top and 1 the floor. `gap` opens the front (a coat), in radians; `pleats`
    folds it. The top `ride` metres sit on the body; below that it hangs.
    """
    d = s.d
    top_z = {'waist': d.waist_z + 0.03, 'hip': d.hip_z + 0.04, 'low': d.hip_z - 0.02}[top]
    hem_z = top_z - hem * (top_z - (s.floor + 0.03))
    rings = max(4, round((top_z - hem_z) / 0.045) + 1)
    c = (0.0, d.bones['hips'][0].y)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = []
    prev = None
    for r in range(rings):
        t = r / (rings - 1)
        z = top_z + (hem_z - top_z) * t
        pts = [(p.x, p.y) for p in s.section(z)]
        hull = hull2d(pts) if len(pts) >= 3 else [(0.12, c[1]), (0, c[1] + 0.1), (-0.12, c[1]), (0, c[1] - 0.1)]
        radii = []
        for k in range(segs):
            th = 2 * math.pi * k / segs
            rr = hull_radius(hull, c, th) + ease * (0.6 if r == 0 else 1.0) + flare * t**1.3
            if pleats:
                rr += pleat_depth * t * abs(math.sin(th * pleats / 2))
            if prev is not None:
                rr = max(rr, prev[k])
            radii.append(rr)
        prev = radii
        grid.append([bm.verts.new((c[0] + radii[k] * math.sin(2 * math.pi * k / segs), c[1] - radii[k] * math.cos(2 * math.pi * k / segs), z)) for k in range(segs)])
    # an open front drops the faces either side of the bearing straight ahead
    keep = (lambda k: gap / 2 <= 2 * math.pi * (k + 0.5) / segs <= 2 * math.pi - gap / 2) if gap else None
    grid_faces(bm, grid, uv, wrap=True, keep=keep)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.normal_update()
    for f in bm.faces:
        m = f.calc_center_median()
        if V((m.x - c[0], m.y - c[1], 0)).dot(f.normal) < 0:
            f.normal_flip()
    obj = new_object(name, bm, d.mats.mats[mat])
    span = max(1e-3, top_z - hem_z)
    paint(obj, 'hang', lambda p: (top_z - ride - p.z) / max(1e-3, span - ride))
    paint(obj, 'len', lambda p: (top_z - p.z) / span)
    return obj


def sleeves(s, mat, start=0.12, end=0.98, drop=0.26, ease=0.03, segs=16, rings=9, flare=0.0, name='sleeve'):
    """
    Wide sleeves hanging below the arm (a kimono's, a wizard's): rings down the arm from `start` to `end` (0 the
    shoulder, 1 the wrist), loose by `ease` over whatever the arm wears, their lower half pulled straight down by `drop`
    once past the shoulder, and opening by `flare` toward the cuff (a bell sleeve).
    """
    out = []
    for side in 'LR':
        arm = s.faces(f'upper_arm_{side}', f'forearm_{side}', f'hand_{side}')
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        grid = []
        hang = []
        centres = []
        for i in range(rings):
            u = start + (end - start) * i / (rings - 1)
            c = s.chain(side, u)
            a = (s.chain(side, min(1.0, u + 0.02)) - s.chain(side, max(0.0, u - 0.02))).normalized()
            ring = s.d.ring_points(c, a, V((0, 0, 1)), segs, radius=0.25, faces=arm)
            grow = min(1.0, (u - start) / 0.18)
            row = []
            for p in ring:
                radial = p - c
                radial -= a * radial.dot(a)
                rl = max(1e-4, radial.length)
                q = c + radial * ((rl + ease + flare * (u - start) / max(1e-3, end - start)) / rl)
                below = max(0.0, -radial.normalized().z)
                down = drop * grow * below**1.2
                q.z -= down
                row.append(bm.verts.new(q))
                hang.append(down / max(1e-3, drop))
            grid.append(row)
            centres.append(c)
        grid_faces(bm, grid, uv, wrap=True)
        bm.normal_update()
        # outward: away from the arm's own line
        for f in bm.faces:
            m = f.calc_center_median()
            near = min(centres, key=lambda c: (c - m).length)
            if (m - near).dot(f.normal) < 0:
                f.normal_flip()
        obj = new_object(f'{name}_{side}', bm, s.d.mats.mats[mat])
        a = obj.data.attributes.new('hang', 'FLOAT', 'POINT')
        for i, h in enumerate(hang):
            a.data[i].value = max(0.0, min(1.0, (h - 0.15) / 0.85))
        out.append(obj)
    return out


def cape(s, mat, length=0.95, flare=0.4, cols=11, rows=13, ease=0.03, width=1.0, name='cape'):
    """
    A panel from the shoulders down the back: every row hangs clear of the back, the seat and the calves (and stays
    clear of the rows above it, so it falls straight), widening by `flare` toward the hem.
    """
    d = s.d
    half = (d.bones['upper_arm_L'][0].x + 0.02) * width
    top_z = d.neck.z - 0.02
    behind = [p for p in s.trunk if p.y > d.bones['hips'][0].y - 0.05]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = []
    back = [None] * (cols + 1)
    for r in range(rows + 1):
        t = r / rows
        z = top_z - length * t
        row = []
        for c in range(cols + 1):
            u = c / cols * 2 - 1
            x = u * half * (1 + flare * t)
            near = [p.y for p in behind if abs(p.x - x) < 0.05 and abs(p.z - z) < 0.04]
            y = max(near, default=d.bones['hips'][0].y + 0.1) + ease + 0.05 * t
            back[c] = max(back[c] or y, y)
            row.append(bm.verts.new(V((x, back[c], z))))
        grid.append(row)
    grid_faces(bm, grid, uv, wrap=False)
    bm.normal_update()
    for f in bm.faces:
        if f.normal.y < 0:
            f.normal_flip()
    obj = new_object(name, bm, d.mats.mats[mat])
    paint(obj, 'hang', lambda p: (top_z - 0.08 - p.z) / max(1e-3, length - 0.08))
    paint(obj, 'len', lambda p: (top_z - p.z) / length)
    return obj


def band(s, mat, centre, axis, height, offset, count=24, flare=0.0, radius=0.4, faces=None, name='band'):
    """A ring band (belt, obi, cuff, hem) round `s`'s surface: humanlib's, in this item's channel."""
    return s.d.band(name, centre, axis, V((1, 0, 0)), height, offset, mat, count=count, flare=flare, radius=radius, faces=faces)


def gear(s, kind, clear=None, thick=0.0, **args):
    """humanlib's gear on surface `s`; with `clear`, pushed that far out of it wherever it sank in (see clear_body)."""
    made = build.GEAR[kind](s.d, s.head, s.body, **args)
    made = [x for x in (made if isinstance(made, list) else [made]) if x]
    return [clear_body(x, s, margin=clear, thickness=thick) for x in made] if clear is not None else made


def head_shell(w, mat, lift, region, name='cap', thickness=0.0):
    """A shell over the head's skin where `region(poly)` says, lifted by `lift(point, normal)`: beanies, hoods, helmets."""
    skin_idx = [i for i, m in enumerate(w.obj.data.materials) if m.name in ('skin', 'face')]

    def pick(poly):
        return poly.material_index in skin_idx and w.d.face_bone(poly) in ('head', 'neck') and region(poly)

    shell = w.d.shell(name, pick, lift, thickness, mat)
    return relax_edges(shell) if shell is not None and not thickness else shell


def ball(s, mat, centre, radius, scale=(1, 1, 1), name='ball', segs=12, rings=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ Matrix.Diagonal((radius * scale[0], radius * scale[1], radius * scale[2], 1)), verts=bm.verts)
    return new_object(name, bm, s.d.mats.mats[mat])


def disc(s, mat, centre, normal, radius, segs=16, name='disc'):
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=segs, radius=radius)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ V((0, 0, 1)).rotation_difference(normal).to_matrix().to_4x4(), verts=bm.verts)
    return new_object(name, bm, s.d.mats.mats[mat])


# ------------------------------------------------------------------------------------------------ hair and beards

# styles beyond humanlib's: big, slick, shaved for a crest, and tied back
H.STYLES.update(
    {
        'afro': dict(top=0.075, side=0.07, back=0.072, lumps=0.012),
        'slicked': dict(top=0.009, side=0.005, back=0.007, sweep=0.012, lift=0.002),
        'mohawk_base': dict(top=0.002, side=0.0015, back=0.0015),
        'tied': dict(top=0.008, side=0.006, back=0.007, sweep=0.01),
    }
)


# how a style's surface is worked once it's finer: curls (how far in and out, how tight) and spikes
HAIR_DETAIL = {'curly': dict(curls=(0.006, 70)), 'afro': dict(curls=(0.011, 34)), 'spiky': dict(spikes=18)}


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def refine(obj, smooth=0.5):
    """Each face into four, rounded off: a coarse shell reads as a helmet, and too few faces can't carry curls."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True, smooth=smooth)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def curls(obj, amp, scale):
    """The surface pushed in and out along its normals by a noise field; the dipped hairline stays put."""
    from mathutils import noise

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    for v in bm.verts:
        if not v.is_boundary:
            v.co += v.normal * amp * noise.noise(v.co * scale)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def spikes(w, mat, count=18, length=0.06, width=0.018, name='spikes'):
    """Spikes of hair standing up off the crown and leaning back, spread evenly over the top of the head."""
    h = w.head
    bm = bmesh.new()
    golden = math.pi * (3 - math.sqrt(5))
    for k in range(count):
        up = 0.3 + 0.7 * (k + 0.5) / count
        a = k * golden
        r = math.sqrt(1 - up * up)
        direction = V((r * math.sin(a), r * math.cos(a), up))
        if direction.y < -0.55 and up < 0.6:
            continue  # the face stays clear
        q, n = w.snap(h.centre + direction * 0.3, -direction)
        lean = (n + V((0, 0.5, 0.35))).normalized()
        base = q + n * 0.006
        tip = q + lean * (0.03 + length * (0.75 + 0.5 * ((k * 7919) % 13) / 12))
        u = n.cross(V((0, 0, 1)))
        u = u.normalized() if u.length > 1e-6 else V((1, 0, 0))
        v2 = n.cross(u)
        corners = [bm.verts.new(base + (u * math.cos(t) + v2 * math.sin(t)) * width) for t in (0, math.pi / 2, math.pi, 1.5 * math.pi)]
        top = bm.verts.new(tip)
        for i in range(4):
            bm.faces.new((corners[i], corners[(i + 1) % 4], top))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_object(name, bm, w.d.mats.mats[mat])


def hair(w, style, mat='hair', **k):
    """A humanlib hairstyle, finer where its budget allows, with its hang and len paints along whatever falls below the hairline."""
    h = relax_edges(H.make_hair(w.d, w.head, style, mat=mat, **k))
    if triangles(h) * 4 <= 3000:
        refine(h)
    detail = HAIR_DETAIL.get(style, {})
    if 'curls' in detail:
        curls(h, *detail['curls'])
    drop = H.STYLES[style].get('drop', 0.0)
    if drop:
        head = w.head
        line = lambda p: head.hairline(p, k.get('recede', 0.0), k.get('temple', 0.0), k.get('nape', 0.0), k.get('sideburn', 0.0))
        # what falls below the hairline hangs straight down from it: over the nape and the shoulders, not through them
        clear_body(h, w, margin=0.006, thickness=0.005, where=lambda p: line(p) - 0.02 - p.z > 0)
        paint(h, 'hang', lambda p: (line(p) - 0.02 - p.z) / max(0.03, drop * 0.8))
        paint(h, 'len', lambda p: (line(p) - p.z) / max(0.03, drop))
    return [h] + ([spikes(w, mat, detail['spikes'])] if 'spikes' in detail else [])


def tail(w, mat, root, length=0.28, radius=0.022, tip=0.006, segs=10, rings=9, bend=0.06, name='tail', braid=False):
    """A ponytail or braid: a tube from `root` on the back of the head falling down the back, swinging from its root."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    path = [root + V((0, bend * math.sin(i / (rings - 1) * math.pi * 0.6) + 0.02 * i / (rings - 1), -length * i / (rings - 1))) for i in range(rings)]
    grid = []
    for i, c in enumerate(path):
        t = i / (rings - 1)
        a = (path[min(i + 1, rings - 1)] - path[max(i - 1, 0)]).normalized()
        u = a.cross(V((1, 0, 0))).normalized()
        v = a.cross(u)
        r = radius + (tip - radius) * t**1.5
        if braid:
            r *= 0.85 + 0.25 * abs(math.sin(t * math.pi * (rings - 1) * 0.5))
        grid.append([bm.verts.new(c + (u * math.cos(2 * math.pi * k / segs) + v * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
    grid_faces(bm, grid, uv, wrap=True)
    bm.faces.new(grid[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    obj = new_object(name, bm, w.d.mats.mats[mat])
    top = root.z
    paint(obj, 'hang', lambda p: (top - 0.03 - p.z) / max(0.05, length - 0.03))
    paint(obj, 'len', lambda p: (top - p.z) / length)
    return obj


def crown_back(w, up=0.0, out=0.0):
    """A point on the back of the head, high up: where a ponytail or a braid is tied."""
    h = w.head
    q, n = w.snap(V((0, h.back + 0.3, h.eyes.z + 0.05 + up)), V((0, -1, 0)))
    return q + n * (0.012 + out)


def mohawk(w, mat, height=0.07, width=0.018, name='crest'):
    """A crest of hair along the scalp's midline, tallest over the crown."""
    h = w.head
    bm = bmesh.new()
    rows = []
    n = 14
    for k in range(n + 1):
        a = math.pi * (0.06 + 0.86 * k / n)
        y = h.centre.y - math.cos(a) * (h.back - h.front) * 0.52
        q, nrm = w.snap(V((0, y, h.top + 0.3)), V((0, 0, -1)))
        tall = height * (0.55 + 0.45 * math.sin(a)) * (1.0 if k % 2 == 0 else 0.7)
        base = q - nrm * 0.004
        tip = q + nrm * tall + V((0, 0.012 * math.cos(a), 0))
        rows.append([bm.verts.new(base + V((-width, 0, 0))), bm.verts.new(tip + V((-width * 0.25, 0, 0))), bm.verts.new(tip + V((width * 0.25, 0, 0))), bm.verts.new(base + V((width, 0, 0)))])
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(3):
            bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_object(name, bm, w.d.mats.mats[mat])


def beard(w, style, mat='beard', depth=None):
    b = H.make_beard(w.d, w.head, style, mat=mat, depth=depth)
    return [relax_edges(b)] if b else []


def long_beard(w, mat='beard', length=0.13):
    """A full beard falling past the chin to a point, swinging below the jaw."""
    parts = beard(w, 'full', mat, depth=0.016)
    b = parts[0]
    h = w.head
    bm = bmesh.new()
    bm.from_mesh(b.data)
    edge = [e for e in bm.edges if e.is_boundary and (e.verts[0].co.z + e.verts[1].co.z) / 2 < h.chin.z + 0.01 and abs((e.verts[0].co.x + e.verts[1].co.x) / 2) < 0.06]
    current = edge
    for _ in range(3):
        res = bmesh.ops.extrude_edge_only(bm, edges=current)
        new = [x for x in res['geom'] if isinstance(x, bmesh.types.BMVert)]
        for v in new:
            v.co.z -= length / 3
            v.co.x *= 0.72
            v.co.y -= 0.02
        ns = set(new)
        current = [x for x in res['geom'] if isinstance(x, bmesh.types.BMEdge) and all(vv in ns for vv in x.verts)]
    bm.to_mesh(b.data)
    bm.free()
    chin = h.chin.z
    paint(b, 'hang', lambda p: (chin - 0.01 - p.z) / length)
    paint(b, 'len', lambda p: (chin + 0.01 - p.z) / (length + 0.01))
    return parts


def moustache(w, mat='beard', depth=0.008):
    h = w.head
    skin_idx = [i for i, m in enumerate(w.obj.data.materials) if m.name in ('skin', 'face')]

    def region(poly):
        c = poly.center
        if poly.material_index not in skin_idx or w.d.face_bone(poly) != 'head' or c.y > h.centre.y:
            return False
        return abs(c.x) < abs(h.mouth_l.x) + 0.012 and h.lip_top.z - 0.004 < c.z < h.nose_base.z - 0.002

    m = w.d.shell('moustache', region, lambda p, n: depth, 0.0, mat)
    if m is None:
        return []
    bm = bmesh.new()
    bm.from_mesh(m.data)
    bm.normal_update()
    for v in bm.verts:
        if v.is_boundary:
            v.co -= v.normal * (depth * 0.9 + 0.003)
    bm.to_mesh(m.data)
    bm.free()
    return [relax_edges(m)]


# ------------------------------------------------------------------------------------------------ the catalogue


class Item:
    def __init__(self, id, name, slot, channels, make, knobs=(), tags=(), hides=None, stiff=None):
        self.id = id
        self.name = name
        self.slot = slot
        # (name, '#rrggbb', finish)
        self.channels = channels
        self.make = make
        self.knobs = list(knobs)
        self.tags = list(tags)
        self.hides = hides
        self.stiff = stiff


ITEMS = []


def item(id, name, slot, channels, knobs=(), tags=(), hides=None, stiff=None):
    def wrap(fn):
        ITEMS.append(Item(id, name, slot, channels, fn, knobs, tags, hides, stiff))
        return fn

    return wrap


# hair --------------------------------------------------------------------------------------------------------------

HAIR = '#2a1d14'
HAIR_CH = [('hair', HAIR, 'silk')]
HAIR_STYLES = [
    ('buzz', 'Buzz cut', ['buzz cut', 'buzzcut', 'shaved head', 'military cut']),
    ('crop', 'Crop', ['crop', 'crew cut', 'short crop']),
    ('short', 'Short', ['short hair', 'short']),
    ('curly', 'Curls', ['curly hair', 'curls', 'curly']),
    ('swept', 'Swept back', ['swept back', 'swept', 'pushed back']),
    ('quiff', 'Quiff', ['quiff', 'pompadour', 'rockabilly']),
    ('side_part', 'Side part', ['side part', 'parted hair', 'side parting']),
    ('thin', 'Thinning', ['thinning hair', 'balding', 'receding']),
    ('fringe_white', 'Short fringe', ['fringe', 'short bangs']),
    ('unkempt', 'Unkempt', ['unkempt', 'messy hair', 'shaggy']),
    ('bob', 'Bob', ['bob', 'bob cut', 'chin length']),
    ('long', 'Long', ['long hair', 'long']),
    ('volume', 'Big volume', ['voluminous', 'big hair', 'volume']),
    ('spiky', 'Spiky', ['spiky hair', 'spiky', 'spikes', 'anime hair']),
    ('slicked', 'Slicked back', ['slicked back', 'slick', 'gelled']),
    ('afro', 'Afro', ['afro', 'big curly hair', 'fro']),
]
for _sid, _name, _tags in HAIR_STYLES:
    item(f'hair_{_sid}', _name, 'hair', HAIR_CH, knobs=['length'] if H.STYLES[_sid].get('drop') else [], tags=_tags, hides=False)(lambda w, sid=_sid: hair(w, sid))


@item('hair_ponytail', 'Ponytail', 'hair', HAIR_CH, knobs=['length'], tags=['ponytail', 'pony tail', 'tied back'], hides=False)
def _ponytail(w):
    return hair(w, 'tied') + [tail(w, 'hair', crown_back(w), length=0.3, radius=0.024)]


@item('hair_braid', 'Braid', 'hair', HAIR_CH, knobs=['length'], tags=['braid', 'plait', 'braided'], hides=False)
def _braid(w):
    return hair(w, 'tied') + [tail(w, 'hair', crown_back(w, up=-0.05), length=0.42, radius=0.022, tip=0.012, rings=15, braid=True)]


@item('hair_top_knot', 'Top knot', 'hair', HAIR_CH, tags=['top knot', 'man bun', 'bun', 'samurai topknot', 'chonmage'], hides=False)
def _top_knot(w):
    h = w.head
    q, n = w.snap(V((0, h.centre.y + 0.02, h.top + 0.3)), V((0, 0, -1)))
    return hair(w, 'tied') + [ball(w, 'hair', q + n * 0.03, 0.035, (1, 0.9, 0.85), name='bun')]


@item('hair_mohawk', 'Mohawk', 'hair', HAIR_CH, tags=['mohawk', 'mohican', 'punk'], hides=False)
def _mohawk(w):
    return hair(w, 'mohawk_base') + [mohawk(w, 'hair')]


# beards ------------------------------------------------------------------------------------------------------------

BEARD_CH = [('beard', HAIR, 'silk')]
item('beard_full', 'Full beard', 'beard', BEARD_CH, tags=['full beard', 'beard', 'bearded'], hides=False)(lambda w: beard(w, 'full'))
item('beard_goatee', 'Goatee', 'beard', BEARD_CH, tags=['goatee', 'van dyke'], hides=False)(lambda w: beard(w, 'goatee'))
item('beard_chin_curtain', 'Chin curtain', 'beard', BEARD_CH, tags=['chin curtain', 'amish beard', 'lincoln beard'], hides=False)(lambda w: beard(w, 'chin_curtain'))
item('beard_stubble', 'Stubble', 'beard', [('beard', '#3b3430', 'knit')], tags=['stubble', 'five o clock shadow', 'scruff'], hides=False)(lambda w: beard(w, 'full', depth=0.002))
item('beard_moustache', 'Moustache', 'beard', BEARD_CH, tags=['moustache', 'mustache', 'tache'], hides=False)(lambda w: moustache(w))
item('beard_long', 'Long beard', 'beard', BEARD_CH, knobs=['length'], tags=['long beard', 'wizard beard', 'viking beard'], hides=False)(lambda w: long_beard(w))


# over the head (surface items; rigid hats are pieces, tools/blender/pieces.py) -------------------------------------


@item('beanie', 'Beanie', 'head', [('knit', '#2d3a4f', 'knit')], tags=['beanie', 'knit cap', 'woolly hat', 'toque'])
def _beanie(w):
    h = w.head
    line = lambda p: h.hairline(p, recede=-0.018, temple=-0.012, nape=0.04, sideburn=0.03)
    shell = head_shell(w, 'knit', lambda p, n: 0.014 * max(0.0, min(1.0, (p.z - line(p) + 0.012) / 0.02)) - 0.002, lambda poly: poly.center.z >= line(poly.center) - 0.012, name='beanie')
    cuff = band(w, 'knit', V((0, h.centre.y + 0.004, h.brow.z + 0.022)), V((0, 0.12, 1)), 0.032, 0.016, count=28, radius=0.2, name='cuff')
    return [shell, cuff]


@item('headband', 'Headband', 'head', [('band', '#c81e2b', 'cotton')], tags=['headband', 'sweatband', 'hachimaki', 'bandana'])
def _headband(w):
    h = w.head
    return [band(w, 'band', V((0, h.centre.y, h.brow.z + 0.03)), V((0, 0.18, 1)), 0.03, 0.005, count=28, radius=0.2, name='headband')]


@item('cap', 'Baseball cap', 'head', [('crown', '#1f2a44', 'cotton'), ('brim', '#1f2a44', 'cotton')], tags=['cap', 'baseball cap', 'ball cap', 'snapback'])
def _cap(w):
    h = w.head
    line = lambda p: h.brow.z + 0.035 + 0.025 * max(0.0, -math.cos(h.azimuth(p)))
    crown = head_shell(w, 'crown', lambda p, n: 0.012, lambda poly: poly.center.z >= line(poly.center), name='crown', thickness=0.003)
    # the brim: a curved peak out over the brow
    bm = bmesh.new()
    rows = []
    for i in range(7):
        a = math.radians(-70 + 140 * i / 6)
        out = V((math.sin(a), -math.cos(a), 0))
        edge, _ = w.snap(V((h.centre.x, h.centre.y, h.brow.z + 0.038)) + out * 0.3, -out)
        reach = 0.075 * math.cos(a * 0.8)
        rows.append([bm.verts.new(edge + out * 0.008 + V((0, 0, 0.002))), bm.verts.new(edge + out * (0.01 + reach) + V((0, 0, -0.012 - 0.01 * math.cos(a))))])
    for r0, r1 in zip(rows, rows[1:]):
        bm.faces.new((r0[0], r1[0], r1[1], r0[1]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    G.solidify(bm, 0.004)
    return [crown, new_object('brim', bm, w.d.mats.mats['brim'])]


@item('hood', 'Hood', 'head', [('hood', '#3b3f4a', 'cotton')], tags=['hood', 'hooded', 'cowl'])
def _hood(w):
    h = w.head

    def region(poly):
        c = poly.center
        if c.y < h.front + 0.045 and c.z < h.brow.z + 0.04 and abs(c.x) < h.half_width * 0.8:
            return False  # the face stays open
        return c.z > h.chin.z - 0.04

    def lift(p, n):
        front = max(0.0, math.cos(h.azimuth(p)))
        return 0.03 + 0.012 * (1 - front)

    return [head_shell(w, 'hood', lift, region, name='hood', thickness=0.004)]


@item('legion_helm', 'Legion helm', 'head', [('helm', '#b07d3c', 'metal'), ('crest', '#a3261f', 'cotton')], tags=['roman helmet', 'galea', 'legion helmet', 'centurion', 'gladiator helmet', 'helmet'])
def _legion(w):
    return H.make_helmet(w.d, w.head, mat='helm', crest='crest')


# upper body --------------------------------------------------------------------------------------------------------


def top(kind='tee', mat='tee', sleeve=0.5, neck='crew', hem='hip', thick=0.005, **more):
    return dict(kind=kind, mat=mat, sleeve=sleeve, neck=neck, hem=hem, thick=thick, **more)


def neckband(c, mat, height=0.012, offset=0.003):
    return gear(c, 'collar', mat=mat, height=height, gap=0, offset=offset, drop=0.03, tilt=0.35, flare=0.004, name='neckband')


@item('tee', 'Tee', 'upper', [('tee', '#2b2d33', 'cotton')], knobs=['sleeve', 'hem'], tags=['t-shirt', 'tshirt', 'tee', 't shirt'])
def _tee(w):
    c = clothes(w, [top()])
    return [c] + neckband(c, 'tee')


@item('longsleeve', 'Long-sleeve tee', 'upper', [('tee', '#3a3f4b', 'cotton')], knobs=['sleeve', 'hem'], tags=['long sleeve', 'long-sleeve', 'longsleeve'])
def _longsleeve(w):
    c = clothes(w, [top(sleeve=1.93)])
    return [c] + neckband(c, 'tee')


@item('tank_top', 'Tank top', 'upper', [('tank', '#e8e6e1', 'cotton')], knobs=['hem'], tags=['tank top', 'vest top', 'singlet', 'sleeveless'])
def _tank(w):
    return [clothes(w, [top(kind='vest', mat='tank', sleeve=0, neck='scoop')])]


@item('shirt', 'Shirt', 'upper', [('shirt', '#dfe6ef', 'cotton')], knobs=['sleeve', 'hem'], tags=['shirt', 'button-up', 'button down', 'dress shirt', 'oxford'])
def _shirt(w):
    c = clothes(w, [top(mat='shirt', sleeve=1.93, neck='collar', thick=0.004)])
    return [c] + gear(c, 'collar', mat='shirt', height=0.032, gap=0.18, offset=0.004) + gear(c, 'cuffs', mat='shirt', at=0.93, offset=0.003)


@item('sweater', 'Sweater', 'upper', [('knit', '#5a6170', 'knit')], knobs=['sleeve', 'hem'], tags=['sweater', 'jumper', 'pullover', 'knit sweater'])
def _sweater(w):
    c = clothes(w, [top(mat='knit', sleeve=1.93, thick=0.009)])
    return [c] + neckband(c, 'knit', height=0.02, offset=0.004) + gear(c, 'hem', mat='knit', at='hip', height=0.035, offset=0.004, flare=0.0) + gear(c, 'cuffs', mat='knit', at=0.92, height=0.04, offset=0.004)


@item('hoodie', 'Hoodie', 'upper', [('hoodie', '#4b4f58', 'knit'), ('strings', '#e8e6e1', 'cotton')], knobs=['sleeve'], tags=['hoodie', 'hooded sweatshirt', 'sweatshirt'])
def _hoodie(w):
    c = clothes(w, [top(mat='hoodie', sleeve=1.93, thick=0.011)])
    parts = [c]
    # the hood lying down behind the neck
    parts += gear(c, 'collar', mat='hoodie', height=0.07, gap=0.28, offset=0.012, drop=0.06, tilt=-0.5, flare=0.05, name='hood_down')
    parts += gear(c, 'hem', mat='hoodie', at='hip', height=0.045, offset=0.004, flare=0.0) + gear(c, 'cuffs', mat='hoodie', at=0.92, height=0.045, offset=0.004)
    torso = c.faces(*G.TORSO)
    n = c.d.neck
    for s in (1, -1):
        path = [V((s * 0.04, n.y - 0.08, n.z - 0.07 - 0.02 * t)) for t in range(6)]
        parts.append(c.d.strip(f'string_{s}', path, [(0.004, 0.004)] * 6, lambda i, q, nrm: V((1, 0, 0)), 0.004, 'strings', faces=torso, snap_dir=lambda i, p: V((0, 1, 0))))
    return parts


@item('leather_jacket', 'Leather jacket over a tee', 'upper', [('jacket', '#141416', 'leather'), ('tee', '#141416', 'cotton')], knobs=['sleeve'], tags=['leather jacket', 'biker jacket', 'moto jacket', 'jensen jacket'])
def _leather(w):
    c = clothes(w, [top(mat='tee'), dict(kind='jacket', mat='jacket', sleeve=1.93, hem='hip', neck='collar', open='v', open_width=0.07, thick=0.016, pad=0.01)], smooth=['jacket'])
    return [c] + gear(c, 'collar', mat='jacket', height=0.045, gap=0.24, offset=0.004) + gear(c, 'hem', mat='jacket', at='hip', offset=0.004)


@item('bomber', 'Bomber jacket', 'upper', [('jacket', '#3b4a2e', 'silk'), ('rib', '#1a1a1c', 'knit')], knobs=['sleeve'], tags=['bomber', 'bomber jacket', 'flight jacket', 'varsity jacket'])
def _bomber(w):
    c = clothes(w, [top(kind='jacket', mat='jacket', sleeve=1.9, neck='crew', thick=0.022, pad=0.008)], smooth=['jacket'])
    return [c] + neckband(c, 'rib', height=0.03, offset=0.004) + gear(c, 'hem', mat='rib', at='hip', height=0.05, offset=0.004, flare=0.0) + gear(c, 'cuffs', mat='rib', at=0.9, height=0.05, offset=0.004)


def suit_upper(w, jacket='jacket', shirt='shirt', tie=None, bowtie=None, open='v', thick=0.014, collar=True, vest=None, shirt_neck='collar', trousers=None):
    layers = [dict(kind='tee', mat=shirt, sleeve=1.95, hem='hip', neck=shirt_neck, thick=0.004)]
    if trousers:
        layers.insert(0, trousers)
    if vest:
        layers.append(dict(kind='vest', mat=vest, sleeve=0, hem='hip', neck='v', thick=0.008))
    layers.append(dict(kind='jacket', mat=jacket, sleeve=1.92, hem='hip', neck='collar', open=open, open_width=0.07, thick=thick, pad=0.012))
    c = clothes(w, layers, smooth=[jacket] + ([vest] if vest else []))
    parts = [c]
    if collar:
        parts += gear(c, 'collar', mat=shirt, height=0.035, gap=0.16, offset=0.003, clear=0.003)
    if tie:
        parts += gear(c, 'tie', mat=tie)
    if bowtie:
        parts += gear(c, 'bowtie', mat=bowtie)
    if open:
        # the notch sits below the shirt's collar, on the chest
        parts += gear(c, 'lapels', mat=jacket, drop=0.035, clear=0.002, thick=0.004)
    parts += gear(c, 'hem', mat=jacket, at='hip', offset=0.004)
    return c, parts


@item('suit_jacket', 'Suit jacket, shirt and tie', 'upper', [('jacket', '#1b2236', 'cotton'), ('shirt', '#e9edf2', 'cotton'), ('tie', '#7a1c24', 'silk')], tags=['suit', 'suit jacket', 'business suit', 'blazer and tie', 'ceo'])
def _suit(w):
    return suit_upper(w, tie='tie')[1]


@item('blazer_silk', 'Blazer over a silk top', 'upper', [('jacket', '#5c1a5c', 'cotton'), ('top', '#1e0c1e', 'silk')], tags=['blazer', 'womens suit', 'power suit', 'silk blouse'])
def _blazer(w):
    return suit_upper(w, shirt='top', collar=False, shirt_neck='scoop')[1]


@item('frock_coat', 'Frock coat with bow tie', 'upper', [('coat', '#111114', 'cotton'), ('shirt', '#e9e9eb', 'cotton'), ('bowtie', '#0b0b0c', 'silk')], knobs=['length'], tags=['frock coat', 'tailcoat', 'victorian coat', 'lincoln', 'tuxedo'])
def _frock(w):
    c, parts = suit_upper(w, jacket='coat', bowtie='bowtie', thick=0.016)
    return parts + [skirt(c, 'coat', top='hip', hem=0.38, flare=0.05, ease=0.012, gap=math.radians(70), name='tails')]


@item('kurta_vest', 'Kurta with Nehru vest', 'upper', [('kurta', '#ece6d6', 'cotton'), ('vest', '#c26a1a', 'silk')], knobs=['length'], tags=['kurta', 'nehru jacket', 'nehru vest', 'modi jacket', 'indian'])
def _kurta(w):
    c = clothes(w, [dict(kind='kurta', mat='kurta', sleeve=1.9, hem='hip', neck='mandarin', thick=0.008), dict(kind='vest', mat='vest', sleeve=0, hem='hip', neck='mandarin', thick=0.014)], smooth=['vest'])
    return [c, skirt(c, 'kurta', top='hip', hem=0.42, flare=0.05, ease=0.012, name='kurta_skirt')] + gear(c, 'collar', mat='vest', height=0.03, gap=0.1, offset=0.004)


@item('haori', 'Haori', 'upper', [('haori', '#232a3d', 'silk'), ('inner', '#d9d2c3', 'cotton')], tags=['haori', 'japanese jacket', 'kimono jacket'])
def _haori(w):
    c = clothes(w, [top(mat='inner', sleeve=0.6, neck='v'), dict(kind='jacket', mat='haori', sleeve=1.0, hem='hip', neck='collar', open='deep-v', open_width=0.09, thick=0.012)])
    return [c, skirt(c, 'haori', top='hip', hem=0.22, flare=0.04, ease=0.012, gap=math.radians(50), name='haori_skirt')] + sleeves(c, 'haori', start=0.2, end=0.85, drop=0.16)


@item('gi_top', 'Gi top', 'upper', [('gi', '#f1efe9', 'cotton'), ('belt', '#151515', 'cotton')], knobs=['sleeve'], tags=['gi', 'karate gi', 'judo gi', 'martial arts top', 'dogi'])
def _gi_top(w):
    c = clothes(w, [top(kind='jacket', mat='gi', sleeve=1.55, neck='deep-v', hem='crotch', thick=0.01)])
    return [c, band(c, 'belt', V((0, c.d.bones['hips'][0].y, c.d.waist_z - 0.01)), V((0, 0, 1)), 0.04, 0.006, faces=c.faces('hips', 'spine'), name='belt')]


@item('breastplate', 'Breastplate', 'upper', [('plate', '#8d929b', 'metal'), ('trim', '#b07d3c', 'metal')], tags=['breastplate', 'cuirass', 'chest armour', 'chest armor', 'plate armour'])
def _breastplate(w):
    c = clothes(w, [top(kind='vest', mat='plate', sleeve=0, neck='crew', hem='waist', thick=0.022)], smooth=['plate'])
    return [c] + gear(c, 'hem', mat='trim', at='waist', height=0.04, offset=0.004, flare=0.01) + gear(c, 'pauldron', side='L', mat='plate', layers=2, size=0.14) + gear(c, 'pauldron', side='R', mat='plate', layers=2, size=0.14)


# lower body --------------------------------------------------------------------------------------------------------


def trousers(mat='trousers', thick=0.01, flare=0.008, kind='trousers', hem=0.93, rise=0.02):
    return dict(kind=kind, mat=mat, thick=thick, flare=flare, hem=hem, rise=rise)


def waistband(c, mat, height=0.04, offset=0.004):
    return band(c, mat, V((0, c.d.bones['hips'][0].y, c.d.waist_z - 0.015)), V((0, 0, 1)), height, offset, faces=c.faces('hips', 'spine'), name='waistband')


@item('trousers', 'Trousers', 'lower', [('trousers', '#24262e', 'cotton')], knobs=['leg'], tags=['trousers', 'pants', 'slacks', 'chinos'])
def _trousers(w):
    c = clothes(w, [trousers()])
    return [c, waistband(c, 'trousers')] + gear(c, 'trouser_hems', mat='trousers')


@item('jeans', 'Jeans', 'lower', [('denim', '#2b3a57', 'denim'), ('belt', '#3a2416', 'leather')], knobs=['leg'], tags=['jeans', 'denim', 'blue jeans'])
def _jeans(w):
    c = clothes(w, [trousers(mat='denim', thick=0.011)])
    return [c] + gear(c, 'trouser_hems', mat='denim') + gear(c, 'belt', mat='belt', buckle='belt', height=0.035)


@item('cargo', 'Cargo trousers', 'lower', [('cargo', '#3d4130', 'cotton')], knobs=['leg'], tags=['cargo pants', 'cargos', 'combat trousers', 'military pants'])
def _cargo(w):
    c = clothes(w, [trousers(mat='cargo', thick=0.013, flare=0.01)])
    parts = [c, waistband(c, 'cargo')] + gear(c, 'trouser_hems', mat='cargo')
    for side, s in (('L', 1), ('R', -1)):
        h, t = c.d.bones[f'thigh_{side}']
        q, n = c.snap(h.lerp(t, 0.55) + V((s * 0.3, 0, 0)), V((-s, 0, 0)))
        parts.append(G.mesh_box(f'pocket_{side}', (0.03, 0.11, 0.13), q + n * 0.012, c.d.mats.mats['cargo']))
    return parts


@item('shorts', 'Shorts', 'lower', [('shorts', '#3a4a66', 'cotton')], knobs=['leg'], tags=['shorts', 'board shorts', 'bermuda'])
def _shorts(w):
    c = clothes(w, [trousers(mat='shorts', kind='shorts', thick=0.009, flare=0.012)])
    return [c, waistband(c, 'shorts')]


@item('track_pants', 'Track pants', 'lower', [('track', '#15161a', 'knit'), ('stripe', '#f2f2f2', 'cotton')], knobs=['leg'], tags=['track pants', 'joggers', 'sweatpants', 'tracksuit bottoms', 'adidas'])
def _track(w):
    c = clothes(w, [trousers(mat='track', thick=0.012, flare=0.0)])
    parts = [c, waistband(c, 'track', height=0.045)] + gear(c, 'trouser_hems', mat='track', at=0.95, offset=0.004)
    for side, s in (('L', 1), ('R', -1)):
        hip = c.d.bones[f'thigh_{side}'][0]
        ankle = c.d.bones[f'foot_{side}'][0]
        path = [hip.lerp(ankle, t / 12) + V((s * 0.25, 0, 0)) for t in range(13)]
        legs = c.faces(f'thigh_{side}', f'shin_{side}', 'hips')
        parts.append(c.d.strip(f'stripe_{side}', path, [(0.008, 0.008)] * 13, lambda i, q, nrm: V((0, 1, 0)), 0.002, 'stripe', faces=legs, snap_dir=lambda i, p, s=s: V((-s, 0, 0))))
    return parts


@item('hakama', 'Hakama', 'lower', [('hakama', '#1c2233', 'cotton'), ('ties', '#e6e1d6', 'cotton')], knobs=['length'], tags=['hakama', 'samurai trousers', 'pleated trousers', 'kendo'])
def _hakama(w):
    return [skirt(w, 'hakama', top='waist', hem=0.93, flare=0.1, pleats=7, pleat_depth=0.02, name='hakama'), waistband(w, 'ties', height=0.05, offset=0.022)]


@item('gi_trousers', 'Gi trousers', 'lower', [('gi', '#f1efe9', 'cotton')], knobs=['leg'], tags=['gi pants', 'karate pants', 'martial arts trousers'])
def _gi_trousers(w):
    c = clothes(w, [trousers(mat='gi', thick=0.014, flare=0.02, hem=0.88)])
    return [c, waistband(c, 'gi', height=0.03)] + gear(c, 'trouser_hems', mat='gi', at=0.88, offset=0.006)


@item('skirt', 'Skirt', 'lower', [('skirt', '#202028', 'cotton')], knobs=['length'], tags=['skirt', 'a-line skirt', 'midi skirt', 'kilt'])
def _skirt(w):
    return [skirt(w, 'skirt', top='waist', hem=0.45, flare=0.08), waistband(w, 'skirt', height=0.035, offset=0.016)]


@item('greaves', 'Greaves', 'lower', [('plate', '#8d929b', 'metal'), ('trousers', '#2a2622', 'cotton')], knobs=['leg'], tags=['greaves', 'leg armour', 'shin guards', 'leg armor'])
def _greaves(w):
    c = clothes(w, [trousers(thick=0.009)])
    return [c, waistband(c, 'trousers')] + gear(c, 'greaves', mat='plate')


# full body ---------------------------------------------------------------------------------------------------------


def obi(c, mat, height=0.12, offset=0.016):
    return band(c, mat, V((0, c.d.bones['hips'][0].y, c.d.waist_z - 0.04)), V((0, 0, 1)), height, offset, count=28, faces=c.faces('hips', 'spine', 'chest'), name='obi')


@item('kimono', 'Kimono', 'full', [('kimono', '#7a1f2b', 'silk'), ('obi', '#d9b45a', 'silk'), ('collar', '#f1ece2', 'silk')], knobs=['length'], tags=['kimono', 'yukata', 'japanese robe', 'geisha'])
def _kimono(w):
    c = clothes(w, [top(kind='jacket', mat='kimono', sleeve=0.55, neck='deep-v', hem='hip', thick=0.01)])
    return [c, skirt(c, 'kimono', top='waist', hem=0.97, flare=0.03, ease=0.014, name='kimono_skirt'), obi(c, 'obi')] + sleeves(c, 'kimono', start=0.16, end=0.95, drop=0.24, ease=0.03) + gear(c, 'lapels', mat='collar', width=0.035, clear=0.002, thick=0.004)


@item('wizard_robe', 'Wizard robe', 'full', [('robe', '#2b2a6b', 'silk'), ('trim', '#d9b45a', 'silk'), ('rope', '#c8b48a', 'cotton')], knobs=['length'], tags=['wizard robe', 'robe', 'mage robe', 'sorcerer', 'gandalf', 'wizard'])
def _wizard_robe(w):
    c = clothes(w, [top(kind='jacket', mat='robe', sleeve=0.6, neck='v', hem='hip', thick=0.012)])
    parts = [c, skirt(c, 'robe', top='waist', hem=0.98, flare=0.12, ease=0.016, name='robe_skirt')]
    parts += sleeves(c, 'robe', start=0.2, end=1.0, drop=0.12, ease=0.03, flare=0.09)
    parts.append(band(c, 'rope', V((0, c.d.bones['hips'][0].y, c.d.waist_z - 0.02)), V((0, 0, 1)), 0.022, 0.02, faces=c.faces('hips', 'spine'), name='rope'))
    return parts + gear(c, 'lapels', mat='trim', width=0.03, clear=0.002, thick=0.004)


@item('monk_robe', 'Monk robe', 'full', [('robe', '#c4661f', 'cotton'), ('sash', '#7a3a12', 'cotton')], knobs=['length'], tags=['monk robe', 'monk', 'shaolin', 'buddhist robe', 'kasaya'])
def _monk(w):
    c = clothes(w, [top(kind='jacket', mat='robe', sleeve=1.3, neck='deep-v', hem='hip', thick=0.011)])
    return [c, skirt(c, 'robe', top='waist', hem=0.9, flare=0.06, ease=0.014, name='robe_skirt')] + gear(c, 'sash', mat='sash', width=0.06, side='R')


@item('ninja', 'Ninja garb', 'full', [('garb', '#141519', 'cotton'), ('wraps', '#2b2d33', 'cotton')], tags=['ninja', 'shinobi', 'ninja outfit', 'stealth'])
def _ninja(w):
    c = clothes(w, [trousers(mat='garb', thick=0.012, flare=0.012), dict(kind='jacket', mat='garb', sleeve=1.9, neck='v', hem='hip', thick=0.01)])
    return [c, obi(c, 'wraps', height=0.06, offset=0.006)] + gear(c, 'bracers', mat='wraps', start=0.5, end=0.97) + gear(c, 'greaves', mat='wraps')


@item('martial_gi', 'Martial gi', 'full', [('gi', '#f1efe9', 'cotton'), ('belt', '#151515', 'cotton')], knobs=['sleeve', 'leg'], tags=['karate gi', 'martial arts uniform', 'gi', 'judo', 'taekwondo', 'dobok'])
def _martial_gi(w):
    c = clothes(w, [trousers(mat='gi', thick=0.014, flare=0.02, hem=0.88), dict(kind='jacket', mat='gi', sleeve=1.55, neck='deep-v', hem='crotch', thick=0.01)])
    belt = band(c, 'belt', V((0, c.d.bones['hips'][0].y, c.d.waist_z - 0.01)), V((0, 0, 1)), 0.04, 0.006, faces=c.faces('hips', 'spine'), name='belt')
    return [c, belt] + gear(c, 'trouser_hems', mat='gi', at=0.88, offset=0.006)


@item('three_piece', 'Three-piece suit', 'full', [('suit', '#22252c', 'cotton'), ('shirt', '#ecedf0', 'cotton'), ('tie', '#16234d', 'silk')], knobs=['leg'], tags=['three piece suit', 'three-piece', 'waistcoat suit', 'churchill', 'peaky blinders'])
def _three_piece(w):
    c, parts = suit_upper(w, jacket='suit', tie='tie', vest='suit', trousers=trousers(mat='suit'))
    return parts + gear(c, 'trouser_hems', mat='suit')


@item('jumpsuit', 'Jumpsuit', 'full', [('suit', '#c9541d', 'cotton'), ('zip', '#1b1b1d', 'metal')], knobs=['sleeve', 'leg'], tags=['jumpsuit', 'coveralls', 'boiler suit', 'flight suit', 'prison jumpsuit'])
def _jumpsuit(w):
    c = clothes(w, [trousers(mat='suit', thick=0.011), top(kind='jacket', mat='suit', sleeve=1.92, neck='collar', hem='hip', thick=0.011)])
    n = c.d.neck
    path = [V((0, n.y - 0.1, n.z - 0.05 + (c.d.waist_z - 0.06 - (n.z - 0.05)) * t / 10)) for t in range(11)]
    zipper = c.d.strip('zip', path, [(0.006, 0.006)] * 11, lambda i, q, nrm: V((1, 0, 0)), 0.003, 'zip', faces=c.faces(*G.TORSO), snap_dir=lambda i, p: V((0, 1, 0)))
    return [c, zipper] + gear(c, 'collar', mat='suit', height=0.04, gap=0.2, offset=0.004) + gear(c, 'trouser_hems', mat='suit')


@item('gown', 'Gown', 'full', [('gown', '#1d1b3a', 'silk'), ('sash', '#c9a14a', 'silk')], knobs=['length'], tags=['gown', 'ball gown', 'evening dress', 'dress', 'princess dress'])
def _gown(w):
    c = clothes(w, [top(kind='vest', mat='gown', sleeve=0, neck='scoop', hem='waist', thick=0.006)])
    return [c, skirt(c, 'gown', top='waist', hem=1.0, flare=0.28, ease=0.014, name='gown_skirt'), obi(c, 'sash', height=0.035, offset=0.02)]


@item('bodysuit', 'Hero bodysuit', 'full', [('suit', '#1a3f9e', 'silk'), ('panels', '#c4162a', 'silk'), ('emblem', '#f2c230', 'glow')], knobs=['sleeve', 'leg'], tags=['superhero suit', 'bodysuit', 'spandex', 'hero suit', 'catsuit', 'superhero'])
def _bodysuit(w):
    c = clothes(w, [trousers(mat='panels', thick=0.004, flare=0.0, hem=0.97), top(kind='tee', mat='suit', sleeve=1.97, neck='crew', hem='crotch', thick=0.004)])
    chest = c.d.bones['upper_chest'][0]
    q, n = c.snap(V((0, chest.y - 0.3, chest.z + 0.02)), V((0, 1, 0)))
    return [c, disc(c, 'emblem', q + n * 0.004, n, 0.055, name='emblem'), obi(c, 'panels', height=0.035, offset=0.003)]


@item('knight_armour', 'Knight armour', 'full', [('plate', '#9aa0a8', 'metal'), ('mail', '#4a4d52', 'metal'), ('tabard', '#7a1c24', 'cotton')], tags=['knight armour', 'knight armor', 'plate armour', 'full plate', 'paladin armour', 'crusader'])
def _knight(w):
    c = clothes(w, [trousers(mat='mail', thick=0.01), top(kind='tee', mat='mail', sleeve=1.9, neck='crew', hem='crotch', thick=0.01), dict(kind='vest', mat='plate', sleeve=0, hem='waist', neck='crew', thick=0.026)], smooth=['plate'])
    parts = [c, skirt(c, 'tabard', top='waist', hem=0.32, flare=0.04, ease=0.016, name='tabard')]
    parts += gear(c, 'pauldron', side='L', mat='plate', layers=3, size=0.16) + gear(c, 'pauldron', side='R', mat='plate', layers=3, size=0.16)
    return parts + gear(c, 'bracers', mat='plate', start=0.35, end=0.95) + gear(c, 'greaves', mat='plate')


@item('samurai_armour', 'Samurai armour', 'full', [('lacquer', '#1d1d22', 'leather'), ('lacing', '#a3261f', 'silk'), ('cloth', '#2a2f45', 'cotton')], tags=['samurai armour', 'samurai armor', 'o-yoroi', 'samurai', 'shogun'])
def _samurai(w):
    c = clothes(w, [trousers(mat='cloth', thick=0.012, flare=0.015), top(kind='jacket', mat='cloth', sleeve=1.6, neck='v', hem='hip', thick=0.01), dict(kind='vest', mat='lacquer', sleeve=0, hem='waist', neck='crew', thick=0.024)], smooth=['lacquer'])
    parts = [c]
    # the do's laced rows, and the kusazuri: a skirt of plates
    for k in range(4):
        parts.append(band(c, 'lacing', V((0, c.d.bones['spine'][0].y, c.d.waist_z + 0.07 + k * 0.07)), V((0, 0, 1)), 0.008, 0.003, faces=c.faces(*G.TORSO), name=f'lace_{k}'))
    parts.append(skirt(c, 'lacquer', top='waist', hem=0.3, flare=0.06, ease=0.02, pleats=5, pleat_depth=0.012, name='kusazuri'))
    parts += gear(c, 'pauldron', side='L', mat='lacquer', layers=3, size=0.15, trim='lacing') + gear(c, 'pauldron', side='R', mat='lacquer', layers=3, size=0.15, trim='lacing')
    return parts + gear(c, 'greaves', mat='lacquer')


@item('long_coat', 'Long coat over a top', 'full', [('coat', '#2f2a26', 'cotton'), ('top', '#d8d4cc', 'cotton'), ('trousers', '#1b1c20', 'cotton')], knobs=['length'], tags=['long coat', 'trench coat', 'duster', 'overcoat', 'matrix coat'])
def _long_coat(w):
    c = clothes(w, [trousers(), top(mat='top', neck='crew'), dict(kind='jacket', mat='coat', sleeve=1.93, hem='hip', neck='collar', open='v', open_width=0.08, thick=0.016, pad=0.012)], smooth=['coat'])
    parts = [c, skirt(c, 'coat', top='hip', hem=0.72, flare=0.1, ease=0.014, gap=math.radians(55), name='coat_skirt')]
    return parts + gear(c, 'collar', mat='coat', height=0.05, gap=0.24, offset=0.004, clear=0.003) + gear(c, 'lapels', mat='coat', drop=0.035, clear=0.002, thick=0.004) + gear(c, 'trouser_hems', mat='trousers')


# feet --------------------------------------------------------------------------------------------------------------


def sole(c, mat, height=0.022, offset=0.004, name='sole'):
    out = []
    for side in 'LR':
        foot_h, foot_t = c.d.bones[f'foot_{side}']
        centre = V(((foot_h.x + foot_t.x) / 2, (foot_h.y + foot_t.y) / 2, c.floor + 0.004))
        out.append(band(c, mat, centre, V((0, 0, 1)), height, offset, count=20, radius=0.3, faces=c.faces(f'foot_{side}'), name=f'{name}_{side}'))
    return out


def outline(hull, n, thick):
    """
    `n` points round convex hull `hull` (counter-clockwise), evenly spaced along it and `thick` out, starting behind
    (the hero's back, +y, from its middle) so the rings of a loft line up.
    """
    m = len(hull)
    cx = sum(p[0] for p in hull) / m
    cy = sum(p[1] for p in hull) / m
    edges = [(hull[i], hull[(i + 1) % m]) for i in range(m)]
    lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in edges]
    total = sum(lengths)
    start = 0.0
    run = 0.0
    for (a, b), length in zip(edges, lengths):
        ex = b[0] - a[0]
        if abs(ex) > 1e-9:
            t = (cx - a[0]) / ex
            if 0 <= t <= 1 and a[1] + t * (b[1] - a[1]) > cy:
                start = run + t * length
                break
        run += length
    out = []
    for i in range(n):
        at = (start + total * i / n) % total
        k = 0
        while k < m - 1 and at > lengths[k]:
            at -= lengths[k]
            k += 1
        (a, b), length = edges[k], max(lengths[k], 1e-9)
        t = min(1.0, at / length)
        ex, ey = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        out.append((a[0] + (b[0] - a[0]) * t + ey * thick, a[1] + (b[1] - a[1]) * t - ex * thick))
    return out


def shoe(w, mat, top=0.94, thick=0.013, sole=None, rim=20, name='shoe'):
    """
    A pair of shoes or boots lofted from the ground up: each ring the convex outline of the body's foot or shin at its
    height, `thick` out, from the sole to the opening at `top` (how far from the knee down the shin: 0.94 a shoe, 0.5 a
    boot to mid-calf). So a shoe runs smooth over the toes, flat under the arch and level round the opening, whatever
    the foot's own faces are like. `sole` (a channel and a height) paints the bottom, cut on a level line.
    """
    floor = w.floor
    mats = w.d.mats.mats
    out = []
    for side in 'LR':
        knee, ankle = w.d.bones[f'shin_{side}']
        top_z = knee.z + (ankle.z - knee.z) * top
        names = (f'foot_{side}', f'shin_{side}')
        me = w.obj.data
        leg = {v.index for v, wt in zip(me.vertices, w.d.vweights) if (v.co.x > 0) == (knee.x > 0) and v.co.z < top_z + 0.15 and sum(wt.get(n, 0.0) for n in names) > 0.3}
        edges = [(me.vertices[a].co, me.vertices[b].co) for a, b in (e.vertices for e in me.edges) if a in leg and b in leg]
        # rings close together over the foot, wider apart up a shaft
        heights = [floor - 0.004]
        while heights[-1] < top_z - 1e-4:
            heights.append(min(top_z, heights[-1] + (0.008 if heights[-1] < ankle.z + 0.02 else 0.03)))
        # the body's own cross-section at each height: where its edges cross the level (its faces up a shin are
        # 10 cm tall, so its vertices alone miss whole stretches)
        levels = [max(z, floor + 0.002) for z in heights]
        cuts = [[a.lerp(b, (at - a.z) / (b.z - a.z)) for a, b in edges if (a.z - at) * (b.z - at) < 0] for at in levels]
        toes = floor + 0.035
        rings = []
        for k, z in enumerate(heights):
            # up to the top of the toes, a ring takes in everything above it too: the toe box stands straight up
            # from the sole instead of following each toe
            reach = max(levels[k], toes)
            pts = [p for j, at in enumerate(levels) if levels[k] <= at <= reach for p in cuts[j]]
            pts += [me.vertices[i].co for i in leg if levels[k] - 0.003 <= me.vertices[i].co.z <= reach + 0.003]
            hull = hull2d([(p.x, p.y) for p in pts])
            rings.append([V((x, y, z)) for x, y in outline(hull, rim, thick)])
        # ease each ring toward the ones above and below it: slabs of a foot's points make a bumpy stack
        for _ in range(2):
            rings = [rings[0]] + [[(a + 2 * b + c) / 4 for a, b, c in zip(rings[k - 1], rings[k], rings[k + 1])] for k in range(1, len(rings) - 1)] + [rings[-1]]
        bm = bmesh.new()
        made = [[bm.verts.new(p) for p in ring] for ring in rings]
        for lo, hi in zip(made, made[1:]):
            for i in range(rim):
                bm.faces.new((lo[i], lo[(i + 1) % rim], hi[(i + 1) % rim], hi[i]))
        centre = bm.verts.new(sum(rings[0], V()) / rim)
        for i in range(rim):
            bm.faces.new((centre, made[0][(i + 1) % rim], made[0][i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        own = bpy.data.meshes.new(f'{name}_{side}')
        obj = B.link(bpy.data.objects.new(f'{name}_{side}', own))
        own.materials.append(mats[mat])
        if sole and mats[sole[0]] != mats[mat]:
            own.materials.append(mats[sole[0]])
            val = {v: v.co.z for v in bm.verts}
            faces, ends = split_along(bm, bm.faces[:], val, floor + sole[1])
            for f in faces:
                if all(val[v] <= floor + sole[1] for v in f.verts if v not in ends):
                    f.material_index = 1
        bm.to_mesh(own)
        bm.free()
        for p in own.polygons:
            p.use_smooth = True
        # the rings stand `thick` off the body's outline by construction (the body's toe faces are too tangled to
        # measure a sag against)
        out.append(obj)
    return out


def shoes(mat, kind='shoes', thick=0.013, top=None):
    out = dict(kind=kind, mat=mat, thick=thick)
    if top is not None:
        out['top'] = top
    return out


@item('sneakers', 'Sneakers', 'feet', [('upper', '#f2f2f2', 'leather'), ('sole', '#e4e4e4', 'cotton')], tags=['sneakers', 'trainers', 'running shoes', 'kicks'])
def _sneakers(w):
    return shoe(w, 'upper', thick=0.016, sole=('sole', 0.026))


@item('high_tops', 'High-tops', 'feet', [('upper', '#b3202b', 'cotton'), ('sole', '#f2efe8', 'cotton')], tags=['high tops', 'hi tops', 'converse', 'basketball shoes'])
def _high_tops(w):
    return shoe(w, 'upper', top=0.8, thick=0.015, sole=('sole', 0.03))


@item('boots', 'Boots', 'feet', [('leather', '#3a2416', 'leather')], tags=['boots', 'leather boots', 'riding boots', 'cowboy boots'])
def _boots(w):
    return shoe(w, 'leather', top=0.5, thick=0.014)


@item('combat_boots', 'Combat boots', 'feet', [('leather', '#1d1a17', 'leather'), ('sole', '#121212', 'leather')], tags=['combat boots', 'military boots', 'army boots', 'doc martens'])
def _combat(w):
    return shoe(w, 'leather', top=0.62, thick=0.016, sole=('sole', 0.032))


@item('dress_shoes', 'Dress shoes', 'feet', [('leather', '#0f0e0e', 'leather')], tags=['dress shoes', 'oxfords', 'brogues', 'loafers', 'formal shoes'])
def _dress_shoes(w):
    return shoe(w, 'leather', thick=0.012)


@item('sandals', 'Sandals', 'feet', [('strap', '#5a3a22', 'leather'), ('sole', '#7a5434', 'leather')], tags=['sandals', 'flip flops', 'roman sandals', 'gladiator sandals'])
def _sandals(w):
    out = sole(w, 'sole', height=0.016, offset=0.008)
    for side in 'LR':
        h, t = w.d.bones[f'foot_{side}']
        sh, st = w.d.bones[f'shin_{side}']
        faces = w.faces(f'foot_{side}', f'shin_{side}')
        for k, at in enumerate((0.25, 0.6)):
            out.append(w.d.band(f'strap_{side}{k}', h.lerp(t, at), t - h, V((0, 0, 1)), 0.016, 0.004, 'strap', count=14, faces=faces, radius=0.2))
        out.append(w.d.band(f'ankle_{side}', sh.lerp(st, 0.93), sh - st, V((0, -1, 0)), 0.016, 0.004, 'strap', count=14, faces=faces, radius=0.2))
    return out


@item('geta', 'Geta', 'feet', [('wood', '#8a6038', 'leather'), ('strap', '#a3261f', 'cotton')], tags=['geta', 'zori', 'japanese sandals', 'wooden sandals'])
def _geta(w):
    out = []
    for side in 'LR':
        h, t = w.d.bones[f'foot_{side}']
        centre = V(((h.x + t.x) / 2, (h.y + t.y) / 2 - 0.01, w.floor + 0.008))
        out.append(G.mesh_box(f'geta_{side}', (0.1, 0.26, 0.03), centre, w.d.mats.mats['wood']))
        out.append(w.d.band(f'thong_{side}', h.lerp(t, 0.55), t - h, V((0, 0, 1)), 0.014, 0.005, 'strap', count=14, faces=w.faces(f'foot_{side}'), radius=0.2))
    return out


@item('sabatons', 'Sabatons', 'feet', [('plate', '#9aa0a8', 'metal')], tags=['sabatons', 'armoured boots', 'armored boots', 'plate boots'])
def _sabatons(w):
    return shoe(w, 'plate', top=0.62, thick=0.02)


@item('foot_wraps', 'Foot wraps', 'feet', [('wraps', '#d8cfbd', 'cotton')], tags=['foot wraps', 'bandages', 'tabi', 'barefoot wraps'])
def _wraps(w):
    out = []
    for side in 'LR':
        h, t = w.d.bones[f'foot_{side}']
        sh, st = w.d.bones[f'shin_{side}']
        faces = w.faces(f'foot_{side}', f'shin_{side}')
        for k in range(3):
            out.append(w.d.band(f'wrap_{side}f{k}', h.lerp(t, 0.15 + 0.22 * k), t - h, V((0, 0, 1)), 0.024, 0.005, 'wraps', count=14, faces=faces, radius=0.2))
        for k in range(3):
            out.append(w.d.band(f'wrap_{side}s{k}', sh.lerp(st, 0.72 + 0.09 * k), sh - st, V((0, -1, 0)), 0.026, 0.005, 'wraps', count=14, faces=faces, radius=0.2))
    return out


# back --------------------------------------------------------------------------------------------------------------


@item('cape', 'Cape', 'back', [('cape', '#8f1d22', 'silk'), ('clasp', '#d9b45a', 'metal')], knobs=['length'], tags=['cape', 'cloak', 'superhero cape', 'mantle'])
def _cape(w):
    n = w.d.neck
    parts = [cape(w, 'cape', length=1.0, flare=0.45)]
    # the mantle's collar the cape hangs from, fastened at the throat
    parts += gear(w, 'collar', mat='cape', height=0.03, gap=0, offset=0.01, drop=0.05, tilt=0.35, flare=0.012, name='mantle')
    q, nrm = w.snap(V((0, n.y - 0.3, n.z - 0.06)), V((0, 1, 0)))
    parts.append(ball(w, 'clasp', q + nrm * 0.016, 0.016, (1, 0.5, 1), name='clasp'))
    return parts


@item('hooded_cloak', 'Hooded cloak', 'back', [('cloak', '#2b2f26', 'cotton')], knobs=['length'], tags=['hooded cloak', 'ranger cloak', 'cloak with hood', 'assassin cloak', 'jedi robe'])
def _cloak(w):
    h = w.head

    def region(poly):
        c = poly.center
        if c.y < h.front + 0.05 and c.z < h.brow.z + 0.05 and abs(c.x) < h.half_width * 0.85:
            return False
        return c.z > h.chin.z - 0.05

    return [cape(w, 'cloak', length=1.15, flare=0.55, width=1.15, ease=0.035, name='cloak'), head_shell(w, 'cloak', lambda p, n: 0.04, region, name='hood', thickness=0.004)]


@item('scarf', 'Scarf', 'back', [('scarf', '#b3202b', 'knit')], knobs=['length'], tags=['scarf', 'muffler', 'neck scarf'])
def _scarf(w):
    n = w.d.neck
    parts = gear(w, 'collar', mat='scarf', height=0.06, gap=0, offset=0.022, drop=0.045, tilt=0.25, flare=0.01, name='scarf_wrap')
    torso = w.faces(*G.TORSO)
    # one tail down the front, one down the back
    for name, ydir, x in (('front', -1, 0.05), ('back', 1, -0.03)):
        path = [V((x, n.y + ydir * 0.12, n.z - 0.07 - 0.32 * t / 9)) for t in range(10)]
        tail_ = w.d.strip(f'scarf_{name}', path, [(0.04, 0.04)] * 10, lambda i, q, nrm: V((1, 0, 0)), 0.03, 'scarf', faces=torso, snap_dir=lambda i, p, ydir=ydir: V((0, -ydir, 0)), thickness=0.006)
        top_z = n.z - 0.07
        paint(tail_, 'hang', lambda p, top_z=top_z: (top_z - 0.04 - p.z) / 0.28)
        paint(tail_, 'len', lambda p, top_z=top_z: (top_z - p.z) / 0.32)
        parts.append(tail_)
    return parts


# ------------------------------------------------------------------------------------------------ writing


FINISH_LOOK = {'cotton': (0.86, 0.0), 'silk': (0.32, 0.0), 'denim': (0.9, 0.0), 'knit': (0.95, 0.0), 'leather': (0.42, 0.0), 'metal': (0.28, 0.92), 'glow': (0.5, 0.0)}


def channel_materials(w, it):
    out = []
    for i, (name, hexc, finish) in enumerate(it.channels):
        m = bpy.data.materials.new(f'{it.id}:{name}')
        m['channel'] = i
        b = m.node_tree.nodes.get('Principled BSDF')
        rough, metal = FINISH_LOOK[finish]
        b.inputs['Base Color'].default_value = (*srgb(hexc), 1)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        if finish == 'glow':
            b.inputs['Emission Color'].default_value = (*srgb(hexc), 1)
            b.inputs['Emission Strength'].default_value = 2.0
        w.d.mats.mats[name] = m
        out.append(m)
    return out


def write_raw(path, it, parts):
    """The item's triangles in glTF axes: a vertex per distinct corner (position, normal, UV, channel), with its paints."""
    pos, nrm, uvs, chan, hang, ln, index = [], [], [], [], [], [], []
    seen = {}
    has_hang = any(p.data.attributes.get('hang') for p in parts)
    has_len = any(p.data.attributes.get('len') for p in parts)
    for obj in parts:
        me = obj.data
        me.calc_loop_triangles()
        uvl = me.uv_layers.active
        ha = me.attributes.get('hang')
        la = me.attributes.get('len')
        cn = me.corner_normals
        mw = obj.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        for tri in me.loop_triangles:
            m = me.materials[tri.material_index] if me.materials else None
            ch = m.get('channel') if m else None
            if ch is None:
                raise ValueError(f'{it.id}: part {obj.name} is painted {m.name if m else None}, not one of its channels')
            for li, vi in zip(tri.loops, tri.vertices):
                co = mw @ me.vertices[vi].co
                n = (nm @ cn[li].vector).normalized()
                u = tuple(uvl.data[li].uv) if uvl else (0.0, 0.0)
                key = (obj.name, vi, round(n.x, 3), round(n.y, 3), round(n.z, 3), round(u[0], 4), round(u[1], 4), ch)
                k = seen.get(key)
                if k is None:
                    k = len(seen)
                    seen[key] = k
                    pos.extend(round(x, 5) for x in gltf(co))
                    nrm.extend(round(x, 4) for x in gltf(n))
                    uvs.extend((round(u[0], 5), round(u[1], 5)))
                    chan.append(int(ch))
                    hang.append(round(ha.data[vi].value, 4) if ha else 0.0)
                    ln.append(round(la.data[vi].value, 4) if la else 0.0)
                index.append(k)
    spec = dict(id=it.id, name=it.name, slot=it.slot, channels=[dict(name=n, color=c, finish=f) for n, c, f in it.channels], knobs=it.knobs, tags=it.tags)
    if it.hides is not None:
        spec['hides'] = it.hides
    if it.stiff is not None:
        spec['stiff'] = it.stiff
    out = dict(spec=spec, positions=pos, normals=nrm, uv=uvs, index=index, channel=chan)
    if has_hang:
        out['hang'] = hang
    if has_len:
        out['len'] = ln
    with open(path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    return len(index) // 3


# ------------------------------------------------------------------------------------------------ thumbnails


def setup_thumbs(w, size):
    """Cycles in the piece renderer's studio (tools/blender/pieces.py), the body in plain clay so a garment reads as worn."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
        scene.cycles.device = 'GPU'
    except Exception:
        scene.cycles.device = 'CPU'
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.quality = 86
    world = bpy.data.worlds.new('studio')
    scene.world = world
    nt = world.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(bpy.utils.resource_path('LOCAL'), 'datafiles', 'studiolights', 'world', 'studio.exr'))
    bg = nt.nodes.get('Background')
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    key = B.link(bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN')))
    key.data.energy = 2.6
    key.rotation_euler = (math.radians(50), 0, math.radians(-35))
    cam = B.link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.data.type = 'ORTHO'
    scene.camera = cam
    clay = bpy.data.materials.new('clay')
    cb = clay.node_tree.nodes.get('Principled BSDF')
    cb.inputs['Base Color'].default_value = (0.55, 0.55, 0.57, 1)
    cb.inputs['Roughness'].default_value = 0.7
    for slot in w.obj.material_slots:
        slot.link = 'OBJECT'
        slot.material = clay
    return cam


VIEWS = {'back': V((0.5, 1.0, 0.25)), 'hair': V((0.6, -1.0, 0.25)), 'beard': V((0.5, -1.0, 0.1)), 'head': V((0.6, -1.0, 0.3)), 'feet': V((0.7, -1.0, 0.45))}


def thumbnail(it, parts, cam, path):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ v.co for o in parts for v in o.data.vertices]
    lo = V((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = V((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    d = VIEWS.get(it.slot, V((0.55, -1.0, 0.2))).normalized()
    rot = (-d).to_track_quat('-Z', 'Y')
    right = rot @ V((1, 0, 0))
    up = rot @ V((0, 1, 0))
    wdt = max(p.dot(right) for p in pts) - min(p.dot(right) for p in pts)
    hgt = max(p.dot(up) for p in pts) - min(p.dot(up) for p in pts)
    cam.data.ortho_scale = max(wdt, hgt) * 1.15
    cam.location = centre + d * 4
    cam.rotation_euler = rot.to_euler()
    cam.data.clip_end = 20
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------------------------------------ main


def main(opts):
    t0 = time.time()
    out = opts.get('out', os.path.join(HERE, '..', '..', '.scratch', 'wardrobe'))
    os.makedirs(out, exist_ok=True)
    only = set(opts['only'].split(',')) if opts.get('only') else None
    if only:
        unknown = only - {it.id for it in ITEMS}
        if unknown:
            raise SystemExit(f'no such items: {sorted(unknown)}')
    w = Wardrobe()
    log('reference body', len(w.obj.data.vertices), 'vertices', f'{time.time() - t0:.1f}s')
    # where the body's vertices sit, so the fit can check this body is its reference body
    me = w.obj.data
    check = [[i] + [round(x, 5) for x in gltf(me.vertices[i].co)] for i in range(0, len(me.vertices), 97)]
    cam = None if opts.get('no-thumbs') else setup_thumbs(w, int(opts.get('size', 256)))
    done = []
    for it in ITEMS:
        if only and it.id not in only:
            continue
        ts = time.time()
        mats = channel_materials(w, it)
        made = [p for p in (it.make(w) or []) if p is not None]
        others = [p for p in made if not isinstance(p, Dressed)]
        parts = [p.finish(others) if isinstance(p, Dressed) else p for p in made]
        for p in parts:
            p.data.update()
        tris = write_raw(os.path.join(out, f'{it.id}.json'), it, parts)
        if cam:
            thumbnail(it, parts, cam, os.path.join(out, f'{it.id}.webp'))
        done.append(it.id)
        log(it.id, it.slot, tris, 'tris', f'{time.time() - ts:.1f}s')
        for p in parts:
            pm = p.data
            bpy.data.objects.remove(p, do_unlink=True)
            bpy.data.meshes.remove(pm)
        for m in mats:
            bpy.data.materials.remove(m)
        for name, _c, _f in it.channels:
            w.d.mats.mats.pop(name, None)
        w.d.refresh()
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(dict(reference=build.REFERENCE, check=check, catalogue=[it.id for it in ITEMS], built=done), f, separators=(',', ':'))
    log('wrote', len(done), 'items to', out, f'{time.time() - t0:.1f}s')


if __name__ == '__main__':
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
    main(opts)
