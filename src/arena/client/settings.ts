import { clamp } from '../engine/maths.js'
import { setVolume } from './effects/sound.js'

/** Volume and mute (R41), remembered between visits; storage can be unavailable, so every access is guarded. */
const KEY = 'psyblr.arena.audio'

export interface AudioSettings {
  volume: number
  muted: boolean
}

export function loadAudio(): AudioSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AudioSettings> | null
    if (raw && typeof raw.volume === 'number') return { volume: clamp(raw.volume, 0, 1), muted: raw.muted === true }
  } catch {
    // private window or blocked storage: fall through to the default
  }
  return { volume: 0.6, muted: false }
}

export function saveAudio(s: AudioSettings) {
  setVolume(s.volume, s.muted)
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // not remembered this time; the setting still applies
  }
}
