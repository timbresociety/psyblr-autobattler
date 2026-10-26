import { GEOMETRY_DEFAULTS, coneArc } from '../geometry'
import type { SizeClass } from '../sizes'
import type { AiHint, Delivery, Effect, RoleId, ScalingStat, SlotKind, Template, PassiveTrigger } from '../types'

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
export const buff = (stat: 'damage' | 'attackSpeed' | 'moveSpeed' | 'damageReduction', pct: number, duration: number, target: 'self' | 'allies' = 'self'): Effect => ({
  kind: 'buff', stat, pct, duration, target,
})
export const execute = (thresholdPct: number, bonusPct: number): Effect => ({ kind: 'execute', thresholdPct, bonusPct })
/** Transform into another size class for `duration` seconds (KTD14). */
export const resize = (sizeClass: SizeClass, duration: number): Effect => ({ kind: 'resize', sizeClass, duration })

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
