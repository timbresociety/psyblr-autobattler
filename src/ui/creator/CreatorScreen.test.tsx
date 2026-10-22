// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proposeBuild, requestStats, swapAlternatives, type Build } from '../../charter/build'
import { getRole } from '../../charter/roles'
import type { GateOutcome } from '../../sim/gate'
import type { CreatorDeps } from '../api'
import { offlineChat } from '../api'
import { CreatorScreen } from './CreatorScreen'

afterEach(cleanup)

function deps(over: Partial<CreatorDeps> = {}): CreatorDeps {
  return {
    propose: vi.fn(async (hero) => ({ build: proposeBuild({ ...hero, roleId: 'mage' }).build, offline: false, limits: [] })),
    chat: vi.fn(async (build: Build, message: string) => offlineChat(build, message)),
    runGate: vi.fn(async (build: Build): Promise<GateOutcome> => ({ state: 'ready', winRate: 0.5, build: { ...build, gate: { state: 'ready', winRate: 0.5 } } })),
    uploadPhoto: vi.fn(async () => undefined),
    ...over,
  }
}

async function forge(d: CreatorDeps) {
  render(<CreatorScreen deps={d} />)
  fireEvent.change(screen.getByLabelText('Hero name'), { target: { value: 'Dario' } })
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'a genius who rewinds time and fires beams' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forge hero' })))
  await screen.findByRole('heading', { name: 'Dario' })
}

describe('creator (U11)', () => {
  it('name and first message produce a role, six skill cards and a stat split (F1)', async () => {
    await forge(deps())
    expect((screen.getByLabelText('Role') as HTMLSelectElement).value).toBe('mage')
    expect(screen.getAllByRole('article')).toHaveLength(6)
    expect(screen.getByLabelText('Stat split')).toBeTruthy()
    expect(screen.getByText(/of 30 points free/)).toBeTruthy()
  })

  it('dragging a stat past its cap stops at the closest value and shows the limit (AE4)', async () => {
    await forge(deps())
    const armor = screen.getByLabelText('Armor') as HTMLInputElement
    const cap = getRole('mage').caps.armor
    await act(async () => fireEvent.change(armor, { target: { value: String(cap * 3) } }))
    expect(Number(armor.value)).toBeLessThanOrEqual(cap)
    expect(screen.getByText(/Armor (tops out|can reach)/)).toBeTruthy()
  })

  it('"make him unkillable" shows the limits that were hit (AE2)', async () => {
    const chat = vi.fn(async (build: Build) => {
      const r = requestStats(build, { maxHealth: 'max', armor: 'max', regen: 'max' })
      return r.ok ? { build: r.build, offline: false, understood: true, limits: r.limits } : { build, offline: false, understood: false, limits: [] }
    })
    await forge(deps({ chat }))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'make him unkillable' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    expect(await screen.findByText(/Done, within the limits/)).toBeTruthy()
  })

  it('switching role to Tank keeps skill names, shows new tooltips and refills the pool (AE3)', async () => {
    await forge(deps())
    fireEvent.change(screen.getByLabelText('Active 1 name'), { target: { value: 'Rewind' } })
    const before = within(screen.getByLabelText('Active 1 tooltip')).getByText(/./, { selector: '.mechanic' }).textContent
    await act(async () => fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'tank' } }))
    expect((screen.getByLabelText('Active 1 name') as HTMLInputElement).value).toBe('Rewind')
    expect(screen.getByText(/30 of 30 points free/)).toBeTruthy()
    const after = within(screen.getByLabelText('Active 1 tooltip')).getByText(/./, { selector: '.mechanic' }).textContent
    expect(after).not.toBe(before)
  })

  it('the swap menu offers 2 to 3 alternatives and swapping updates the tooltip live', async () => {
    await forge(deps())
    const select = screen.getByLabelText('Ultimate mechanic') as HTMLSelectElement
    expect(select.options.length - 1).toBeGreaterThanOrEqual(2)
    expect(select.options.length - 1).toBeLessThanOrEqual(3)
    const target = select.options[1]
    await act(async () => fireEvent.change(select, { target: { value: target.value } }))
    expect(within(screen.getByLabelText('Ultimate tooltip')).getByText(target.textContent as string)).toBeTruthy()
  })

  it('a blocked result names the strongest slot, offers alternatives and keeps Ready disabled (AE5)', async () => {
    const runGate = vi.fn(async (build: Build): Promise<GateOutcome> => ({
      state: 'blocked',
      winRate: 0.8,
      strongestSlot: 'ultimate',
      alternatives: swapAlternatives(build, 'ultimate'),
      build: { ...build, gate: { state: 'blocked', winRate: 0.8, strongestSlot: 'ultimate' } },
    }))
    await forge(deps({ runGate }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ready' })))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Ultimate is carrying it/)
    expect((screen.getByRole('button', { name: 'Ready' }) as HTMLButtonElement).disabled).toBe(true)
    const alt = within(alert).getAllByRole('button')[0]
    await act(async () => fireEvent.click(alt))
    expect((screen.getByRole('button', { name: 'Ready' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('with the API offline, the creator still proposes a kit and shows an offline notice', async () => {
    const propose = vi.fn(async (hero: Parameters<CreatorDeps['propose']>[0]) => ({ build: proposeBuild(hero).build, offline: true, limits: [] }))
    await forge(deps({ propose }))
    expect(screen.getByText(/Offline mode/)).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(6)
  })

  it('offline, a chat edit the parser cannot read says so and points to the controls', async () => {
    await forge(deps())
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'make her vibe mysterious' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    expect(await screen.findByText(/use the controls/i)).toBeTruthy()
  })

  it('editing an unswapped description re-matches; a hand-swapped one asks first', async () => {
    await forge(deps())
    const desc = screen.getByLabelText('Active 2 description')
    fireEvent.change(desc, { target: { value: 'freezes everyone around' } })
    await act(async () => fireEvent.blur(desc))
    expect(within(screen.getByLabelText('Active 2 tooltip')).getByText(/Frost/)).toBeTruthy()

    const select = screen.getByLabelText('Active 2 mechanic') as HTMLSelectElement
    await act(async () => fireEvent.change(select, { target: { value: select.options[1].value } }))
    const swappedTo = select.options[0].textContent
    fireEvent.change(desc, { target: { value: 'hurls a giant fireball' } })
    await act(async () => fireEvent.blur(desc))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect((screen.getByLabelText('Active 2 mechanic') as HTMLSelectElement).options[0].textContent).toBe(swappedTo)
  })

  it('Ready shows the win rate after the gate passes', async () => {
    await forge(deps())
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ready' })))
    await waitFor(() => expect(screen.getByText(/Ready for battle · wins 50%/)).toBeTruthy())
  })
})
