import { GEOMETRY_DEFAULTS, coneArc } from '../geometry.js'
import type { SizeClass } from '../sizes.js'
import type { AiHint, BuffStat, ControlType, DebuffType, Delivery, Effect, Energy, MeleeStyle, RangedSpec, RoleId, ScalingStat, SlotKind, SpellFamily, SpellShape, StateType, Template, PassiveTrigger } from '../types.js'

/** Compact authoring helpers. Magnitudes are rough shapes: the catalogue normalizes them to the slot budget (KTD2). */

export const spirit = (amount: number, ratio = 0.6, overTime?: number): Effect => dmg(amount, ratio, 'spiritPower', overTime)
export const phys = (amount: number, ratio = 1, overTime?: number): Effect => dmg(amount, ratio, 'weaponDamage', overTime)

function dmg(amount: number, ratio: number, scaling: ScalingStat, overTime?: number): Effect {
  return { kind: 'damage', amount, ratio, scaling, type: scaling === 'weaponDamage' ? 'physical' : 'spirit', ...(overTime ? { overTime } : {}) }
}

export const heal = (amount: number, ratio = 0.4, target: 'self' | 'ally' | 'allies' = 'self', overTime?: number): Effect => ({
  kind: 'heal', amount, ratio, target, ...(overTime ? { overTime } : {}),
})
export const shield = (amount: number, duration: number, target: 'self' | 'ally' | 'allies' = 'self', ratio = 0.5): Effect => ({ kind: 'shield', amount, ratio, target, duration })
export const stun = (duration: number): Effect => ({ kind: 'stun', duration })
export const slow = (pct: number, duration: number): Effect => ({ kind: 'slow', pct, duration })
export const push = (distance: number): Effect => ({ kind: 'displace', distance })
export const move = (distance: number, invulnerable?: number): Effect => ({ kind: 'mobility', distance, ...(invulnerable ? { invulnerable } : {}) })
export const buff = (stat: BuffStat, pct: number, duration: number, target: 'self' | 'allies' = 'self'): Effect => ({
  kind: 'buff', stat, pct, duration, target,
})
export const execute = (thresholdPct: number, bonusPct: number): Effect => ({ kind: 'execute', thresholdPct, bonusPct })
/** Transform into another size class for `duration` seconds (KTD14). */
export const resize = (sizeClass: SizeClass, duration: number): Effect => ({ kind: 'resize', sizeClass, duration })
export const form = (duration: number): Effect => ({ kind: 'form', duration })

// the skill library's control, debuffs, states and world effects (see docs/charter/skill-library.html)
export const cripple = (pct: number, duration: number): Effect => ({ kind: 'slow', pct, duration, stat: 'attack' })
export const control = (type: ControlType, duration: number): Effect => ({ kind: 'control', type, duration })
export const root = (duration: number) => control('root', duration)
export const silence = (duration: number) => control('silence', duration)
export const disarm = (duration: number) => control('disarm', duration)
export const sleep = (duration: number) => control('sleep', duration)
export const blind = (duration: number) => control('blind', duration)
export const ground = (duration: number) => control('grounded', duration)
export const fear = (duration: number) => control('fear', duration)
export const taunt = (duration: number) => control('taunt', duration)
export const breakPassive = (duration: number) => control('break', duration)
export const knockup = (duration: number, height = 2.5): Effect => ({ kind: 'knockup', height, duration })
export const pull = (distance: number): Effect => ({ kind: 'pull', distance })
export const debuff = (type: DebuffType, amount: number, duration: number): Effect => ({ kind: 'debuff', type, amount, duration })
export const shred = (amount: number, duration: number) => debuff('armorShred', amount, duration)
export const spiritShred = (amount: number, duration: number) => debuff('spiritShred', amount, duration)
export const vulnerable = (pct: number, duration: number) => debuff('vulnerable', pct, duration)
export const wound = (pct: number, duration: number) => debuff('wound', pct, duration)
export const mark = (pct: number, duration: number) => debuff('mark', pct, duration)
export const state = (type: StateType, duration: number, target: 'self' | 'ally' | 'allies' = 'self'): Effect => ({ kind: 'state', type, duration, target })
export const unstoppable = (duration: number, target: 'self' | 'ally' | 'allies' = 'self') => state('unstoppable', duration, target)
export const stealth = (duration: number, target: 'self' | 'ally' | 'allies' = 'self') => state('stealth', duration, target)
export const invulnerable = (duration: number, target: 'self' | 'ally' | 'allies' = 'self') => state('invulnerable', duration, target)
export const cleanse = (target: 'self' | 'ally' | 'allies' = 'self') => state('cleanse', 0, target)
export const refresh = (seconds: number): Effect => ({ kind: 'refresh', seconds })
export const reflect = (duration: number, target: 'self' | 'ally' | 'allies' = 'allies') => state('reflect', duration, target)
export const reveal = (duration: number): Effect => ({ kind: 'reveal', duration })
export const swapHealth = (cap = 0.35): Effect => ({ kind: 'swapHealth', cap })
export const steal = (seconds: number): Effect => ({ kind: 'steal', seconds })
export const rewind = (seconds: number): Effect => ({ kind: 'rewind', seconds })
export const field = (duration: number, interval = 1): Effect => ({ kind: 'field', duration, interval })
export const wall = (length: number, duration: number, health = 600, height = 3): Effect => ({ kind: 'wall', length, height, duration, health })
export const trap = (lifetime: number, arm = 0.5): Effect => ({ kind: 'trap', lifetime, arm })
export const turret = (duration: number, interval: number, range: number, amount: number, ratio = 0.3, scaling: ScalingStat = 'spiritPower'): Effect => ({
  kind: 'turret', duration, interval, range, amount, ratio, scaling, type: scaling === 'weaponDamage' ? 'physical' : 'spirit',
})

export const at = {
  melee: (range = 2.5, arcDegrees: number = GEOMETRY_DEFAULTS.meleeArc): Delivery => ({ kind: 'melee', range, arcDegrees }),
  proj: (range: number, radius?: number, speed: number = GEOMETRY_DEFAULTS.speed, projectileRadius: number = GEOMETRY_DEFAULTS.projectileRadius): Delivery => ({
    kind: 'projectile', range, ...(radius ? { radius } : {}), speed, projectileRadius,
  }),
  beam: (range: number, width: number = GEOMETRY_DEFAULTS.width): Delivery => ({ kind: 'beam', range, width }),
  cone: (range: number, radius: number, arcDegrees = coneArc(range, radius)): Delivery => ({ kind: 'cone', range, radius, arcDegrees }),
  zone: (range: number, radius: number): Delivery => ({ kind: 'zone', range, radius }),
  self: (): Delivery => ({ kind: 'self', range: 0 }),
  aura: (radius: number): Delivery => ({ kind: 'aura', range: 0, radius }),
  dash: (range: number): Delivery => ({ kind: 'dash', range }),
  blink: (range: number): Delivery => ({ kind: 'blink', range }),
  grapple: (range: number): Delivery => ({ kind: 'grapple', range }),
  /** A jump along the aim; with a radius, what it carries lands on everyone near the landing spot. */
  leap: (range: number, radius?: number): Delivery => ({ kind: 'leap', range, ...(radius ? { radius } : {}) }),
}

export const ai = (use: AiHint['use'], priority: number, extra: Omit<AiHint, 'use' | 'priority'> = {}): AiHint => ({ use, priority, ...extra })

interface Spec {
  id: string
  name: string
  roles: RoleId[]
  tags: string[]
  delivery: Delivery
  effects: Effect[]
  ai: AiHint
  cooldown?: number
  trigger?: PassiveTrigger
  override?: Template['override']
  style?: MeleeStyle
  ranged?: RangedSpec
  family?: SpellFamily
  shape?: SpellShape
  energy?: Energy
}

const make = (slot: SlotKind) => (spec: Spec): Template => ({ ...spec, slot, cooldown: spec.cooldown ?? 0 })

export const melee = (spec: Spec & { style: MeleeStyle }) => make('melee')(spec)
export const ranged = (spec: Spec & { ranged: RangedSpec }) => make('ranged')(spec)
export const spell = (spec: Spec & { family: SpellFamily }) => make('spell')(spec)
export const ultimate = make('ultimate')
export const movement = make('movement')

/** A spell's budget per second of cooldown (budget.ts SLOT_BUDGETS.spell), which a cast turned toggle keeps. */
const SPELL_BUDGET = 22

/** A passive's meter when its author gives none: on for twenty seconds, back in twenty. */
export const PASSIVE_ENERGY: Energy = { seconds: 20, refill: 20 }
export const passive = (spec: Spec) => make('passive')({ ...spec, energy: spec.energy ?? PASSIVE_ENERGY })

/**
 * A self-only power that used to be a cast (Berserk, Vanish, Mana Shield; §4 moves them to F): now a toggle on its own
 * meter, on for half again as long as the cast lasted (as long, for a state) and refilling over the old cooldown. Buffs and states hold while
 * it's on (so each is priced per second), and a heal, shield, cleanse or refresh lands as it switches on.
 */
export function selfPower(spec: Spec): Template {
  const states = spec.effects.flatMap((e) => (e.kind === 'state' && e.type !== 'cleanse' ? [e.duration] : []))
  const lasting = states.length ? Math.min(...states) : Math.max(0, ...spec.effects.map((e) => (e.kind === 'buff' ? e.duration : 0)))
  const effects = spec.effects.map((e): Effect => (e.kind === 'buff' || (e.kind === 'state' && e.type !== 'cleanse') ? { ...e, duration: 1 } : e))
  // a state (untouchable, unstoppable, unseen) held the whole time it's on lasts only as long as the cast's state did
  const stretch = states.length ? 1 : 1.5
  const energy = { seconds: Math.max(2, Math.round(lasting * stretch * 10) / 10), refill: Math.max(6, spec.cooldown ?? 12), onSwitch: true }
  // it keeps the cast's worth over a whole cycle of its meter: a spell's budget for every second it used to wait
  const budget = Math.round(((SPELL_BUDGET * energy.refill) / (energy.seconds + energy.refill)) * 100) / 100
  return make('passive')({ ...spec, effects, cooldown: 0, trigger: 'always', energy, override: spec.override ?? { budget, reason: 'a cast turned toggle keeps its cast budget over its meter cycle (GAME.md §4 F)' } })
}

/** The ranged library's weapons (§4 LMB): rate in shots a second at attack speed 1, magazine, reload seconds. */
export const R = {
  pistol: { style: 'pistol', mode: 'single', rate: 2.2, magazine: 12, reload: 1.4 },
  rifle: { style: 'rifle', mode: 'single', rate: 1.6, magazine: 10, reload: 1.8 },
  burst: { style: 'rifle', mode: 'burst', burst: 3, rate: 1, magazine: 24, reload: 2 },
  railgun: { style: 'rifle', mode: 'beam', rate: 0.7, magazine: 4, reload: 2.2 },
  bow: { style: 'rifle', mode: 'single', rate: 1.2, magazine: 6, reload: 1.6 },
  shotgun: { style: 'rifle', mode: 'pellets', pellets: 6, rate: 1.1, magazine: 6, reload: 2.2 },
  thrown: { style: 'thrown', mode: 'single', rate: 1.6, magazine: 8, reload: 1.6 },
  magic1h: { style: 'magic', hands: 1, mode: 'single', rate: 1.9, magazine: 14, reload: 1.6 },
  magic2h: { style: 'magic', hands: 2, mode: 'single', rate: 1.2, magazine: 10, reload: 1.8 },
  magicBeam: { style: 'magic', hands: 2, mode: 'beam', rate: 1.4, magazine: 12, reload: 1.8 },
  magicPellets: { style: 'magic', hands: 1, mode: 'pellets', pellets: 5, rate: 1.2, magazine: 8, reload: 1.8 },
} as const satisfies Record<string, RangedSpec>
