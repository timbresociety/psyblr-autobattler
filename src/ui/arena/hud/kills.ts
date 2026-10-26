import type { MatchEvent } from '../../../arena/engine/events'
import type { BuildSlot } from '../../../charter/types'

/**
 * Who killed whom (R38). The engine's death event names only the fallen hero, so the feed remembers the last hero
 * to land a hit on each target and credits it. Damage over time sends no hit, so a burn that finishes someone off
 * is credited to whoever hit them last, which is nearly always the one who lit it.
 */

export interface Kill {
  /** Unique per tracker, for React keys and removal. */
  id: number
  victim: number
  killer?: number
  /** The killing hit's slot, for the ability icon. */
  slot?: BuildSlot
  heavy: boolean
  /** The killer was the hero the streamer was steering at that moment. */
  byStreamer: boolean
}

/** How long an entry stays in the feed, seconds. */
export const KILL_FEED_SECONDS = 5
/** Most entries shown at once; older ones drop off first. */
export const KILL_FEED_MAX = 4

export function createKillTracker() {
  const lastHit = new Map<number, { source: number; slot: BuildSlot; heavy: boolean }>()
  let seq = 0
  return {
    /** Read one tick's events in order; returns the kills among them. */
    read(events: readonly MatchEvent[], controlled?: number): Kill[] {
      const kills: Kill[] = []
      for (const e of events) {
        if (e.type === 'hit') {
          if (e.source !== e.target) lastHit.set(e.target, { source: e.source, slot: e.slot, heavy: e.heavy })
        } else if (e.type === 'death') {
          const hit = lastHit.get(e.hero)
          lastHit.delete(e.hero)
          kills.push({ id: ++seq, victim: e.hero, killer: hit?.source, slot: hit?.slot, heavy: hit?.heavy ?? false, byStreamer: hit !== undefined && hit.source === controlled })
        }
      }
      return kills
    },
    /** Who last hit a hero, if anyone has since it last died. */
    lastHitter: (hero: number) => lastHit.get(hero)?.source,
  }
}
