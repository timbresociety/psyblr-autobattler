import { withAllStages } from '../forge/stages.js'
import type { Forge } from '../forge/types.js'
import type { Db } from './db.js'
import { NotFoundError } from './store.js'

/** Forge persistence (KTD1). Every write is conditional on the version the writer read. */

export async function insertForge(db: Db, forge: Forge): Promise<void> {
  await db.query('insert into forges (id, account_id, device_id, version, state) values ($1, $2, $3, $4, $5)', [forge.id, forge.accountId, forge.deviceId ?? null, forge.version, JSON.stringify(forge)])
}

/** Load a forge its account owns. Someone else's forge reads as missing, so IDs leak nothing. */
export async function loadForge(db: Db, id: string, accountId: string): Promise<Forge> {
  const { rows } = await db.query<{ state: Forge; version: number }>('select state, version from forges where id = $1 and account_id = $2', [id, accountId])
  if (!rows.length) throw new NotFoundError('forge not found')
  // forges saved before a stage existed get it filled in as a draft (the form stage arrived with the arena)
  return withAllStages({ ...rows[0].state, version: rows[0].version })
}

/** Save `next` only if the row is still at `expected`. Returns the saved forge, or undefined when another request won. */
export async function saveForge(db: Db, expected: number, next: Forge): Promise<Forge | undefined> {
  const saved: Forge = { ...next, version: expected + 1 }
  const { rows } = await db.query('update forges set state = $3, version = $4, updated_at = now() where id = $1 and version = $2 returning id', [next.id, expected, JSON.stringify(saved), saved.version])
  return rows.length ? saved : undefined
}

export interface ForgeSummary {
  id: string
  heroName: string
  current: Forge['current']
  updatedAt: string
}

export async function listForges(db: Db, accountId: string, limit = 20): Promise<ForgeSummary[]> {
  const { rows } = await db.query<{ id: string; hero_name: string | null; current: Forge['current']; updated_at: Date | string }>(
    `select id, state->'spec'->>'heroName' as hero_name, state->>'current' as current, updated_at from forges
     where account_id = $1 order by updated_at desc limit $2`,
    [accountId, limit],
  )
  return rows.map((r) => ({ id: r.id, heroName: r.hero_name ?? 'Untitled hero', current: r.current, updatedAt: new Date(r.updated_at).toISOString() }))
}
