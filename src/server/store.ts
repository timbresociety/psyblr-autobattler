import { randomBytes, randomUUID } from 'node:crypto'
import { BUILD_SLOTS, MAX_PHOTOS, hydrateBuild, type Build } from '../charter/build.js'
import { isGateStale, type GateOptions } from '../sim/gate.js'
import { cachedGate } from './gate-cache.js'
import { isOwnPhotoUrl } from './photo-url.js'
import { gearProblem } from './gear.js'
import type { Db } from './db.js'

/**
 * Shared hero store (U10, KTD9). A Hero is the shared look (name, photos, skill text) plus an immutable
 * snapshot of its creator's first gated build. A Build is one device's own copy. Device IDs are bearer
 * tokens: never returned in Hero or search responses, and a Build is readable and writable only by its owner.
 */

export class NotFoundError extends Error {}
export class OwnershipError extends Error {}
export class StoreInputError extends Error {}


export interface HeroSummary {
  id: string
  name: string
  roleId: string
  photo: string | null
  useCount: number
}

export interface BuildRecord {
  id: string
  heroId: string
  build: Build
  /** The hero's first reference photo, for its card in the Loadout. */
  photo?: string | null
}

/** A gate result earned against older catalogue or calibration numbers goes back to draft, so it is checked again. */
function fresh(build: Build): Build {
  return isGateStale(build) ? { ...build, gate: { state: 'draft' } } : build
}

/** Only server-issued device IDs may write. */
export async function isKnownDevice(db: Db, deviceId: string): Promise<boolean> {
  const { rows } = await db.query('select 1 from devices where id = $1', [deviceId])
  return rows.length > 0
}

export async function issueDeviceId(db: Db): Promise<string> {
  const id = randomBytes(16).toString('hex')
  await db.query('insert into devices (id) values ($1)', [id])
  return id
}

function validated(raw: unknown): Build {
  const result = hydrateBuild(raw)
  if (!result.ok) throw new StoreInputError(`invalid build: ${result.errors.map((e) => e.field).join(', ')}`)
  // a face is a photo like any other: it must have come through the upload endpoint
  if (result.build.look?.face && !isOwnPhotoUrl(result.build.look.face.url)) throw new StoreInputError('the face photo must be uploaded through the photo endpoint')
  const gear = gearProblem(result.build.look)
  if (gear) throw new StoreInputError(`gear: ${gear}`)
  return result.build
}

/**
 * The retune steps a build gated in the browser claims, when it claims a pass. Every slot carries the same number;
 * hydration resets them, so they are read from the raw input. The server only uses them as a hint it measures once.
 */
export function claimedSteps(raw: unknown): number | undefined {
  const input = (raw ?? {}) as { gate?: { state?: unknown }; slots?: Record<string, { retuneSteps?: unknown } | undefined> }
  if (input.gate?.state !== 'ready') return undefined
  const steps = BUILD_SLOTS.map((s) => input.slots?.[s]?.retuneSteps)
  return typeof steps[0] === 'number' && steps.every((x) => x === steps[0]) ? steps[0] : undefined
}

/**
 * Run the balance gate on the server, so a saved Ready is never taken from the client; repeats come from the cache.
 * A browser that already ran the gate sends its steps, and one measurement here confirms them.
 */
async function gated(db: Db, build: Build, options?: GateOptions, claim?: number): Promise<Build> {
  return (await cachedGate(db, build, options, claim)).build
}

export async function createHero(db: Db, deviceId: string, raw: unknown, photos: string[], gateOptions?: GateOptions): Promise<{ heroId: string; buildId: string }> {
  if (photos.length > MAX_PHOTOS || photos.some((url) => !isOwnPhotoUrl(url))) throw new StoreInputError('photos must be uploaded through the photo endpoint')
  const build = await gated(db, validated(raw), gateOptions, claimedSteps(raw))
  if (build.gate.state === 'blocked') throw new StoreInputError('build is blocked by the balance gate')
  const name = build.heroName.trim()
  if (!name) throw new StoreInputError('hero name is required')
  const heroId = randomUUID()
  const skills = Object.fromEntries(BUILD_SLOTS.map((s) => [s, { name: build.slots[s].name, flavour: build.slots[s].flavour, visual: build.slots[s].visual }]))
  const originalBuild = { ...build, heroId }
  await db.query(
    'insert into heroes (id, name, name_lower, creator_device, photos, skills, original_build) values ($1, $2, $3, $4, $5, $6, $7)',
    [heroId, name, name.toLowerCase(), deviceId, JSON.stringify(photos), JSON.stringify(skills), JSON.stringify(originalBuild)],
  )
  const buildId = await insertBuild(db, heroId, deviceId, originalBuild)
  return { heroId, buildId }
}

async function insertBuild(db: Db, heroId: string, deviceId: string, build: Build): Promise<string> {
  const id = randomUUID()
  await db.query('insert into builds (id, hero_id, device_id, build) values ($1, $2, $3, $4)', [id, heroId, deviceId, JSON.stringify(build)])
  return id
}

export async function searchHeroes(db: Db, query: string, limit = 10): Promise<HeroSummary[]> {
  const q = query.trim().toLowerCase().slice(0, 60)
  if (!q) return []
  const { rows } = await db.query<{ id: string; name: string; photos: string[]; role_id: string; use_count: number }>(
    `select id, name, photos, original_build->>'roleId' as role_id, use_count from heroes
     where not hidden and (name_lower like $1 or name_lower like $2)
     order by (name_lower like $1) desc, use_count desc, created_at asc limit $3`,
    [`${q.replace(/[%_]/g, '')}%`, `%${q.replace(/[%_]/g, '')}%`, limit],
  )
  return rows.map((r) => ({ id: r.id, name: r.name, roleId: r.role_id, photo: r.photos[0] ?? null, useCount: r.use_count }))
}

/** The most used heroes in the global loadout, for browsing before you know a name. */
export async function popularHeroes(db: Db, limit = 12): Promise<HeroSummary[]> {
  const { rows } = await db.query<{ id: string; name: string; photos: string[]; role_id: string; use_count: number }>(
    `select id, name, photos, original_build->>'roleId' as role_id, use_count from heroes
     where not hidden order by use_count desc, created_at desc limit $1`,
    [Math.max(1, Math.min(50, limit))],
  )
  return rows.map((r) => ({ id: r.id, name: r.name, roleId: r.role_id, photo: r.photos[0] ?? null, useCount: r.use_count }))
}

/**
 * Take a hero out of this device's loadout (owner only). The shared hero stays in the global loadout for everyone else;
 * removing a copy you added gives back the use it counted, so adding it again later counts once.
 */
export async function deleteBuild(db: Db, deviceId: string, buildId: string): Promise<void> {
  const row = await ownedBuild(db, deviceId, buildId)
  await db.query('delete from builds where id = $1', [buildId])
  await db.query('update heroes set use_count = greatest(0, use_count - 1) where id = $1 and creator_device is distinct from $2', [row.hero_id, deviceId])
}

/** Add a hero from the global loadout for free: a new Build copied from the creator's original snapshot (R18, AE7). */
export async function addHero(db: Db, deviceId: string, heroId: string): Promise<BuildRecord> {
  const { rows } = await db.query<{ original_build: Build }>('select original_build from heroes where id = $1 and not hidden', [heroId])
  if (!rows.length) throw new NotFoundError('hero not found')
  // adding the same hero twice returns the existing copy, and each device counts once toward search rank
  const existing = await db.query<{ id: string; build: Build }>('select id, build from builds where hero_id = $1 and device_id = $2 limit 1', [heroId, deviceId])
  if (existing.rows.length) return { id: existing.rows[0].id, heroId, build: fresh(existing.rows[0].build) }
  const build = fresh(rows[0].original_build)
  const id = await insertBuild(db, heroId, deviceId, build)
  await db.query('update heroes set use_count = use_count + 1 where id = $1', [heroId])
  return { id, heroId, build }
}

async function ownedBuild(db: Db, deviceId: string, buildId: string): Promise<{ hero_id: string; device_id: string; build: Build }> {
  const { rows } = await db.query<{ hero_id: string; device_id: string; build: Build }>('select hero_id, device_id, build from builds where id = $1', [buildId])
  if (!rows.length) throw new NotFoundError('build not found')
  if (rows[0].device_id !== deviceId) throw new OwnershipError('not your build')
  return rows[0]
}

export async function getBuild(db: Db, deviceId: string, buildId: string): Promise<BuildRecord> {
  const row = await ownedBuild(db, deviceId, buildId)
  return { id: buildId, heroId: row.hero_id, build: fresh(row.build) }
}

export async function listBuilds(db: Db, deviceId: string): Promise<BuildRecord[]> {
  const { rows } = await db.query<{ id: string; hero_id: string; build: Build; photo: string | null }>(
    `select b.id, b.hero_id, b.build, h.photos->>0 as photo from builds b join heroes h on h.id = b.hero_id
     where b.device_id = $1 order by b.updated_at desc`,
    [deviceId],
  )
  return rows.map((r) => ({ id: r.id, heroId: r.hero_id, build: fresh(r.build), photo: r.photo }))
}

/** Save a player's edit: owner only, re-validated and re-gated on the server. */
export async function saveBuild(db: Db, deviceId: string, buildId: string, raw: unknown, gateOptions?: GateOptions): Promise<BuildRecord> {
  const row = await ownedBuild(db, deviceId, buildId)
  const build = await gated(db, { ...validated(raw), heroId: row.hero_id }, gateOptions, claimedSteps(raw))
  await db.query('update builds set build = $1, updated_at = now() where id = $2', [JSON.stringify(build), buildId])
  return { id: buildId, heroId: row.hero_id, build }
}

/** Owner-only takedown, step 1: hide a hero from search and return its photo URLs. Safe to repeat. */
export async function hideHero(db: Db, heroId: string): Promise<string[]> {
  const { rows } = await db.query<{ photos: string[] }>('select photos from heroes where id = $1', [heroId])
  if (!rows.length) throw new NotFoundError('hero not found')
  await db.query('update heroes set hidden = true where id = $1', [heroId])
  return rows[0].photos
}

/** Takedown, step 2: forget the photo URLs once the files are deleted, so a failed delete can be retried. */
export async function clearHeroPhotos(db: Db, heroId: string): Promise<void> {
  await db.query(`update heroes set photos = '[]' where id = $1`, [heroId])
}
