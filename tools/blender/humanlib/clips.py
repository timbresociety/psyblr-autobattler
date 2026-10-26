"""
The clips every arena character plays (idle, run, fly, hover, slash, shoot, cast, ultimate, hurt, stunned, fall, and
the ten cast poses a skill's look can pick: see CAST_POSES), keyframed by script on the game rig. The poses are the ones first authored for the T-posed mannequin; the
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
    Key every clip. `arms_out` widens the relaxed arm angle (degrees) for broad or heavy bodies, so hands clear
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

    cast_poses(rig, down, stance)


def cast_poses(rig, down, stance):
    """
    The cast poses beside `cast` (the hip charge): how a skill's look delivers it (src/charter/skill-look.ts). Each
    lands its release between 0.24 and 0.48 s, inside a cast, and returns to the guard.
    """
    guard_l = {'upper_arm_L': (-30, 60, 0), 'forearm_L': (0, 0, -70)}

    # palms forward: arms flung wide and back, then both palms driven forward together (a Galick Gun)
    wide = merged(stance, both(arm=(-15, 15, 25), forearm=(0, 0, -50)), {'spine': (-8, 0, 0), 'chest': (-6, 0, 0), 'head': (-4, 0, 0)})
    drive = merged(stance, both(arm=(-86, 86, -14), forearm=(0, 0, -6)), {'spine': (10, 0, 0), 'chest': (6, 0, 0)})
    make_action(rig, 'cast_palms', [(0, down, 0, 0), (0.16, wide, -0.04, 0.03), (0.3, drive, -0.06, -0.08), (0.45, drive, -0.06, -0.08), (0.62, down, 0, 0)], loop=False)

    # one palm: the right hand coils at the hip and pushes out while the left pulls back
    coil = merged(stance, {'upper_arm_R': (25, 75, 12), 'forearm_R': (0, 0, -100), 'upper_arm_L': (-35, 62, 0), 'forearm_L': (0, 0, -95), 'spine': (0, 0, -25), 'chest': (0, 0, -12)})
    push = merged(stance, {'upper_arm_R': (-88, 88, -4), 'forearm_R': (0, 0, -4), 'upper_arm_L': (10, 72, -40), 'forearm_L': (0, 0, -110), 'spine': (6, 0, 18), 'chest': (4, 0, 10)})
    make_action(rig, 'cast_palm', [(0, down, 0, 0), (0.12, coil, -0.03, 0.02), (0.24, push, -0.05, -0.1), (0.4, push, -0.05, -0.1), (0.56, down, 0, 0)], loop=False)

    # two fingers: fingertips held to the brow to charge, then the arm snaps out to point (a Special Beam Cannon)
    brow = over(down, guard_l, {'upper_arm_R': (-115, 50, -30), 'forearm_R': (0, 0, -140), 'head': (6, 0, 0), 'spine': (2, 0, -8)})
    point = over(down, guard_l, {'upper_arm_R': (-90, 90, 0), 'forearm_R': (0, 0, 0), 'chest': (0, 0, -12), 'head': (0, 0, 10)})
    make_action(rig, 'cast_fingers', [(0, down, 0, 0), (0.16, brow, 0, 0), (0.3, brow, 0, 0), (0.38, point, 0, -0.03), (0.52, point, 0, -0.03), (0.68, down, 0, 0)], loop=False)

    # overhead: both arms raised to gather above the head, then the whole body hurls it forward (a Spirit Bomb)
    raised = merged(both(arm=(0, -72, 0), forearm=(0, 0, -12), thigh=(0, -8, 0)), {'spine': (-10, 0, 0), 'chest': (-6, 0, 0), 'head': (-22, 0, 0)})
    hurl = merged(stance, both(arm=(-70, 86, -6), forearm=(0, 0, -8)), {'spine': (22, 0, 0), 'chest': (8, 0, 0), 'head': (6, 0, 0)})
    make_action(rig, 'cast_overhead', [(0, down, 0, 0), (0.2, raised, 0.02, 0.04), (0.34, raised, 0.02, 0.04), (0.46, hurl, -0.08, -0.1), (0.6, hurl, -0.08, -0.1), (0.78, down, 0, 0)], loop=False)

    # cross burst: forearms crossed before the chest in a half crouch, then flung wide as the body opens
    cross = merged(both(arm=(-55, 78, -48), forearm=(0, 0, -115), thigh=(-30, -10, 0), shin=(45, 0, 0)), {'spine': (14, 0, 0), 'chest': (6, 0, 0), 'head': (8, 0, 0)})
    fling = merged(both(arm=(-8, -25, 22), forearm=(0, 0, -6), thigh=(-6, -12, 0), shin=(8, 0, 0)), {'spine': (-14, 0, 0), 'chest': (-8, 0, 0), 'head': (-18, 0, 0)})
    make_action(rig, 'cast_cross', [(0, down, 0, 0), (0.16, cross, -0.12, 0), (0.3, fling, 0.04, 0), (0.46, fling, 0.04, 0), (0.62, down, 0, 0)], loop=False)

    # clap: arms swung open, then the hands meet in front of the chest
    spread = merged(stance, both(arm=(-35, 12, 35), forearm=(0, 0, -15)), {'spine': (-4, 0, 0)})
    clap = merged(stance, both(arm=(-84, 84, -16), forearm=(0, 0, -20)), {'spine': (8, 0, 0), 'chest': (4, 0, 0)})
    make_action(rig, 'cast_clap', [(0, down, 0, 0), (0.14, spread, 0, 0), (0.24, clap, -0.03, -0.03), (0.4, clap, -0.03, -0.03), (0.56, down, 0, 0)], loop=False)

    # ground slam: a hop with the fists raised, then down into a crouch with both fists driven into the ground
    hop = merged(both(arm=(0, -60, 0), forearm=(0, 0, -45), thigh=(-40, -8, 0), shin=(70, 0, 0), foot=(20, 0, 0)), {'spine': (-6, 0, 0), 'head': (-10, 0, 0)})
    slam = merged(both(arm=(-62, 82, -8), forearm=(0, 0, -12), thigh=(-75, -16, 0), shin=(118, 0, 0), foot=(-38, 0, 0)), {'spine': (42, 0, 0), 'chest': (10, 0, 0), 'head': (-14, 0, 0)})
    make_action(rig, 'cast_slam', [(0, down, 0, 0), (0.16, hop, 0.22, -0.05), (0.3, slam, -0.36, -0.12), (0.5, slam, -0.36, -0.12), (0.72, down, 0, 0)], loop=False)

    # summon: the right arm raised high to call, then swept down to point where it arrives
    call = merged(stance, guard_l, {'upper_arm_R': (-20, -62, 0), 'forearm_R': (0, 0, -8), 'spine': (-6, 0, 0), 'head': (-14, 0, 0)})
    sweep = merged(stance, guard_l, {'upper_arm_R': (-55, 86, -4), 'forearm_R': (0, 0, -4), 'spine': (12, 0, 6), 'head': (8, 0, 0)})
    make_action(rig, 'cast_summon', [(0, down, 0, 0), (0.2, call, 0.02, 0), (0.32, call, 0.02, 0), (0.44, sweep, -0.04, -0.06), (0.58, sweep, -0.04, -0.06), (0.74, down, 0, 0)], loop=False)

    # breath: a deep draw back with the chest lifted, then the head and chest thrust forward to breathe it out
    draw = merged(down, both(arm=(16, 0, 10)), {'spine': (-10, 0, 0), 'chest': (-12, 0, 0), 'neck': (-12, 0, 0), 'head': (-18, 0, 0)})
    blow = merged(down, both(arm=(24, 0, 14), thigh=(-12, -6, 0), shin=(20, 0, 0)), {'spine': (16, 0, 0), 'chest': (10, 0, 0), 'neck': (14, 0, 0), 'head': (8, 0, 0)})
    make_action(rig, 'cast_breath', [(0, down, 0, 0), (0.2, draw, 0.02, 0.04), (0.34, blow, -0.04, -0.08), (0.54, blow, -0.04, -0.08), (0.7, down, 0, 0)], loop=False)

    # spin: a full turn with the arms out, low on the knees. The turn ends on 360 degrees, not 0, so no key flips sides
    out = merged(both(arm=(0, 8, 0), forearm=(0, 0, -10), thigh=(-14, -10, 0), shin=(24, 0, 0)), {'spine': (6, 0, 0)})
    turn = lambda deg: merged(out, {'hips': (0, 0, deg)})
    make_action(rig, 'cast_spin', [(0, down, 0, 0), (0.1, turn(0), -0.05, 0), (0.22, turn(120), -0.05, 0), (0.34, turn(240), -0.05, 0), (0.46, turn(360), -0.05, 0), (0.62, merged(down, {'hips': (0, 0, 360)}), 0, 0)], loop=False)


# the cast poses a skill look can pick, beside the hip charge (`cast`)
CAST_POSES = ['cast_palms', 'cast_palm', 'cast_fingers', 'cast_overhead', 'cast_cross', 'cast_clap', 'cast_slam', 'cast_summon', 'cast_breath', 'cast_spin']
CLIPS = ['idle', 'run', 'fly', 'hover', 'slash', 'shoot', 'cast', 'ultimate', 'hurt', 'stunned', 'fall'] + CAST_POSES
