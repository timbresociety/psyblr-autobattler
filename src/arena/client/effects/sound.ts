import type { Delivery } from '../../../charter/types.js'

/**
 * Impact and ability sounds (R10, R41). The combat kit (Forge goal, phase 1) is a handful of short files from
 * earshot's sound bank (MIT; sounds made in code or fitted from CC0 recordings), each picked for its beat by earshot's
 * reading of the candidates: a riser whose top is the release, a swish or a thump that peaks on it, a hit that starts on
 * the contact. Until the kit has loaded, synthesised stand-ins play: a filtered noise crack for hits, a falling tone
 * for shots, a low thump for heavy blows. The master gain is the volume control.
 */
let ctx: AudioContext | undefined
let master: GainNode | undefined
let volume = 0.6
let muted = false

/** The context and master gain every sound plays through, made on first use (the dev listener taps the master). */
export function audio(): { ctx: AudioContext; master: GainNode } | undefined {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return undefined
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    // a busy fight stacks many sounds at once: the compressor keeps the sum from clipping
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.ratio.value = 8
    master.connect(limiter).connect(ctx.destination)
    applyVolume()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return { ctx, master: master! }
}

function applyVolume() {
  if (master) master.gain.value = muted ? 0 : volume
}

export function setVolume(v: number, mute: boolean) {
  volume = Math.max(0, Math.min(1, v))
  muted = mute
  applyVolume()
}

function noise(a: { ctx: AudioContext; master: GainNode }, seconds: number, freq: number, gain: number) {
  const buffer = a.ctx.createBuffer(1, Math.max(1, Math.floor(a.ctx.sampleRate * seconds)), a.ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = a.ctx.createBufferSource()
  src.buffer = buffer
  const filter = a.ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  const g = a.ctx.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g).connect(a.master)
  src.start()
}

function tone(a: { ctx: AudioContext; master: GainNode }, from: number, to: number, seconds: number, gain: number, type: OscillatorType = 'sine') {
  const osc = a.ctx.createOscillator()
  osc.type = type
  const g = a.ctx.createGain()
  const t = a.ctx.currentTime
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + seconds)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + seconds)
  osc.connect(g).connect(a.master)
  osc.start()
  osc.stop(t + seconds)
}

export function playCast(kind: Delivery['kind']) {
  const a = audio()
  if (!a) return
  if (kind === 'projectile') tone(a, 900, 300, 0.12, 0.08, 'triangle')
  else if (kind === 'beam') tone(a, 220, 880, 0.35, 0.06, 'sawtooth')
  else if (kind === 'zone' || kind === 'aura') noise(a, 0.35, 160, 0.25)
  else if (kind === 'self') tone(a, 300, 700, 0.3, 0.06)
}

export function playHit(heavy: boolean) {
  const a = audio()
  if (!a) return
  noise(a, heavy ? 0.18 : 0.06, heavy ? 500 : 2200, heavy ? 0.45 : 0.18)
  if (heavy) tone(a, 120, 45, 0.25, 0.35)
}

/** A sound in the kit: its takes (one picked at random), where each peaks (seconds), its level and how far its pitch strays. */
interface KitSound {
  takes: string[]
  peaks: number[]
  gain: number
  vary: number
}

export type Cue = 'charge' | 'charge-big' | 'swing' | 'shot' | 'burst' | 'hit' | 'hit-heavy'

/**
 * The kit, with each take's earshot reading. Peaks are earshot's measured envelope peaks; a riser peaks at its end.
 * The light hit is the weak one (it still reads closer to a kick drum): recorded foley replaces it in phase 2.
 */
export const KIT: Record<Cue, KitSound> = {
  // pro_riser/chop at 0.6 s and 1.0 s: 'a magical energy charging up, rising', z +2.6 (the 1.0 s cut z +3.8)
  charge: { takes: ['charge'], peaks: [0.595], gain: 0.35, vary: 0.04 },
  'charge-big': { takes: ['charge-big'], peaks: [0.995], gain: 0.6, vary: 0 },
  // swish/blade and swish/cane: 'a fast sword or fist swinging through the air', z +4.7 and +4.6
  swing: { takes: ['swing-a', 'swing-b'], peaks: [0.059, 0.072], gain: 0.5, vary: 0.12 },
  // swish/zing: 'a quick energy blast fired from the hand', z +4.6
  shot: { takes: ['shot'], peaks: [0.065], gain: 0.4, vary: 0.14 },
  // whoosh_big/thump_deep: 'a huge explosive energy burst', z +5.0; 'a roaring energy beam blast', z +4.3
  burst: { takes: ['burst'], peaks: [0.165], gain: 0.8, vary: 0.06 },
  // cut_hit/punch under pro_tap/knock and a band of noise: 'a punch landing on a body, a fighting game hit', z +3.3
  hit: { takes: ['hit'], peaks: [0.01], gain: 0.5, vary: 0.16 },
  // impact/punch cut to 0.9 s: 'a heavy powerful blow impact with a deep thud', z +4.1
  'hit-heavy': { takes: ['hit-heavy'], peaks: [0.039], gain: 0.8, vary: 0.08 },
}

/** Most sounds playing at once; a cue past it is dropped. */
const VOICES = 32

const buffers = new Map<string, AudioBuffer>()
let loading: Promise<void> | undefined
const voices = new Set<AudioBufferSourceNode>()

function loadKit(a: { ctx: AudioContext }) {
  loading ??= Promise.all(
    Object.values(KIT)
      .flatMap((k) => k.takes)
      .map(async (take) => {
        const res = await fetch(`/sfx/combat/${take}.wav`)
        buffers.set(take, await a.ctx.decodeAudioData(await res.arrayBuffer()))
      }),
  ).then(
    () => undefined,
    () => undefined,
  )
}

/** Whether the kit's sounds are ready; the stand-ins play until then. */
export const kitReady = () => buffers.size > 0

/** How loud a sound is where the listener is (0 to 1), and where it sits from left (-1) to right (1). */
export interface Spot {
  gain: number
  pan: number
}

/** A playing or booked sound, to cut short (a wind-up that never lands). */
export interface Voice {
  stop: () => void
}

/**
 * Play one of the kit's sounds. With `peakIn`, its peak lands that many seconds from now (a whoosh or a riser's top on
 * the release tick), starting part-way in if there isn't time for all of it; without it, it starts now (a hit on the
 * contact). Undefined while the kit loads, before the page may play sound, or when every voice is busy.
 */
export function cue(name: Cue, spot: Spot, peakIn?: number): Voice | undefined {
  const a = audio()
  if (!a) return undefined
  loadKit(a)
  const k = KIT[name]
  const i = Math.floor(Math.random() * k.takes.length)
  const buffer = buffers.get(k.takes[i])
  if (!buffer || a.ctx.state !== 'running' || voices.size >= VOICES || spot.gain * k.gain < 0.01) return undefined
  const rate = 1 + (Math.random() - 0.5) * k.vary
  const src = a.ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = rate
  const level = a.ctx.createGain()
  level.gain.value = spot.gain * k.gain
  const pan = a.ctx.createStereoPanner()
  pan.pan.value = spot.pan
  src.connect(level).connect(pan).connect(a.master)
  const now = a.ctx.currentTime
  // the peak is k.peaks[i] into the take, which plays `rate` times as fast
  const start = peakIn === undefined ? now : now + peakIn - k.peaks[i] / rate
  if (start >= now) src.start(start)
  else src.start(now, Math.min(buffer.duration, (now - start) * rate))
  voices.add(src)
  src.onended = () => {
    voices.delete(src)
    src.disconnect()
    level.disconnect()
    pan.disconnect()
  }
  return {
    stop: () => {
      const t = a.ctx.currentTime
      level.gain.setTargetAtTime(0, t, 0.015)
      src.stop(t + 0.08)
    },
  }
}
