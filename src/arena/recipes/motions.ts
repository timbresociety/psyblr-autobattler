import type { Build } from '../../charter/build.js'
import { COMMON_MOTIONS, MOTION_SKILL, MOTION_SLOT_KINDS, fitOf, pickMotion, type MotionSlot, type Style } from '../../charter/motions.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import { CLIP_STYLE } from '../../charter/templates/styles.js'
import type { BuildSlot, MeleeStyle, RangedStyle, RoleId, SpellFamily, Template, TraverseKind } from '../../charter/types.js'
import { animIndexNow } from '../client/anim-index.js'
import type { MeleeBlow } from '../engine/combat.js'

/** How each role fights when neither its kit nor its look says (a build from before the rows). */
export const ROLE_STYLE: Record<RoleId, Style> = {
  tank: 'shield',
  fighter: 'unarmed',
  assassin: 'blade',
  mage: 'kicks',
  marksman: 'rifle',
  support: 'staff',
  controller: 'greatsword',
  summoner: 'club',
}

/** Roles that keep their range, and so carry their ranged weapon while they move (deliveries.ts isRanged). */
const KEEPS_RANGE = new Set<RoleId>(['mage', 'marksman', 'support', 'controller', 'summoner'])

/** The clips a ranged weapon's style plays (§4 LMB): guns their own, a thrown weapon anything, magic the magic set. */
const RANGED_CLIPS: Record<RangedStyle, Style> = { pistol: 'pistol', rifle: 'rifle', thrown: 'any', magic: 'magic', emitter: 'magic', paired: 'pistol', heavy: 'rifle', bow: 'bow' }

// V (§4): each family's own moves, picked by watching them, not by their names

/**
 * A melee family's moves: the chain (light, light, the finisher), the held heavy blow, the guard, a blow for each move
 * of the moveset (moveset.ts), and the flurry an R lock-on plays.
 */
export interface MeleeSet {
  chain: readonly [string, string, string]
  heavy: string
  block: string
  /** V at a sprint: a blow that travels. */
  dash: string
  /** V in the air (the legs hang under it). */
  air: string
  /** V held in the air: the plunge lands on it. */
  slam: string
  /** Back + V: a rising blow. */
  launcher: string
  /** V + X close in. */
  grab: string
  /** The R lock-on's string of hits. */
  flurry: string
}

const GRAB = 'grab_and_slam'

export const MELEE_SETS: Record<MeleeStyle, MeleeSet> = {
  // jab, cross, hook; the long hook, thrown from the hip, charges (the elbow combo's arms never reach out); the uppercut
  // lifts
  unarmed: {
    chain: ['lead_jab', 'cross_punch', 'hook_punch'],
    heavy: 'long_hook_punch_to_the_head',
    block: 'standing_block_idle',
    dash: 'flying_knee_punch_combo',
    air: 'mutant_punch',
    slam: 'mutant_jump_attack',
    launcher: 'uppercut',
    grab: GRAB,
    flurry: 'quad_punch',
  },
  kicks: {
    chain: ['mma_kick', 'roundhouse_kick', 'side_kick'],
    heavy: 'spinning_back_kick_advancing',
    block: 'standing_block_idle',
    dash: 'flying_kick',
    // a kick spun off the ground with no take-off or landing of its own: right in the air, where the body already is
    air: 'hurricane_kick',
    // the plunge lands on a driving rear-foot kick (the drop kick ended on all fours, turned off the aim)
    slam: 'male_thrust_kick_with_the_rear_foot',
    // the snap kicks rise into the body (the flip kick ended crouched, a metre off the spot)
    launcher: 'double_front_snap_kick',
    grab: GRAB,
    flurry: 'butterfly_kick_advancing',
  },
  blade: {
    chain: ['ual_sword_attack', 'stabbing', 'slash_advance'],
    heavy: 'one_hand_sword_combo',
    block: 'standing_block_idle',
    dash: 'thrust_slash',
    air: 'ss_sword_and_shield_attack',
    slam: 'jump_attack',
    launcher: 'ss_sword_and_shield_slash_3',
    grab: GRAB,
    flurry: 'dual_weapon_combo',
  },
  // both hands cut, inward then outward, then stab together
  paired: {
    chain: ['stable_sword_inward_slash', 'stable_sword_outward_slash', 'double_dagger_stab'],
    heavy: 'dual_weapon_combo',
    block: 'standing_block_idle',
    dash: 'slash_advance',
    air: 'ss_sword_and_shield_attack',
    slam: 'jump_attack',
    launcher: 'ss_sword_and_shield_slash_3',
    grab: GRAB,
    flurry: 'one_hand_sword_combo',
  },
  greatsword: {
    chain: ['gs_great_sword_slash', 'gs_great_sword_slash_4', 'gs_great_sword_slash_3'],
    heavy: 'two_hand_sword_combo',
    // the steady hold (the first blocking clip is a half-second raise, which looped popped twice a second)
    block: 'gs_great_sword_blocking_2',
    dash: 'gs_great_sword_slide_attack',
    air: 'gs_great_sword_high_spin_attack',
    slam: 'gs_great_sword_jump_attack',
    // the two-handed swing that comes up from behind the hip and on over the head (the pack's own second slash chops
    // down over the top: nothing of it rises into the target; kit check, 2026-11-13)
    launcher: 'club_swing_homerun',
    grab: GRAB,
    flurry: 'gs_great_sword_slash_5',
  },
  shield: {
    chain: ['ss_sword_and_shield_slash', 'ss_sword_and_shield_attack_4', 'ss_sword_and_shield_attack_3'],
    heavy: 'ss_sword_and_shield_slash_2',
    block: 'ss_sword_and_shield_block_idle',
    dash: 'ss_sword_and_shield_attack_2',
    air: 'ss_sword_and_shield_slash_4',
    slam: 'ss_sword_and_shield_attack',
    launcher: 'ss_sword_and_shield_slash_3',
    grab: GRAB,
    flurry: 'ss_sword_and_shield_slash_5',
  },
  // a pole in both hands: its end jabs and its shaft sweeps, then it whirls overhead (a long-hafted axe's high whirl,
  // both hands on the haft: the acrobat's twirl it had spun the body through the air with the pole in one hand)
  staff: {
    chain: ['rifle_butt_smash', 'rifle_punch', 'axe_standing_melee_attack_360_high'],
    heavy: 'gs_great_sword_high_spin_attack',
    block: 'standing_block_idle',
    // the pole swept low on the slide in (run_and_swing tumbles onto its back in the air)
    dash: 'gs_great_sword_slide_attack',
    air: 'gs_great_sword_slash_3',
    slam: 'jump_attack',
    launcher: 'club_swing_homerun',
    grab: GRAB,
    flurry: 'axe_standing_melee_combo_attack_ver_1',
  },
  // the bat swings, two-handed
  club: {
    chain: ['club_swing_single', 'club_swing_double', 'two_hand_club_combo'],
    heavy: 'heavy_weapon_swing',
    block: 'standing_block_idle',
    // the bat swung through from the run (the club strike stood three seconds with the bar at the hip, and the run and
    // swing tumbles onto its back in the air)
    dash: 'cmu_baseball_swing',
    air: 'jump_attack',
    slam: 'mutant_jump_attack',
    launcher: 'club_swing_homerun',
    grab: GRAB,
    flurry: 'one_hand_club_combo',
  },
  // chop and reap: the axe pack's own blows (its two kicks are no axe's)
  axe: {
    chain: ['axe_standing_melee_attack_downward', 'axe_standing_melee_attack_horizontal', 'axe_standing_melee_attack_backhand'],
    heavy: 'axe_standing_melee_attack_360_low',
    block: 'standing_block_idle',
    dash: 'axe_standing_melee_combo_attack_ver_1',
    air: 'axe_standing_melee_combo_attack_ver_3',
    slam: 'axe_standing_melee_run_jump_attack',
    // the rising two-handed swing (the high spin is flat at the hip: nothing of it lifts)
    launcher: 'club_swing_homerun',
    grab: GRAB,
    flurry: 'axe_standing_melee_combo_attack_ver_2',
  },
  // thrust, thrust and cut, a low driving thrust, both hands driving in; the lunge runs it through (the charge clip is
  // a pointed command, not a thrust, and the swordplay lunge lets go with one hand to swing overhead). The twin stab's
  // marked blow is its left hand's: the spear, in the right, pointed back over the shoulder on it (kit check,
  // 2026-11-13). The first thrust and the lunge hold the spear their own way in the hand (characters.ts HOLDS)
  spear: {
    chain: ['gs_great_sword_attack', 'thrust_slash', 'ss_sword_and_shield_attack'],
    heavy: 'bayonet_stab',
    block: 'standing_block_idle',
    dash: 'ss_sword_and_shield_attack_2',
    air: 'stabbing',
    slam: 'jump_attack',
    launcher: 'club_swing_homerun',
    grab: GRAB,
    flurry: 'one_hand_sword_combo',
  },
  // a lash from the shoulder, a crack across, a whole-arm cast; the heavy whirls it overhead
  whip: {
    chain: ['bash', 'mutant_punch', 'goalie_throw'],
    heavy: 'russian_kettlebell_swing',
    block: 'standing_block_idle',
    // a one-arm cut carried forward
    dash: 'slash_advance',
    air: 'throw',
    slam: 'jump_attack',
    launcher: 'uppercut',
    grab: GRAB,
    // one arm lashing again and again
    flurry: 'one_hand_club_combo',
  },
}

// LMB (§4): each grip fires its own way, and each way of firing looks like itself

/** The grip a shot's clips come from: a ranged style, with magic split by how many hands cast it. */
export type ShotGrip = Exclude<RangedStyle, 'magic'> | 'magic1' | 'magic2'
/** How a weapon fires, for its clip: a beam or a held beam is `held`; a shot that's lobbed arcs from its own throw. */
export type ShotWay = 'single' | 'burst' | 'auto' | 'spread' | 'held' | 'charge' | 'lobbed'

/** The shots, by grip and way of firing, best first; a way a grip has no clip for fires its single shot. */
export const SHOT_CLIPS: Record<ShotGrip, Partial<Record<ShotWay, readonly string[]>> & { single: readonly string[] }> = {
  // the gun raised and fired; quick snaps for a burst or full auto (shooting_pistol peeked round cover, gun at the face)
  pistol: { single: ['pistol_fire'], burst: ['ual_pistol_shoot'], auto: ['ual_pistol_shoot'], spread: ['pistol_fire'], held: ['pistol_aim_idle'], charge: ['pistol_aim_idle'] },
  // the one-hand gun's shot with a gun in each hand: the off arm mirrors the main one half a beat behind, squared to the
  // front, each arm turned out to its own side, so the two fire in turn (heroes.ts akimboShot; the library has no two-gun shot)
  paired: { single: ['pistol_fire'], held: ['pistol_aim_idle'], charge: ['pistol_aim_idle'] },
  // the rifle raised to the eye and fired, standing on the aim's own legs (kit/anim/trims.ts CLIP_LEGS: the shot's own
  // legs ran on the spot, and firing_rifle never lifts the rifle from the hip)
  rifle: { single: ['shoot_rifle'], burst: ['shoot_rifle'], auto: ['shoot_rifle'], held: ['rifle_aiming_idle'], charge: ['rifle_aiming_idle'] },
  // braced low for its kick, on one knee
  // a launcher is fired standing, shouldered as the long gun is (the crouched burst dropped into a squat for one shot
  // and was up again within the second, the tube held out in front of the chest)
  heavy: { single: ['firing_rifle'], burst: ['firing_rifle'], auto: ['firing_rifle'], held: ['rifle_aiming_idle'], charge: ['rifle_aiming_idle'] },
  // a quick shot is the shot again from the draw it holds (the arrow-from-the-quiver clip let go half way to the string)
  bow: { single: ['standing_aim_recoil'], burst: ['standing_aim_recoil'], auto: ['standing_aim_recoil'], held: ['standing_aim_idle_01'], charge: ['standing_aim_overdraw'] },
  thrown: { single: ['throw'], burst: ['throwing'], auto: ['throw_object'], spread: ['throwing'], held: ['throwing'], charge: ['goalie_throw', 'throw'], lobbed: ['rifle_toss_grenade'] },
  // the wand thrust out at the target, every way it fires: the simple-spell clips cast with the left arm, raised, while
  // the wand hung in the right at the hip, and the third attack swept it down past the knee (kit check, 2026-11-13)
  magic1: { single: ['magic_standing_1h_magic_attack_01'], held: ['magic_standing_1h_magic_attack_01'], charge: ['magic_standing_1h_magic_attack_01'] },
  magic2: { single: ['magic_standing_2h_magic_attack_01'], burst: ['magic_standing_2h_magic_attack_01'], auto: ['magic_standing_2h_magic_attack_01'], spread: ['magic_standing_2h_magic_area_attack_02'], held: ['magic_standing_2h_magic_attack_03'], charge: ['magic_standing_2h_magic_attack_03'] },
  // both palms pushed out for a shot, and for a blast, a beam or a charge (owner, 2026-11-13: the wand's own thrust
  // made it one-hand magic without the wand, and a straight punch made it a brawler; the simple shot raised an arm 50
  // to 70 degrees over the target, and the push loop squatted on its heels leaning back)
  emitter: { single: ['magic_standing_2h_magic_attack_02'], spread: ['magic_standing_2h_magic_attack_03'], held: ['magic_standing_2h_magic_attack_03'], charge: ['magic_standing_2h_magic_attack_03'] },
}

type Shooting = Pick<Template, 'name' | 'delivery' | 'charge'> & { ranged?: Template['ranged'] }

/** The grip a ranged skill's shots come from, or undefined for one that isn't ranged. */
export function shotGrip(t: Shooting): ShotGrip | undefined {
  const style = shotStyleOf(t)
  if (!style) return undefined
  return style === 'magic' ? (t.ranged?.hands === 2 ? 'magic2' : 'magic1') : style
}

/** How a ranged skill fires, first match: held to charge, lobbed, a beam, a spread, a burst, full auto, else single. */
export function shotWay(t: Shooting): ShotWay {
  const mode = t.ranged?.mode
  if (t.charge) return 'charge'
  if (t.delivery.flight === 'lobbed') return 'lobbed'
  return mode === 'beam' || mode === 'channel' ? 'held' : mode === 'pellets' ? 'spread' : mode === 'burst' ? 'burst' : mode === 'auto' ? 'auto' : 'single'
}

/** The clips a ranged skill's shot plays, best first: its way's, then its grip's single shot. */
export function shotClips(t: Shooting): readonly string[] | undefined {
  const grip = shotGrip(t)
  if (!grip) return undefined
  const clips = SHOT_CLIPS[grip]
  return [...(clips[shotWay(t)] ?? []), ...clips.single]
}

// Q (§4): every shape inside a family casts its own way, so a stun and a root, or a wall and a portal, never look alike

export type CastShape =
  | 'parry' | 'substitute' | 'reflect' | 'absorb'
  | 'minions' | 'clone' | 'decoy'
  | 'wall' | 'barrier' | 'terrain' | 'portal' | 'turret' | 'trap' | 'totem'
  | 'swapHealth' | 'steal' | 'rewind' | 'copyKit' | 'possess'
  | 'stun' | 'root'
  | 'pull' | 'lift' | 'push'
  | 'revive' | 'shield' | 'heal'
  | 'curse' | 'zone' | 'vision'
  | 'charged' | 'bolt'

/** Q's clips by shape, best first; the second is for a hero whose LMB or V already plays the first. */
export const CAST_CLIPS: Record<CastShape, readonly string[]> = {
  // Counter: what the stance answers with
  parry: ['inward_block'],
  substitute: ['standing_dodge_backward'],
  // a ward held up for the bolt to glance off (the ward's start alone is half a second, gone before anything lands)
  reflect: ['magic_standing_block_idle', 'magic_standing_block_start'],
  absorb: ['high_center_block'],
  // Summon: hands raised to call them up; a clone's two hands shape it; a decoy is a flick
  minions: ['magic_spell_casting'],
  clone: ['two_hand_spell_casting'],
  decoy: ['spell_cast'],
  // Construct: the ground stamped up, a guard thrown out, the earth lifted, a door opened, a turret knelt down to and
  // built, a trap stamped in, a totem planted
  wall: ['stomp'],
  barrier: ['outward_block'],
  terrain: ['magic_standing_2h_magic_attack_05'],
  portal: ['wide_arm_spell_casting'],
  turret: ['ual_fixing_kneeling', 'ual_pickup_table'],
  trap: ['stomping'],
  // the blade driven into the ground where the totem stands (the shield's own cast turned the body 72 degrees off the aim)
  totem: ['gs_great_sword_casting', 'stomping'],
  // Trick
  swapHealth: ['magic_standing_2h_magic_attack_04'],
  steal: ['magic_standing_1h_magic_attack_03'],
  // a low lunge rising into the cast that turns it back (spell_casting faced 67 degrees off the aim); a hand thrown out
  // at the one it copies, or both drawing it in for a hero whose shot already throws that hand
  rewind: ['casting_spell', 'magic_standing_1h_cast_spell_01'],
  copyKit: ['magic_standing_1h_magic_attack_01', 'magic_standing_2h_cast_spell_01'],
  // a hand reached out and held on the one it takes
  possess: ['pointing_forward', 'taunt_gesture'],
  // Control: a stun slams an area; a root grips from a cast
  stun: ['magic_standing_2h_magic_area_attack_01'],
  root: ['magic_standing_2h_cast_spell_01'],
  // Displacement: a hook hauled in, a body heaved up, a push
  pull: ['throwing', 'magic_standing_2h_magic_attack_02'],
  lift: ['russian_kettlebell_swing', 'magic_standing_2h_magic_attack_04'],
  push: ['magic_standing_2h_magic_attack_02'],
  // Support
  revive: ['waving_with_both_hands'],
  shield: ['ss_sword_and_shield_casting_2'],
  heal: ['magic_heal'],
  curse: ['big_vegas_pointing_gesture'],
  zone: ['magic_standing_1h_cast_spell_01'],
  vision: ['magic_standing_2h_magic_area_attack_02'],
  // Burst: a charged blast builds in both hands; a bolt is thrown
  charged: ['magic_standing_2h_magic_attack_03', 'magic_standing_2h_magic_attack_05'],
  bolt: ['fireball'],
}

/** How an E skill moves the caster (§4 E): its traverse kind, else what its delivery does. */
export type MovementKind = TraverseKind | 'blink' | 'dash' | 'leap' | 'grapple'

/** E (§4): one clip per kind of moving, the same for every hero that moves that way. */
export const MOVEMENT_CLIPS: Record<MovementKind, readonly string[]> = {
  blink: ['ual_spell_simple_exit'],
  teleport: ['ual_spell_simple_enter'],
  // a quick step aside as the two change places (an evade that ends flat on the ground reads as a fall)
  swap: ['standing_dodge_left', 'corkscrew_evade'],
  dash: ['idle_to_sprint'],
  homing: ['flying_kick'],
  // a standing long jump: launched, carried, landed on the feet (the big jump dives into a roll)
  leap: ['cmu_standing_long_jump'],
  // reaching up for the line it fired
  grapple: ['jump_to_hang'],
  swing: ['start_swinging'],
  flight: ['flying'],
  glide: ['falling_in_the_air_idle'],
  // a climbing loop, hand over hand up the wall (no good as a mantle, which tops out; right for crawling up one)
  wallCrawl: ['climbing_up_wall'],
  // a dive away into the ground
  burrow: ['jump_away'],
  // sat astride, hands forward
  ride: ['ual_driving_loop'],
  wallRun: ['diagonal_wall_run'],
  combatRoll: ['dive_roll'],
  powerSlide: ['running_slide'],
  zipline: ['jumping_to_hanging'],
}

/** What an F aura changes (§4 F). */
export type AuraKind = 'numbers' | 'guard' | 'stealth' | 'state' | 'allies' | 'element'

/** F (§4): switching an aura on looks like what it changes. */
export const AURA_CLIPS: Record<AuraKind, readonly string[]> = {
  // powering up
  numbers: ['ss_sword_and_shield_power_up'],
  // a shield or a hide that answers blows: the guard comes up
  guard: ['standing_block_start'],
  // dropping low out of sight
  stealth: ['standing_idle_to_crouch'],
  state: ['axe_standing_taunt_chest_thump'],
  // rousing the team
  allies: ['male_cheering_with_two_fists_pump'],
  // the element roars up
  element: ['axe_standing_taunt_battlecry'],
}

/** The shape of an R (§4 R). */
export type UltimateShape = 'strike' | 'devastation' | 'domain' | 'rally' | 'rampage' | 'form' | 'giant' | 'fusion' | 'titan' | 'switch'

/** R (§4): each shape of the big moment starts its own way; the lock-on strikes with the family's own flurry. */
export const ULTIMATE_CLIPS: Record<UltimateShape, readonly string[]> = {
  strike: ['butterfly_kick_advancing', 'quad_punch'],
  devastation: ['jump_attack', 'axe_standing_melee_run_jump_attack', 'mutant_jump_attack'],
  domain: ['gs_great_sword_casting'],
  rally: ['rallying'],
  rampage: ['standing_taunt_battlecry'],
  // powering up into the form (the greatsword power-up barely moves in three seconds)
  form: ['ss_sword_and_shield_power_up', 'standing_taunt_battlecry'],
  giant: ['standing_taunt_chest_thump'],
  fusion: ['clap_while_standing'],
  titan: ['casting_spell'],
  switch: ['withdrawing_sword'],
}

const MOVING: Partial<Record<Template['delivery']['kind'], MovementKind>> = { blink: 'blink', dash: 'dash', leap: 'leap', grapple: 'grapple' }

/** How an E skill moves: a traverse names its way; otherwise its delivery's. */
export function movementKind(t: Pick<Template, 'delivery' | 'effects'>): MovementKind {
  const traverse = t.effects.find((e) => e.kind === 'traverse')
  return traverse?.kind === 'traverse' ? traverse.how : (MOVING[t.delivery.kind] ?? 'dash')
}

/**
 * What an F aura changes, first match: an element; anything given to allies; stealth; another state; a guard (a
 * shield, nothing but less damage taken, or an answer when hit); else numbers.
 */
export function auraKind(t: Pick<Template, 'effects' | 'trigger'>): AuraKind {
  const fx = t.effects
  if (fx.some((e) => e.kind === 'element')) return 'element'
  if (fx.some((e) => 'target' in e && (e.target === 'allies' || e.target === 'ally'))) return 'allies'
  if (fx.some((e) => e.kind === 'state' && e.type === 'stealth')) return 'stealth'
  if (fx.some((e) => e.kind === 'state')) return 'state'
  const buffs = fx.filter((e) => e.kind === 'buff')
  if (t.trigger === 'whenHit' || fx.some((e) => e.kind === 'shield') || (buffs.length && buffs.every((e) => e.kind === 'buff' && e.stat === 'damageReduction'))) return 'guard'
  return 'numbers'
}

/**
 * The shape of an R, first match: the lock-on, a fusion, growing giant, a form, the titan, a kit switch, a rally, a
 * lasting area, the caster's own power, else a blast.
 */
export function ultimateShape(t: Pick<Template, 'delivery' | 'effects'>): UltimateShape {
  const has = (kind: Template['effects'][number]['kind']) => t.effects.some((e) => e.kind === kind)
  if (has('lockon')) return 'strike'
  if (has('fuse')) return 'fusion'
  if (has('resize')) return 'giant'
  if (has('form')) return 'form'
  if (t.effects.some((e) => e.kind === 'summon' && e.what === 'titan')) return 'titan'
  if (has('kitSwitch')) return 'switch'
  if (has('revive') || t.effects.some((e) => (e.kind === 'heal' || e.kind === 'buff') && e.target === 'allies')) return 'rally'
  if (has('field') || has('terrain') || has('wall')) return 'domain'
  if (t.delivery.kind === 'self' && !has('damage')) return 'rampage'
  return 'devastation'
}

const PLACED = new Set<Template['effects'][number]['kind']>(['turret', 'trap', 'wall', 'barrier', 'terrain', 'portal'])

/**
 * A spell's family for its cast: anything it places is a Construct, and so is a "summon" that calls up nothing that
 * moves and acts (§4 Q moved turrets, traps and totems there from Summon, where some of the catalogue still files
 * them); else its own.
 */
export function castFamily(t: Pick<Template, 'family' | 'effects'>): SpellFamily | undefined {
  if (t.effects.some((e) => PLACED.has(e.kind))) return 'construct'
  return t.family === 'summon' && !t.effects.some((e) => e.kind === 'summon') ? 'construct' : t.family
}

/** A Q's shape inside its family (castFamily), by what it does; undefined for a spell with no family. */
export function castShape(t: Pick<Template, 'family' | 'effects' | 'charge'>): CastShape | undefined {
  const find = <K extends Template['effects'][number]['kind']>(kind: K) => t.effects.find((e): e is Extract<Template['effects'][number], { kind: K }> => e.kind === kind)
  const has = (kind: Template['effects'][number]['kind']) => !!find(kind)
  switch (castFamily(t)) {
    case 'counter': {
      const answer = find('counter')?.answer
      return answer === 'substitute' ? 'substitute' : answer === 'reflect' ? 'reflect' : answer === 'absorb' ? 'absorb' : 'parry'
    }
    case 'summon': {
      const what = find('summon')?.what
      return what === 'clone' ? 'clone' : what === 'decoy' ? 'decoy' : 'minions'
    }
    case 'construct':
      return (['wall', 'barrier', 'terrain', 'portal', 'turret', 'trap'] as const).find(has) ?? 'totem'
    case 'trick':
      return (['swapHealth', 'steal', 'rewind', 'copyKit'] as const).find(has) ?? 'possess'
    case 'control':
      return has('stun') ? 'stun' : 'root'
    case 'displacement':
      return has('pull') ? 'pull' : has('lift') ? 'lift' : 'push'
    case 'support':
      return has('revive') ? 'revive' : has('shield') ? 'shield' : 'heal'
    case 'curse':
      return 'curse'
    case 'zone':
      return 'zone'
    case 'vision':
      return 'vision'
    case 'burst':
      return t.charge ? 'charged' : 'bolt'
    default:
      return undefined
  }
}

/**
 * The clips a Q, E, F or R skill plays, best first, by its shape or kind (§4); an R lock-on strikes with `style`'s
 * flurry. None for the other slots.
 */
export function skillClips(t: Template, slot: BuildSlot, style?: Style): readonly string[] | undefined {
  if (slot === 'active2') {
    const shape = castShape(t)
    return shape && CAST_CLIPS[shape]
  }
  if (slot === 'movement') return MOVEMENT_CLIPS[movementKind(t)]
  if (slot === 'passive') return AURA_CLIPS[auraKind(t)]
  if (slot === 'ultimate') {
    const shape = ultimateShape(t)
    const flurry = shape === 'strike' && style && style in MELEE_SETS ? MELEE_SETS[style as MeleeStyle].flurry : undefined
    return flurry ? [flurry, ...ULTIMATE_CLIPS.strike] : ULTIMATE_CLIPS[shape]
  }
  return undefined
}

/**
 * The hero's melee style (§4 V): its look's when it names one (a dev or Forge override), else its melee template's,
 * else its role's. The combo, the heavy blow and the block are picked from it.
 */
export const styleOf = (build: Pick<Build, 'roleId' | 'look' | 'slots'>): Style => {
  const melee = templateOf(build, 'basic')?.style
  return build.look?.style ?? (melee ? CLIP_STYLE[melee] : ROLE_STYLE[build.roleId])
}

/**
 * How a ranged skill's weapon is held for its clips: its own style, except that the catalogue files its bows as rifles
 * (their damage and muzzle are a rifle's), so a skill named for a bow, not a crossbow, draws and looses as one.
 */
export function shotStyleOf(template: Pick<Template, 'name'> & { ranged?: { style: RangedStyle } }): RangedStyle | undefined {
  const style = template.ranged?.style
  return style === 'rifle' && /\b(long|short)?bow\b/i.test(template.name) ? 'bow' : style
}

/** The style the ranged weapon's clip is picked from. */
export const rangedStyleOf = (build: Pick<Build, 'roleId' | 'look' | 'slots'>): Style => {
  const template = templateOf(build, 'active1')
  const style = template && shotStyleOf(template)
  return style ? RANGED_CLIPS[style] : styleOf(build)
}

/**
 * The gun a hero moves with (§12 weapon-held locomotion): its look's when it names one, else a pistol or rifle on its
 * LMB when its role keeps its range; a melee role moves unarmed between swings.
 */
export function carriedStyle(build: Pick<Build, 'roleId' | 'look' | 'slots'>): Style | undefined {
  if (build.look?.style) return build.look.style
  const ranged = templateOf(build, 'active1')?.ranged
  return ranged && KEEPS_RANGE.has(build.roleId) && (ranged.style === 'rifle' || ranged.style === 'pistol') ? ranged.style : undefined
}

/** A slot's catalogue template, or undefined for one the catalogue doesn't know. */
export function templateOf(build: Pick<Build, 'slots'>, slot: BuildSlot) {
  const id = build.slots[slot]?.templateId
  try {
    return id ? getTemplate(id) : undefined
  } catch {
    return undefined
  }
}

/**
 * The hero's melee moves (MELEE_SETS): its style's, or the fists' for a style that isn't a melee family (a gun named
 * on its look), with the chain, the heavy blow and the guard its look names in their place.
 */
export function meleeSet(build: Pick<Build, 'roleId' | 'look' | 'slots'>): MeleeSet {
  const style = styleOf(build)
  const own = MELEE_SETS[style as MeleeStyle] ?? MELEE_SETS.unarmed
  const named = build.look?.motions
  if (!named) return own
  return {
    ...own,
    chain: [named.combo1 ?? own.chain[0], named.combo2 ?? own.chain[1], named.combo3 ?? own.chain[2]],
    heavy: named.heavy ?? own.heavy,
    block: named.block ?? own.block,
  }
}

const picked = new WeakMap<object, Record<MotionSlot, string | undefined>>()
const SKILL_SLOTS = ['active1', 'active2', 'ultimate'] as const

/**
 * The hero's own eight motions (MOTION_SLOTS): the combo, the heavy blow and the guard from its melee family
 * (meleeSet); the LMB's shot by its grip and way of firing (shotClips); Q's cast by its shape and R's by its own
 * (skillClips); its look's own in place of any of them. A skill's first clip that nothing else of the hero plays,
 * where the body has it. Worked out once per build and kept while the library's index stays the same.
 */
export function kitMotions(build: Build): Record<MotionSlot, string | undefined> {
  const known = picked.get(build)
  if (known) return known
  const combat = animIndexNow('standard')?.genders.m.sets.combat
  const has = (id: string) => !combat || id in combat
  const set = meleeSet(build)
  const style = styleOf(build)
  const out = { combo1: set.chain[0], combo2: set.chain[1], combo3: set.chain[2], heavy: set.heavy, block: set.block } as Record<MotionSlot, string | undefined>
  // the skills keep clear of every blow of the moveset too, so the R never swings the air attack
  const taken = new Set<string>([...set.chain, set.heavy, set.block, set.dash, set.air, set.slam, set.launcher, set.grab])
  for (const slot of SKILL_SLOTS) {
    const skill = MOTION_SKILL[slot]!
    const template = templateOf(build, skill)
    const own = build.look?.motions?.[slot]
    const clips = !template ? undefined : slot === 'active1' ? shotClips(template) : skillClips(template, skill, style)
    const ready = clips?.filter(has)
    const fit = fitOf(template, skill)
    const pick = own ?? ready?.find((c) => !taken.has(c)) ?? ready?.[0] ?? pickMotion(fit.kinds.length ? fit.kinds : MOTION_SLOT_KINDS[slot], slot === 'active1' ? rangedStyleOf(build) : style, `${build.heroName}/${build.slots[skill]?.templateId ?? slot}`, taken, combat ? has : undefined, fit.clips)
    if (pick) taken.add(pick)
    out[slot] = pick
  }
  if (combat) picked.set(build, out)
  return out
}

/**
 * The motion a skill plays: its own (kitMotions; the basic attack's is the combo's opener); for the passive's toggle,
 * its aura kind's, and for the movement skill, its way of moving's (one clip per kind, shared by every hero), the
 * shared ones (COMMON_MOTIONS) where the skill says nothing.
 */
export function skillMotion(build: Build, slot: BuildSlot): string | undefined {
  if (slot === 'passive' || slot === 'movement') {
    const template = templateOf(build, slot)
    return build.look?.motions?.[slot] ?? (template && skillClips(template, slot)?.[0]) ?? COMMON_MOTIONS[slot].clip
  }
  return kitMotions(build)[slot === 'basic' ? 'combo1' : slot]
}

/**
 * What a slot's skill is, as the tables above file it: `shot:emitter:single`, `cast:stun`, `move:leap`, `aura:element`,
 * `ult:form`. Undefined for a slot the catalogue doesn't know, and for V (its blows are its family's, MELEE_SETS). A
 * second source of clips keys its own by this (the development motion pack, motion-pack.ts PACK_SKILLS).
 */
export function skillKey(build: Pick<Build, 'slots' | 'look'>, slot: BuildSlot): string | undefined {
  return build.look?.kinds?.[slot] ?? templateKey(templateOf(build, slot), slot)
}

/** `skillKey` for a template in a slot. */
export function templateKey(t: Template | undefined, slot: BuildSlot): string | undefined {
  if (!t) return undefined
  if (slot === 'active1') {
    const grip = shotGrip(t)
    return grip && `shot:${grip}:${shotWay(t)}`
  }
  if (slot === 'active2') {
    const shape = castShape(t)
    return shape && `cast:${shape}`
  }
  if (slot === 'movement') return `move:${movementKind(t)}`
  if (slot === 'passive') return `aura:${auraKind(t)}`
  if (slot === 'ultimate') return `ult:${ultimateShape(t)}`
  return undefined
}

/** The clip a basic attack's blow plays: its move of the moveset's, the charged heavy blow, or its step of the chain. */
export function meleeClip(build: Build, blow: MeleeBlow): string {
  const set = meleeSet(build)
  if (blow.kind) return set[blow.kind]
  return blow.heavy !== undefined ? set.heavy : set.chain[Math.min(2, blow.step)]
}

/** The guard the hero holds while blocking. */
export const blockMotion = (build: Build): string => meleeSet(build).block
