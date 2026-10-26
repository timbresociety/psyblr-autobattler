"""
Renders for the kit sheet (docs/forge/kit-sheet.html): each gender's six bodies side by side at their in-game scale,
and head shots of every hair style and beard. The generic bodies are tinted per region in the game
(src/arena/client/character-look.ts); these renders tint them the same way, with one sample palette.

    Blender -b --python tools/blender/kit_sheet.py -- [--out docs/forge/kit]
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

from humanlib.bake import PARTS, REGIONS  # noqa: E402

HEROES = os.path.join(ROOT, 'public', 'heroes')
SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'colossal']
# src/charter/sizes.ts
SIZE_SCALE = {'tiny': 0.8, 'small': 0.9, 'medium': 1.0, 'large': 1.15, 'huge': 1.3, 'colossal': 1.6}
HAIR = ['none', 'buzz', 'crop', 'short', 'curly', 'swept', 'spiky', 'bob', 'long', 'volume', 'helmet']
BEARDS = ['goatee', 'full', 'chin_curtain']
PALETTE = {
    'skin': '#d7a17c', 'suit': '#3b6fd1', 'trim': '#9cc3ff', 'pants': '#202634', 'glove': '#ece9e2', 'boot': '#1b1e26',
    'hair': '#5a3a24', 'metal': '#c9a24c', 'eye': '#f4f4f4', 'iris': '#3d6e5e', 'brow': '#2e1d12', 'cape': '#4a2f5e',
}


def log(*a):
    print('[sheet]', *a, flush=True)


def linear(hexstr):
    c = [int(hexstr[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


IMPORTED = []


def clear():
    """Drop everything the imports brought in; the camera and lights stay."""
    for o in IMPORTED:
        bpy.data.objects.remove(o, do_unlink=True)
    IMPORTED.clear()
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.actions):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def setup():
    scene = bpy.context.scene
    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.quality = 86
    world = bpy.data.worlds.new('sheet')
    scene.world = world
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.32, 0.31, 0.34, 1)
    bg.inputs['Strength'].default_value = 0.9
    for name, energy, rot in (('key', 3.2, (50, 0, -30)), ('fill', 1.0, (65, 0, 45)), ('rim', 2.2, (110, 0, 180))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.rotation_euler = tuple(math.radians(a) for a in rot)
        scene.collection.objects.link(light)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def load(body):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HEROES, f'{body}.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    IMPORTED.extend(new)
    arm = next(o for o in new if o.type == 'ARMATURE')
    mesh = next(o for o in new if o.type == 'MESH')
    # the first beat of idle: a relaxed stance instead of the rest pose's bent arms
    idle = next((a for a in bpy.data.actions if a.name.startswith('idle')), None)
    if idle:
        arm.animation_data_create()
        arm.animation_data.action = idle
        try:
            arm.animation_data.action_slot = idle.slots[0]
        except (AttributeError, IndexError):
            pass
        if arm.animation_data.nla_tracks:
            for t in arm.animation_data.nla_tracks:
                t.mute = True
    bpy.context.scene.frame_set(8)
    tint(mesh)
    return arm, mesh


def meta_layer(me):
    """The UV layer holding (region, part) per corner: its u runs past 1."""
    return max(me.uv_layers, key=lambda layer: max((d.uv.x for d in layer.data), default=0))


def tint(mesh):
    """Each region's colour as a vertex colour, multiplied into the atlas the way the game's material does."""
    me = mesh.data
    meta = meta_layer(me)
    col = me.color_attributes.new('tint', 'FLOAT_COLOR', 'CORNER')
    for i, d in enumerate(meta.data):
        region = REGIONS[min(len(REGIONS) - 1, int(d.uv.x))]
        rgb = linear(PALETTE[region]) if region in PALETTE else (1.0, 1.0, 1.0)
        col.data[i].color = (*rgb, 1.0)
    for mat in me.materials:
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None or not bsdf.inputs['Base Color'].links:
            continue
        src = bsdf.inputs['Base Color'].links[0].from_socket
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'tint'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        a = next(s for s in mix.inputs if s.name == 'A' and s.type == 'RGBA')
        b = next(s for s in mix.inputs if s.name == 'B' and s.type == 'RGBA')
        out = next(s for s in mix.outputs if s.type == 'RGBA')
        nt.links.new(src, a)
        nt.links.new(attr.outputs['Color'], b)
        nt.links.new(out, bsdf.inputs['Base Color'])


def keep(mesh, wanted):
    """A copy of the mesh with only these parts (the rest of the hair styles, beards and gear go)."""
    me = mesh.data.copy()
    meta = meta_layer(me).name
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv[meta]
    gone = [f for f in bm.faces if PARTS[min(len(PARTS) - 1, max(0, math.floor(f.loops[0][uv].uv.y)))] not in wanted]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(me)
    bm.free()
    return me


def aim(cam, target, offset, lens=None, ortho=None):
    cam.location = target + offset
    cam.rotation_euler = (-offset).to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = 'PERSP'
        cam.data.lens = lens or 50


def render(path, w, h):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log(os.path.relpath(path, ROOT))


def lineup(cam, gender, out):
    x = 0.0
    for size in SIZES:
        arm, mesh = load(f'{gender}-{size}')
        mesh.data = keep(mesh, {'base', 'hair:crop' if gender == 'm' else 'hair:long'})
        s = SIZE_SCALE[size]
        arm.scale = (s, s, s)
        x += 0.45 * s
        arm.location = (x, 0, 0)
        x += 0.45 * s + 0.12
    bpy.context.view_layer.update()
    # tall enough for the colossal body with room above its head
    w, h = 1800, 760
    aim(cam, Vector((x / 2, 0, 1.52)), Vector((0.9, -9.0, 0.6)), ortho=max(x + 0.4, 3.2 * w / h))
    render(os.path.join(out, f'lineup-{gender}.webp'), w, h)
    clear()


def heads(cam, gender, out):
    arm, mesh = load(f'{gender}-medium')
    base = mesh.data
    head = arm.matrix_world @ arm.pose.bones['head'].head
    target = head + Vector((0, -0.02, 0.035))
    aim(cam, target, Vector((0.32, -0.95, 0.06)), lens=85)
    shots = [(f'hair-{gender}-{h}', {'base', f'hair:{h}'}) for h in HAIR]
    if gender == 'm':
        shots += [(f'beard-{b}', {'base', 'hair:short', f'beard:{b}'}) for b in BEARDS]
    for name, parts in shots:
        mesh.data = keep(mesh, parts)
        render(os.path.join(out, f'{name}.webp'), 420, 420)
        trimmed = mesh.data
        mesh.data = base
        bpy.data.meshes.remove(trimmed)
    clear()


LABEL = {'tiny': 'Tiny', 'small': 'Small', 'medium': 'Medium', 'large': 'Large', 'huge': 'Huge', 'colossal': 'Colossal'}
KIND_TITLE = [('head', 'Head'), ('face', 'Face'), ('hand', 'Either hand'), ('offhand', 'Left hand only'), ('back', 'Back')]


def pieces_list():
    """The built-in pieces from the generated list the game reads (src/kit/pieces.gen.ts)."""
    import re

    with open(os.path.join(ROOT, 'src', 'kit', 'pieces.gen.ts')) as f:
        text = f.read()
    rows = []
    for m in re.finditer(r"\{ id: '([^']+)', name: '([^']+)', kind: '([^']+)', tags: \[([^\]]*)\]", text):
        rows.append({'id': m.group(1), 'name': m.group(2), 'kind': m.group(3), 'tags': re.findall(r"'([^']+)'", m.group(4))})
    return rows


def write_page(path):
    """docs/forge/kit-sheet.html, from the renders above and the piece list."""
    import html

    pieces = pieces_list()
    sizes = ''.join(f'<span>{LABEL[s]} <em>{SIZE_SCALE[s]:g}x</em></span>' for s in SIZES)
    hair = ''.join(f'<figure><img src="kit/hair-{g}-{h}.webp" alt="" loading="lazy"><figcaption>{"Bald" if h == "none" else h.title()}</figcaption></figure>' for h in HAIR for g in ('m', 'f'))
    beards = ''.join(f'<figure><img src="kit/beard-{b}.webp" alt="" loading="lazy"><figcaption>{b.replace("_", " ").capitalize()}</figcaption></figure>' for b in BEARDS)
    gear = ''
    for kind, title in KIND_TITLE:
        tiles = ''.join(
            f'<figure class="piece"><img src="../../public/kit/pieces/{p["id"]}.webp" alt="" loading="lazy"><figcaption><b>{html.escape(p["name"])}</b><span>{html.escape(", ".join(p["tags"][:4]))}</span></figcaption></figure>'
            for p in pieces
            if p['kind'] == kind
        )
        gear += f'<h3>{title}</h3><div class="pieces">{tiles}</div>'
    page = TEMPLATE.replace('{sizes}', sizes).replace('{hair}', hair).replace('{beards}', beards).replace('{gear}', gear).replace('{count}', str(len(pieces)))
    with open(path, 'w') as f:
        f.write(page)
    log(os.path.relpath(path, ROOT))


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Character Kit</title>
<style>
  :root { --bg: #f6f3ec; --panel: #fffdf8; --ink: #1d1b17; --muted: #6b655a; --line: #e2dccf; --stage: #2a2531; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #14161b; --panel: #1b1e25; --ink: #ece8df; --muted: #a39d90; --line: #2c3039; --stage: #23202b; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 48px 16px 96px; }
  h1 { font-size: 40px; line-height: 1.1; margin: 0 0 12px; letter-spacing: -0.02em; }
  h2 { font-size: 26px; margin: 56px 0 8px; letter-spacing: -0.01em; }
  h3 { font-size: 15px; margin: 28px 0 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  p { margin: 0 0 14px; max-width: 70ch; }
  .lede { font-size: 19px; color: var(--muted); }
  .stage { background: radial-gradient(ellipse at 50% 35%, #4a4156, var(--stage)); border-radius: 14px; padding: 12px; }
  .stage img { display: block; width: 100%; height: auto; }
  .sizes { display: grid; grid-template-columns: repeat(6, 1fr); text-align: center; font-size: 13px; color: var(--muted); margin: 6px 0 24px; }
  .sizes em { font-style: normal; opacity: 0.7; }
  .heads { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }
  .heads figure, .piece { margin: 0; background: var(--stage); border-radius: 12px; overflow: hidden; }
  .heads img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
  figcaption { padding: 6px 10px 8px; font-size: 13px; color: #ece8df; }
  .pieces { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .piece img { display: block; width: 100%; aspect-ratio: 1; object-fit: contain; padding: 8px; }
  .piece figcaption b { display: block; font-weight: 650; }
  .piece figcaption span { display: block; font-size: 12px; color: #a39d90; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .scroll { overflow-x: auto; }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel); border: 1px solid var(--line); padding: 1px 5px; border-radius: 5px; }
  @media (max-width: 640px) { .sizes { font-size: 11px; } h1 { font-size: 32px; } }
</style>
</head>
<body>
<main>
<h1>Character kit</h1>
<p class="lede">Every hero in the Forge starts from this kit, and nothing in it costs a credit: twelve bodies, eleven hair styles, three beards and {count} pieces of gear. Generation only fills what's missing. Once a player generates a piece, it joins the repository and everyone else can wear it free.</p>

<h2>Bodies</h2>
<p>Six sizes in two builds. Each size is its own body, not the medium one stretched, so a tiny hero is a compact adult and a huge one has a brawler's frame. Colossal is the transformation size: a hero whose ultimate transforms swaps into that body mid-fight. The game still scales each body by its size class, because the size sets the hitbox.</p>
<div class="stage"><img src="kit/lineup-m.webp" alt="The six men's bodies from tiny to colossal, side by side at their in-game scale"></div>
<div class="sizes">{sizes}</div>
<div class="stage"><img src="kit/lineup-f.webp" alt="The six women's bodies from tiny to colossal, side by side at their in-game scale"></div>
<div class="sizes">{sizes}</div>

<h2>Hair and beards</h2>
<p>Every body carries all of these at once and the look decides which one shows, so switching is free and instant. Beards fit either build.</p>
<div class="heads">{hair}</div>
<h3>Beards</h3>
<div class="heads">{beards}</div>

<h2>Gear</h2>
<p>Rigid pieces, each its own small model of 4 to 12 KB. The pipeline puts five sockets on every body, and a piece hangs on one, so any piece fits any body and follows every animation. A piece with a colour slot takes the colour picked beside its row in the Forge. The prompt picks pieces too: "a knight" gets a sword and a shield.</p>
<div class="scroll"><table>
<tr><th>Socket</th><th>Where it sits</th><th>What fits</th></tr>
<tr><td>Head</td><td>On the hairline, scaled to the body's head</td><td>Hats, crowns, helms, a halo</td></tr>
<tr><td>Face</td><td>In front of the eyes, scaled to the head</td><td>Glasses, shades, a visor, an eyepatch</td></tr>
<tr><td>Right hand</td><td>In the palm, the length along the thumb</td><td>Any hand piece</td></tr>
<tr><td>Left hand</td><td>The same on the left</td><td>Any hand piece, plus shields and bows</td></tr>
<tr><td>Back</td><td>Between the shoulder blades</td><td>Wings, a jetpack, a quiver</td></tr>
</table></div>
{gear}

<h2>Making more</h2>
<p>Built-in pieces come from <code>tools/blender/pieces.py</code>. <code>Blender -b --python tools/blender/pieces.py -- --only katana</code> rebuilds one piece, its thumbnail and the list the game reads in <code>src/kit/pieces.gen.ts</code>. Bodies come from <code>tools/blender/human.py</code>, and <code>tools/blender/kit_sheet.py</code> redraws this page.</p>
</main>
</body>
</html>
"""


def main(opts):
    out = os.path.join(ROOT, opts.get('out', os.path.join('docs', 'forge', 'kit')))
    os.makedirs(out, exist_ok=True)
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    cam = setup()
    if not opts.get('page-only'):
        for gender in ('m', 'f'):
            lineup(cam, gender, out)
            heads(cam, gender, out)
    write_page(os.path.join(os.path.dirname(out), 'kit-sheet.html'))


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
