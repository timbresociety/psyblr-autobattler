import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { put } from '@vercel/blob'
import sharp from 'sharp'
import { PIECE_KINDS, WEAR_SLOTS, type PieceKind, type WearSlot } from '../charter/look.js'
import { imageBreach } from '../forge/director/floor.js'
import { garmentAsset, garmentPrompt, hardHeadwear } from '../forge/garment.js'
import { keywordFlags } from '../forge/keywords.js'
import { pieceAsset } from '../forge/piece-asset.js'
import { PIECE_PRICE } from '../forge/pricing.js'
import { candidates, pollTask, route, type Registry } from '../forge/providers/router.js'
import type { Asset, Env, ModerationProvider, PieceProvider } from '../forge/providers/types.js'
import type { ContentFlags } from '../forge/types.js'
import { BUDGET } from '../kit/fit/fit.js'
import { readReference, REFERENCE_BODY, type Reference } from '../kit/fit/reference.js'
import type { PieceEntry } from '../kit/pieces.js'
import type { LibraryEntry } from '../kit/wear/library.js'
import { bump } from './accounts.js'
import { findAsset, insertAsset, type SharedAsset } from './assets.js'
import { placeHold, settleHold } from './credits.js'
import type { Db } from './db.js'
import { DEV_STORE_DIR, DEV_STORE_PATH, devStoreActive, localDev } from './dev-store.js'
import { resendSender } from './email.js'
import { isOwnPhotoUrl } from './photo-url.js'

/**
 * Generating a piece of gear, or a garment, into the asset repository (Forge plan, Phase D; the wardrobe plan, step 9).
 * Starting a job screens the prompt, holds the price and starts the provider's task; the browser then polls, and each
 * poll moves the job along. When the task is done, exactly one poll claims the job and makes the model into what was
 * asked for: a piece cleaned up for its socket (piece-asset.ts), or a garment fitted as a wardrobe item that fits every
 * body (garment.ts). It then publishes the file and its preview, adds it to the repository for everyone and charges
 * the hold. Anything that fails releases the hold, so a failed piece or garment costs nothing.
 */

export class PieceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Where published pieces go: Vercel Blob, or the dev store on the local dev server. */
export type PieceStore = (pathname: string, bytes: Uint8Array, contentType: string) => Promise<string>

export function pickPieceStore(env: Env): PieceStore | undefined {
  if (devStoreActive(env))
    return async (pathname, bytes) => {
      const file = join(DEV_STORE_DIR, pathname)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, bytes)
      return `${DEV_STORE_PATH}${pathname}`
    }
  if (env.BLOB_READ_WRITE_TOKEN) return async (pathname, bytes, contentType) => (await put(pathname, Buffer.from(bytes), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType })).url
  return undefined
}

/**
 * Whether a player can generate here at all: the deployment needs somewhere to publish pieces, a piece provider, and a
 * way to finish signing in (real email, or the local dev server's link). The Forge asks before it asks for an email.
 */
export function generationReady(env: Env, registry: Registry): boolean {
  return !!pickPieceStore(env) && candidates(registry, 'piece').length > 0 && (resendSender(env).available() || localDev(env))
}

export interface PieceDeps {
  db: Db
  registry: Registry
  store: PieceStore
  /** Downloads a provider's output (an https or data: URL). */
  read?: (url: string) => Promise<Uint8Array>
  /** The body garments are fitted on; the game's own reference body when absent. */
  reference?: () => Promise<Reference>
}

export interface PieceInput {
  prompt: string
  /** Where a piece of gear goes. */
  kind?: PieceKind
  /** For a garment, the wardrobe slot it's made for: the job makes a fitted wardrobe item instead of a piece. */
  slot?: WearSlot
  name?: string
  /** One of the player's uploaded reference images, to model the piece or garment from. */
  imageUrl?: string
}

export interface PieceJobView {
  id: string
  /** A piece's kind, or a garment's slot. */
  kind: PieceKind | WearSlot
  /** Set for a garment job. */
  slot?: WearSlot
  name: string
  status: 'running' | 'done' | 'failed'
  error?: string
  piece?: PieceEntry
  /** The finished garment, as the wardrobe lists it. */
  item?: LibraryEntry
}

interface JobRow {
  id: string
  account_id: string
  kind: PieceKind | WearSlot
  slot: WearSlot | null
  name: string
  prompt: string
  image_url: string | null
  status: 'running' | 'finishing' | 'done' | 'failed'
  provider: string | null
  task_id: string | null
  error: string | null
  updated_at: Date | string
}

/** The largest model download a job accepts. */
const MAX_MODEL_BYTES = 60 * 1024 * 1024

/** Piece API calls per minute, durable across instances; polls count too (a poll every 3 s is 20). */
export const PIECE_LIMITS = { perAccount: 60, perIp: 120 }

export async function pieceLimited(db: Db, accountId: string, ip: string, now = new Date()): Promise<boolean> {
  const minute = now.toISOString().slice(0, 16)
  const [a, i] = await Promise.all([bump(db, `piece-acct:${accountId}`, minute), bump(db, `piece-ip:${ip}`, minute)])
  return a > PIECE_LIMITS.perAccount || i > PIECE_LIMITS.perIp
}

/** Most triangles to ask the provider for; the cleanup cuts each piece to its slot's budget. */
const FACE_LIMIT = 20000
/** A job claimed for finishing that hasn't finished in this long is claimed again (its function died). */
const FINISH_STALE_MS = 4 * 60 * 1000

const hold = (id: string) => `piece:${id}`

let reference: Promise<Reference> | undefined

/** The body garments are fitted on, read once per instance (vercel.json bundles its files with the functions). */
function shippedReference(): Promise<Reference> {
  const file = (ext: string) => new URL(`../../public/heroes/${REFERENCE_BODY}${ext}`, import.meta.url)
  reference ??= readReference(file('.glb'), file('.kit.json')).catch((error) => {
    reference = undefined
    throw error
  })
  return reference
}

/** A short name from the prompt: "a wide straw hat with a red band" becomes "Wide Straw Hat". */
export function pieceName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9 '-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['a', 'an', 'the', 'with', 'and', 'of', 'for', 'my', 'his', 'her'].includes(w))
  const name = words.slice(0, 3).join(' ')
  return name ? name.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : 'Piece'
}

/** The content floor for a piece's words: nothing sexual, nothing about children, no claimed brand endorsements. */
async function screen(registry: Registry, text: string): Promise<string | undefined> {
  const moderated = await route<ModerationProvider, ContentFlags>(registry, 'moderation', (p) => p.classify({ text }))
  const votes = [keywordFlags(text), ...(moderated.ok === true ? [moderated.value] : [])]
  if (votes.some((f) => f.minors)) return "Pieces can't reference children."
  if (votes.some((f) => f.sexual)) return 'Pieces have to stay safe for work.'
  if (votes.some((f) => f.endorsement)) return "Pieces can't claim a brand's endorsement."
  return undefined
}

async function download(url: string): Promise<Uint8Array> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    const body = url.slice(comma + 1)
    return url.slice(5, comma).endsWith(';base64') ? new Uint8Array(Buffer.from(body, 'base64')) : new Uint8Array(Buffer.from(decodeURIComponent(body)))
  }
  if (!url.startsWith('https:')) throw new Error('outputs must come over https')
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length > MAX_MODEL_BYTES) throw new Error('the model is too large')
  return bytes
}

function view(row: JobRow, made?: SharedAsset): PieceJobView {
  const status = row.status === 'finishing' ? 'running' : row.status
  return {
    id: row.id,
    kind: row.kind,
    ...(row.slot ? { slot: row.slot } : {}),
    name: row.name,
    status,
    ...(row.error ? { error: row.error } : {}),
    ...(made ? ('slot' in made ? { item: made } : { piece: made }) : {}),
  }
}

async function fail(db: Db, row: JobRow, reason: string): Promise<PieceJobView> {
  await settleHold(db, hold(row.id), false)
  await db.query("update piece_jobs set status = 'failed', error = $2, updated_at = now() where id = $1", [row.id, reason.slice(0, 300)])
  return view({ ...row, status: 'failed', error: reason })
}

export async function startPiece(deps: PieceDeps, accountId: string, input: PieceInput): Promise<PieceJobView> {
  const prompt = input.prompt.trim().replace(/\s+/g, ' ')
  const { slot } = input
  const what = slot === undefined ? 'piece' : 'garment'
  if (prompt.length < 3 || prompt.length > 300) throw new PieceError(`describe the ${what} in 3 to 300 characters`, 400)
  if (slot === undefined && !(PIECE_KINDS as readonly unknown[]).includes(input.kind)) throw new PieceError('pick where the piece goes', 400)
  if (slot !== undefined && !(WEAR_SLOTS as readonly unknown[]).includes(slot)) throw new PieceError('pick the slot the garment is for', 400)
  if (input.imageUrl && !isOwnPhotoUrl(input.imageUrl)) throw new PieceError('the picture must be one of your uploaded reference images', 400)
  const name = (input.name?.trim() || pieceName(prompt)).slice(0, 40)
  const refused = (await screen(deps.registry, `${name}. ${prompt}`)) ?? (input.imageUrl ? await imageBreach(deps.registry, input.imageUrl, false) : undefined)
  if (refused) throw new PieceError(refused, 422)
  const id = randomUUID()
  await placeHold(deps.db, accountId, PIECE_PRICE, hold(id))
  // a garment's prompt also tells the generator what the fit needs: the garment alone, upright, open where a body goes
  const request = slot ? { prompt: garmentPrompt(slot, prompt), slot } : { prompt, kind: input.kind }
  // a garment is asked for at its slot's budget, so the provider's own remesh does the cutting and keeps its texture whole
  const faceLimit = slot ? BUDGET[slot] : FACE_LIMIT
  const routed = await route<PieceProvider, Asset>(deps.registry, 'piece', (p) => p.start({ ...request, imageUrl: input.imageUrl, faceLimit }))
  if (routed.ok === false) {
    await settleHold(deps.db, hold(id), false)
    if (routed.kind === 'unavailable') throw new PieceError("generating pieces isn't switched on for this deployment yet", 503)
    if (routed.kind === 'declined') throw new PieceError(`the generator turned that one down: ${routed.reasons[0]?.reason ?? 'no reason given'}`, 422)
    throw new PieceError(`the generator couldn't start that ${what}, and nothing was charged; try again in a moment`, 502)
  }
  await deps.db.query(
    "insert into piece_jobs (id, account_id, kind, slot, name, prompt, image_url, status, provider, task_id) values ($1, $2, $3, $4, $5, $6, $7, 'running', $8, $9)",
    [id, accountId, slot ?? input.kind, slot ?? null, name, prompt, input.imageUrl ?? null, routed.provider, routed.ok === 'pending' ? routed.taskId : null],
  )
  const row = (await loadJob(deps.db, id, accountId))!
  // a provider that answers at once (no task to poll) is finished right here
  return routed.ok === true ? finish(deps, row, routed.value) : view(row)
}

async function loadJob(db: Db, id: string, accountId: string): Promise<JobRow | undefined> {
  const { rows } = await db.query<JobRow>('select * from piece_jobs where id = $1 and account_id = $2', [id, accountId])
  return rows[0]
}

/** Make the finished model into a piece or a garment, publish it and its preview, and add it to the repository. */
async function finish(deps: PieceDeps, row: JobRow, asset: Asset): Promise<PieceJobView> {
  const claimed = await deps.db.query<{ id: string }>(
    "update piece_jobs set status = 'finishing', updated_at = now() where id = $1 and (status = 'running' or (status = 'finishing' and updated_at < now() - make_interval(secs => $2))) returning id",
    [row.id, FINISH_STALE_MS / 1000],
  )
  // another poll is already finishing it
  if (!claimed.rows.length) return view({ ...row, status: 'running' })
  try {
    const read = deps.read ?? download
    const model = await read(asset.url)
    // a garment is fitted to the reference body, so one file fits every body; headwear rides the head whole unless it drapes
    const garment = row.slot
      ? await garmentAsset(model, { id: row.id, name: row.name, slot: row.slot, ...(row.slot === 'head' ? { hard: hardHeadwear(row.prompt) } : {}) }, await (deps.reference ?? shippedReference)())
      : undefined
    const { glb, triangles } = garment ? { glb: garment.glb, triangles: garment.report.triangles } : await pieceAsset(model, row.kind as PieceKind)
    const dir = garment ? 'wear' : 'pieces'
    const url = await deps.store(`${dir}/${row.id}.glb`, glb, 'model/gltf-binary')
    let thumbUrl: string | undefined
    if (asset.preview) {
      const thumb = await sharp(await read(asset.preview)).resize({ width: 320, height: 320, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 84 }).toBuffer().catch(() => undefined)
      if (thumb) thumbUrl = await deps.store(`${dir}/${row.id}.webp`, new Uint8Array(thumb), 'image/webp')
    }
    const meta = garment ? { meta: { channels: garment.meta.channels, knobs: garment.meta.knobs } } : {}
    const made = await insertAsset(deps.db, { id: row.id, kind: row.kind, name: row.name, prompt: row.prompt, url, thumbUrl, triangles, creatorAccount: row.account_id, ...meta })
    await settleHold(deps.db, hold(row.id), true)
    await deps.db.query("update piece_jobs set status = 'done', updated_at = now() where id = $1", [row.id])
    return view({ ...row, status: 'done' }, made)
  } catch (error) {
    return fail(deps.db, row, `the model couldn't be made into a ${row.slot ? 'garment' : 'piece'} (${error instanceof Error ? error.message : String(error)}), and nothing was charged`)
  }
}

/** Move a job along: ask the provider about its task, and finish it once the model is ready. */
export async function pollPiece(deps: PieceDeps, accountId: string, id: string): Promise<PieceJobView> {
  const row = await loadJob(deps.db, id, accountId)
  if (!row) throw new PieceError('no such piece job', 404)
  if (row.status === 'done') return view(row, await findAsset(deps.db, row.id))
  if (row.status === 'failed') return view(row)
  if (row.status === 'finishing' && Date.now() - new Date(row.updated_at).getTime() < FINISH_STALE_MS) return view(row)
  if (!row.provider || !row.task_id) return fail(deps.db, row, 'the job lost track of its task, and nothing was charged')
  const polled = await pollTask(deps.registry, row.provider, (p) => (p as PieceProvider).poll(row.task_id!))
  if (polled.ok === 'pending') {
    await deps.db.query('update piece_jobs set updated_at = now() where id = $1', [row.id])
    return view(row)
  }
  if (polled.ok === false) return fail(deps.db, row, polled.kind === 'declined' ? `the generator turned that one down: ${polled.reasons[0]?.reason ?? 'no reason given'}` : `the generator failed (${polled.reasons[0]?.reason ?? 'unknown'}), and nothing was charged`)
  return finish(deps, row, polled.value)
}
