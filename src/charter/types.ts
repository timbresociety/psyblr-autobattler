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
