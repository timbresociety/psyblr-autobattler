// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Staging, type StagingResult } from './Staging'
import { demoLoadout, type LoadoutDeps } from './loadout'

const none: LoadoutDeps = { search: async () => [] }

// jsdom has no layout: give the board an 800x600 box so clicks map onto the arena (80 m by 60 m)
beforeEach(() => {
  Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) })
})
afterEach(cleanup)

async function open(props: Partial<Parameters<typeof Staging>[0]> = {}) {
  const onStart = vi.fn<(r: StagingResult) => void>()
  render(<Staging onStart={onStart} deps={none} {...props} />)
  await act(async () => {})
  return onStart
}
const at = (worldX: number, worldZ: number) => ({ clientX: ((worldX + 40) / 80) * 800, clientY: ((30 - worldZ) / 60) * 600 })
const board = () => screen.getByRole('application', { name: 'Arena board' })
const bustOf = (name: RegExp) => screen.getByRole('listitem', { name })

async function placeAt(name: RegExp, x: number, z: number) {
  fireEvent.click(bustOf(name))
  fireEvent.click(board(), at(x, z))
  fireEvent.click(bustOf(name))
}

describe('staging (U16)', () => {
  it('refuses a hero dropped on the other half, and places it on its own', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Blue side' }))
    await placeAt(/Musk/, 0, 10)
    expect(screen.getByText('That spot is on the other half.')).toBeTruthy()
    await placeAt(/Musk/, 0, -10)
    expect(screen.getByTestId('token-0-0')).toBeTruthy()
  })

  it('places the same hero three times, removes one with Delete, and drags one off the field', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Blue side' }))
    for (const x of [-6, 0, 6]) await placeAt(/Huang/, x, -10)
    expect(screen.getByTestId('token-0-2')).toBeTruthy()
    fireEvent.pointerDown(screen.getByTestId('token-0-2'), { pointerId: 1 })
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(screen.queryByTestId('token-0-2')).toBeNull()
    fireEvent.pointerDown(screen.getByTestId('token-0-1'), { pointerId: 1 })
    fireEvent.pointerUp(board(), { clientX: 900, clientY: 700 })
    expect(screen.queryByTestId('token-0-1')).toBeNull()
  })

  it('shows the stacking penalty at a fourth tank, and lights the team bonus at four roles', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Blue side' }))
    for (const x of [-12, -6, 0, 6]) await placeAt(/Bezos/, x, -10)
    expect(screen.getByText(/Tank ×4 · stacked past 3/)).toBeTruthy()
    expect(screen.getByTestId('team-bonus').className).not.toContain('lit')
    await placeAt(/Musk/, -12, -14)
    await placeAt(/Huang/, -4, -14)
    await placeAt(/Satya/, 3, -14)
    expect(screen.getByTestId('team-bonus').className).toContain('lit')
  })

  it('keeps Start disabled until both sides have a hero', async () => {
    const onStart = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Red side' }))
    const start = () => screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement
    expect(start().disabled).toBe(true)
    await placeAt(/Lincoln/, 0, 10)
    expect(start().disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /Enemy side/ }))
    fireEvent.click(screen.getByRole('button', { name: /Auto-deploy enemy side/ }))
    expect(start().disabled).toBe(false)
    fireEvent.click(start())
    const result = onStart.mock.calls[0][0]
    expect(result.side).toBe(1)
    expect(result.formation[0]).toHaveLength(10)
    expect(result.formation[1]).toHaveLength(1)
  })

  it("shows a selected hero's tooltips in the details panel", async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Blue side' }))
    fireEvent.click(bustOf(/Merkel/))
    const details = screen.getByRole('region', { name: 'Hero details' })
    expect(details.textContent).toContain('Angela')
    expect(details.textContent).toContain('Ultimate')
  })

  it('offers the Creator and the demo roster when the loadout is empty', async () => {
    await open({ demo: false })
    fireEvent.click(screen.getByRole('button', { name: 'Blue side' }))
    expect(screen.getByRole('link', { name: /Make one in the Creator/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'use the demo roster' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(demoLoadout().length)
  })
})
