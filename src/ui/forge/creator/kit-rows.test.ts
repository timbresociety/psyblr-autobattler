import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS } from '../../../charter/build'
import { MOTION_SLOTS } from '../../../charter/motions'
import { TAKES } from '../reel/takes'
import { KIT_ROWS, SHARED_MOVES } from './kit-rows'

describe('the Forge kit element (GAME.md §11)', () => {
  it('one row per button, V X LMB Q E F R, together covering every skill, every own motion and every reel take', () => {
    expect(KIT_ROWS.map((r) => r.key)).toEqual(['V', 'X', 'LMB', 'Q', 'E', 'F', 'R'])
    expect(KIT_ROWS.flatMap((r) => (r.slot ? [r.slot] : [])).sort()).toEqual([...BUILD_SLOTS].sort())
    expect(KIT_ROWS.flatMap((r) => r.motions).sort()).toEqual([...MOTION_SLOTS].sort())
    expect(KIT_ROWS.map((r) => r.take).sort()).toEqual(TAKES.map((t) => t.key).filter((k) => k !== 'heavy').sort())
    expect(KIT_ROWS.find((r) => r.key === 'V')!.motions).toEqual(['combo1', 'combo2', 'combo3', 'heavy'])
  })

  it('the shared locomotion beneath the rows leaves out what a row already shows', () => {
    expect(SHARED_MOVES).not.toContain('movement')
    expect(SHARED_MOVES).not.toContain('passive')
    expect(SHARED_MOVES).toContain('dodge')
  })
})
