import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { PIECE_PRICE } from '../forge/pricing.js'
import { GARMENT_FROM, placeholderPiece } from '../forge/providers/fakes/piece-model.js'
import { createRegistry } from '../forge/providers/registry.js'
import { REFERENCE_BODY } from '../kit/fit/reference.js'
import { searchAssets, searchItems, visibleAssets } from './assets.js'
import { balance, grantPurchase } from './credits.js'
import { SCHEMA_SQL, type Db } from './db.js'
import { gearProblem, wearProblem } from './gear.js'
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
    const job = await startPiece(deps, 'a1', { prompt: 'a wide straw hat', kind: 'head' })
    expect(job).toMatchObject({ status: 'running', name: 'Wide Straw Hat', kind: 'head' })
    expect(await balance(db, 'a1')).toBe(100 - PIECE_PRICE)
    const done = await pollPiece(deps, 'a1', job.id)
    expect(done.status).toBe('done')
    expect(done.piece).toMatchObject({ id: job.id, kind: 'head', source: 'community', url: `https://store.public.blob.vercel-storage.com/pieces/${job.id}.glb` })
    expect(stored.has(`pieces/${job.id}.glb`)).toBe(true)
    expect(stored.has(`pieces/${job.id}.webp`)).toBe(true)
    // it's in the repository, free to find, and the hold became a charge
    expect((await searchAssets(db, 'straw')).map((p) => p.id)).toEqual([job.id])
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

describe('generating a garment into the wardrobe', () => {
  it('fits it as a wardrobe item, publishes it for everyone and charges the hold', async () => {
    await grantPurchase(db, 'a1', 100, 'test-grant')
    const job = await startPiece(deps, 'a1', { prompt: 'a navy silk kimono', slot: 'full' })
    expect(job).toMatchObject({ status: 'running', name: 'Navy Silk Kimono', kind: 'full', slot: 'full' })
    expect(await balance(db, 'a1')).toBe(100 - PIECE_PRICE)
    const done = await pollPiece(deps, 'a1', job.id)
    expect(done.status).toBe('done')
    const url = `https://store.public.blob.vercel-storage.com/wear/${job.id}.glb`
    expect(done.item).toMatchObject({ id: job.id, slot: 'full', source: 'community', url, thumb: `https://store.public.blob.vercel-storage.com/wear/${job.id}.webp` })
    expect(done.item!.channels.length).toBeGreaterThan(0)
    expect(stored.has(`wear/${job.id}.glb`)).toBe(true)
    // the wardrobe finds it and gear search doesn't, and the hold became a charge
    expect((await searchItems(db, 'kimono')).map((i) => i.id)).toEqual([job.id])
    expect(await searchAssets(db, 'kimono')).toEqual([])
    expect(await balance(db, 'a1')).toBe(100 - PIECE_PRICE)
    // a saved hero can wear it in its slot, and only there
    const community = await visibleAssets(db, [job.id])
    const hero = { gender: 'm' as const, hair: 'crop' as const, armour: false, cape: false, colors: {} }
    expect(wearProblem({ ...hero, wear: { full: { id: job.id, url } } }, community)).toBeUndefined()
    expect(wearProblem({ ...hero, wear: { upper: { id: job.id, url } } }, community)).toMatch(/can't go in upper/)
    expect(gearProblem({ ...hero, gear: { back: { id: job.id, url } } }, community)).toMatch(/no piece/)
    // polling again just reports it
    expect((await pollPiece(deps, 'a1', job.id)).item?.id).toBe(job.id)
  })

  it("costs nothing when the model won't fit the slot", async () => {
    await grantPurchase(db, 'a1', 100, 'test-grant')
    const disc = await placeholderPiece('offhand')
    const misfit = { ...deps, read: async () => disc }
    const job = await startPiece(misfit, 'a1', { prompt: 'a paper lantern robe', slot: 'full' })
    const done = await pollPiece(misfit, 'a1', job.id)
    expect(done).toMatchObject({ status: 'failed', slot: 'full' })
    expect(done.error).toMatch(/couldn't be made into a garment \(it doesn't fit: covers \d+% of the torso/)
    expect(await balance(db, 'a1')).toBe(100)
    expect(await searchItems(db, '')).toEqual([])
  })

  it('asks for a wardrobe slot it knows', async () => {
    await grantPurchase(db, 'a1', 100, 'test-grant')
    await expect(startPiece(deps, 'a1', { prompt: 'a long tail', slot: 'tail' as never })).rejects.toMatchObject({ status: 400 })
    expect(await balance(db, 'a1')).toBe(100)
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
    const files = /^\{(.*)\}$/.exec(config.functions['api/**/*.ts'].includeFiles as string)![1].split(',')
    const read = ['db/schema.sql', `public/heroes/${REFERENCE_BODY}.glb`, `public/heroes/${REFERENCE_BODY}.kit.json`, ...Object.values(GARMENT_FROM).map((id) => `public/kit/wear/${id}.glb`)]
    expect(files).toEqual(expect.arrayContaining(read))
    for (const file of files) expect(existsSync(new URL(`../../${file}`, import.meta.url)), file).toBe(true)
  })
})
