/**
 * The coverage manifest (GAME.md §12, "only what we can animate"): every melee style, ranged style, spell family,
 * traversal move and the moves every hero shares, with the clip roles each needs and the library clips that can fill
 * each role. A style is pickable only when every role has its clips; the Forge offers only pickable styles, and
 * coverage.test.ts fails the build when a style the game offers is missing a clip.
 *
 * A role lists its clips best first; `min` is how many distinct ones it needs (a combo needs three light strikes). A
 * weapon's locomotion names the weapon's own clips first and the unarmed ones after only where §12 lets the
 * upper-body layer carry the weapon over the legs (crouch-walk and the prone crawl for a pistol).
 */

export type CoverageKind = 'melee' | 'ranged' | 'spell' | 'traversal' | 'shared'

export interface Role {
  clips: readonly string[]
  min?: number
}

export interface Coverage {
  id: string
  kind: CoverageKind
  label: string
  /** False for a style the game doesn't offer (yet): it can't be picked even when its clips are all there. */
  offered?: boolean
  roles: Readonly<Record<string, Role>>
}

const GUARD_HIT = ['standing_block_react_large', 'axe_standing_block_react_large', 'magic_standing_block_react_large']
const GUARD_BROKEN = ['receiving_a_big_uppercut', 'axe_standing_react_large_gut', 'big_stomach_hit']
const GUARD = ['standing_block_idle', 'blocking', 'body_block']

const melee = (id: string, label: string, light: string[], heavy: string[], own: { block?: string[]; hit?: string[] } = {}, offered = true): Coverage => ({
  id,
  kind: 'melee',
  label,
  offered,
  roles: {
    light: { clips: light, min: 3 },
    heavy: { clips: heavy },
    block: { clips: [...(own.block ?? []), ...GUARD] },
    blockHit: { clips: [...(own.hit ?? []), ...GUARD_HIT] },
    guardBroken: { clips: GUARD_BROKEN },
  },
})

/** A weapon's own locomotion set (§12 weapon-held locomotion), its clips first. */
const carried = (prefix: 'pistol' | 'rifle', own: Partial<Record<string, string[]>>): Readonly<Record<string, Role>> => {
  const roles = ['idle', 'aimIdle', 'walk', 'run', 'sprint', 'strafeLeft', 'strafeRight', 'backpedal', 'crouch', 'crouchWalk', 'prone', 'crawl', 'aimWalk', 'reload', 'fire', 'jump', 'land', 'switch'] as const
  const unarmed: Partial<Record<(typeof roles)[number], string[]>> = { crouchWalk: ['crouch_walk_forward'], prone: ['prone_idle'], crawl: ['prone_forward'] }
  return Object.fromEntries(roles.map((r) => [r, { clips: [...(own[r] ?? []), ...(prefix === 'pistol' ? (unarmed[r] ?? []) : (unarmed[r] ?? []).filter((c) => c.startsWith('prone')))] }]))
}

/** Each spell family's casts (§4 Q), from the cast families the library has. */
const CASTS = {
  oneHand: ['magic_standing_1h_cast_spell_01', 'spell_cast', 'casting_spell'],
  twoHand: ['magic_standing_2h_cast_spell_01', 'two_hand_spell_casting', 'wide_arm_spell_casting'],
  attack1h: ['magic_standing_1h_magic_attack_01', 'magic_standing_1h_magic_attack_02', 'magic_standing_1h_magic_attack_03'],
  attack2h: ['magic_standing_2h_magic_attack_01', 'magic_standing_2h_magic_attack_02', 'magic_standing_2h_magic_attack_03', 'magic_standing_2h_magic_attack_04', 'magic_standing_2h_magic_attack_05'],
  area: ['magic_standing_2h_magic_area_attack_01', 'magic_standing_2h_magic_area_attack_02'],
  throws: ['throw', 'throwing', 'throw_object', 'throw_grenade', 'grenade_throw'],
  weapon: ['gs_great_sword_casting', 'ss_sword_and_shield_casting', 'ss_sword_and_shield_casting_2', 'gs_great_sword_power_up', 'ss_sword_and_shield_power_up'],
}
const spell = (id: string, label: string, clips: string[]): Coverage => ({ id, kind: 'spell', label, roles: { cast: { clips, min: 2 } } })
const move = (id: string, label: string, clips: string[], kind: CoverageKind = 'traversal'): Coverage => ({ id, kind, label, roles: { [id]: { clips } } })

export const COVERAGE: readonly Coverage[] = [
  // melee styles (§4 V)
  melee(
    'unarmed',
    'Unarmed',
    ['lead_jab', 'jab_cross', 'body_jab_cross', 'cross_punch', 'hook_punch', 'right_hook', 'uppercut', 'uppercut_jab', 'elbow_punch', 'punch_combo', 'combo_punch', 'quad_punch', 'punch_to_elbow_combo', 'knee_jabs_to_uppercut', 'illegal_knee', 'mutant_punch'],
    ['elbow_uppercut_combo', 'flying_knee_punch_combo', 'surprise_uppercut'],
  ),
  melee('kicks', 'Kicks', ['roundhouse_kick', 'side_kick', 'inside_crescent_kick', 'mma_kick', 'knee_kick_lead', 'flip_kick', 'scissor_kick'], ['hurricane_kick', 'flying_kick', 'spin_flip_kick', 'back_flip_to_uppercut', 'drop_kick', 'flying_bicycle_kick']),
  melee('blade', 'Blade', ['double_dagger_stab', 'stabbing', 'stable_sword_inward_slash', 'stable_sword_outward_slash', 'thrust_slash', 'slash_advance'], ['one_hand_sword_combo', 'dual_weapon_combo']),
  melee(
    'greatsword',
    'Greatsword',
    ['gs_great_sword_slash', 'gs_great_sword_slash_2', 'gs_great_sword_slash_3', 'gs_great_sword_slash_4', 'gs_great_sword_slash_5', 'gs_great_sword_attack', 'gs_great_sword_kick'],
    ['gs_great_sword_high_spin_attack', 'gs_great_sword_jump_attack', 'gs_great_sword_slide_attack', 'two_hand_sword_combo'],
    { block: ['gs_great_sword_blocking'], hit: ['gs_great_sword_impact'] },
  ),
  melee(
    'shield',
    'Sword and shield',
    ['ss_sword_and_shield_slash', 'ss_sword_and_shield_slash_2', 'ss_sword_and_shield_slash_3', 'ss_sword_and_shield_slash_4', 'ss_sword_and_shield_slash_5', 'ss_sword_and_shield_attack', 'ss_sword_and_shield_attack_2'],
    ['ss_sword_and_shield_attack_3', 'ss_sword_and_shield_attack_4', 'ss_sword_and_shield_kick'],
    { block: ['ss_sword_and_shield_block_idle'], hit: ['ss_sword_and_shield_impact'] },
  ),
  melee(
    'staff',
    'Axe or staff',
    ['axe_standing_melee_attack_horizontal', 'axe_standing_melee_attack_downward', 'axe_standing_melee_attack_backhand', 'axe_standing_melee_attack_kick_ver_1', 'axe_standing_melee_attack_kick_ver_2'],
    ['axe_standing_melee_attack_360_high', 'axe_standing_melee_attack_360_low', 'axe_standing_melee_combo_attack_ver_1', 'axe_standing_melee_combo_attack_ver_2', 'axe_standing_melee_combo_attack_ver_3'],
    { block: ['axe_standing_block_idle'], hit: ['axe_standing_block_react_large'] },
  ),
  // §4: club folds into the staff until it has its own clips; the bat swings give it its own
  melee('club', 'Club', ['one_hand_club_combo', 'club_swing_single', 'club_swing_double', 'club_swing_strike', 'club_knee_jab'], ['two_hand_club_combo', 'club_swing_homerun']),
  // ranged styles (§4 LMB); the weapons carry their own locomotion (§12)
  {
    id: 'pistol',
    kind: 'ranged',
    label: 'Pistol',
    roles: carried('pistol', {
      idle: ['pistol_idle'],
      aimIdle: ['pistol_aim_idle', 'pistol_ready_alert', 'pistol_idle'],
      walk: ['pistol_walk', 'pistol_aim_walk'],
      run: ['pistol_run', 'pistol_aim_run'],
      sprint: ['pistol_running', 'pistol_run'],
      strafeLeft: ['pistol_strafe_left', 'pistol_aim_strafe_left'],
      strafeRight: ['pistol_strafe_right', 'pistol_aim_strafe_right'],
      backpedal: ['pistol_walk_backward', 'pistol_run_backward', 'pistol_aim_walk_back'],
      crouch: ['pistol_kneeling_idle'],
      aimWalk: ['pistol_aim_walk', 'pistol_walk'],
      reload: ['pistol_reload_walking'],
      fire: ['shooting_pistol', 'pistol_fire', 'shooting_gun', 'gunplay', 'pistol_aim'],
      jump: ['pistol_jump', 'pistol_aim_jump', 'pistol_running_jump'],
      land: ['pistol_jump_2', 'pistol_jump'],
      switch: ['pistol_draw'],
    }),
  },
  {
    id: 'rifle',
    kind: 'ranged',
    label: 'Rifle',
    roles: carried('rifle', {
      idle: ['rifle_idle'],
      aimIdle: ['rifle_idle_aiming', 'rifle_aiming_idle'],
      walk: ['rifle_walk_forward'],
      run: ['rifle_run_forward'],
      sprint: ['rifle_sprint_forward'],
      strafeLeft: ['rifle_walk_left', 'rifle_run_left'],
      strafeRight: ['rifle_walk_right', 'rifle_run_right'],
      backpedal: ['rifle_walk_backward', 'rifle_run_backward'],
      crouch: ['rifle_idle_crouching', 'rifle_idle_crouching_aiming'],
      crouchWalk: ['rifle_walk_crouching_forward', 'rifle_crouch_walk'],
      prone: ['prone_idle'],
      crawl: ['prone_forward'],
      aimWalk: ['rifle_aim_walk'],
      reload: ['rifle_reload', 'rifle_reload_walking', 'rifle_reload_running', 'rifle_reload_crouching', 'rifle_reload_prone'],
      fire: ['firing_rifle', 'fire_rifle', 'shoot_rifle', 'crouch_rapid_fire'],
      jump: ['rifle_jump_up'],
      land: ['rifle_jump_down'],
      switch: ['rifle_pull_out', 'rifle_grab_from_back', 'rifle_put_away'],
    }),
  },
  { id: 'thrown', kind: 'ranged', label: 'Thrown', roles: { fire: { clips: [...CASTS.throws, 'frisbee_throw', 'throwing_dice', 'run_and_throw_grenade'] } } },
  { id: 'magic', kind: 'ranged', label: 'Magic, one- or two-handed', roles: { fire: { clips: ['fireball', ...CASTS.attack1h, ...CASTS.attack2h], min: 2 } } },
  // the spell families (§4 Q)
  spell('control', 'Control', [...CASTS.oneHand, ...CASTS.attack1h]),
  spell('displacement', 'Displacement', [...CASTS.attack2h, ...CASTS.twoHand]),
  spell('zone', 'Zone', [...CASTS.area, ...CASTS.twoHand]),
  spell('construct', 'Construct', [...CASTS.twoHand, ...CASTS.weapon]),
  spell('summon', 'Summon or deploy', ['casting_spell', 'spell_casting', 'magic_spell_casting', ...CASTS.throws]),
  spell('support', 'Ally support', ['magic_heal', ...CASTS.oneHand, ...CASTS.twoHand]),
  spell('curse', 'Curse', [...CASTS.attack1h, ...CASTS.oneHand]),
  spell('burst', 'Burst spell', ['fireball', ...CASTS.attack2h, ...CASTS.area]),
  spell('vision', 'Vision', [...CASTS.oneHand, ...CASTS.throws]),
  spell('trick', 'Trick', ['magic_standing_block_idle', ...CASTS.twoHand, ...CASTS.oneHand]),
  // traversal (§7, §12 gaps)
  move('mantle', 'Mantle', ['pulling_up_to_a_ledge', 'braced_hang_to_crouch', 'climbing_up_wall', 'step_up_to_jump_over_object']),
  move('ledgeClimb', 'Ledge climb', ['braced_hang_to_crouch', 'freehang_climb', 'pulling_up_to_a_ledge']),
  move('ledgeHang', 'Ledge hang', ['hanging_from_a_ledge_idle', 'braced_hang']),
  move('shimmyLeft', 'Shimmy left', ['left_braced_hang_shimmy', 'left_shimmy']),
  move('shimmyRight', 'Shimmy right', ['right_braced_hang_shimmy', 'right_shimmy']),
  move('drop', 'Drop down', ['braced_hang_drop_to_standing', 'freehang_drop', 'drop_to_freehang']),
  move('landRoll', 'Landing roll', ['falling_to_roll', 'run_to_rolling', 'sprinting_forward_roll']),
  move('hardLanding', 'Hard landing', ['mid_air_falling_to_a_hard_landing', 'falling_to_landing']),
  move('zipline', 'Zipline ride', ['hanging_by_hands_gently_swaying', 'moving_while_hanging', 'hanging']),
  move('wallRun', 'Wall run', ['diagonal_wall_run', 'wall_run_to_jump_pose', 'male_runs_up_a_wall_onto_a_platform']),
  move('vault', 'Vault', ['jump_over', 'step_up_to_jump_over_object']),
  // what every hero shares (§4)
  move('idle', 'Idle', ['idle'], 'shared'),
  move('walk', 'Walk', ['walk', 'walk_back', 'walk_left', 'walk_right'], 'shared'),
  move('jog', 'Jog', ['jog', 'jog_back', 'jog_left', 'jog_right'], 'shared'),
  move('sprint', 'Sprint', ['run', 'sprint_forward'], 'shared'),
  move('jump', 'Jump', ['jump', 'running_jump', 'jump_up'], 'shared'),
  move('doubleJump', 'Double jump', ['front_flip', 'stylish_flip', 'running_forward_flip', 'front_twist_flip'], 'shared'),
  move('fall', 'Fall', ['falling', 'falling_idle', 'fall_a_loop'], 'shared'),
  move('land', 'Land', ['landing', 'falling_to_landing', 'fall_a_land_to_standing_idle_01'], 'shared'),
  move('dodgeRoll', 'Dodge roll', ['sprinting_forward_roll', 'stand_to_roll', 'quick_roll_to_run', 'dive_roll'], 'shared'),
  move('crouchSlide', 'Crouch slide', ['running_slide_pose', 'running_slide'], 'shared'),
  move('dash', 'Dash', ['standing_dodge_forward'], 'shared'),
  move('crouch', 'Crouch', ['crouch_idle'], 'shared'),
  move('crouchWalk', 'Crouch walk', ['crouch_walk_forward', 'crouch'], 'shared'),
  move('prone', 'Prone', ['prone_idle'], 'shared'),
  move('crawl', 'Crawl', ['prone_forward'], 'shared'),
  move('hitHead', 'Hit to the head', ['hit_to_head', 'magic_standing_react_small_from_front'], 'shared'),
  move('hitBody', 'Hit to the body', ['hit_to_body', 'magic_standing_react_small_from_front'], 'shared'),
  move('hitBig', 'Big hit', ['big_hit_to_head', 'big_stomach_hit', 'big_side_hit', 'magic_standing_react_large_from_front'], 'shared'),
  move('knockdown', 'Knockdown', ['knocked_down', 'sweep_fall', 'shoulder_hit_and_fall'], 'shared'),
  move('getUp', 'Get up', ['getting_up', 'stand_up', 'inverted_double_kick_to_kip_up'], 'shared'),
  move('parry', 'Parry', ['inward_block', 'outward_block', 'high_center_block', 'blocking'], 'shared'),
  // the gacha pop-out: the hero arrives
  move('entrance', 'Entrance', ['swing_backflip_to_superhero_pose', 'male_cape_jump_down', 'male_hulking_giant_jump_down', 'jumping_down_from_higher_level'], 'shared'),
  { id: 'emote', kind: 'shared', label: 'Taunts and emotes', roles: { emote: { clips: ['taunt', 'standing_taunt_battlecry', 'standing_taunt_chest_thump', 'axe_standing_taunt_battlecry', 'dance_1', 'gesture_1', 'gesture_2'], min: 4 } } },
]

const BY_ID = new Map(COVERAGE.map((c) => [c.id, c]))
export const coverageOf = (id: string) => BY_ID.get(id)

/** Each role short of clips: the role, the clips the library has for it and how many it needs. */
export function missing(c: Coverage, has: (clip: string) => boolean): { role: string; have: string[]; need: number }[] {
  return Object.entries(c.roles).flatMap(([role, r]) => {
    const have = r.clips.filter(has)
    const need = r.min ?? 1
    return have.length >= need ? [] : [{ role, have, need }]
  })
}

/** A style the player may pick: the game offers it and the library holds its every clip. */
export const pickable = (c: Coverage, has: (clip: string) => boolean) => c.offered !== false && missing(c, has).length === 0

/** The clip a role plays: its first the library has. */
export const clipFor = (c: Coverage, role: string, has: (clip: string) => boolean) => c.roles[role]?.clips.find(has)
