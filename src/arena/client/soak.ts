import { BUILD_SLOTS } from '../../charter/build.js'
import { ENGINE } from '../engine/calibration.js'
import type { MatchEvent } from '../engine/events.js'
import { TAU } from '../engine/maths.js'
import { AIM_STEPS, slotBit, type Command, type HeroState, type MatchState } from '../engine/state.js'
import type { QualityLevel } from './quality.js'

/**
 * The soak test (Forge goal, phase 0): real 20-hero matches back to back, waves of ultimates forced to overlap, and
 * one hero driven through the human command path from the third-person camera, for ten minutes or more. It keeps
 * every frame time and samples memory and draw counts, so one run says whether the game holds 60 fps on this machine
 * and whether anything grows from match to match. `?soak` runs it (src/ui/arena/SoakScreen.tsx); this file holds
 * the parts that need no screen.
 */

export interface SoakOptions {
  minutes: number
  /** Seconds of fighting between waves of forced ultimates. */
  ultimateEvery: number
  /** Heroes per wave whose ultimate comes off cooldown at once, alternating sides. */
  ultimatesPerWave: number
  /** A match still going after this many seconds is cut off and the next one starts. */
  matchSeconds: number
  seed: number
}

export const DEFAULT_SOAK: SoakOptions = { minutes: 10, ultimateEvery: 15, ultimatesPerWave: 6, matchSeconds: 150, seed: 1 }

/** What passes (point 8 of the goal): 60 fps at the median, 99% of fight frames inside two vsyncs, no fight stall. */
export const SOAK_PASS = { medianMs: 17.5, p99Ms: 33.4, stallMs: 100 }

/** `&minutes=10&ults=15&wave=6&match=150&seed=1`; anything missing or invalid keeps its default. */
export function soakOptions(search: string): SoakOptions {
  const q = new URLSearchParams(search)
  const num = (key: string, fallback: number) => {
    const v = Number(q.get(key))
    return q.has(key) && Number.isFinite(v) && v > 0 ? v : fallback
  }
  return {
    minutes: num('minutes', DEFAULT_SOAK.minutes),
    ultimateEvery: num('ults', DEFAULT_SOAK.ultimateEvery),
    ultimatesPerWave: Math.round(num('wave', DEFAULT_SOAK.ultimatesPerWave)),
    matchSeconds: num('match', DEFAULT_SOAK.matchSeconds),
    seed: Math.round(num('seed', DEFAULT_SOAK.seed)),
  }
}

/**
 * The scripted player: circle the nearest enemy at about 4 m, changing direction every 4 s, aim at it, swing every
 * tick and press every other skill twice a second (a press on cooldown does nothing), the way an eager player would.
 */
export function soakCommand(match: MatchState, hero: number): Command {
  const me = match.heroes[hero]
  let target: HeroState | undefined
  let best = Infinity
  for (const h of match.heroes) {
    if (!h.alive || h.team === me.team) continue
    const d = (h.position.x - me.position.x) ** 2 + (h.position.z - me.position.z) ** 2
    if (d < best) {
      best = d
      target = h
    }
  }
  const vertical = me.airborne ? -1 : 0
  if (!target) return { moveX: 0, moveZ: 0, vertical, aimYaw: Math.round((me.yaw / TAU) * AIM_STEPS), aimPitch: 0, buttons: 0 }
  const dx = target.position.x - me.position.x
  const dz = target.position.z - me.position.z
  const dist = Math.sqrt(dx * dx + dz * dz) || 1
  const [ux, uz] = [dx / dist, dz / dist]
  const turn = Math.floor(match.tick / (4 * ENGINE.tickHz)) % 2 ? 1 : -1
  // sideways around the target, plus a pull in or out toward 4 m
  const pull = Math.max(-1, Math.min(1, (dist - 4) / 2))
  const mx = -uz * turn + ux * pull
  const mz = ux * turn + uz * pull
  const len = Math.sqrt(mx * mx + mz * mz) || 1
  let buttons = slotBit('basic')
  if (match.tick % Math.round(ENGINE.tickHz / 2) === 0) for (const slot of BUILD_SLOTS) if (slot !== 'passive') buttons |= slotBit(slot)
  return { moveX: mx / len, moveZ: mz / len, vertical, aimYaw: Math.round((Math.atan2(dx, dz) / TAU) * AIM_STEPS), aimPitch: 0, buttons }
}

/** Take the ultimate off cooldown for up to `count` living heroes, alternating sides, so the wave lands together. */
export function forceUltimates(match: MatchState, count: number, wave: number): number[] {
  const sides = ([0, 1] as const).map((team) => match.heroes.filter((h) => h.alive && h.team === team))
  const picked: number[] = []
  for (let i = 0; picked.length < count && i < count * 4; i++) {
    const side = sides[(i + wave) % 2]
    const h = side.length ? side[(Math.floor(i / 2) + wave) % side.length] : undefined
    if (h && !picked.includes(h.id)) picked.push(h.id)
  }
  for (const id of picked) match.heroes[id].cooldowns.ultimate = 0
  return picked
}

export type SoakPhase = 'loading' | 'fight' | 'result'

/** What the screen knows right now, for spikes and samples. */
export interface SoakContext {
  match: number
  phase: SoakPhase
  alive: number
  controlled: boolean
  quality: QualityLevel
  pixelRatio: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
}

export interface FrameStats {
  frames: number
  medianMs: number
  p95Ms: number
  p99Ms: number
  worstMs: number
  /** Frames that missed a vsync (over 20 ms), missed two (over 33.4 ms), and stalls (over 100 ms). */
  over20: number
  over33: number
  over100: number
}

/** Ten seconds of the run. */
export interface SoakSample extends FrameStats, SoakContext {
  /** Seconds since the soak started, at the end of the window. */
  t: number
  heapMb?: number
  casts: number
  ultimates: number
}

/** A frame over 33.4 ms, with what was going on. */
export interface SoakSpike {
  t: number
  ms: number
  match: number
  phase: SoakPhase
  alive: number
  controlled: boolean
  quality: QualityLevel
  /** Casts in the second before, and ultimates in the two seconds before. */
  casts: number
  ultimates: number
}

/** Counts when a match's fight starts: these should come back to the same level every match. */
export interface SoakMatchStart {
  match: number
  t: number
  geometries: number
  textures: number
  heapMb?: number
}

export interface SoakReport {
  options: SoakOptions
  startedAt: string
  userAgent: string
  viewport: { width: number; height: number; pixelRatio: number }
  elapsed: number
  finished: boolean
  matches: number
  /** Every frame of every fight, and every frame overall. */
  fight: FrameStats
  all: FrameStats
  samples: SoakSample[]
  spikes: SoakSpike[]
  matchStarts: SoakMatchStart[]
  ultimateWaves: { t: number; forced: number; fired: number }[]
  pass: { frames: boolean; memory: boolean; notes: string[] }
}

/** Frame statistics for a list of frame times; empty-safe. */
export function frameStats(ms: ArrayLike<number>): FrameStats {
  const sorted = Float64Array.from(ms).sort()
  const n = sorted.length
  const at = (p: number) => (n ? sorted[Math.min(n - 1, Math.ceil(n * p) - 1)] : 0)
  let over20 = 0
  let over33 = 0
  let over100 = 0
  for (const v of sorted) {
    if (v > 20) over20++
    if (v > SOAK_PASS.p99Ms) over33++
    if (v > SOAK_PASS.stallMs) over100++
  }
  const medianMs = n ? (n % 2 ? sorted[n >> 1] : (sorted[(n >> 1) - 1] + sorted[n >> 1]) / 2) : 0
  return { frames: n, medianMs, p95Ms: at(0.95), p99Ms: at(0.99), worstMs: n ? sorted[n - 1] : 0, over20, over33, over100 }
}

const PHASES: SoakPhase[] = ['loading', 'fight', 'result']
const MAX_SPIKES = 1000

/**
 * The recorder: feed it every frame, every batch of match events, and the screen's context once a second; it samples
 * every ten seconds and writes the report. `now` is seconds, from the screen's clock.
 */
export function createSoakRecorder(options: SoakOptions, env: { userAgent: string; viewport: SoakReport['viewport']; startedAt: string }) {
  const capacity = Math.ceil(options.minutes * 60 * 240) + 1
  const frames = new Float32Array(capacity)
  const phases = new Uint8Array(capacity)
  let count = 0
  let windowStart = 0
  let elapsed = 0
  let context: SoakContext = { match: 0, phase: 'loading', alive: 0, controlled: false, quality: 'full', pixelRatio: 1, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 }
  // when the current fight started, and whether its counts are in yet (taken 5 s in, once everything has drawn)
  let fightSince = -1
  let counted = -1
  // cast times over the last 10 s for spikes, and totals for the current sample
  const casts: number[] = []
  const ultimates: number[] = []
  let sampleCasts = 0
  let sampleUltimates = 0
  const samples: SoakSample[] = []
  const spikes: SoakSpike[] = []
  const matchStarts: SoakMatchStart[] = []
  const waves: SoakReport['ultimateWaves'] = []
  const recent = (list: number[], seconds: number) => list.filter((t) => t > elapsed - seconds).length
  const prune = (list: number[]) => {
    while (list.length && list[0] < elapsed - 10) list.shift()
  }
  const heap = () => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    return m ? Math.round(m.usedJSHeapSize / 1e6) : undefined
  }
  const finished = () => elapsed >= options.minutes * 60

  const fightCode = PHASES.indexOf('fight')
  const sample = (): SoakSample => {
    // judged on fight frames when the window has any: loading the next match is not what the player plays
    const all = frames.subarray(windowStart, count)
    const fighting = all.filter((_, i) => phases[windowStart + i] === fightCode)
    const s: SoakSample = { ...frameStats(fighting.length ? fighting : all), ...context, phase: fighting.length ? 'fight' : context.phase, t: Math.round(elapsed * 10) / 10, heapMb: heap(), casts: sampleCasts, ultimates: sampleUltimates }
    windowStart = count
    samples.push(s)
    sampleCasts = 0
    sampleUltimates = 0
    return s
  }

  const report = (): SoakReport => {
    const fight = frameStats(frames.subarray(0, count).filter((_, i) => phases[i] === fightCode))
    const notes: string[] = []
    const framesPass = fight.frames > 0 && fight.medianMs <= SOAK_PASS.medianMs && fight.p99Ms <= SOAK_PASS.p99Ms && fight.over100 === 0
    if (fight.medianMs > SOAK_PASS.medianMs) notes.push(`median fight frame ${fight.medianMs.toFixed(1)} ms, over ${SOAK_PASS.medianMs}`)
    if (fight.p99Ms > SOAK_PASS.p99Ms) notes.push(`99th percentile ${fight.p99Ms.toFixed(1)} ms, over ${SOAK_PASS.p99Ms}`)
    if (fight.over100) notes.push(`${fight.over100} fight frames over ${SOAK_PASS.stallMs} ms`)
    // the first match warms caches and compiles shaders, so growth is judged from the second fight on
    const base = matchStarts[1] ?? matchStarts[0]
    const last = matchStarts[matchStarts.length - 1]
    let memoryPass = true
    if (base && last && last !== base) {
      const grew = (a: number, b: number, slack: number) => b > a * 1.1 + slack
      if (grew(base.geometries, last.geometries, 5)) notes.push(`geometries ${base.geometries} → ${last.geometries} between fights ${base.match + 1} and ${last.match + 1}`)
      if (grew(base.textures, last.textures, 3)) notes.push(`textures ${base.textures} → ${last.textures} between fights ${base.match + 1} and ${last.match + 1}`)
      if (base.heapMb && last.heapMb && grew(base.heapMb, last.heapMb, 30)) notes.push(`heap ${base.heapMb} → ${last.heapMb} MB between fights ${base.match + 1} and ${last.match + 1}`)
      memoryPass = !notes.some((n) => /^(geometries|textures|heap) /.test(n))
    } else notes.push('memory needs at least three fights to judge')
    return {
      options,
      ...env,
      elapsed: Math.round(elapsed),
      finished: finished(),
      matches: context.match + 1,
      fight,
      all: frameStats(frames.subarray(0, count)),
      samples,
      spikes,
      matchStarts,
      ultimateWaves: waves,
      pass: { frames: framesPass, memory: memoryPass && matchStarts.length >= 3, notes },
    }
  }

  return {
    finished,
    elapsed: () => elapsed,
    /** One frame of `ms` milliseconds. */
    frame(ms: number) {
      if (finished() || count >= capacity) return
      elapsed += ms / 1000
      frames[count] = ms
      phases[count] = PHASES.indexOf(context.phase)
      count++
      if (ms > SOAK_PASS.p99Ms && spikes.length < MAX_SPIKES) {
        const { match, phase, alive, controlled, quality } = context
        spikes.push({ t: Math.round(elapsed * 10) / 10, ms: Math.round(ms * 10) / 10, match, phase, alive, controlled, quality, casts: recent(casts, 1), ultimates: recent(ultimates, 2) })
      }
    },
    events(events: readonly MatchEvent[]) {
      for (const e of events) {
        if (e.type !== 'cast') continue
        casts.push(elapsed)
        sampleCasts++
        if (e.slot !== 'ultimate') continue
        ultimates.push(elapsed)
        sampleUltimates++
      }
      prune(casts)
      prune(ultimates)
    },
    /** Once a second from the screen. */
    context(next: SoakContext) {
      if (next.phase === 'fight' && (context.phase !== 'fight' || next.match !== context.match)) fightSince = elapsed
      if (next.phase === 'fight' && counted !== next.match && fightSince >= 0 && elapsed - fightSince >= 5) {
        counted = next.match
        matchStarts.push({ match: next.match, t: Math.round(elapsed), geometries: next.geometries, textures: next.textures, heapMb: heap() })
      }
      context = next
    },
    /** A wave of `forced` ultimates went out; `fired` is filled in from the casts that follow. */
    wave(forced: number) {
      waves.push({ t: Math.round(elapsed), forced, fired: 0 })
    },
    waveFired(fired: number) {
      const last = waves[waves.length - 1]
      if (last) last.fired = fired
    },
    ultimatesSince: (seconds: number) => recent(ultimates, seconds),
    sample,
    report,
  }
}

export type SoakRecorder = ReturnType<typeof createSoakRecorder>
