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
export const STYLES = ['unarmed', 'kicks', 'blade', 'greatsword', 'shield', 'staff', 'club', 'rifle', 'pistol', 'magic', 'any'] as const
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
    punch_to_elbow_combo: 'Punch to elbow',
    knee_jabs_to_uppercut: 'Knees to uppercut',
    illegal_knee: 'Knee',
    mutant_punch: 'Hammer fist',
  }),
  ...m('heavy', 'unarmed', {
    elbow_uppercut_combo: 'Elbow uppercut',
    flying_knee_punch_combo: 'Flying knee',
    surprise_uppercut: 'Surprise uppercut',
  }),
  ...m('light', 'kicks', {
    roundhouse_kick: 'Roundhouse',
    side_kick: 'Side kick',
    inside_crescent_kick: 'Crescent kick',
    mma_kick: 'Low kick',
    knee_kick_lead: 'Knee, kick',
    flip_kick: 'Flip kick',
    scissor_kick: 'Scissor kick',
  }),
  ...m('heavy', 'kicks', {
    hurricane_kick: 'Hurricane kick',
    flying_kick: 'Flying kick',
    spin_flip_kick: 'Spinning flip kick',
    back_flip_to_uppercut: 'Backflip uppercut',
    drop_kick: 'Drop kick',
    flying_bicycle_kick: 'Bicycle kick',
  }),
  // melee, blades and clubs
  ...m('light', 'blade', {
    double_dagger_stab: 'Twin stab',
    stabbing: 'Stab',
    stable_sword_inward_slash: 'Inward slash',
    stable_sword_outward_slash: 'Outward slash',
    thrust_slash: 'Thrust',
    slash_advance: 'Advancing slash',
  }),
  ...m('heavy', 'blade', { one_hand_sword_combo: 'Sword combo', dual_weapon_combo: 'Twin blade combo' }),
  ...m('heavy', 'greatsword', { two_hand_sword_combo: 'Two-hand combo' }),
  ...m('light', 'club', { one_hand_club_combo: 'Club combo', club_swing_single: 'Club swing', club_swing_double: 'Double swing', club_swing_strike: 'Club strike', club_knee_jab: 'Swing and knees' }),
  ...m('heavy', 'club', { two_hand_club_combo: 'Two-hand club combo', club_swing_homerun: 'Home run' }),
  // melee, the weapon packs (the axe pack's moves stand in for a staff)
  ...m('light', 'greatsword', {
    gs_great_sword_slash: 'Great sword slash',
    gs_great_sword_slash_2: 'Rising slash',
    gs_great_sword_slash_3: 'Falling slash',
    gs_great_sword_slash_4: 'Backhand slash',
    gs_great_sword_slash_5: 'Sweeping slash',
    gs_great_sword_attack: 'Great sword cut',
    gs_great_sword_kick: 'Hilt kick',
  }),
  ...m('heavy', 'greatsword', { gs_great_sword_high_spin_attack: 'Spinning cleave', gs_great_sword_jump_attack: 'Leaping cleave', gs_great_sword_slide_attack: 'Sliding cut' }),
  ...m('spell', 'greatsword', { gs_great_sword_casting: 'Blade rite', gs_great_sword_power_up: 'Blade surge' }),
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
  ...m('spell', 'shield', { ss_sword_and_shield_casting: 'Oath', ss_sword_and_shield_casting_2: 'Rally', ss_sword_and_shield_power_up: 'Bulwark' }),
  ...m('light', 'staff', {
    axe_standing_melee_attack_horizontal: 'Staff sweep',
    axe_standing_melee_attack_downward: 'Staff strike',
    axe_standing_melee_attack_backhand: 'Backhand',
    axe_standing_melee_attack_kick_ver_1: 'Staff kick',
    axe_standing_melee_attack_kick_ver_2: 'Push kick',
  }),
  ...m('heavy', 'staff', {
    axe_standing_melee_attack_360_high: 'High whirl',
    axe_standing_melee_attack_360_low: 'Low whirl',
    axe_standing_melee_combo_attack_ver_1: 'Staff combo',
    axe_standing_melee_combo_attack_ver_2: 'Staff flurry',
    axe_standing_melee_combo_attack_ver_3: 'Staff onslaught',
  }),
  ...m('ultimate', 'staff', { axe_standing_melee_run_jump_attack: 'Vaulting strike' }),
  ...m('passive', 'staff', { axe_standing_taunt_battlecry: 'Staff cry', axe_standing_taunt_chest_thump: 'Staff thump' }),
  // ranged
  ...m('ranged', 'pistol', { shooting_pistol: 'Pistol shot', shooting_gun: 'Gun shot', gunplay: 'Gunplay', pistol_aim: 'Aimed shot' }),
  ...m('ranged', 'rifle', { firing_rifle: 'Rifle fire', fire_rifle: 'Rifle shot', shoot_rifle: 'Rifle burst', crouch_rapid_fire: 'Rapid fire' }),
  ...m('light', 'rifle', { rifle_punch: 'Rifle butt', bayonet_stab: 'Bayonet', rifle_turn_and_kick: 'Turn and kick' }),
  ...m('heavy', 'pistol', { pistol_whip: 'Pistol whip' }),
  ...m('ranged', 'any', {
    throw: 'Throw',
    throwing: 'Overhand throw',
    throw_object: 'Hurl',
    throw_grenade: 'Grenade',
    grenade_throw: 'Lobbed grenade',
    run_and_throw_grenade: 'Running throw',
    frisbee_throw: 'Disc throw',
    throwing_dice: 'Dice throw',
  }),
  ...m('ranged', 'magic', {
    fireball: 'Fireball',
    magic_standing_1h_magic_attack_01: 'Bolt',
    magic_standing_1h_magic_attack_02: 'Flick bolt',
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
    spell_casting: 'Incantation',
    two_hand_spell_casting: 'Two-hand cast',
    wide_arm_spell_casting: 'Wide cast',
    magic_spell_casting: 'Weave',
    magic_standing_1h_cast_spell_01: 'One-hand rite',
    magic_standing_2h_cast_spell_01: 'Two-hand rite',
  }),
  // movement
  ...m('movement', 'any', {
    charge: 'Charge',
    sprinting_forward_roll: 'Sprinting roll',
    running_dive_roll: 'Diving roll',
    dive_roll: 'Dive roll',
    aerial_evade: 'Aerial evade',
    corkscrew_evade: 'Corkscrew',
    big_jump: 'Great leap',
    sprint_to_backslide: 'Backslide',
  }),
  // ultimates
  ...m('ultimate', 'any', {
    mutant_jump_attack: 'Crashing leap',
    jump_attack: 'Leaping strike',
    flying_shoulder_throw: 'Shoulder throw',
    shoulder_throw_aggressor: 'Throw down',
    knock_off_assailant: 'Shake off',
    capoeira: 'Capoeira',
  }),
  ...m('ultimate', 'magic', { magic_standing_2h_magic_area_attack_01: 'Ground burst', magic_standing_2h_magic_area_attack_02: 'Nova' }),
  // passive toggles
  ...m('passive', 'any', { standing_taunt_battlecry: 'Battle cry', standing_taunt_chest_thump: 'Chest thump', taunt: 'Taunt' }),
  // the body's own moves
  ...m('dodge', 'any', {
    standing_dodge_forward: 'Dodge forward',
    standing_dodge_backward: 'Dodge back',
    standing_dodge_left: 'Dodge left',
    standing_dodge_right: 'Dodge right',
    stand_to_roll: 'Roll',
    quick_roll_to_run: 'Quick roll',
    backflip: 'Backflip',
  }),
  // guards that hold: each weapon's own, then bare hands'
  ...m('block', 'greatsword', { gs_great_sword_blocking: 'Blade guard' }),
  ...m('block', 'shield', { ss_sword_and_shield_block_idle: 'Shield guard', ss_sword_and_shield_crouch_block_idle: 'Low shield guard' }),
  ...m('block', 'staff', { axe_standing_block_idle: 'Staff guard' }),
  ...m('block', 'magic', { magic_standing_block_idle: 'Ward' }),
  ...m('block', 'any', { standing_block_idle: 'Guard', blocking: 'Block' }),
  ...m('react', 'any', { standing_block_start: 'Guard up', standing_block_end: 'Guard down', standing_block_react_large: 'Guard hit', body_block: 'Body block', hit_to_head: 'Hit to head', hit_to_body: 'Hit to body', big_hit_to_head: 'Big hit to head', big_stomach_hit: 'Big hit to gut', big_side_hit: 'Big side hit', receiving_a_big_uppercut: 'Rocked' }),
  ...m('knockdown', 'any', {
    knocked_down: 'Knocked down',
    getting_up: 'Getting up',
    stand_up: 'Stand up',
    inverted_double_kick_to_kip_up: 'Kip up',
    fall_a_loop: 'Falling',
    fall_a_land_to_standing_idle_01: 'Land',
    falling_to_roll: 'Land in a roll',
    falling_to_landing: 'Hard landing',
    sweep_fall: 'Swept',
    shoulder_hit_and_fall: 'Spun down',
    flying_back_death: 'Blown back',
    falling_back_death: 'Falls back',
    getting_thrown: 'Thrown',
  }),
  ...m('jump', 'any', { jump: 'Jump', running_jump: 'Running jump', jump_up: 'Jump up' }),
  ...m('move', 'any', {
    sprint_forward: 'Sprint',
    sprint_forward_left: 'Sprint left',
    sprint_forward_right: 'Sprint right',
    sprint_backward: 'Sprint back',
    idle_to_sprint: 'Burst',
    crouch_to_prone: 'Go prone',
    prone_to_crouch_transition: 'Up from prone',
    prone_idle: 'Prone',
    prone_forward: 'Crawl',
    crawl_backwards_in_prone: 'Crawl back',
    prone_left_turn: 'Prone turn left',
    prone_right_turn: 'Prone turn right',
    prone_roll: 'Prone roll',
    crouch_walk_forward: 'Crouch walk',
    crouch_walk_back: 'Crouch back',
    crouch_walk_left: 'Crouch left',
    crouch_walk_right: 'Crouch right',
    crouch_idle: 'Crouch',
    running_slide_pose: 'Slide',
    rifle_aiming_idle: 'Rifle aim',
    aiming_gun: 'Gun aim',
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
  dodge: { clip: 'sprinting_forward_roll', label: 'Dodge roll' },
  slide: { clip: 'running_slide_pose', label: 'Crouch slide' },
  dash: { clip: 'standing_dodge_forward', label: 'Dash ahead (Shift)' },
  move: { clip: 'jog', label: 'Move (jog)' },
  sprint: { clip: 'run', label: 'Sprint (run)' },
  prone: { clip: 'prone_idle', label: 'Prone' },
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
  { words: /\b(barricade|wall|shield|bulwark|fortify|fortress|rampart|block|guard|iron|skin|hide|unshaken|immovable|unbreakable|stone|armor|phalanx|aegis|bastion|cover)\b/, clips: ['ss_sword_and_shield_power_up', 'gs_great_sword_power_up', 'ss_sword_and_shield_casting_2'], kinds: ['spell'] },
  { words: /\b(heal|renew|mend|regen|recover|second-wind|sanctuary|blessing|benediction|cleanse|restore)\b/, clips: ['magic_heal'], kinds: ['spell'] },
  { words: /\b(throw|throwing|toss|hurl|hook|chain|bolas|knife|knives|kunai|grenade|dice|net|harpoon|shuriken)\b/, clips: ['throw', 'throwing', 'throw_object', 'grenade_throw', 'frisbee_throw', 'throwing_dice', 'throw_grenade'], kinds: ['ranged'] },
  { words: /\b(rifle|gun|shot|shoot|sniper|cannon|pistol|bullet|blaster|shotgun|nail-gun|rail)\b/, clips: ['firing_rifle', 'fire_rifle', 'shoot_rifle', 'shooting_gun', 'shooting_pistol', 'gunplay'], kinds: ['ranged'] },
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
