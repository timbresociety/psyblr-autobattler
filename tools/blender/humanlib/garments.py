"""
Clothes and battle gear, built on the body itself rather than hung over it: a garment is the stretch of skin it
covers, pushed out by the cloth's thickness and painted its material (so nothing pokes through in a pose and no
triangles hide under cloth), plus real geometry where clothing stands off the body: collars, lapels, ties, belts,
cuffs, armour plates, sashes and capes. Parts cut from the body keep its skin weights; parts built from scratch take
the weights of the skin under them.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from .body import link

TORSO = {'hips', 'spine', 'chest', 'upper_chest', 'clavicle_L', 'clavicle_R'}


class Materials:
    """Region materials by name. A material's custom props say how the bake paints it and which region it is."""

    def __init__(self):
        self.mats = {}

    def get(self, name, **props):
        m = self.mats.get(name)
        if m is None:
            m = bpy.data.materials.new(name)
            for k, v in props.items():
                m[k] = v
            self.mats[name] = m
        return m


class Dresser:
    """Body-space queries over the rigged body mesh: bones, how far along a limb a point sits, and snapping."""

    def __init__(self, obj, rig, mats):
        self.obj = obj
        self.rig = rig
        self.mats = mats
        self.bones = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
        self.group_names = {g.index: g.name for g in obj.vertex_groups}
        self.vweights = []
        for v in obj.data.vertices:
            self.vweights.append({self.group_names[g.group]: g.weight for g in v.groups if g.weight > 0 and self.group_names[g.group] in self.bones})
        neck = self.bones['neck'][0]
        self.neck = neck
        self.waist_z = self.bones['spine'][0].z
        self.hip_z = self.bones['thigh_L'][0].z
        self.knee_z = self.bones['shin_L'][0].z
        self.ankle_z = self.bones['foot_L'][0].z
        self.shoulder_x = self.bones['upper_arm_L'][0].x
        self.thick = {}  # material name -> offset

    # ---------------------------------------------------------------------------------------- queries

    def face_bone(self, poly):
        acc = {}
        for vi in poly.vertices:
            for b, w in self.vweights[vi].items():
                acc[b] = acc.get(b, 0) + w
        return max(acc.items(), key=lambda kv: kv[1])[0] if acc else 'hips'

    def along(self, bone, p):
        h, t = self.bones[bone]
        d = t - h
        return max(0.0, min(1.0, (p - h).dot(d) / d.length_squared))

    def bvh(self, faces=None):
        me = self.obj.data
        verts = [v.co.copy() for v in me.vertices]
        polys = [list(p.vertices) for p in me.polygons if faces is None or p.index in faces]
        return BVHTree.FromPolygons(verts, polys)

    def weights_at(self, p, bvh=None, polys=None):
        """Skin weights of the body under point p (inverse-distance blend of the nearest face's corners)."""
        me = self.obj.data
        bvh = bvh or self._full_bvh()
        hit = bvh.find_nearest(p)
        poly = me.polygons[hit[2]] if polys is None else me.polygons[polys[hit[2]]]
        acc = {}
        total = 0.0
        for vi in poly.vertices:
            w = 1.0 / max(1e-4, (me.vertices[vi].co - hit[0]).length)
            total += w
            for b, x in self.vweights[vi].items():
                acc[b] = acc.get(b, 0) + x * w
        return {b: x / total for b, x in acc.items()}

    def _full_bvh(self):
        if not hasattr(self, '_bvh_all'):
            self._bvh_all = self.bvh()
        return self._bvh_all

    def refresh(self):
        if hasattr(self, '_bvh_all'):
            del self._bvh_all

    # ---------------------------------------------------------------------------------------- garments

    def covers(self, g, poly):
        """Does garment spec `g` cover this body face?"""
        c = poly.center
        b = self.face_bone(poly)
        kind = g['kind']
        side = b[-1] if b[-2:] in ('_L', '_R') else ''
        stem = b[:-2] if side else b
        n = self.neck
        if kind in ('trousers', 'shorts'):
            if b == 'hips' or stem == 'thigh':
                return c.z < self.waist_z + g.get('rise', 0.02)
            if stem == 'shin':
                return self.along(b, c) <= (0.4 if kind == 'shorts' else g.get('hem', 0.93))
            return b == 'spine' and c.z < self.waist_z + g.get('rise', 0.02)
        if kind in ('shoes', 'boots'):
            if stem == 'foot':
                return True
            return stem == 'shin' and self.along(b, c) > (0.94 if kind == 'shoes' else g.get('top', 0.55))
        if kind == 'gloves':
            return stem == 'hand' or (stem == 'forearm' and self.along(b, c) > g.get('cuff', 0.85))
        if kind == 'skin':
            return False
        # tops: a torso garment with sleeves, a hem and a neckline
        hem_z = {'waist': self.waist_z - 0.02, 'hip': self.hip_z - 0.04, 'crotch': self.hip_z - 0.12, 'thigh': self.hip_z - 0.24, 'knee': self.knee_z + 0.06}[g.get('hem', 'hip')]
        sleeve = g.get('sleeve', 1.0)  # 0 sleeveless, 0..1 along the upper arm, 1..2 along the forearm
        if stem == 'upper_arm':
            return sleeve > 0 and (sleeve >= 1 or self.along(b, c) <= sleeve)
        if stem == 'forearm':
            return sleeve > 1 and self.along(b, c) <= sleeve - 1
        if stem in ('hand', 'shin', 'foot', 'head'):
            return False
        if stem == 'thigh':
            return c.z >= hem_z
        if b not in TORSO and b != 'neck':
            return False
        if c.z < hem_z:
            return False
        if sleeve == 0 and abs(c.x) > self.shoulder_x - 0.02 and c.z > self.bones['upper_arm_L'][0].z - 0.12:
            return False  # the armhole of a vest
        # the neckline: the neck joint sits at the back of the neck's base; the front of the base is ~6 cm lower
        front = c.y < n.y
        neck = g.get('neck', 'crew')
        line = {'turtle': 0.07, 'mandarin': 0.025, 'collar': 0.012}.get(neck)
        if line is not None:
            return c.z < n.z + line - (0.03 if front else 0.0)
        depth = {'crew': 0.045, 'scoop': 0.08, 'v': 0.12, 'deep-v': 0.2}.get(neck, 0.05)
        if front:
            if neck in ('v', 'deep-v'):
                top = n.z - 0.035
                width = 0.075 if neck == 'v' else 0.1
                if c.z > top - depth and abs(c.x) < width * (c.z - (top - depth)) / depth + 0.01:
                    return False
                return c.z < top + 0.01
            return c.z < n.z - depth + 0.25 * abs(c.x)
        return c.z < n.z + 0.01

    def opening(self, g, poly):
        """The front of an open jacket or vest (it shows what is worn under it)."""
        if g.get('open') not in ('v', 'deep-v'):
            return False
        c = poly.center
        n = self.neck
        if c.y > n.y + 0.02 or poly.normal.y > -0.2:
            return False
        bottom = {'v': self.waist_z + 0.03, 'deep-v': self.waist_z - 0.03}[g['open']]
        top = n.z
        if c.z < bottom:
            return False
        width = g.get('open_width', 0.085)
        return abs(c.x) < width * (c.z - bottom) / (top - bottom) + 0.006

    def dress(self, layers):
        """
        layers: garments from the skin outwards, each {'kind', 'mat' (material name), 'thick', ...}. Every face takes
        the outermost garment that covers it; every vertex moves out by the thickness around it.
        """
        me = self.obj.data
        slots = {}

        def slot(name):
            if name not in slots:
                me.materials.append(self.mats.mats[name])
                slots[name] = len(me.materials) - 1
            return slots[name]

        slot('skin')
        face_thick = [0.0] * len(me.polygons)
        for poly in me.polygons:
            chosen = None
            for g in layers:
                # the outermost garment covering the face wins, unless the face sits in its open front
                if self.covers(g, poly) and not self.opening(g, poly):
                    chosen = g
            if chosen:
                poly.material_index = slot(chosen['mat'])
                face_thick[poly.index] = self.thickness(chosen, poly)
            else:
                poly.material_index = slot('skin')
        self.smooth_boundaries()
        # move each vertex out by the thickness of the faces around it (soft at a garment's edge)
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        bm.normal_update()
        moves = []
        for v in bm.verts:
            ts = [face_thick[f.index] for f in v.link_faces]
            if not ts:
                moves.append(None)
                continue
            covered = [t for t in ts if t > 0]
            off = (max(covered) * len(covered) / len(ts)) if covered else 0.0
            moves.append(v.normal * off if off else None)
        for v, m in zip(bm.verts, moves):
            if m is not None:
                v.co += m
        bm.to_mesh(me)
        bm.free()
        me.update()
        self.refresh()

    def thickness(self, g, poly):
        """Cloth thickness at a face: the garment's own, plus padded shoulders and flared hems where it has them."""
        t = g.get('thick', 0.006)
        c = poly.center
        if g.get('pad'):
            for side in 'LR':
                j = self.bones[f'upper_arm_{side}'][0]
                dist = (c - j).length
                if dist < 0.13:
                    t += g['pad'] * (1 - dist / 0.13)
        if g.get('flare'):
            b = self.face_bone(poly)
            if b.startswith('shin'):
                t += g['flare'] * self.along(b, c)
            elif b.startswith('thigh') and g['kind'] not in ('trousers', 'shorts'):
                t += g['flare'] * max(0.0, (self.hip_z - c.z) / 0.25)
        return t

    def smooth_boundaries(self, iterations=5, factor=0.5):
        """
        A garment's edge follows whole faces, so it steps; slide the edge's vertices along the skin until the line runs
        smooth (necklines, hems, cuffs). Junctions where three regions meet stay put.
        """
        me = self.obj.data
        names = [m.name for m in me.materials]
        group = lambda i: 'skin' if names[i] in ('skin', 'face') else names[i]
        bm = bmesh.new()
        bm.from_mesh(me)
        bvh = BVHTree.FromBMesh(bm)
        nbr = {}
        for e in bm.edges:
            if len(e.link_faces) == 2 and group(e.link_faces[0].material_index) != group(e.link_faces[1].material_index):
                a, b = e.verts
                nbr.setdefault(a, set()).add(b)
                nbr.setdefault(b, set()).add(a)
        for _ in range(iterations):
            moved = {}
            for v, ns in nbr.items():
                if len(ns) != 2:
                    continue
                a, b = ns
                moved[v] = v.co.lerp((a.co + b.co) / 2, factor)
            for v, p in moved.items():
                hit = bvh.find_nearest(p)
                v.co = hit[0] if hit[0] is not None else p
        bm.to_mesh(me)
        bm.free()
        me.update()

    def smooth_region(self, mat_names, iterations=2, factor=0.4):
        """Soften anatomy under heavy cloth (a jacket hides abs and pecs)."""
        me = self.obj.data
        idx = {i for i, m in enumerate(me.materials) if m.name in mat_names}
        bm = bmesh.new()
        bm.from_mesh(me)
        verts = [v for v in bm.verts if v.link_faces and all(f.material_index in idx for f in v.link_faces)]
        for _ in range(iterations):
            bmesh.ops.smooth_vert(bm, verts=verts, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.to_mesh(me)
        bm.free()
        me.update()
        self.refresh()

    # ---------------------------------------------------------------------------------------- parts cut from the body

    def shell(self, name, pick, offset, thickness, mat, smooth=True, scale_from=None, scale=1.0):
        """
        Copy the body faces `pick(poly)` selects into a new part, pushed out by `offset` and given `thickness`:
        armour plates, bracers, hair. The copy keeps the body's UVs and skin weights.
        """
        me = self.obj.data
        ids = [p.index for p in me.polygons if pick(p)]
        if not ids:
            return None
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        keep = set(ids)
        dead = [f for f in bm.faces if f.index not in keep]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.normal_update()
        for v in bm.verts:
            off = offset(v.co, v.normal) if callable(offset) else offset
            v.co += v.normal * off
            if scale_from is not None:
                v.co = scale_from + (v.co - scale_from) * scale
        if thickness:
            solidify(bm, thickness)
        out_me = bpy.data.meshes.new(name)
        bm.to_mesh(out_me)
        bm.free()
        obj = link(bpy.data.objects.new(name, out_me))
        for g in self.obj.vertex_groups:
            if not obj.vertex_groups.get(g.name):
                obj.vertex_groups.new(name=g.name)
        out_me.materials.clear()
        out_me.materials.append(self.mats.mats[mat])
        for p in out_me.polygons:
            p.material_index = 0
            p.use_smooth = smooth
        return obj

    # ---------------------------------------------------------------------------------------- parts built from scratch

    def ring_points(self, centre, axis, ref, count, radius=0.6, faces=None):
        """Points where rays from all around `axis` (through `centre`) first meet the body: a cross-section loop."""
        bvh = self.bvh(faces) if faces is not None else self._full_bvh()
        axis = axis.normalized()
        u = (ref - axis * ref.dot(axis)).normalized()
        w = axis.cross(u)
        dirs = []
        radii = []
        for k in range(count):
            a = 2 * math.pi * k / count
            d = u * math.cos(a) + w * math.sin(a)
            hit = bvh.ray_cast(centre + d * radius, -d, radius)
            dirs.append(d)
            radii.append((hit[0] - centre).dot(d) if hit[0] is not None else None)
        # a ray that found nothing takes the radius of its nearest neighbours, so the loop never caves in
        known = [k for k, r in enumerate(radii) if r is not None]
        if not known:
            return [centre + d * 0.05 for d in dirs]
        out = []
        for k, d in enumerate(dirs):
            r = radii[k]
            if r is None:
                prev = max((j for j in known if j < k), default=known[-1] - count)
                nxt = min((j for j in known if j > k), default=known[0] + count)
                t = (k - prev) / (nxt - prev)
                r = radii[prev % count] * (1 - t) + radii[nxt % count] * t
            out.append(centre + d * r)
        return out

    def band(self, name, centre, axis, ref, height, offset, mat, count=20, faces=None, flare=0.0, rigid=None, gap=None, radius=0.6, round_to=None):
        """
        A ring band (belt, collar, cuff): the body's cross-section, pushed out, `height` tall along the axis. With
        `round_to`, the section is re-centred and no point may stand further out than the narrowest one plus that
        much (a collar circles the neck instead of following the slope of the shoulders).
        """
        axis = axis.normalized()
        if round_to is not None:
            first = self.ring_points(centre, axis, ref, count, radius=radius, faces=faces)
            mid = sum(first, Vector()) / len(first)
            centre = mid - axis * (mid - centre).dot(axis)
        lo = self.ring_points(centre, axis, ref, count, radius=radius, faces=faces)
        hi = self.ring_points(centre + axis * height, axis, ref, count, radius=radius, faces=faces)
        if round_to is not None:
            for ring, c in ((lo, centre), (hi, centre + axis * height)):
                rs = [((p - c) - axis * (p - c).dot(axis)).length for p in ring]
                cap = sorted(rs)[len(rs) // 4] + round_to
                for k, p in enumerate(ring):
                    if rs[k] > cap:
                        radial = (p - c) - axis * (p - c).dot(axis)
                        ring[k] = c + axis * (p - c).dot(axis) + radial.normalized() * cap
        bm = bmesh.new()
        rows = []
        for ring, h, extra in ((lo, 0, 0.0), (hi, 1, flare)):
            row = []
            for k, p in enumerate(ring):
                c = centre + axis * (height * h)
                radial = p - c
                radial -= axis * radial.dot(axis)
                d = radial.normalized() if radial.length > 1e-6 else Vector((1, 0, 0))
                row.append(bm.verts.new(p + d * (offset + extra)))
            rows.append(row)
        uv = bm.loops.layers.uv.new('UVMap')
        for k in range(count):
            if gap is not None and gap(k, count):
                continue
            k2 = (k + 1) % count
            f = bm.faces.new((rows[0][k], rows[0][k2], rows[1][k2], rows[1][k]))
            for loop, (uu, vv) in zip(f.loops, ((k / count, 0), ((k + 1) / count, 0), ((k + 1) / count, 1), (k / count, 1))):
                loop[uv].uv = (uu, vv * 0.15)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        # make sure normals face outward from the axis
        for f in bm.faces:
            c = f.calc_center_median()
            radial = c - centre
            radial -= axis * radial.dot(axis)
            if f.normal.dot(radial) < 0:
                f.normal_flip()
        return self._finish(name, bm, mat, rigid)

    def strip(self, name, path, widths, side, offset, mat, rigid=None, faces=None, snap_dir=None, thickness=0.0):
        """
        A strip lying on the body along `path` (tie, lapel, sash): each path point is snapped onto the skin (rays
        along `snap_dir` or toward the body's centre line), then spread `widths[i]` along `side(i, point, normal)`.
        """
        bvh = self.bvh(faces) if faces is not None else self._full_bvh()
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        rows = []
        for i, p in enumerate(path):
            d = snap_dir(i, p) if snap_dir else Vector((p.x * 0.0, -1, 0))
            hit = bvh.ray_cast(p - d * 0.4, d, 0.8)
            q, n = (hit[0], hit[1]) if hit[0] is not None else (p, -d)
            s = side(i, q, n).normalized()
            w = widths[i]
            base = q + n * offset
            rows.append((bm.verts.new(base - s * w[0]), bm.verts.new(base + s * w[1])))
        total = len(path) - 1
        for i in range(total):
            a, b = rows[i]
            c, d = rows[i + 1]
            f = bm.faces.new((a, b, d, c))
            for loop, (uu, vv) in zip(f.loops, ((0, i / total), (1, i / total), (1, (i + 1) / total), (0, (i + 1) / total))):
                loop[uv].uv = (uu * 0.1, vv * 0.5)
        if thickness:
            solidify(bm, thickness)
        return self._finish(name, bm, mat, rigid)

    def _finish(self, name, bm, mat, rigid):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        obj = link(bpy.data.objects.new(name, me))
        me.materials.append(self.mats.mats[mat])
        for p in me.polygons:
            p.use_smooth = True
        self.skin_weights(obj, rigid)
        return obj

    def skin_weights(self, obj, rigid=None):
        """Weight a new part like the skin under it (or entirely to one bone)."""
        for g in list(obj.vertex_groups):
            obj.vertex_groups.remove(g)
        groups = {}

        def group(b):
            if b not in groups:
                groups[b] = obj.vertex_groups.new(name=b)
            return groups[b]

        if rigid:
            group(rigid).add(range(len(obj.data.vertices)), 1.0, 'REPLACE')
            return
        for v in obj.data.vertices:
            for b, w in self.weights_at(v.co).items():
                if w > 0.01:
                    group(b).add([v.index], w, 'REPLACE')


def solidify(bm, thickness):
    """
    Give an open surface `thickness` inward (behind its normals), with walls round its edges. Plain vertex-normal
    offsets: no even-thickness factor, which explodes on the folds of a lumpy or extruded surface.
    """
    bm.normal_update()
    verts = bm.verts[:]
    faces = bm.faces[:]
    boundary = [e for e in bm.edges if e.is_boundary]
    normals = {v: v.normal.copy() for v in verts}
    inner = {}
    for v in verts:
        # the copy carries the original's data (skin weights) so the inside moves with the outside
        inner[v] = bm.verts.new(v.co - normals[v] * thickness, v)
    for f in faces:
        try:
            bm.faces.new([inner[v] for v in reversed(f.verts)], f)
        except ValueError:
            pass
    for e in boundary:
        a, b = e.verts
        # keep the wall's winding consistent with the outer face along this edge
        loop = e.link_loops[0]
        if loop.vert is not a:
            a, b = b, a
        try:
            bm.faces.new((b, a, inner[a], inner[b]), loop.face)
        except ValueError:
            pass
    bm.normal_update()


def mesh_box(name, size, at, mat_obj, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if rot is not None:
        bmesh.ops.transform(bm, matrix=rot.to_4x4(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=at, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    me.materials.append(mat_obj)
    return obj
