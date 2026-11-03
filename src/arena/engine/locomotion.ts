import { SIZES } from '../../charter/sizes.js'
import { DT, ENGINE, ticks } from './calibration.js'
import { atan2, clamp, cos, sin } from './maths.js'
import { arenaExtent, ceilingOver, floorUnder, pushOut, type MapLine } from './cover.js'
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
const BUFFERED = MOVES.jump | MOVES.dodge

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
  const fresh = command.moves & ~hero.held
  const queued = hero.buffer && now <= hero.buffer.until ? hero.buffer.moves : 0
  const pressed = fresh | queued
  // a player's jump or roll that can't happen this tick waits a moment for when it can (M.buffer); a fresh press
  // restarts the wait. Only a person's hands need it: the AI presses on the tick it means, and the balance gate's
  // AI-only fights stay as they were
  const keep = (missed: number) => {
    const moves = match?.human === hero.id ? missed & BUFFERED : 0
    hero.buffer = moves ? { moves, until: moves & fresh || !hero.buffer ? now + ticks(M.buffer) : hero.buffer.until } : undefined
  }
  const rooted = hero.cc.root > now
  const pinned = hero.cc.grounded > now
  // feet stay planted through a wind-up and slow through the recovery (phase 1); a wind-up that roots the hero holds
  // it on the ground as well
  const acting = hero.action && now < hero.action.ends ? moveShare(hero.action.slot, hero.action.released, setup.kit[hero.action.slot].delivery.kind) : 1
  const free = !rooted && !pinned && !hero.launch && acting > 0
  const v = hero.velocity
  const p = hero.position
  hero.stamina = Math.min(M.stamina.max, hero.stamina + DT / M.stamina.regen)
  const released = hero.held & ~command.moves
  hero.held = command.moves
  // a mantle and a ride carry the hero on their own (GAME.md §7)
  if (hero.mantle) {
    keep(pressed)
    return mantling(hero, now, events)
  }
  // a dash or leap skill carries the hero on its own, and lands the skill when it arrives (deliveries.ts)
  if (hero.travel) {
    keep(pressed)
    return travelling(hero, match, now)
  }
  if (hero.zip && match?.lines) {
    keep(pressed & ~MOVES.jump)
    return riding(hero, match.lines, (pressed & MOVES.jump) !== 0, now, events)
  }
  if (hero.hang && match?.cover) {
    keep(0)
    return hanging(hero, match, mx, mz, steering, pressed, now, events)
  }
  let missed = 0
  // stances (the canon): C crouches (at a run it slides instead), Ctrl lies prone, either again stands; a jump stands
  // a low hero up rather than leaving the ground
  const across0 = Math.sqrt(v.x * v.x + v.z * v.z)
  if (pressed & MOVES.crouch && free && !hero.airborne && hero.stance === 'stand' && across0 >= M.slide.from * speed && now >= hero.dashUntil) {
    hero.slide = { from: now, until: now + ticks(M.slide.time), x: v.x / across0, z: v.z / across0 }
    events?.push({ type: 'move', hero: hero.id, move: 'slide' })
  } else if (pressed & MOVES.crouch && !hero.airborne) hero.stance = hero.stance === 'crouch' ? 'stand' : 'crouch'
  if (pressed & MOVES.prone && !hero.airborne) hero.stance = hero.stance === 'prone' ? 'stand' : 'prone'
  const lowered = hero.stance !== 'stand'
  // Shift: pressed it dashes ahead at once, and held it sprints on once the dash is spent
  if (pressed & MOVES.dash) hero.shiftSince = now
  const dashNow = (pressed & MOVES.dash) !== 0
  if (released & MOVES.dash) hero.shiftSince = -1
  hero.sprinting = (command.moves & MOVES.dash) !== 0 && hero.shiftSince >= 0 && now >= hero.dashUntil && !hero.airborne && !lowered && steering
  // a guard is up while X is held on the ground and nothing else is going on
  hero.blocking = (command.moves & MOVES.block) !== 0 && !hero.airborne && !hero.roll && !(hero.action && now < hero.action.ends && !hero.action.released) && free
  // Z rolls the way the hero steers (ahead when it doesn't), not where it aims (owner, 2026-11-03), untouchable for its
  // first moments
  if (pressed & MOVES.dodge && !(free && !hero.airborne && !hero.roll && hero.stamina >= 1)) missed |= MOVES.dodge
  else if (pressed & MOVES.dodge) {
    const n = Math.sqrt(mx * mx + mz * mz)
    const [rx, rz] = steering ? [mx / n, mz / n] : [sin(hero.yaw), cos(hero.yaw)]
    hero.roll = { from: now, until: now + ticks(M.roll.time), x: rx, z: rz }
    hero.invulnerableUntil = Math.max(hero.invulnerableUntil, now + ticks(M.roll.iframes))
    hero.stamina -= 1
    hero.stance = 'stand'
    hero.slide = undefined
    events?.push({ type: 'move', hero: hero.id, move: 'roll' })
  }
  if (hero.roll && now >= hero.roll.until) hero.roll = undefined
  const pace = hero.blocking ? M.block.speed : hero.stance === 'prone' ? M.prone.speed : hero.stance === 'crouch' ? M.crouch.speed : hero.sprinting ? M.sprint.speed : 1
  const want = speed * acting * pace
  const jumpScale = M.jumpScale[hero.size]

  // decided before the jump below changes whether the hero is in the air; just off an edge it still counts as standing
  const footed = !hero.airborne || (hero.fellAt !== undefined && now - hero.fellAt <= ticks(M.coyote))
  if (pressed & MOVES.jump && !(free && !hero.roll && (footed || (hero.airJumps < 1 && hero.stamina >= 1)))) missed |= MOVES.jump
  if (pressed & MOVES.jump && free && lowered && !hero.airborne) hero.stance = 'stand'
  else if (pressed & MOVES.jump && free && !hero.roll) {
    if (footed) {
      hero.fellAt = undefined
      // a slide's speed carries into the jump
      v.y = Math.sqrt(2 * M.gravity * M.jump * jumpScale)
      hero.airborne = true
      hero.slide = undefined
      events?.push({ type: 'move', hero: hero.id, move: 'jump' })
    } else if (hero.airJumps < 1 && hero.stamina >= 1) {
      v.y = Math.sqrt(2 * M.gravity * M.airJump * jumpScale)
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
  keep(missed)
  if (dashNow && free && hero.stamina >= 1 && now >= hero.dashUntil && !hero.roll) {
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
  if (hero.slide && (now >= hero.slide.until || hero.airborne || !free)) hero.slide = undefined

  // across the ground; a rooted wind-up plants the feet at once
  if (rooted || (acting === 0 && !hero.airborne)) {
    v.x = 0
    v.z = 0
  } else if (hero.roll) {
    const s = M.roll.distance / M.roll.time
    v.x = hero.roll.x * s
    v.z = hero.roll.z * s
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
    // a head rising into a deck or a tunnel's roof stops under it (GAME.md §8 ceilings)
    if (v.y > 0 && match?.cover) {
      const roof = ceilingOver(match.cover.pieces, match.cover.health, p, bodyRadius(hero) * 0.7, from + capsule(hero).height, p.y + capsule(hero).height)
      if (roof !== undefined) {
        p.y = roof - capsule(hero).height
        v.y = 0
      }
    }
  }
  p.x += v.x * DT
  p.z += v.z * DT
  if (hero.airborne) {
    // a falling hero lands on any top it passed this tick before walls can push it off sideways
    const falling = -v.y
    standOn(hero, match, Math.max(from, p.y))
    const pressing = keepOut(hero, match)
    if (hero.airborne) {
      // pressed against a ledge it can reach, it pulls itself up; near a line, it catches it
      if (pressing && steering && free && !hero.launch) startMantle(hero, match, mx, mz, now, events)
      else if (match?.lines && free && !hero.launch && now >= (hero.zipAfter ?? 0)) catchLine(hero, match.lines, mx, mz, steering, events)
      return
    }
    standOn(hero, match)
    // a big fall rolls on when the hero steers, keeping its speed, and lands heavily when it doesn't (§7)
    const big = falling >= M.landing.big
    if (big && !(steering && free)) {
      v.x = 0
      v.z = 0
    }
    events?.push({ type: 'move', hero: hero.id, move: big ? (steering && free ? 'land-roll' : 'land-heavy') : 'land', speed: falling })
    return
  }
  // a standing one steps up onto anything low enough before walls push the body out, and falls once nothing is under
  // it; what's under it only changes if the walls moved it
  const floor = match?.cover ? floorUnder(match.cover.pieces, match.cover.health, p, p.y + M.step) : 0
  if (floor > p.y) p.y = floor
  const [x, z] = [p.x, p.z]
  const rolling = !!hero.roll
  const pressing = keepOut(hero, match)
  standOn(hero, match, p.y, p.x === x && p.z === z ? floor : undefined)
  // a played hero walking off a sheer edge catches it and hangs (owner, 2026-11-04); a sprint, a dash or a roll goes
  // over, and the AI never hangs, so its fights stay as they were
  if (hero.airborne && match?.human === hero.id && free && !hero.sprinting && !rolling && now >= hero.dashUntil && now >= (hero.hangAfter ?? 0)) {
    if (catchEdge(hero, match, steering ? mx : v.x, steering ? mz : v.z, now, events)) return
  }
  if (pressing && steering && free && !hero.airborne && !hero.roll && now >= hero.dashUntil) startMantle(hero, match, mx, mz, now, events)
}

/** The top of a ledge just ahead along (dx, dz) that the hero can mantle onto, with room to stand there. */
export function ledgeAhead(hero: HeroState, match: MatchState, dx: number, dz: number): { x: number; y: number; z: number } | undefined {
  if (!match.cover) return undefined
  const { pieces, health } = match.cover
  const p = hero.position
  const n = Math.sqrt(dx * dx + dz * dz) || 1
  const ahead = bodyRadius(hero) + M.mantle.reach
  const spot = { x: p.x + (dx / n) * ahead, y: 0, z: p.z + (dz / n) * ahead }
  const top = floorUnder(pieces, health, spot, p.y + M.mantle.height)
  if (top <= p.y + M.step) return undefined
  spot.y = top
  // room to rise: no deck or roof over it on the way up, or it would climb through it
  const height = capsule(hero).height
  if (ceilingOver(pieces, health, p, bodyRadius(hero) * 0.7, p.y + 1e-3, top + height) !== undefined) return undefined
  // room to stand: no ceiling over the top lower than a head, and a body there touches nothing it can't step onto
  if (ceilingOver(pieces, health, spot, bodyRadius(hero) * 0.8, top + 1e-3, top + height) !== undefined) return undefined
  if (pushOut(pieces, health, { ...spot }, bodyRadius(hero) * 0.8, height, M.step)) return undefined
  return spot
}

function startMantle(hero: HeroState, match: MatchState | undefined, dx: number, dz: number, now: number, events?: MatchEvent[]) {
  if (!match) return
  const to = ledgeAhead(hero, match, dx, dz)
  if (!to) return
  const p = hero.position
  hero.mantle = { from: now, until: now + Math.max(1, ticks(M.mantle.time)), x0: p.x, y0: p.y, z0: p.z, x1: to.x, y1: to.y, z1: to.z }
  hero.velocity = { x: 0, y: 0, z: 0 }
  hero.airborne = false
  hero.slide = undefined
  events?.push({ type: 'move', hero: hero.id, move: 'mantle' })
}

/** One tick of a mantle: up first, then over the edge, standing on the top at the end. */
function mantling(hero: HeroState, now: number, _events?: MatchEvent[]) {
  const m = hero.mantle!
  const t = Math.min(1, (now + 1 - m.from) / Math.max(1, m.until - m.from))
  const up = Math.min(1, t / 0.6)
  const over = Math.max(0, (t - 0.4) / 0.6)
  const p = hero.position
  p.x = m.x0 + (m.x1 - m.x0) * over
  p.y = m.y0 + (m.y1 - m.y0) * up
  p.z = m.z0 + (m.z1 - m.z0) * over
  hero.velocity = { x: 0, y: 0, z: 0 }
  if (t >= 1) {
    hero.mantle = undefined
    hero.airborne = false
    hero.airJumps = 0
    hero.landedAt = now
  }
}

/**
 * Catch the edge a hero just walked off along (dx, dz): back along its way to the last spot still on the top, then
 * round that spot for the side the top isn't on, which is the way the drop faces.
 */
function catchEdge(hero: HeroState, match: MatchState, dx: number, dz: number, now: number, events?: MatchEvent[]): boolean {
  if (!match.cover) return false
  const { pieces, health } = match.cover
  const p = hero.position
  const top = p.y
  const n = Math.sqrt(dx * dx + dz * dz)
  if (n < 0.1) return false
  let edge: { x: number; z: number } | undefined
  for (let s = 0; s <= 1.2 && !edge; s += 0.05) {
    const q = { x: p.x - (dx / n) * s, y: 0, z: p.z - (dz / n) * s }
    if (floorUnder(pieces, health, q, top + 1e-3) >= top - 1e-3) edge = q
  }
  if (!edge) return false
  let nx = 0
  let nz = 0
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    if (floorUnder(pieces, health, { x: edge.x + sin(a) * 0.4, y: 0, z: edge.z + cos(a) * 0.4 }, top + 1e-3) < top - M.step) {
      nx += sin(a)
      nz += cos(a)
    }
  }
  const nn = Math.sqrt(nx * nx + nz * nz)
  if (nn < 1e-6) return false
  nx /= nn
  nz /= nn
  const at = hangSpot(hero, match, edge.x, top, edge.z, nx, nz)
  if (!at) return false
  hero.hang = { from: now, x: edge.x, y: top, z: edge.z, nx, nz }
  hero.position = at
  hero.velocity = { x: 0, y: 0, z: 0 }
  hero.airborne = false
  hero.airJumps = 0
  hero.fellAt = undefined
  hero.slide = undefined
  hero.roll = undefined
  hero.stance = 'stand'
  events?.push({ type: 'move', hero: hero.id, move: 'hang' })
  return true
}

/**
 * Where a body hangs from the edge at (x, top, z) facing the drop along (nx, nz): against the face below the edge,
 * its hands on top. Nothing, unless the top is still there, the drop under it is sheer and deep enough to hang over,
 * and the body has room.
 */
function hangSpot(hero: HeroState, match: MatchState, x: number, top: number, z: number, nx: number, nz: number) {
  const { pieces, health } = match.cover!
  const r = bodyRadius(hero)
  const height = capsule(hero).height
  if (floorUnder(pieces, health, { x: x - nx * 0.2, y: 0, z: z - nz * 0.2 }, top + 1e-3) < top - M.step) return undefined
  const at = { x: x + nx * (r + 0.05), y: top - height * M.hang.below, z: z + nz * (r + 0.05) }
  if (floorUnder(pieces, health, at, top - 1e-3) > top - M.hang.drop) return undefined
  if (pushOut(pieces, health, { ...at }, r * 0.8, height, 0)) return undefined
  return at
}

/** One tick hanging from a ledge: climb up, shimmy along it, let go, or jump away from the wall. */
function hanging(hero: HeroState, match: MatchState, mx: number, mz: number, steering: boolean, pressed: number, now: number, events?: MatchEvent[]) {
  const g = hero.hang!
  const { pieces, health } = match.cover!
  // into the wall is against the drop; along the edge is a quarter turn from it. A stick still held from the walk off
  // steers nothing until it is let go once, as the camera swings round to face the wall and would turn it into a climb
  if (!steering) g.free = true
  const live = steering && g.free
  const into = live ? -(mx * g.nx + mz * g.nz) : 0
  const along = live ? -mx * g.nz + mz * g.nx : 0
  const settled = now - g.from >= ticks(0.2)
  const here = hangSpot(hero, match, g.x, g.y, g.z, g.nx, g.nz)
  if (!here || hero.launch || hero.stunnedUntil > now || !hero.alive || pressed & (MOVES.crouch | MOVES.dodge)) return letGo(hero, now, events, false)
  if (pressed & MOVES.jump && into < -0.5) return letGo(hero, now, events, true)
  hero.velocity = { x: 0, y: 0, z: 0 }
  if ((pressed & MOVES.jump || into > 0.7) && settled) {
    // up onto the top, if a body has room to stand there
    const r = bodyRadius(hero)
    const height = capsule(hero).height
    const spot = { x: g.x - g.nx * (r + 0.15), y: g.y, z: g.z - g.nz * (r + 0.15) }
    if (ceilingOver(pieces, health, spot, r * 0.8, g.y + 1e-3, g.y + height) === undefined && !pushOut(pieces, health, { ...spot }, r * 0.8, height, M.step)) {
      const p = hero.position
      hero.hang = undefined
      hero.mantle = { from: now, until: now + Math.max(1, ticks(M.hang.climb)), x0: p.x, y0: p.y, z0: p.z, x1: spot.x, y1: spot.y, z1: spot.z }
      events?.push({ type: 'move', hero: hero.id, move: 'climb' })
      return
    }
  }
  if (Math.abs(along) > 0.5 && Math.abs(along) > Math.abs(into)) {
    // hand over hand along the edge, as far as it runs
    const step = Math.sign(along) * M.hang.shimmy * DT
    const x = g.x - g.nz * step
    const z = g.z + g.nx * step
    const next = hangSpot(hero, match, x, g.y, z, g.nx, g.nz)
    if (next) {
      g.x = x
      g.z = z
      hero.velocity = { x: -g.nz * step / DT, y: 0, z: g.nx * step / DT }
      hero.position = next
      return
    }
  }
  hero.position = here
}

/** Off the ledge: dropping straight down, or jumping away from the wall with the ground jump. */
function letGo(hero: HeroState, now: number, events: MatchEvent[] | undefined, away: boolean) {
  const g = hero.hang!
  hero.hang = undefined
  hero.airborne = true
  hero.hangAfter = now + ticks(M.hang.regrab)
  if (away) {
    const push = 5
    hero.velocity = { x: g.nx * push, y: Math.sqrt(2 * M.gravity * M.jump * M.jumpScale[hero.size]), z: g.nz * push }
    events?.push({ type: 'move', hero: hero.id, move: 'jump' })
  } else {
    hero.velocity = { x: g.nx * 0.5, y: 0, z: g.nz * 0.5 }
    events?.push({ type: 'move', hero: hero.id, move: 'let-go' })
  }
}

/** One tick of a dash or leap skill's travel: along its line, a leap arcing over it, settling where it ends. */
function travelling(hero: HeroState, match: MatchState | undefined, now: number) {
  const tr = hero.travel!
  if (tr.arrived) return
  const t = Math.min(1, (now + 1 - tr.from) / Math.max(1, tr.until - tr.from))
  const p = hero.position
  const was = { ...p }
  p.x = tr.x0 + (tr.x1 - tr.x0) * t
  p.z = tr.z0 + (tr.z1 - tr.z0) * t
  p.y = tr.y0 + (tr.y1 - tr.y0) * t + 4 * tr.arc * t * (1 - t)
  hero.velocity = { x: (p.x - was.x) / DT, y: (p.y - was.y) / DT, z: (p.z - was.z) / DT }
  if (t < 1) return
  tr.arrived = true
  hero.velocity = { x: 0, y: 0, z: 0 }
  keepOut(hero, match)
  // aimed up, a leap ends in the air, and the hero falls from there
  hero.airborne = false
  standOn(hero, match, Math.max(p.y, tr.startY))
}

/** Where on line `l` a hero's grip is: its hands for a zipline, its feet for a rail. */
const gripOf = (hero: HeroState, l: MapLine) => (l.kind === 'zip' ? capsule(hero).height + M.zip.hang : 0)

/** Catch the nearest line the grip passes within reach of, riding it the way the hero moves or steers. */
function catchLine(hero: HeroState, lines: readonly MapLine[], mx: number, mz: number, steering: boolean, events?: MatchEvent[]) {
  const p = hero.position
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const ex = l.b.x - l.a.x
    const ey = l.b.y - l.a.y
    const ez = l.b.z - l.a.z
    const len2 = ex * ex + ey * ey + ez * ez
    if (len2 < 1e-9) continue
    const gy = p.y + gripOf(hero, l)
    const t = ((p.x - l.a.x) * ex + (gy - l.a.y) * ey + (p.z - l.a.z) * ez) / len2
    if (t <= 0 || t >= 1) continue
    const dx = l.a.x + ex * t - p.x
    const dy = l.a.y + ey * t - gy
    const dz = l.a.z + ez * t - p.z
    if (dx * dx + dy * dy + dz * dz > M.zip.grab * M.zip.grab) continue
    // a rail is landed on, never caught from below
    if (l.kind === 'rail' && hero.velocity.y > 0) continue
    const [wx, wz] = steering ? [mx, mz] : [hero.velocity.x, hero.velocity.z]
    const way = wx * ex + wz * ez
    // caught near an end, it rides away from that end rather than straight off it
    const len = Math.sqrt(len2)
    const dir = t * len < M.zip.endGrab ? 1 : (1 - t) * len < M.zip.endGrab ? -1 : way < 0 ? -1 : 1
    hero.zip = { line: i, t, dir, hang: l.kind === 'zip' }
    hero.airJumps = 0
    hero.slide = undefined
    events?.push({ type: 'move', hero: hero.id, move: 'zip-on' })
    return
  }
}

/**
 * One tick on a line: along it at zip speed; a jump lets go with a jump, the end lets go carrying the speed, and
 * anything that takes control away drops the hero, which falls from there next tick.
 */
function riding(hero: HeroState, lines: readonly MapLine[], jump: boolean, now: number, events?: MatchEvent[]) {
  const z = hero.zip!
  const l = lines[z.line]
  const ex = l.b.x - l.a.x
  const ey = l.b.y - l.a.y
  const ez = l.b.z - l.a.z
  const len = Math.sqrt(ex * ex + ey * ey + ez * ez)
  const v = hero.velocity
  v.x = (ex / len) * M.zip.speed * z.dir
  v.y = (ey / len) * M.zip.speed * z.dir
  v.z = (ez / len) * M.zip.speed * z.dir
  const controlled = hero.cc.root <= now && hero.cc.grounded <= now && !hero.launch && hero.stunnedUntil <= now
  const t = z.t + (z.dir * M.zip.speed * DT) / len
  const off = jump || !controlled || t <= 0 || t >= 1
  const at = Math.max(0, Math.min(1, t))
  const grip = gripOf(hero, l)
  hero.position = { x: l.a.x + ex * at, y: l.a.y + ey * at - grip, z: l.a.z + ez * at }
  hero.airborne = true
  if (!off) {
    z.t = t
    return
  }
  hero.zip = undefined
  hero.zipAfter = now + ticks(M.zip.again)
  if (jump && controlled) {
    v.y = Math.sqrt(2 * M.gravity * M.jump * M.jumpScale[hero.size])
    events?.push({ type: 'move', hero: hero.id, move: 'jump' })
  } else v.y = Math.min(v.y, 0)
  events?.push({ type: 'move', hero: hero.id, move: 'zip-off' })
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
      hero.fellAt = undefined
    }
  } else if (p.y > floor + M.step) {
    hero.airborne = true
    hero.velocity.y = 0
    // a person's grace, like the buffer, so the AI-only fights stay as they were: a jump just after the edge is still
    // the ground jump (coyote time), and a roll ends at the edge, keeping its speed for the fall, with the jumps free
    // again, rather than tumbling on through the air (playtest, 2026-11-03). The client shows any hero's roll off an
    // edge as a fall
    if (match?.human === hero.id) {
      hero.fellAt = match.tick
      hero.roll = undefined
    }
  } else p.y = floor // down a ramp or a stair the feet follow the ground; off a ledge they fall
}

/**
 * Keep a hero inside the arena and out of every standing piece of cover; returns whether it touched cover (each piece
 * touched goes into `hits` when given). Anything a hero could step onto (`clearance` above its feet) never pushes it,
 * or its body would stop short of the edge and its centre never get over it.
 */
export function keepOut(hero: HeroState, match: MatchState | undefined, hits?: number[], clearance: number = M.step): boolean {
  clampToArena(hero, match)
  if (!match?.cover) return false
  const touched = pushOut(match.cover.pieces, match.cover.health, hero.position, bodyRadius(hero), capsule(hero).height, clearance, hits)
  // a deck or roof the body has risen or drifted into from below, by a jump, a knock-up or a throw, pushes it down under
  // it, never out sideways (pushOut leaves overhead pieces alone), and no lower than the floor under it
  const p = hero.position
  const height = capsule(hero).height
  const roof = ceilingOver(match.cover.pieces, match.cover.health, p, 0, p.y + 1e-3, p.y + height)
  if (roof !== undefined) {
    p.y = Math.max(roof - height, floorUnder(match.cover.pieces, match.cover.health, p, p.y + M.step))
    hero.velocity.y = Math.min(0, hero.velocity.y)
  }
  if (touched) clampToArena(hero, match)
  return touched
}

export function clampToArena(hero: HeroState, match?: MatchState) {
  const p = hero.position
  const { ceiling } = ENGINE.arena
  const { halfWidth, halfLength } = arenaExtent(match?.cover?.pieces)
  p.x = clamp(p.x, -halfWidth, halfWidth)
  p.z = clamp(p.z, -halfLength, halfLength)
  p.y = clamp(p.y, 0, ceiling)
}
