/**
 * The part of a library clip that plays, wherever it plays (clip audit, docs/reference/2026-11-05-clip-audit.md,
 * "Trim"; signed by the owner 2026-11-10): seconds into the clip as the library has it, from and to (to the end when
 * there's no `to`). A clip loads already cut (arena/client/anim-library.ts animClip), so a skill, the bench and the
 * forge all see the same blow, and its release mark moves with it (anim-index.ts MOTION_RELEASE).
 *
 * Engine moves the library cuts to the engine's own timing (library-gait.ts MOVE_CUTS) aren't here: the dive, the
 * mantle and the jumps.
 */
export const CLIP_TRIMS: Readonly<Record<string, readonly [from: number, to?: number]>> = {
  // the guard held after the blow, a second or so of it
  jab_cross: [0, 1.05],
  body_jab_cross: [0, 1.4],
  uppercut_jab: [0, 3.05],
  slash_advance: [0, 1.85],
  rifle_punch: [0, 2.0],
  bayonet_stab: [0, 1.8],
  outward_block: [0.2, 1.6],
  axe_standing_melee_combo_attack_ver_1: [0, 3.95],
  // the roar held after the leap and smash, ending turned off the aim
  jump_attack: [0, 2.9],
  mutant_jump_attack: [0, 2.85],
  // standing after the shout
  axe_standing_taunt_battlecry: [0, 1.9],
  standing_taunt_battlecry: [0, 1.9],
  // the lead in and the guard after both
  knee_jabs_to_uppercut: [0.5, 4.55],
  // the leap and the knee, not the landing on hands and knees that follows
  flying_knee_punch_combo: [0, 1.6],
  // the dead hold before the swing
  club_swing_single: [0.8],
  club_swing_double: [0.95],
  club_swing_homerun: [0.9],
  // the bat swing alone, out of eight seconds of a batter's stance and walk
  cmu_baseball_swing: [2.0, 3.6],
  // the leap and slam only: the run up and the walk back start and end 2.5 m off the spot
  axe_standing_melee_run_jump_attack: [0.5, 2.7],
  // after the turn it starts with (119 degrees off the aim), up to the stance after the kick
  rifle_turn_and_kick: [0.75, 2.35],
  // an aim held, before the hero drops the gun and turns away
  pistol_aim: [0, 3.0],
  // the throw itself: no long lead, no standing after the release, no picking a thing up off the floor first
  throwing: [0.5, 3.4],
  throw_object: [1.7, 4.05],
  // five seconds in a low lunge before anything happens
  casting_spell: [4.4, 7.2],
  // dodges that stand still first or after
  standing_dodge_backward: [0.1, 0.95],
  running_dive_roll: [0, 1.5],
  dive_roll: [0.34, 2.04],
  stand_to_roll: [0.34, 2.04],
  aerial_evade: [0.45, 3.1],
  // reactions read at once
  sweep_fall: [0.5],
  // getting up: from the floor to the feet, not lying first or standing after
  getting_up: [2.4, 6.0],
  inverted_double_kick_to_kip_up: [1.6, 3.21],
  // the rifle's straight-up jump pops in its first frames
  rifle_jump_up: [0.08, 0.54],
  // traversal: the move without the walk in or the standing after
  step_up_to_jump_over_object: [0.55, 2.88],
  jumping_over_into_combat: [1.2, 3.0],
  braced_hang: [0.7, 1.29],
  male_runs_up_a_wall_onto_a_platform: [0, 1.4],
  landing: [0, 1.35],
  jumping_down_from_higher_level: [0.6, 2.6],
  // emotes without the dead stand round them
  dance_1: [1.4, 5.5],
  gesture_1: [2.3, 4.9],
}

/**
 * Clips the baker turned by their chest instead of the way they travel (clip audit, "The baker turned whole sets the
 * wrong way"; scripts/rpm-anim.ts turns a clip with no named way by its chest, and a rifle stance's chest sits well off
 * its travel): degrees each is turned back round the vertical as it loads, + toward the hero's left, so it goes the way
 * it's named. The audit measured each one's travel.
 */
export const CLIP_TURNS: Readonly<Record<string, number>> = {
  // goes +32, named straight ahead: the rifle hero's crouch walk crabbed off to the left
  rifle_walk_crouching_forward: -32,
  pistol_aim_walk: -36,
  // goes +127, named +90
  pistol_aim_strafe_left: -37,
  // goes -141, named 180
  pistol_aim_walk_back: -39,
  // the archer: baked chest to the front, so the arrow's line (string hand to bow hand, read on the body at the
  // release, 2026-11-13) ran 60 to 68 degrees to the left of the aim and every shot left the bow sideways
  standing_aim_recoil: -62,
  standing_aim_idle_01: -63,
  standing_aim_overdraw: -68,
  standing_draw_arrow: -64,
}

/**
 * Clips whose upper body is right and whose legs aren't: each stands on the hips and legs of the clip named, as it loads.
 * The rifle's one standing shot raises the rifle to the eye, but its legs run on the spot (the audit dropped it for
 * that); the library's other standing rifle fire, `firing_rifle`, never raises the rifle from the hip.
 */
export const CLIP_LEGS: Readonly<Record<string, string>> = {
  shoot_rifle: 'rifle_aiming_idle',
}

/** Where a moment `at` seconds into a clip falls once the clip is trimmed. */
export const trimmedTime = (clip: string, at: number): number => Math.max(0, at - (CLIP_TRIMS[clip]?.[0] ?? 0))
