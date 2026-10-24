// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HeroLook } from '../../charter/look'
import type { PieceEntry } from '../../kit/pieces'
import type { LibraryEntry } from '../../kit/wear/library'
import { ApiError } from '../api'
import { WardrobePanel } from './WardrobePanel'
import { pieceDeps } from './pieces.fixture'
import { wardrobeCatalog } from './wardrobe'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const id = '0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e'
const straw: LibraryEntry = { id, name: 'Straw Hat', slot: 'head', tags: ['straw hat'], url: `/dev-store/items/${id}.glb`, thumb: `/dev-store/items/${id}.webp`, source: 'community', channels: [{ name: 'straw', color: '#d8b46a', finish: 'knit' }], knobs: [] }
const sickle: PieceEntry = { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', name: 'Jade Sickle', kind: 'hand', tags: ['sickle'], url: '/dev-store/pieces/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.glb', thumb: '/dev-store/pieces/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.webp', tint: null, source: 'community' }
const plain: HeroLook = { gender: 'm', hair: 'crop', armour: false, cape: false, colors: {} }

/** The panel over a look it really changes, and the last look it made. */
function panel(over: Partial<Parameters<typeof WardrobePanel>[0]> = {}) {
  const onFound = vi.fn()
  const seen: { look: HeroLook } = { look: plain }
  function Harness() {
    const [look, setLook] = useState(plain)
    return (
      <WardrobePanel
        look={look}
        catalog={wardrobeCatalog([])}
        onLook={(change) =>
          setLook((l) => {
            seen.look = change(l)
            return seen.look
          })
        }
        onFound={onFound}
        {...over}
      />
    )
  }
  render(<Harness />)
  return { onFound, seen }
}

const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }))

describe('the wardrobe', () => {
  it('reads an old look into items, one tab per slot, and marks the tabs with something worn', () => {
    panel()
    const tabs = screen.getAllByRole('tab').map((t) => [t.textContent, !!t.querySelector('.worn-dot')])
    expect(tabs).toEqual([
      ['Hair & beard', true],
      ['Head', false],
      ['Upper', true],
      ['Lower', true],
      ['Full', false],
      ['Back', false],
      ['Feet', true],
      ['Gear', false],
    ])
    expect(within(screen.getByRole('radiogroup', { name: 'Hair' })).getByRole('radio', { checked: true }).textContent).toBe('Crop')
  })

  it('wears a kimono over both halves, then climbs the rungs: recolour, restyle, and back to as made', () => {
    const { seen } = panel()
    tab('Full')
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Full body' })).getByRole('radio', { name: 'Kimono' }))
    expect(seen.look.wear?.full).toEqual({ id: 'kimono', url: '/kit/wear/kimono.glb' })
    expect(seen.look.wear?.upper).toBeUndefined()
    expect(seen.look.wear?.lower).toBeUndefined()

    const worn = within(screen.getByRole('group', { name: 'Kimono, worn' }))
    const rungs = within(worn.getByRole('group', { name: 'Kimono rungs' }))
    expect(rungs.getAllByRole('button').map((b) => b.textContent)).toEqual(['WearFree', 'RecolourFree', 'RestyleFree'])
    expect(rungs.getByRole('button', { name: /^Wear/ }).getAttribute('aria-current')).toBe('step')

    fireEvent.change(worn.getByLabelText('Kimono obi colour'), { target: { value: '#112233' } })
    fireEvent.change(worn.getByLabelText('Kimono obi finish'), { target: { value: 'metal' } })
    expect(seen.look.wear?.full).toMatchObject({ colors: [null, '#112233'], finishes: [null, 'metal'] })
    expect(rungs.getByRole('button', { name: /^Recolour/ }).getAttribute('aria-current')).toBe('step')

    fireEvent.click(rungs.getByRole('button', { name: /^Restyle/ }))
    fireEvent.change(worn.getByLabelText('Kimono length'), { target: { value: '0.5' } })
    fireEvent.click(within(worn.getByRole('radiogroup', { name: 'Kimono print' })).getByRole('radio', { name: 'Waves' }))
    fireEvent.change(worn.getByLabelText('Print on'), { target: { value: '1' } })
    expect(seen.look.wear?.full).toMatchObject({ knobs: { length: 0.5 }, print: { id: 'seigaiha', channel: 1 } })
    expect(rungs.getByRole('button', { name: /^Restyle/ }).getAttribute('aria-current')).toBe('step')

    fireEvent.click(rungs.getByRole('button', { name: /^Wear/ }))
    expect(seen.look.wear?.full).toEqual({ id: 'kimono', url: '/kit/wear/kimono.glb' })
  })

  it('offers to generate what the prompt asked for and the repository lacks, as a garment for its slot', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const pieces = pieceDeps({
      session: vi.fn(async () => ({ signedIn: true })),
      startPiece: vi.fn(async () => ({ job: { id: 'j1', kind: 'head' as const, name: 'Straw Hat', status: 'running' as const }, balance: 40 })),
      pollPiece: vi.fn(async () => ({ job: { id: 'j1', kind: 'head' as const, name: 'Straw Hat', status: 'done' as const, item: straw }, balance: 40 })),
    })
    const { onFound, seen } = panel({ pieces, gaps: [{ phrase: 'straw hat', slot: 'head' }] })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /straw hat/ })))
    expect(screen.getByRole('tab', { name: /^Head/ }).getAttribute('aria-selected')).toBe('true')
    const generator = within(screen.getByRole('region', { name: 'Generate for over the head' }))
    expect((generator.getByLabelText('What is it?') as HTMLInputElement).value).toBe('straw hat')
    // a garment's slot is where it goes, so there is no picker for it
    expect(generator.queryByRole('radiogroup', { name: 'Where it goes' })).toBeNull()
    await act(async () => fireEvent.click(generator.getByRole('button', { name: /^Generate · / })))
    expect(pieces.startPiece).toHaveBeenCalledWith({ prompt: 'straw hat', slot: 'head' })
    expect(screen.getByText(/Making Straw Hat/)).toBeTruthy()
    await act(async () => vi.advanceTimersByTimeAsync(3100))
    expect(onFound).toHaveBeenCalledWith([straw])
    expect(seen.look.wear?.head).toEqual({ id, url: straw.url })
  })

  it('asks for an account only when generating, and for credits only when short', async () => {
    const startPiece = vi.fn().mockRejectedValueOnce(new ApiError('not enough credits for this step', 402)).mockResolvedValue({ job: { id: 'j2', kind: 'hand', name: 'Jade Sickle', status: 'running' }, balance: 40 })
    const session = vi.fn().mockResolvedValueOnce({ signedIn: false }).mockResolvedValue({ signedIn: true })
    const pieces = pieceDeps({ session, startPiece, startSignIn: vi.fn(async () => ({ devLink: 'http://localhost/?signin=tok' })) })
    panel({ pieces })
    tab('Gear')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Generate for right hand · 40 credits' })))
    fireEvent.change(screen.getByLabelText('What is it?'), { target: { value: 'a jade sickle' } })
    expect(within(screen.getByRole('radiogroup', { name: 'Where it goes' })).getByRole('radio', { checked: true }).textContent).toBe('Hand')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Generate · / })))
    // signed out: the sign-in comes up, and following the link carries on with the same piece
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a link' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Open sign-in link/ })))
    expect(pieces.verifySignIn).toHaveBeenCalledWith('tok')
    // short of credits: the free grant is offered, and claiming it carries on again
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /Claim 80 free credits/ })))
    expect(startPiece).toHaveBeenLastCalledWith({ prompt: 'a jade sickle', kind: 'hand' })
    expect(await screen.findByText(/Making Jade Sickle/)).toBeTruthy()
  })

  it('wears a generated hand piece in the hand it was made for', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const pieces = pieceDeps({
      session: vi.fn(async () => ({ signedIn: true })),
      startPiece: vi.fn(async () => ({ job: { id: 'j3', kind: 'hand' as const, name: 'Jade Sickle', status: 'running' as const }, balance: 40 })),
      pollPiece: vi.fn(async () => ({ job: { id: 'j3', kind: 'hand' as const, name: 'Jade Sickle', status: 'done' as const, piece: sickle }, balance: 40 })),
    })
    const { seen } = panel({ pieces })
    tab('Gear')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Generate for left hand · 40 credits' })))
    fireEvent.change(screen.getByLabelText('What is it?'), { target: { value: 'a jade sickle' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Generate · / })))
    await act(async () => vi.advanceTimersByTimeAsync(3100))
    expect(seen.look.wear?.hand_l).toEqual({ id: sickle.id, url: sickle.url })
    expect(seen.look.wear?.hand_r).toBeUndefined()
  })

  it("says so up front when generating isn't switched on, before asking for an email", async () => {
    panel({ pieces: pieceDeps({ generationReady: vi.fn(async () => false) }) })
    tab('Back')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Generate for back · 40 credits' })))
    expect(await screen.findByText(/isn't switched on for this deployment yet/)).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('searches the community too, and marks its items', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const pieces = pieceDeps({ searchItems: vi.fn(async () => [straw]) })
    const { onFound } = panel({ pieces, catalog: wardrobeCatalog([straw]) })
    fireEvent.change(screen.getByLabelText('Search the wardrobe'), { target: { value: 'straw' } })
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(pieces.searchItems).toHaveBeenCalledWith('straw')
    expect(onFound).toHaveBeenCalledWith([straw])
    tab('Head')
    const head = within(screen.getByRole('radiogroup', { name: 'Over the head' }))
    expect(head.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Nothing', 'Straw kasa', 'Straw Hat'])
    expect(head.getByRole('radio', { name: 'Straw Hat' }).className).toContain('community')
  })
})
