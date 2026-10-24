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
  /** Fly up (1), down (-1) or hold (0). */
  vertical: -1 | 0 | 1
  /** Aim in steps of a full turn (`AIM_STEPS` per turn). */
  aimYaw: number
  aimPitch: number
  /** Bit per slot in `BUILD_SLOTS` order: pressed this tick. */
  buttons: number
}

export const AIM_STEPS = 4096
export const IDLE: Command = { moveX: 0, moveZ: 0, vertical: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }
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
  /** The flight meter: taking off and staying up spend it, standing on the ground refills it. */
  flight: number
  /** The tick it last touched the ground, for the meter's refill delay. */
  landedAt: number
  /** A knock-up in progress: launched at `from`, peaks at `height`, lands at `until`. */
  launch?: { from: number; until: number; height: number; base: number }
  /** `source` is the template that granted it; the same template refreshes its buff instead of stacking. */
  buffs: { stat: Stat; pct: number; until: number; source: string }[]
  dots: { perSecond: number; type: DamageType; until: number; source: number }[]
  hots: { perSecond: number; until: number }[]
  /** Ticks until each slot is ready. */
  cooldowns: Record<BuildSlot, number>
  nextAttackAt: number
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
  dodge: { x: number; z: number; vertical: -1 | 0 | 1 }
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
  return { build, sheet, kit, powerScale, damageBonus, mods, ...(constructKit ? { constructKit } : {}) }
}

export function createHero(setup: HeroSetup & { damageBonus?: number }, id: number, team: Team, position: Vec3): HeroState {
  const size = setup.build.sizeClass ?? 'medium'
  const cooldowns = Object.fromEntries(BUILD_SLOTS.map((s) => [s, 0])) as Record<BuildSlot, number>
  return {
    id, team, alive: true, position: { ...position }, airborne: position.y > 0, yaw: team === 0 ? 0 : Math.PI, pitch: 0,
    hp: setup.sheet.maxHealth, maxHp: setup.sheet.maxHealth, shield: 0, shieldUntil: 0, stunnedUntil: 0, invulnerableUntil: 0,
    slows: [], buffs: [], dots: [], hots: [], cooldowns, nextAttackAt: 0, chosenSize: size, size, formUntil: 0,
    cc: noControl(), fearFrom: -1, tauntBy: -1, unstoppableUntil: 0, stealthUntil: setup.mods?.stealthStart ? ticks(setup.mods.stealthStart) : 0, debuffs: [], flight: ENGINE.flight.max, landedAt: 0,
    hitCount: 0, lowHealthFired: false, damageDealt: 0, recentHeals: [], passiveRegen: 0, damageBonus: setup.damageBonus ?? 0,
  }
}

export function emptyMatch(seed: number): MatchState {
  return { tick: 0, paused: false, heroes: [], projectiles: [], nextProjectileId: 1, rules: rngState(seed), ai: rngState(aiSeed(seed)) }
}

/** The capsule a hero occupies now: base at its feet. */
/** The body that bumps into walls: the hit capsule's radius, capped so big heroes still fit through gaps. */
export const bodyRadius = (hero: HeroState) => Math.min(ENGINE.bodyRadiusCap, capsule(hero).radius)

/** The hit capsule: the medium one scaled by the size class's body, so it matches the model the audience sees (R23). */
export function capsule(hero: HeroState): { radius: number; height: number } {
  const scale = SIZES[hero.size].scale
  return { radius: ENGINE.capsule.radius * scale, height: ENGINE.capsule.height * scale }
}
