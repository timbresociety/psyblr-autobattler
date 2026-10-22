import type { SizeClass } from './sizes'
/** Shared Charter types. Framework-free: used by the creator, the simulation and serverless functions (KTD1). */

export type RoleId = 'tank' | 'fighter' | 'assassin' | 'mage' | 'marksman' | 'support'

export type Attribute = 'strength' | 'agility' | 'intellect'

/** Points a player spends from the fixed pool, by core attribute (KTD3). */
export type Spread = Record<Attribute, number>

export type SecondaryStat =
  | 'maxHealth'
  | 'armor'
  | 'magicResist'
  | 'moveSpeed'
  | 'attackSpeed'
  | 'weaponDamage'
  | 'fireRate'
  | 'ammo'
  | 'spiritPower'
  | 'regen'
  | 'lifesteal'
  | 'cooldownReduction'

export type SecondarySheet = Record<SecondaryStat, number>

export interface Role {
  id: RoleId
  name: string
  /** One line on how the role fights; also guides the battle AI. */
  description: string
  /** Secondary stats before any points are spent. */
  base: SecondarySheet
  /** How strongly each core attribute scales this role's secondary stats. */
  weights: Record<Attribute, number>
  /** Hard ceiling for each derived secondary stat. */
  caps: SecondarySheet
  /** Most points one attribute can hold for this role. */
  attributeCaps: Record<Attribute, number>
  /** The spread the engine proposes before any description is read. */
  defaultSpread: Spread
}

/** A rejection that names the limit that was hit and the closest allowed value (R4, AE2). */
export interface LimitHit {
  reason: 'pool-exceeded' | 'attribute-cap' | 'negative' | 'not-integer' | 'stat-cap'
  field: string
  requested: number
  allowed: number
}

export type Validation = { ok: true } | { ok: false; errors: LimitHit[] }

/** The kind of slot a template fills. A build has two `active` slots (R1). */
export type SlotKind = 'basic' | 'active' | 'passive' | 'ultimate' | 'movement'

/** The six slots of every build: basic attack, two actives, passive, ultimate, movement (R1). */
export type BuildSlot = 'basic' | 'active1' | 'active2' | 'passive' | 'ultimate' | 'movement'

export type DamageType = 'physical' | 'spirit'

/** Which sheet stat a magnitude scales with. */
export type ScalingStat = 'weaponDamage' | 'spiritPower'

export type Effect =
  | { kind: 'damage'; amount: number; ratio: number; scaling: ScalingStat; type: DamageType; overTime?: number }
  | { kind: 'heal'; amount: number; ratio: number; target: 'self' | 'ally' | 'allies'; overTime?: number }
  | { kind: 'shield'; amount: number; ratio: number; target: 'self' | 'ally' | 'allies'; duration: number }
  | { kind: 'stun'; duration: number }
  | { kind: 'slow'; pct: number; duration: number }
  | { kind: 'displace'; distance: number }
  | { kind: 'mobility'; distance: number; invulnerable?: number }
  | { kind: 'buff'; stat: 'damage' | 'attackSpeed' | 'moveSpeed' | 'damageReduction'; pct: number; duration: number; target: 'self' | 'allies' }
  | { kind: 'execute'; thresholdPct: number; bonusPct: number }
  /** A transformation: the hero takes another size class for a while, up or down (R23, KTD14). */
  | { kind: 'resize'; sizeClass: SizeClass; duration: number }

export interface Delivery {
  kind: 'melee' | 'projectile' | 'beam' | 'cone' | 'zone' | 'self' | 'aura' | 'dash' | 'blink' | 'grapple'
  /** Metres to the target or the far edge of the effect. */
  range: number
  /** Metres; area effects only. */
  radius?: number
  /** Projectiles: travel speed in m/s (R43). */
  speed?: number
  /** Projectiles: the size of the travelling shot, in metres (R43). */
  projectileRadius?: number
  /** Melee and cones: the full width of the arc, in degrees (R43). */
  arcDegrees?: number
  /** Beams: width in metres (R43). */
  width?: number
}

/** When a passive's effects apply. */
export type PassiveTrigger = 'always' | 'onHit' | 'everyThirdHit' | 'lowHealth' | 'onKill'

/** How the battle AI should use a template (R17). */
export interface AiHint {
  use: 'always' | 'open' | 'engage' | 'poke' | 'finisher' | 'escape' | 'peel' | 'sustain' | 'support'
  /** Higher fires first when several skills are ready. */
  priority: number
  /** Use only when the caster is below this health fraction. */
  selfHealthBelow?: number
  /** Use only when the target is below this health fraction. */
  targetHealthBelow?: number
  /** Use only with at least this many enemies inside the effect. */
  minTargets?: number
}

export interface Template {
  id: string
  /** The mechanic's catalogue name; the player's own skill name is shown on top (R5). */
  name: string
  slot: SlotKind
  roles: RoleId[]
  /** Mechanic vocabulary used by the matcher (R5, R7). */
  tags: string[]
  delivery: Delivery
  effects: Effect[]
  /** Seconds; 0 for basic attacks and passives. */
  cooldown: number
  trigger?: PassiveTrigger
  ai: AiHint
  /** Optional until the Forge decides how animations attach. */
  animationHook?: string
  /** A hand-tuned budget, recorded with its reason (KTD2). */
  override?: { budget: number; reason: string }
}
