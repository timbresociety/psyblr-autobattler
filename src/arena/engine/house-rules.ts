import { ENGINE, ticks } from './calibration.js'
import type { MatchEvent } from './events.js'
import type { Vec3 } from './maths.js'
import type { HeroState, MatchState, Team } from './state.js'

/**
 * How a match on the House of Instinct is won (GAME.md §2, owner 2026-11-02): the last squad standing wins and nobody
 * respawns; the house edge closes in and hurts anyone left outside it, across levels as well as the floor; the House
 * Vault holds a jackpot that buffs the squad that cracks it and holds it, and can be stolen.
 *
 * Everything here is a pure function of the tick and the match's seed or of state kept in the match, so the AI and the
 * client read the same edge the engine applies, and a replay plays it the same.
 */

/** A spot the edge can close on: a floor on the mirror line (z = 0), so neither squad starts nearer to it. */
export interface EdgeSpot {
  name: string
  x: number
  z: number
  floor: number
}

/**
 * The safe region at one moment: a disc of radius `r` round (x, z) times the band of heights [lo, hi]. `dps` is what a
 * hero outside it loses each second, as a share of its maximum health.
 */
export interface Edge {
  x: number
  z: number
  r: number
  lo: number
  hi: number
  dps: number
  /** How many closes have begun; 0 while the opening hold lasts. */
  phase: number
  closing: boolean
  /** The second the edge next starts or stops moving; undefined once it has closed for good. */
  nextAt?: number
}

/**
 * The edge's schedule. It opens over the whole house (every floor, every corner), then each step holds until `at`
 * seconds and closes by `until` to a disc of `r` metres whose centre has come `toward` of the way to the spot, and a
 * band from `lo` to `hi` metres about the spot's floor. Outside it from that step on, a hero loses `dps` of its
 * health a second. The first two steps keep every floor but the farthest band from the spot; the last two pull the
 * fight onto the spot's own floor. The last step leaves a ring a squad can just stand in.
 */
export const EDGE = {
  start: { r: 76, lo: -10, hi: 40 },
  // timed on AI 10 v 10s, which wipe in one to two minutes: the first close lands as the squads first meet
  steps: [
    { at: 20, until: 50, r: 40, lo: -12, hi: 26, toward: 0.4, dps: 0.02 },
    { at: 60, until: 85, r: 22, lo: -7.5, hi: 14, toward: 0.75, dps: 0.04 },
    { at: 95, until: 120, r: 10, lo: -1.5, hi: 9, toward: 1, dps: 0.07 },
    { at: 130, until: 150, r: 3.5, lo: -0.5, hi: 5, toward: 1, dps: 0.12 },
  ],
  /** The edge's damage lands twice a second. */
  beat: 30,
} as const

/**
 * The House Vault, under Roulette Court: it cracks open `opensAt` seconds in. A squad with heroes inside and none of
 * the other squad's fills the meter; `crack` seconds of it takes the jackpot, `steal` seconds takes it from the squad
 * that holds it. With both squads inside the meter stops; with nobody inside it drains `drain` times as fast as it
 * fills. The squad holding the jackpot deals `buff` more damage.
 */
export const VAULT = {
  box: { x0: -8, x1: 8, z0: -6, z1: 6, y0: -0.5, y1: 3.5 },
  at: { x: 0, y: 0, z: 0 },
  opensAt: 20,
  crack: 8,
  steal: 6,
  drain: 0.5,
  buff: 0.15,
} as const

/** The house's rules on a match: the edge's spot, chosen from the seed, and the vault. */
export interface HouseState {
  spot: EdgeSpot
  vault: VaultState
}

export interface VaultState {
  open: boolean
  holder?: Team
  /** The squad filling the meter, and how far it has filled it, in ticks. */
  by?: Team
  meter: number
}

export interface HouseRules {
  spots: readonly EdgeSpot[]
}

/** The house's rules for a new match: the edge closes on one of the map's spots, picked by the seed. */
export function houseState(rules: HouseRules, seed: number): HouseState {
  const spots = rules.spots
  return { spot: spots[((seed % spots.length) + spots.length) % spots.length], vault: { open: false, meter: 0 } }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** The edge at `tick` for a match closing on `spot`. */
export function edgeAt(spot: EdgeSpot, tick: number): Edge {
  const s = tick / ENGINE.tickHz
  let from: { x: number; z: number; r: number; lo: number; hi: number } = { x: 0, z: 0, r: EDGE.start.r, lo: EDGE.start.lo, hi: EDGE.start.hi }
  let dps = 0
  let phase = 0
  for (const step of EDGE.steps) {
    const to = { x: spot.x * step.toward, z: spot.z * step.toward, r: step.r, lo: spot.floor + step.lo, hi: spot.floor + step.hi }
    if (s < step.at) return { ...from, dps, phase, closing: false, nextAt: step.at }
    phase += 1
    dps = step.dps
    if (s < step.until) {
      const t = (s - step.at) / (step.until - step.at)
      return { x: lerp(from.x, to.x, t), z: lerp(from.z, to.z, t), r: lerp(from.r, to.r, t), lo: lerp(from.lo, to.lo, t), hi: lerp(from.hi, to.hi, t), dps, phase, closing: true, nextAt: step.until }
    }
    from = to
  }
  return { ...from, dps, phase, closing: false }
}

/** Whether a hero standing at `p` (its feet) is inside the edge; `margin` metres in from it, for a hero being careful. */
export function insideEdge(edge: Edge, p: Vec3, margin = 0): boolean {
  const dx = p.x - edge.x
  const dz = p.z - edge.z
  const r = Math.max(0, edge.r - margin)
  return dx * dx + dz * dz <= r * r && p.y >= edge.lo + Math.min(margin, 0.25) && p.y <= edge.hi - margin
}

/** When the edge has fully closed: after it, the match timer's safety net may end a match still going. */
export const EDGE_CLOSED_SECONDS = EDGE.steps[EDGE.steps.length - 1].until

export function inVault(p: Vec3): boolean {
  const b = VAULT.box
  return p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1 && p.y >= b.y0 && p.y <= b.y1
}

/** The extra share of damage a hero deals while its squad holds the jackpot. */
export function jackpotBonus(match: MatchState, hero: HeroState): number {
  return match.house?.vault.holder === hero.team ? VAULT.buff : 0
}

/** The house's rules for one tick, after everyone has acted: the edge hurts whoever is outside, the vault fills. */
export function houseTick(match: MatchState, events: MatchEvent[]): void {
  const house = match.house
  if (!house) return
  const edge = edgeAt(house.spot, match.tick)
  const was = edgeAt(house.spot, match.tick - 1)
  if (match.tick > 0 && (edge.phase !== was.phase || edge.closing !== was.closing)) events.push({ type: 'edge', phase: edge.phase, closing: edge.closing })
  if (edge.dps > 0 && match.tick % EDGE.beat === 0)
    for (const h of match.heroes) {
      if (!h.alive || insideEdge(edge, h.position)) continue
      // the edge takes health straight off: shields, guards and rolls don't keep it out
      const amount = (h.maxHp * edge.dps * EDGE.beat) / ENGINE.tickHz
      h.hp -= amount
      events.push({ type: 'edge-hurt', hero: h.id, amount })
      if (h.hp <= 0) {
        h.hp = 0
        h.alive = false
        h.knockback = undefined
        h.action = undefined
        events.push({ type: 'death', hero: h.id })
      }
    }
  vaultTick(match, house.vault, events)
}

function vaultTick(match: MatchState, vault: VaultState, events: MatchEvent[]): void {
  if (!vault.open) {
    if (match.tick < ticks(VAULT.opensAt)) return
    vault.open = true
    events.push({ type: 'vault', what: 'open' })
  }
  const inside: [number, number] = [0, 0]
  for (const h of match.heroes) if (h.alive && inVault(h.position)) inside[h.team]++
  const only: Team | undefined = inside[0] && !inside[1] ? 0 : inside[1] && !inside[0] ? 1 : undefined
  if (only === undefined) {
    // contested, it holds; empty, it drains
    if (!inside[0] && !inside[1]) vault.meter = Math.max(0, vault.meter - VAULT.drain)
    if (vault.meter === 0) vault.by = undefined
    return
  }
  if (only === vault.holder) {
    // the holders back in their vault wind the thieves' meter down
    vault.meter = Math.max(0, vault.meter - 1)
    if (vault.meter === 0) vault.by = undefined
    return
  }
  if (vault.by !== only) {
    vault.by = only
    vault.meter = 0
  }
  vault.meter += 1
  const need = ticks(vault.holder === undefined ? VAULT.crack : VAULT.steal)
  if (vault.meter >= need) {
    const stolen = vault.holder !== undefined
    vault.holder = only
    vault.by = undefined
    vault.meter = 0
    events.push({ type: 'vault', what: stolen ? 'stolen' : 'cracked', team: only })
  }
}
