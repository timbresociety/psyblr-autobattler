import { BUILD_SLOTS } from '../../charter/build'
import type { MatchEvent } from './events'
import { move } from './locomotion'
import { TAU } from './maths'
import { next } from './rng'
import { AIM_STEPS, IDLE, type Command, type HeroSetup, type MatchState } from './state'

/**
 * One fixed 60 Hz step (KTD1). Rules that act on heroes plug in through `TickRules`, so the core stays small: U4 adds
 * deliveries and statuses, U5 adds match end. Nothing happens while paused.
 */
export interface TickRules {
  /** Before anyone acts: expire statuses, apply damage over time. */
  statuses?: (match: MatchState, setups: readonly HeroSetup[], events: MatchEvent[]) => void
  /** After a hero moves: cast whatever its command pressed. */
  act?: (match: MatchState, setups: readonly HeroSetup[], hero: number, command: Command, events: MatchEvent[]) => void
  /** After everyone acts: projectiles, knockback, and whether the match has ended. */
  after?: (match: MatchState, setups: readonly HeroSetup[], events: MatchEvent[]) => void
}

export function tick(match: MatchState, setups: readonly HeroSetup[], commands: readonly (Command | undefined)[], rules: TickRules = {}): MatchEvent[] {
  const events: MatchEvent[] = []
  if (match.paused || match.winner !== undefined) return events
  match.tick++
  rules.statuses?.(match, setups, events)
  // a fresh seeded order each tick, so neither side always acts first
  const order = match.heroes.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next(match.rules) * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  for (const i of order) {
    const hero = match.heroes[i]
    if (!hero.alive) continue
    for (const slot of BUILD_SLOTS) if (hero.cooldowns[slot] > 0) hero.cooldowns[slot]--
    if (hero.stunnedUntil > match.tick) continue
    const command = commands[i] ?? IDLE
    hero.yaw = (command.aimYaw / AIM_STEPS) * TAU
    hero.pitch = (command.aimPitch / AIM_STEPS) * TAU
    if (!hero.knockback) move(hero, setups[i], command)
    rules.act?.(match, setups, i, command, events)
  }
  rules.after?.(match, setups, events)
  return events
}

export const pause = (match: MatchState) => void (match.paused = true)
export const resume = (match: MatchState) => void (match.paused = false)
