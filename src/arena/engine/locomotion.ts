import { locomotion } from '../../charter/locomotion.js'
import { SIZES } from '../../charter/sizes.js'
import { DT, ENGINE, ticks } from './calibration.js'
import { clamp } from './maths.js'
import { pushOut } from './cover.js'
import { bodyRadius, capsule, type Command, type HeroSetup, type HeroState, type MatchState } from './state.js'

/** Ground speed now: the sheet's move speed with buffs, the strongest slow, and any transformation's speed (KTD2). */
export function moveSpeed(hero: HeroState, setup: HeroSetup): number {
  let slow = 0
  for (const s of hero.slows) if (s.stat !== 'attack' && s.pct / 100 > slow) slow = s.pct / 100
  let buff = 0
  for (const b of hero.buffs) if (b.stat === 'moveSpeed') buff += b.pct / 100
  // the sheet already carries the chosen size's speed; a transformation swaps it for the new class's
  const resized = SIZES[hero.size].speedMul / SIZES[hero.chosenSize].speedMul
  return setup.sheet.moveSpeed * (1 + buff) * (1 - slow) * resized
}

export const heroLocomotion = (hero: HeroState, setup: HeroSetup) => locomotion(moveSpeed(hero, setup))

/**
 * Move one tick by the command: run on the ground, or fly and hold altitude in the air (KTD2). Flying spends the
 * flight meter; an empty meter can't climb and glides down. A root holds the hero in place (it can still act), and a
 * grounded hero can't take off and is pulled down if it was up.
 */
export function move(hero: HeroState, setup: HeroSetup, command: Command, match?: MatchState) {
  const now = match?.tick ?? 0
  const F = ENGINE.flight
  const { ground, flight } = heroLocomotion(hero, setup)
  let mx = command.moveX
  let mz = command.moveZ
  const len = Math.sqrt(mx * mx + mz * mz)
  if (len > 1) {
    mx /= len
    mz /= len
  }
  const rooted = hero.cc.root > now
  const grounded = hero.cc.grounded > now
  let vertical = command.vertical
  if (vertical > 0 && !hero.airborne) {
    if (grounded || rooted || hero.flight < F.takeoff) vertical = 0
    else {
      hero.airborne = true
      hero.flight -= F.takeoff
    }
  }
  const wasAirborne = hero.airborne
  if (hero.airborne) {
    hero.flight = Math.max(0, hero.flight - F.drain * DT)
    if (hero.flight <= 0 || grounded) vertical = -1
  } else if (now - hero.landedAt >= ticks(F.refillDelay)) hero.flight = Math.min(F.max, hero.flight + F.refill * DT)
  const speed = hero.airborne ? flight : ground
  const p = hero.position
  if (!rooted) {
    p.x += mx * speed * DT
    p.z += mz * speed * DT
  }
  if (hero.airborne) p.y += vertical * flight * ENGINE.climbFraction * DT
  keepOut(hero, match)
  if (wasAirborne && !hero.airborne) hero.landedAt = now
}

/** Keep a hero inside the arena and out of every standing piece of cover; returns whether it touched cover. */
export function keepOut(hero: HeroState, match: MatchState | undefined): boolean {
  clampToArena(hero)
  if (!match?.cover) return false
  const touched = pushOut(match.cover.pieces, match.cover.health, hero.position, bodyRadius(hero), capsule(hero).height)
  if (touched) clampToArena(hero)
  return touched
}

export function clampToArena(hero: HeroState) {
  const p = hero.position
  const { halfWidth, halfLength, ceiling } = ENGINE.arena
  p.x = clamp(p.x, -halfWidth, halfWidth)
  p.z = clamp(p.z, -halfLength, halfLength)
  p.y = clamp(p.y, 0, ceiling)
  if (p.y === 0) hero.airborne = false
}
