"""
The head the wardrobe shapes hair and headwear on (tools/blender/wardrobe.py): where its scalp, hairline and face
landmarks sit, hair as the scalp lifted into a shell (volume, sweep and length by style) with drops and fringes extruded
from its edge, and a Roman helmet. Everything rides the head bone.
"""

import math

import bmesh
import bpy
from mathutils import Vector

from .body import link
from .garments import solidify

# MediaPipe landmark ids used to place things on the face
MOUTH_L, MOUTH_R, CHIN, NOSE_TIP, NOSE_BASE, LIP_TOP, BROW_L, BROW_R, CHEEK_L, CHEEK_R = 291, 61, 152, 1, 2, 0, 334, 105, 454, 234


class Head:
    """Points on the hero's head in metres (character faces -y, its left is +x)."""

    def __init__(self, body, obj):
        (el, rl), (er, rr) = body.eyes
        self.eye_l, self.eye_r = el, er
        self.eye_r_radius = rl
        self.eyes = (el + er) / 2
        head_w = [0.0] * len(obj.data.vertices)
        g = obj.vertex_groups.get('head')
        for v in obj.data.vertices:
            for x in v.groups:
                if g and x.group == g.index:
                    head_w[v.index] = x.weight
        pts = [v.co.copy() for v in obj.data.vertices if head_w[v.index] > 0.6]
        self.top = max(p.z for p in pts)
        self.front = min(p.y for p in pts)
        self.back = max(p.y for p in pts)
        self.half_width = max(abs(p.x) for p in pts if abs(p.z - self.eyes.z) < 0.03)
        self.centre = Vector((0.0, (self.front + self.back) / 2, self.eyes.z + 0.01))
        lm = body.lm
        if lm is not None:
            P, ok = lm
            at = lambda i, fallback: Vector(P[i]) if ok[i] else fallback
        else:
            at = lambda i, fallback: fallback
        e = self.eyes
        self.mouth_l = at(MOUTH_L, e + Vector((0.025, -0.01, -0.075)))
        self.mouth_r = at(MOUTH_R, e + Vector((-0.025, -0.01, -0.075)))
        self.mouth = (self.mouth_l + self.mouth_r) / 2
        self.chin = at(CHIN, e + Vector((0, 0.0, -0.125)))
        self.nose = at(NOSE_TIP, e + Vector((0, -0.03, -0.04)))
        self.nose_base = at(NOSE_BASE, e + Vector((0, -0.02, -0.052)))
        self.lip_top = at(LIP_TOP, e + Vector((0, -0.02, -0.065)))
        self.brow = (at(BROW_L, e + Vector((0.03, 0, 0.03))) + at(BROW_R, e + Vector((-0.03, 0, 0.03)))) / 2
        self.cheek_l = at(CHEEK_L, e + Vector((0.07, 0.03, -0.01)))
        self.cheek_r = at(CHEEK_R, e + Vector((-0.07, 0.03, -0.01)))

    def azimuth(self, p):
        """0 straight ahead, +-pi at the back; positive toward the hero's left."""
        return math.atan2(p.x - self.centre.x, -(p.y - self.centre.y))

    def hairline(self, p, recede=0.0, temple=0.0, nape=0.0, sideburn=0.0):
        """The height of the hairline at p's bearing around the head."""
        a = abs(self.azimuth(p))
        e = self.eyes.z
        brow = self.brow.z
        # (bearing, height above the eyes): forehead, temple, above the ear, behind the ear, nape
        table = [
            (0.0, brow - e + 0.06 + recede),
            (0.55, brow - e + 0.055 + recede * 0.8 + temple),
            (1.05, 0.03 + temple * 0.5 - sideburn),
            (1.45, 0.015 - sideburn * 0.5),
            (1.9, -0.035 - nape * 0.5),
            (math.pi, -0.075 - nape),
        ]
        for (a0, h0), (a1, h1) in zip(table, table[1:]):
            if a <= a1:
                t = (a - a0) / (a1 - a0)
                return e + h0 + (h1 - h0) * t
        return e + table[-1][1]


STYLES = {
    # thickness on top / at the sides / at the back (m), plus shaping: most men's hair lies close at the sides
    'buzz': dict(top=0.003, side=0.002, back=0.002),
    'crop': dict(top=0.008, side=0.004, back=0.005),
    'short': dict(top=0.014, side=0.006, back=0.007, sweep=0.006, lift=0.004),
    'curly': dict(top=0.02, side=0.008, back=0.01, lumps=0.007),
    'swept': dict(top=0.03, side=0.007, back=0.01, sweep=0.025, lift=0.02),
    'quiff': dict(top=0.034, side=0.012, back=0.016, sweep=0.03, lift=0.03),
    'side_part': dict(top=0.016, side=0.006, back=0.008, sweep=0.012, lift=0.008, part=0.4),
    'thin': dict(top=0.003, side=0.004, back=0.005),
    'fringe_white': dict(top=0.007, side=0.005, back=0.006, sweep=0.008),
    'unkempt': dict(top=0.022, side=0.017, back=0.019, lumps=0.008, drop=0.03),
    'bob': dict(top=0.018, side=0.016, back=0.02, drop=0.1, drop_front=0.06),
    'long': dict(top=0.02, side=0.02, back=0.025, drop=0.25, drop_front=0.15, flare=0.03),
    'volume': dict(top=0.045, side=0.045, back=0.045, drop=0.18, drop_front=0.1, flare=0.05),
    'spiky': dict(top=0.03, side=0.01, back=0.012, lumps=0.02, lift=0.02, sweep=0.01),
}


def make_hair(d, head, style, recede=0.0, temple=0.0, nape=0.0, sideburn=0.0, bangs=0.0, mat='hair', thickness=0.005):
    """A hair shell lifted off the scalp in the style's shape; returns the object (or None for 'bald')."""
    if style in (None, 'bald'):
        return None
    st = STYLES[style]
    skin_idx = [i for i, m in enumerate(d.obj.data.materials) if m.name in ('skin', 'face')]

    def scalp(poly):
        c = poly.center
        if poly.material_index not in skin_idx or d.face_bone(poly) not in ('head', 'neck'):
            return False
        if c.z < head.eyes.z - 0.12:
            return False
        if style == 'thin' and abs(head.azimuth(c)) < 1.4 and c.z > head.eyes.z + 0.07:
            return False  # a bald crown with hair round the sides and back
        # take a margin below the hairline: the shell dips under the skin there, so the visible edge is a smooth
        # curve where the shell crosses the skin, not the steps of whole faces
        return c.z >= head.hairline(c, recede, temple, nape, sideburn) - 0.03

    top_z = head.top

    def grown(p):
        """0 below the hairline, 1 just above it (smooth)."""
        t = max(0.0, min(1.0, (p.z - head.hairline(p, recede, temple, nape, sideburn) + 0.012) / 0.022))
        return t * t * (3 - 2 * t)

    def lift(p, n):
        a = abs(head.azimuth(p))
        up = max(0.0, min(1.0, (p.z - head.eyes.z) / max(0.01, top_z - head.eyes.z)))
        side = st['side'] + (st['top'] - st['side']) * up ** 1.5
        thick = side if a < 2.0 else side + (st['back'] - st['side']) * (a - 2.0) / (math.pi - 2.0)
        if st.get('lumps'):
            thick += st['lumps'] * (0.5 + 0.5 * math.sin(p.x * 140) * math.sin(p.y * 120 + p.z * 90))
        w = grown(p)
        if st.get('drop') and a > 0.9:
            # hair that hangs (a bob, long hair) starts from the outside of the head, not from under the skin
            w = 1.0
        return thick * w - 0.005 * (1 - w)

    hair = d.shell('hair', scalp, lift, 0.0, mat)
    if hair is None:
        return None
    bm = bmesh.new()
    bm.from_mesh(hair.data)
    # sweep and lift: the front-top pushed back and up (a quiff, a swept mane, a side part)
    for v in bm.verts:
        a = head.azimuth(v.co)
        front = max(0.0, math.cos(a))
        up = max(0.0, min(1.0, (v.co.z - head.eyes.z - 0.04) / 0.08)) * grown(v.co)
        if st.get('sweep'):
            v.co.y += st['sweep'] * front * up
        if st.get('lift'):
            v.co.z += st['lift'] * front * up * (1.0 - 0.5 * abs(math.sin(a)))
        if st.get('part'):
            # more volume on one side of a side part
            v.co += Vector((math.copysign(1, v.co.x), 0, 0.4)) * 0.004 * up * (1 if v.co.x < 0 else 0.3)
    # drops: extend the lower edge at the sides and back (bob, long, volume); bangs over the forehead
    drop = st.get('drop', 0.0)
    if drop or bangs:
        boundary = [e for e in bm.edges if e.is_boundary]
        back_edges = [e for e in boundary if abs(head.azimuth((e.verts[0].co + e.verts[1].co) / 2)) > 0.9] if drop else []
        front_edges = [e for e in boundary if abs(head.azimuth((e.verts[0].co + e.verts[1].co) / 2)) <= 0.9] if bangs else []
        for edges, length, is_bangs in ((back_edges, drop, False), (front_edges, bangs, True)):
            if not edges:
                continue
            segs = 2 if length > 0.08 else 1
            current = edges
            for _ in range(segs):
                res = bmesh.ops.extrude_edge_only(bm, edges=current)
                new_verts = [x for x in res['geom'] if isinstance(x, bmesh.types.BMVert)]
                for v in new_verts:
                    frontness = max(0.0, math.cos(head.azimuth(v.co)))
                    if is_bangs:
                        seg = length / segs
                    else:
                        # shorter toward the face, so a bob frames it
                        lf = st.get('drop_front', length) / max(length, 1e-6)
                        seg = length / segs * (1.0 - frontness * (1.0 - lf))
                    v.co.z -= seg
                    if is_bangs:
                        v.co.y -= 0.004
                    else:
                        out = Vector((v.co.x - head.centre.x, v.co.y - head.centre.y, 0))
                        out = out.normalized() if out.length > 1e-6 else Vector((0, 1, 0))
                        v.co += out * (st.get('flare', 0.01) / segs)
                new_set = set(new_verts)
                current = [x for x in res['geom'] if isinstance(x, bmesh.types.BMEdge) and all(vv in new_set for vv in x.verts)]
    # a shell that dips under the skin at its edge needs no back; hair that hangs free (drops, fringes) does
    if drop or bangs:
        solidify(bm, thickness)
    bm.to_mesh(hair.data)
    bm.free()
    for p in hair.data.polygons:
        p.use_smooth = True
    d.skin_weights(hair, rigid='head')
    return hair


def make_helmet(d, head, mat='helmet', crest='crest'):
    """A Roman galea for the generic bodies: a bronze bowl over the scalp down to the nape, open at the face, with a crest."""
    skin_idx = [i for i, m in enumerate(d.obj.data.materials) if m.name in ('skin', 'face')]

    def region(poly):
        c = poly.center
        if poly.material_index not in skin_idx or d.face_bone(poly) not in ('head', 'neck'):
            return False
        if c.y < head.front + 0.035 and c.z < head.brow.z + 0.02:
            return False  # the face stays open
        return c.z >= head.hairline(c, recede=-0.012, temple=-0.01, nape=0.03, sideburn=0.035) - 0.02

    def lift(p, n):
        t = max(0.0, min(1.0, (p.z - head.hairline(p, recede=-0.012, temple=-0.01, nape=0.03, sideburn=0.035) + 0.01) / 0.02))
        return 0.024 * t - 0.004 * (1 - t)

    helm = d.shell('helmet', region, lift, 0.006, mat)
    if helm is None:
        return []
    d.skin_weights(helm, rigid='head')
    # the crest: a fin along the crown, tallest over the top of the head
    bm = bmesh.new()
    pts = []
    for k in range(9):
        a = math.pi * (0.12 + 0.8 * k / 8)
        y = head.centre.y - math.cos(a) * (head.back - head.front) * 0.5
        hit = None
        for o in (helm,):
            from mathutils.bvhtree import BVHTree

            bvh = BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get())
            hit = bvh.ray_cast(Vector((0, y, head.top + 0.3)), Vector((0, 0, -1)), 0.6)
        z = hit[0].z if hit and hit[0] is not None else head.top
        pts.append((y, z - 0.004, 0.035 + 0.035 * math.sin(a)))
    rows = []
    for y, z, h in pts:
        rows.append([bm.verts.new((-0.008, y, z)), bm.verts.new((-0.008, y, z + h)), bm.verts.new((0.008, y, z + h)), bm.verts.new((0.008, y, z))])
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(3):
            bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('crest')
    bm.to_mesh(me)
    bm.free()
    fin = link(bpy.data.objects.new('crest', me))
    me.materials.append(d.mats.mats[crest])
    for p in me.polygons:
        p.use_smooth = True
    d.skin_weights(fin, rigid='head')
    return [helm, fin]
