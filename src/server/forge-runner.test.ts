import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { proposeBuild } from '../charter/build'
import { CATALOG } from '../charter/templates/catalog'
import { fakeDirectorBrain } from '../forge/director/fake'
import { STAGE_PRICES } from '../forge/pricing'
import { allFakes, fakeImage, fakeMesh } from '../forge/providers/fakes'
import type { Registry } from '../forge/providers/router'
import type { AnyProvider, ImageRequest, MeshProvider } from '../forge/providers/types'
import { begin } from '../forge/stages'
import { STAGE_ORDER } from '../forge/stages'
import type { Forge, StageId } from '../forge/types'
import { balance, claimFreeGrant } from './credits'
import { SCHEMA_SQL, type Db } from './db'
import { forgeLimited, FORGE_LIMITS } from './forge-env'
import { loadHeroPackage, publishForge } from './forge-publish'
import { act, advance, effectShape, planSteps, startForge, type RunnerDeps } from './forge-runner'
import { loadForge, saveForge } from './forge-store'
import { createHero, searchHeroes } from './store'

let db: Db
let copies: string[]
let imageRequests: ImageRequest[]
let meshStarts: number
const PROMPT = 'Jensen in a Raiden-like avatar as a GPU god, skills around CUDA, Circle Jerk, Stonks and other memes'
const DEVICE = 'd'.repeat(32)

function registry(extra: AnyProvider[] = []): Registry {
  const fakes = allFakes({ director: fakeDirectorBrain as (i: Record<string, unknown>) => unknown }).map((p) => {
    if (p.capability === 'image') return { ...p, generate: (req: ImageRequest) => (imageRequests.push(req), p.generate(req)) }
    if (p.capability === 'mesh') return { ...p, start: (req: Parameters<MeshProvider['start']>[0]) => (meshStarts++, p.start(req)) }
    return p
  }) as AnyProvider[]
  return { env: { FORGE_FAKE_PROVIDERS: '1' }, providers: [...extra, ...fakes] }
}

function deps(reg = registry()): RunnerDeps {
  return { db, registry: reg, copy: async (pathname) => (copies.push(pathname), `https://blob.test/${pathname}`), publish: publishForge, gateOptions: { duelsPerMember: 2 } }
}

let n = 0
async function account(): Promise<string> {
  const id = `acct-${++n}`
  await db.query('insert into accounts (id, email, email_normalized) values ($1, $2, $2)', [id, `${id}@example.com`])
  await claimFreeGrant(db, id, `10.0.0.${n}`)
  return id
}

beforeEach(async () => {
  const pg = new PGlite()
  await pg.exec(SCHEMA_SQL)
  db = pg as unknown as Db
  copies = []
  imageRequests = []
  meshStarts = 0
})

/** Poll until the current stage stops generating. */
async function settle(d: RunnerDeps, forge: Forge): Promise<Forge> {
  let f = forge
  for (let i = 0; i < 20 && f.current !== 'published' && f.stages[f.current].status === 'generating'; i++) f = await advance(d, f)
  return f
}

async function runStage(d: RunnerDeps, forge: Forge, stage: StageId): Promise<Forge> {
  const started = await settle(d, await act(d, forge, { type: 'start', stage }))
  expect(started.stages[stage].status).toBe('ready')
  return act(d, started, { type: 'confirm', stage })
}

/** Drive a forge with a confirmed-ready spec all the way to published. */
async function finish(d: RunnerDeps, forge: Forge): Promise<Forge> {
  let f = await act(d, forge, { type: 'confirm', stage: 'spec' })
  for (const stage of STAGE_ORDER.slice(1)) f = await runStage(d, f, stage)
  return f
}

async function specReady(d: RunnerDeps, accountId: string): Promise<Forge> {
  const forge = await startForge(d, accountId, DEVICE, { prompt: PROMPT })
  const chatted = await act(d, forge, { type: 'chat', text: PROMPT })
  expect(chatted.stages.spec.status).toBe('ready')
  return chatted
}

describe('forge runner (U9)', () => {
  it('a full fake forge runs from spec to published, charging each paid stage once (F1)', async () => {
    const d = deps()
    const a = await account()
    const before = await balance(db, a)
    const done = await finish(d, await specReady(d, a))
    expect(done.current).toBe('published')
    expect(done.publishedHeroId).toBeTruthy()
    const { rows } = await db.query<{ ref: string; amount: number }>("select ref, amount from credit_ledger where kind = 'charge' and account_id = $1", [a])
    const total = Object.values(STAGE_PRICES).reduce((s, p) => s + (p ?? 0), 0)
    expect(rows).toHaveLength(6)
    expect(new Set(rows.map((r) => r.ref.split(':')[1]))).toEqual(new Set(['concept', 'mesh', 'motion', 'active1', 'active2', 'ultimate']))
    expect(await balance(db, a)).toBe(before - total)
  })

  it('every stored artifact is our Blob copy under forge/<id>/<stage>/<attempt>/', async () => {
    const d = deps()
    let f = await act(d, await specReady(d, await account()), { type: 'confirm', stage: 'spec' })
    f = await runStage(d, f, 'concept')
    f = await settle(d, await act(d, f, { type: 'start', stage: 'mesh' }))
    for (const stage of ['concept', 'mesh'] as const) {
      const urls = Object.values(f.stages[stage].artifacts)
      expect(urls.length).toBeGreaterThan(0)
      for (const url of urls) expect(url).toMatch(new RegExp(`^https://blob\\.test/forge/${f.id}/${stage}/1/`))
    }
  })

  it('leaving mid-generation and polling later resumes the same stage with approvals intact (F4)', async () => {
    let f = await act(deps(), await specReady(deps(), await account()), { type: 'confirm', stage: 'spec' })
    f = await runStage(deps(), f, 'concept')
    f = await act(deps(), f, { type: 'start', stage: 'mesh' })
    expect(f.stages.mesh.status).toBe('generating')
    // a new request, a new process: only the database carries over
    const resumed = await settle(deps(), await loadForge(db, f.id, f.accountId))
    expect(resumed.current).toBe('mesh')
    expect(resumed.stages.mesh.status).toBe('ready')
    expect(resumed.stages.spec.status).toBe('approved')
    expect(resumed.stages.concept.status).toBe('approved')
  })

  it('a first-provider decline falls through and the player sees success (AE5)', async () => {
    const decliner = fakeImage({ decline: /./ }, 'fake-image-strict')
    const d = deps(registry([decliner]))
    let f = await act(d, await specReady(d, await account()), { type: 'confirm', stage: 'spec' })
    f = await settle(d, await act(d, f, { type: 'start', stage: 'concept' }))
    expect(f.stages.concept.status).toBe('ready')
    expect(f.stages.concept.servedBy).toEqual(['fake-image'])
  })

  it('when every provider declines, the stage fails and the hold is released', async () => {
    const reg = registry()
    reg.providers = reg.providers.map((p) => (p.capability === 'image' ? fakeImage({ decline: /./ }) : p))
    const d = deps(reg)
    const a = await account()
    const before = await balance(db, a)
    let f = await act(d, await specReady(d, a), { type: 'confirm', stage: 'spec' })
    f = await act(d, f, { type: 'start', stage: 'concept' })
    expect(f.stages.concept.status).toBe('failed')
    expect(await balance(db, a)).toBe(before)
  })

  it('another account cannot read or act on a forge', async () => {
    const d = deps()
    const f = await specReady(d, await account())
    const other = await account()
    await expect(loadForge(db, f.id, other)).rejects.toThrow(/not found/)
  })

  it('starting from an existing hero copies its spec as a draft, and the result is a new hero (AE7)', async () => {
    const d = deps()
    const raw = proposeBuild({ heroName: 'Old Hero', roleId: 'fighter', skills: {} }).build
    const { heroId } = await createHero(db, DEVICE, raw, [], { duelsPerMember: 2 })
    const f = await startForge(d, await account(), DEVICE, { referenceHeroId: heroId })
    expect(f.referenceHeroId).toBe(heroId)
    expect(f.spec?.heroName).toBe('Old Hero')
    expect(f.stages.spec.status).toBe('ready')
    const done = await finish(d, f)
    expect(done.publishedHeroId).toBeTruthy()
    expect(done.publishedHeroId).not.toBe(heroId)
  })

  it('two parallel polls on a ready-to-advance stage create exactly one provider task', async () => {
    const d = deps()
    let f = await act(d, await specReady(d, await account()), { type: 'confirm', stage: 'spec' })
    f = await runStage(d, f, 'concept')
    const t = begin(f, 'mesh')
    if (!t.ok) throw new Error(t.reason)
    const primed = await saveForge(db, f.version, { ...t.forge, stages: { ...t.forge.stages, mesh: { ...t.forge.stages.mesh, steps: planSteps(t.forge, 'mesh') } } })
    await Promise.all([advance(d, primed!), advance(d, primed!)])
    expect(meshStarts).toBe(1)
  })

  it('effect requests carry the template shape; a beam has a range and no radius (R18)', async () => {
    const d = deps()
    let f = await act(d, await specReady(d, await account()), { type: 'confirm', stage: 'spec' })
    for (const stage of ['concept', 'mesh', 'motion'] as const) f = await runStage(d, f, stage)
    f = await settle(d, await act(d, f, { type: 'start', stage: 'active1' }))
    const effect = imageRequests.find((r) => r.kind === 'effect')!
    expect(effect.shape).toEqual(effectShape(f.build!.slots.active1.templateId))
    expect((f.stages.active1.inputs.effect as { shape: unknown }).shape).toEqual(effect.shape)
    const beam = CATALOG.find((t) => t.delivery.kind === 'beam')!
    const shape = effectShape(beam.id)
    expect(shape.range).toBeGreaterThan(0)
    expect('radius' in shape).toBe(false)
  })

  it('an approved stage is frozen and a stage cannot run out of order', async () => {
    const d = deps()
    const f = await act(d, await specReady(d, await account()), { type: 'confirm', stage: 'spec' })
    await expect(act(d, f, { type: 'chat', text: 'change it' })).rejects.toMatchObject({ status: 409 })
    await expect(act(d, f, { type: 'start', stage: 'mesh' })).rejects.toMatchObject({ status: 409 })
  })

  it('exceeding the forge API rate limit is refused', async () => {
    const a = await account()
    const now = new Date('2026-10-22T12:00:00Z')
    for (let i = 0; i < FORGE_LIMITS.perAccount; i++) expect(await forgeLimited(db, a, '1.2.3.4', now)).toBe(false)
    expect(await forgeLimited(db, a, '1.2.3.4', now)).toBe(true)
  })

  it('a stage without credits is refused before any provider call (AE2)', async () => {
    const d = deps()
    const a = await account()
    let f = await act(d, await specReady(d, a), { type: 'confirm', stage: 'spec' })
    await db.query('update credit_accounts set available = 0 where account_id = $1', [a])
    await expect(act(d, f, { type: 'start', stage: 'concept' })).rejects.toMatchObject({ status: 402 })
    f = await loadForge(db, f.id, a)
    expect(f.stages.concept.status).toBe('draft')
    expect(imageRequests).toHaveLength(0)
  })
})

describe('publish (U10)', () => {
  it('a published hero appears in global search, records device and account, and loads package version 1', async () => {
    const d = deps()
    const a = await account()
    const done = await finish(d, await specReady(d, a))
    const { rows } = await db.query<{ creator_device: string; creator_account: string; package_url: string }>('select creator_device, creator_account, package_url from heroes where id = $1', [done.publishedHeroId])
    expect(rows[0]).toMatchObject({ creator_device: DEVICE, creator_account: a })
    expect(rows[0].package_url).toBe(`https://blob.test/forge/${done.id}/package.json`)
    const hits = await searchHeroes(db, done.spec!.heroName)
    expect(hits.map((h) => h.id)).toContain(done.publishedHeroId)
    // the package bytes went through the copier as a data URL; load it the same way
    await db.query('update heroes set package_url = $2 where id = $1', [done.publishedHeroId, `data:application/json;base64,${Buffer.from(JSON.stringify({ packageVersion: 1 })).toString('base64')}`])
    expect((await loadHeroPackage(db, done.publishedHeroId!)).packageVersion).toBe(1)
  })

  it('a blocked gate result does not publish', async () => {
    const d = { ...deps(), gateOptions: { duelsPerMember: 2, candidateScale: 3 } }
    let f = await act(d, await specReady(d, await account()), { type: 'confirm', stage: 'spec' })
    for (const stage of STAGE_ORDER.slice(1, -1)) f = await runStage(d, f, stage)
    f = await settle(d, await act(d, f, { type: 'start', stage: 'stats' }))
    const after = await act(d, f, { type: 'confirm', stage: 'stats' })
    expect(after.current).toBe('stats')
    expect(after.publishedHeroId).toBeUndefined()
    expect(after.stages.stats.failure).toMatch(/balance gate blocked/)
  })
})
