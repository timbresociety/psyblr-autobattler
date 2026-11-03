// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proposeBuild } from '../../../charter/build'
import { KitPanel } from './KitPanel'

afterEach(cleanup)

describe('the Forge kit element (GAME.md §11)', () => {
  const build = proposeBuild({ heroName: 'Ada', roleId: 'fighter', skills: {} }).build

  it('one row per button, each with its animation, effect colours and a play button that runs its take on the reel', () => {
    const onReel = vi.fn()
    const onOnce = vi.fn()
    render(<KitPanel build={build} gender="f" onIdle={() => {}} onPlay={() => {}} onOnce={onOnce} fits={{}} motions={{ combo1: 'punch_jab' }} onMotion={() => {}} onReel={onReel} card={(slot) => <p>card {slot}</p>} glance={null} />)
    const rows = screen.getAllByRole('region').filter((r) => r.classList.contains('kit-row'))
    expect(rows.map((r) => r.getAttribute('aria-label')?.split(':')[0])).toEqual(['V', 'X', 'LMB', 'Q', 'E', 'F', 'R'])
    const v = within(rows[0])
    for (const strike of ['Combo 1', 'Combo 2', 'Combo 3', 'Heavy']) expect(v.getByLabelText(`V ${strike} motion`)).toBeTruthy()
    expect(v.getByRole('img', { name: 'Melee effect colours' })).toBeTruthy()
    expect(v.getByText('card basic')).toBeTruthy()
    // X has no skill of its own, so no card
    expect(within(rows[1]).queryByText(/^card/)).toBeNull()
    fireEvent.click(v.getByRole('button', { name: 'Play Melee on the dummy' }))
    expect(onReel).toHaveBeenCalledWith('combo')
    expect(onOnce).toHaveBeenCalledWith('punch_jab')
  })
})
