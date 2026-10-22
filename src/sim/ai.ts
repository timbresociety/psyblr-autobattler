import { BUILD_SLOTS } from '../charter/build'
import type { BuildSlot, Template } from '../charter/types'
import { CALIBRATION } from './calibration'
import { alliesOf, distance, enemiesHit, enemiesOf, hpFraction, isRanged, type Battle, type Unit } from './engine'

/** The battle AI (R17): it plays every kit from each template's usage hints, the same in watch mode and when a player switches away. */

const CAST_SLOTS: BuildSlot[] = BUILD_SLOTS.filter((s) => s !== 'basic' && s !== 'passive')

/** Assassins hunt the weakest enemy; everyone else fights the nearest. */
export function chooseTarget(battle: Battle, unit: Unit): Unit | undefined {
  const enemies = enemiesOf(battle, unit)
  if (!enemies.length) return undefined
  const hunter = unit.roleId === 'assassin'
  return enemies.reduce((best, e) => {
    const better = hunter ? hpFraction(e) < hpFraction(best) - 1e-9 : distance(unit, e) < distance(unit, best) - 1e-9
    return better ? e : best
  })
}

export function preferredDistance(unit: Unit): number {
  const range = unit.kit.basic.delivery.range
  return isRanged(unit) ? range * CALIBRATION.rangedHoldFraction : range * 0.9
}

function reach(unit: Unit, t: Template): number {
  const { delivery } = t
  switch (delivery.kind) {
    case 'self':
      return preferredDistance(unit) + 3
    case 'aura':
      return delivery.radius ?? 0
    case 'zone':
      return delivery.range ? delivery.range + (delivery.radius ?? 0) * 0.5 : delivery.radius ?? 0
    default:
      return delivery.range + (delivery.radius ?? 0) * 0.5
  }
}

const helpsFriends = (t: Template) => t.effects.some((e) => e.kind === 'heal' || e.kind === 'shield' || (e.kind === 'buff' && e.target === 'allies'))
const hurtsEnemies = (t: Template) => t.effects.some((e) => e.kind === 'damage' || e.kind === 'stun' || e.kind === 'slow' || e.kind === 'displace')

function nearestEnemy(battle: Battle, unit: Unit): number {
  return enemiesOf(battle, unit).reduce((m, e) => Math.min(m, distance(unit, e)), Infinity)
}

function wants(battle: Battle, unit: Unit, t: Template, target: Unit): { ok: boolean; escape?: boolean } {
  const hint = t.ai
  const inReach = distance(unit, target) <= reach(unit, t)
  if (hint.selfHealthBelow !== undefined && hint.use !== 'escape' && hint.use !== 'sustain' && hpFraction(unit) >= hint.selfHealthBelow) return { ok: false }
  if (hint.targetHealthBelow !== undefined && hpFraction(target) >= hint.targetHealthBelow) return { ok: false }
  if (hint.minTargets && hurtsEnemies(t) && enemiesHit(battle, unit, t, target).length < hint.minTargets) return { ok: false }
  switch (hint.use) {
    case 'always':
      return { ok: false }
    case 'open':
    case 'engage':
    case 'poke':
      return { ok: inReach }
    case 'finisher':
      return { ok: inReach && hpFraction(target) < (hint.targetHealthBelow ?? 0.4) }
    case 'escape':
      return { ok: hpFraction(unit) < (hint.selfHealthBelow ?? 0.3) && nearestEnemy(battle, unit) <= CALIBRATION.nearRadius, escape: true }
    case 'peel':
      return { ok: nearestEnemy(battle, unit) <= CALIBRATION.nearRadius && (hint.selfHealthBelow === undefined || hpFraction(unit) < hint.selfHealthBelow) && (inReach || t.delivery.kind === 'aura') }
    case 'sustain':
      return { ok: hpFraction(unit) < (hint.selfHealthBelow ?? 0.6) && nearestEnemy(battle, unit) <= 12 }
    case 'support': {
      if (helpsFriends(t) && t.effects.some((e) => e.kind === 'heal' || e.kind === 'shield')) {
        return { ok: alliesOf(battle, unit).some((a) => hpFraction(a) < 0.8 && distance(unit, a) <= Math.max(t.delivery.range, CALIBRATION.alliesRadius) + (t.delivery.radius ?? 0)) }
      }
      return { ok: nearestEnemy(battle, unit) <= 12 }
    }
  }
}

/** The highest-priority ready skill whose usage hint fits the moment. */
export function chooseCast(battle: Battle, unit: Unit, target: Unit): { slot: BuildSlot; target: Unit; escape?: boolean } | undefined {
  let best: { slot: BuildSlot; target: Unit; escape?: boolean; priority: number } | undefined
  for (const slot of CAST_SLOTS) {
    if (unit.cooldowns[slot] > 0) continue
    const t = unit.kit[slot]
    const verdict = wants(battle, unit, t, target)
    if (verdict.ok && (!best || t.ai.priority > best.priority)) best = { slot, target, escape: verdict.escape, priority: t.ai.priority }
  }
  return best && { slot: best.slot, target: best.target, escape: best.escape }
}
