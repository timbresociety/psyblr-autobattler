import { BUILD_SLOTS, type Build } from '../../charter/build.js'
import { retuneFactor, scaleMagnitudes } from '../../charter/budget.js'
import { getRole } from '../../charter/roles.js'
import { SIZES, type SizeClass } from '../../charter/sizes.js'
import { deriveSheet } from '../../charter/stats.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { TraitMods } from '../../charter/traits.js'
import type { BuffStat, BuildSlot, ControlType, DamageType, DebuffType, SecondarySheet, Template } from '../../charter/types.js'
import { ENGINE, ticks } from './calibration.js'
import type { CoverHealth, CoverPiece } from './cover.js'
import type { Vec3 } from './maths.js'
import { aiSeed, rngState, type RngState } from './rng.js'
import type { AiLevel } from '../ai/calibration.js'

/**
 * Match state (KTD1): flat plain data, so it can be snapshotted, restored and hashed every tick. Everything that never
 * changes during a match (a hero's sheet and scaled kit) lives in `HeroSetup`, outside the state.
 */

export type Team = 0 | 1

/** One hero's input for one tick (KTD4). Aim is quantized so every platform reads the same angle. */
export interface Command {
  /** Desired horizontal direction in world space; the engine clamps its length to 1. */
  moveX: number
  moveZ: number
  /**
   * The movement buttons held (`MOVES`). Jump, crouch, prone and dodge act when first pressed; dash dashes when let go
   * quickly and sprints while held; block guards while held.
   */
  moves: number
  /** Aim in steps of a full turn (`AIM_STEPS` per turn). */
  aimYaw: number
  aimPitch: number
  /** Bit per slot in `BUILD_SLOTS` order, held this tick: the basic attack strikes when let go and charges when held. */
  buttons: number
}

export const AIM_STEPS = 4096
export const IDLE: Command = { moveX: 0, moveZ: 0, moves: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }
/** Bits of `Command.moves` (Forge goal, phase 2). */
export const MOVES = { jump: 1, dash: 2, crouch: 4, dodge: 8, prone: 16, block: 32 } as const
export const slotBit = (slot: BuildSlot) => 1 << BUILD_SLOTS.indexOf(slot)

export type Stat = BuffStat

/** Every kind of crowd control, at zero: the tick each one lasts until. */
export const noControl = (): Record<ControlType, number> => ({ root: 0, silence: 0, disarm: 0, sleep: 0, blind: 0, grounded: 0, fear: 0, taunt: 0, break: 0 })

export interface HeroState {
  id: number
  team: Team
  alive: boolean
  position: Vec3
  airborne: boolean
  /** Facing and aim, radians. */
  yaw: number
  pitch: number
  hp: number
  maxHp: number
  shield: number
  shieldUntil: number
  stunnedUntil: number
  invulnerableUntil: number
  /** `stat` `attack` slows basic attacks and fire rate (cripple); absent means movement. */
  slows: { pct: number; until: number; stat?: 'move' | 'attack' }[]
  /** Crowd control: the tick each kind lasts until (0 when never applied). */
  cc: Record<ControlType, number>
  /** Who a fear runs from and a taunt must attack (-1 when none). */
  fearFrom: number
  tauntBy: number
  /** Immune to crowd control and displacement until this tick. */
  unstoppableUntil: number
  /** Unseen by enemies until this tick, unless revealed; attacking ends it. */
  stealthUntil: number
  /** Weakening from enemies: flat resist down, more damage taken, less healing taken, marked for a team. */
  debuffs: { type: DebuffType; amount: number; until: number; source: number }[]
  /** Metres a second it moves: across the ground (x, z) and up or down (y). */
  velocity: Vec3
  /** Stamina pips, fractional while one refills: a dash or a jump in the air spends one (ENGINE.move). */
  stamina: number
  /** Jumps made in the air since it last stood on something. */
  airJumps: number
  /** The movement buttons held last tick, so a press counts once. */
  held: number
  /** A dash carries it until this tick. */
  dashUntil: number
  /** A slide in progress: from the tick it started until the tick it ends, along `x`, `z`. */
  slide?: { from: number; until: number; x: number; z: number }
  /** The tick it last landed. */
  landedAt: number
  /**
   * A knock-up in progress: launched at `from`, peaks at `height`, lands at `until`. A melee launch (`regain`) carries
   * the hero `push` metres a tick across the ground, and any input takes control back (combat.ts).
   */
  launch?: { from: number; until: number; height: number; base: number; regain?: boolean; push?: { x: number; z: number } }
  /** Standing, crouched or prone (C and Ctrl toggle them). */
  stance: 'stand' | 'crouch' | 'prone'
  /** Sprinting while Shift stays held; `shiftSince` is the tick Shift went down (-1 when up). */
  sprinting: boolean
  shiftSince: number
  /** A dodge roll in progress along `x`, `z`. */
  roll?: { from: number; until: number; x: number; z: number }
  /** Guarding this tick (X held, on the ground, not acting). */
  blocking: boolean
  /** The melee chain: the step the next strike takes (0, 1, then 2 the finisher), while a strike follows by `until`. */
  combo: { step: number; until: number }
  /** The tick the basic attack button went down (-1 when up); past the heavy hold it charges. */
  basicSince: number
  /** From this tick Skill 1's next shot carries the skill's rider (combat.ts, shotTemplate). */
  riderAt: number
  /** A strike tapped too early, waiting until this tick for the hero to be ready (combat.ts). */
  queued?: { until: number }
  /** Whether the passive is on (F toggles it), and its energy meter, 0 to 1 (§4 F: drains on, refills off). */
  passiveOn: boolean
  energy: number
  /**
   * The ranged weapon (§5): shots left in the magazine, the tick a reload ends (0 when none), the tick of the last shot,
   * the bloom the last shots built up (radians), and a burst's shots still to come.
   */
  ammo: number
  reloadUntil: number
  lastShot: number
  bloom: number
  burst?: { left: number; next: number }
  /** A melee lunge (§5 magnetism): the swing carries the body `x`, `z` metres a tick toward `target` until `until`. */
  lunge?: { x: number; z: number; until: number; target: number }
  /** Revealed by a vision spell until this tick: it can't hide, and shows through walls. */
  revealedUntil: number
  /** Enemy shots that reach it turn back on their shooter until this tick (a trick spell). */
  reflectUntil: number
  /** Its health every half second over the last five, oldest first, for a rewind. */
  hpTrail: number[]
  /** The slot buttons held last tick, so a press or a release counts once. */
  buttonsHeld: number
  /** `source` is the template that granted it; the same template refreshes its buff instead of stacking. */
  buffs: { stat: Stat; pct: number; until: number; source: string }[]
  dots: { perSecond: number; type: DamageType; until: number; source: number }[]
  hots: { perSecond: number; until: number }[]
  /** Ticks until each slot is ready. */
  cooldowns: Record<BuildSlot, number>
  nextAttackAt: number
  /**
   * The action in progress (Forge goal, phase 1): pressed at `started`, it lands at `release` and frees the hero at
   * `ends`. Control that lands first cuts it short, and what hasn't been released never lands.
   */
  action?: { slot: BuildSlot; started: number; release: number; ends: number; released: boolean; melee?: { step: number; heavy?: number }; shot?: { share: number; rider: boolean }; target?: number }
  chosenSize: SizeClass
  /** The current class, which a transformation can change until `formUntil` (KTD14). */
  size: SizeClass
  /** The tick a transformation ends, whether it changed the hero's size or kept it; 0 when untransformed. */
  formUntil: number
  /** An engine-computed displacement in progress (KTD3): metres per tick until `until`. */
  /** `grounded`: the hero was on the ground when hit, so it lands again when the knockback ends. */
  knockback?: { step: Vec3; until: number; grounded?: boolean }
  hitCount: number
  lowHealthFired: boolean
  damageDealt: number
  recentHeals: number[]
  passiveRegen: number
  damageBonus: number
}

export interface ProjectileState {
  id: number
  owner: number
  slot: BuildSlot
  position: Vec3
  /** Metres per tick. */
  step: Vec3
  ticksLeft: number
  /** A pellet's share of the weapon's blast (combat.ts, shotTemplate). */
  shot?: { share: number; rider: boolean }
  /** Whose kit the shot is, when a reflect turned it and `owner` is now the reflector. */
  source?: number
}

export interface MatchState {
  tick: number
  paused: boolean
  heroes: HeroState[]
  projectiles: ProjectileState[]
  nextProjectileId: number
  rules: RngState
  ai: RngState
  winner?: Team | 'draw'
  endReason?: 'wipe' | 'time'
  /** From this tick, damage ramps up by `perSecond` each second: steeply so gate duels end (KTD5), gently as live overtime. */
  damageRamp?: { fromTick: number; perSecond: number }
  /** Who is driving each hero; the AI skips human-controlled ones (KTD4). */
  human?: number
  /** Each AI hero's memory, kept in the state so AI play snapshots and replays exactly (KTD7). */
  brains?: BrainState[]
  /** Each side's AI level (GAME.md §2); Hard when absent, the level the balance gate plays at. */
  aiLevels?: readonly [AiLevel, AiLevel]
  /** The ruins on this map and each piece's health; absent on an open test floor. Walls raised by skills join it. */
  cover?: { pieces: readonly CoverPiece[]; health: CoverHealth[] }
  /** Lingering areas and traps left by skills, turrets, and the walls skills raised (with when they fall). */
  fields?: FieldState[]
  turrets?: TurretState[]
  walls?: { index: number; until: number }[]
  nextEntityId?: number
}

/** A lingering area or a trap: the template's effects land on whoever is inside, on a beat or on the first step. */
export interface FieldState {
  id: number
  owner: number
  slot: BuildSlot
  at: Vec3
  radius: number
  until: number
  /** Fields: the next pulse. Traps: armed from this tick. */
  next: number
  interval: number
  trap: boolean
  /** Fields cast as auras ride along with their owner. */
  follow: boolean
}

/** A construct that shoots the nearest enemy in sight on a beat. */
export interface TurretState {
  id: number
  owner: number
  slot: BuildSlot
  at: Vec3
  until: number
  next: number
  interval: number
  range: number
}

export interface BrainState {
  /** Tick of the next decision. */
  nextDecision: number
  target: number
  /** A new target is taken only after the reaction delay. */
  pending?: { target: number; at: number }
  action: 'approach' | 'hold' | 'dodge' | 'retreat'
  strafe: 1 | -1
  /** Until this tick, keep dodging along `dodge`. */
  dodgeUntil: number
  dodge: { x: number; z: number }
  /** Movement buttons (MOVES) to press with the next command: a dash or a jump decided between ticks. */
  press: number
  /** Not before this tick does it dash again to close a gap; it slides until `slideUntil` (Forge goal, phase 2). */
  nextDash: number
  slideUntil: number
  /** The skill it has decided to use, pressed once the aim settles. */
  cast?: { slot: 'movement' | 'ultimate' | 'active1' | 'active2'; escape: boolean }
  /** Where the hand is pointing now, radians; it lags, overshoots and settles on the target. */
  yaw: number
  pitch: number
  overshoot: number
  /** The target's last seen position, to lead moving targets. */
  seen?: { x: number; y: number; z: number; tick: number; target: number }
  /** Which way it walks around walls (R25): chosen at the first wall and kept, so corners do not turn it back; 0 before any. */
  detour: -1 | 0 | 1
  /** The spot behind cover it falls back to when retreating. */
  hide?: { x: number; z: number }
  /** This decision it charges its next basic attack into a heavy blow, and raises its guard against a swing it sees coming. */
  heavy: boolean
  guard: boolean
  /** This decision it keeps a melee chain going (its level's combo chance), and presses F once (the passive). */
  chain: boolean
  toggle: boolean
}

export interface HeroSetup {
  build: Build
  sheet: SecondarySheet
  kit: Record<BuildSlot, Template>
  powerScale: number
  /** What the army's traits give this hero (src/charter/traits.ts); nothing outside army fights. */
  mods: TraitMods
  /** The kit its zones, traps and turrets use: the kit scaled by its construct power, when it has any. */
  constructKit?: Record<BuildSlot, Template>
  /** Shots in a full magazine of its ranged weapon: the weapon's, by the sheet's ammo against the reference 12. */
  magazine: number
}

/** A derived sheet with trait multipliers and additions applied on top (they can pass the role's caps). */
function withMods(sheet: SecondarySheet, mods: TraitMods): SecondarySheet {
  if (!mods.mul && !mods.add) return sheet
  const out = { ...sheet }
  for (const [stat, pct] of Object.entries(mods.mul ?? {}) as [keyof SecondarySheet, number][]) out[stat] *= 1 + pct
  for (const [stat, plus] of Object.entries(mods.add ?? {}) as [keyof SecondarySheet, number][]) out[stat] += plus
  return out
}

export function prepareHero(build: Build, powerScale = 1, damageBonus = 0, mods: TraitMods = {}): HeroSetup & { damageBonus: number } {
  const sheet = withMods(deriveSheet(getRole(build.roleId), build.spread, build.sizeClass).sheet, mods)
  const kit = {} as Record<BuildSlot, Template>
  for (const slot of BUILD_SLOTS) {
    const spec = build.slots[slot]
    kit[slot] = scaleMagnitudes(getTemplate(spec.templateId), retuneFactor(spec.retuneSteps) * powerScale)
  }
  const constructKit = mods.constructPower ? (Object.fromEntries(BUILD_SLOTS.map((s) => [s, scaleMagnitudes(kit[s], 1 + mods.constructPower!)])) as Record<BuildSlot, Template>) : undefined
  const magazine = Math.max(2, Math.round((kit.active1.ranged?.magazine ?? 10) * (sheet.ammo / ENGINE.ammoReference)))
  return { build, sheet, kit, powerScale, damageBonus, mods, magazine, ...(constructKit ? { constructKit } : {}) }
}

export function createHero(setup: HeroSetup & { damageBonus?: number }, id: number, team: Team, position: Vec3): HeroState {
  const size = setup.build.sizeClass ?? 'medium'
  const cooldowns = Object.fromEntries(BUILD_SLOTS.map((s) => [s, 0])) as Record<BuildSlot, number>
  return {
    id, team, alive: true, position: { ...position }, airborne: position.y > 0, yaw: team === 0 ? 0 : Math.PI, pitch: 0,
    hp: setup.sheet.maxHealth, maxHp: setup.sheet.maxHealth, shield: 0, shieldUntil: 0, stunnedUntil: 0, invulnerableUntil: 0,
    slows: [], buffs: [], dots: [], hots: [], cooldowns, nextAttackAt: 0, chosenSize: size, size, formUntil: 0,
    cc: noControl(), fearFrom: -1, tauntBy: -1, unstoppableUntil: 0, stealthUntil: setup.mods?.stealthStart ? ticks(setup.mods.stealthStart) : 0, debuffs: [], landedAt: 0,
    velocity: { x: 0, y: 0, z: 0 }, stamina: ENGINE.move.stamina.max, airJumps: 0, held: 0, dashUntil: 0,
    stance: 'stand', sprinting: false, shiftSince: -1, blocking: false, combo: { step: 0, until: 0 }, basicSince: -1, riderAt: 0, passiveOn: false, energy: 1, buttonsHeld: 0,
    ammo: setup.magazine ?? 10, reloadUntil: 0, lastShot: -9999, bloom: 0, revealedUntil: 0, reflectUntil: 0, hpTrail: [],
    hitCount: 0, lowHealthFired: false, damageDealt: 0, recentHeals: [], passiveRegen: 0, damageBonus: setup.damageBonus ?? 0,
  }
}

export function emptyMatch(seed: number): MatchState {
  return { tick: 0, paused: false, heroes: [], projectiles: [], nextProjectileId: 1, rules: rngState(seed), ai: rngState(aiSeed(seed)) }
}

/** The capsule a hero occupies now: base at its feet. */
/** The body that bumps into walls: the hit capsule's radius, capped so big heroes still fit through gaps. */
export const bodyRadius = (hero: HeroState) => Math.min(ENGINE.bodyRadiusCap, capsule(hero).radius)

/**
 * The hit capsule: the medium one scaled by the size class's body, so it matches the model the audience sees (R23).
 * A sliding hero is down low (ENGINE.move.slide.height of its height).
 */
export function capsule(hero: HeroState): { radius: number; height: number } {
  const scale = SIZES[hero.size].scale
  const low = hero.slide ? ENGINE.move.slide.height : hero.stance === 'prone' ? ENGINE.move.prone.height : hero.stance === 'crouch' ? ENGINE.move.crouch.height : 1
  return { radius: ENGINE.capsule.radius * scale, height: ENGINE.capsule.height * scale * low }
}
