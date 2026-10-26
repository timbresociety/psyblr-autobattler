import type { SizeClass } from './sizes.js'
/** Shared Charter types. Framework-free: used by the creator, the simulation and serverless functions (KTD1). */

/**
 * Eight roles, one per thing a hero mainly gives its team (see docs/charter/skill-library.html): soak (tank), deny the
 * enemy (controller), keep allies going (support), build presence on the field (summoner), and damage split by reach
 * and tempo: close and sustained (fighter), close burst (assassin), far and sustained (marksman), far burst (mage).
 */
export type RoleId = 'tank' | 'fighter' | 'assassin' | 'mage' | 'marksman' | 'support' | 'controller' | 'summoner'

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

/**
 * Crowd control on enemies, one kind per thing it takes away (the skill library's MECE split):
 * root (moving), silence (skills), disarm (basic attacks), sleep (everything, until hurt), blind (basic attacks miss),
 * grounded (flight and movement skills), fear (control: it runs from the caster), taunt (control: it must attack the
 * caster), break (its passive). Stun and slow keep their own kinds below; knock-up and pull are forced movement.
 */
export type ControlType = 'root' | 'silence' | 'disarm' | 'sleep' | 'blind' | 'grounded' | 'fear' | 'taunt' | 'break'

/** Weakening on enemies: flat armour or spirit resist down, more damage taken, less healing taken, marked for the team. */
export type DebuffType = 'armorShred' | 'spiritShred' | 'vulnerable' | 'wound' | 'mark'

/** States on the caster or allies: immune to control, unseen, untouchable, or rid of control and debuffs. */
export type StateType = 'unstoppable' | 'stealth' | 'invulnerable' | 'cleanse'

export type BuffStat = 'damage' | 'attackSpeed' | 'moveSpeed' | 'damageReduction' | 'lifesteal' | 'evasion'

export type Effect =
  | { kind: 'damage'; amount: number; ratio: number; scaling: ScalingStat; type: DamageType; overTime?: number }
  | { kind: 'heal'; amount: number; ratio: number; target: 'self' | 'ally' | 'allies'; overTime?: number }
  | { kind: 'shield'; amount: number; ratio: number; target: 'self' | 'ally' | 'allies'; duration: number }
  | { kind: 'stun'; duration: number }
  /** `attack` slows basic attacks and fire rate instead of movement (cripple). */
  | { kind: 'slow'; pct: number; duration: number; stat?: 'move' | 'attack' }
  | { kind: 'displace'; distance: number }
  /** Self-movement. Only movement-slot templates may carry it (no dash, blink or leap hides in an active). */
  | { kind: 'mobility'; distance: number; invulnerable?: number }
  | { kind: 'buff'; stat: BuffStat; pct: number; duration: number; target: 'self' | 'allies' }
  | { kind: 'execute'; thresholdPct: number; bonusPct: number }
  /** A transformation: the hero takes another size class for a while, up or down (R23, KTD14). */
  | { kind: 'resize'; sizeClass: SizeClass; duration: number }
  /**
   * A transformation that keeps the hero's size: it marks a power-up as a form, so the hero's form look plays for
   * `duration` seconds. It changes no number; the template's other effects carry the power.
   */
  | { kind: 'form'; duration: number }
  | { kind: 'control'; type: ControlType; duration: number }
  /** Launch into the air and hold there, helpless, for `duration` seconds. */
  | { kind: 'knockup'; height: number; duration: number }
  /** Drag toward the caster (or a zone's centre) by up to `distance` metres. */
  | { kind: 'pull'; distance: number }
  /** Amount: resist points for shreds, percent for the rest. */
  | { kind: 'debuff'; type: DebuffType; amount: number; duration: number }
  | { kind: 'state'; type: StateType; duration: number; target: 'self' | 'ally' | 'allies' }
  /** Take this many seconds off the caster's other cooldowns. */
  | { kind: 'refresh'; seconds: number }
  /** The template's other effects linger in its area, landing again every `interval` seconds for `duration` seconds. */
  | { kind: 'field'; duration: number; interval: number }
  /** A temporary wall across the aim at the landing point: real cover, `health` to break it. */
  | { kind: 'wall'; length: number; height: number; duration: number; health: number }
  /** The template's other effects wait in its area and spring on the first enemy to step in, armed after `arm` seconds. */
  | { kind: 'trap'; lifetime: number; arm: number }
  /** A construct at the landing point that shoots the nearest enemy in sight every `interval` seconds. */
  | { kind: 'turret'; duration: number; interval: number; range: number; amount: number; ratio: number; scaling: ScalingStat; type: DamageType }

export interface Delivery {
  kind: 'melee' | 'projectile' | 'beam' | 'cone' | 'zone' | 'self' | 'aura' | 'dash' | 'blink' | 'grapple' | 'leap'
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
