import type { MatchState } from './state'

/** A deep copy of the whole match state, so a match can rewind or fork from any tick (KTD1). */
export const snapshot = (match: MatchState): MatchState => structuredClone(match)

/** Restore a snapshot in place, keeping the caller's reference to the match. */
export function restore(match: MatchState, from: MatchState) {
  Object.assign(match, structuredClone(from))
  for (const key of Object.keys(match) as (keyof MatchState)[]) if (!(key in from)) delete match[key]
}

/** 32-bit FNV-1a over every number, string and flag in the state, in a fixed order. Same state, same hash. */
export function hashState(match: MatchState): number {
  let h = 0x811c9dc5
  const view = new DataView(new ArrayBuffer(8))
  const byte = (b: number) => {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const walk = (value: unknown) => {
    if (typeof value === 'number') {
      view.setFloat64(0, value)
      for (let i = 0; i < 8; i++) byte(view.getUint8(i))
    } else if (typeof value === 'string') {
      for (let i = 0; i < value.length; i++) byte(value.charCodeAt(i) & 0xff)
      byte(0)
    } else if (typeof value === 'boolean') byte(value ? 1 : 2)
    else if (value === undefined || value === null) byte(3)
    else if (Array.isArray(value)) {
      byte(4)
      value.forEach(walk)
    } else if (typeof value === 'object') {
      byte(5)
      for (const key of Object.keys(value as object).sort()) {
        walk(key)
        walk((value as Record<string, unknown>)[key])
      }
    }
  }
  walk(match)
  return h
}
