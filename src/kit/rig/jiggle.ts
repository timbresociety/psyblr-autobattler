import type { JigglePreset } from '../body/physique.js'
import type { JiggleRegion } from './metarig.js'

/**
 * Jiggle and secondary motion (GAME.md §9.4): a spring-damper on each jiggle bone, run after the clip. A point a
 * little way out from the bone (its tip) is the mass; each frame the clip says where the tip should be, the spring
 * pulls the mass toward it, the damper bleeds its speed, and the bone turns to point at the mass, never more than its
 * maximum angle. Landings and big hits kick the mass. Client-only and cosmetic: it never feeds back into gameplay.
 *
 * Fixed 240 Hz substeps, so the same motion jiggles the same at any frame rate.
 */

export type Vec3 = [number, number, number]

export interface JiggleParams {
  /** Spring stiffness, 1/s² (the mass's own frequency is √stiffness / 2π). */
  stiffness: number
  /** Damping, 1/s: how fast its speed bleeds against the tip's. */
  damping: number
  /** The furthest the bone turns from where the clip has it, degrees. */
  maxAngle: number
  /** How much a landing or hit kicks it (metres a second of mass speed per metre a second of impact). */
  kick: number
  /** How much of its swing is up and down against side to side (the anime bounce is mostly vertical). */
  vertical: number
}

const OFF: JiggleParams = { stiffness: 0, damping: 0, maxAngle: 0, kick: 0, vertical: 1 }

/** Realistic and anime presets per region; `off` holds the bone where the clip has it. */
const TABLE: Record<Exclude<JigglePreset, 'off'>, Record<JiggleRegion | 'chestPad', JiggleParams>> = {
  realistic: {
    bust: { stiffness: 220, damping: 14, maxAngle: 7, kick: 0.25, vertical: 1.1 },
    glutes: { stiffness: 260, damping: 16, maxAngle: 5, kick: 0.2, vertical: 1 },
    belly: { stiffness: 240, damping: 15, maxAngle: 5, kick: 0.2, vertical: 1 },
    chestPad: { stiffness: 420, damping: 26, maxAngle: 2.5, kick: 0.1, vertical: 1 },
  },
  // the Gainax bounce: a soft, lively spring that rings for a few bounces after a jump, a landing, a dash or a big hit
  anime: {
    bust: { stiffness: 75, damping: 4.2, maxAngle: 22, kick: 0.9, vertical: 1.8 },
    glutes: { stiffness: 140, damping: 8, maxAngle: 10, kick: 0.45, vertical: 1.4 },
    belly: { stiffness: 160, damping: 10, maxAngle: 8, kick: 0.35, vertical: 1.2 },
    chestPad: { stiffness: 380, damping: 22, maxAngle: 3, kick: 0.12, vertical: 1 },
  },
}

/**
 * A jiggle bone's settings: `region` the bone's, `fat` the body's (0 to 1; glutes and belly soften as it rises), `male`
 * for a bust region on a male body (a subtle chest pad), `child` to hold a child's bust still.
 */
export function jiggleParams(preset: JigglePreset, region: JiggleRegion, fat: number, opts: { male?: boolean; child?: boolean } = {}): JiggleParams {
  if (preset === 'off') return OFF
  if (region === 'bust' && opts.child) return OFF
  const base = TABLE[preset][region === 'bust' && opts.male ? 'chestPad' : region]
  if (region === 'bust') return base
  // softer flesh springs slower and swings further
  const soft = Math.min(1, Math.max(0, fat))
  return { ...base, stiffness: base.stiffness * (1.2 - 0.6 * soft), maxAngle: base.maxAngle * (0.7 + 0.8 * soft), kick: base.kick * (0.7 + 0.8 * soft) }
}

export interface JiggleState {
  pos: Vec3
  vel: Vec3
  /** Where the tip was last step, for its speed. */
  last: Vec3
  ready: boolean
}

export const jiggleState = (): JiggleState => ({ pos: [0, 0, 0], vel: [0, 0, 0], last: [0, 0, 0], ready: false })

const STEP = 1 / 240

/**
 * One frame: the tip is at `tip` now (world), `length` metres from the bone's joint. `kick` is an impulse to add
 * first (a landing's or hit's speed, world metres a second, pointing the way the body was moving). Returns the mass's
 * offset from the tip, clamped to `maxAngle` at `length`.
 */
export function stepJiggle(s: JiggleState, p: JiggleParams, tip: Vec3, length: number, dt: number, kick?: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  if (!p.stiffness || !s.ready) {
    s.pos = [...tip]
    s.vel = [0, 0, 0]
    s.last = [...tip]
    s.ready = true
    out[0] = out[1] = out[2] = 0
    return out
  }
  if (kick) {
    s.vel[0] += kick[0] * p.kick
    s.vel[1] += kick[1] * p.kick * p.vertical
    s.vel[2] += kick[2] * p.kick
  }
  const steps = Math.max(1, Math.min(32, Math.round(dt / STEP)))
  const h = dt / steps
  for (let i = 0; i < steps; i++) {
    // the tip moves straight from where it was to where it is over the frame
    const f = (i + 1) / steps
    const tx = s.last[0] + (tip[0] - s.last[0]) * f
    const ty = s.last[1] + (tip[1] - s.last[1]) * f
    const tz = s.last[2] + (tip[2] - s.last[2]) * f
    const tvx = (tip[0] - s.last[0]) / dt
    const tvy = (tip[1] - s.last[1]) / dt
    const tvz = (tip[2] - s.last[2]) / dt
    // semi-implicit Euler: speed first, then position
    s.vel[0] += (p.stiffness * (tx - s.pos[0]) - p.damping * (s.vel[0] - tvx)) * h
    s.vel[1] += (p.stiffness * p.vertical * (ty - s.pos[1]) - p.damping * (s.vel[1] - tvy)) * h
    s.vel[2] += (p.stiffness * (tz - s.pos[2]) - p.damping * (s.vel[2] - tvz)) * h
    s.pos[0] += s.vel[0] * h
    s.pos[1] += s.vel[1] * h
    s.pos[2] += s.vel[2] * h
  }
  s.last = [...tip]
  out[0] = s.pos[0] - tip[0]
  out[1] = s.pos[1] - tip[1]
  out[2] = s.pos[2] - tip[2]
  // never further than the bone may turn: the mass is held on the cone's edge and its outward speed dropped
  const most = Math.tan((p.maxAngle * Math.PI) / 180) * length
  const d = Math.hypot(out[0], out[1], out[2])
  if (d > most && d > 0) {
    const k = most / d
    out[0] *= k
    out[1] *= k
    out[2] *= k
    s.pos = [tip[0] + out[0], tip[1] + out[1], tip[2] + out[2]]
    const n: Vec3 = [out[0] / most, out[1] / most, out[2] / most]
    const vn = s.vel[0] * n[0] + s.vel[1] * n[1] + s.vel[2] * n[2]
    if (vn > 0) for (let c = 0; c < 3; c++) s.vel[c] -= vn * n[c]
  }
  return out
}

/**
 * The muscles' small, stiff jiggle on landings and heavy hits: one damped ring per body, added to every muscle's
 * swell. `kick` is the impact's speed in metres a second.
 */
export interface Ring {
  x: number
  v: number
}
const RING = { stiffness: 900, damping: 18, perSpeed: 0.004 }

export function stepRing(r: Ring, dt: number, kick = 0): number {
  r.v += kick * RING.perSpeed * 30
  const steps = Math.max(1, Math.min(32, Math.round(dt / STEP)))
  const h = dt / steps
  for (let i = 0; i < steps; i++) {
    r.v += (-RING.stiffness * r.x - RING.damping * r.v) * h
    r.x += r.v * h
  }
  return r.x
}
