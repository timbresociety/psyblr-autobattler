import { describe, expect, it } from 'vitest'
import type { MatchEvent } from '../../../arena/engine/events'
import { createKillTracker } from './kills'

const hit = (source: number, target: number, slot: 'basic' | 'active1' | 'ultimate' = 'basic', heavy = false): MatchEvent => ({ type: 'hit', source, target, slot, amount: 40, heavy })
const death = (hero: number): MatchEvent => ({ type: 'death', hero })

describe('kill feed attribution (R38)', () => {
  it('credits the last hero to hit the victim, with the killing slot', () => {
    const t = createKillTracker()
    expect(t.read([hit(1, 7), hit(2, 7, 'ultimate', true)])).toEqual([])
    const [kill] = t.read([death(7)])
    expect(kill).toMatchObject({ victim: 7, killer: 2, slot: 'ultimate', heavy: true, byStreamer: false })
  })

  it('reads a tick in order: the hit that kills comes before the death in the same batch', () => {
    const t = createKillTracker()
    t.read([hit(3, 9)])
    const [kill] = t.read([hit(4, 9, 'active1'), death(9)])
    expect(kill.killer).toBe(4)
    expect(kill.slot).toBe('active1')
  })

  it('remembers hits across ticks, forgets them once the victim dies, and leaves an unhit death uncredited', () => {
    const t = createKillTracker()
    t.read([hit(0, 5)])
    t.read([{ type: 'cast', hero: 1, slot: 'active1', templateId: 'x' }])
    expect(t.read([death(5)])[0].killer).toBe(0)
    expect(t.lastHitter(5)).toBeUndefined()
    const [fell] = t.read([death(5)])
    expect(fell.killer).toBeUndefined()
    expect(fell.slot).toBeUndefined()
  })

  it('flags a kill by the hero the streamer is steering, and gives each kill its own id', () => {
    const t = createKillTracker()
    const kills = t.read([hit(2, 11), death(11), hit(3, 12), death(12)], 2)
    expect(kills.map((k) => k.byStreamer)).toEqual([true, false])
    expect(new Set(kills.map((k) => k.id)).size).toBe(2)
  })

  it('never credits a hero for its own death', () => {
    const t = createKillTracker()
    t.read([hit(6, 4), hit(4, 4)])
    expect(t.read([death(4)])[0].killer).toBe(6)
  })
})
