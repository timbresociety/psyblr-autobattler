import { geometryOf } from '../../charter/geometry.js'
import type { BuildSlot, Template } from '../../charter/types.js'
import { ENGINE, ticks } from '../engine/calibration.js'
import { coverHit } from '../engine/cover.js'
import { canSee, chest, free, isRanged as rangedBasic } from '../engine/deliveries.js'
import { alliesOf, enemiesOf, hpFraction } from '../engine/effects.js'
import { PI, TAU, cos, distance, dot, length, lengthSq, sin, sub, wrapAngle } from '../engine/maths.js'
import type { Arena } from '../engine/match.js'
import { next } from '../engine/rng.js'
import { AIM_STEPS, bodyRadius, capsule, MOVES, slotBit, standing, type BrainState, type Command, type HeroSetup, type HeroState, type MatchState } from '../engine/state.js'
import { aimPoint, anglesTo, trackAim } from './aim.js'
import { AI, useLevel } from './calibration.js'
import { findPath, followRoute, navFor, nodeAt, type NavGraph } from './nav.js'
import { MAPS } from '../engine/maps.js'
import { floorUnder } from '../engine/cover.js'
import { VAULT, edgeAt, insideEdge } from '../engine/house-rules.js'

/**
 * The demo AI (KTD7, R17, R18, R31): utility scoring over a small action set, re-decided every 150 ms, with a thin
 * human layer on top (reaction delay, laggy aim, dodges, team focus). Template usage hints feed the scores. It plays
 * every hero nobody controls, on both sides, and its memory lives in the match state.
 */

/** The skills it decides to cast; the ranged weapon (LMB) is fired like the melee, by reach, and F is a toggle. */
const CAST_SLOTS: NonNullable<BrainState['cast']>['slot'][] = ['movement', 'ultimate', 'active2']

/**
 * Whether the AI fights this hero from range: a role that keeps its distance (every hero has a weapon of each kind,
 * GAME.md §4). An assassin dives whatever it throws.
 */
const isRanged = (setup: HeroSetup) => rangedBasic(setup)

const gapTo = (from: HeroState, to: HeroState) => Math.max(0, distance(from.position, to.position) - capsule(from).radius - capsule(to).radius)
const nearestGap = (m: MatchState, h: HeroState) => enemiesOf(m, h).reduce((d, e) => Math.min(d, gapTo(h, e)), Infinity)

export function preferredDistance(setup: HeroSetup): number {
  return isRanged(setup) ? setup.kit.active1.delivery.range * AI.rangedHold : setup.kit.basic.delivery.range * 0.9
}

function reach(setup: HeroSetup, t: Template): number {
  const d = t.delivery
  // a turret is worth placing wherever its gun reaches the target from the spot it lands on
  const gun = t.effects.find((e) => e.kind === 'turret')
  if (gun?.kind === 'turret') return d.range + gun.range * 0.8
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

// a skill that only changes its caster (a transformation) needs no crowd of enemies to be worth casting
const HOSTILE = new Set<Template['effects'][number]['kind']>(['damage', 'stun', 'slow', 'displace', 'pull', 'knockup', 'control', 'debuff', 'turret'])
const hurtsEnemies = (t: Template) => t.effects.some((e) => HOSTILE.has(e.kind))
const helpsFriends = (t: Template) => t.effects.some((e) => e.kind === 'heal' || e.kind === 'shield' || (e.kind === 'buff' && e.target === 'allies') || (e.kind === 'state' && e.target !== 'self'))

/** Control a cleanse or unstoppable can lift: anything that leaves a hero able to act but hampered, or helpless. */
function lockedDown(h: HeroState, now: number): boolean {
  if (h.stunnedUntil > now || h.slows.some((s) => s.until > now && s.pct >= 30)) return true
  return (['root', 'silence', 'disarm', 'sleep', 'blind', 'grounded', 'fear', 'taunt'] as const).some((c) => h.cc[c] > now)
}

/**
 * A target deep in its own crowd: this many other enemies around it. Only a big fight has crowds like that (a 3v3 never
 * does), and a diver that dashes into one dies in seconds, so divers wait for the target to come out of it.
 */
const crowded = (m: MatchState, hero: HeroState, target: HeroState) =>
  enemiesOf(m, hero).filter((e) => e !== target && distance(e.position, target.position) <= AI.crowdRadius).length >= AI.crowdSize

/** An enemy in stealth is out of sight unless it is marked away or close enough to give itself away. */
const hidden = (m: MatchState, hero: HeroState, e: HeroState) => e.stealthUntil > m.tick && gapTo(hero, e) > ENGINE.revealRange

/** Whether a template's usage hint fits the moment (ported from the balance AI). */
function wants(m: MatchState, hero: HeroState, setup: HeroSetup, t: Template, target: HeroState): { ok: boolean; escape?: boolean } {
  const hint = t.ai
  const inReach = gapTo(hero, target) <= reach(setup, t)
  if (hint.selfHealthBelow !== undefined && hint.use !== 'escape' && hint.use !== 'sustain' && hpFraction(hero) >= hint.selfHealthBelow) return { ok: false }
  if (hint.targetHealthBelow !== undefined && hpFraction(target) >= hint.targetHealthBelow) return { ok: false }
  // a skill meant for a crowd waits for one, unless fewer enemies than that are left: then all of them will do
  const enemies = enemiesOf(m, hero)
  const crowd = Math.min(hint.minTargets ?? 0, enemies.length)
  if (crowd && hurtsEnemies(t) && enemies.filter((e) => distance(e.position, target.position) <= (t.delivery.radius ?? 2) + 1).length < crowd) return { ok: false }
  const near = nearestGap(m, hero)
  // a cleanse or an unstoppable is for control, so it fires when it would free someone, whatever else it does
  const frees = t.effects.find((e) => e.kind === 'state' && (e.type === 'cleanse' || e.type === 'unstoppable'))
  if (frees?.kind === 'state') {
    const reachAllies = Math.max(t.delivery.range, ENGINE.alliesRadius) + (t.delivery.radius ?? 0)
    const freed = frees.target === 'self' ? [hero] : alliesOf(m, hero).filter((a) => distance(hero.position, a.position) <= reachAllies)
    if (freed.some((a) => lockedDown(a, m.tick))) return { ok: true }
  }
  // no diving into a crowd: a movement skill that closes on the target waits until the target is out of it
  if (t.slot === 'movement' && hint.use === 'engage' && crowded(m, hero, target)) return { ok: false }
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

/**
 * Team focus: assassins hunt the weakest within their hunting reach (diving through a whole team for a far target was
 * suicide); others take the weakest in easy reach, else the nearest.
 */
function chooseTarget(m: MatchState, hero: HeroState, setup: HeroSetup): HeroState | undefined {
  const enemies = enemiesOf(m, hero).filter((e) => !hidden(m, hero, e))
  if (!enemies.length) return undefined
  const effective = (e: HeroState) => e.hp + e.shield
  if (setup.build.roleId === 'assassin') {
    const prey = enemies.filter((e) => gapTo(hero, e) <= AI.huntReach)
    if (prey.length) return prey.reduce((a, b) => (hpFraction(b) < hpFraction(a) - 1e-9 ? b : a))
  }
  const nearestOne = () => enemies.reduce((a, b) => (gapTo(hero, b) < gapTo(hero, a) - 1e-9 ? b : a))
  // a weaker player's bot just goes for whoever is nearest, some of the time (§2: worse target choice)
  if (AI.targetSmart < 1 && next(m.ai) > AI.targetSmart) return nearestOne()
  const scan = preferredDistance(setup) + AI.focusReach
  const inReach = enemies.filter((e) => gapTo(hero, e) <= scan)
  // a target it can actually shoot beats one hiding behind the ruins (R25)
  const visible = inReach.filter((e) => canSee(m, chest(hero), chest(e)))
  const pool = visible.length ? visible : inReach
  if (pool.length) return pool.reduce((a, b) => (effective(b) < effective(a) - 1e-9 ? b : a))
  return enemies.reduce((a, b) => (gapTo(hero, b) < gapTo(hero, a) - 1e-9 ? b : a))
}

/** How far a hero has pushed toward the enemy: blue (side 0) advances along +z, red along -z. */
const progressOf = (h: HeroState) => (h.team === 0 ? h.position.z : -h.position.z)

/**
 * The team's front line: its most advanced living tank or, with no tank left, fighter, other than this hero, and
 * whether it has met the enemy yet. Undefined for a hero fighting alone or leading itself, so a duel is never held.
 */
function frontOf(m: MatchState, hero: HeroState, setups: readonly HeroSetup[]): { progress: number; clashing: boolean } | undefined {
  const lines = frontLines(m, hero.team, setups)
  for (const [first, second] of lines) {
    const best = first && first.id !== hero.id ? first : second
    if (best) return { progress: progressOf(best), clashing: clashing(m, best) }
  }
  return undefined
}

/**
 * Each team's two most advanced living tanks and fighters, worked out once a tick (with a hundred heroes, every hero
 * looking for its own front line was a scan of everyone by everyone).
 */
const fronts = new WeakMap<MatchState, { tick: number; teams: Map<number, [HeroState?, HeroState?][]>; clash: Map<number, boolean> }>()
function frontLines(m: MatchState, team: number, setups: readonly HeroSetup[]): [HeroState?, HeroState?][] {
  let f = fronts.get(m)
  if (!f || f.tick !== m.tick) fronts.set(m, (f = { tick: m.tick, teams: new Map(), clash: new Map() }))
  let lines = f.teams.get(team)
  if (lines) return lines
  lines = (['tank', 'fighter'] as const).map((role) => {
    let first: HeroState | undefined
    let second: HeroState | undefined
    for (const a of m.heroes) {
      if (!a.alive || a.team !== team || setups[a.id].build.roleId !== role) continue
      if (!first || progressOf(a) > progressOf(first)) (second = first), (first = a)
      else if (!second || progressOf(a) > progressOf(second)) second = a
    }
    return [first, second]
  })
  f.teams.set(team, lines)
  return lines
}
function clashing(m: MatchState, h: HeroState): boolean {
  const c = fronts.get(m)!.clash
  let v = c.get(h.id)
  if (v === undefined) c.set(h.id, (v = nearestGap(m, h) <= AI.clashGap))
  return v
}

function newBrain(hero: HeroState): BrainState {
  return { nextDecision: 0, target: -1, action: 'approach', strafe: hero.id % 2 ? 1 : -1, dodgeUntil: 0, dodge: { x: 0, z: 0 }, press: 0, nextDash: 0, slideUntil: 0, yaw: hero.yaw, pitch: 0, overshoot: 0, detour: 0, heavy: false, guard: false, chain: true, toggle: false }
}

/** The far side of the nearest piece of cover from `threat`, within reach: where a hurt hero breaks line of sight. */
function hidingSpot(m: MatchState, hero: HeroState, threat: HeroState): { x: number; z: number } | undefined {
  if (!m.cover) return undefined
  let best: { x: number; z: number; d: number } | undefined
  m.cover.pieces.forEach((piece, i) => {
    const feet = hero.position.y
    if (m.cover!.health[i] === 0 || piece.base > feet + 0.5 || piece.top < feet + 1.6) return
    const s = piece.shape
    const extent = s.kind === 'column' ? s.r : Math.max(s.hx, s.hz)
    const ax = s.x - threat.position.x
    const az = s.z - threat.position.z
    const len = Math.sqrt(ax * ax + az * az) || 1
    const x = s.x + (ax / len) * (extent + bodyRadius(hero) + 0.6)
    const z = s.z + (az / len) * (extent + bodyRadius(hero) + 0.6)
    const d = Math.sqrt((x - hero.position.x) * (x - hero.position.x) + (z - hero.position.z) * (z - hero.position.z))
    // on a map in levels the spot has to be on the hero's own floor, not down a trench beside it
    if (m.map && Math.abs(floorUnder(m.cover!.pieces, m.cover!.health, { x, y: feet, z }, feet + ENGINE.move.step) - feet) > ENGINE.move.step) return
    if (d <= AI.hideReach && (!best || d < best.d)) best = { x, z, d }
  })
  return best && { x: best.x, z: best.z }
}

/**
 * Steer a wanted ground direction around the ruins: look a few metres ahead and, if a wall is there, walk along it,
 * keeping the same side until the way clears. Low cover is vaulted on the way to a distant target (R25); with the
 * target just behind it, vaulting only lands the hero on top, swinging at stone, so it walks round like any wall.
 */
function steer(m: MatchState, hero: HeroState, brain: BrainState, mx: number, mz: number, vault: boolean): { x: number; z: number; hop: boolean } {
  const len = Math.sqrt(mx * mx + mz * mz)
  if (!m.cover || len < 1e-6) return { x: mx, z: mz, hop: false }
  const p = hero.position
  const waist = { x: p.x, y: p.y + 0.9, z: p.z }
  const ahead = (x: number, z: number) => coverHit(m.cover!.pieces, m.cover!.health, waist, { x: p.x + (x / len) * AI.probe, y: p.y + 0.9, z: p.z + (z / len) * AI.probe }, bodyRadius(hero))
  const wall = ahead(mx, mz)
  // the side it last walked around a wall is kept, so it rounds corners instead of turning back at them
  if (!wall) return { x: mx, z: mz, hop: false }
  if (vault && m.cover.pieces[wall.index].top - p.y <= AI.hopHeight) return { x: mx, z: mz, hop: true }
  if (brain.detour === 0) brain.detour = brain.strafe
  // walk along the wall, leaning a little toward where it wants to go; switch sides if that way is blocked too
  const first: 1 | -1 = brain.detour === -1 ? -1 : 1
  for (const side of [first, first === 1 ? -1 : 1] as const) {
    const tx = -mz * side
    const tz = mx * side
    if (!ahead(tx, tz)) {
      brain.detour = side
      return { x: tx * 0.85 + mx * 0.15, z: tz * 0.85 + mz * 0.15, hop: false }
    }
  }
  // boxed in: go up and over
  return { x: mx, z: mz, hop: true }
}

/** A projectile from an enemy heading close enough to hit, within sight. */
function incoming(m: MatchState, hero: HeroState, setups: readonly HeroSetup[]) {
  const me = chest(hero)
  for (const p of m.projectiles) {
    if (m.heroes[p.owner].team === hero.team) continue
    const to = sub(me, p.position)
    const along = dot(to, p.step)
    const stepLen = lengthSq(p.step)
    const dist = length(to)
    if (along <= 0 || dist > AI.seeDistance || stepLen === 0) continue
    const t = along / stepLen
    const size = geometryOf(setups[p.owner].kit[p.slot].delivery).projectileRadius
    const closest = { x: p.position.x + p.step.x * t - me.x, y: p.position.y + p.step.y * t - me.y, z: p.position.z + p.step.z * t - me.z }
    if (length(closest) <= capsule(hero).radius + size + 0.6) return p
  }
  return undefined
}

/** Whether an enemy in reach is winding up a close blow (a melee or cone attack) while facing this hero. */
function swingAt(m: MatchState, hero: HeroState, setups: readonly HeroSetup[]): boolean {
  for (const e of m.heroes) {
    const a = e.action
    if (!standing(e) || e.team === hero.team || !a || a.released) continue
    const d = setups[e.id].kit[a.slot].delivery
    if (d.kind !== 'melee' && d.kind !== 'cone') continue
    if (gapTo(e, hero) > d.range + ENGINE.meleeSlack) continue
    const dx = hero.position.x - e.position.x
    const dz = hero.position.z - e.position.z
    const len = Math.sqrt(dx * dx + dz * dz) || 1
    if ((dx / len) * sin(e.yaw) + (dz / len) * cos(e.yaw) > 0.5) return true
  }
  return false
}

/** The nav graph of the map a match plays on, when it is built in levels. */
function graphOf(m: MatchState): NavGraph | undefined {
  const map = m.map && MAPS[m.map]
  return map && map.levels ? navFor(map.pieces, map.lines) : undefined
}

/**
 * Across a map in levels (GAME.md §8) a target on another floor, or far off, is reached along the nav graph: the
 * route is planned to the node under the target and kept while the target stays near that node, re-planned at most
 * every `AI.replanTicks` otherwise. Close by on the same floor, the hero walks straight at it as on flat ground.
 */
function plan(m: MatchState, hero: HeroState, brain: BrainState, at: { x: number; y: number; z: number }, place = false) {
  const g = graphOf(m)
  if (!g || hero.airborne || hero.zip || hero.mantle || hero.travel) return
  const goal = nodeAt(g, at)
  const from = nodeAt(g, hero.position)
  if (goal < 0 || from < 0) return
  const dx = at.x - hero.position.x
  const dz = at.z - hero.position.z
  // a place the rules send it (`place`) is walked straight at only on the same floor: on the balcony overhead it is a
  // route away, however near it looks
  if (g.nodes[goal].region === g.nodes[from].region && dx * dx + dz * dz < AI.directRange * AI.directRange && (!place || Math.abs(at.y - hero.position.y) < ENGINE.move.step + 1)) {
    brain.route = undefined
    return
  }
  const r = brain.route
  // a route over a bridge that has just fallen is planned again at once
  const fallen = (i: number) => g.nodes[i].on !== undefined && m.cover?.health[g.nodes[i].on!] === 0
  // in a crowd, routes age out a few ticks apart hero by hero, so heroes that planned together do not replan in one tick
  if (r && r.at < r.path.length && m.tick - r.planned < AI.replanTicks + (m.heroes.length > CROWD ? hero.id % 16 : 0) && !r.path.slice(r.at).some(fallen)) {
    const was = g.nodes[r.goal]
    const now = g.nodes[goal]
    if (was.region === now.region && (was.x - now.x) * (was.x - now.x) + (was.z - now.z) * (was.z - now.z) < 16) return
  }
  const path = findPath(g, from, goal, { jumpScale: ENGINE.move.jumpScale[hero.size], health: m.cover?.health })
  brain.route = path ? { path, at: 0, goal, planned: m.tick } : undefined
}

/** More heroes than a 10 v 10: the crowd path's habits switch on. */
const CROWD = 20

/**
 * How many decisions' worth of ticks pass before this hero decides again: more, the further it is from the player.
 * With nobody playing (the balance gate, a watched AI match) every hero thinks at the full rate.
 */
export function thinkEvery(m: MatchState, hero: HeroState): number {
  const player = m.human !== undefined ? m.heroes[m.human] : undefined
  if (!player?.alive) return 1
  const dx = player.position.x - hero.position.x
  const dz = player.position.z - hero.position.z
  const d2 = dx * dx + dz * dz
  let every = 1
  for (const t of AI.think) if (d2 > t.from * t.from) every = t.every
  return every
}

/**
 * Where the house's rules (GAME.md §2) send a hero before its target: inside the edge, when the edge will have passed
 * it a few seconds from now (to the spot the edge closes on, which every step of it keeps inside); else to the vault,
 * while it's open and not its squad's and no fight is close by. Undefined to fight on as usual.
 */
function objective(m: MatchState, hero: HeroState, target: HeroState | undefined): { x: number; y: number; z: number } | undefined {
  const house = m.house
  if (!house) return undefined
  const spot = house.spot
  const ahead = edgeAt(spot, m.tick + ticks(AI.edgeAhead))
  if (!insideEdge(ahead, hero.position, AI.edgeMargin)) return { x: spot.x, y: spot.floor, z: spot.z }
  const vault = house.vault
  if (!vault.open || vault.holder === hero.team || !insideEdge(ahead, VAULT.at, AI.edgeMargin)) return undefined
  // the squad's runners are the heroes nearest the vault: they leave all but a fight at arm's length to work it
  const d2 = (h: HeroState) => lengthSq(sub(h.position, VAULT.at))
  const mine = d2(hero)
  let nearer = 0
  for (const a of m.heroes) if (a.alive && a.team === hero.team && a.id !== hero.id && (d2(a) < mine || (d2(a) === mine && a.id < hero.id))) nearer++
  const commit = nearer < AI.vaultRunners ? AI.runnerCommit : AI.vaultCommit
  return !target || gapTo(hero, target) > commit ? VAULT.at : undefined
}

function decide(m: MatchState, hero: HeroState, setup: HeroSetup, brain: BrainState, setups: readonly HeroSetup[]) {
  // in a crowd the first decision sets each hero's beat a few ticks apart, so they do not all think on the same tick
  const stagger = brain.nextDecision === 0 && m.heroes.length > CROWD ? hero.id % AI.decisionTicks : 0
  brain.nextDecision = m.tick + AI.decisionTicks + stagger
  const want = chooseTarget(m, hero, setup)
  if (want && want.id !== brain.target && brain.pending?.target !== want.id) {
    const delay = AI.reaction.min + Math.floor(next(m.ai) * (AI.reaction.max - AI.reaction.min + 1))
    if (brain.target < 0 || !standing(m.heroes[brain.target])) brain.target = want.id
    else brain.pending = { target: want.id, at: m.tick + delay }
  }
  // a target that slipped into stealth is lost until it shows itself again
  if (brain.target >= 0 && hidden(m, hero, m.heroes[brain.target])) brain.target = want?.id ?? -1
  const target = brain.target >= 0 ? m.heroes[brain.target] : undefined
  brain.cast = undefined
  brain.goal = objective(m, hero, target && standing(target) ? target : undefined)
  if (!target || !standing(target)) {
    if (brain.goal) plan(m, hero, brain, brain.goal, true)
    return
  }
  brain.nextDecision = m.tick + AI.decisionTicks * thinkEvery(m, hero) + stagger
  if (brain.goal) plan(m, hero, brain, brain.goal, true)
  else plan(m, hero, brain, target.position)
  let best: { slot: NonNullable<BrainState['cast']>['slot']; escape: boolean; priority: number } | undefined
  // a weaker bot often lets its skills sit ready (§2)
  const considers = AI.skillUse >= 1 || next(m.ai) < AI.skillUse
  for (const slot of considers ? CAST_SLOTS : []) {
    if (hero.cooldowns[slot] > 0) continue
    const t = setup.kit[slot]
    const verdict = wants(m, hero, setup, t, target)
    // a way out comes before anything else, however keen the rest are
    const escape = !!verdict.escape
    if (verdict.ok && (!best || (escape && !best.escape) || (escape === best.escape && t.ai.priority > best.priority))) best = { slot, escape, priority: t.ai.priority }
  }
  if (best) brain.cast = { slot: best.slot, escape: best.escape }
  brain.heavy = next(m.ai) < AI.heavyChance
  brain.guard = next(m.ai) < AI.guardChance[setup.build.roleId]
  brain.chain = AI.comboChance >= 1 || next(m.ai) < AI.comboChance
  brain.toggle = passiveWanted(m, hero, setup, target)
  const threat = incoming(m, hero, setups)
  if (threat && next(m.ai) < AI.dodgeChance) {
    const len = Math.sqrt(threat.step.x * threat.step.x + threat.step.z * threat.step.z) || 1
    const side = next(m.ai) < 0.5 ? 1 : -1
    brain.action = 'dodge'
    brain.dodgeUntil = m.tick + AI.dodgeTicks
    // sidestep across the shot's path, often with a dash while it has stamina to spare
    brain.dodge = { x: (-threat.step.z / len) * side, z: (threat.step.x / len) * side }
    // or rolls through it, untouchable for the roll's first moments
    if (hero.stamina >= AI.staminaKeep + 1) {
      const roll = next(m.ai)
      if (roll < AI.dodgeRoll) brain.press |= MOVES.dodge
      else if (roll < AI.dodgeRoll + AI.dodgeDash * (1 - AI.dodgeRoll)) brain.press |= MOVES.dash
    }
  } else if (m.tick >= brain.dodgeUntil) {
    const gap = gapTo(hero, target)
    // falls back only toward living teammates; alone, it fights to the end rather than kiting forever
    const allies = alliesOf(m, hero).length > 1
    if (allies && hpFraction(hero) < AI.retreatBelow && nearestGap(m, hero) <= AI.nearRadius && !best) {
      brain.action = 'retreat'
      brain.hide = hidingSpot(m, hero, target)
      // a hurt hero with an enemy on top of it dashes clear
      if (hero.stamina >= 1) brain.press |= MOVES.dash
    } else {
      // with no line on its target a hero moves until it has one, rather than shooting the wall; a sword in reach
      // across low cover would otherwise stand there swinging at stone, so it hops or rounds it too
      const blind = !canSee(m, chest(hero), chest(target))
      brain.action = gap > preferredDistance(setup) + 0.5 || blind ? 'approach' : 'hold'
      if (brain.action === 'approach' && !hero.airborne && !brain.route) {
        // a melee hero closes the last few metres with a dash; anyone with far to go slides now and then
        if (!isRanged(setup) && gap >= AI.dashGap.min && gap <= AI.dashGap.max && m.tick >= brain.nextDash && hero.stamina >= AI.staminaKeep + 1) {
          brain.press |= MOVES.dash
          brain.nextDash = m.tick + AI.dashEvery
        } else if (gap > AI.slideGap && m.tick >= brain.slideUntil && next(m.ai) < AI.slideChance) brain.slideUntil = m.tick + Math.round(ENGINE.move.slide.time * ENGINE.tickHz)
      }
    }
    if (next(m.ai) < AI.strafeFlip) brain.strafe = brain.strafe === 1 ? -1 : 1
  }
}

/**
 * Whether to press F now (§4 F): on as a fight starts while the meter has most of its energy (a power that lands
 * something as it switches on waits until it's needed), off again once no enemy is near, to save the meter.
 */
function passiveWanted(m: MatchState, hero: HeroState, setup: HeroSetup, target: HeroState): boolean {
  const passive = setup.kit.passive
  if (hero.passiveOn) return nearestGap(m, hero) > 25
  if (hero.energy < 0.6 || gapTo(hero, target) > preferredDistance(setup) + 6) return false
  if (passive.energy?.onSwitch && hpFraction(hero) > 0.65 && passive.effects.some((e) => e.kind === 'heal' || e.kind === 'shield')) return false
  return AI.passiveUse >= 1 || next(m.ai) < AI.passiveUse
}

const steps = (angle: number) => {
  const a = wrapAngle(angle)
  return Math.round(((a < 0 ? a + TAU : a) / TAU) * AIM_STEPS) % AIM_STEPS
}

function command(m: MatchState, hero: HeroState, setup: HeroSetup, brain: BrainState, setups: readonly HeroSetup[]): Command {
  if (brain.pending && m.tick >= brain.pending.at) {
    brain.target = brain.pending.target
    brain.pending = undefined
  }
  const target = brain.target >= 0 ? m.heroes[brain.target] : undefined
  if (!target || !standing(target) || hidden(m, hero, target)) return brain.goal ? walkTo(m, hero, brain, setup, brain.goal) : { moveX: 0, moveZ: 0, moves: 0, aimYaw: steps(brain.yaw), aimPitch: steps(brain.pitch), buttons: 0 }
  const from = chest(hero)
  const castTemplate = brain.cast ? setup.kit[brain.cast.slot] : undefined
  // out of melee reach it shoots its ranged weapon, so it leads the target by that weapon's shot speed
  const meleeReach = setup.kit.basic.delivery.range + ENGINE.meleeSlack
  const shooting = gapTo(hero, target) > meleeReach + 0.5
  const aimed = castTemplate ?? (shooting ? setup.kit.active1 : setup.kit.basic)
  const shotSpeed = aimed.delivery.kind === 'projectile' || aimed.delivery.kind === 'cone' ? geometryOf(aimed.delivery.kind === 'cone' ? { kind: 'projectile', range: aimed.delivery.range } : aimed.delivery).speed : undefined
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
  const closing = gapTo(hero, target) > preferredDistance(setup) + 0.5
  if (m.tick < brain.dodgeUntil) {
    // sidestep the shot, but keep closing in while doing it, the way a player weaves forward
    moveX = brain.dodge.x + (closing ? (dx / flat) * AI.dodgeAdvance : 0)
    moveZ = brain.dodge.z + (closing ? (dz / flat) * AI.dodgeAdvance : 0)
  } else if (brain.action === 'approach') [moveX, moveZ] = [dx / flat, dz / flat]
  else if (brain.action === 'retreat' && brain.hide) {
    const hx = brain.hide.x - hero.position.x
    const hz = brain.hide.z - hero.position.z
    const h = Math.sqrt(hx * hx + hz * hz)
    ;[moveX, moveZ] = h > 0.5 ? [hx / h, hz / h] : [0, 0]
  } else if (brain.action === 'retreat') [moveX, moveZ] = [-dx / flat, -dz / flat]
  else if (isRanged(setup)) [moveX, moveZ] = [(-dz / flat) * brain.strafe * 0.6, (dx / flat) * brain.strafe * 0.6]
  // melee in contact stays on the target instead of circling off it
  else if (closing) [moveX, moveZ] = [dx / flat, dz / flat]
  // the house's rules come first: it makes for the edge's safety or the vault, shooting as it goes
  const goal = brain.goal && m.tick >= brain.dodgeUntil ? brain.goal : undefined
  if (goal) [moveX, moveZ] = toward(hero, goal)
  // an assassin closing on a far target swings wide round the enemy's front instead of walking through it
  const role = setup.build.roleId
  if (role === 'assassin' && brain.action === 'approach' && gapTo(hero, target) > AI.flankGap) {
    // the sideways direction that points out toward the assassin's own flank
    const side = hero.position.x >= target.position.x ? 1 : -1
    let [px, pz] = [-dz / flat, dx / flat]
    if (px * side < 0) [px, pz] = [-px, -pz]
    moveX += px * AI.flankBend
    moveZ += pz * AI.flankBend
  }
  // the team moves as one (R31): tanks lead; fighters stride with the front and assassins and ranged heroes keep behind
  // it, so the first hero to arrive is not the one the whole enemy team burns down. Blades are let loose at the clash.
  const lead = AI.behindFront[role as keyof typeof AI.behindFront]
  if (lead !== undefined && !goal) {
    const front = frontOf(m, hero, setups)
    // an assassin waits for prey that is already busy with a teammate, or already hurt, before it commits
    const prey = role !== 'assassin' || hpFraction(target) < AI.preyBelow || alliesOf(m, hero).some((a) => a.id !== hero.id && gapTo(a, target) <= AI.busyGap)
    const loose = front?.clashing && (role === 'fighter' || role === 'assassin') && prey && !crowded(m, hero, target)
    if (front && !loose && progressOf(hero) >= front.progress - lead && (hero.team === 0 ? moveZ : -moveZ) > 0) moveZ = 0
  }
  // across a map in levels, the route: its own way round walls, up ledges and over gaps
  const g = brain.route && m.tick >= brain.dodgeUntil && (brain.action === 'approach' || closing || goal) ? graphOf(m) : undefined
  const routed = g && brain.route ? followRoute(g, hero, brain.route, m, setup.sheet.moveSpeed) : undefined
  if (brain.route && brain.route.at >= brain.route.path.length) brain.route = undefined
  // walk around walls, or hop low cover
  const steered = routed ? { ...routed, hop: false } : steer(m, hero, brain, moveX, moveZ, gapTo(hero, target) > AI.vaultReach)
  ;[moveX, moveZ] = [steered.x, steered.z]
  // movement buttons decided between ticks go now; low cover is jumped, and jumped again near the top of the jump
  let moves = brain.press
  brain.press = 0
  if (routed?.jump) moves |= MOVES.jump
  if (steered.hop) {
    if (!hero.airborne) moves |= MOVES.jump
    else if (hero.velocity.y < 1.5 && hero.airJumps === 0 && hero.stamina >= 1 && !(hero.held & MOVES.jump)) moves |= MOVES.jump
  }
  if (m.tick < brain.slideUntil && m.tick >= brain.dodgeUntil) moves |= MOVES.crouch

  // buttons: a decided skill fires once the aim settles (self and auras need no aim); the basic attack when in reach
  let buttons = 0
  const kind = castTemplate?.delivery.kind
  const aimless = kind === 'self' || kind === 'aura' || (kind === 'zone' && !castTemplate?.delivery.range)
  // aimed shots and swings wait for a clear line; blasts from above and self-casts do not
  // line of sight is checked only when a shot is otherwise ready, since it is the costly test
  let seen: boolean | undefined
  const sight = () => (seen ??= canSee(m, from, chest(target)))
  const lobbed = kind === 'zone' || kind === 'blink' || kind === 'dash' || kind === 'grapple'
  // a decided skill waits while the hero finishes what it's doing, rather than being pressed and lost
  if (brain.cast && free(hero, brain.cast.slot as BuildSlot, m.tick) && (aimless || brain.cast.escape || (off <= AI.fireTolerance && (lobbed || sight())))) {
    buttons |= slotBit(brain.cast.slot as BuildSlot)
    brain.cast = undefined
  }
  if (brain.toggle && !(hero.buttonsHeld & slotBit('passive'))) {
    buttons |= slotBit('passive')
    brain.toggle = false
  }
  // the ranged weapon, held while the target is out of melee reach and in its range, the aim settled and the line clear
  const weapon = setup.kit.active1.delivery
  if (shooting && !brain.cast && hero.reloadUntil === 0 && gapTo(hero, target) <= weapon.range && off <= AI.fireTolerance * (weapon.kind === 'cone' ? 2 : 1) && sight()) buttons |= slotBit('active1')
  // a sword swing only needs the target inside its arc; a shot needs the aim to settle
  const basic = setup.kit.basic.delivery
  const basicTolerance = basic.arcDegrees ? Math.max(AI.fireTolerance, ((basic.arcDegrees / 2) * PI) / 180 * AI.arcUse) : AI.fireTolerance
  // a guard goes up against a swing winding up at it, and nothing is struck while it is up
  if (brain.guard && swingAt(m, hero, setups)) return { moveX, moveZ, moves: moves | MOVES.block, aimYaw: steps(brain.yaw), aimPitch: steps(brain.pitch), buttons }
  // the basic attack strikes when let go (combat.ts), so the AI taps it as a player does: pressed one tick, up the next;
  // a heavy blow is held through its charge and let go
  const BASIC = slotBit('basic')
  const holding = hero.buttonsHeld & BASIC && hero.basicSince >= 0
  if (holding && brain.heavy) {
    if (m.tick - hero.basicSince < ticks(ENGINE.melee.heavyHold + AI.heavyCharge)) buttons |= BASIC
    else brain.heavy = false
  } else if (off <= basicTolerance && gapTo(hero, target) <= basic.range + ENGINE.meleeSlack && sight() && !(hero.buttonsHeld & BASIC) && (brain.chain || hero.combo.step === 0 || hero.combo.until < m.tick)) buttons |= BASIC
  return { moveX, moveZ, moves, aimYaw: steps(brain.yaw), aimPitch: steps(brain.pitch), buttons }
}

/** A flat unit step from the hero toward `at`, or none once it's there. */
function toward(hero: HeroState, at: { x: number; z: number }): [number, number] {
  const dx = at.x - hero.position.x
  const dz = at.z - hero.position.z
  const d = Math.sqrt(dx * dx + dz * dz)
  return d > 0.75 ? [dx / d, dz / d] : [0, 0]
}

/** With nobody to fight, a hero still makes for where the house's rules send it, along its route. */
function walkTo(m: MatchState, hero: HeroState, brain: BrainState, setup: HeroSetup, at: { x: number; y: number; z: number }): Command {
  const g = brain.route ? graphOf(m) : undefined
  const routed = g && brain.route ? followRoute(g, hero, brain.route, m, setup.sheet.moveSpeed) : undefined
  if (brain.route && brain.route.at >= brain.route.path.length) brain.route = undefined
  const [x, z] = toward(hero, at)
  const steered = routed ? { ...routed, hop: false } : steer(m, hero, brain, x, z, true)
  let moves = 0
  if (routed?.jump || (steered.hop && !hero.airborne)) moves |= MOVES.jump
  return { moveX: steered.x, moveZ: steered.z, moves, aimYaw: steps(brain.yaw), aimPitch: steps(brain.pitch), buttons: 0 }
}

/** Commands for every hero this tick; the human-controlled hero is left to its player (KTD4). */
export function aiCommands(arena: Arena): (Command | undefined)[] {
  const m = arena.match
  m.brains ??= m.heroes.map(newBrain)
  return m.heroes.map((hero, i) => {
    if (!hero.alive || m.human === i) return undefined
    const brain = m.brains![i]
    useLevel(m.aiLevels?.[hero.team])
    if (m.tick >= brain.nextDecision) decide(m, hero, arena.setups[i], brain, arena.setups)
    return command(m, hero, arena.setups[i], brain, arena.setups)
  })
}
