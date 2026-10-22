import { RUINS, initialCoverHealth, type CoverPiece } from './cover'
import { keepOut } from './locomotion'
import type { Build } from '../../charter/build'
import { ENGINE, ticks } from './calibration'
import { COMBAT_RULES } from './deliveries'
import { initHero } from './effects'
import { clamp, type Vec3 } from './maths'
import { next } from './rng'
import { createHero, emptyMatch, prepareHero, type Command, type HeroSetup, type MatchState, type Team } from './state'
import { tick, type TickRules } from './tick'

/**
 * Match setup and rules (U5, KTD5). Two profiles share every rule: the live match runs a long timer, and the
 * balance gate's duels run a short one with a damage ramp so each ends quickly.
 */

export interface Profile {
  timerSeconds: number
  damageRamp?: { fromSeconds: number; perSecond: number }
}

export const LIVE_PROFILE: Profile = { timerSeconds: 300 }
export const GATE_PROFILE: Profile = { timerSeconds: 60, damageRamp: { fromSeconds: 40, perSecond: 0.05 } }
/** Team fights in the balance report need longer to play out than duels. */
export const GATE_TEAM_PROFILE: Profile = { timerSeconds: 120, damageRamp: { fromSeconds: 40, perSecond: 0.05 } }

/** A hero entering a match; army synergy has already set its power scale and damage bonus. */
export interface Combatant {
  build: Build
  powerScale?: number
  damageBonus?: number
}

export interface Arena {
  match: MatchState
  setups: HeroSetup[]
  profile: Profile
  timerTicks: number
}

/** Starting gap between the two sides and between teammates in the default line, metres. */
export const DEFAULT_FORMATION = { startDistance: 22, lineSpacing: 2.5 }

function defaultSpot(match: MatchState, side: Team, index: number, count: number): Vec3 {
  const z = (side === 0 ? -1 : 1) * (DEFAULT_FORMATION.startDistance / 2 + next(match.rules) * 2)
  const x = (index - (count - 1) / 2) * DEFAULT_FORMATION.lineSpacing + (next(match.rules) - 0.5)
  return { x, y: 0, z }
}

/** Keep a staged spot on its own half of the arena (R1, R2). */
function ownHalf(side: Team, p: Vec3): Vec3 {
  const z = side === 0 ? Math.min(-0.5, p.z) : Math.max(0.5, p.z)
  return { x: clamp(p.x, -ENGINE.arena.halfWidth, ENGINE.arena.halfWidth), y: clamp(p.y, 0, ENGINE.arena.ceiling), z }
}

export function createMatch(
  teamA: Combatant[],
  teamB: Combatant[],
  seed: number,
  /** `cover: false` plays on an open floor (tests); the default is the ruins every real match uses. */
  options: { profile?: Profile; formations?: [Vec3[]?, Vec3[]?]; cover?: readonly CoverPiece[] | false } = {},
): Arena {
  const profile = options.profile ?? LIVE_PROFILE
  const match = emptyMatch(seed)
  const pieces = options.cover === undefined ? RUINS : options.cover
  if (pieces) match.cover = { pieces, health: initialCoverHealth(pieces) }
  const setups: HeroSetup[] = []
  const add = (team: Combatant[], side: Team) =>
    team.forEach((c, i) => {
      const setup = prepareHero(c.build, c.powerScale ?? 1, c.damageBonus ?? 0)
      const staged = options.formations?.[side]?.[i]
      const spot = staged ? ownHalf(side, staged) : defaultSpot(match, side, i, team.length)
      const hero = createHero(setup, setups.length, side, spot)
      // nobody starts inside the stone: a spot on a wall moves to its nearest face
      keepOut(hero, match)
      initHero(hero, setup)
      setups.push(setup)
      match.heroes.push(hero)
    })
  add(teamA, 0)
  add(teamB, 1)
  if (profile.damageRamp) match.damageRamp = { fromTick: ticks(profile.damageRamp.fromSeconds), perSecond: profile.damageRamp.perSecond }
  return { match, setups, profile, timerTicks: ticks(profile.timerSeconds) }
}

/** Share of a side's starting health still standing. */
export function healthShare(match: MatchState, side: Team): number {
  let hp = 0
  let max = 0
  for (const h of match.heroes) {
    if (h.team !== side) continue
    max += h.maxHp
    if (h.alive) hp += h.hp
  }
  return max > 0 ? hp / max : 0
}

/** Decide the match after a tick: a wipe ends it at once; at the timer, more heroes alive wins, then health share (R12). */
export function endCheck(arena: Arena): TickRules['after'] {
  return (match, _setups, events) => {
    if (match.winner !== undefined) return
    const alive = [0, 1].map((side) => match.heroes.filter((h) => h.alive && h.team === side).length)
    if (!alive[0] || !alive[1]) {
      match.winner = alive[0] ? 0 : alive[1] ? 1 : 'draw'
      match.endReason = 'wipe'
    } else if (match.tick >= arena.timerTicks) {
      const [a, b] = [healthShare(match, 0), healthShare(match, 1)]
      match.winner = alive[0] !== alive[1] ? (alive[0] > alive[1] ? 0 : 1) : a !== b ? (a > b ? 0 : 1) : 'draw'
      match.endReason = 'time'
    } else return
    events.push({ type: 'end', winner: match.winner, reason: match.endReason })
  }
}

export function matchRules(arena: Arena): TickRules {
  const end = endCheck(arena)
  return {
    statuses: COMBAT_RULES.statuses,
    act: COMBAT_RULES.act,
    after: (match, setups, events) => {
      COMBAT_RULES.after?.(match, setups, events)
      end?.(match, setups, events)
    },
  }
}

export interface MatchResult {
  winner: Team | 'draw'
  reason: 'wipe' | 'time'
  seconds: number
  heroes: { name: string; team: Team; alive: boolean; hpFraction: number; damageDealt: number; dps: number }[]
}

export function result(arena: Arena): MatchResult {
  const { match, setups } = arena
  const seconds = match.tick / ENGINE.tickHz
  return {
    winner: match.winner ?? 'draw',
    reason: match.endReason ?? 'time',
    seconds,
    heroes: match.heroes.map((h) => ({
      name: setups[h.id].build.heroName,
      team: h.team,
      alive: h.alive,
      hpFraction: Math.round((h.hp / h.maxHp) * 1000) / 1000,
      damageDealt: Math.round(h.damageDealt),
      dps: seconds > 0 ? Math.round((h.damageDealt / seconds) * 10) / 10 : 0,
    })),
  }
}

/** Run a whole match headless with a command source for every hero (the AI, a script or a replay log). */
export function play(arena: Arena, commands: (arena: Arena) => (Command | undefined)[]): MatchResult {
  const rules = matchRules(arena)
  while (arena.match.winner === undefined) tick(arena.match, arena.setups, commands(arena), rules)
  return result(arena)
}
