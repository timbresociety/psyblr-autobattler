"""
The eleven clips every arena character plays (idle, run, fly, hover, slash, shoot, cast, ultimate, hurt, stunned,
fall), keyframed by script on the game rig. The poses are the ones first authored for the T-posed mannequin; the
rig's per-bone T-pose corrections (rig.py) make the same numbers mean the same thing on MakeHuman's A-posed body.

Poses: bone -> (x, y, z) degrees, applied in armature space about the bone's head, in the order y, then x, then z. The
character faces -y; its left is +x.
  x (pitch): positive bends forward - spine and head bow, a leg or a lowered arm swings back, a shin bends the knee.
  y (side):  for arms, positive lowers the arm toward the body (both sides, mirrored below); for the trunk, a side bend.
  z (yaw):   turn about the vertical.
Right-side bones are authored like the left and mirrored, so one set of numbers means the same on both sides:
  arms (T-pose pointing out sideways): y lowers toward the body, then x swings forward (-) or back (+), then z sweeps
  the arm outward (+) or across the body (-); a forearm's z bends the elbow forward (-).
  legs: x swings forward (-) or back (+); y splays the leg outward (-); a shin's x bends the knee (+).
"""

import math

import bpy
from mathutils import Euler, Quaternion, Vector

from .rig import correction

MIRROR = {'clavicle_R', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_R', 'shin_R', 'foot_R'}


def merged(*poses):
    out = {}
    for p in poses:
        for k, v in p.items():
            base = out.get(k, (0, 0, 0))
            out[k] = (base[0] + v[0], base[1] + v[1], base[2] + v[2])
    return out


def over(base, *poses):
    """`base` with each later pose's bones replacing it outright: for absolute poses, where adding would double up."""
    out = dict(base)
    for p in poses:
        out.update(p)
    return out


def both(arm=None, forearm=None, thigh=None, shin=None, foot=None, hand=None):
    """The same values on both sides (mirroring makes them symmetric)."""
    out = {}
    for name, v in (('upper_arm', arm), ('forearm', forearm), ('thigh', thigh), ('shin', shin), ('foot', foot), ('hand', hand)):
        if v is not None:
            out[f'{name}_L'] = v
            out[f'{name}_R'] = v
    return out


def local_rotation(rig, pb, deg):
    x, y, z = deg
    if pb.name in MIRROR:
        y, z = -y, -z
    q = Euler((math.radians(x), math.radians(y), math.radians(z)), 'YXZ').to_quaternion()
    c_b = correction(rig, pb.name)
    c_p = correction(rig, pb.parent.name) if pb.parent else Quaternion()
    q = c_p @ q @ c_b.inverted()
    rest = pb.bone.matrix_local.to_quaternion()
    return rest.inverted() @ q @ rest


def key_pose(rig, frame, pose, root_z=0.0, root_y=0.0):
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = local_rotation(rig, pb, pose.get(pb.name, (0, 0, 0)))
        pb.keyframe_insert('rotation_quaternion', frame=frame, group=pb.name)
    hips = rig.pose.bones['hips']
    hips.location = hips.bone.matrix_local.to_3x3().inverted() @ Vector((0, root_y, root_z))
    hips.keyframe_insert('location', frame=frame, group='hips')


def act_fcurves(act):
    # Blender 4.4+ layered actions keep curves in channelbags; older ones on the action
    if hasattr(act, 'fcurves') and len(act.fcurves):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def make_action(rig, name, keys, fps=30, loop=True):
    """keys: list of (time_seconds, pose_dict, root_z, root_y)."""
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    for t, pose, rz, ry in keys:
        key_pose(rig, round(t * fps) + 1, pose, rz, ry)
    for fc in act_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.easing = 'AUTO'
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, act)
    strip.action_frame_end = round(keys[-1][0] * fps) + 1
    rig.animation_data.action = None
    act.use_fake_user = True
    return act


def author(rig, arms_out=0.0):
    """
    Key all eleven clips. `arms_out` widens the relaxed arm angle (degrees) for broad or heavy bodies, so hands clear
    the hips and belly.
    """
    lower = 72 - arms_out
    # a relaxed guard: arms down with a soft forward bend at the elbow, feet a little apart
    down = merged(both(arm=(0, lower, 0), forearm=(0, 0, -18), thigh=(0, -4, 0)), {})

    # idle: breathing, a slow weight shift and a little arm drift
    idle_a = merged(down, {'chest': (-2, 0, 0), 'upper_chest': (-1.5, 0, 0), 'head': (2, 0, 0), 'hips': (0, 2, 0), 'spine': (0, -2, 0)})
    idle_b = merged(down, both(arm=(4, -3, 0)), {'chest': (1.5, 0, 0), 'upper_chest': (1, 0, 0), 'head': (-1, 0, 0), 'hips': (0, -2, 0), 'spine': (0, 2, 0)})
    make_action(rig, 'idle', [(0, idle_a, 0, 0), (1.3, idle_b, -0.012, 0), (2.6, idle_a, 0, 0)])

    # run: contact and passing poses, arms counter-swinging with bent elbows, shoulders twisting against the hips
    def contact(s):
        lead, trail = ('L', 'R') if s > 0 else ('R', 'L')
        return merged(
            down,
            both(forearm=(0, 0, -70)),
            {
                f'thigh_{lead}': (-42, -4, 0),
                f'shin_{lead}': (12, 0, 0),
                f'foot_{lead}': (-12, 0, 0),
                f'thigh_{trail}': (32, -4, 0),
                f'shin_{trail}': (75, 0, 0),
                f'foot_{trail}': (25, 0, 0),
                f'upper_arm_{lead}': (38, 0, 0),
                f'upper_arm_{trail}': (-45, 0, 0),
                'hips': (0, 0, 7 * s),
                'spine': (10, 0, -4 * s),
                'chest': (4, 0, -10 * s),
                'head': (-8, 0, 7 * s),
            },
        )

    def passing(s):
        lead, trail = ('L', 'R') if s > 0 else ('R', 'L')
        return merged(
            down,
            both(forearm=(0, 0, -70)),
            {
                f'thigh_{lead}': (2, -4, 0),
                f'shin_{lead}': (14, 0, 0),
                f'thigh_{trail}': (-22, -4, 0),
                f'shin_{trail}': (100, 0, 0),
                f'foot_{trail}': (20, 0, 0),
                f'upper_arm_{lead}': (8, 0, 0),
                f'upper_arm_{trail}': (-12, 0, 0),
                'spine': (10, 0, 0),
                'chest': (4, 0, 0),
                'head': (-8, 0, 0),
            },
        )

    make_action(rig, 'run', [(0, contact(1), -0.045, 0), (0.17, passing(1), 0.035, 0), (0.34, contact(-1), -0.045, 0), (0.51, passing(-1), 0.035, 0), (0.68, contact(1), -0.045, 0)])

    # fly: the Superman pose - body flat out, one fist leading, the other arm swept back, legs trailing, a slow bob
    fly_a = merged(
        both(thigh=(6, -2, 0), shin=(28, 0, 0), foot=(40, 0, 0)),
        {
            'hips': (78, 0, 0),
            'spine': (-8, 0, 0),
            'chest': (-4, 0, 0),
            'neck': (-20, 0, 0),
            'head': (-35, 0, 0),
            'upper_arm_R': (0, -88, 0),
            'forearm_R': (0, 0, -6),
            'upper_arm_L': (25, 80, 0),
            'forearm_L': (0, 0, -25),
        },
    )
    fly_b = merged(fly_a, {'spine': (2, 2, 0), 'thigh_L': (8, 0, 0), 'thigh_R': (-6, 0, 0), 'upper_arm_L': (-5, 0, 0)})
    make_action(rig, 'fly', [(0, fly_a, 0.25, 0), (0.9, fly_b, 0.31, 0), (1.8, fly_a, 0.25, 0)])

    # hover: upright in the air, knees drawn up a little, arms loose and out, bobbing
    hover_a = merged(both(arm=(-10, 52, 0), forearm=(0, 0, -30), thigh=(-25, -6, 0), shin=(45, 0, 0), foot=(25, 0, 0)), {'spine': (4, 0, 0)})
    hover_b = merged(hover_a, both(arm=(0, 6, 0), thigh=(5, 0, 0), shin=(-8, 0, 0)), {'spine': (-2, 0, 0), 'head': (3, 0, 0)})
    make_action(rig, 'hover', [(0, hover_a, 0.0, 0), (0.8, hover_b, 0.07, 0), (1.6, hover_a, 0.0, 0)])

    # slash: wind up over the right shoulder, a fast diagonal cut across, follow through, recover (fits the 0.45 s cast)
    guard_l = {'upper_arm_L': (-30, 50, 0), 'forearm_L': (0, 0, -95)}
    wind = over(down, guard_l, {'upper_arm_R': (20, -45, 0), 'forearm_R': (0, 0, -105), 'spine': (0, 0, -22), 'chest': (0, 0, -18), 'thigh_L': (-28, -6, 0), 'shin_L': (28, 0, 0), 'thigh_R': (18, -6, 0), 'shin_R': (18, 0, 0)})
    strike = over(down, guard_l, {'upper_arm_R': (-70, 40, -45), 'forearm_R': (0, 0, -15), 'spine': (8, 0, 28), 'chest': (4, 0, 22), 'thigh_L': (-38, -6, 0), 'shin_L': (34, 0, 0), 'thigh_R': (22, -6, 0), 'shin_R': (16, 0, 0)})
    follow = over(down, guard_l, {'upper_arm_R': (-40, 72, -75), 'forearm_R': (0, 0, -22), 'spine': (6, 0, 38), 'chest': (4, 0, 28), 'thigh_L': (-34, -6, 0), 'shin_L': (32, 0, 0), 'thigh_R': (20, -6, 0), 'shin_R': (16, 0, 0)})
    make_action(rig, 'slash', [(0, down, 0, 0), (0.1, wind, -0.03, 0.02), (0.2, strike, -0.07, -0.12), (0.32, follow, -0.06, -0.14), (0.5, down, 0, 0)], loop=False)

    # shoot: arm snaps up to aim straight ahead, the shot kicks it up, it settles, then drops back to guard
    aim = over(down, {'upper_arm_R': (-90, 90, 0), 'forearm_R': (0, 0, 0), 'upper_arm_L': (-35, 62, 0), 'forearm_L': (0, 0, -95), 'chest': (0, 0, -10), 'head': (0, 0, 10)})
    recoil = merged(aim, {'upper_arm_R': (-16, 0, 0), 'forearm_R': (0, 0, -18), 'spine': (-4, 0, 0)})
    make_action(rig, 'shoot', [(0, down, 0, 0), (0.08, aim, 0, 0), (0.15, recoil, 0, 0.025), (0.28, aim, 0, 0), (0.45, down, 0, 0)], loop=False)

    # cast: gather energy at the hip with both hands, then thrust both palms forward - the energy-blast pose
    stance = {'thigh_L': (-22, -12, 0), 'shin_L': (26, 0, 0), 'thigh_R': (16, -12, 0), 'shin_R': (16, 0, 0)}
    gather = merged(stance, {'upper_arm_L': (10, 72, -40), 'forearm_L': (0, 0, -110), 'upper_arm_R': (25, 75, 12), 'forearm_R': (0, 0, -100), 'spine': (4, 0, -28), 'chest': (0, 0, -10)})
    thrust = merged(stance, {'upper_arm_L': (-88, 88, -10), 'forearm_L': (0, 0, -4), 'upper_arm_R': (-88, 88, -10), 'forearm_R': (0, 0, -4), 'spine': (8, 0, 4), 'chest': (6, 0, 0)})
    make_action(rig, 'cast', [(0, down, 0, 0), (0.15, gather, -0.06, 0.03), (0.28, thrust, -0.08, -0.07), (0.45, thrust, -0.08, -0.07), (0.6, down, 0, 0)], loop=False)

    # ultimate: drop into a crouch with arms crossed, then explode upward, arms flung wide, head thrown back
    crouch = merged(both(arm=(-20, 55, -35), forearm=(0, 0, -120), thigh=(-72, -14, 0), shin=(115, 0, 0), foot=(-35, 0, 0)), {'spine': (28, 0, 0), 'chest': (8, 0, 0), 'head': (-10, 0, 0)})
    burst = merged(both(arm=(-5, -38, 18), forearm=(0, 0, -6), thigh=(-4, -14, 0), shin=(6, 0, 0)), {'spine': (-16, 0, 0), 'chest': (-10, 0, 0), 'head': (-28, 0, 0)})
    make_action(rig, 'ultimate', [(0, down, 0, 0), (0.25, crouch, -0.3, 0), (0.45, burst, 0.12, 0), (0.85, burst, 0.1, 0), (1.1, down, 0, 0)], loop=False)

    # hurt: snapped back by the hit, arms up to guard, then recover
    flinch = over(down, both(arm=(-25, 55, 0), forearm=(0, 0, -75)), {'spine': (-15, 0, 8), 'chest': (-10, 0, 0), 'head': (-20, 0, 12)})
    make_action(rig, 'hurt', [(0, down, 0, 0), (0.06, flinch, 0, 0.07), (0.3, down, 0, 0)], loop=False)

    # stunned: a dazed sway, knees soft, head lolling side to side
    daze_a = merged(down, both(arm=(8, 6, 0), thigh=(-10, 0, 0), shin=(20, 0, 0)), {'spine': (8, 6, 0), 'head': (18, 12, 0)})
    daze_b = merged(down, both(arm=(-8, 6, 0), thigh=(-10, 0, 0), shin=(20, 0, 0)), {'spine': (8, -6, 0), 'head': (18, -12, 0)})
    make_action(rig, 'stunned', [(0, daze_a, -0.04, 0), (0.6, daze_b, -0.04, 0), (1.2, daze_a, -0.04, 0)])

    # fall: buckled by the blow, then down flat on the back, arms flung out
    buckle = over(down, both(arm=(-40, 30, 0), forearm=(0, 0, -40)), {'spine': (-22, 0, 8), 'head': (-25, 0, 0), 'thigh_L': (-30, 0, 0), 'shin_L': (60, 0, 0)})
    flat = merged(both(arm=(0, 15, 10), forearm=(0, 0, -20)), {'hips': (-90, 0, 0), 'spine': (-4, 0, 0), 'head': (-12, 0, 22), 'thigh_L': (8, -10, 0), 'thigh_R': (22, -8, 0), 'shin_R': (32, 0, 0)})
    make_action(rig, 'fall', [(0, down, 0, 0), (0.2, buckle, -0.1, 0.1), (0.55, flat, -0.86, 0.6), (1.2, flat, -0.86, 0.6)], loop=False)


CLIPS = ['idle', 'run', 'fly', 'hover', 'slash', 'shoot', 'cast', 'ultimate', 'hurt', 'stunned', 'fall']
