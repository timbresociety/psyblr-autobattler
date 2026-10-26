import { locomotion } from '../../charter/locomotion'
import { SIZES } from '../../charter/sizes'
import { DT, ENGINE } from './calibration'
import { clamp } from './maths'
import type { Command, HeroSetup, HeroState } from './state'

/** Ground speed now: the sheet's move speed with buffs, the strongest slow, and any transformation's speed (KTD2). */
export function moveSpeed(hero: HeroState, setup: HeroSetup): number {
  let slow = 0
  for (const s of hero.slows) if (s.pct / 100 > slow) slow = s.pct / 100
  let buff = 0
  for (const b of hero.buffs) if (b.stat === 'moveSpeed') buff += b.pct / 100
  // the sheet already carries the chosen size's speed; a transformation swaps it for the new class's
  const resized = SIZES[hero.size].speedMul / SIZES[hero.chosenSize].speedMul
  return setup.sheet.moveSpeed * (1 + buff) * (1 - slow) * resized
}

export const heroLocomotion = (hero: HeroState, setup: HeroSetup) => locomotion(moveSpeed(hero, setup))

/** Move one tick by the command: run on the ground, or fly and hold altitude in the air (KTD2). */
export function move(hero: HeroState, setup: HeroSetup, command: Command) {
  const { ground, flight } = heroLocomotion(hero, setup)
  let mx = command.moveX
  let mz = command.moveZ
  const len = Math.sqrt(mx * mx + mz * mz)
  if (len > 1) {
    mx /= len
    mz /= len
  }
  if (command.vertical > 0) hero.airborne = true
  const speed = hero.airborne ? flight : ground
  const p = hero.position
  p.x += mx * speed * DT
  p.z += mz * speed * DT
  if (hero.airborne) p.y += command.vertical * flight * ENGINE.climbFraction * DT
  clampToArena(hero)
}

export function clampToArena(hero: HeroState) {
  const p = hero.position
  const { halfWidth, halfLength, ceiling } = ENGINE.arena
  p.x = clamp(p.x, -halfWidth, halfWidth)
  p.z = clamp(p.z, -halfLength, halfLength)
  p.y = clamp(p.y, 0, ceiling)
  if (p.y === 0) hero.airborne = false
}
