import type { PieceKind, WearSlot } from '../charter/look.js'
import { BUILT_IN, type PieceEntry } from '../kit/pieces.js'
import type { ItemChannel, ItemSlot, Knob } from '../kit/wear/item.js'
import { LIBRARY, type LibraryEntry } from '../kit/wear/library.js'
import type { Db } from './db.js'

/**
 * The asset repository (Forge plan, Phase C): every piece of gear and every garment anyone can wear. Built-ins ship
 * with the game; community ones are what players generated, stored here and free for everyone after the first player
 * paid. A garment (the wardrobe plan, step 9) is a fitted wardrobe item: its kind is its slot, and its meta holds what
 * the fit made of it.
 */

/** What the fit made of a generated garment: its colour channels and the cuts it allows. */
export interface GarmentMeta {
  channels: ItemChannel[]
  knobs: Knob[]
}

interface AssetRow {
  id: string
  /** A piece's kind, or a garment's slot. */
  kind: PieceKind | WearSlot
  name: string
  tags: string[]
  url: string
  thumb_url: string | null
  use_count: number
  meta: GarmentMeta | null
}

/** A community asset: a piece of gear, or a garment, which is a wardrobe item and so has a slot. */
export type SharedAsset = PieceEntry | LibraryEntry

const COLUMNS = 'id, kind, name, tags, url, thumb_url, use_count, meta'

const pieceEntry = (r: AssetRow): PieceEntry => ({ id: r.id, name: r.name, kind: r.kind as PieceKind, tags: r.tags, url: r.url, thumb: r.thumb_url ?? '', tint: null, source: 'community', uses: r.use_count })

/** Any community asset as the wardrobe lists it: a piece is worn in the slot of its kind, with no channels or cuts. */
const itemEntry = (r: AssetRow): LibraryEntry => ({ id: r.id, name: r.name, slot: r.kind, tags: r.tags, url: r.url, thumb: r.thumb_url ?? '', source: 'community', channels: r.meta?.channels ?? [], knobs: r.meta?.knobs ?? [], uses: r.use_count })

const entry = (r: AssetRow): SharedAsset => (r.meta ? itemEntry(r) : pieceEntry(r))

const clean = (query: string) => query.trim().toLowerCase().replace(/[%_\\]/g, '').slice(0, 60)

/** Built-in pieces whose name or tags contain the query, for one kind or all. */
export function searchBuiltIns(query: string, kind?: PieceKind): PieceEntry[] {
  const q = clean(query)
  return BUILT_IN.filter((p) => (!kind || p.kind === kind) && (!q || p.name.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q))))
}

/** Built-in wardrobe items (pieces included) whose name or tags contain the query, for one slot or all. */
export function searchLibrary(query: string, slot?: ItemSlot): LibraryEntry[] {
  const q = clean(query)
  return LIBRARY.filter((e) => (!slot || e.slot === slot) && (!q || e.name.toLowerCase().includes(q) || e.tags.some((t) => t.includes(q))))
}

/** Community assets whose name or prompt contains the query, the most worn first; an empty query lists the most worn. */
async function search(db: Db, query: string, kind: string | undefined, piecesOnly: boolean, limit: number): Promise<AssetRow[]> {
  const q = clean(query)
  const { rows } = await db.query<AssetRow>(
    `select ${COLUMNS} from assets
     where not hidden and (not $6 or meta is null) and ($1::text is null or kind = $1) and ($2 = '' or name_lower like $3 or lower(prompt) like $3)
     order by ($2 <> '' and name_lower like $4) desc, use_count desc, created_at desc limit $5`,
    [kind ?? null, q, `%${q}%`, `${q}%`, Math.max(1, Math.min(60, limit)), piecesOnly],
  )
  return rows
}

/** Community pieces of gear for one kind or all (garments aren't gear). */
export async function searchAssets(db: Db, query: string, kind?: PieceKind, limit = 24): Promise<PieceEntry[]> {
  return (await search(db, query, kind, true, limit)).map(pieceEntry)
}

/** Community wardrobe items for one slot or all: the garments players generated, and their pieces worn as items. */
export async function searchItems(db: Db, query: string, slot?: ItemSlot, limit = 24): Promise<LibraryEntry[]> {
  return (await search(db, query, slot, false, limit)).map(itemEntry)
}

/** The community assets with these ids that anyone may still wear. */
export async function visibleAssets(db: Db, ids: string[]): Promise<Map<string, SharedAsset>> {
  if (!ids.length) return new Map()
  const { rows } = await db.query<AssetRow>(`select ${COLUMNS} from assets where id = any($1) and not hidden`, [ids])
  return new Map(rows.map((r) => [r.id, entry(r)]))
}

/** One community asset, hidden or not: what a finished job made. */
export async function findAsset(db: Db, id: string): Promise<SharedAsset | undefined> {
  const { rows } = await db.query<AssetRow>(`select ${COLUMNS} from assets where id = $1`, [id])
  return rows[0] && entry(rows[0])
}

export interface NewAsset {
  id: string
  kind: PieceKind | WearSlot
  name: string
  prompt: string
  url: string
  thumbUrl?: string
  triangles: number
  creatorAccount: string
  /** Set for a garment. */
  meta?: GarmentMeta
}

export async function insertAsset(db: Db, a: NewAsset): Promise<SharedAsset> {
  const tags = [a.name.toLowerCase()]
  await db.query(
    `insert into assets (id, kind, name, name_lower, tags, prompt, url, thumb_url, triangles, creator_account, meta)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do nothing`,
    [a.id, a.kind, a.name, a.name.toLowerCase(), tags, a.prompt, a.url, a.thumbUrl ?? null, a.triangles, a.creatorAccount, a.meta ? JSON.stringify(a.meta) : null],
  )
  return entry({ id: a.id, kind: a.kind, name: a.name, tags, url: a.url, thumb_url: a.thumbUrl ?? null, use_count: 0, meta: a.meta ?? null })
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
