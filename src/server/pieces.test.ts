import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { PIECE_PRICE } from '../forge/pricing.js'
import { createRegistry } from '../forge/providers/registry.js'
import type { PieceProvider, PieceRequest } from '../forge/providers/types.js'
import { searchAssets, visibleAssets } from './assets.js'
import { balance, grantPurchase } from './credits.js'
import { SCHEMA_SQL, type Db } from './db.js'
import { gearProblem } from './gear.js'
import { generationReady, pieceName, pollPiece, startPiece, type PieceDeps } from './pieces.js'

let db: Db
let stored: Map<string, Uint8Array>
let deps: PieceDeps

beforeEach(async () => {
  const pg = new PGlite()
  await pg.exec(SCHEMA_SQL)
  db = pg as unknown as Db
  stored = new Map()
  deps = {
    db,
    registry: createRegistry({ FORGE_FAKE_PROVIDERS: '1' }, { fakes: { decline: /forbidden/ } }),
    store: async (path, bytes) => {
      stored.set(path, bytes)
      return `https://store.public.blob.vercel-storage.com/${path}`
    },
  }
  await db.query("insert into accounts (id, email, email_normalized) values ('a1', 'a@example.com', 'a@example.com')")
})

describe('generating a piece into the repository', () => {
  it('holds the price, then publishes the piece for everyone and charges the hold', async () => {
    await grantPurchase(db, 'a1', 100, 'test-grant')
    const job = await startPiece(deps, 'a1', { prompt: 'a wide jade glaive', kind: 'hand' })
    expect(job).toMatchObject({ status: 'running', name: 'Wide Jade Glaive', kind: 'hand' })
    expect(await balance(db, 'a1')).toBe(100 - PIECE_PRICE)
    const done = await pollPiece(deps, 'a1', job.id)
    expect(done.status).toBe('done')
    expect(done.piece).toMatchObject({ id: job.id, kind: 'hand', source: 'community', url: `https://store.public.blob.vercel-storage.com/pieces/${job.id}.glb` })
    expect(stored.has(`pieces/${job.id}.glb`)).toBe(true)
    expect(stored.has(`pieces/${job.id}.webp`)).toBe(true)
    // it's in the repository, free to find, and the hold became a charge
    expect((await searchAssets(db, 'glaive')).map((p) => p.id)).toEqual([job.id])
    expect(await balance(db, 'a1')).toBe(100 - PIECE_PRICE)
    const { rows } = await db.query<{ kind: string }>("select kind from credit_ledger where ref = $1 order by created_at", [`piece:${job.id}`])
    expect(rows.map((r) => r.kind)).toEqual(['hold', 'charge'])
    // polling again just reports it
    expect((await pollPiece(deps, 'a1', job.id)).piece?.id).toBe(job.id)
  })

  it('a declined piece costs nothing', async () => {
    await grantPurchase(db, 'a1', 100, 'test-grant')
    await expect(startPiece(deps, 'a1', { prompt: 'a forbidden relic', kind: 'hand' })).rejects.toMatchObject({ status: 422 })
    expect(await balance(db, 'a1')).toBe(100)
  })

  it('screens the words first and refuses a short balance before any provider call', async () => {
    await grantPurchase(db, 'a1', 100, 'test-grant')
    await expect(startPiece(deps, 'a1', { prompt: 'a naked statue for a shield', kind: 'offhand' })).rejects.toMatchObject({ status: 422 })
    await db.query("insert into accounts (id, email, email_normalized) values ('a2', 'b@example.com', 'b@example.com')")
    await expect(startPiece(deps, 'a2', { prompt: 'a jade dagger', kind: 'hand' })).rejects.toMatchObject({ status: 402 })
    await expect(startPiece(deps, 'a1', { prompt: 'a jade dagger', kind: 'tail' as never })).rejects.toMatchObject({ status: 400 })
  })

  it("can't be polled by another account", async () => {
    await grantPurchase(db, 'a1', 100, 'test-grant')
    const job = await startPiece(deps, 'a1', { prompt: 'a jade dagger', kind: 'hand' })
    await expect(pollPiece(deps, 'a2', job.id)).rejects.toMatchObject({ status: 404 })
  })

  it('is ready only with a store, a piece provider and a way to finish signing in', () => {
    const fake = createRegistry({ FORGE_FAKE_PROVIDERS: '1' })
    // the local dev server: the dev store, fakes and the dev sign-in link
    expect(generationReady({ FORGE_FAKE_PROVIDERS: '1' }, fake)).toBe(true)
    // production without a Tripo key, or a preview without email, can't
    const prod = { VERCEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abc_x' }
    expect(generationReady(prod, createRegistry(prod))).toBe(false)
    const preview = { VERCEL: '1', VERCEL_ENV: 'preview', NODE_ENV: 'production', FORGE_FAKE_PROVIDERS: '1', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abc_x' }
    expect(generationReady(preview, createRegistry(preview))).toBe(false)
    const live = { ...prod, TRIPO_API_KEY: 'k', RESEND_API_KEY: 'r', EMAIL_FROM: 'psyblr <hi@example.com>' }
    expect(generationReady(live, createRegistry(live))).toBe(true)
  })

  it('names a piece from its prompt', () => {
    expect(pieceName('A wide straw hat with a red band')).toBe('Wide Straw Hat')
    expect(pieceName('!!!')).toBe('Piece')
  })
})

describe('a generated piece in the repository', () => {
  it('can be held in a hand its kind fits, and only there', async () => {
    await grantPurchase(db, 'a1', 100, 'test-grant')
    const job = await startPiece(deps, 'a1', { prompt: 'a bronze buckler', kind: 'offhand' })
    const done = await pollPiece(deps, 'a1', job.id)
    const url = done.piece!.url
    const community = await visibleAssets(db, [job.id])
    const hero = { gender: 'm' as const, colors: {} }
    expect(gearProblem({ ...hero, gear: { hand_l: { id: job.id, url } } }, community)).toBeUndefined()
    expect(gearProblem({ ...hero, gear: { hand_r: { id: job.id, url } } }, community)).toMatch(/can't go in hand_r/)
  })

  it('asks the provider for a piece at the usual limit', async () => {
    await grantPurchase(db, 'a1', 100, 'test-grant')
    const asked: (number | undefined)[] = []
    const providers = deps.registry.providers.map((p) =>
      p.capability === 'piece' ? { ...p, start: (r: PieceRequest) => (asked.push(r.faceLimit), (p as PieceProvider).start(r)) } : p,
    )
    const spy = { ...deps, registry: { ...deps.registry, providers } }
    await startPiece(spy, 'a1', { prompt: 'a jade dagger', kind: 'hand' })
    expect(asked).toEqual([20000])
  })

  it('never lists a garment left from before heroes were drawn bare', async () => {
    await db.query("insert into assets (id, kind, name, name_lower, url, meta) values ('robe', 'full', 'Robe', 'robe', 'https://x/wear/robe.glb', $1)", [JSON.stringify({ channels: [], knobs: [] })])
    expect(await searchAssets(db, '')).toEqual([])
    expect((await visibleAssets(db, ['robe'])).size).toBe(0)
  })

  it("widens an older database's asset kinds in place, and runs again harmlessly", async () => {
    const pg = new PGlite()
    await pg.exec(SCHEMA_SQL)
    // the table as it was before garments
    await pg.exec("alter table assets drop constraint assets_kind_check; alter table assets add constraint assets_kind_check check (kind in ('head', 'face', 'hand', 'offhand', 'back'))")
    const older = pg as unknown as Db
    await older.query("insert into assets (id, kind, name, name_lower, url) values ('hat', 'head', 'Hat', 'hat', 'https://x/pieces/hat.glb')")
    await expect(older.query("insert into assets (id, kind, name, name_lower, url) values ('robe', 'full', 'Robe', 'robe', 'https://x/wear/robe.glb')")).rejects.toThrow()
    await pg.exec(SCHEMA_SQL)
    await pg.exec(SCHEMA_SQL)
    await older.query("insert into assets (id, kind, name, name_lower, url, meta) values ('robe', 'full', 'Robe', 'robe', 'https://x/wear/robe.glb', $1)", [JSON.stringify({ channels: [], knobs: [] })])
    const { rows } = await older.query<{ id: string }>('select id from assets order by id')
    expect(rows.map((r) => r.id)).toEqual(['hat', 'robe'])
    await expect(older.query("insert into assets (id, kind, name, name_lower, url) values ('tail', 'tail', 'Tail', 'tail', 'https://x/wear/tail.glb')")).rejects.toThrow()
  })

  it('ships with the functions every file a job reads from disk', () => {
    const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
    const include = config.functions['api/**/*.ts'].includeFiles as string
    const files = (/^\{(.*)\}$/.exec(include)?.[1] ?? include).split(',')
    expect(files).toEqual(expect.arrayContaining(['db/schema.sql']))
    for (const file of files) expect(existsSync(new URL(`../../${file}`, import.meta.url)), file).toBe(true)
  })
})
