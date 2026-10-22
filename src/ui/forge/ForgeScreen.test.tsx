// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SIZES, type SizeClass } from '../../charter/sizes'
import { buildSpec } from '../../forge/director/director'
import { fakeDirectorBrain } from '../../forge/director/fake'
import { stagePrice } from '../../forge/pricing'
import { begin, choose, confirm, createForge, editInputs, retry, succeed, skip } from '../../forge/stages'
import type { Forge, StageId, Transition } from '../../forge/types'
import type { ForgeAction, ForgeDeps } from './forge-api'
import { EXAMPLE_PROMPT, ForgeScreen } from './ForgeScreen'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const img = (label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`)}`
const ok = (t: Transition) => {
  if (!t.ok) throw new Error(t.reason)
  return t.forge
}
const ARTIFACTS: Partial<Record<StageId, Record<string, string>>> = {
  concept: { 'sheet-0': img('a'), 'sheet-1': img('b') },
  mesh: { mesh: 'fake://mesh/x.fbx' },
  motion: { rig: 'fake://rig/x.glb', 'retarget-0': 'fake://motion/x.glb' },
  active1: { 'effect-0': img('e1') },
  active2: { 'effect-0': img('e2') },
  ultimate: { 'effect-0': img('u'), 'passive-0': img('p') },
  stats: {},
}

/** An in-memory forge server built on the real state machine and offline director. */
function memoryDeps(options: { signedIn?: boolean; balance?: number } = {}) {
  let signedIn = options.signedIn ?? true
  let balance = options.balance ?? 1000
  let forge: Forge | undefined
  const view = () => ({ forge: structuredClone(forge!), balance })
  function apply(f: Forge, action: ForgeAction): Forge {
    switch (action.type) {
      case 'chat': {
        const chat = [...f.chat, { from: 'player' as const, text: action.text }]
        const output = fakeDirectorBrain({ prompt: f.prompt || action.text, referenceCaptions: [], chat, answers: action.answers })
        let next = ok(editInputs({ ...f, chat }, 'spec', { director: output }))
        if (output.spec) {
          const { spec, build } = buildSpec(output.spec)
          next = ok(succeed(ok(begin({ ...next, spec: { ...spec, tone: output.tone }, build }, 'spec')), 'spec', {}))
        }
        return { ...next, chat: [...next.chat, { from: 'director', text: output.spec ? 'Here is the spec.' : output.questions[0]?.text ?? '?' }] }
      }
      case 'edit': {
        if (action.stage === 'spec') return { ...f, spec: { ...f.spec!, ...(action.inputs as object) } }
        return ok(succeed(ok(begin(ok(editInputs(f, action.stage, {})), action.stage)), action.stage, {}))
      }
      case 'choose':
        return ok(choose(f, action.stage, action.choice))
      case 'start':
      case 'retry': {
        const price = stagePrice(action.stage)
        if (balance < price) throw Object.assign(new Error('not enough credits for this step'), { status: 402 })
        balance -= price
        const started = ok(action.type === 'start' ? begin(f, action.stage) : retry(f, action.stage))
        return ok(succeed(started, action.stage, ARTIFACTS[action.stage] ?? {}))
      }
      case 'confirm': {
        const next = ok(confirm(f, action.stage))
        return action.stage === 'stats' ? { ...next, publishedHeroId: 'hero-new' } : next
      }
      case 'skip':
        return ok(skip(f, action.stage))
    }
  }
  const deps: ForgeDeps = {
    session: vi.fn(async () => ({ signedIn })),
    startSignIn: vi.fn(async () => undefined),
    verifySignIn: vi.fn(async () => {
      signedIn = true
    }),
    signOut: vi.fn(async () => undefined),
    credits: vi.fn(async () => ({ balance, freeGrant: 680, freeClaimed: true, packs: [{ id: 'small', credits: 300, amountCents: 399, currency: 'usd' }] })),
    claimFree: vi.fn(async () => balance),
    purchase: vi.fn(async () => ({ url: '#bought' })),
    create: vi.fn(async ({ prompt }) => ((forge = createForge('forge-1', 'acct', prompt ?? '')), view())),
    get: vi.fn(async () => view()),
    list: vi.fn(async () => []),
    act: vi.fn(async (_id: string, action: ForgeAction) => ((forge = apply(forge!, action)), view())),
    search: vi.fn(async () => [{ id: 'hero-goku', name: 'Goku', roleId: 'fighter', photo: null, useCount: 3 }]),
    addHero: vi.fn(async () => ({ id: 'b', heroId: 'hero-goku', build: forge!.build! })),
    sizeCost: vi.fn(async (_b: unknown, size: SizeClass) => ({ sizeClass: size, healthDelta: size === 'huge' ? 9 : 0, speedDelta: size === 'huge' ? -0.9 : 0, hitRadius: SIZES[size].hitRadius, winRate: 0.51, retuneSteps: 0, state: 'ready' as const })),
  }
  return { deps, current: () => forge }
}

const click = async (name: string | RegExp) => act(async () => fireEvent.click(await screen.findByRole('button', { name })))

/** "Forge new" waits for the session check. */
async function forgeNew() {
  const button = (await screen.findByRole('button', { name: 'Forge new' })) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  await act(async () => fireEvent.click(button))
}

async function openSpec(d: ForgeDeps) {
  render(<ForgeScreen deps={d} />)
  await forgeNew()
  await click('Start forging')
  await screen.findByRole('button', { name: 'Confirm spec' })
}

describe('Forge screen (U11)', () => {
  it('opens on loadout search, and "Forge new" asks for sign-in when signed out', async () => {
    const { deps } = memoryDeps({ signedIn: false })
    render(<ForgeScreen deps={deps} />)
    expect(screen.getByLabelText('Search the global loadout')).toBeTruthy()
    await forgeNew()
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeTruthy()
  })

  it('prefills a suggested example prompt', async () => {
    const { deps } = memoryDeps()
    render(<ForgeScreen deps={deps} />)
    await forgeNew()
    expect((screen.getByLabelText('Describe your hero') as HTMLTextAreaElement).value).toBe(EXAMPLE_PROMPT)
  })

  it('the spec lets the player drop and add suggestions before confirming (AE1)', async () => {
    const { deps, current } = memoryDeps()
    await openSpec(deps)
    const before = current()!.spec!.signatureElements
    const suggestion = within(screen.getByRole('list', { name: 'Director suggestions' })).getAllByRole('button', { name: 'Add' })[0]
    await act(async () => fireEvent.click(suggestion))
    expect(current()!.spec!.signatureElements.length).toBe(before.length + 1)
    const added = current()!.spec!.signatureElements.at(-1)!
    await click(`Drop ${added}`)
    expect(current()!.spec!.signatureElements).toEqual(before)
  })

  it('choosing a size shows its hitbox and stat cost (AE3)', async () => {
    const { deps } = memoryDeps()
    await openSpec(deps)
    await act(async () => fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Size class' })).getByRole('radio', { name: 'huge' })))
    expect(await screen.findByText(/Hitbox \+1\.8 m · health \+9 · speed -0\.9 · 51% vs field/)).toBeTruthy()
  })

  it('the passive offers an aura or a body element (AE4)', async () => {
    const { deps, current } = memoryDeps()
    await openSpec(deps)
    const group = screen.getByRole('radiogroup', { name: 'Passive visual' })
    expect(within(group).getByRole('radio', { name: 'Aura' })).toBeTruthy()
    await act(async () => fireEvent.click(within(group).getByRole('radio', { name: 'Body element' })))
    expect(current()!.spec!.passiveVisual).toBe('body-element')
    expect(screen.getByLabelText('Which element')).toBeTruthy()
  })

  it('without enough credits, the stage offers a purchase (AE2)', async () => {
    const { deps } = memoryDeps({ balance: 5 })
    const concept = stagePrice('concept')
    await openSpec(deps)
    await click('Confirm spec')
    expect((await screen.findByRole('button', { name: new RegExp(`Generate · ${concept} credits`) }) as HTMLButtonElement).disabled).toBe(true)
    await click(/Buy 300 credits/)
    expect(deps.purchase).toHaveBeenCalledWith('small')
  })

  it('reloading mid-forge reopens at the current stage', async () => {
    const { deps } = memoryDeps()
    await openSpec(deps)
    await click('Confirm spec')
    cleanup()
    render(<ForgeScreen deps={deps} />)
    expect(await screen.findByRole('heading', { name: '2D concept sheet' })).toBeTruthy()
  })

  it('a full fake forge completes from prompt to published', async () => {
    const { deps, current } = memoryDeps()
    await openSpec(deps)
    await click('Confirm spec')
    for (const title of ['2D concept sheet', '3D quad mesh', 'Movement and basic attack', 'Active 1', 'Active 2', 'Passive and ultimate']) {
      await screen.findByRole('heading', { name: title })
      await click(/Generate/)
      await click('Confirm')
    }
    // a hero whose ultimate transforms is offered a form, which this flow skips
    if (current()!.current === 'form') await click('Skip, no form')
    await screen.findByRole('heading', { name: 'Stat split' })
    await click('Save split')
    await click('Publish hero')
    expect(await screen.findByText(/is published to the global loadout/)).toBeTruthy()
    expect(current()!.current).toBe('published')
  })
})
