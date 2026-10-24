import type { Delivery } from '../../../charter/types.js'

/**
 * Basic impact and ability sounds (R10, R41), synthesised so no audio files ship: a filtered noise crack for hits,
 * a falling tone for shots, a low thump for heavy blows. The master gain is the volume control.
 */
let ctx: AudioContext | undefined
let master: GainNode | undefined
let volume = 0.6
let muted = false

function audio(): { ctx: AudioContext; master: GainNode } | undefined {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return undefined
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.connect(ctx.destination)
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
