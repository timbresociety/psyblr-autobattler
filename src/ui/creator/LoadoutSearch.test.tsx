// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proposeBuild, type Build } from '../../charter/build'
import type { CreatorDeps, HeroResult } from '../api'
import { offlineChat } from '../api'
import { CreatorScreen } from './CreatorScreen'

afterEach(cleanup)

const jensen: HeroResult = { id: 'hero-jensen', name: 'Jensen', roleId: 'marksman', photo: null, useCount: 12 }
const original = proposeBuild({ heroName: 'Jensen', roleId: 'marksman', skills: {} }).build

function deps(over: Partial<CreatorDeps> = {}): CreatorDeps {
  return {
    propose: vi.fn(async (hero) => ({ build: proposeBuild(hero).build, offline: false, limits: [] })),
    chat: vi.fn(async (build: Build, message: string) => offlineChat(build, message)),
    runGate: vi.fn(async (build: Build) => ({ state: 'ready' as const, winRate: 0.5, build: { ...build, gate: { state: 'ready' as const, winRate: 0.5 } } })),
    uploadPhoto: vi.fn(async () => undefined),
    search: vi.fn(async (q: string) => ('jensen'.startsWith(q.toLowerCase()) ? [jensen] : [])),
    addHero: vi.fn(async () => ({ id: 'build-mine', heroId: jensen.id, build: structuredClone(original) })),
    createHero: vi.fn(async () => ({ heroId: 'h', buildId: 'b' })),
    saveBuild: vi.fn(async (id: string, build: Build) => ({ id, heroId: jensen.id, build })),
    listBuilds: vi.fn(async () => []),
    ...over,
  }
}

const typeName = (value: string) => fireEvent.change(screen.getByLabelText('Hero name'), { target: { value } })

describe('global loadout (U12)', () => {
  it('typing "Jen" lists matching heroes within the debounce window', async () => {
    const d = deps()
    render(<CreatorScreen deps={d} />)
    typeName('Jen')
    expect(await screen.findByText('Jensen', {}, { timeout: 1000 })).toBeTruthy()
    expect(d.search).toHaveBeenCalledTimes(1)
  })

  it('"Add free" creates a build and opens it with the shared look (F2)', async () => {
    const d = deps()
    render(<CreatorScreen deps={d} />)
    typeName('Jen')
    const add = await screen.findByRole('button', { name: 'Add free' })
    await act(async () => fireEvent.click(add))
    expect(d.addHero).toHaveBeenCalledWith('hero-jensen')
    expect(await screen.findByRole('heading', { name: 'Jensen' })).toBeTruthy()
    expect((screen.getByLabelText('Role') as HTMLSelectElement).value).toBe('marksman')
  })

  it("editing the added build saves to the player's own copy, not the shared original (AE7)", async () => {
    const d = deps()
    render(<CreatorScreen deps={d} />)
    typeName('Jen')
    const add = await screen.findByRole('button', { name: 'Add free' })
    await act(async () => fireEvent.click(add))
    await act(async () => fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'tank' } }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ready' })))
    const saveButton = await screen.findByRole('button', { name: 'Save changes' })
    await act(async () => fireEvent.click(saveButton))
    expect(d.saveBuild).toHaveBeenCalledWith('build-mine', expect.objectContaining({ roleId: 'tank' }))
    expect(d.createHero).not.toHaveBeenCalled()
    expect(original.roleId).toBe('marksman')
  })

  it('with no matches, only "Build my own" shows', async () => {
    render(<CreatorScreen deps={deps()} />)
    typeName('Zorblax')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build my own' })).toBeTruthy())
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByRole('button', { name: 'Add free' })).toBeNull()
  })

  it('a search failure shows an inline retry and does not block creation', async () => {
    let fail = true
    const search = vi.fn(async () => {
      if (fail) throw new Error('offline')
      return [jensen]
    })
    render(<CreatorScreen deps={deps({ search })} />)
    typeName('Jen')
    const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 1000 })
    expect((screen.getByRole('button', { name: 'Forge hero' }) as HTMLButtonElement).disabled).toBe(false)
    fail = false
    await act(async () => fireEvent.click(retry))
    expect(await screen.findByText('Jensen', {}, { timeout: 1000 })).toBeTruthy()
  })

  it('the loadout lists every hero the device has added or built', async () => {
    const listBuilds = vi.fn(async () => [{ id: 'b1', heroId: 'h1', build: original }])
    render(<CreatorScreen deps={deps({ listBuilds })} />)
    expect(await screen.findByRole('button', { name: /Jensen/ })).toBeTruthy()
  })

  it('a new hero that passed the gate is saved as a new shared hero', async () => {
    const d = deps()
    render(<CreatorScreen deps={d} />)
    typeName('Liang')
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'a quiet strategist' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forge hero' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ready' })))
    const saveNew = await screen.findByRole('button', { name: 'Save to loadout' })
    await act(async () => fireEvent.click(saveNew))
    expect(d.createHero).toHaveBeenCalled()
  })
})
