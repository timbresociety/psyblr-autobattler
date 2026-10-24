import type { MatchState, Team } from '../engine/state.js'

/**
 * Who drives which hero (U17, R14-R16, R20): the streamer may take any living hero on their own side with keys 1-0,
 * in formation order; Tab hands it back to the AI; if the hero dies, control returns to watching. The AI never
 * stops: it picks a hero up again on the next tick it is free.
 */

export const HERO_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'] as const

/** The hero a number key takes: the n-th of the streamer's side, in formation order. */
export function heroForKey(match: MatchState, side: Team, code: string): number | undefined {
  const n = HERO_KEYS.indexOf(code as (typeof HERO_KEYS)[number])
  if (n < 0) return undefined
  return match.heroes.filter((h) => h.team === side)[n]?.id
}

/** Take a hero; only a living hero on the streamer's own side can be taken (AE2). */
export function take(match: MatchState, side: Team, hero: number | undefined): boolean {
  const h = hero === undefined ? undefined : match.heroes[hero]
  if (!h || h.team !== side || !h.alive) return false
  match.human = hero
  return true
}

export function handBack(match: MatchState) {
  match.human = undefined
}

/** After a tick: a controlled hero that died goes back to watching (AE1). Returns true when that happened. */
export function releaseIfDead(match: MatchState): boolean {
  if (match.human !== undefined && !match.heroes[match.human].alive) {
    match.human = undefined
    return true
  }
  return false
}
