"""
The body: MPFB's parametric human (MakeHuman, CC0 output) shaped by macros and targets, its game-ready low-poly proxy
topology with MakeHuman's own skin weights, the high-res surface it was fitted to (for landmarks and shrinkwrapping),
the eye centres and the joint positions the game rig is built on. Nothing from the asset packs ships except the proxy
topology itself: skin, hair and clothes are made by the rest of humanlib.
"""

import glob
import os

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
from bl_ext.user_default.mpfb.services.targetservice import TargetService


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.actions, bpy.data.images, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for x in list(coll):
            coll.remove(x)


def proxy_file(name):
    hits = glob.glob(os.path.join(LocationService.get_user_data(), 'proxymeshes', name, name + '.proxy'))
    if not hits:
        raise FileNotFoundError(f'MPFB proxy {name!r} not installed (makehuman_system_assets pack)')
    return hits[0]


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def plain_copy(obj, name, keep_groups=True):
    """The evaluated mesh of `obj` (shape keys mixed, modifiers applied) as a new plain object with the same groups."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.name = name
    out = link(bpy.data.objects.new(name, me))
    # the mesh carries its group names; recreate them on the object only if they did not come along
    if keep_groups and len(out.vertex_groups) == 0:
        for g in obj.vertex_groups:
            out.vertex_groups.new(name=g.name)
    out.matrix_world = obj.matrix_world.copy()
    return out


class Body:
    """What the rest of the pipeline needs from MPFB."""

    def __init__(self, mesh, hires, joints, eyes, height):
        self.mesh = mesh  # the proxy topology, with MPFB game_engine weights
        self.hires = hires  # the high-res body surface (helpers removed), same shape
        self.joints = joints  # MPFB bone name -> (head, tail) in metres
        self.eyes = eyes  # [(centre, radius)] for the left (+x) and right eye
        self.height = height
        self._bvh = None

    def bvh(self):
        if self._bvh is None:
            self._bvh = BVHTree.FromObject(self.hires, bpy.context.evaluated_depsgraph_get())
        return self._bvh

    def joint(self, name, end='head'):
        h, t = self.joints[name]
        return (h if end == 'head' else t).copy()


def make_body(macro, targets, proxy, height=1.8, extra=None, head_scale=1.0, scale=None):
    """
    A human from MPFB: `macro` overrides the default macro dict (gender, age, muscle, weight, proportions, height,
    race), `targets` maps target names to weights, `proxy` names the topology. Scaled so the top of the head is at
    `height` metres, or by `scale` exactly when given (a variant of a body keeps that body's scale, so subtracting the
    two leaves only the change). `extra(human)` may load more targets before the rig and proxy are fitted (face fitting).
    """
    clear_scene()
    m = TargetService.get_default_macro_info_dict()
    for k, v in macro.items():
        if k == 'race':
            m['race'].update(v)
        else:
            m[k] = v
    human = HumanService.create_human(macro_detail_dict=m)
    for name, w in targets.items():
        path = TargetService.target_full_path(name)
        if path is None:
            raise ValueError(f'unknown MPFB target {name!r}')
        TargetService.load_target(human, path, weight=w)
    if extra:
        extra(human)
    rig = HumanService.add_builtin_rig(human, 'game_engine')
    prox = HumanService.add_mhclo_asset(proxy_file(proxy), human, asset_type='Proxymeshes', subdiv_levels=0, material_type='NONE')
    for mod in list(prox.modifiers):
        if mod.type != 'ARMATURE':
            prox.modifiers.remove(mod)
    mesh = plain_copy(prox, 'body')
    hires = plain_copy(human, 'hires')
    # eyes: the helper eyeballs, read with the helper mask off
    mask = human.modifiers.get('Hide helpers')
    if mask:
        mask.show_viewport = False
    full = plain_copy(human, 'full')
    eyes = []
    for g in ('helper-l-eye', 'helper-r-eye'):
        gi = full.vertex_groups[g].index
        pts = [v.co for v in full.data.vertices if any(x.group == gi and x.weight > 0.5 for x in v.groups)]
        c = sum(pts, Vector()) / len(pts)
        r = sum((p - c).length for p in pts) / len(pts)
        eyes.append((c, r))
    joints = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
    # where MediaPipe's face landmarks sit on this shaped head (hair, beards and glasses are placed from them)
    from . import face as F

    lm = None
    if os.path.exists(F.BIND_FILE):
        lm = F.landmark_positions(F.full_coords(human), F.load_bind())
    for o in (full, human, rig, prox):
        bpy.data.objects.remove(o, do_unlink=True)
    for o in (mesh, hires):
        o.modifiers.clear()
        o.parent = None
    if head_scale != 1.0:
        # stylised realism: a slightly bigger head reads at arena distance (blended by the head's skin weight)
        J = joints['head'][0].copy()
        k = head_scale - 1.0
        for o in (mesh, hires):
            w = group_weight(o, 'head')
            for v in o.data.vertices:
                if w[v.index] > 0:
                    v.co = J + (v.co - J) * (1 + k * w[v.index])
        eyes = [(J + (c - J) * head_scale, r * head_scale) for c, r in eyes]
        if lm is not None:
            import numpy as np

            Jn = np.array(J)
            lm = (Jn + (lm[0] - Jn) * head_scale, lm[1])
        joints['head'] = (joints['head'][0], J + (joints['head'][1] - J) * head_scale)
    s = scale if scale is not None else height / max(v.co.z for v in hires.data.vertices)
    S = Matrix.Scale(s, 4)
    for o in (mesh, hires):
        o.data.transform(S)
        o.matrix_world = Matrix()
    joints = {k: (h * s, t * s) for k, (h, t) in joints.items()}
    eyes = [(c * s, r * s) for c, r in eyes]
    out = Body(mesh, hires, joints, eyes, height)
    out.scale = s
    out.lm = (lm[0] * s, lm[1]) if lm is not None else None
    return out


def group_weight(obj, name):
    """Per-vertex weight of a vertex group (0 where the vertex is not in it)."""
    out = [0.0] * len(obj.data.vertices)
    g = obj.vertex_groups.get(name)
    if not g:
        return out
    for v in obj.data.vertices:
        for x in v.groups:
            if x.group == g.index:
                out[v.index] = x.weight
    return out


def face_polygons(body):
    """The proxy faces a likeness needs refined: front-facing faces of the head (the scalp hides under hair)."""
    obj = body.mesh
    head_w = group_weight(obj, 'head')
    return sorted(p.index for p in obj.data.polygons if all(head_w[v] > 0.5 for v in p.vertices) and p.normal.y < -0.25)


def refine_head(body, faces=None, levels=1):
    """
    Give the face the density a likeness needs: subdivide the proxy's face and pull every head vertex onto the
    high-res MakeHuman surface, so nose, lips and jaw keep their real shape. Neighbouring neck faces take the split
    edges as n-gons (triangulated on export), so nothing cracks.

    `faces` lists the proxy faces to split. The bodies pass the stored list (topology.json), so every body built on that
    proxy comes out with the same vertices in the same order; without it the face is picked by its normals, which
    depend on the shape. Returns the faces it split.
    """
    obj = body.mesh
    if faces is None:
        faces = face_polygons(body)
    # the proxy's own vertices come first; refining appends the split points after them (triangulate reads this)
    body.proxy_verts = len(obj.data.vertices)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    picked = [bm.faces[i] for i in faces]
    # sorted, so the new vertices are made in the same order on every body
    edges = sorted({e for f in picked for e in f.edges}, key=lambda e: e.index)
    for _ in range(levels):
        res = bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, use_grid_fill=True, smooth=0.0)
        edges = [e for e in res['geom'] if isinstance(e, bmesh.types.BMEdge)]
    bvh = body.bvh()
    zmin = min(v.co.z for f in picked for v in f.verts) - 0.02
    for v in bm.verts:
        if v.co.z < zmin:
            continue
        hit = bvh.find_nearest(v.co)
        if hit[0] is not None and (hit[0] - v.co).length < 0.02:
            v.co = hit[0]
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return list(faces)


def triangulate(obj, corners):
    """
    Split every face into triangles the same way on every body: a quad along its first diagonal, an n-gon as a fan
    from one of its `corners` (vertex indices below that are the proxy's own; the rest were split points) whose
    neighbours are corners too, so no sliver lies along a split edge. Left to the exporter, each quad would take its
    shorter diagonal, which depends on the shape.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) == 4], quad_method='FIXED')
    for f in [f for f in bm.faces if len(f.verts) > 4]:
        v = [l.vert for l in f.loops]
        n = len(v)
        real = [i for i in range(n) if v[i].index < corners]
        clear = [i for i in real if v[i - 1].index < corners and v[(i + 1) % n].index < corners]
        o = min(clear or real or [0], key=lambda i: v[i].index)
        v = v[o:] + v[:o]
        for k in range(2, n - 1):
            # cut the triangle (v0, v[k-1], v[k]) off; carry on with whichever side still has more than three corners
            nf, _ = bmesh.utils.face_split(f, v[0], v[k])
            if len(nf.verts) > 3:
                f = nf
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def positions(obj):
    """An object's vertex positions as an (n, 3) array."""
    import numpy as np

    a = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def make_eyes(body, iris_dir=Vector((0, -1, 0)), segments=12, rings=8):
    """Two eyeballs where MakeHuman's helper eyes sit, poles facing forward so the iris has round topology."""
    out = []
    for i, (c, r) in enumerate(body.eyes):
        bm = bmesh.new()
        # made at unit size and scaled after: the generator's vertex order depends on the radius, and every body's
        # eyes must match vertex for vertex
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
        rot = Vector((0, 0, 1)).rotation_difference(iris_dir).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ rot @ Matrix.Scale(r * 0.97, 4), verts=bm.verts)
        me = bpy.data.meshes.new('eye')
        bm.to_mesh(me)
        bm.free()
        o = link(bpy.data.objects.new('eye_L' if i == 0 else 'eye_R', me))
        for p in o.data.polygons:
            p.use_smooth = True
        out.append(o)
    return out


def triangles(objs):
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
