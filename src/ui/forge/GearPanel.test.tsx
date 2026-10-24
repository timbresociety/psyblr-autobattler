// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN, type PieceEntry } from '../../kit/pieces'
import { ApiError } from '../api'
import { GearPanel } from './GearPanel'
import { pieceDeps } from './pieces.fixture'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const straw: PieceEntry = { id: '0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e', name: 'Straw Hat', kind: 'head', tags: ['straw hat'], url: '/dev-store/pieces/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.glb', thumb: '/dev-store/pieces/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', tint: null, source: 'community' }

function panel(over: Partial<Parameters<typeof GearPanel>[0]> = {}) {
  const onWear = vi.fn()
  const onFound = vi.fn()
  render(<GearPanel gear={{}} catalog={BUILT_IN} onWear={onWear} onFound={onFound} {...over} />)
  return { onWear, onFound }
}

describe('the gear panel and the repository', () => {
  it('offers to generate what the prompt asked for and the repository lacks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const pieces = pieceDeps({
      session: vi.fn(async () => ({ signedIn: true })),
      startPiece: vi.fn(async () => ({ job: { id: 'j1', kind: 'head' as const, name: 'Straw Hat', status: 'running' as const }, balance: 40 })),
      pollPiece: vi.fn(async () => ({ job: { id: 'j1', kind: 'head' as const, name: 'Straw Hat', status: 'done' as const, piece: straw }, balance: 40 })),
    })
    const { onWear, onFound } = panel({ pieces, gaps: [{ phrase: 'straw hat', kind: 'head' }] })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /straw hat/ })))
    expect((screen.getByLabelText('What is it?') as HTMLInputElement).value).toBe('straw hat')
    expect(within(screen.getByRole('radiogroup', { name: 'Where it goes' })).getByRole('radio', { checked: true }).textContent).toBe('Head')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Generate · / })))
    expect(pieces.startPiece).toHaveBeenCalledWith({ prompt: 'straw hat', kind: 'head' })
    expect(screen.getByText(/Making Straw Hat/)).toBeTruthy()
    await act(async () => vi.advanceTimersByTimeAsync(3100))
    expect(onFound).toHaveBeenCalledWith([straw])
    expect(onWear).toHaveBeenCalledWith('head', { id: straw.id, url: straw.url })
  })

  it('asks for an account only when generating, and for credits only when short', async () => {
    const startPiece = vi.fn().mockRejectedValueOnce(new ApiError('not enough credits for this step', 402)).mockResolvedValue({ job: { id: 'j2', kind: 'hand', name: 'Jade Sickle', status: 'running' }, balance: 40 })
    const session = vi.fn().mockResolvedValueOnce({ signedIn: false }).mockResolvedValue({ signedIn: true })
    const pieces = pieceDeps({ session, startPiece, startSignIn: vi.fn(async () => ({ devLink: 'http://localhost/?signin=tok' })) })
    panel({ pieces })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Generate a piece' })))
    fireEvent.change(screen.getByLabelText('What is it?'), { target: { value: 'a jade sickle' } })
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Where it goes' })).getByRole('radio', { name: 'Hand' }))
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

  it("says so up front when generating isn't switched on, before asking for an email", async () => {
    panel({ pieces: pieceDeps({ generationReady: vi.fn(async () => false) }) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Generate a piece' })))
    expect(await screen.findByText(/isn't switched on for this deployment yet/)).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('searches the community too, and marks its pieces', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const pieces = pieceDeps({ searchPieces: vi.fn(async () => [straw]) })
    const { onFound } = panel({ pieces, catalog: [...BUILT_IN, straw] })
    fireEvent.change(screen.getByLabelText('Search gear'), { target: { value: 'straw' } })
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(pieces.searchPieces).toHaveBeenCalledWith('straw')
    expect(onFound).toHaveBeenCalledWith([straw])
    const head = within(screen.getByRole('radiogroup', { name: 'Head' }))
    expect(head.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Nothing', 'Straw Hat'])
    expect(head.getByRole('radio', { name: 'Straw Hat' }).className).toContain('community')
  })
})
