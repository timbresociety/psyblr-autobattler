import { upgradePackage, type HeroPackage, type HeroPackageV1 } from '../forge/package.js'
import type { Db } from './db.js'
import { NotFoundError } from './store.js'

/** A published hero's package by hero ID (R22): heroes the earlier staged Forge published still load from it. */
export async function loadHeroPackage(db: Db, heroId: string, fetchImpl: typeof fetch = fetch): Promise<HeroPackage> {
  const { rows } = await db.query<{ package_url: string | null }>('select package_url from heroes where id = $1 and not hidden', [heroId])
  const url = rows[0]?.package_url
  if (!url) throw new NotFoundError('this hero has no forge package')
  // packages stored before version 2 are upgraded as they load (AE7)
  if (url.startsWith('data:application/json;base64,')) return upgradePackage(JSON.parse(Buffer.from(url.slice(29), 'base64').toString('utf8')))
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`package download failed: ${res.status}`)
  return upgradePackage((await res.json()) as HeroPackageV1)
}
