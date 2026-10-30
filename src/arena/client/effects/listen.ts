import { audio } from './sound.js'

/**
 * Dev only: records what the game plays, so a script can hand it to earshot (an agent's ears). `__listen.start()`
 * taps the master gain; `__listen.stop()` returns everything heard since as a mono 16-bit WAV in base64. Loaded under
 * `import.meta.env.DEV`, so it never ships.
 */
let tap: ScriptProcessorNode | undefined
let chunks: Float32Array[] = []

function untap() {
  if (!tap) return
  tap.disconnect()
  audio()?.master.disconnect(tap)
  tap = undefined
}

function start(): string {
  const a = audio()
  if (!a) return 'no audio'
  untap()
  chunks = []
  // a script processor is deprecated, but it needs no worklet file; it hears the master and outputs silence
  tap = a.ctx.createScriptProcessor(4096, 1, 1)
  tap.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  a.master.connect(tap)
  tap.connect(a.ctx.destination)
  return a.ctx.state
}

function stop(): string {
  const rate = audio()?.ctx.sampleRate ?? 48000
  untap()
  const samples = chunks.reduce((n, c) => n + c.length, 0)
  const view = new DataView(new ArrayBuffer(44 + samples * 2))
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples * 2, true)
  let at = 44
  for (const chunk of chunks)
    for (const x of chunk) {
      view.setInt16(at, Math.max(-1, Math.min(1, x)) * 0x7fff, true)
      at += 2
    }
  chunks = []
  // to base64 in slices: one spread of a few megabytes overflows the stack
  const bytes = new Uint8Array(view.buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function install() {
  ;(window as unknown as { __listen?: unknown }).__listen = { start, stop, state: () => audio()?.ctx.state ?? 'no audio' }
}
