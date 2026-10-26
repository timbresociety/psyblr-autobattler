"""
Where gear attaches on a body: the hat line, the lens plane, the upper back and each palm. The game hangs a piece on
the socket's bone at load (src/arena/client/gear.ts), so a piece follows every clip without being rigged.

Pieces are modelled in socket space (tools/blender/pieces.py): the socket's point is the origin, and in Blender's axes
up is +z and the hero's front is -y. A hand piece points along the thumb (+z, a blade's length) with its edge toward
the fingertips (-y). Head and face pieces are modelled for a head PIECE_HEAD_HALF_WIDTH wide at the eyes, and each
body scales them to its own head.

Positions and directions are written in glTF's axes (y up, the hero facing +z), in the body's rest pose.
"""

from mathutils import Vector

from . import rig as R

# half the width of the head that head and face pieces are modelled for, at the eyes, in metres
PIECE_HEAD_HALF_WIDTH = 0.0933


def gltf(v):
    """Blender (z up, facing -y) to glTF (y up, facing +z)."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def body_sockets(rig, head, mesh):
    scale = round(head.half_width / PIECE_HEAD_HALF_WIDTH, 4)
    # a hat sits on the hairline at the front, centred a touch behind the head's middle
    hat_z = head.hairline(Vector((0, head.front, head.eyes.z)), 0.0) + 0.005
    lens_y = min(head.front + 0.006, head.eye_l.y - head.eye_r_radius - 0.008)
    out = {
        'head': {'bone': 'head', 'pos': gltf(Vector((0, head.centre.y + 0.008, hat_z))), 'scale': scale},
        'face': {'bone': 'head', 'pos': gltf(Vector((0, lens_y, (head.eye_l.z + head.eye_r.z) / 2))), 'scale': scale},
    }
    # the back: on the body's surface between the shoulder blades
    chest = rig.data.bones['upper_chest'].head_local
    behind = [v.co for v in mesh.data.vertices if abs(v.co.x) < 0.06 and abs(v.co.z - chest.z) < 0.03 and v.co.y > chest.y]
    back_y = max((p.y for p in behind), default=chest.y + 0.1)
    out['back'] = {'bone': 'upper_chest', 'pos': gltf(Vector((0, back_y + 0.012, chest.z)))}
    # each palm: the rig keeps every limb's turn away from a palms-down T-pose (rig.build_rig), so the thumb is that
    # pose's forward and the back of the hand its up, turned the same way
    for side, slot in (('L', 'hand_l'), ('R', 'hand_r')):
        name = f'hand_{side}'
        b = rig.data.bones[name]
        h, t = b.head_local, b.tail_local
        c = R.correction(rig, name)
        fingers = (t - h).normalized()
        thumb = c @ Vector((0, -1, 0))
        thumb = (thumb - fingers * thumb.dot(fingers)).normalized()
        back_of_hand = c @ Vector((0, 0, 1))
        grip = h.lerp(t, 0.55) - back_of_hand * 0.02
        out[slot] = {'bone': name, 'pos': gltf(grip), 'up': gltf(thumb), 'fwd': gltf(fingers)}
    return out
