/**
 * The frame-rate guard (U18, R26): watch the rolling frame time and step quality down one level at a time when frames
 * run long, and back up when there is headroom. Levels, in order: shadows off, slower far-hero animation, fewer
 * particles, lower render resolution.
 */
export const QUALITY_LEVELS = ['full', 'no-shadows', 'slow-animation', 'fewer-particles', 'low-resolution'] as const
export type QualityLevel = (typeof QUALITY_LEVELS)[number]

export const GUARD = {
  windowSeconds: 2,
  /** A sustained average above this steps down (R26: 20 ms frames). */
  slowMs: 20,
  /** At or under this the browser is holding 60 fps; a vsync-capped display never reports less than ~16.7 ms. */
  fastMs: 17.5,
  /** Longer frames are a stall or a return to the tab, not load, and are left out of the average. */
  stallMs: 100,
  /** Seconds to wait after a step before stepping down again. */
  settleSeconds: 2,
  /** Seconds of headroom before trying a step up; doubles each time a step up has to be undone, up to the max. */
  upSeconds: 8,
  maxUpSeconds: 120,
}

export interface Guard {
  level: number
  frames: number[]
  sinceChange: number
  upDelay: number
  /** True right after a step up, until the next change: a step down then means the step up did not hold. */
  probing: boolean
}

export const createGuard = (): Guard => ({ level: 0, frames: [], sinceChange: 0, upDelay: GUARD.upSeconds, probing: false })

/** Feed one frame's time; returns the level to use now. */
export function observe(g: Guard, frameMs: number): QualityLevel {
  if (frameMs > GUARD.stallMs) return QUALITY_LEVELS[g.level]
  g.frames.push(frameMs)
  g.sinceChange += frameMs / 1000
  let total = g.frames.reduce((a, b) => a + b, 0)
  while (total > GUARD.windowSeconds * 1000 && g.frames.length > 1) total -= g.frames.shift()!
  if (total >= GUARD.windowSeconds * 1000 * 0.9) {
    const avg = total / g.frames.length
    if (avg > GUARD.slowMs && g.level < QUALITY_LEVELS.length - 1 && g.sinceChange >= GUARD.settleSeconds) {
      // a step up that could not hold makes the next try wait longer, so quality does not flap
      if (g.probing) g.upDelay = Math.min(GUARD.maxUpSeconds, g.upDelay * 2)
      step(g, 1)
    } else if (avg <= GUARD.fastMs && g.level > 0 && g.sinceChange >= g.upDelay) {
      step(g, -1)
      g.probing = true
      return QUALITY_LEVELS[g.level]
    }
  }
  return QUALITY_LEVELS[g.level]
}

function step(g: Guard, by: 1 | -1) {
  g.level += by
  g.sinceChange = 0
  g.frames = []
  g.probing = false
}

/** Is `current` at or past `step`? Steps add up: a lower resolution still has its shadows off. */
export const atLeast = (current: QualityLevel, step: QualityLevel) => QUALITY_LEVELS.indexOf(current) >= QUALITY_LEVELS.indexOf(step)
