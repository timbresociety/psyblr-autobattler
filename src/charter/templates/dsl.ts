import { GEOMETRY_DEFAULTS, coneArc } from '../geometry'
import type { SizeClass } from '../sizes'
import type { AiHint, BuffStat, ControlType, DebuffType, Delivery, Effect, RoleId, ScalingStat, SlotKind, StateType, Template, PassiveTrigger } from '../types'

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
}

const make = (slot: SlotKind) => (spec: Spec): Template => ({ ...spec, slot, cooldown: spec.cooldown ?? 0 })

export const basic = make('basic')
export const active = make('active')
export const passive = make('passive')
export const ultimate = make('ultimate')
export const movement = make('movement')
