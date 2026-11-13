import type { BuildSlot, Template } from './types.js'

/**
 * The combat motions (docs/plans/2026-11-01-combat-motion-plan.md): Mixamo's motion capture retargeted onto the Psyblr
 * Human (scripts/rpm-anim.ts, the `combat` set of public/anim/standard), each by its clip's name, with what it is for.
 * A skill plays its look's `motion`, or the catalogue's pick for its slot and the hero's fighting style (pickMotions).
 */

/**
 * What a motion is for. `light` and `heavy` are melee (a combo's steps and its charged blow), `ranged` shoots or
 * throws, `spell` casts in place, `movement` carries the body, `ultimate` is a big set piece, `passive` a short toggle
 * flourish; the rest are the body's own moves the engine plays (`dodge`, `block`, `react`, `knockdown`, `jump`, `move`).
 */
export type MotionKind = 'light' | 'heavy' | 'ranged' | 'spell' | 'movement' | 'ultimate' | 'passive' | 'dodge' | 'block' | 'react' | 'knockdown' | 'jump' | 'move'

/** How a hero fights: what it holds and how it strikes. `any` suits every style. */
export const STYLES = ['unarmed', 'kicks', 'blade', 'greatsword', 'shield', 'staff', 'club', 'paired', 'axe', 'spear', 'whip', 'rifle', 'pistol', 'bow', 'magic', 'any'] as const
export type Style = (typeof STYLES)[number]

export interface Motion {
  id: string
  label: string
  kind: MotionKind
  style: Style
}

const m = (kind: MotionKind, style: Style, entries: Record<string, string>): Motion[] => Object.entries(entries).map(([id, label]) => ({ id, label, kind, style }))

export const MOTIONS: readonly Motion[] = [
  // melee, unarmed
  ...m('light', 'unarmed', {
    lead_jab: 'Lead jab',
    jab_cross: 'Jab, cross',
    body_jab_cross: 'Body jab, cross',
    cross_punch: 'Cross',
    hook_punch: 'Hook',
    right_hook: 'Right hook',
    uppercut: 'Uppercut',
    uppercut_jab: 'Uppercut, jab',
    elbow_punch: 'Elbow',
    punch_combo: 'Punch combo',
    combo_punch: 'Combo punch',
    quad_punch: 'Four punches',
    short_hook_punch_to_the_head: 'Short hook',
    knee_jabs_to_uppercut: 'Knees to uppercut',
    elbow_uppercut_combo: 'Elbow uppercut',
    illegal_knee: 'Knee',
  }),
  ...m('heavy', 'unarmed', {
    flying_knee_punch_combo: 'Flying knee',
    long_hook_punch_to_the_head: 'Long hook',
  }),
  ...m('light', 'kicks', {
    roundhouse_kick: 'Roundhouse',
    side_kick: 'Side kick',
    male_thrust_kick_with_the_lead_foot: 'Lead thrust kick',
    mma_kick: 'Low kick',
    knee_kick_lead: 'Knee, kick',
    double_front_snap_kick: 'Double snap kick',
  }),
  ...m('heavy', 'kicks', {
    roundhouse_kick_with_the_rear_foot: 'Rear roundhouse',
    flying_kick: 'Flying kick',
    martelo_2: 'Martelo',
    '360_leg_sweep_kick': 'Leg sweep',
    male_thrust_kick_with_the_rear_foot: 'Rear thrust kick',
    standing_melee_kick: 'Standing kick',
  }),
  // melee, blades and clubs
  // a one-hand edge cuts wide and stabs; a pair of short blades fights close, inside and outside the guard
  ...m('light', 'blade', { ual_sword_attack: 'Diagonal cut', stabbing: 'Stab', slash_advance: 'Advancing slash' }),
  ...m('heavy', 'blade', { one_hand_sword_combo: 'Sword combo' }),
  ...m('light', 'paired', { stable_sword_inward_slash: 'Inward slash', stable_sword_outward_slash: 'Outward slash', double_dagger_stab: 'Twin stab' }),
  ...m('heavy', 'paired', { dual_weapon_combo: 'Twin blade combo' }),
  ...m('heavy', 'greatsword', { two_hand_sword_combo: 'Two-hand combo' }),
  // smash: the two-handed bat swings, for the maul
  ...m('light', 'club', { club_swing_single: 'Club swing', club_swing_double: 'Double swing', two_hand_club_combo: 'Two-hand club combo', one_hand_club_combo: 'Club combo' }),
  ...m('heavy', 'club', { heavy_weapon_swing: 'Ground smash', club_swing_homerun: 'Home run' }),
  // a pole held in both hands: the staff jabs with its end, sweeps its shaft and spins; the spear thrusts
  ...m('light', 'staff', { rifle_butt_smash: 'End jab', rifle_punch: 'Shaft strike', butterfly_twirl: 'Spinning sweep' }),
  ...m('light', 'spear', { gs_great_sword_attack: 'Thrust', thrust_slash: 'Thrust and sweep', bayonet_stab: 'Lunging impale' }),
  // a lash: rising, overhead and wound-up cracks of the arm, and a flail swung round in both hands
  ...m('light', 'whip', { bash: 'Rising lash', mutant_punch: 'Overhead crack', goalie_throw: 'Wound-up crack' }),
  ...m('heavy', 'whip', { russian_kettlebell_swing: 'Flail swing' }),
  // melee, the weapon packs (the axe pack chops and reaps)
  ...m('light', 'greatsword', {
    gs_great_sword_slash: 'Great sword slash',
    gs_great_sword_slash_2: 'Rising slash',
    gs_great_sword_slash_3: 'Falling slash',
    gs_great_sword_slash_4: 'Backhand slash',
    gs_great_sword_slash_5: 'Sweeping slash',
    gs_great_sword_kick: 'Hilt kick',
  }),
  ...m('heavy', 'greatsword', { gs_great_sword_jump_attack: 'Leaping cleave', gs_great_sword_slide_attack: 'Sliding cut' }),
  ...m('heavy', 'staff', { gs_great_sword_high_spin_attack: 'Spinning strike' }),
  ...m('spell', 'greatsword', { gs_great_sword_casting: 'Blade rite' }),
  ...m('light', 'shield', {
    ss_sword_and_shield_slash: 'Shield slash',
    ss_sword_and_shield_slash_2: 'Low slash',
    ss_sword_and_shield_slash_3: 'High slash',
    ss_sword_and_shield_slash_4: 'Return slash',
    ss_sword_and_shield_slash_5: 'Overhead slash',
    ss_sword_and_shield_attack: 'Shield cut',
    ss_sword_and_shield_attack_2: 'Lunge',
  }),
  ...m('heavy', 'shield', { ss_sword_and_shield_attack_3: 'Driving cut', ss_sword_and_shield_attack_4: 'Shield combo', ss_sword_and_shield_kick: 'Shield kick' }),
  ...m('spell', 'shield', { ss_sword_and_shield_casting_2: 'Rally', ss_sword_and_shield_power_up: 'Bulwark' }),
  // chop and reap: the axe pack's chops and sweeps (its two kicks are no axe's blows, owner 2026-11-11)
  ...m('light', 'axe', {
    axe_standing_melee_attack_downward: 'Chop',
    axe_standing_melee_attack_horizontal: 'Reaping sweep',
    axe_standing_melee_attack_backhand: 'Backhand chop',
  }),
  ...m('heavy', 'axe', {
    axe_standing_melee_attack_360_low: 'Low reap',
    axe_standing_melee_attack_360_high: 'High whirl',
    axe_standing_melee_combo_attack_ver_1: 'Axe combo',
    axe_standing_melee_combo_attack_ver_2: 'Axe flurry',
    axe_standing_melee_combo_attack_ver_3: 'Axe onslaught',
  }),
  ...m('ultimate', 'axe', { axe_standing_melee_run_jump_attack: 'Leaping chop' }),
  ...m('passive', 'axe', { axe_standing_taunt_battlecry: 'Axe cry', axe_standing_taunt_chest_thump: 'Axe thump' }),
  // ranged
  ...m('ranged', 'pistol', { pistol_fire: 'Pistol shot', ual_pistol_shoot: 'Snap shot', pistol_aim: 'Aimed shot' }),
  ...m('ranged', 'rifle', { shoot_rifle: 'Rifle shot', firing_rifle: 'Rifle fire', crouch_rapid_fire: 'Rapid fire' }),
  ...m('ranged', 'bow', { standing_aim_recoil: 'Loose', shooting_arrow: 'Draw and loose', standing_draw_arrow: 'Nock' }),
  ...m('light', 'rifle', { rifle_turn_and_kick: 'Turn and kick' }),
  ...m('heavy', 'pistol', { hook_punch_with_the_rear_hand: 'Rear hook' }),
  ...m('ranged', 'any', {
    throw: 'Throw',
    throwing: 'Overhand throw',
    throw_object: 'Hurl',
    rifle_toss_grenade: 'Lobbed toss',
  }),
  ...m('ranged', 'magic', {
    fireball: 'Fireball',
    magic_standing_1h_magic_attack_01: 'Bolt',
    magic_standing_1h_magic_attack_03: 'Sidearm bolt',
    magic_standing_2h_magic_attack_01: 'Blast',
    magic_standing_2h_magic_attack_02: 'Pushing blast',
    magic_standing_2h_magic_attack_03: 'Hurled orb',
    magic_standing_2h_magic_attack_04: 'Twin bolts',
    magic_standing_2h_magic_attack_05: 'Overhead blast',
  }),
  // spells
  ...m('spell', 'magic', {
    magic_heal: 'Heal',
    casting_spell: 'Casting',
    spell_cast: 'Spell',
    two_hand_spell_casting: 'Two-hand cast',
    wide_arm_spell_casting: 'Wide cast',
    magic_spell_casting: 'Weave',
    magic_standing_1h_cast_spell_01: 'One-hand rite',
    magic_standing_2h_cast_spell_01: 'Two-hand rite',
  }),
  // movement
  ...m('movement', 'any', {
    running_dive_roll: 'Diving roll',
    dive_roll: 'Dive roll',
    aerial_evade: 'Aerial evade',
    corkscrew_evade: 'Corkscrew',
    sprint_to_backslide: 'Backslide',
  }),
  // ultimates
  ...m('ultimate', 'any', {
    mutant_jump_attack: 'Crashing leap',
    jump_attack: 'Leaping strike',
  }),
  ...m('ultimate', 'magic', { magic_standing_2h_magic_area_attack_01: 'Ground burst', magic_standing_2h_magic_area_attack_02: 'Nova' }),
  // passive toggles
  ...m('passive', 'any', { standing_taunt_battlecry: 'Battle cry', standing_taunt_chest_thump: 'Chest thump', taunt: 'Taunt' }),
  // the body's own moves
  ...m('dodge', 'any', {
    standing_dodge_backward: 'Dodge back',
    standing_dodge_left: 'Dodge left',
    standing_dodge_right: 'Dodge right',
    stand_to_roll: 'Roll',
    quick_roll_to_run: 'Quick roll',
    backflip: 'Backflip',
  }),
  // guards that hold: each weapon's own, then bare hands'
  ...m('block', 'greatsword', { gs_great_sword_blocking_2: 'Blade guard' }),
  ...m('block', 'shield', { ss_sword_and_shield_block_idle: 'Shield guard', ss_sword_and_shield_crouch_block_idle: 'Low shield guard' }),
  ...m('block', 'staff', { axe_standing_block_idle: 'Staff guard' }),
  ...m('block', 'magic', { magic_standing_block_idle: 'Ward' }),
  ...m('block', 'any', { standing_block_idle: 'Guard' }),
  ...m('react', 'any', { standing_block_start: 'Guard up', standing_block_end: 'Guard down', standing_block_react_large: 'Guard hit', body_block: 'Body block', receiving_a_medium_hit_to_the_head_from_a_left: 'Hit to head', hit_to_body: 'Hit to body', big_hit_to_head: 'Big hit to head', big_stomach_hit: 'Big hit to gut', big_side_hit: 'Big side hit', receiving_a_big_uppercut: 'Rocked' }),
  ...m('knockdown', 'any', {
    knocked_down: 'Knocked down',
    getting_up: 'Getting up',
    inverted_double_kick_to_kip_up: 'Kip up',
    fall_a_loop: 'Falling',
    fall_a_land_to_standing_idle_01: 'Land',
    falling_to_roll: 'Land in a roll',
    falling_to_landing: 'Hard landing',
    sweep_fall: 'Swept',
    shoulder_hit_and_fall: 'Spun down',
    falling_back_death: 'Falls back',
  }),
  ...m('jump', 'any', { unarmed_jump: 'Jump', running_jump: 'Running jump' }),
  ...m('move', 'any', {
    sprint: 'Sprint',
    sprint_backward: 'Sprint back',
    idle_to_sprint: 'Burst',
    crouch_to_prone: 'Go prone',
    prone_to_crouch_transition: 'Up from prone',
    prone_forward_stop: 'Prone',
    prone_forward: 'Crawl',
    crawling_backwards: 'Crawl back',
    prone_left_turn: 'Prone turn left',
    prone_roll: 'Prone roll',
    crouch_walk_forward: 'Crouch walk',
    crouch_walk_back: 'Crouch back',
    crouch_walk_left: 'Crouch left',
    crouch_walk_right: 'Crouch right',
    crouch_idle: 'Crouch',
    running_slide_pose: 'Slide',
    rifle_aiming_idle: 'Rifle aim',
  }),
]

const BY_ID = new Map(MOTIONS.map((x) => [x.id, x]))
export const motionOf = (id: string): Motion | undefined => BY_ID.get(id)

/**
 * The kit's motions (the canon, 2026-11-02), mutually exclusive and together the whole kit. Eight are the hero's own,
 * each its own clip: the three steps of the V combo (the third knocks back), the held heavy blow, the guard, Skill
 * 1's shot, Skill 2's spell and the ultimate. The rest are one clip for every hero (COMMON_MOTIONS): the passive's
 * toggle and the movement skill (their effects on the field tell them apart), and the body's own moves.
 */
export const MOTION_SLOTS = ['combo1', 'combo2', 'combo3', 'heavy', 'block', 'active1', 'active2', 'ultimate'] as const
export type MotionSlot = (typeof MOTION_SLOTS)[number]

export const MOTION_SLOT_TITLE: Record<MotionSlot, string> = {
  combo1: 'Combo, first strike',
  combo2: 'Combo, second strike',
  combo3: 'Combo finisher (knocks back)',
  heavy: 'Heavy blow (hold V)',
  block: 'Block',
  active1: 'Skill 1 shot',
  active2: 'Skill 2 spell',
  ultimate: 'Ultimate',
}

/** The kinds of motion each of the hero's own motions is picked from, best first. */
export const MOTION_SLOT_KINDS: Record<MotionSlot, readonly MotionKind[]> = {
  combo1: ['light'],
  combo2: ['light'],
  combo3: ['heavy', 'light'],
  heavy: ['heavy', 'light'],
  block: ['block'],
  active1: ['ranged', 'spell'],
  active2: ['spell', 'ranged'],
  ultimate: ['ultimate', 'heavy', 'spell'],
}

/** The build slot behind each of the hero's own motions that a skill fills. */
export const MOTION_SKILL: Partial<Record<MotionSlot, BuildSlot>> = { combo1: 'basic', active1: 'active1', active2: 'active2', ultimate: 'ultimate' }

/** The motions every hero shares, one clip each, and what each is for. */
export const COMMON_MOTIONS = {
  passive: { clip: 'spell_cast', label: 'Passive on and off (F)' },
  movement: { clip: 'idle_to_sprint', label: 'Movement skill (E)' },
  dodge: { clip: 'quick_roll_to_run', label: 'Dodge roll' },
  slide: { clip: 'running_slide_pose', label: 'Crouch slide' },
  dash: { clip: 'idle_to_sprint', label: 'Dash ahead (Shift)' },
  move: { clip: 'jog', label: 'Move (jog)' },
  sprint: { clip: 'run', label: 'Sprint (run)' },
  prone: { clip: 'prone_forward_stop', label: 'Prone' },
  crouch: { clip: 'crouch_idle', label: 'Crouch' },
} as const

/** The kinds of motion a slot plays, best first (the canon's slots: basic melee, Skill 1 ranged, Skill 2 a spell). */
export const SLOT_KINDS: Record<BuildSlot, readonly MotionKind[]> = {
  basic: ['light', 'heavy'],
  active1: ['ranged', 'spell'],
  active2: ['spell', 'ranged'],
  movement: ['movement', 'dodge'],
  passive: ['passive', 'spell'],
  ultimate: ['ultimate', 'heavy', 'spell', 'ranged'],
}

/** Words in a skill's name or tags that say what the body does, and the clips and kinds that show it, best first. */
const FITS: readonly { words: RegExp; clips?: readonly string[]; kinds: readonly MotionKind[] }[] = [
  // raising a wall or armour: the hero calls it up with its weapon raised (the guard itself is the Block's own motion)
  { words: /\b(barricade|wall|shield|bulwark|fortify|fortress|rampart|block|guard|iron|skin|hide|unshaken|immovable|unbreakable|stone|armor|phalanx|aegis|bastion|cover)\b/, clips: ['ss_sword_and_shield_power_up', 'ss_sword_and_shield_casting_2'], kinds: ['spell'] },
  { words: /\b(heal|renew|mend|regen|recover|second-wind|sanctuary|blessing|benediction|cleanse|restore)\b/, clips: ['magic_heal'], kinds: ['spell'] },
  { words: /\b(throw|throwing|toss|hurl|hook|chain|bolas|knife|knives|kunai|grenade|dice|net|harpoon|shuriken)\b/, clips: ['throw', 'throwing', 'throw_object'], kinds: ['ranged'] },
  { words: /\b(rifle|gun|shot|shoot|sniper|cannon|pistol|bullet|blaster|shotgun|nail-gun|rail)\b/, clips: ['shoot_rifle', 'pistol_fire', 'ual_pistol_shoot'], kinds: ['ranged'] },
  { words: /\b(rally|war-cry|cry|roar|bloodlust|rage|fury|taunt|focus|instinct|precision|aim)\b/, kinds: ['passive', 'spell'] },
  { words: /\b(slam|smash|stomp|quake|leap|crater|avalanche|meteor)\b/, clips: ['mutant_jump_attack', 'jump_attack', 'gs_great_sword_jump_attack', 'axe_standing_melee_run_jump_attack'], kinds: ['ultimate', 'heavy'] },
]

/** What a skill's delivery makes the body do, when its words don't say. */
const DELIVERY_KINDS: Partial<Record<Template['delivery']['kind'], readonly MotionKind[]>> = {
  melee: ['heavy', 'light'],
  cone: ['heavy', 'light'],
  projectile: ['ranged'],
  beam: ['ranged', 'spell'],
  zone: ['spell', 'ultimate'],
  aura: ['spell', 'passive'],
  self: ['spell', 'passive'],
  dash: ['movement', 'dodge'],
  blink: ['dodge', 'movement'],
  grapple: ['movement', 'ranged'],
  leap: ['movement', 'ultimate'],
}

/**
 * The clips and kinds of motion that fit what a skill does, best first: its words (a barricade braces behind a guard,
 * a heal casts a heal, a hook throws), then its delivery, then its slot's kinds. Basic attacks are melee whatever they
 * say (the canon).
 */
export function fitOf(template: Pick<Template, 'name' | 'tags' | 'delivery' | 'effects'> | undefined, slot: BuildSlot): { clips: string[]; kinds: MotionKind[] } {
  const slotKinds = SLOT_KINDS[slot]
  if (!template || slot === 'basic') return { clips: [], kinds: [...slotKinds] }
  const words = `${template.name} ${template.tags.join(' ')}`.toLowerCase()
  const clips: string[] = []
  const kinds: MotionKind[] = []
  const add = (k: readonly MotionKind[]) => k.forEach((x) => !kinds.includes(x) && kinds.push(x))
  // a movement skill moves the body, an ultimate is a set piece and a passive a flourish; what its words say comes after
  if (slot === 'movement') add(DELIVERY_KINDS[template.delivery.kind] ?? [])
  if (slot === 'ultimate' || slot === 'passive') add([slot])
  for (const fit of FITS) {
    if (!fit.words.test(words)) continue
    fit.clips?.forEach((c) => !clips.includes(c) && clips.push(c))
    add(fit.kinds)
  }
  if (template.effects.some((e) => e.kind === 'heal' && e.target !== 'self')) clips.includes('magic_heal') || clips.push('magic_heal')
  add(DELIVERY_KINDS[template.delivery.kind] ?? [])
  add(slotKinds)
  return { clips, kinds }
}

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * One motion of the first of `kinds` that has any: the hero's style first, then its nearest, then any, never one in
 * `taken`, picked by `seed` so it stays put between loads. `available` limits it to clips the library has.
 */
export function pickMotion(kinds: readonly MotionKind[], style: Style, seed: string, taken: ReadonlySet<string>, available?: (id: string) => boolean, clips: readonly string[] = []): string | undefined {
  // a clip the skill's words ask for by name comes first
  const named = clips.find((id) => BY_ID.has(id) && !taken.has(id) && (!available || available(id)))
  if (named) return named
  for (const kind of kinds) {
    // the hero's style, its nearest (fists for kicks and back), then anything
    for (const styles of [[style], [style === 'unarmed' ? 'kicks' : style === 'kicks' ? 'unarmed' : 'any'], ['any', 'magic'], STYLES] as (readonly Style[])[]) {
      const pool = MOTIONS.filter((x) => x.kind === kind && styles.includes(x.style) && !taken.has(x.id) && (!available || available(x.id)))
      if (pool.length) return pool[hash(seed) % pool.length].id
    }
  }
  return undefined
}

/** A motion for each slot that hasn't got one in `chosen` (pickMotion), never one another slot of the hero plays. */
export function pickMotions(
  style: Style,
  slots: readonly BuildSlot[],
  seedOf: (slot: BuildSlot) => string,
  chosen: Partial<Record<BuildSlot, string>> = {},
  available?: (id: string) => boolean,
  fit: (slot: BuildSlot) => { clips: readonly string[]; kinds: readonly MotionKind[] } = (slot) => ({ clips: [], kinds: SLOT_KINDS[slot] }),
): Record<BuildSlot, string | undefined> {
  const taken = new Set(Object.values(chosen).filter(Boolean) as string[])
  const out = {} as Record<BuildSlot, string | undefined>
  for (const slot of slots) {
    const f = chosen[slot] ? undefined : fit(slot)
    const pick = chosen[slot] ?? pickMotion(f!.kinds, style, seedOf(slot), taken, available, f!.clips)
    if (pick) taken.add(pick)
    out[slot] = pick
  }
  return out
}
