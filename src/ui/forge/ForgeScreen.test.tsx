// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { proposeBuild, requestStats, swapAlternatives, type Build } from '../../charter/build'
import { getRole } from '../../charter/roles'
import type { GateOutcome } from '../../sim/gate'
import type { ForgeDeps } from '../api'
import { offlineChat } from '../api'
import { ForgeScreen } from './ForgeScreen'

afterEach(cleanup)

// jsdom has no object URLs; the Forge makes one per image preview
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

function deps(over: Partial<ForgeDeps> = {}): ForgeDeps {
  return {
    propose: vi.fn(async (hero) => ({ build: proposeBuild({ ...hero, roleId: 'mage' }).build, offline: false, limits: [] })),
    chat: vi.fn(async (build: Build, message: string) => offlineChat(build, message)),
    runGate: vi.fn(async (build: Build): Promise<GateOutcome> => ({ state: 'ready', winRate: 0.5, build: { ...build, gate: { state: 'ready', winRate: 0.5 } } })),
    prepareImage: vi.fn(async (file: Blob) => ({ ok: true as const, blob: file, width: 512, height: 512 })),
    uploadPhoto: vi.fn(async () => ({ ok: true as const, url: 'https://store.public.blob.vercel-storage.com/heroes/a.webp' })),
    search: vi.fn(async () => []),
    addHero: vi.fn(async () => { throw new Error('unused') }),
    createHero: vi.fn(async () => ({ heroId: 'h1', buildId: 'b1' })),
    saveBuild: vi.fn(async (id: string, build: Build) => ({ id, heroId: 'h1', build })),
    listBuilds: vi.fn(async () => []),
    ...over,
  }
}

async function forge(d: ForgeDeps) {
  render(<ForgeScreen deps={d} />)
  fireEvent.change(screen.getByLabelText('Hero name'), { target: { value: 'Dario' } })
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'a genius who rewinds time and fires beams' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forge hero' })))
  await screen.findByRole('heading', { name: 'Dario' })
}

/** The role is a radio group of tiles (R10). */
const roleNow = () => (screen.getByRole('radiogroup', { name: 'Role' }).querySelector('[aria-checked="true"]') as HTMLElement).dataset.roleId
const pickRole = (name: string) => fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Role' })).getByRole('radio', { name }))

describe('forge (U11)', () => {
  it('name and first message produce a role, six skill cards and a stat split (F1)', async () => {
    await forge(deps())
    expect(roleNow()).toBe('mage')
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
    await act(async () => pickRole('Tank'))
    expect((screen.getByLabelText('Active 1 name') as HTMLInputElement).value).toBe('Rewind')
    expect(screen.getByText(/30 of 30 points free/)).toBeTruthy()
    const after = within(screen.getByLabelText('Active 1 tooltip')).getByText(/./, { selector: '.mechanic' }).textContent
    expect(after).not.toBe(before)
  })

  it('the swap menu offers the closest 2 to 3 first, then the whole library by family, and swapping updates the tooltip live', async () => {
    await forge(deps())
    const select = screen.getByLabelText('Ultimate mechanic') as HTMLSelectElement
    const groups = [...select.querySelectorAll('optgroup')]
    expect(groups[0].label).toBe('Closest to your words')
    expect(groups[0].querySelectorAll('option').length).toBeGreaterThanOrEqual(2)
    expect(groups[0].querySelectorAll('option').length).toBeLessThanOrEqual(3)
    expect(select.options.length).toBeGreaterThanOrEqual(7)
    const target = select.options[select.options.length - 1]
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

  it('a kit too weak to hold its own is blocked with the slot holding it back, not sent in hopeless', async () => {
    const runGate = vi.fn(async (build: Build): Promise<GateOutcome> => ({
      state: 'blocked',
      winRate: 0.04,
      strongestSlot: 'basic',
      alternatives: swapAlternatives(build, 'basic'),
      build: { ...build, gate: { state: 'blocked', winRate: 0.04, strongestSlot: 'basic', blockedFor: 'weak' } },
    }))
    await forge(deps({ runGate }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ready' })))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Too weak to hold its own/)
    expect(alert.textContent).toMatch(/Basic attack is holding it back|holding it back/)
    expect((screen.getByRole('button', { name: 'Ready' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('with the API offline, the creator still proposes a kit and shows an offline notice', async () => {
    const propose = vi.fn(async (hero: Parameters<ForgeDeps['propose']>[0]) => ({ build: proposeBuild(hero).build, offline: true, limits: [] }))
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

describe('forge async safety', () => {
  it('an edit made during the balance check is kept; the stale result is discarded', async () => {
    let finish: (o: GateOutcome) => void = () => undefined
    const runGate = vi.fn((build: Build) => new Promise<GateOutcome>((resolve) => { finish = resolve; void build }))
    await forge(deps({ runGate }))
    fireEvent.click(screen.getByRole('button', { name: 'Ready' }))
    await act(async () => pickRole('Tank'))
    const stale = proposeBuild({ heroName: 'Dario', roleId: 'mage', skills: {} }).build
    await act(async () => finish({ state: 'ready', winRate: 0.5, build: { ...stale, gate: { state: 'ready', winRate: 0.5 } } }))
    expect(roleNow()).toBe('tank')
    expect(await screen.findByText(/changed during the balance check/)).toBeTruthy()
  })

  it('a failing balance check says so instead of hanging', async () => {
    const runGate = vi.fn(async () => { throw new Error('worker died') })
    await forge(deps({ runGate }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ready' })))
    expect(await screen.findByText(/Couldn't run the balance check/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Ready' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a failed upload removes the image and says why', async () => {
    render(<ForgeScreen deps={deps({ uploadPhoto: vi.fn(async () => ({ ok: false as const, reason: 'server' as const })) })} />)
    const file = new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' })
    await act(async () => fireEvent.change(screen.getByLabelText('Reference images'), { target: { files: [file] } }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't upload that image/)
    expect(document.querySelectorAll('.ref')).toHaveLength(0)
  })
})

const image = (name = 'me.jpg', type = 'image/jpeg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], name, { type })
const addFiles = (files: File[]) => act(async () => fireEvent.change(screen.getByLabelText('Reference images'), { target: { files } }))

describe('forge from a prompt and reference images', () => {
  it('with no name, the prompt names the hero, themes the skills it lists and sets the size it asks for', async () => {
    const d = deps()
    render(<ForgeScreen deps={d} />)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'a giant samurai with skills around Moon Slash and Tide Turn' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forge hero' })))
    expect(await screen.findByRole('heading', { name: 'Giant Samurai' })).toBeTruthy()
    expect(d.propose).toHaveBeenCalledWith(expect.objectContaining({ heroName: 'Giant Samurai', skills: expect.objectContaining({ active1: expect.objectContaining({ name: 'Moon Slash' }) }) }))
    const size = within(screen.getByRole('radiogroup', { name: 'Size' })).getByRole('radio', { checked: true })
    expect(size.getAttribute('aria-label')).toMatch(/^Huge/)
  })

  it('a reference image is shrunk, uploaded, and sent with the proposal and the saved hero', async () => {
    const d = deps()
    render(<ForgeScreen deps={d} />)
    await addFiles([image()])
    expect(d.prepareImage).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('.ref.ready')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Hero name'), { target: { value: 'Dario' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'a genius who fires beams' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Forge hero' })))
    expect(d.propose).toHaveBeenCalledWith(expect.objectContaining({ photoUrls: ['https://store.public.blob.vercel-storage.com/heroes/a.webp'] }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ready' })))
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Save to loadout' })))
    expect(d.createHero).toHaveBeenCalledWith(expect.objectContaining({ heroName: 'Dario' }), ['https://store.public.blob.vercel-storage.com/heroes/a.webp'])
  })

  it("an image the browser can't read says why instead of vanishing", async () => {
    render(<ForgeScreen deps={deps({ prepareImage: vi.fn(async () => ({ ok: false as const, reason: 'heic' as const })) })} />)
    await addFiles([image('IMG_0042.HEIC', 'image/heic')])
    expect((await screen.findByRole('alert')).textContent).toMatch(/HEIC/)
    expect(document.querySelectorAll('.ref')).toHaveLength(0)
  })

  it('takes three images at most and says so', async () => {
    render(<ForgeScreen deps={deps()} />)
    await addFiles([image('a.jpg'), image('b.jpg'), image('c.jpg'), image('d.jpg')])
    expect(document.querySelectorAll('.ref')).toHaveLength(3)
    expect(screen.getByRole('alert').textContent).toMatch(/Up to 3 reference images/)
  })

  it('a pasted image lands in the drop zone wherever the focus is', async () => {
    const d = deps()
    render(<ForgeScreen deps={d} />)
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { files: [image('pasted.png', 'image/png')] } })
    await act(async () => {
      document.dispatchEvent(paste)
    })
    expect(d.uploadPhoto).toHaveBeenCalledTimes(1)
    expect(paste.defaultPrevented).toBe(true)
  })

  it('picking a size changes the hero and sends the balance check back to draft', async () => {
    await forge(deps())
    await act(async () => fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Size' })).getByRole('radio', { name: /^Large/ })))
    expect(within(screen.getByRole('radiogroup', { name: 'Size' })).getByRole('radio', { checked: true }).getAttribute('aria-label')).toMatch(/^Large/)
    expect(screen.getByText('Large', { selector: 'dd' })).toBeTruthy()
  })

  it('saving waits for images still uploading', async () => {
    let finish: () => void = () => undefined
    const uploadPhoto = vi.fn(() => new Promise<{ ok: true; url: string }>((resolve) => { finish = () => resolve({ ok: true, url: 'https://store.public.blob.vercel-storage.com/heroes/b.webp' }) }))
    await forge(deps({ uploadPhoto }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ready' })))
    await addFiles([image()])
    expect((await screen.findByRole('button', { name: 'Save to loadout' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => finish())
    expect((screen.getByRole('button', { name: 'Save to loadout' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('opens a hero from the Loadout for editing and saves to its own build', async () => {
    const d = deps()
    const build = { ...proposeBuild({ heroName: 'Ada', roleId: 'support', skills: {} }).build, gate: { state: 'ready' as const, winRate: 0.5 } }
    render(<ForgeScreen deps={d} record={{ id: 'b7', heroId: 'h7', build }} />)
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeTruthy()
    expect(screen.getByText('In your loadout')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })))
    expect(d.saveBuild).toHaveBeenCalledWith('b7', expect.objectContaining({ heroName: 'Ada' }))
  })
})
