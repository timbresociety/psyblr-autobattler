// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardHandlers, BoardScene, BoardState } from './board-scene'
import { Staging, type StagingResult } from './Staging'
import type { LoadoutDeps } from './loadout'

// the 3D scene needs a GPU; here a stand-in records what the staging screen asks of it
const fake = vi.hoisted(() => {
  const scene = {
    update: vi.fn<(s: BoardState) => void>(),
    carry: vi.fn<(hero: number, x: number, y: number) => boolean>(() => true),
    drop: vi.fn<(x: number, y: number) => { x: number; z: number } | undefined>(() => ({ x: 0, z: -12 })),
    cancelCarry: vi.fn(),
    resetView: vi.fn(),
    dispose: vi.fn(async () => {}),
  }
  return { scene, handlers: undefined as undefined | (() => BoardHandlers), fail: false }
})
vi.mock('./board-scene', () => ({
  createBoardScene: vi.fn(async (_host: HTMLElement, _state: BoardState, handlers: () => BoardHandlers): Promise<BoardScene> => {
    if (fake.fail) throw new Error('no adapter')
    fake.handlers = handlers
    return fake.scene
  }),
}))
vi.mock('./Board3D', async (original) => ({ ...(await original<typeof import('./Board3D')>()), canDraw3D: () => true }))

const none: LoadoutDeps = { search: async () => [] }

beforeEach(() => {
  vi.clearAllMocks()
  fake.fail = false
  fake.handlers = undefined
})
afterEach(cleanup)

async function open() {
  const onStart = vi.fn<(r: StagingResult) => void>()
  render(<Staging onStart={onStart} deps={none} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Blue side' }))
  // the scene module loads on demand
  await act(async () => {})
  await act(async () => {})
  return onStart
}
const bust = (name: RegExp) => screen.getByRole('listitem', { name })
const plate = () => screen.getByRole('radio', { name: /Your side/ })

describe('the 3D staging board', () => {
  it('stands in for the flat board and is kept up to date with the formation', async () => {
    await open()
    const board = screen.getByRole('application', { name: 'Arena board' })
    expect(board.tagName).toBe('DIV')
    expect(fake.scene.update).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Moguls vs Leaders' }))
    const last = fake.scene.update.mock.calls.at(-1)![0]
    expect(last.formation[0]).toHaveLength(10)
    expect(last.formation[1]).toHaveLength(10)
    expect(last.side).toBe(0)
  })

  it('carries a hero from the row onto the floor', async () => {
    await open()
    fireEvent.pointerDown(bust(/Musk/), { pointerId: 7, isPrimary: true, button: 0, clientX: 100, clientY: 800 })
    // a few pixels is still a click
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 102, clientY: 798 })
    expect(fake.scene.carry).not.toHaveBeenCalled()
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 300, clientY: 400 })
    expect(fake.scene.carry).toHaveBeenLastCalledWith(expect.any(Number), 300, 400)
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 310, clientY: 410 })
    expect(fake.scene.drop).toHaveBeenCalledWith(310, 410)
    expect(plate().textContent).toContain('(1/10)')
    // the click a drag ends with does not pick the hero for click-placing
    fireEvent.click(bust(/Musk/))
    expect(screen.queryByText(/Click spots to place more/)).toBeNull()
  })

  it('says why a carried hero was refused, and Escape puts it back', async () => {
    await open()
    fake.scene.drop.mockReturnValueOnce({ x: 0, z: 12 })
    fireEvent.pointerDown(bust(/Huang/), { pointerId: 3, isPrimary: true, button: 0, clientX: 100, clientY: 800 })
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 300, clientY: 300 })
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 300, clientY: 300 })
    expect(screen.getByText('That spot is on the other half.')).toBeTruthy()
    fireEvent.pointerDown(bust(/Huang/), { pointerId: 4, isPrimary: true, button: 0, clientX: 100, clientY: 800 })
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 300, clientY: 300 })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(fake.scene.cancelCarry).toHaveBeenCalled()
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 300, clientY: 300 })
    expect(fake.scene.drop).toHaveBeenCalledTimes(1)
    expect(plate().textContent).toContain('(0/10)')
  })

  it('moves, selects and removes placed heroes through the scene', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Moguls vs Leaders' }))
    const h = fake.handlers!()
    // selecting an enemy hero shows it and sets up the enemy side
    act(() => h.select({ side: 1, index: 0 }))
    expect(screen.getByRole('radio', { name: /Enemy side/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('region', { name: 'Hero details' }).textContent).not.toContain('Select or drag a hero')
    act(() => h.move(1, 0, 0, -10))
    expect(screen.getByText('That spot is on the other half.')).toBeTruthy()
    act(() => h.move(1, 0, 39.5, 12))
    expect(screen.getByText('That spot is too close to the wall.')).toBeTruthy()
    act(() => h.remove(1, 0))
    expect(screen.getByRole('radio', { name: /Enemy side/ }).textContent).toContain('(9/10)')
    // a placed hero in the hand lights the row up as a place to drop it
    act(() => h.dragging(true))
    expect(screen.getByRole('list', { name: 'Loadout' }).className).toContain('drop-off')
    act(() => h.dragging(false))
    expect(screen.getByRole('list', { name: 'Loadout' }).className).not.toContain('drop-off')
  })

  it('gives the renderer back before the match starts', async () => {
    const onStart = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Moguls vs Leaders' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(fake.scene.dispose).toHaveBeenCalled()
    await act(async () => {})
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(fake.scene.dispose.mock.invocationCallOrder[0]).toBeLessThan(onStart.mock.invocationCallOrder[0])
  })

  it('falls back to the flat board when the scene cannot start', async () => {
    fake.fail = true
    await open()
    await act(async () => {})
    expect(screen.getByRole('application', { name: 'Arena board' }).tagName.toLowerCase()).toBe('svg')
  })
})
