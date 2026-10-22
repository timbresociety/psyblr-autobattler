/**
 * The frame-rate guard (U18, R26): watch the rolling frame time and step quality down one level at a time when frames
 * run long, and back up when there is headroom. Levels, in order: shadows off, slower far-hero animation, fewer
 * particles, lower render resolution.
 */
export const QUALITY_LEVELS = ['full', 'no-shadows', 'slow-animation', 'fewer-particles', 'low-resolution'] as const
export type QualityLevel = (typeof QUALITY_LEVELS)[number]

export const GUARD = { windowSeconds: 2, slowMs: 18, fastMs: 12.5, settleSeconds: 2 }

export interface Guard {
  level: number
  frames: number[]
  sinceChange: number
}

export const createGuard = (): Guard => ({ level: 0, frames: [], sinceChange: 0 })

/** Feed one frame's time; returns the level to use now. */
export function observe(g: Guard, frameMs: number): QualityLevel {
  g.frames.push(frameMs)
  g.sinceChange += frameMs / 1000
  let total = g.frames.reduce((a, b) => a + b, 0)
  while (total > GUARD.windowSeconds * 1000 && g.frames.length > 1) total -= g.frames.shift()!
  if (g.sinceChange >= GUARD.settleSeconds && total >= GUARD.windowSeconds * 1000 * 0.9) {
    const avg = total / g.frames.length
    if (avg > GUARD.slowMs && g.level < QUALITY_LEVELS.length - 1) step(g, 1)
    else if (avg < GUARD.fastMs && g.level > 0) step(g, -1)
  }
  return QUALITY_LEVELS[g.level]
}

function step(g: Guard, by: 1 | -1) {
  g.level += by
  g.sinceChange = 0
  g.frames = []
}

/** Is `current` at or past `step`? Steps add up: a lower resolution still has its shadows off. */
export const atLeast = (current: QualityLevel, step: QualityLevel) => QUALITY_LEVELS.indexOf(current) >= QUALITY_LEVELS.indexOf(step)
