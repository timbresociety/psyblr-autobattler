import type { PieceKind } from '../charter/look.js'
import { BUILT_IN, type PieceEntry } from '../kit/pieces.js'
import type { Db } from './db.js'

/**
 * The asset repository (Forge plan, Phase C): every piece of gear anyone can hold. Built-ins ship with the game;
 * community ones are what players generated, stored here and free for everyone after the first player paid. Heroes
 * wear nothing since 2026-11-04, so rows left from garments (a meta set) are never listed or held.
 */

interface AssetRow {
  id: string
  kind: PieceKind
  name: string
  tags: string[]
  url: string
  thumb_url: string | null
  use_count: number
}

const COLUMNS = 'id, kind, name, tags, url, thumb_url, use_count'

const pieceEntry = (r: AssetRow): PieceEntry => ({ id: r.id, name: r.name, kind: r.kind, tags: r.tags, url: r.url, thumb: r.thumb_url ?? '', tint: null, source: 'community', uses: r.use_count })

const clean = (query: string) => query.trim().toLowerCase().replace(/[%_\\]/g, '').slice(0, 60)

/** Built-in pieces whose name or tags contain the query, for one kind or all. */
export function searchBuiltIns(query: string, kind?: PieceKind): PieceEntry[] {
  const q = clean(query)
  return BUILT_IN.filter((p) => (!kind || p.kind === kind) && (!q || p.name.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q))))
}

/** Community pieces of gear whose name or prompt contains the query, the most held first; an empty query lists the most held. */
export async function searchAssets(db: Db, query: string, kind?: PieceKind, limit = 24): Promise<PieceEntry[]> {
  const q = clean(query)
  const { rows } = await db.query<AssetRow>(
    `select ${COLUMNS} from assets
     where not hidden and meta is null and ($1::text is null or kind = $1) and ($2 = '' or name_lower like $3 or lower(prompt) like $3)
     order by ($2 <> '' and name_lower like $4) desc, use_count desc, created_at desc limit $5`,
    [kind ?? null, q, `%${q}%`, `${q}%`, Math.max(1, Math.min(60, limit))],
  )
  return rows.map(pieceEntry)
}

/** The community pieces with these ids that anyone may still hold. */
export async function visibleAssets(db: Db, ids: string[]): Promise<Map<string, PieceEntry>> {
  if (!ids.length) return new Map()
  const { rows } = await db.query<AssetRow>(`select ${COLUMNS} from assets where id = any($1) and not hidden and meta is null`, [ids])
  return new Map(rows.map((r) => [r.id, pieceEntry(r)]))
}

/** One community piece, hidden or not: what a finished job made. */
export async function findAsset(db: Db, id: string): Promise<PieceEntry | undefined> {
  const { rows } = await db.query<AssetRow>(`select ${COLUMNS} from assets where id = $1`, [id])
  return rows[0] && pieceEntry(rows[0])
}

export interface NewAsset {
  id: string
  kind: PieceKind
  name: string
  prompt: string
  url: string
  thumbUrl?: string
  triangles: number
  creatorAccount: string
}

export async function insertAsset(db: Db, a: NewAsset): Promise<PieceEntry> {
  const tags = [a.name.toLowerCase()]
  await db.query(
    `insert into assets (id, kind, name, name_lower, tags, prompt, url, thumb_url, triangles, creator_account)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do nothing`,
    [a.id, a.kind, a.name, a.name.toLowerCase(), tags, a.prompt, a.url, a.thumbUrl ?? null, a.triangles, a.creatorAccount],
  )
  return pieceEntry({ id: a.id, kind: a.kind, name: a.name, tags, url: a.url, thumb_url: a.thumbUrl ?? null, use_count: 0 })
}

/** Count one more hero wearing each of these community assets (built-in ids are simply not in the table). */
export async function countUses(db: Db, ids: string[]): Promise<void> {
  if (ids.length) await db.query('update assets set use_count = use_count + 1 where id = any($1)', [[...new Set(ids)]])
}

/** The owner's takedown: hide an asset from search and from new heroes, and return its files to delete. */
export async function hideAsset(db: Db, id: string): Promise<string[]> {
  const { rows } = await db.query<{ url: string; thumb_url: string | null }>('update assets set hidden = true where id = $1 returning url, thumb_url', [id])
  return rows.flatMap((r) => [r.url, ...(r.thumb_url ? [r.thumb_url] : [])])
}
