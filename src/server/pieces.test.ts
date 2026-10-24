import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { PIECE_PRICE } from '../forge/pricing.js'
import { createRegistry } from '../forge/providers/registry.js'
import { searchAssets } from './assets.js'
import { balance, grantPurchase } from './credits.js'
import { SCHEMA_SQL, type Db } from './db.js'
import { pieceName, pollPiece, startPiece, type PieceDeps } from './pieces.js'

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

  it('names a piece from its prompt', () => {
    expect(pieceName('A wide straw hat with a red band')).toBe('Wide Straw Hat')
    expect(pieceName('!!!')).toBe('Piece')
  })
})
