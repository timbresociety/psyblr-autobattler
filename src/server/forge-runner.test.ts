import type { EffectRecipe } from '../arena/recipes/schema.js'
import { validateRecipe } from '../arena/recipes/validate.js'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { proposeBuild } from '../charter/build.js'
import { CATALOG } from '../charter/templates/catalog.js'
import { fakeDirectorBrain } from '../forge/director/fake.js'
import { STAGE_PRICES } from '../forge/pricing.js'
import { allFakes, fakeImage, fakeMesh } from '../forge/providers/fakes/index.js'
import type { Registry } from '../forge/providers/router.js'
import type { AnyProvider, ImageRequest, MeshProvider } from '../forge/providers/types.js'
import { STAGE_ORDER, begin, createForge } from '../forge/stages.js'
import { ARENA_BUDGET } from '../forge/arena-asset.js'
import { defaultBuild } from '../sim/fixtures.js'
import type { Forge, StageId } from '../forge/types.js'
import { balance, claimFreeGrant } from './credits.js'
import { SCHEMA_SQL, type Db } from './db.js'
import { forgeLimited, FORGE_LIMITS } from './forge-env.js'
import { loadHeroPackage, publishForge } from './forge-publish.js'
import { effectShape } from '../forge/package.js'
import { TASK_TIMEOUT_MS, act, advance, planSteps, startForge, type RunnerDeps } from './forge-runner.js'
import { loadForge, saveForge } from './forge-store.js'
import { createHero, searchHeroes } from './store.js'

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
  // the arena packer passes GLBs through: the fake copies have no file behind them
  return { db, registry: reg, copy: async (pathname) => (copies.push(pathname), `https://blob.test/${pathname}`), packArena: async (url) => ({ focus: url, other: url }), publish: publishForge, gateOptions: { duelsPerMember: 2 } }
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
  for (const stage of STAGE_ORDER.slice(1)) {
    // the form stage is optional: a hero whose ultimate transforms is offered it, and these flows skip it
    if (stage === 'form') {
      if (f.current === 'form') f = await act(d, f, { type: 'skip', stage: 'form' })
      continue
    }
    f = await runStage(d, f, stage)
  }
  return f
}

/** Run every stage between the spec and the stat split, skipping the optional form stage when it is offered. */
async function throughForm(d: RunnerDeps, forge: Forge): Promise<Forge> {
  let f = forge
  for (const stage of STAGE_ORDER.slice(1, -1)) {
    if (stage === 'form') {
      if (f.current === 'form') f = await act(d, f, { type: 'skip', stage: 'form' })
      continue
    }
    f = await runStage(d, f, stage)
  }
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
    const total = Object.entries(STAGE_PRICES).reduce((s, [stage, p]) => s + (stage === 'form' ? 0 : (p ?? 0)), 0)
    expect(rows).toHaveLength(6)
    expect(new Set(rows.map((r) => r.ref.split(':')[1]))).toEqual(new Set(['concept', 'mesh', 'motion', 'active1', 'active2', 'ultimate']))
    expect(await balance(db, a)).toBe(before - total)
    // every effect stage stored a valid recipe, and the ultimate stage also stored the passive's (R33)
    for (const stage of ['active1', 'active2', 'ultimate'] as const) {
      const effect = done.stages[stage].inputs.effect as { recipe: EffectRecipe }
      expect(validateRecipe(effect.recipe), stage).toEqual([])
    }
    expect(validateRecipe((done.stages.ultimate.inputs.passive as { recipe: EffectRecipe }).recipe)).toEqual([])
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

  it('a generated image that cannot be screened is not kept, and the hold is released (KTD10)', async () => {
    const reg = registry()
    reg.providers = reg.providers.filter((p) => p.capability !== 'moderation')
    const d = deps(reg)
    const a = await account()
    let f = await act(deps(), await specReady(deps(), a), { type: 'confirm', stage: 'spec' })
    const before = await balance(db, a)
    f = await act(d, f, { type: 'start', stage: 'concept' })
    expect(f.stages.concept.status).toBe('failed')
    expect(f.stages.concept.failure).toMatch(/could not be screened/)
    expect(copies.filter((c) => c.includes('/concept/'))).toHaveLength(0)
    expect(await balance(db, a)).toBe(before)
  })

  it('a provider task that never finishes fails the stage after the deadline and releases the hold', async () => {
    let clock = Date.now()
    const reg = registry()
    reg.providers = reg.providers.map((p) => (p.capability === 'mesh' ? { ...p, poll: async () => ({ ok: 'pending' as const, taskId: 'stuck' }) } : p)) as AnyProvider[]
    const d = { ...deps(reg), now: () => clock }
    const a = await account()
    let f = await act(d, await specReady(d, a), { type: 'confirm', stage: 'spec' })
    f = await runStage(d, f, 'concept')
    const before = await balance(db, a)
    f = await settle(d, await act(d, f, { type: 'start', stage: 'mesh' }))
    expect(f.stages.mesh.status).toBe('generating')
    clock += TASK_TIMEOUT_MS + 1
    f = await advance(d, f)
    expect(f.stages.mesh.status).toBe('failed')
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

  it('the motion stage yields the archival rig and both arena versions of the hero (R35)', async () => {
    const d = deps()
    let f = await act(d, await specReady(d, await account()), { type: 'confirm', stage: 'spec' })
    for (const stage of ['concept', 'mesh'] as const) f = await runStage(d, f, stage)
    f = await settle(d, await act(d, f, { type: 'start', stage: 'motion' }))
    expect(f.stages.motion.status).toBe('ready')
    const a = f.stages.motion.artifacts
    expect(a.rig).toBeTruthy()
    expect(a['arena-focus']).toBeTruthy()
    expect(a['arena-other']).toBeTruthy()
    expect(Object.keys(a).some((k) => k.startsWith('arena-retarget-'))).toBe(true)
  })

  it('a provider failure on the arena mesh fails the motion stage and charges nothing', async () => {
    const reg = registry()
    reg.providers = reg.providers.map((p) =>
      p.capability === 'mesh' ? { ...p, start: (req: Parameters<MeshProvider['start']>[0]) => (req.faceLimit === ARENA_BUDGET.maxTriangles ? Promise.resolve({ ok: false as const, kind: 'failed' as const, reason: 'no low-poly today' }) : (p as MeshProvider).start(req)) } : p,
    ) as AnyProvider[]
    const d = deps(reg)
    const a = await account()
    let f = await act(d, await specReady(d, a), { type: 'confirm', stage: 'spec' })
    for (const stage of ['concept', 'mesh'] as const) f = await runStage(d, f, stage)
    const before = await balance(db, a)
    f = await settle(d, await act(d, f, { type: 'start', stage: 'motion' }))
    expect(f.stages.motion.status).toBe('failed')
    expect(f.stages.motion.failure).toMatch(/no low-poly today/)
    expect(await balance(db, a)).toBe(before)
  })

  it('the form stage draws a concept, then builds its mesh (R34)', () => {
    const forge = { ...createForge('f', 'a'), build: defaultBuild('tank') } as Forge
    expect(planSteps(forge, 'form').map((s) => s.name)).toEqual(['form-concept', 'form-mesh'])
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
  it('a published hero appears in global search, records device and account, and loads package version 2', async () => {
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
    expect((await loadHeroPackage(db, done.publishedHeroId!)).packageVersion).toBe(2)
  })

  it('when the publish commit loses a race, the hero rows it wrote are removed', async () => {
    const d = deps()
    let f = await act(d, await specReady(d, await account()), { type: 'confirm', stage: 'spec' })
    f = await throughForm(d, f)
    f = await settle(d, await act(d, f, { type: 'start', stage: 'stats' }))
    await db.query('update forges set version = version + 1 where id = $1', [f.id])
    await expect(publishForge(d, f)).rejects.toMatchObject({ status: 409 })
    const { rows } = await db.query('select 1 from heroes where creator_account = $1', [f.accountId])
    expect(rows).toHaveLength(0)
  })

  it('a blocked gate result does not publish', async () => {
    const d = { ...deps(), gateOptions: { duelsPerMember: 2, candidateScale: 3 } }
    let f = await act(d, await specReady(d, await account()), { type: 'confirm', stage: 'spec' })
    f = await throughForm(d, f)
    f = await settle(d, await act(d, f, { type: 'start', stage: 'stats' }))
    const after = await act(d, f, { type: 'confirm', stage: 'stats' })
    expect(after.current).toBe('stats')
    expect(after.publishedHeroId).toBeUndefined()
    expect(after.stages.stats.failure).toMatch(/balance gate blocked/)
  })
})

describe('forges stored before the arena (review #1, #5)', () => {
  it('a forge saved before the form stage and the arena hero loads, finishes and publishes with its rigged model', async () => {
    const d = deps()
    const a = await account()
    let f = await act(d, await specReady(d, a), { type: 'confirm', stage: 'spec' })
    for (const stage of ['concept', 'mesh', 'motion'] as const) f = await runStage(d, f, stage)
    // what an older build stored: no form stage, and a motion stage with only the archival rig and motions
    const motion = f.stages.motion
    const legacyArtifacts = Object.fromEntries(Object.entries(motion.artifacts).filter(([k]) => !k.startsWith('arena-')))
    const { form: _form, ...stages } = f.stages
    const legacy = { ...f, stages: { ...stages, motion: { ...motion, artifacts: legacyArtifacts } } } as unknown as Forge
    await saveForge(db, f.version, legacy)
    const loaded = await loadForge(db, f.id, a)
    expect(loaded.stages.form.status).toBe('draft')
    f = loaded
    for (const stage of STAGE_ORDER.slice(STAGE_ORDER.indexOf('active1'))) {
      if (stage === 'form') {
        if (f.current === 'form') f = await act(d, f, { type: 'skip', stage: 'form' })
        continue
      }
      f = await runStage(d, f, stage)
    }
    // publishing validates the package, which needs an arena hero: the rigged model stands in, as for a v1 package
    expect(f.current).toBe('published')
    expect(f.publishedHeroId).toBeTruthy()
  })
})

describe('arena hero and form stage (U11)', () => {
  it('an arena pack over the triangle budget fails the motion stage and charges nothing', async () => {
    const d = { ...deps(), packArena: async () => Promise.reject(new Error(`arena mesh has 12000 triangles, over the ${ARENA_BUDGET.maxTriangles} budget`)) }
    const a = await account()
    let f = await act(d, await specReady(d, a), { type: 'confirm', stage: 'spec' })
    for (const stage of ['concept', 'mesh'] as const) f = await runStage(d, f, stage)
    const before = await balance(db, a)
    f = await settle(d, await act(d, f, { type: 'start', stage: 'motion' }))
    expect(f.stages.motion.status).toBe('failed')
    expect(f.stages.motion.failure).toMatch(/triangles/)
    expect(await balance(db, a)).toBe(before)
  })

  it('a hero whose ultimate transforms is offered the form stage, pays for it once, and publishes', async () => {
    const d = deps()
    const a = await account()
    let f = await act(d, await specReady(d, a), { type: 'confirm', stage: 'spec' })
    // the default tank's ultimate is Titan Form, which turns it colossal
    const tank = defaultBuild('tank', f.build!.heroName)
    expect(await saveForge(db, f.version, { ...f, build: tank })).toBeTruthy()
    f = await loadForge(db, f.id, a)
    for (const stage of ['concept', 'mesh', 'motion', 'active1', 'active2', 'ultimate'] as const) f = await runStage(d, f, stage)
    expect(f.current).toBe('form')
    const before = await balance(db, a)
    f = await runStage(d, f, 'form')
    expect(before - (await balance(db, a))).toBe(STAGE_PRICES.form)
    expect(f.stages.form.artifacts['form-mesh']).toBeTruthy()
    f = await runStage(d, f, 'stats')
    expect(f.current).toBe('published')
    const { rows } = await db.query<{ ref: string }>("select ref from credit_ledger where kind = 'charge' and account_id = $1 and ref like $2", [a, `${f.id}:form:%`])
    expect(rows).toHaveLength(1)
  })
})
