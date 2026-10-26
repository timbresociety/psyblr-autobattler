// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proposeBuild, type Build } from '../../charter/build'
import type { BuildRecord, HeroResult, LoadoutDeps } from '../api'
import { LoadoutScreen } from './LoadoutScreen'

afterEach(cleanup)

const ada: Build = { ...proposeBuild({ heroName: 'Ada', roleId: 'support', skills: {} }).build, sizeClass: 'small', gate: { state: 'ready', winRate: 0.5 } }
const mine: BuildRecord = { id: 'b1', heroId: 'h-ada', build: ada, photo: null }
const jensen: HeroResult = { id: 'h-jensen', name: 'Jensen', roleId: 'marksman', photo: null, useCount: 12 }
const adaHero: HeroResult = { id: 'h-ada', name: 'Ada', roleId: 'support', photo: null, useCount: 3 }

function deps(over: Partial<LoadoutDeps> = {}): LoadoutDeps {
  return {
    listBuilds: vi.fn(async () => [mine]),
    popular: vi.fn(async () => [jensen, adaHero]),
    search: vi.fn(async (q: string) => ('jensen'.startsWith(q.toLowerCase()) ? [jensen] : [])),
    addHero: vi.fn(async () => ({ id: 'b2', heroId: jensen.id, build: ada })),
    removeBuild: vi.fn(async () => undefined),
    ...over,
  }
}

const handlers = () => ({ onEdit: vi.fn(), onRemix: vi.fn(), onForge: vi.fn() })

describe('loadout (R18)', () => {
  it('lists your heroes with their role, size and balance state, and opens one in the Forge', async () => {
    const h = handlers()
    render(<LoadoutScreen deps={deps()} {...h} />)
    const card = (await screen.findByText('Ada', { selector: '.card strong' })).closest('li') as HTMLElement
    expect(within(card).getByText('Small')).toBeTruthy()
    expect(within(card).getByText('Ready')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Edit in Forge' }))
    expect(h.onEdit).toHaveBeenCalledWith(mine)
    fireEvent.click(within(card).getByRole('button', { name: 'Remix' }))
    expect(h.onRemix).toHaveBeenCalledWith(ada)
  })

  it('removing asks first, then takes the hero out of your loadout', async () => {
    const d = deps()
    render(<LoadoutScreen deps={d} {...handlers()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Ada' }))
    expect(d.removeBuild).not.toHaveBeenCalled()
    const ask = screen.getByRole('group', { name: 'Remove Ada?' })
    await act(async () => fireEvent.click(within(ask).getByRole('button', { name: 'Remove' })))
    expect(d.removeBuild).toHaveBeenCalledWith('b1')
    expect(d.listBuilds).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toMatch(/left your loadout/)
  })

  it('browses the most used heroes, marks the ones you have, and adds the rest for free', async () => {
    const d = deps()
    render(<LoadoutScreen deps={d} {...handlers()} />)
    expect(await screen.findByText('Most used')).toBeTruthy()
    const results = (await screen.findByText('Jensen')).closest('ul') as HTMLElement
    expect(within(results).getByText('In your loadout')).toBeTruthy()
    await act(async () => fireEvent.click(within(results).getByRole('button', { name: 'Add free' })))
    expect(d.addHero).toHaveBeenCalledWith('h-jensen')
    expect(screen.getByRole('status').textContent).toMatch(/Jensen joined your loadout/)
  })

  it('searches the global loadout by name, and says so when nobody matches', async () => {
    const d = deps()
    render(<LoadoutScreen deps={d} {...handlers()} />)
    fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'Zorblax' } })
    expect(await screen.findByText(/No hero called “Zorblax” yet/, {}, { timeout: 1000 })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'Jen' } })
    expect(await screen.findByText('Matches', {}, { timeout: 1000 })).toBeTruthy()
    expect(d.search).toHaveBeenCalledWith('Jen')
  })

  it('with none of your own heroes, it points to the Forge and still lists the 20 starters', async () => {
    const h = handlers()
    render(<LoadoutScreen deps={deps({ listBuilds: vi.fn(async () => []) })} {...h} />)
    expect(await screen.findByText(/haven't made a hero of your own yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Forge one' }))
    expect(h.onForge).toHaveBeenCalled()
    const starters = within(screen.getByRole('list', { name: 'Starter heroes' })).getAllByRole('listitem')
    expect(starters).toHaveLength(20)
    // a starter can't be removed, only remixed into a new hero of your own
    expect(within(starters[0]).queryByRole('button', { name: /Remove/ })).toBeNull()
    fireEvent.click(within(starters[0]).getByRole('button', { name: 'Remix in Forge' }))
    expect(h.onRemix).toHaveBeenCalledWith(expect.objectContaining({ heroName: expect.stringContaining('Musk') }))
  })
})
