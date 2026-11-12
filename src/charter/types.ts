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

/**
 * The row a template fills (GAME.md §4): the melee weapon style (V), the ranged weapon (LMB), a spell (Q), the passive
 * toggle (F), the ultimate (R) or the movement skill (E). Rows don't overlap, and the typing rules (catalog.ts
 * `fitsSlot`) keep a wrong item out of each.
 */
export type SlotKind = 'melee' | 'ranged' | 'spell' | 'passive' | 'ultimate' | 'movement'

/** The six slots of every build, one per row; the ids are the stored builds' (basic is V's melee, active1 LMB, active2 Q). */
export type BuildSlot = 'basic' | 'active1' | 'active2' | 'passive' | 'ultimate' | 'movement'

/** Melee weapon styles (§4 V), named as the coverage manifest and the motions name them. */
export type MeleeStyle = 'unarmed' | 'kicks' | 'blade' | 'greatsword' | 'shield' | 'staff' | 'club' | 'paired' | 'axe' | 'spear' | 'whip'

/**
 * Ranged styles (§4 LMB): what the hand holds, which sets the clips and, for guns, the locomotion. The locked library
 * adds the body emitter (eye beams, breath), paired guns, the heavy gun (launchers, miniguns) and the bow; the magic
 * hands are `magic` with `hands`.
 */
export type RangedStyle = 'pistol' | 'rifle' | 'thrown' | 'magic' | 'emitter' | 'paired' | 'heavy' | 'bow'

/**
 * How a ranged weapon fires, on repeat (§5): `rate` shots a second at attack speed 1 (a burst counts as one), a
 * magazine of `magazine` shots and `reload` seconds to refill it. `pellets` spreads a shotgun cone into that many
 * shots; `burst` fires that many in a quick string; `beam` lands along a line at once. `hands` picks one- or
 * two-handed magic clips.
 */
export interface RangedSpec {
  style: RangedStyle
  /**
   * `auto` fires while held (as every weapon did before the locked library); with the full kit a played hero's `single`
   * needs a press a shot. `channel` holds a beam on while held, which can clash with another (§4 Systems).
   */
  mode: 'single' | 'auto' | 'burst' | 'pellets' | 'beam' | 'channel'
  rate: number
  magazine: number
  reload: number
  pellets?: number
  burst?: number
  hands?: 1 | 2
}

/** The spell universe's families (§4 Q): each spell has exactly one, its main purpose. */
export type SpellFamily = 'counter' | 'control' | 'displacement' | 'zone' | 'construct' | 'summon' | 'support' | 'curse' | 'burst' | 'vision' | 'trick'

/**
 * The E row's kinds beyond a dash, a blink, a leap and a grapple (§4 E): teleport to a mark or a target, swap places,
 * a dash that homes, a swing on a line, held flight, a glide, crawling up any wall, burrowing, riding an ally, and the
 * four shared moves done better (Wall Run, Combat Roll, Power Slide, Zipline).
 */
export type TraverseKind = 'teleport' | 'swap' | 'homing' | 'swing' | 'flight' | 'glide' | 'wallCrawl' | 'burrow' | 'ride' | 'wallRun' | 'combatRoll' | 'powerSlide' | 'zipline'

/** Every spell has one shape (§4). */
export type SpellShape = 'projectile' | 'beam' | 'cone' | 'line' | 'zone' | 'aura' | 'tether' | 'placed'

/**
 * A passive's energy meter (§4 F): it drains over `seconds` while on and refills over `refill` seconds while off; dry,
 * the passive switches itself off. It never costs health and never blocks an action.
 */
export interface Energy {
  seconds: number
  refill: number
  /** Its heal, shield, cleanse or refresh lands once as it switches on (a power that used to be a cast). */
  onSwitch?: boolean
}

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
/** `reflect` turns enemy shots that reach the hero back on their shooter. */
export type StateType = 'unstoppable' | 'stealth' | 'invulnerable' | 'cleanse' | 'reflect'

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
  | { kind: 'form'; duration: number; stages?: number }
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
  /** Vision: enemies it reaches can't hide (stealth ends and won't start) and show through walls for `duration` seconds. */
  | { kind: 'reveal'; duration: number }
  /** Trick: the caster and the enemy it reaches trade health fractions, each change capped at `cap` of max health. */
  | { kind: 'swapHealth'; cap: number }
  /** Trick: the enemy's spell (Q) waits `seconds` more, and the caster's waits that much less. */
  | { kind: 'steal'; seconds: number }
  /** Trick: an ally gets back the health it lost over the last `seconds` seconds. */
  | { kind: 'rewind'; seconds: number }
  | { kind: 'turret'; duration: number; interval: number; range: number; amount: number; ratio: number; scaling: ScalingStat; type: DamageType }
  /**
   * The locked library's new pieces (GAME.md §4). Counter: for `duration` seconds the next enemy hit is answered
   * instead of landing: struck back with the template's other effects, slipped behind the striker, turned back on it,
   * or drunk as health.
   */
  | { kind: 'counter'; duration: number; answer: 'strike' | 'substitute' | 'reflect' | 'absorb' }
  /** Summon: `count` of something that moves and acts for `duration` seconds: minions, clones of the caster, decoys, or a titan. */
  | { kind: 'summon'; what: 'minion' | 'clone' | 'decoy' | 'titan'; count: number; duration: number }
  /** Construct: a one-way barrier across the aim at the landing point that stops enemy shots and lets the caster's side's through. */
  | { kind: 'barrier'; length: number; height: number; duration: number; health: number }
  /** Construct: ground to walk on: a ramp up along the aim, a platform, or a path along it (ice: quicker underfoot). */
  | { kind: 'terrain'; shape: 'ramp' | 'platform' | 'path'; length: number; width: number; height: number; duration: number }
  /** Construct: a pair of portals, by the caster and at the landing point, for `duration` seconds. */
  | { kind: 'portal'; duration: number }
  /** Trick: the caster takes the target's kit (its weapons and skills) for `duration` seconds. */
  | { kind: 'copyKit'; duration: number }
  /** Trick: the caster drives the target for `duration` seconds, turned against its own side, while its own body stands still. */
  | { kind: 'possess'; duration: number }
  /** Displacement: lift the target `height` metres, hold it `hold` seconds, then throw it `distance` metres along the caster's aim. */
  | { kind: 'lift'; height: number; hold: number; distance: number }
  /** Support (and Rally): revive a downed ally at range (`ally`), or every downed ally in reach (`allies`), at `share` of its health. */
  | { kind: 'revive'; share: number; target: 'ally' | 'allies' }
  /** F: an elemental sheath while on: every hit carries its element (flame burns, frost slows, lightning jolts). */
  | { kind: 'element'; element: 'flame' | 'frost' | 'lightning' }
  /** R Strike: lock on to the target and land `hits` blows over `duration` seconds, both held out of the fight meanwhile. */
  | { kind: 'lockon'; hits: number; duration: number }
  /** R Kit switch, or an R form's moveset: the template's `switchTo` kit replaces the caster's for `duration` seconds. */
  | { kind: 'kitSwitch'; duration: number }
  /** Fusion: the caster and its nearest ally merge into one, bigger and stronger, for `duration` seconds. */
  | { kind: 'fuse'; duration: number }
  /** E: how the caster moves (TraverseKind), for up to `duration` seconds of a held kind and `distance` metres of a moving one. */
  | { kind: 'traverse'; how: TraverseKind; duration: number; distance: number }

/**
 * How a shot flies (§4 LMB): straight (the default), lobbed in an arc to where it's aimed, bouncing off walls,
 * returning to the hand, homing on a target, or guided by the shooter's aim while it flies.
 */
export type Flight = 'straight' | 'lobbed' | 'bouncing' | 'returning' | 'homing' | 'guided'

export interface Delivery {
  kind: 'melee' | 'projectile' | 'beam' | 'cone' | 'zone' | 'self' | 'aura' | 'dash' | 'blink' | 'grapple' | 'leap'
  /** Projectiles: how the shot flies (straight when absent), and how often a bouncing one bounces. */
  flight?: Flight
  bounces?: number
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
export type PassiveTrigger = 'always' | 'onHit' | 'everyThirdHit' | 'lowHealth' | 'onKill' | 'whenHit'

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
  /** Melee row: the weapon style, which sets the clips, reach, contact frames and lunge (§4). */
  style?: MeleeStyle
  /** Ranged row: how the weapon fires. */
  ranged?: RangedSpec
  /** Spell row: the family and the shape. */
  family?: SpellFamily
  shape?: SpellShape
  /** Passive row: the energy meter. */
  energy?: Energy
  /** Mechanic vocabulary used by the matcher (R5, R7). */
  tags: string[]
  delivery: Delivery
  effects: Effect[]
  /** Seconds; 0 for melee, ranged and passives. */
  cooldown: number
  trigger?: PassiveTrigger
  ai: AiHint
  /** Optional until the Forge decides how animations attach. */
  animationHook?: string
  /** A hand-tuned budget, recorded with its reason (KTD2). */
  override?: { budget: number; reason: string }
  /**
   * Hold to charge (§4 Systems, LMB and Q): held, it charges over `seconds`; let go, it fires at `min` times its
   * magnitudes up to `max` fully charged.
   */
  charge?: { seconds: number; min: number; max: number }
  /** Ability charges (§4 Systems): this many uses banked, each coming back over the cooldown in turn. */
  charges?: number
  /** The spendable power meter (§4 Systems): casting spends this share of it, and can't without it. */
  cost?: number
  /** The kit a Kit switch or a form's moveset brings (§4 R): these slots replace the caster's while it lasts. */
  switchTo?: Partial<Record<BuildSlot, Template>>
}
