/**
 * The clips the clip audit takes out of play (docs/reference/2026-11-05-clip-audit.md, "Replace", and the trims that
 * move a clip out of a slot; signed by the owner 2026-11-10). No table that plays clips may name one (audit.test.ts),
 * except where AUDIT_KEPT says why. The strafes the audit replaces keep their gait names: the splice rebuilds them.
 * `shoot_rifle` is back: it stands on the rifle aim's legs now (trims.ts CLIP_LEGS), not its own running ones.
 */
export const AUDIT_DROPPED: ReadonlySet<string> = new Set([
  // jumps, falls and hangs that hold an invisible rifle or a T-pose
  'jump', 'jump_up', 'backward_jump', 'left_strafe_jump', 'right_strafe_jump', 'falling', 'hanging',
  'crouch_idle', 'crouch_walk_forward', 'prone_idle', 'crawl_backwards_in_prone', 'prone_right_turn',
  'sprint_forward', 'sprint_forward_left', 'sprint_forward_right', 'running_forward_flip', 'jump_over',
  // blows that miss, travel off the spot or end on the floor
  'punch_to_elbow_combo', 'surprise_uppercut', 'inside_crescent_kick', 'flip_kick', 'scissor_kick', 'hurricane_kick',
  'spin_flip_kick', 'back_flip_to_uppercut', 'drop_kick', 'flying_bicycle_kick', 'club_swing_strike', 'club_knee_jab',
  'pistol_whip', 'charge', 'big_jump', 'capoeira', 'flying_shoulder_throw', 'shoulder_throw_aggressor',
  'knock_off_assailant',
  // casts and shots turned off the aim, crouched, seated or still
  'gs_great_sword_power_up', 'ss_sword_and_shield_casting', 'spell_casting', 'magic_standing_1h_magic_attack_02',
  'shooting_gun', 'shooting_pistol', 'gunplay', 'fire_rifle', 'aiming_gun', 'throw_grenade',
  'grenade_throw', 'run_and_throw_grenade', 'frisbee_throw', 'throwing_dice',
  // guards that pop or don't hold, reactions that aren't
  'gs_great_sword_blocking', 'gs_great_sword_impact', 'hit_to_head', 'stand_up', 'flying_back_death', 'getting_thrown',
  // the rest
  'idle_v10', 'standing_dodge_forward', 'sprinting_forward_roll', 'climbing_up_wall', 'pistol_aim_strafe_right',
  'pistol_jump_2', 'rifle_aim_walk', 'rifle_grab_from_back', 'gesture_2',
])

/** Out of every guard: a pumping arm and a one-shot slip, which play as a parry and a reaction instead. */
export const NOT_A_GUARD: ReadonlySet<string> = new Set(['blocking', 'body_block'])

/** Dropped clips a table still plays, and why the audit's reason doesn't hold where they play. */
export const AUDIT_KEPT: Readonly<Record<string, string>> = {
  crouch_idle: "the owner kept today's crouch (2026-11-07)",
  crouch_walk_forward: "the owner kept today's crouch (2026-11-07)",
  prone_idle: 'the rifle keeps its own prone, rifle in hand (the audit: rifle coverage may keep it)',
  hurricane_kick: 'only the air blow: it hovers with no take-off or landing, and in the air the body is already off the ground',
  climbing_up_wall: 'only the wall crawl: a climbing loop is wrong for a mantle, which tops out, and right for crawling up a wall',
}
