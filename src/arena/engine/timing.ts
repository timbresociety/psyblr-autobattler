import type { BuildSlot, Delivery, Template } from '../../charter/types.js'
import { ticks } from './calibration.js'

/**
 * Action timing (Forge goal, phase 1). Every cast winds up (prep), lands on its release tick, then recovers before the
 * hero is free again. The engine owns these beats, so the AI and a player wait the same ticks; a skill's look never
 * changes them. The client stretches each clip so its release frame lands on the release tick.
 */
export interface Timing {
  /** Seconds from the press to the release, when the hit lands or the shot leaves. */
  prep: number
  /** Seconds after the release before the hero can start another action. */
  recover: number
}

/** A skill's beats by how it's delivered. Basic attacks are quicker, ultimates longer (below). */
const SKILL: Record<Delivery['kind'], Timing> = {
  melee: { prep: 0.22, recover: 0.26 },
  cone: { prep: 0.26, recover: 0.26 },
  projectile: { prep: 0.24, recover: 0.2 },
  beam: { prep: 0.34, recover: 0.3 },
  zone: { prep: 0.3, recover: 0.24 },
  aura: { prep: 0.22, recover: 0.2 },
  self: { prep: 0.18, recover: 0.14 },
  dash: { prep: 0.1, recover: 0.16 },
  blink: { prep: 0.12, recover: 0.12 },
  grapple: { prep: 0.16, recover: 0.18 },
  leap: { prep: 0.2, recover: 0.22 },
}

const BASIC: Partial<Record<Delivery['kind'], Timing>> = {
  melee: { prep: 0.14, recover: 0.18 },
  cone: { prep: 0.16, recover: 0.18 },
  projectile: { prep: 0.12, recover: 0.14 },
  beam: { prep: 0.14, recover: 0.16 },
}
const BASIC_FALLBACK: Timing = { prep: 0.14, recover: 0.16 }

/** An ultimate holds its wind-up longer: the beat before the big one is the cinematic moment. */
export const ULTIMATE = { prep: 1.8, recover: 1.4 }

/** A basic attack's prep and recovery fit inside this share of the time between attacks, however fast it swings. */
export const BASIC_SHARE = 0.85

/**
 * The beats of one cast. `interval` is the seconds between this hero's basic attacks at its current tempo: a fast
 * attacker's swing shrinks to fit, so attack speed never stalls on the animation.
 */
export function timingOf(template: Template, slot: BuildSlot, interval = Infinity): Timing {
  const kind = template.delivery.kind
  if (slot === 'basic') {
    const t = BASIC[kind] ?? BASIC_FALLBACK
    const fit = Math.min(1, (interval * BASIC_SHARE) / (t.prep + t.recover))
    return { prep: t.prep * fit, recover: t.recover * fit }
  }
  const t = SKILL[kind]
  // a dodge answers at once: an escape that winds up is an escape that gets caught (balance gate, 2026-10-30)
  if (slot === 'movement') return { prep: 0, recover: t.recover }
  return slot === 'ultimate' ? { prep: t.prep * ULTIMATE.prep, recover: t.recover * ULTIMATE.recover } : t
}

/** The same beats in whole engine ticks. A prep never rounds to zero, so every hit follows a release. */
export function timingTicks(template: Template, slot: BuildSlot, interval = Infinity): { prep: number; recover: number } {
  const t = timingOf(template, slot, interval)
  return { prep: Math.max(1, ticks(t.prep)), recover: ticks(t.recover) }
}

/** Deliveries that strike close: the swing carries the body in, so a sword keeps closing on its target as it strikes. */
const CLOSE = new Set<Delivery['kind']>(['melee', 'cone', 'dash', 'grapple', 'leap'])

/**
 * How fast a hero can move while acting, as a share of its speed. A basic attack barely slows anyone, so chasing and
 * kiting work as they did; a skill plants the feet through its wind-up, less for a swing that carries the body in; an
 * ultimate's wind-up roots. Slowing basics as much as skills cost melee chasers a third of their wins against the
 * field and handed them to control (balance gate, 2026-10-30).
 */
export function moveShare(slot: BuildSlot, released: boolean, kind?: Delivery['kind']): number {
  if (slot === 'ultimate') return released ? 0.5 : 0
  if (slot === 'movement') return released ? 0.8 : 0.5
  const close = kind !== undefined && CLOSE.has(kind)
  if (slot === 'basic') return released ? 1 : close ? 0.9 : 0.85
  return close ? (released ? 0.9 : 0.7) : released ? 0.8 : 0.5
}
