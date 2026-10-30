/**
 * The frame-rate guard (U18, R26): watch the rolling frame time and step quality down one level at a time when frames
 * run long, and back up when there is headroom. Render resolution moves first and on its own (the scaler below); these
 * levels only start once it is at its floor. In order: slower far-hero animation, fewer particles, shadows redrawn every
 * third frame. None of them compiles a shader: turning shadows or bloom off rebuilt every material and froze a 10v10
 * for 1 to 3 seconds (the soak test, 2026-10-30).
 */
export const QUALITY_LEVELS = ['full', 'slow-animation', 'fewer-particles', 'lazy-shadows'] as const
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

/** Is `current` at or past `step`? Steps add up: lazy shadows still come with fewer particles. */
export const atLeast = (current: QualityLevel, step: QualityLevel) => QUALITY_LEVELS.indexOf(current) >= QUALITY_LEVELS.indexOf(step)

/**
 * The render scale (Forge goal, phase 0): a fraction of the device's pixel ratio, moved in small steps before any
 * quality level. On a Retina MacBook Air the pixel count is most of a frame's cost, and changing it compiles nothing.
 */
export const SCALER = {
  min: 0.5,
  max: 1,
  /** Seconds of frames averaged before a change. */
  windowSeconds: 1,
  /** Averages above this scale down; at or under `fastMs` a vsync-capped display is holding 60 fps. */
  slowMs: 18,
  fastMs: 17.5,
  stallMs: 100,
  settleSeconds: 1,
  /** Seconds of headroom before a step up; doubles each time a step up has to be undone, up to the max. */
  upSeconds: 3,
  maxUpSeconds: 60,
  upStep: 1.05,
}

export interface Scaler {
  scale: number
  frames: number[]
  sinceChange: number
  upDelay: number
  /** True right after a step up, until the next change. */
  probing: boolean
}

/** A scaler starting at `scale`: the last match's, so a slow machine doesn't start every fight at full resolution. */
export const createScaler = (scale: number = SCALER.max): Scaler => ({
  scale: Math.min(SCALER.max, Math.max(SCALER.min, scale)),
  frames: [],
  sinceChange: 0,
  upDelay: SCALER.upSeconds,
  probing: false,
})

export const atFloor = (s: Scaler) => s.scale <= SCALER.min + 1e-6

/** Feed one frame's time; returns the render scale to use now. */
export function scaleFor(s: Scaler, frameMs: number): number {
  if (frameMs > SCALER.stallMs) return s.scale
  s.frames.push(frameMs)
  s.sinceChange += frameMs / 1000
  let total = s.frames.reduce((a, b) => a + b, 0)
  while (total > SCALER.windowSeconds * 1000 && s.frames.length > 1) total -= s.frames.shift()!
  if (total < SCALER.windowSeconds * 1000 * 0.9) return s.scale
  const avg = total / s.frames.length
  if (avg > SCALER.slowMs && !atFloor(s) && s.sinceChange >= SCALER.settleSeconds) {
    if (s.probing) s.upDelay = Math.min(SCALER.maxUpSeconds, s.upDelay * 2)
    // pixels cost about the square of the scale, so a frame twice too slow wants a scale about 0.7 as big
    rescale(s, Math.max(SCALER.min, s.scale * Math.max(0.7, Math.sqrt(1000 / 60 / avg))))
  } else if (avg <= SCALER.fastMs && s.scale < SCALER.max && s.sinceChange >= s.upDelay) {
    rescale(s, Math.min(SCALER.max, s.scale * SCALER.upStep))
    s.probing = true
  }
  return s.scale
}

function rescale(s: Scaler, scale: number) {
  s.scale = scale
  s.sinceChange = 0
  s.frames = []
  s.probing = false
}
