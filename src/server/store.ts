import { randomBytes, randomUUID } from 'node:crypto'
import { BUILD_SLOTS, hydrateBuild, type Build } from '../charter/build'
import { runGate, type GateOptions } from '../sim/gate'
import type { Db } from './db'

/**
 * Shared hero store (U10, KTD9). A Hero is the shared look (name, photos, skill text) plus an immutable
 * snapshot of its creator's first gated build. A Build is one device's own copy. Device IDs are bearer
 * tokens: never returned in Hero or search responses, and a Build is readable and writable only by its owner.
 */

export class NotFoundError extends Error {}
export class OwnershipError extends Error {}
export class StoreInputError extends Error {}

export const MAX_PHOTOS = 3
const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//

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
}

export async function issueDeviceId(db: Db): Promise<string> {
  const id = randomBytes(16).toString('hex')
  await db.query('insert into devices (id) values ($1)', [id])
  return id
}

function validated(raw: unknown): Build {
  const result = hydrateBuild(raw)
  if (!result.ok) throw new StoreInputError(`invalid build: ${result.errors.map((e) => e.field).join(', ')}`)
  return result.build
}

/** Run the balance gate on the server, so a saved Ready is never taken from the client. */
function gated(build: Build, options?: GateOptions): Build {
  return runGate(build, options).build
}

export async function createHero(db: Db, deviceId: string, raw: unknown, photos: string[], gateOptions?: GateOptions): Promise<{ heroId: string; buildId: string }> {
  if (photos.length > MAX_PHOTOS || photos.some((url) => !BLOB_HOST.test(url))) throw new StoreInputError('photos must be uploaded through the photo endpoint')
  const build = gated(validated(raw), gateOptions)
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
  const { rows } = await db.query<{ id: string; name: string; photos: string[]; original_build: Build; use_count: number }>(
    `select id, name, photos, original_build, use_count from heroes
     where not hidden and (name_lower like $1 or name_lower like $2)
     order by (name_lower like $1) desc, use_count desc, created_at asc limit $3`,
    [`${q.replace(/[%_]/g, '')}%`, `%${q.replace(/[%_]/g, '')}%`, limit],
  )
  return rows.map((r) => ({ id: r.id, name: r.name, roleId: r.original_build.roleId, photo: r.photos[0] ?? null, useCount: r.use_count }))
}

/** Add a hero from the global loadout for free: a new Build copied from the creator's original snapshot (R18, AE7). */
export async function addHero(db: Db, deviceId: string, heroId: string): Promise<BuildRecord> {
  const { rows } = await db.query<{ original_build: Build }>('select original_build from heroes where id = $1 and not hidden', [heroId])
  if (!rows.length) throw new NotFoundError('hero not found')
  const build = rows[0].original_build
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
  return { id: buildId, heroId: row.hero_id, build: row.build }
}

export async function listBuilds(db: Db, deviceId: string): Promise<BuildRecord[]> {
  const { rows } = await db.query<{ id: string; hero_id: string; build: Build }>('select id, hero_id, build from builds where device_id = $1 order by updated_at desc', [deviceId])
  return rows.map((r) => ({ id: r.id, heroId: r.hero_id, build: r.build }))
}

/** Save a player's edit: owner only, re-validated and re-gated on the server. */
export async function saveBuild(db: Db, deviceId: string, buildId: string, raw: unknown, gateOptions?: GateOptions): Promise<BuildRecord> {
  const row = await ownedBuild(db, deviceId, buildId)
  const build = gated({ ...validated(raw), heroId: row.hero_id }, gateOptions)
  await db.query('update builds set build = $1, updated_at = now() where id = $2', [JSON.stringify(build), buildId])
  return { id: buildId, heroId: row.hero_id, build }
}

/** Owner-only takedown: hide a hero from search and return its photo URLs for deletion. */
export async function hideHero(db: Db, heroId: string): Promise<string[]> {
  const { rows } = await db.query<{ photos: string[] }>('select photos from heroes where id = $1', [heroId])
  if (!rows.length) throw new NotFoundError('hero not found')
  await db.query(`update heroes set hidden = true, photos = '[]' where id = $1`, [heroId])
  return rows[0].photos
}
