"""
The kit's built-in pieces: rigid gear a hero carries in a socket (humanlib/sockets.py). Each is its own small GLB with
a thumbnail in public/kit/pieces/, and src/kit/pieces.gen.ts lists them for the Forge and the server. Every player
can use these for free; the asset repository adds the ones players generate.

    Blender -b --python tools/blender/pieces.py -- [--only katana,crown] [--no-thumbs] [--sheet out.png]

Modelled in socket space, in Blender's axes: the socket's point is the origin, up is +z and the hero's front is -y. A
hand piece's length runs along +z (the thumb) with its edge toward -y (the fingertips); a shield faces +x, the back of
the left hand. Head and face pieces fit a head sockets.PIECE_HEAD_HALF_WIDTH wide. A material named 'primary' takes
the colour the player picks for the piece.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'public', 'kit', 'pieces')
MANIFEST = os.path.join(ROOT, 'src', 'kit', 'pieces.gen.ts')
V = Vector


def log(*a):
    print('[pieces]', *a, flush=True)


def srgb(hexstr):
    """'#rrggbb' to linear RGB, the way Blender's colour inputs want it."""
    c = [int(hexstr[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# fixed materials; 'primary' comes from each piece. Metals stay satin (not fully metallic) so they read as metal
# under plain lights too: the Forge's plinth and the roster's busts have no environment map to reflect
PALETTE = {
    'steel': dict(color='#b9bec6', metallic=0.65, roughness=0.35),
    'dark_steel': dict(color='#3a3b42', metallic=0.6, roughness=0.45),
    'gold': dict(color='#e0aa48', metallic=0.7, roughness=0.3),
    'wood': dict(color='#5e3c22', roughness=0.72),
    'leather': dict(color='#3d2416', roughness=0.62),
    'black': dict(color='#0b0b0d', roughness=0.45),
    'ivory': dict(color='#e3d7bb', roughness=0.5),
    'glass': dict(color='#16202a', roughness=0.04, alpha=0.4),
    'string': dict(color='#ddd6c8', roughness=0.85),
    'feather': dict(color='#f1efe9', roughness=0.85),
}


def make_material(name, spec):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*srgb(spec['color']), 1.0)
    bsdf.inputs['Metallic'].default_value = spec.get('metallic', 0.0)
    bsdf.inputs['Roughness'].default_value = spec.get('roughness', 0.5)
    if spec.get('emit'):
        bsdf.inputs['Emission Color'].default_value = (*srgb(spec['color']), 1.0)
        bsdf.inputs['Emission Strength'].default_value = spec['emit']
    if spec.get('alpha', 1.0) < 1.0:
        bsdf.inputs['Alpha'].default_value = spec['alpha']
        try:
            m.surface_render_method = 'BLENDED'
        except AttributeError:
            pass
    m.use_backface_culling = False
    return m


# ------------------------------------------------------------------------------------------------ geometry


def perpendicular(t):
    ref = V((0, 0, 1)) if abs(t.z) < 0.9 else V((1, 0, 0))
    u = t.cross(ref).normalized()
    return u, t.cross(u).normalized()


def ring(c, u, v, rx, ry, seg, phase=0.0):
    return [c + u * (rx * math.cos(2 * math.pi * k / seg + phase)) + v * (ry * math.sin(2 * math.pi * k / seg + phase)) for k in range(seg)]


def sweep(bm, sections, cap0=True, cap1=True, tip0=None, tip1=None, closed=False):
    """Skin consecutive point rings (each the same length) with quads; cap the ends flat or close them on a tip."""
    rings = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(rings[0])
    faces = []
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for a, b in pairs:
        for k in range(n):
            faces.append(bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k])))
    if not closed:
        if tip0 is not None:
            t = bm.verts.new(tip0)
            faces += [bm.faces.new((rings[0][(k + 1) % n], rings[0][k], t)) for k in range(n)]
        elif cap0:
            faces.append(bm.faces.new(rings[0][::-1]))
        if tip1 is not None:
            t = bm.verts.new(tip1)
            faces += [bm.faces.new((rings[-1][k], rings[-1][(k + 1) % n], t)) for k in range(n)]
        elif cap1:
            faces.append(bm.faces.new(rings[-1]))
    return faces


def tube(bm, path, radii, seg=10, cap=True, tip=False, ry=None):
    """A tube along a polyline, its frame carried along the path so it never twists."""
    sections = []
    u = v = None
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        if u is None:
            u, v = perpendicular(t)
        else:
            u = (u - t * u.dot(t)).normalized()
            v = t.cross(u).normalized()
        r = radii[i]
        sections.append(ring(p, u, v, r, r * (ry or 1.0), seg))
    if tip:
        end = path[-1] + (path[-1] - path[-2]).normalized() * radii[-1] * 0.5
        return sweep(bm, sections, cap0=cap, tip1=end)
    return sweep(bm, sections, cap0=cap, cap1=cap)


def rod(bm, z0, z1, r0, r1=None, seg=10, x=0.0, y=0.0, ry=1.0):
    """A straight round (or oval) rod along z."""
    return tube(bm, [V((x, y, z0)), V((x, y, z1))], [r0, r0 if r1 is None else r1], seg=seg, ry=ry)


def lathe(bm, profile, seg=24, sx=1.0, sy=1.0, c=V((0, 0, 0))):
    """A surface of revolution about z from (radius, height) pairs; a zero radius at either end closes on a point."""
    pts = list(profile)
    tip0 = tip1 = None
    if pts[0][0] == 0:
        tip0 = c + V((0, 0, pts[0][1]))
        pts = pts[1:]
    if pts[-1][0] == 0:
        tip1 = c + V((0, 0, pts[-1][1]))
        pts = pts[:-1]
    sections = [ring(c + V((0, 0, z)), V((1, 0, 0)), V((0, 1, 0)), r * sx, r * sy, seg) for r, z in pts]
    return sweep(bm, sections, cap0=tip0 is None, cap1=tip1 is None, tip0=tip0, tip1=tip1)


def box(bm, lo, hi):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    v = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    quads = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))
    return [bm.faces.new([v[i] for i in q]) for q in quads]


def ball(bm, c, r, seg=16, rings_=8, scale=(1, 1, 1)):
    profile = [(r * math.sin(math.pi * i / rings_), -r * math.cos(math.pi * i / rings_)) for i in range(rings_ + 1)]
    profile[0] = (0, profile[0][1])
    profile[-1] = (0, profile[-1][1])
    faces = lathe(bm, [(pr * 1.0, z * scale[2]) for pr, z in profile], seg=seg, sx=scale[0], sy=scale[1], c=c)
    return faces


def torus(bm, c, R_, r, seg=28, rseg=8, tilt=0.0):
    """A ring lying flat (about z), optionally tipped back about x."""
    m = Matrix.Rotation(tilt, 3, 'X')
    sections = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        centre = V((R_ * math.cos(a), R_ * math.sin(a), 0))
        out = centre.normalized()
        sections.append([c + m @ (centre + out * (r * math.cos(2 * math.pi * j / rseg)) + V((0, 0, r * math.sin(2 * math.pi * j / rseg)))) for j in range(rseg)])
    return sweep(bm, sections, closed=True)


def blade(bm, length, z0, half_w, half_t, curve=0.0, single=False, taper=0.25, tip=0.08, stations=14, y0=0.0):
    """
    A blade from z0 up `length`, edge toward -y. Its section is a flat hexagon: a double edge (a sword) or an edge
    and a spine (a katana, with `curve` metres of bow toward the spine at the tip).
    """
    sections = []
    for i in range(stations + 1):
        s = i / stations * (1 - tip * 0.5)
        k = 1.0 - taper * s
        if s > 1 - tip:
            k *= max(0.08, (1 - s) / tip) ** 0.7
        w, t = half_w * k, half_t * (0.6 + 0.4 * k)
        y = y0 + curve * s * s
        z = z0 + length * s
        if single:
            sec = [(0, -w), (t * 0.7, -w * 0.25), (t, w * 0.55), (t * 0.4, w * 0.75), (-t * 0.4, w * 0.75), (-t, w * 0.55), (-t * 0.7, -w * 0.25)]
        else:
            sec = [(0, -w), (t * 0.55, -w * 0.45), (t, 0), (t * 0.55, w * 0.45), (0, w), (-t * 0.55, w * 0.45), (-t, 0), (-t * 0.55, -w * 0.45)]
        sections.append([V((x, y + yy, z)) for x, yy in sec])
    end = V((0, y0 + curve - (half_w * 0.6 if single else 0.0), z0 + length))
    return sweep(bm, sections, cap0=True, tip1=end)


def slab(bm, outline, depth, axis='x', offset=0.0):
    """A flat shape (outline in the plane across `axis`) given thickness: front, back and sides."""
    pts = [V(p) for p in outline]

    def place(p, d):
        a, b = p
        return V((offset + d, a, b)) if axis == 'x' else V((a, offset + d, b)) if axis == 'y' else V((a, b, offset + d))

    front = [bm.verts.new(place(p, depth / 2)) for p in pts]
    back = [bm.verts.new(place(p, -depth / 2)) for p in pts]
    n = len(pts)
    faces = [bm.faces.new(front), bm.faces.new(back[::-1])]
    for k in range(n):
        faces.append(bm.faces.new((front[k], back[k], back[(k + 1) % n], front[(k + 1) % n])))
    return faces


def transform(faces, m):
    verts = {v for f in faces for v in f.verts}
    for v in verts:
        v.co = m @ v.co
    return faces


# ------------------------------------------------------------------------------------------------ the pieces


class Piece:
    def __init__(self, pid, name, kind, tags, primary=None, emit=0.0):
        self.id, self.name, self.kind, self.tags = pid, name, kind, tags
        self.primary = primary
        self.emit = emit
        self.bm = bmesh.new()
        self.mats = []
        # how far the piece is tipped about x in its socket (the thumbnail turns it back)
        self.tilt = 0.0

    def paint(self, faces, mat, smooth=False):
        if mat not in self.mats:
            self.mats.append(mat)
        idx = self.mats.index(mat)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth
        return faces


PIECES = []


def piece(pid, name, kind, tags, primary=None, emit=0.0):
    def wrap(fn):
        PIECES.append((Piece, (pid, name, kind, tags, primary, emit), fn))
        return fn

    return wrap


# hand pieces: grip at the origin, length up +z (the thumb), edge toward -y (the fingertips)


@piece('katana', 'Katana', 'hand', ['katana', 'samurai sword', 'japanese sword', 'samurai', 'ronin'], primary='#1d2440')
def katana(p):
    bm = p.bm
    p.paint(rod(bm, -0.2, 0.05, 0.012, seg=10, ry=1.3), 'primary', smooth=True)
    p.paint(rod(bm, -0.214, -0.2, 0.0135, seg=10, ry=1.3), 'gold', smooth=True)
    p.paint(rod(bm, 0.05, 0.058, 0.036, seg=20, ry=1.15), 'dark_steel')
    p.paint(rod(bm, 0.058, 0.08, 0.007, seg=8, ry=2.2), 'gold')
    p.paint(blade(bm, 0.7, 0.08, 0.015, 0.0034, curve=0.035, single=True, taper=0.22, tip=0.06), 'steel')


@piece('sword', 'Sword', 'hand', ['sword', 'longsword', 'broadsword', 'blade', 'arming sword', 'cutlass', 'knight', 'swordsman'], primary='#6b3a1f')
def sword(p):
    bm = p.bm
    p.paint(rod(bm, -0.075, 0.07, 0.0135, seg=10), 'primary', smooth=True)
    p.paint(ball(bm, V((0, 0, -0.095)), 0.024, seg=12, rings_=6), 'gold', smooth=True)
    p.paint(box(bm, (-0.012, -0.11, 0.07), (0.012, 0.11, 0.092)), 'gold')
    p.paint(blade(bm, 0.74, 0.092, 0.023, 0.0045, taper=0.35, tip=0.1), 'steel')


@piece('dagger', 'Dagger', 'hand', ['dagger', 'knife', 'dirk', 'kunai'], primary='#2a2a30')
def dagger(p):
    bm = p.bm
    p.paint(rod(bm, -0.06, 0.05, 0.012, seg=10), 'primary', smooth=True)
    p.paint(ball(bm, V((0, 0, -0.07)), 0.016, seg=10, rings_=5), 'steel', smooth=True)
    p.paint(box(bm, (-0.01, -0.05, 0.05), (0.01, 0.05, 0.064)), 'steel')
    p.paint(blade(bm, 0.24, 0.064, 0.019, 0.004, taper=0.5, tip=0.25), 'steel')


@piece('axe', 'Battle axe', 'hand', ['axe', 'battle axe', 'battleaxe', 'hatchet', 'viking axe', 'viking', 'barbarian'], primary='#3d2416')
def axe(p):
    bm = p.bm
    p.paint(rod(bm, -0.32, 0.5, 0.016, 0.014, seg=10), 'wood', smooth=True)
    p.paint(rod(bm, -0.12, 0.08, 0.0175, seg=10), 'primary', smooth=True)
    # the head: thick at the haft, flaring to a curved edge toward the fingertips (-y)
    outline = [(0.03, 0.34), (-0.05, 0.36), (-0.12, 0.42), (-0.17, 0.47), (-0.18, 0.4), (-0.18, 0.3), (-0.17, 0.24), (-0.12, 0.28), (-0.05, 0.32), (0.03, 0.31), (0.06, 0.325)]
    head = slab(bm, outline, 0.012, axis='x')
    p.paint(head, 'steel')
    for v in {v for f in head for v in f.verts}:
        # thin toward the edge
        v.co.x *= max(0.15, 1.0 - max(0.0, -v.co.y) / 0.2)
    p.paint(rod(bm, 0.3, 0.37, 0.021, seg=10), 'dark_steel')


@piece('hammer', 'War hammer', 'hand', ['hammer', 'warhammer', 'war hammer', 'maul', 'mjolnir', 'thor', 'paladin'], primary='#5a3a26')
def hammer(p):
    bm = p.bm
    p.paint(rod(bm, -0.28, 0.42, 0.016, seg=10), 'wood', smooth=True)
    p.paint(rod(bm, -0.1, 0.08, 0.018, seg=10), 'primary', smooth=True)
    p.paint(box(bm, (-0.045, -0.1, 0.4), (0.045, 0.09, 0.5)), 'dark_steel')
    p.paint(box(bm, (-0.05, -0.115, 0.395), (0.05, -0.1, 0.505)), 'steel')
    p.paint(box(bm, (-0.05, 0.09, 0.395), (0.05, 0.105, 0.505)), 'steel')


@piece('spear', 'Spear', 'hand', ['spear', 'lance', 'javelin', 'pike', 'halberd'], primary='#a3261f')
def spear(p):
    bm = p.bm
    p.paint(rod(bm, -0.9, 0.98, 0.014, 0.012, seg=10), 'wood', smooth=True)
    p.paint(rod(bm, 0.96, 1.02, 0.017, 0.014, seg=10), 'steel')
    p.paint(blade(bm, 0.26, 1.02, 0.03, 0.006, taper=0.2, tip=0.45, stations=10), 'steel')
    # a tassel under the head
    p.paint(lathe(bm, [(0.004, 0.97), (0.03, 0.9), (0.022, 0.84), (0, 0.83)], seg=12), 'primary', smooth=True)


@piece('staff', 'Staff', 'hand', ['staff', 'magic staff', 'quarterstaff', 'stave', 'wizard', 'sorcerer', 'monk'], primary='#4fc3ff', emit=1.6)
def staff(p):
    bm = p.bm
    path = [V((0.008 * math.sin(i * 1.3), 0.006 * math.cos(i * 0.9), -0.85 + i * 0.095)) for i in range(20)]
    p.paint(tube(bm, path, [0.016 + 0.003 * math.sin(i) for i in range(20)], seg=9), 'wood', smooth=True)
    top = path[-1]
    p.paint(ball(bm, top + V((0, 0, 0.09)), 0.055, seg=16, rings_=8), 'primary', smooth=True)
    for k in range(3):
        a = 2 * math.pi * k / 3
        prong = [top + V((0.01 * math.cos(a), 0.01 * math.sin(a), 0)), top + V((0.05 * math.cos(a), 0.05 * math.sin(a), 0.07)), top + V((0.035 * math.cos(a), 0.035 * math.sin(a), 0.14))]
        p.paint(tube(bm, prong, [0.007, 0.006, 0.003], seg=6, tip=True), 'gold', smooth=True)
    # held upright like a walking staff: tipped from the thumb's line toward the back of the reach
    p.tilt = math.radians(-55)
    transform(list(bm.faces), Matrix.Rotation(p.tilt, 4, 'X'))


@piece('wand', 'Wand', 'hand', ['wand', 'magic wand', 'magician', 'fairy'], primary='#9a5cff', emit=1.4)
def wand(p):
    bm = p.bm
    p.paint(rod(bm, -0.08, 0.26, 0.009, 0.005, seg=8), 'wood', smooth=True)
    p.paint(rod(bm, -0.08, 0.02, 0.0105, 0.0095, seg=8), 'leather', smooth=True)
    p.paint(ball(bm, V((0, 0, 0.27)), 0.012, seg=10, rings_=5), 'primary', smooth=True)


@piece('pistol', 'Pistol', 'hand', ['pistol', 'gun', 'handgun', 'revolver', 'blaster', 'gunslinger', 'cowboy', 'detective'], primary='#2e2a28')
def pistol(p):
    bm = p.bm
    # the barrel runs over the fist along the fingertips (-y); the grip goes down through the fist (-z)
    p.paint(box(bm, (-0.013, -0.17, 0.035), (0.013, 0.05, 0.068)), 'dark_steel')
    p.paint(rod(bm, 0, 0.03, 0.007, seg=8), 'black')
    grip = slab(bm, [(0.035, 0.04), (-0.005, 0.04), (0.005, -0.075), (0.05, -0.07)], 0.026, axis='x')
    p.paint(grip, 'primary')
    p.paint(transform(torus(bm, V((0, 0, 0)), 0.02, 0.003, seg=14, rseg=5), Matrix.Translation(V((0, -0.035, 0.02))) @ Matrix.Rotation(math.pi / 2, 4, 'Y')), 'dark_steel')
    p.paint(transform(rod(bm, -0.012, 0.012, 0.0055, seg=8), Matrix.Translation(V((0, -0.172, 0.0515))) @ Matrix.Rotation(math.pi / 2, 4, 'X')), 'black')


@piece('microphone', 'Microphone', 'hand', ['microphone', 'mic', 'singer', 'rapper', 'karaoke', 'pop star', 'idol', 'mc'], primary='#1c1c20')
def microphone(p):
    bm = p.bm
    p.paint(lathe(bm, [(0, -0.09), (0.013, -0.088), (0.016, 0.0), (0.019, 0.07), (0.021, 0.085)], seg=16), 'primary', smooth=True)
    p.paint(lathe(bm, [(0.0215, 0.082), (0.024, 0.088), (0.024, 0.097), (0.0215, 0.1)], seg=18), 'gold', smooth=True)
    p.paint(ball(bm, V((0, 0, 0.122)), 0.03, seg=16, rings_=8), 'steel', smooth=True)


@piece('scythe', 'Scythe', 'hand', ['scythe', 'reaper', 'grim reaper', 'death', 'reaper scythe'], primary='#3b2f4a')
def scythe(p):
    bm = p.bm
    path = [V((0.006 * math.sin(i * 1.1), 0.004 * math.cos(i * 0.8), -0.8 + i * 0.1)) for i in range(18)]
    p.paint(tube(bm, path, [0.016] * 18, seg=9), 'wood', smooth=True)
    p.paint(rod(bm, -0.11, 0.11, 0.0185, seg=10), 'primary', smooth=True)
    top = path[-1].z
    # the blade: a long crescent from the top of the haft out toward the fingertips (-y), its spine above, its edge under
    spine = [(-0.74 * i / 12, top + 0.04 - 0.19 * (i / 12) ** 2) for i in range(13)]
    edge = [(y, z - 0.11 * (1 - i / 12) ** 1.3 - 0.003) for i, (y, z) in enumerate(spine)]
    blade = slab(bm, spine + edge[::-1], 0.008, axis='x')
    p.paint(blade, 'steel')
    for v in {v for f in blade for v in f.verts}:
        # thin toward the edge
        v.co.x *= 0.35 if v.co.z < top + 0.04 - 0.19 * (v.co.y / -0.74) ** 2 - 0.03 else 1.0
    p.paint(box(bm, (-0.021, -0.03, top - 0.06), (0.021, 0.03, top + 0.05)), 'dark_steel')
    # held upright, like the staff
    p.tilt = math.radians(-55)
    transform(list(bm.faces), Matrix.Rotation(p.tilt, 4, 'X'))


@piece('rifle', 'Rifle', 'hand', ['rifle', 'sniper rifle', 'assault rifle', 'long gun', 'sniper', 'soldier', 'hunter', 'musket'], primary='#4a3526')
def rifle(p):
    bm = p.bm
    # like the pistol: the barrel out over the fist toward the fingertips (-y), the grip down through the fist, and the
    # stock back over the wrist (+y), high enough to clear it
    along = Matrix.Rotation(math.pi / 2, 4, 'X')
    p.paint(box(bm, (-0.017, -0.16, 0.03), (0.017, 0.12, 0.085)), 'dark_steel')
    p.paint(transform(rod(bm, 0.0, 0.5, 0.009, seg=10), Matrix.Translation(V((0, -0.16, 0.064))) @ along), 'black')
    p.paint(slab(bm, [(-0.16, 0.03), (-0.42, 0.036), (-0.42, 0.06), (-0.16, 0.07)], 0.03, axis='x'), 'primary')
    p.paint(slab(bm, [(0.12, 0.085), (0.36, 0.07), (0.37, -0.0), (0.33, -0.005), (0.12, 0.045)], 0.034, axis='x'), 'primary')
    p.paint(slab(bm, [(0.06, 0.035), (0.025, 0.035), (0.035, -0.07), (0.075, -0.065)], 0.026, axis='x'), 'primary')
    p.paint(box(bm, (-0.012, -0.095, -0.075), (0.012, -0.055, 0.03)), 'black')
    p.paint(transform(rod(bm, 0.0, 0.2, 0.016, seg=12), Matrix.Translation(V((0, -0.1, 0.115))) @ along), 'black')
    for y in (-0.14, -0.26):
        p.paint(box(bm, (-0.006, y, 0.085), (0.006, y + 0.02, 0.1)), 'black')
    p.paint(transform(torus(bm, V((0, 0, 0)), 0.02, 0.003, seg=14, rseg=5), Matrix.Translation(V((0, -0.035, 0.02))) @ Matrix.Rotation(math.pi / 2, 4, 'Y')), 'dark_steel')


@piece('spellbook', 'Spellbook', 'hand', ['spellbook', 'grimoire', 'magic book', 'tome', 'book', 'necronomicon', 'scholar'], primary='#5b1f6e')
def spellbook(p):
    bm = p.bm
    # held by its foot: it stands up out of the fist, covers to either side (x), spine toward the palm (+y)
    w, h, d, z0 = 0.15, 0.21, 0.05, -0.04
    for x0, x1 in ((-d / 2, -d / 2 + 0.007), (d / 2 - 0.007, d / 2)):
        p.paint(box(bm, (x0, -w / 2 - 0.006, z0), (x1, w / 2, z0 + h)), 'primary')
    p.paint(box(bm, (-d / 2, w / 2 - 0.004, z0), (d / 2, w / 2 + 0.004, z0 + h)), 'primary')
    p.paint(box(bm, (-d / 2 + 0.007, -w / 2 - 0.002, z0 + 0.004), (d / 2 - 0.007, w / 2 - 0.002, z0 + h - 0.004)), 'ivory')
    for side in (1, -1):
        for zc in (z0 + 0.012, z0 + h - 0.012):
            p.paint(box(bm, (side * d / 2 - 0.002, -w / 2 - 0.007, zc - 0.012), (side * d / 2 + 0.002 * side, -w / 2 + 0.017, zc + 0.012)), 'gold')
        p.paint(ball(bm, V((side * (d / 2 + 0.002), 0, z0 + h / 2)), 0.016, seg=12, rings_=6, scale=(0.4, 1, 1)), 'gold', smooth=True)
    p.paint(box(bm, (-d / 2 - 0.002, -w / 2 - 0.012, z0 + h / 2 - 0.012), (d / 2 + 0.002, -w / 2 - 0.004, z0 + h / 2 + 0.012)), 'gold')


@piece('electric_guitar', 'Electric guitar', 'hand', ['electric guitar', 'guitar', 'bass guitar', 'rock star', 'rocker', 'musician', 'band'], primary='#c4162a')
def electric_guitar(p):
    bm = p.bm
    # carried by the neck: the neck rises out of the fist to the headstock, the body hangs below, its face to the side (+x)
    p.paint(box(bm, (-0.011, -0.022, -0.17), (0.011, 0.022, 0.27)), 'wood')
    p.paint(box(bm, (0.011, -0.021, -0.17), (0.016, 0.021, 0.26)), 'black')
    p.paint(slab(bm, [(-0.024, 0.26), (0.03, 0.27), (0.04, 0.43), (-0.008, 0.44), (-0.03, 0.38)], 0.016, axis='x'), 'black')
    c = -0.37
    outline = []
    for i in range(48):
        t = 2 * math.pi * i / 48
        st, ct = math.sin(t), math.cos(t)
        r = (0.165 if st < 0 else 0.135) * (1 - 0.12 * math.exp(-((st / 0.25) ** 2)))
        # two horns either side of the neck, and the cutaway between them
        horn = 0.055 * math.exp(-(((t - (math.pi / 2 - 0.62)) / 0.2) ** 2)) + 0.045 * math.exp(-(((t - (math.pi / 2 + 0.62)) / 0.2) ** 2)) - 0.035 * math.exp(-(((t - math.pi / 2) / 0.2) ** 2))
        outline.append((r * ct, c + 0.2 * st + horn))
    p.paint(slab(bm, outline, 0.044, axis='x'), 'primary')
    for z in (-0.3, -0.36):
        p.paint(box(bm, (0.021, -0.034, z - 0.01), (0.026, 0.034, z + 0.01)), 'black')
    p.paint(box(bm, (0.021, -0.036, -0.46), (0.028, 0.036, -0.44)), 'steel')
    p.paint(box(bm, (0.0165, -0.017, -0.45), (0.0185, 0.017, 0.255)), 'string')


# off-hand pieces: the left hand only


@piece('shield', 'Round shield', 'offhand', ['shield', 'round shield', 'buckler', 'viking shield', 'knight', 'spartan', 'guardian'], primary='#8f1d22')
def shield(p):
    bm = p.bm
    # faces +x (the back of the left hand), its centre a hand's width out from the palm
    p.paint(transform(lathe(bm, [(0, 0.012), (0.27, 0.01), (0.29, 0.0), (0.29, -0.012), (0, -0.012)], seg=32), Matrix.Translation(V((0.07, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, 'Y')), 'primary')
    p.paint(transform(torus(bm, V((0, 0, 0)), 0.29, 0.012, seg=32, rseg=6), Matrix.Translation(V((0.07, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, 'Y')), 'steel', smooth=True)
    p.paint(transform(ball(bm, V((0, 0, 0)), 0.06, seg=16, rings_=8, scale=(1, 1, 0.6)), Matrix.Translation(V((0.082, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, 'Y')), 'steel', smooth=True)


@piece('bow', 'Bow', 'offhand', ['bow', 'longbow', 'recurve bow', 'archer', 'ranger', 'robin hood'], primary='#5a3a22')
def bow(p):
    bm = p.bm
    # limbs run up and down the fist, bowing away from the string, which sits toward the archer (+y)
    path = []
    for i in range(17):
        s = -1 + 2 * i / 16
        path.append(V((0, -0.02 + 0.16 * s * s - 0.05 * s ** 4, 0.68 * s)))
    p.paint(tube(bm, path, [0.009 + 0.008 * (1 - abs(-1 + 2 * i / 16)) for i in range(17)], seg=8), 'primary', smooth=True)
    p.paint(rod(bm, -0.06, 0.06, 0.016, seg=8, y=-0.02), 'leather', smooth=True)
    p.paint(tube(bm, [path[0], path[-1]], [0.0018, 0.0018], seg=4), 'string')


# back pieces: on the back between the shoulder blades, reaching behind (+y)


@piece('wings', 'Wings', 'back', ['wings', 'angel wings', 'feathered wings', 'angel'], primary='#f4f1ea')
def wings(p):
    bm = p.bm
    for side in (1, -1):
        # the wing's arm rises out from the back, then sweeps down to the tip; feathers hang from it, longest at the tip
        arm = [V((side * (0.05 + 0.8 * t), 0.08 + 0.2 * t, 0.06 + 0.5 * t - 0.62 * t * t)) for t in [i / 10 for i in range(11)]]
        p.paint(tube(bm, arm, [0.032 - 0.018 * i / 10 for i in range(11)], seg=8, tip=True), 'primary', smooth=True)
        for k in range(10):
            t = (k + 0.5) / 10
            i = min(9, int(t * 10))
            root = arm[i].lerp(arm[i + 1], t * 10 - i)
            length = 0.2 + 0.42 * t
            d = V((side * (0.15 + 0.55 * t), 0.08, -1.0)).normalized()
            w = 0.075
            f = slab(bm, [(0, -w * 0.5), (length * 0.8, -w * 0.55), (length, 0), (length * 0.8, w * 0.45), (0, w * 0.5)], 0.01, axis='z')
            # the feather's length along d, its width along the arm, its flat face to the back
            along = (arm[min(10, i + 1)] - arm[i]).normalized()
            n = d.cross(along).normalized()
            if n.y < 0:
                n = -n
            width = n.cross(d).normalized()
            m = Matrix((d, width, n)).transposed().to_4x4()
            m.translation = root + V((0, 0.01 * k, 0))
            p.paint(transform(f, m), 'primary', smooth=False)
    p.paint(box(bm, (-0.07, 0.0, -0.04), (0.07, 0.07, 0.08)), 'gold')


@piece('jetpack', 'Jetpack', 'back', ['jetpack', 'jet pack', 'rocket pack', 'thrusters', 'rocketeer', 'astronaut'], primary='#c23b22')
def jetpack(p):
    bm = p.bm
    p.paint(box(bm, (-0.12, 0.0, -0.18), (0.12, 0.06, 0.14)), 'dark_steel')
    for x in (-0.075, 0.075):
        p.paint(rod(bm, -0.2, 0.18, 0.065, seg=16, x=x, y=0.12), 'primary', smooth=True)
        p.paint(lathe(bm, [(0.065, 0.18), (0.05, 0.23), (0, 0.24)], seg=16, c=V((x, 0.12, 0))), 'primary', smooth=True)
        p.paint(lathe(bm, [(0.04, -0.2), (0.055, -0.27), (0.05, -0.28)], seg=16, c=V((x, 0.12, 0))), 'steel', smooth=True)


@piece('quiver', 'Quiver', 'back', ['quiver', 'arrows', 'arrow quiver', 'archer', 'ranger'], primary='#6b3d22')
def quiver(p):
    bm = p.bm
    tilt = Matrix.Translation(V((0, 0.07, 0))) @ Matrix.Rotation(math.radians(-28), 4, 'Y')
    p.paint(transform(rod(bm, -0.3, 0.22, 0.05, 0.055, seg=14), tilt), 'primary', smooth=True)
    p.paint(transform(rod(bm, 0.18, 0.22, 0.058, seg=14), tilt), 'gold', smooth=True)
    for k in range(5):
        a = 2 * math.pi * k / 5
        x, y = 0.025 * math.cos(a), 0.025 * math.sin(a)
        p.paint(transform(rod(bm, 0.0, 0.42, 0.004, seg=5, x=x, y=y), tilt), 'wood')
        p.paint(transform(slab(bm, [(y - 0.012, 0.36), (y + 0.012, 0.36), (y + 0.012, 0.44), (y - 0.012, 0.43)], 0.002, axis='x', offset=x), tilt), 'feather')


@piece('bat_wings', 'Bat wings', 'back', ['bat wings', 'demon wings', 'devil wings', 'dragon wings', 'vampire wings', 'succubus'], primary='#3a2433')
def bat_wings(p):
    bm = p.bm
    for side in (1, -1):
        # the arm rises up and out to a wrist, fingers fan down from it, and skin stretches between them, scalloped
        shoulder = V((side * 0.06, 0.07, 0.04))
        wrist = V((side * 0.42, 0.16, 0.38))
        p.paint(tube(bm, [shoulder, shoulder.lerp(wrist, 0.5) + V((0, 0.02, 0.06)), wrist], [0.026, 0.018, 0.013], seg=8), 'leather', smooth=True)
        tips = [V((side * 0.78, 0.21, 0.24)), V((side * 0.8, 0.22, -0.08)), V((side * 0.6, 0.2, -0.33)), V((side * 0.33, 0.15, -0.44))]
        for t in tips:
            p.paint(tube(bm, [wrist, wrist.lerp(t, 0.5) + V((0, 0.02, 0.02)), t], [0.011, 0.008, 0.004], seg=6, tip=True), 'leather', smooth=True)
        waist = V((side * 0.07, 0.06, -0.3))
        edges = list(zip(tips, tips[1:])) + [(tips[-1], waist)]
        for a, b in edges:
            pts = []
            for i in range(9):
                u = i / 8
                q = a.lerp(b, u)
                pts.append(q.lerp(wrist, 0.22 * math.sin(math.pi * u)))
            verts = [bm.verts.new(q) for q in pts]
            w = bm.verts.new(wrist)
            p.paint([bm.faces.new((w, verts[i], verts[i + 1])) for i in range(8)], 'primary')
        p.paint([bm.faces.new((bm.verts.new(shoulder), bm.verts.new(wrist), bm.verts.new(waist)))], 'primary')


@piece('twin_swords', 'Twin swords', 'back', ['twin swords', 'dual swords', 'two swords', 'swords on back', 'dual katanas', 'twin katanas', 'ninja swords'], primary='#1d1d24')
def twin_swords(p):
    bm = p.bm
    for side in (1, -1):
        # two sheathed katanas crossed on the back, hilts up over the shoulders, one lying over the other
        sword = p.paint(rod(bm, -0.62, 0.12, 0.016, 0.014, seg=10, ry=1.5), 'primary', smooth=True)
        sword += p.paint(rod(bm, -0.64, -0.62, 0.017, seg=10, ry=1.5), 'gold', smooth=True)
        sword += p.paint(rod(bm, 0.12, 0.132, 0.032, seg=16, ry=1.2), 'dark_steel')
        sword += p.paint(rod(bm, 0.132, 0.36, 0.013, seg=10, ry=1.3), 'leather', smooth=True)
        sword += p.paint(rod(bm, 0.36, 0.372, 0.0145, seg=10, ry=1.3), 'gold', smooth=True)
        transform(sword, Matrix.Translation(V((0, 0.05 if side > 0 else 0.085, 0.02))) @ Matrix.Rotation(side * math.radians(32), 4, 'Y'))


@piece('backpack', 'Backpack', 'back', ['backpack', 'rucksack', 'adventurer pack', 'hiking pack', 'school bag', 'bag'], primary='#46603f')
def backpack(p):
    bm = p.bm

    def soft(lo, hi, r, mat):
        faces = box(bm, lo, hi)
        edges = list({e for f in faces for e in f.edges})
        bmesh.ops.bevel(bm, geom=edges, offset=r, segments=2, affect='EDGES', profile=0.5)
        return p.paint([f for f in bm.faces if f.material_index == 0 and f.calc_center_median().x >= lo[0] - 1e-6 and f.calc_center_median().x <= hi[0] + 1e-6 and lo[1] - 1e-6 <= f.calc_center_median().y <= hi[1] + 1e-6 and lo[2] - 1e-6 <= f.calc_center_median().z <= hi[2] + 1e-6], mat, smooth=True)

    soft((-0.15, 0.0, -0.26), (0.15, 0.15, 0.13), 0.03, 'primary')
    soft((-0.11, 0.15, -0.22), (0.11, 0.2, -0.04), 0.015, 'primary')
    p.paint(box(bm, (-0.155, -0.004, 0.08), (0.155, 0.158, 0.145)), 'leather')
    for x in (-0.07, 0.07):
        p.paint(box(bm, (x - 0.015, 0.154, -0.02), (x + 0.015, 0.162, 0.1)), 'leather')
        p.paint(box(bm, (x - 0.012, 0.16, -0.03), (x + 0.012, 0.166, -0.012)), 'steel')
    p.paint(transform(rod(bm, -0.17, 0.17, 0.045, seg=14), Matrix.Translation(V((0, 0.08, 0.19))) @ Matrix.Rotation(math.pi / 2, 4, 'Y')), 'ivory', smooth=True)


@piece('back_shield', 'Shield on the back', 'back', ['shield on back', 'shield on the back', 'back shield', 'slung shield'], primary='#8f1d22')
def back_shield(p):
    bm = p.bm
    # a round shield slung across the back, its face out (+y), tipped a touch
    out = Matrix.Translation(V((0, 0.05, -0.06))) @ Matrix.Rotation(math.radians(8), 4, 'Y') @ Matrix.Rotation(-math.pi / 2, 4, 'X')
    p.paint(transform(lathe(bm, [(0, 0.012), (0.27, 0.01), (0.29, 0.0), (0.29, -0.012), (0, -0.012)], seg=32), out), 'primary')
    p.paint(transform(torus(bm, V((0, 0, 0)), 0.29, 0.012, seg=32, rseg=6), out), 'steel', smooth=True)
    p.paint(transform(ball(bm, V((0, 0, 0.012)), 0.06, seg=16, rings_=8, scale=(1, 1, 0.6)), out), 'steel', smooth=True)


# head pieces: on the hairline at the front, the head about 0.19 m across and 0.24 m deep there


@piece('crown', 'Crown', 'head', ['crown', 'king', 'queen', 'royal crown', 'tiara', 'monarch'], primary='#d1203a', emit=0.6)
def crown(p):
    bm = p.bm
    sx, sy = 0.1, 0.115
    p.paint(lathe(bm, [(1.0, -0.005), (1.0, 0.04)], seg=32, sx=sx, sy=sy), 'gold')
    p.paint(lathe(bm, [(0.96, 0.04), (0.96, -0.005)], seg=32, sx=sx, sy=sy), 'gold')
    for k in range(8):
        a = 2 * math.pi * k / 8
        c, s = math.cos(a), math.sin(a)
        base = V((sx * c, sy * s, 0.035))
        out = V((c, s, 0)).normalized()
        side = V((-s, c, 0)).normalized()
        tri = [base - side * 0.03, base + side * 0.03, base + out * 0.012 + V((0, 0, 0.055))]
        verts = [bm.verts.new(v) for v in tri]
        p.paint([bm.faces.new(verts)], 'gold')
        p.paint(ball(bm, tri[2] + V((0, 0, 0.006)), 0.008, seg=8, rings_=4), 'primary', smooth=True)
    p.paint(ball(bm, V((0, -sy - 0.003, 0.018)), 0.013, seg=10, rings_=5, scale=(1, 0.6, 1)), 'primary', smooth=True)


@piece('top_hat', 'Top hat', 'head', ['top hat', 'tophat', 'stovepipe', 'gentleman', 'magician hat'], primary='#7a1424')
def top_hat(p):
    bm = p.bm
    sx, sy = 1.0, 1.15
    p.paint(lathe(bm, [(0.155, 0.006), (0.15, 0.0), (0.1, -0.004), (0.104, 0.0), (0.104, 0.2), (0, 0.2)], seg=28, sx=sx, sy=sy), 'black', smooth=True)
    p.paint(lathe(bm, [(0.1065, 0.008), (0.1065, 0.04)], seg=28, sx=sx, sy=sy), 'primary', smooth=True)


@piece('wizard_hat', 'Wizard hat', 'head', ['wizard hat', 'witch hat', 'pointy hat', 'wizard', 'witch', 'mage hat'], primary='#3b2a7a')
def wizard_hat(p):
    bm = p.bm
    p.paint(lathe(bm, [(0.19, 0.0), (0.18, 0.008), (0.104, 0.012), (0.1, 0.0)], seg=28, sy=1.12), 'primary', smooth=True)
    path = [V((0, 0.012 * i * i * 0.08, 0.01 + i * 0.045)) for i in range(9)]
    p.paint(tube(bm, path, [0.104 * (1 - i / 8) ** 1.15 + 0.002 for i in range(9)], seg=24, tip=True, ry=1.12), 'primary', smooth=True)
    p.paint(lathe(bm, [(0.1065, 0.012), (0.1, 0.05)], seg=28, sy=1.12), 'gold', smooth=True)


@piece('horned_helm', 'Horned helm', 'head', ['horned helmet', 'viking helmet', 'horns', 'horned helm', 'viking'], primary='#e3d7bb')
def horned_helm(p):
    bm = p.bm
    prof = [(0.108 * math.cos(math.radians(a)), -0.03 + 0.135 * math.sin(math.radians(a))) for a in range(0, 91, 10)]
    prof[-1] = (0, prof[-1][1])
    p.paint(lathe(bm, prof, seg=28, sy=1.12), 'steel', smooth=True)
    p.paint(lathe(bm, [(0.112, -0.035), (0.112, -0.005)], seg=28, sy=1.12), 'gold', smooth=True)
    for side in (1, -1):
        path = [V((side * (0.09 + 0.05 * t + 0.07 * t * t), 0.0, 0.03 + 0.02 * t + 0.16 * t * t)) for t in [i / 8 for i in range(9)]]
        p.paint(tube(bm, path, [0.028 * (1 - i / 8) + 0.003 for i in range(9)], seg=10, tip=True), 'primary', smooth=True)


@piece('halo', 'Halo', 'head', ['halo', 'angel', 'saint', 'holy'], primary='#ffd56b', emit=2.2)
def halo(p):
    p.paint(transform(torus(p.bm, V((0, 0, 0)), 0.1, 0.008, seg=32, rseg=8), Matrix.Translation(V((0, 0.03, 0.14))) @ Matrix.Rotation(math.radians(-12), 4, 'X')), 'primary', smooth=True)


# face pieces: on the lens plane between the eyes, the eyes 0.033 m to either side


@piece('glasses', 'Round glasses', 'face', ['round glasses', 'glasses', 'spectacles', 'specs', 'nerd', 'scholar'], primary='#1c1c20')
def glasses(p):
    bm = p.bm
    for s in (1, -1):
        p.paint(transform(torus(bm, V((0, 0, 0)), 0.024, 0.0028, seg=20, rseg=5), Matrix.Translation(V((s * 0.033, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, 'X')), 'primary', smooth=True)
        p.paint(transform(lathe(bm, [(0, 0.001), (0.0225, 0.0), (0, -0.001)], seg=20), Matrix.Translation(V((s * 0.033, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, 'X')), 'glass', smooth=True)
        p.paint(tube(bm, [V((s * 0.057, 0, 0.004)), V((s * 0.096, 0.06, 0.004)), V((s * 0.098, 0.125, -0.006))], [0.0022, 0.002, 0.002], seg=5), 'primary', smooth=True)
    p.paint(tube(bm, [V((-0.0095, 0, 0.008)), V((0, -0.002, 0.011)), V((0.0095, 0, 0.008))], [0.002, 0.002, 0.002], seg=5), 'primary', smooth=True)


@piece('shades', 'Shades', 'face', ['sunglasses', 'shades', 'aviators', 'cool glasses'], primary='#111216')
def shades(p):
    bm = p.bm
    for s in (1, -1):
        outline = [(-0.024, 0.012), (0.024, 0.014), (0.026, -0.006), (0.012, -0.02), (-0.016, -0.018), (-0.026, -0.004)]
        lens = slab(bm, [(s * x + s * 0.034, z) for x, z in outline], 0.004, axis='y')
        p.paint(lens, 'black')
        p.paint(tube(bm, [V((s * 0.06, 0, 0.008)), V((s * 0.096, 0.06, 0.006)), V((s * 0.098, 0.125, -0.006))], [0.0025, 0.0022, 0.0022], seg=5), 'primary', smooth=True)
    p.paint(box(bm, (-0.012, -0.002, 0.008), (0.012, 0.002, 0.012)), 'primary')


@piece('eyepatch', 'Eyepatch', 'face', ['eyepatch', 'eye patch', 'pirate'], primary='#0e0e10')
def eyepatch(p):
    bm = p.bm
    patch = lathe(bm, [(0, 0.004), (0.022, 0.002), (0.024, -0.002), (0, -0.003)], seg=16, sx=1.0, sy=1.0)
    p.paint(transform(patch, Matrix.Translation(V((-0.033, 0.012, -0.002))) @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Scale(1.0, 4)), 'primary', smooth=True)
    path = [V((0.1 * math.sin(a), 0.105 - 0.105 * math.cos(a), 0.04 * math.cos(a) - 0.0)) for a in [math.radians(-180 + 15 * i) for i in range(25)]]
    p.paint(tube(bm, path, [0.0025] * len(path), seg=5, cap=False, ry=2.0), 'primary', smooth=True)


@piece('visor', 'Visor', 'face', ['visor', 'cyber visor', 'cyborg', 'goggles', 'hud', 'cyberpunk'], primary='#38e1ff', emit=1.8)
def visor(p):
    bm = p.bm
    sections = []
    for i in range(15):
        a = math.radians(-70 + 10 * i)
        c = V((0.1 * math.sin(a), 0.1 - 0.1 * math.cos(a) + 0.004, 0.0))
        out = V((math.sin(a), -math.cos(a), 0))
        sections.append([c + V((0, 0, 0.016)), c + out * 0.004 + V((0, 0, 0.012)), c + out * 0.004 + V((0, 0, -0.014)), c + V((0, 0, -0.018))])
    p.paint(sweep(bm, sections), 'primary', smooth=True)


@piece('square_glasses', 'Square glasses', 'face', ['square glasses', 'rectangular glasses', 'reading glasses', 'hipster glasses', 'office glasses'], primary='#1c1c20')
def square_glasses(p):
    bm = p.bm
    w, h, t = 0.027, 0.018, 0.0032
    for s in (1, -1):
        cx = s * 0.034
        for lo, hi in (((cx - w, -t, h - t), (cx + w, t, h + t)), ((cx - w, -t, -h - t), (cx + w, t, -h + t)), ((cx - w - t, -t, -h), (cx - w + t, t, h)), ((cx + w - t, -t, -h), (cx + w + t, t, h))):
            p.paint(box(bm, lo, hi), 'primary')
        p.paint(slab(bm, [(cx - w + t, -h + t), (cx + w - t, -h + t), (cx + w - t, h - t), (cx - w + t, h - t)], 0.0015, axis='y'), 'glass')
        p.paint(tube(bm, [V((s * (0.034 + w), 0, 0.008)), V((s * 0.096, 0.06, 0.006)), V((s * 0.098, 0.125, -0.006))], [0.0024, 0.0022, 0.0022], seg=5), 'primary', smooth=True)
    p.paint(box(bm, (-0.034 + w, -0.002, 0.006), (0.034 - w, 0.002, 0.011)), 'primary')


@piece('scouter', 'Scouter', 'face', ['scouter', 'power scanner', 'saiyan scouter', 'power level', 'dragon ball scouter'], primary='#3df27a', emit=1.3)
def scouter(p):
    bm = p.bm
    # a pod over the left ear and an arm out to a glowing lens before the left eye (+x)
    ear = V((0.096, 0.095, -0.012))
    p.paint(transform(lathe(bm, [(0, -0.012), (0.022, -0.01), (0.025, 0.0), (0.022, 0.01), (0, 0.012)], seg=16), Matrix.Translation(ear) @ Matrix.Rotation(math.pi / 2, 4, 'Y')), 'ivory', smooth=True)
    p.paint(tube(bm, [ear + V((0.004, -0.012, 0.012)), V((0.09, 0.02, 0.02)), V((0.066, -0.014, 0.02))], [0.0045, 0.0042, 0.004], seg=6), 'ivory', smooth=True)
    p.paint(box(bm, (0.014, -0.017, 0.016), (0.066, -0.011, 0.024)), 'ivory')
    p.paint(slab(bm, [(0.016, -0.012), (0.062, -0.012), (0.062, 0.016), (0.024, 0.016)], 0.003, axis='y', offset=-0.014), 'primary')


# ------------------------------------------------------------------------------------------------ build, export, thumbnails


def build(entry):
    cls, args, fn = entry
    p = cls(*args)
    fn(p)
    bm = p.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(p.id)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(p.id, me)
    bpy.context.scene.collection.objects.link(obj)
    for name in p.mats:
        spec = dict(color=p.primary or '#888888', roughness=0.5, emit=p.emit) if name == 'primary' else PALETTE[name]
        me.materials.append(make_material(name, spec))
    me.validate()
    tris = sum(len(poly.vertices) - 2 for poly in me.polygons)
    return p, obj, tris


def export(obj, path):
    for o in bpy.context.scene.objects:
        o.select_set(o == obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_extras=False,
        export_materials='EXPORT',
        export_meshopt_compression_enable=True,
        export_texcoords=False,
        export_normals=True,
    )


def setup_render(size):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
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
    scene.render.image_settings.quality = 88
    world = bpy.data.worlds.new('studio')
    scene.world = world
    nt = world.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(bpy.utils.resource_path('LOCAL'), 'datafiles', 'studiolights', 'world', 'studio.exr'))
    bg = nt.nodes.get('Background')
    bg.inputs['Strength'].default_value = 1.1
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    key.data.energy = 3.0
    key.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(key)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


VIEW = {'hand': V((1.0, -0.3, 0.2)), 'offhand': V((1.0, -0.55, 0.3)), 'back': V((0.55, 1.0, 0.35)), 'head': V((0.6, -1.0, 0.45)), 'face': V((0.45, -1.0, 0.25))}


def thumbnail(p, obj, cam, path):
    if p.kind == 'hand':
        # seen from the flat of the blade, on the diagonal
        obj.rotation_euler = (math.radians(-40) - p.tilt, 0, 0)
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ V(c) for c in obj.bound_box]
    centre = sum(corners, V()) / 8
    d = VIEW[p.kind].normalized()
    rot = (-d).to_track_quat('-Z', 'Y')
    right = rot @ V((1, 0, 0))
    up = rot @ V((0, 1, 0))
    w = max(c.dot(right) for c in corners) - min(c.dot(right) for c in corners)
    h = max(c.dot(up) for c in corners) - min(c.dot(up) for c in corners)
    cam.data.ortho_scale = max(w, h) * 1.12
    cam.location = centre + d * 4
    cam.rotation_euler = rot.to_euler()
    cam.data.clip_end = 20
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    obj.rotation_euler = (0, 0, 0)


def cleanup(obj):
    me = obj.data
    mats = list(me.materials)
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(me)
    for m in mats:
        bpy.data.materials.remove(m)


def write_manifest(rows):
    lines = [
        '// Generated by tools/blender/pieces.py: the built-in pieces every player can use for free. Edit that script, not this file.',
        "import type { BuiltInPiece } from './pieces.js'",
        '',
        'export const BUILT_IN_PIECES: readonly BuiltInPiece[] = [',
    ]
    for p, tris in rows:
        tags = ', '.join(f"'{t}'" for t in p.tags)
        tint = f"'{p.primary}'" if p.primary else 'null'
        lines.append(f"  {{ id: '{p.id}', name: '{p.name}', kind: '{p.kind}', tags: [{tags}], tint: {tint}, tris: {tris} }},")
    lines.append(']')
    with open(MANIFEST, 'w') as f:
        f.write('\n'.join(lines) + '\n')


def contact_sheet(ids, path, cols=6):
    """Every thumbnail on one sheet (for checking the pieces by eye)."""
    import numpy as np

    tiles = []
    for pid in ids:
        img = bpy.data.images.load(os.path.join(OUT, f'{pid}.webp'))
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        tiles.append(px.reshape(h, w, 4))
        bpy.data.images.remove(img)
    h, w = tiles[0].shape[:2]
    rows = (len(tiles) + cols - 1) // cols
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    sheet[..., :3] = 0.16
    sheet[..., 3] = 1.0
    for i, t in enumerate(tiles):
        r, c = rows - 1 - i // cols, i % cols
        a = t[..., 3:4]
        cell = sheet[r * h : (r + 1) * h, c * w : (c + 1) * w]
        cell[..., :3] = t[..., :3] * a + cell[..., :3] * (1 - a)
    out = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = path
    out.file_format = 'PNG'
    out.save()


def main(opts):
    os.makedirs(OUT, exist_ok=True)
    only = set(opts['only'].split(',')) if opts.get('only') else None
    thumbs = not opts.get('no-thumbs')
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    cam = setup_render(int(opts.get('size', 320))) if thumbs else None
    rows = []
    for entry in PIECES:
        p, obj, tris = build(entry)
        rows.append((p, tris))
        if only is None or p.id in only:
            export(obj, os.path.join(OUT, f'{p.id}.glb'))
            if thumbs:
                thumbnail(p, obj, cam, os.path.join(OUT, f'{p.id}.webp'))
            log(p.id, p.kind, tris, 'tris', os.path.getsize(os.path.join(OUT, f'{p.id}.glb')), 'bytes')
        cleanup(obj)
    write_manifest(rows)
    log('manifest', MANIFEST, len(rows), 'pieces')
    if opts.get('sheet'):
        contact_sheet([p.id for p, _ in rows], opts['sheet'])
        log('sheet', opts['sheet'])


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
