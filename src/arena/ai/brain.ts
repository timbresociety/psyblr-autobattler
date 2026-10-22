import type { BuildSlot, Template } from '../../charter/types'
import { ENGINE } from '../engine/calibration'
import { chest, isRanged } from '../engine/deliveries'
import { alliesOf, enemiesOf, hpFraction } from '../engine/effects'
import { PI, TAU, distance, wrapAngle } from '../engine/maths'
import type { Arena } from '../engine/match'
import { next } from '../engine/rng'
import { AIM_STEPS, capsule, slotBit, type BrainState, type Command, type HeroSetup, type HeroState, type MatchState } from '../engine/state'
import { aimPoint, anglesTo, trackAim } from './aim'
import { AI } from './calibration'

/**
 * The demo AI (KTD7, R17, R18, R31): utility scoring over a small action set, re-decided every 150 ms, with a thin
 * human layer on top (reaction delay, laggy aim, dodges, team focus). Template usage hints feed the scores. It plays
 * every hero nobody controls, on both sides, and its memory lives in the match state.
 */

const CAST_SLOTS: NonNullable<BrainState['cast']>['slot'][] = ['movement', 'ultimate', 'active1', 'active2']

const gapTo = (from: HeroState, to: HeroState) => Math.max(0, distance(from.position, to.position) - capsule(from).radius - capsule(to).radius)
const nearestGap = (m: MatchState, h: HeroState) => enemiesOf(m, h).reduce((d, e) => Math.min(d, gapTo(h, e)), Infinity)

export function preferredDistance(setup: HeroSetup): number {
  const range = setup.kit.basic.delivery.range
  return isRanged(setup) ? range * AI.rangedHold : range * 0.9
}

function reach(setup: HeroSetup, t: Template): number {
  const d = t.delivery
  switch (d.kind) {
    case 'self':
      return preferredDistance(setup) + 3
    case 'aura':
      return d.radius ?? 0
    case 'zone':
      return d.range ? d.range + (d.radius ?? 0) * 0.5 : (d.radius ?? 0)
    default:
      return d.range + (d.radius ?? 0) * 0.5
  }
}

const helpsFriends = (t: Template) => t.effects.some((e) => e.kind === 'heal' || e.kind === 'shield' || (e.kind === 'buff' && e.target === 'allies'))

/** Whether a template's usage hint fits the moment (ported from the balance AI). */
function wants(m: MatchState, hero: HeroState, setup: HeroSetup, t: Template, target: HeroState): { ok: boolean; escape?: boolean } {
  const hint = t.ai
  const inReach = gapTo(hero, target) <= reach(setup, t)
  if (hint.selfHealthBelow !== undefined && hint.use !== 'escape' && hint.use !== 'sustain' && hpFraction(hero) >= hint.selfHealthBelow) return { ok: false }
  if (hint.targetHealthBelow !== undefined && hpFraction(target) >= hint.targetHealthBelow) return { ok: false }
  if (hint.minTargets && enemiesOf(m, hero).filter((e) => distance(e.position, target.position) <= (t.delivery.radius ?? 2) + 1).length < hint.minTargets) return { ok: false }
  const near = nearestGap(m, hero)
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
      return { ok: hpFraction(hero) < (hint.selfHealthBelow ?? 0.3) && near <= AI.nearRadius, escape: true }
    case 'peel':
      return { ok: near <= AI.nearRadius && (hint.selfHealthBelow === undefined || hpFraction(hero) < hint.selfHealthBelow) && (inReach || t.delivery.kind === 'aura') }
    case 'sustain':
      return { ok: hpFraction(hero) < (hint.selfHealthBelow ?? 0.6) && near <= 12 }
    case 'support':
      if (helpsFriends(t) && t.effects.some((e) => e.kind === 'heal' || e.kind === 'shield'))
        return { ok: alliesOf(m, hero).some((a) => hpFraction(a) < 0.8 && distance(hero.position, a.position) <= Math.max(t.delivery.range, ENGINE.alliesRadius) + (t.delivery.radius ?? 0)) }
      return { ok: near <= 12 }
  }
}

/** Team focus: assassins hunt the weakest anywhere; others take the weakest in easy reach, else the nearest. */
function chooseTarget(m: MatchState, hero: HeroState, setup: HeroSetup): HeroState | undefined {
  const enemies = enemiesOf(m, hero)
  if (!enemies.length) return undefined
  const effective = (e: HeroState) => e.hp + e.shield
  if (setup.build.roleId === 'assassin') return enemies.reduce((a, b) => (hpFraction(b) < hpFraction(a) - 1e-9 ? b : a))
  const scan = preferredDistance(setup) + AI.focusReach
  const inReach = enemies.filter((e) => gapTo(hero, e) <= scan)
  if (inReach.length) return inReach.reduce((a, b) => (effective(b) < effective(a) - 1e-9 ? b : a))
  return enemies.reduce((a, b) => (gapTo(hero, b) < gapTo(hero, a) - 1e-9 ? b : a))
}

function newBrain(hero: HeroState): BrainState {
  return { nextDecision: 0, target: -1, action: 'approach', strafe: hero.id % 2 ? 1 : -1, dodgeUntil: 0, dodge: { x: 0, z: 0, vertical: 0 }, yaw: hero.yaw, pitch: 0, overshoot: 0 }
}

/** A projectile from an enemy heading close enough to hit, within sight. */
function incoming(m: MatchState, hero: HeroState, setups: readonly HeroSetup[]) {
  const me = chest(hero)
  for (const p of m.projectiles) {
    if (m.heroes[p.owner].team === hero.team) continue
    const to = { x: me.x - p.position.x, y: me.y - p.position.y, z: me.z - p.position.z }
    const along = to.x * p.step.x + to.y * p.step.y + to.z * p.step.z
    const stepLen = p.step.x * p.step.x + p.step.y * p.step.y + p.step.z * p.step.z
    const dist = Math.sqrt(to.x * to.x + to.y * to.y + to.z * to.z)
    if (along <= 0 || dist > AI.seeDistance || stepLen === 0) continue
    const t = along / stepLen
    const cx = p.position.x + p.step.x * t - me.x
    const cy = p.position.y + p.step.y * t - me.y
    const cz = p.position.z + p.step.z * t - me.z
    const size = setups[p.owner].kit[p.slot].delivery.projectileRadius ?? 0.3
    if (Math.sqrt(cx * cx + cy * cy + cz * cz) <= capsule(hero).radius + size + 0.6) return p
  }
  return undefined
}

function decide(m: MatchState, hero: HeroState, setup: HeroSetup, brain: BrainState, setups: readonly HeroSetup[]) {
  brain.nextDecision = m.tick + AI.decisionTicks
  const want = chooseTarget(m, hero, setup)
  if (want && want.id !== brain.target && brain.pending?.target !== want.id) {
    const delay = AI.reaction.min + Math.floor(next(m.ai) * (AI.reaction.max - AI.reaction.min + 1))
    if (brain.target < 0 || !m.heroes[brain.target].alive) brain.target = want.id
    else brain.pending = { target: want.id, at: m.tick + delay }
  }
  const target = brain.target >= 0 ? m.heroes[brain.target] : undefined
  brain.cast = undefined
  if (!target || !target.alive) return
  let best: { slot: NonNullable<BrainState['cast']>['slot']; escape: boolean; priority: number } | undefined
  for (const slot of CAST_SLOTS) {
    if (hero.cooldowns[slot] > 0) continue
    const t = setup.kit[slot]
    const verdict = wants(m, hero, setup, t, target)
    if (verdict.ok && (!best || t.ai.priority > best.priority)) best = { slot, escape: !!verdict.escape, priority: t.ai.priority }
  }
  if (best) brain.cast = { slot: best.slot, escape: best.escape }
  const threat = incoming(m, hero, setups)
  if (threat && next(m.ai) < AI.dodgeChance) {
    const len = Math.sqrt(threat.step.x * threat.step.x + threat.step.z * threat.step.z) || 1
    const side = next(m.ai) < 0.5 ? 1 : -1
    brain.action = 'dodge'
    brain.dodgeUntil = m.tick + AI.dodgeTicks
    // sidestep across the shot's path; in the air, juke up or down as well
    brain.dodge = { x: (-threat.step.z / len) * side, z: (threat.step.x / len) * side, vertical: hero.airborne ? (next(m.ai) < 0.5 ? 1 : -1) : 0 }
  } else if (m.tick >= brain.dodgeUntil) {
    const gap = gapTo(hero, target)
    if (hpFraction(hero) < AI.retreatBelow && nearestGap(m, hero) <= AI.nearRadius && !best) brain.action = 'retreat'
    else brain.action = gap > preferredDistance(setup) + 0.5 ? 'approach' : 'hold'
    if (next(m.ai) < AI.strafeFlip) brain.strafe = brain.strafe === 1 ? -1 : 1
  }
}

const steps = (angle: number) => {
  const a = wrapAngle(angle)
  return Math.round(((a < 0 ? a + TAU : a) / TAU) * AIM_STEPS) % AIM_STEPS
}

function command(m: MatchState, hero: HeroState, setup: HeroSetup, brain: BrainState): Command {
  if (brain.pending && m.tick >= brain.pending.at) {
    brain.target = brain.pending.target
    brain.pending = undefined
  }
  const target = brain.target >= 0 ? m.heroes[brain.target] : undefined
  if (!target || !target.alive) return { moveX: 0, moveZ: 0, vertical: 0, aimYaw: steps(brain.yaw), aimPitch: steps(brain.pitch), buttons: 0 }
  const from = chest(hero)
  const castTemplate = brain.cast ? setup.kit[brain.cast.slot] : undefined
  const shotSpeed = (castTemplate ?? setup.kit.basic).delivery.kind === 'projectile' ? ((castTemplate ?? setup.kit.basic).delivery.speed ?? 30) : undefined
  let wanted = anglesTo(from, aimPoint(m, brain, from, target, shotSpeed))
  if (brain.cast?.escape) wanted = { yaw: wanted.yaw + PI, pitch: 0.15 }
  const swung = brain.seen?.target !== target.id
  const off = trackAim(m, brain, wanted, swung)
  brain.seen = { x: target.position.x, y: target.position.y, z: target.position.z, tick: m.tick, target: target.id }

  // movement
  const dx = target.position.x - hero.position.x
  const dz = target.position.z - hero.position.z
  const flat = Math.sqrt(dx * dx + dz * dz) || 1
  let moveX = 0
  let moveZ = 0
  let vertical: -1 | 0 | 1 = 0
  const dy = target.position.y - hero.position.y
  if (m.tick < brain.dodgeUntil) ({ x: moveX, z: moveZ, vertical } = brain.dodge)
  else if (brain.action === 'approach') [moveX, moveZ] = [dx / flat, dz / flat]
  else if (brain.action === 'retreat') [moveX, moveZ] = [-dx / flat, -dz / flat]
  else [moveX, moveZ] = [(-dz / flat) * brain.strafe * 0.6, (dx / flat) * brain.strafe * 0.6]
  // follow a target into the air, and come back down when it lands
  if (m.tick >= brain.dodgeUntil && Math.abs(dy) > 1) vertical = dy > 0 ? 1 : -1

  // buttons: a decided skill fires once the aim settles (self and auras need no aim); the basic attack when in reach
  let buttons = 0
  const kind = castTemplate?.delivery.kind
  const aimless = kind === 'self' || kind === 'aura' || (kind === 'zone' && !castTemplate?.delivery.range)
  if (brain.cast && (aimless || off <= AI.fireTolerance || brain.cast.escape)) {
    buttons |= slotBit(brain.cast.slot as BuildSlot)
    brain.cast = undefined
  }
  if (off <= AI.fireTolerance && gapTo(hero, target) <= setup.kit.basic.delivery.range + ENGINE.meleeSlack) buttons |= slotBit('basic')
  return { moveX, moveZ, vertical, aimYaw: steps(brain.yaw), aimPitch: steps(brain.pitch), buttons }
}

/** Commands for every hero this tick; the human-controlled hero is left to its player (KTD4). */
export function aiCommands(arena: Arena): (Command | undefined)[] {
  const m = arena.match
  m.brains ??= m.heroes.map(newBrain)
  return m.heroes.map((hero, i) => {
    if (!hero.alive || m.human === i) return undefined
    const brain = m.brains![i]
    if (m.tick >= brain.nextDecision) decide(m, hero, arena.setups[i], brain, arena.setups)
    return command(m, hero, arena.setups[i], brain)
  })
}
