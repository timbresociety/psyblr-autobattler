import { BUILD_SLOTS } from '../../charter/build.js'
import type { MatchEvent } from './events.js'
import { move } from './locomotion.js'
import { TAU } from './maths.js'
import { next } from './rng.js'
import { AIM_STEPS, IDLE, slotBit, type Command, type HeroSetup, type HeroState, type MatchState } from './state.js'

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
    // stunned, launched or asleep: nothing this tick
    if (hero.stunnedUntil > match.tick || hero.cc.sleep > match.tick) continue
    const command = compelled(match, hero, commands[i] ?? IDLE)
    hero.yaw = (command.aimYaw / AIM_STEPS) * TAU
    hero.pitch = (command.aimPitch / AIM_STEPS) * TAU
    if (!hero.knockback) move(hero, setups[i], command, match)
    rules.act?.(match, setups, i, command, events)
  }
  rules.after?.(match, setups, events)
  return events
}

/**
 * Control that takes the hero's will away. A feared hero runs from whoever scared it and does nothing else; a
 * taunted hero walks at its taunter and attacks it (deliveries aim the attack). Player and AI alike.
 */
function compelled(match: MatchState, hero: HeroState, command: Command): Command {
  const now = match.tick
  const flee = hero.cc.fear > now && hero.fearFrom >= 0 ? match.heroes[hero.fearFrom] : undefined
  const chase = hero.cc.taunt > now && hero.tauntBy >= 0 ? match.heroes[hero.tauntBy] : undefined
  const toward = (other: HeroState, sign: 1 | -1): Command => {
    const dx = (other.position.x - hero.position.x) * sign
    const dz = (other.position.z - hero.position.z) * sign
    const len = Math.sqrt(dx * dx + dz * dz) || 1
    return { ...command, moveX: dx / len, moveZ: dz / len, vertical: hero.airborne ? -1 : 0, buttons: sign > 0 ? slotBit('basic') : 0 }
  }
  if (flee?.alive) return toward(flee, -1)
  if (chase?.alive) return toward(chase, 1)
  return command
}

export const pause = (match: MatchState) => void (match.paused = true)
export const resume = (match: MatchState) => void (match.paused = false)
