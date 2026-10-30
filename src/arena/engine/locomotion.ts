import { SIZES } from '../../charter/sizes.js'
import { DT, ENGINE, ticks } from './calibration.js'
import { atan2, clamp, cos, sin } from './maths.js'
import { floorUnder, pushOut } from './cover.js'
import type { MatchEvent } from './events.js'
import { bodyRadius, capsule, MOVES, type Command, type HeroSetup, type HeroState, type MatchState } from './state.js'
import { moveShare } from './timing.js'

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

const M = ENGINE.move

/**
 * Move one tick by the command, like Deadlock (KTD2; Forge goal, phase 2): nobody flies. On the ground the hero eases
 * toward the speed it wants; in the air it keeps its momentum and steers a little. Jump leaves the ground, and a
 * second press in the air jumps again for a stamina pip; a dash spends a pip to burst along the way it steers, or
 * faces; crouching at a run slides. A root holds the hero where it is (it can still act, and still falls), and a
 * grounded hero can't jump or dash and drops at once. A stunned, asleep or launched hero moves by `IDLE`: it slows to
 * a stop and falls. Each jump, dash, slide and landing is reported in `events` for the client to animate and sound.
 */
export function move(hero: HeroState, setup: HeroSetup, command: Command, match?: MatchState, events?: MatchEvent[]) {
  const now = match?.tick ?? 0
  const speed = moveSpeed(hero, setup)
  let mx = command.moveX
  let mz = command.moveZ
  const len = Math.sqrt(mx * mx + mz * mz)
  if (len > 1) {
    mx /= len
    mz /= len
  }
  const steering = len > 0.1
  const pressed = command.moves & ~hero.held
  hero.held = command.moves
  const rooted = hero.cc.root > now
  const pinned = hero.cc.grounded > now
  // feet stay planted through a wind-up and slow through the recovery (phase 1); a wind-up that roots the hero holds
  // it on the ground as well
  const acting = hero.action && now < hero.action.ends ? moveShare(hero.action.slot, hero.action.released, setup.kit[hero.action.slot].delivery.kind) : 1
  const free = !rooted && !pinned && !hero.launch && acting > 0
  const v = hero.velocity
  const p = hero.position
  hero.stamina = Math.min(M.stamina.max, hero.stamina + DT / M.stamina.regen)
  const want = speed * acting

  if (pressed & MOVES.jump && free) {
    if (!hero.airborne) {
      // a slide's speed carries into the jump
      v.y = Math.sqrt(2 * M.gravity * M.jump)
      hero.airborne = true
      hero.slide = undefined
      events?.push({ type: 'move', hero: hero.id, move: 'jump' })
    } else if (hero.airJumps < 1 && hero.stamina >= 1) {
      v.y = Math.sqrt(2 * M.gravity * M.airJump)
      hero.airJumps++
      hero.stamina -= 1
      events?.push({ type: 'move', hero: hero.id, move: 'air-jump' })
      // the second jump turns the momentum it carries toward where it steers
      if (steering) {
        const carried = Math.max(Math.sqrt(v.x * v.x + v.z * v.z), want)
        const n = Math.sqrt(mx * mx + mz * mz)
        v.x = (mx / n) * carried
        v.z = (mz / n) * carried
      }
    }
  }
  if (pressed & MOVES.dash && free && hero.stamina >= 1 && now >= hero.dashUntil) {
    const n = Math.sqrt(mx * mx + mz * mz)
    const [dx, dz] = steering ? [mx / n, mz / n] : [sin(hero.yaw), cos(hero.yaw)]
    v.x = dx * M.dash.speed
    v.z = dz * M.dash.speed
    // a dash in the air holds its height for its length
    if (hero.airborne) v.y = Math.max(0, v.y)
    hero.dashUntil = now + ticks(M.dash.time)
    hero.stamina -= 1
    hero.slide = undefined
    events?.push({ type: 'move', hero: hero.id, move: 'dash' })
  }
  // a crouch at a run starts a slide, pressed or held as the hero lands; letting go ends it
  const crouch = (command.moves & MOVES.crouch) !== 0
  const across = Math.sqrt(v.x * v.x + v.z * v.z)
  const landed = hero.landedAt === now - 1
  if (crouch && (pressed & MOVES.crouch || landed) && free && !hero.airborne && !hero.slide && now >= hero.dashUntil && across >= M.slide.from * speed) {
    hero.slide = { from: now, until: now + ticks(M.slide.time), x: v.x / across, z: v.z / across }
    events?.push({ type: 'move', hero: hero.id, move: 'slide' })
  }
  if (hero.slide && (!crouch || now >= hero.slide.until || hero.airborne || !free)) hero.slide = undefined

  // across the ground; a rooted wind-up plants the feet at once
  if (rooted || (acting === 0 && !hero.airborne)) {
    v.x = 0
    v.z = 0
  } else if (now < hero.dashUntil) {
    // the dash carries it; as it ends, it keeps no more than its running speed
    if (now + 1 === hero.dashUntil) {
      const s = Math.sqrt(v.x * v.x + v.z * v.z)
      if (s > speed) {
        v.x *= speed / s
        v.z *= speed / s
      }
    }
  } else if (hero.slide) {
    const s = hero.slide
    const t = (now - s.from) / Math.max(1, s.until - s.from)
    // it steers a little toward where it's told to go
    if (steering) {
      const turn = atan2(s.x * mz - s.z * mx, s.x * mx + s.z * mz)
      const a = clamp(turn, -M.slide.steer * DT, M.slide.steer * DT)
      const [c, n] = [cos(a), sin(a)]
      ;[s.x, s.z] = [s.x * c - s.z * n, s.x * n + s.z * c]
    }
    const pace = speed * acting * (M.slide.boost + (M.slide.end - M.slide.boost) * t)
    v.x = s.x * pace
    v.z = s.z * pace
  } else if (!hero.airborne || steering) {
    // on the ground it eases to the speed it wants; in the air it keeps its momentum unless it steers
    const tx = mx * want
    const tz = mz * want
    const dx = tx - v.x
    const dz = tz - v.z
    const gap = Math.sqrt(dx * dx + dz * dz)
    const rate = (hero.airborne ? M.airAccel : M.accel) * DT
    if (gap <= rate) {
      v.x = tx
      v.z = tz
    } else {
      v.x += (dx / gap) * rate
      v.z += (dz / gap) * rate
    }
  }
  const from = p.y
  if (hero.airborne && !hero.launch) {
    v.y = pinned ? -M.fall : Math.max(-M.fall, v.y - M.gravity * DT)
    p.y += v.y * DT
  }
  p.x += v.x * DT
  p.z += v.z * DT
  if (hero.airborne) {
    // a falling hero lands on any top it passed this tick before walls can push it off sideways
    const falling = -v.y
    standOn(hero, match, Math.max(from, p.y))
    keepOut(hero, match)
    if (hero.airborne) return
    standOn(hero, match)
    events?.push({ type: 'move', hero: hero.id, move: 'land', speed: falling })
    return
  }
  // a standing one steps up onto anything low enough before walls push the body out, and falls once nothing is under
  // it; what's under it only changes if the walls moved it
  const floor = match?.cover ? floorUnder(match.cover.pieces, match.cover.health, p, p.y + M.step) : 0
  if (floor > p.y) p.y = floor
  const [x, z] = [p.x, p.z]
  keepOut(hero, match)
  standOn(hero, match, p.y, p.x === x && p.z === z ? floor : undefined)
}

/**
 * Land a falling hero on whatever is under it, or start a standing one falling once nothing is (it walked off a wall
 * top, or the barricade under it broke). `reach` is the highest a floor can be and still catch it: where it fell from.
 * `known` is the floor under it already found this tick, when nothing has moved it since.
 */
export function standOn(hero: HeroState, match: MatchState | undefined, reach = hero.position.y, known?: number) {
  if (hero.launch) return
  const p = hero.position
  const floor = known ?? (match?.cover ? floorUnder(match.cover.pieces, match.cover.health, p, reach + 1e-6) : 0)
  if (hero.airborne) {
    if (p.y <= floor && hero.velocity.y <= 0) {
      p.y = floor
      hero.velocity.y = 0
      hero.airborne = false
      hero.airJumps = 0
      hero.landedAt = match?.tick ?? 0
    }
  } else if (p.y > floor + 1e-6) {
    hero.airborne = true
    hero.velocity.y = 0
  } else p.y = floor
}

/**
 * Keep a hero inside the arena and out of every standing piece of cover; returns whether it touched cover. Anything a
 * hero could step onto never pushes it, or its body would stop short of the edge and its centre never get over it.
 */
export function keepOut(hero: HeroState, match: MatchState | undefined): boolean {
  clampToArena(hero)
  if (!match?.cover) return false
  const touched = pushOut(match.cover.pieces, match.cover.health, hero.position, bodyRadius(hero), capsule(hero).height, M.step)
  if (touched) clampToArena(hero)
  return touched
}

export function clampToArena(hero: HeroState) {
  const p = hero.position
  const { halfWidth, halfLength, ceiling } = ENGINE.arena
  p.x = clamp(p.x, -halfWidth, halfWidth)
  p.z = clamp(p.z, -halfLength, halfLength)
  p.y = clamp(p.y, 0, ceiling)
}
