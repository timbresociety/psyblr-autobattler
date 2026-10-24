"""
The face, the way sports and wrestling games build a real person's head: landmarks on a generated front-on portrait
(MediaPipe, tools/textures/landmarks.py) fit MPFB's face targets so the head takes the person's proportions, then the
portrait is warped onto the fitted head with a thin-plate spline and projected front-on, feathered into the skin.

The landmarks are tied to the MakeHuman base mesh once (face_bind.json, made by `human.py --bind-*`): each MediaPipe
point is a fixed spot on the hm08 surface (a triangle and barycentric weights), so on any shaped body we know where
every landmark sits in 3D.
"""

import json
import os

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from bl_ext.user_default.mpfb.services.targetservice import TargetService

HERE = os.path.dirname(os.path.abspath(__file__))
BIND_FILE = os.path.join(HERE, 'face_bind.json')

FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
EYES = [33, 133, 159, 145, 160, 158, 153, 144, 362, 263, 386, 374, 385, 387, 380, 373]
NOSE = [1, 2, 4, 5, 6, 168, 98, 327, 48, 278, 129, 358]
LIPS = [61, 291, 0, 17, 13, 14, 37, 267, 84, 314, 40, 270, 91, 321]
BROWS = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300]
CHIN = [152, 199, 175]
# the oval's top runs along the hairline, which hair and portraits draw freely; fit the face below it
FIT = sorted(set(FACE_OVAL[5:-5]) | set(EYES) | set(NOSE) | set(LIPS) | set(CHIN))
WARP = sorted(set(FIT) | set(BROWS) | set(FACE_OVAL))

# face targets the fit may use: each variable is a list of targets set together (left and right as one)
LR = lambda name: [f'l-{name}', f'r-{name}']
CANDIDATES = [
    ['head-scale-horiz-incr'], ['head-scale-horiz-decr'],
    ['head-scale-vert-incr'], ['head-scale-vert-decr'],
    ['head-fat-incr'], ['head-fat-decr'],
    ['head-oval'], ['head-round'], ['head-square'], ['head-rectangular'], ['head-triangular'], ['head-invertedtriangular'], ['head-diamond'],
    ['chin-width-incr'], ['chin-width-decr'], ['chin-height-incr'], ['chin-height-decr'], ['chin-bones-incr'], ['chin-bones-decr'],
    LR('eye-trans-out'), LR('eye-trans-in'), LR('eye-trans-up'), LR('eye-trans-down'),
    LR('eye-scale-incr'), LR('eye-scale-decr'), LR('eye-height2-incr'), LR('eye-height2-decr'),
    LR('eye-corner1-up'), LR('eye-corner1-down'), LR('eye-corner2-up'), LR('eye-corner2-down'),
    ['nose-scale-horiz-incr'], ['nose-scale-horiz-decr'], ['nose-scale-vert-incr'], ['nose-scale-vert-decr'],
    ['nose-trans-up'], ['nose-trans-down'], ['nose-flaring-incr'], ['nose-flaring-decr'],
    ['mouth-scale-horiz-incr'], ['mouth-scale-horiz-decr'], ['mouth-scale-vert-incr'], ['mouth-scale-vert-decr'],
    ['mouth-trans-up'], ['mouth-trans-down'],
    ['mouth-upperlip-height-incr'], ['mouth-upperlip-height-decr'], ['mouth-lowerlip-height-incr'], ['mouth-lowerlip-height-decr'],
    LR('cheek-bones-incr'), LR('cheek-bones-decr'), LR('cheek-volume-incr'), LR('cheek-volume-decr'),
    ['forehead-scale-vert-incr'], ['forehead-scale-vert-decr'],
]


def full_coords(human):
    """hm08-ordered vertex positions of an MPFB human with its shape keys mixed (helpers included)."""
    n = len(human.data.vertices)
    keys = human.data.shape_keys.key_blocks if human.data.shape_keys else []

    def co(kb):
        a = np.empty(n * 3, dtype=np.float64)
        kb.data.foreach_get('co', a)
        return a.reshape(n, 3)

    if not keys:
        a = np.empty(n * 3, dtype=np.float64)
        human.data.vertices.foreach_get('co', a)
        return a.reshape(n, 3)
    basis = co(keys[0])
    out = basis.copy()
    for kb in keys[1:]:
        if kb.value and not kb.mute:
            out += kb.value * (co(kb) - co(kb.relative_key))
    return out


def group_members(human, names, threshold=0.5):
    idx = {human.vertex_groups[n].index for n in names if n in human.vertex_groups}
    return {v.index for v in human.data.vertices if any(g.group in idx and g.weight > threshold for g in v.groups)}


def eye_centre(human, coords):
    out = []
    for g in ('helper-l-eye', 'helper-r-eye'):
        ids = sorted(group_members(human, [g]))
        out.append(coords[ids].mean(axis=0))
    return out


def surface_polys(human):
    """The skin and the eyeballs (no other helper geometry) as polygons over hm08 vertex indices."""
    keep = group_members(human, ['body', 'helper-l-eye', 'helper-r-eye'])
    return [list(p.vertices) for p in human.data.polygons if all(v in keep for v in p.vertices)]


# ------------------------------------------------------------------------------------------------ binding (once)


def bind_frame(human):
    coords = full_coords(human)
    l, r = eye_centre(human, coords)
    c = (l + r) / 2
    return {'cx': float(c[0]), 'cz': float(c[2] - 0.03), 'size': 0.32}


def barycentric(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-18:
        return None
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return 1 - v - w, v, w


def bind_landmarks(human, frame, lm):
    """Tie each MediaPipe landmark seen on the neutral render to the hm08 surface: [[vertex, weight] x3] or None."""
    coords = full_coords(human)
    polys = surface_polys(human)
    bvh = BVHTree.FromPolygons([Vector(c) for c in coords], polys)
    W, H = lm['width'], lm['height']
    out = []
    for u, v, _ in lm['points']:
        x = frame['cx'] + (u / W - 0.5) * frame['size']
        z = frame['cz'] - (v / H - 0.5) * frame['size']
        hit = bvh.ray_cast(Vector((x, -3.0, z)), Vector((0, 1, 0)))
        if hit[0] is None:
            out.append(None)
            continue
        p = np.array(hit[0])
        poly = polys[hit[2]]
        best = None
        for k in range(1, len(poly) - 1):
            tri = (poly[0], poly[k], poly[k + 1])
            bc = barycentric(p, coords[tri[0]], coords[tri[1]], coords[tri[2]])
            if bc is None:
                continue
            score = min(bc)
            if best is None or score > best[0]:
                best = (score, tri, bc)
        out.append([[int(best[1][i]), float(best[2][i])] for i in range(3)])
    return out


def load_bind():
    with open(BIND_FILE) as f:
        return json.load(f)


def landmark_positions(coords, bind):
    pts = np.zeros((len(bind), 3))
    ok = np.zeros(len(bind), dtype=bool)
    for i, b in enumerate(bind):
        if b:
            pts[i] = sum(w * coords[v] for v, w in b)
            ok[i] = True
    return pts, ok


# ------------------------------------------------------------------------------------------------ fitting


def umeyama(src, dst):
    """Scale, rotation and translation taking 2D points `src` onto `dst` (least squares)."""
    ms, md = src.mean(0), dst.mean(0)
    s0, d0 = src - ms, dst - md
    cov = d0.T @ s0 / len(src)
    U, S, Vt = np.linalg.svd(cov)
    D = np.eye(2)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        D[1, 1] = -1
    R = U @ D @ Vt
    var = (s0 ** 2).sum() / len(src)
    s = np.trace(np.diag(S) @ D) / var
    t = md - s * R @ ms
    return s, R, t


def front(p3):
    """Front orthographic view: x right, image y down (so -z)."""
    return np.stack([p3[:, 0], -p3[:, 2]], axis=1)


def solve_box(J, r, lam, iters=600):
    """min |J w - r|^2 + lam |w|^2 with 0 <= w <= 1 (accelerated projected gradient)."""
    n = J.shape[1]
    A = J.T @ J + lam * np.eye(n)
    b = J.T @ r
    L = np.linalg.eigvalsh(A).max()
    w = np.zeros(n)
    y = w.copy()
    t = 1.0
    for _ in range(iters):
        g = A @ y - b
        w_new = np.clip(y - g / L, 0, 1)
        t_new = (1 + (1 + 4 * t * t) ** 0.5) / 2
        y = w_new + (t - 1) / t_new * (w_new - w)
        w, t = w_new, t_new
    return w


def fit_face(human, portrait, lam=4e-4, rounds=4, log=print, full=False):
    """
    Load the candidate face targets and set them so the head's landmarks match the portrait's (front view).
    Returns the fitted weights by target name: those above 0.02, or with `full` every group's.
    """
    bind = load_bind()
    fit_ids = [i for i in FIT if bind[i]]
    pts = np.array(portrait['points'])[:, :2]
    keys = []
    for group in CANDIDATES:
        ks = []
        for name in group:
            path = TargetService.target_full_path(name)
            if path:
                ks.append(TargetService.load_target(human, path, weight=0.0))
        keys.append(ks)
    n = len(human.data.vertices)
    base = full_coords(human)
    L0, _ = landmark_positions(base, bind)
    m0 = front(L0[fit_ids])

    def delta(kb):
        a = np.empty(n * 3)
        kb.data.foreach_get('co', a)
        b = np.empty(n * 3)
        kb.relative_key.data.foreach_get('co', b)
        return (a - b).reshape(n, 3)

    cols = []
    for ks in keys:
        d = sum((delta(kb) for kb in ks), np.zeros((n, 3))) if ks else np.zeros((n, 3))
        Ld, _ = landmark_positions(d, bind)
        cols.append(front(Ld[fit_ids]).reshape(-1))
    J = np.stack(cols, axis=1)
    p = pts[fit_ids]
    w = np.zeros(len(keys))
    for _ in range(rounds):
        m = m0 + (J @ w).reshape(-1, 2)
        s, R, t = umeyama(p, m)
        target = (s * (R @ p.T)).T + t
        w = solve_box(J, (target - m0).reshape(-1), lam)
    m = m0 + (J @ w).reshape(-1, 2)
    s, R, t = umeyama(p, m)
    err0 = np.abs((s * (R @ p.T)).T + t - m0).mean()
    err = np.abs((s * (R @ p.T)).T + t - m).mean()
    fitted = {}
    for ks, group, wk in zip(keys, CANDIDATES, w):
        for kb in ks:
            kb.value = float(wk)
        if full:
            fitted['+'.join(group)] = round(float(wk), 5)
        elif wk > 0.02:
            fitted['+'.join(group)] = round(float(wk), 3)
    log(f'face fit: mean landmark error {err0 * 1000:.2f} mm -> {err * 1000:.2f} mm', fitted)
    return fitted


def fitted_targets(fitted):
    """fit_face's weights by group, as weights by target name (a group's targets share its weight)."""
    return {name: w for group, w in fitted.items() for name in group.split('+')}


def group_names():
    """The candidate groups in order, named as fit_face names them: the face basis's columns (build.face_basis)."""
    return ['+'.join(g) for g in CANDIDATES]


# ------------------------------------------------------------------------------------------------ the face texture


def tps_fit(src, dst, reg=1e-3):
    """Thin-plate spline mapping src points (n,2) to dst points (n,2); returns an evaluator."""
    n = len(src)

    def U(r):
        with np.errstate(divide='ignore', invalid='ignore'):
            out = r * r * np.log(r + 1e-12)
        return out

    K = U(np.linalg.norm(src[:, None] - src[None], axis=2)) + reg * np.eye(n)
    P = np.hstack([np.ones((n, 1)), src])
    A = np.zeros((n + 3, n + 3))
    A[:n, :n] = K
    A[:n, n:] = P
    A[n:, :n] = P.T
    B = np.zeros((n + 3, 2))
    B[:n] = dst
    coef = np.linalg.solve(A, B)

    def f(q):
        Kq = U(np.linalg.norm(q[:, None] - src[None], axis=2))
        return Kq @ coef[:n] + np.hstack([np.ones((len(q), 1)), q]) @ coef[n:]

    return f


def bilinear(img, xy):
    h, w = img.shape[:2]
    x = np.clip(xy[:, 0], 0, w - 1.001)
    y = np.clip(xy[:, 1], 0, h - 1.001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    a = img[y0, x0]
    b = img[y0, x0 + 1]
    c = img[y0 + 1, x0]
    d = img[y0 + 1, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


class HeadFrame:
    """The square front-on window the face texture lives in: centre (x, z) and width in metres."""

    def __init__(self, cx, cz, size, res=1024):
        self.cx, self.cz, self.size, self.res = cx, cz, size, res

    def to_px(self, p3):
        u = ((p3[:, 0] - self.cx) / self.size + 0.5) * self.res
        v = (0.5 - (p3[:, 2] - self.cz) / self.size) * self.res
        return np.stack([u, v], axis=1)

    def uv(self, co):
        """Blender UV (v up) of a 3D point."""
        return ((co.x - self.cx) / self.size + 0.5, (co.z - self.cz) / self.size + 0.5)


def polygon_mask(points, res, feather):
    from_pts = [tuple(map(float, p)) for p in points]
    # rasterise with a simple even-odd scanline fill (no PIL in Blender's Python)
    mask = np.zeros((res, res), dtype=np.float32)
    ys = np.arange(res) + 0.5
    pts = np.array(from_pts)
    x0, y0 = pts[:, 0], pts[:, 1]
    x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
    for j, y in enumerate(ys):
        cross = ((y0 <= y) & (y1 > y)) | ((y1 <= y) & (y0 > y))
        if not cross.any():
            continue
        xs = np.sort(x0[cross] + (y - y0[cross]) * (x1[cross] - x0[cross]) / (y1[cross] - y0[cross]))
        for a, b in zip(xs[0::2], xs[1::2]):
            mask[j, max(0, int(a)) : min(res, int(b) + 1)] = 1
    return blur(mask, feather)


def blur(a, radius):
    """Separable box blur, three passes (close to a gaussian)."""
    r = max(1, int(radius))
    out = a.astype(np.float32)
    for _ in range(3):
        for axis in (0, 1):
            c = np.cumsum(np.pad(out, [(r + 1, r) if k == axis else (0, 0) for k in range(out.ndim)], mode='edge'), axis=axis)
            hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
            lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
            out = (hi - lo) / (2 * r + 1)
    return out


def load_rgb(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    # Blender pixels run bottom-up; flip to top-down rows like the landmark pixels
    return a.reshape(h, w, 4)[::-1, :, :3].copy()


def save_rgba(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True, float_buffer=False)
    img.pixels.foreach_set(arr[::-1].reshape(-1).astype(np.float32))
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def skin_sample(img, pts):
    """The portrait's skin colour: the median over cheek and forehead patches."""
    face_w = np.linalg.norm(pts[234] - pts[454])
    r = face_w * 0.035
    samples = []
    for i in (50, 280, 151, 205, 425):
        cx, cy = pts[i]
        ys, xs = np.mgrid[int(cy - r) : int(cy + r), int(cx - r) : int(cx + r)]
        ys = np.clip(ys, 0, img.shape[0] - 1)
        xs = np.clip(xs, 0, img.shape[1] - 1)
        samples.append(img[ys, xs].reshape(-1, 3))
    return np.median(np.concatenate(samples), axis=0)


def face_texture(portrait_path, portrait, mesh_lm, frame, out_path, delight=0.6, neutral=False, hair_out=None):
    """
    Warp the portrait into the head frame so its landmarks land on the mesh's, with a feathered face mask in alpha.
    Returns the portrait's skin colour (sRGB) for the rest of the body. With `hair_out`, also writes the portrait's hair
    (and beard) seen front-on, masked to where it is neither skin nor background, and returns its colours too.
    """
    img = load_rgb(portrait_path)
    bind_ok = [i for i in WARP if mesh_lm[1][i]]
    p_src = frame.to_px(mesh_lm[0][bind_ok])
    p_dst = np.array(portrait['points'])[bind_ok, :2]
    # the warp runs from head-frame pixels to portrait pixels; anchors far outside keep it affine at the edges
    s, R, t = umeyama(p_src, p_dst)
    res = frame.res
    ring = np.array([[x, y] for x in (-0.5 * res, 0.5 * res, 1.5 * res) for y in (-0.5 * res, 0.5 * res, 1.5 * res) if (x, y) != (0.5 * res, 0.5 * res)])
    src = np.vstack([p_src, ring])
    dst = np.vstack([p_dst, (s * (R @ ring.T)).T + t])
    f = tps_fit(src / res, dst / res, reg=2e-4)
    # evaluate on a coarse grid, then upsample the mapping
    g = 128
    gy, gx = np.mgrid[0:g, 0:g]
    q = np.stack([(gx.reshape(-1) + 0.5) / g, (gy.reshape(-1) + 0.5) / g], axis=1)
    m = f(q).reshape(g, g, 2) * res
    fy, fx = np.mgrid[0:res, 0:res]
    gxf = np.clip((fx + 0.5) / res * g - 0.5, 0, g - 1.001)
    gyf = np.clip((fy + 0.5) / res * g - 0.5, 0, g - 1.001)
    mapped = bilinear(m, np.stack([gxf.reshape(-1), gyf.reshape(-1)], axis=1))
    rgb = bilinear(img, mapped).reshape(res, res, 3)
    # mask: the face oval drawn through the mesh's own landmarks, feathered
    oval = frame.to_px(mesh_lm[0][[i for i in FACE_OVAL if mesh_lm[1][i]]])
    mask = polygon_mask(oval, res, res * 0.012)
    # pull the oval in a little at its rim so the portrait's background never shows
    mask = np.clip((mask - 0.25) / 0.75, 0, 1)
    skin = skin_sample(img, np.array(portrait['points'])[:, :2])
    if delight:
        # even out the portrait's broad lighting: divide by its blurred luminance, keep features and colour
        lum = rgb @ np.array([0.3, 0.59, 0.11])
        base = blur(np.where(mask > 0.5, lum, float(skin @ np.array([0.3, 0.59, 0.11]))), res * 0.06)
        target = float(skin @ np.array([0.3, 0.59, 0.11]))
        gain = np.clip(target / np.maximum(base, 1e-3), 0.6, 1.6)
        rgb = rgb * (1 + delight * (gain - 1))[..., None]
    hair = None
    if hair_out:
        hair = hair_texture(img, rgb, mask, skin, mesh_lm, frame, hair_out)
    if neutral:
        # a generic face: its detail relative to its skin, so the game can tint any skin tone through it
        rgb = rgb / np.maximum(skin, 1e-3)
    out = np.concatenate([np.clip(rgb, 0, 1), mask[..., None]], axis=2)
    save_rgba(out, out_path)
    return (skin, hair) if hair_out else skin


def hair_texture(img, rgb, oval, skin, mesh_lm, frame, out_path):
    """
    The portrait's hair and beard in the head frame: pixels that are neither the background (sampled round the
    portrait's border) nor skin, kept to the head, minus the eyes, brows and mouth inside the face. Returns the hair's
    base and highlight colours (sRGB), or None when the portrait shows no hair (a bald head).
    """
    res = frame.res
    border = np.concatenate([img[:8].reshape(-1, 3), img[:, :8].reshape(-1, 3), img[:, -8:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    d_bg = np.linalg.norm(rgb - bg, axis=2)
    d_skin = np.linalg.norm(rgb - skin, axis=2)
    lum = rgb @ np.array([0.3, 0.59, 0.11])
    skin_lum = float(skin @ np.array([0.3, 0.59, 0.11]))
    # hair is far from the background and from skin (allowing for shaded skin, which keeps the skin's hue)
    chroma_skin = np.linalg.norm(rgb / np.maximum(lum, 1e-3)[..., None] - skin / max(skin_lum, 1e-3), axis=2)
    hairish = (d_bg > 0.1) & ((d_skin > 0.2) & ((chroma_skin > 0.18) | (lum < skin_lum * 0.55) | (lum > skin_lum * 1.25)))
    P = frame.to_px(mesh_lm[0])
    ok = mesh_lm[1]
    pt = lambda i: P[i] if ok[i] else None
    brow_v = min(P[i][1] for i in (105, 334, 66, 296) if ok[i])
    mouth_v = max(P[i][1] for i in (13, 14, 17) if ok[i])
    chin_v = P[152][1] if ok[152] else res * 0.75
    eye_l, eye_r = pt(263), pt(33)
    half_w = abs(P[454][0] - P[234][0]) / 2 if ok[454] and ok[234] else res * 0.25
    cx = (P[454][0] + P[234][0]) / 2 if ok[454] and ok[234] else res / 2
    ys, xs = np.mgrid[0:res, 0:res]
    inside = oval > 0.5
    # inside the face only the fringe (above the brows) and the beard (below the mouth) count as hair
    face_ok = (ys < brow_v - res * 0.008) | (ys > mouth_v + res * 0.01)
    # the head's extent: no clothes below the jaw, nothing far to the sides
    head_ok = (ys < chin_v + res * 0.05) & (np.abs(xs - cx) < half_w * 1.45)
    keep = hairish & head_ok & (~inside | face_ok)
    alpha = blur(keep.astype(np.float32), res * 0.004)
    alpha = np.clip((alpha - 0.3) / 0.5, 0, 1)
    if keep.sum() < res * res * 0.002:
        return None
    pix = rgb[keep]
    plum = pix @ np.array([0.3, 0.59, 0.11])
    base = np.median(pix[plum <= np.percentile(plum, 60)], axis=0)
    light = np.median(pix[plum >= np.percentile(plum, 80)], axis=0)
    save_rgba(np.concatenate([np.clip(rgb, 0, 1), alpha[..., None]], axis=2), out_path)
    return tuple(float(x) for x in base), tuple(float(x) for x in light)


def face_meta(frame, mesh_lm, atlas_size):
    """
    What the game needs to put a player's photo on this body's face: the head frame (front-on, Blender x and z in
    metres, which are glTF x and y) and where the body's own face landmarks sit in it, in pixels of a frame.res-square
    patch with y down. The game warps a photo onto those landmarks, then paints each front-facing skin triangle of the
    atlas from the patch, so it needs no knowledge of how the atlas was packed.
    """
    px = frame.to_px(mesh_lm[0])
    landmarks = [[round(float(x), 2), round(float(y), 2)] if ok else None for (x, y), ok in zip(px, mesh_lm[1])]
    return {
        'version': 1,
        'atlas': atlas_size,
        'frame': {'cx': frame.cx, 'cz': frame.cz, 'size': frame.size, 'res': frame.res},
        'landmarks': landmarks,
    }
