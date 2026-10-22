import { randomUUID } from 'node:crypto'
import { BUILD_SLOTS, type Build } from '../charter/build'
import { buildPackage, upgradePackage, validatePackage, type HeroPackage, type HeroPackageV1 } from '../forge/package'
import { confirm } from '../forge/stages'
import type { Forge } from '../forge/types'
import type { Db } from './db'
import { ForgeError, commit, presetBatches, type RunnerDeps } from './forge-runner'
import { cachedGate } from './gate-cache'
import { blobStoreId, isOwnForgeAssetUrl } from './photo-url'
import { NotFoundError } from './store'

/**
 * Publish a forge at the stats confirm (U10): run the Charter gate on the forged build, write the package,
 * and create a global-loadout hero (R21, R22). A blocked gate keeps the forge at stats.
 */
export async function publishForge(deps: RunnerDeps, forge: Forge): Promise<Forge> {
  if (!forge.build || !forge.spec) throw new ForgeError('nothing to publish', 409)
  const gate = await cachedGate(deps.db, { ...forge.build, gate: { state: 'checking' } }, deps.gateOptions)
  if (gate.state === 'blocked') {
    const stats = forge.stages.stats
    const blocked: Forge = {
      ...forge,
      stages: { ...forge.stages, stats: { ...stats, failure: `The balance gate blocked this build (wins ${Math.round(gate.winRate * 100)}% against the field). Lower ${gate.strongestSlot ?? 'its strongest skill'} or move points to defence.`, inputs: { ...stats.inputs, gate: { winRate: gate.winRate, strongestSlot: gate.strongestSlot ?? null, alternatives: (gate.alternatives ?? []).map((t) => t.id) } } } },
    }
    return commit(deps.db, forge, blocked)
  }
  const build: Build = gate.build
  const pkg = buildPackage(forge, build, presetBatches(forge))
  const strict = blobStoreId(deps.registry.env) !== undefined
  const problems = validatePackage(pkg, strict ? (url) => isOwnForgeAssetUrl(url, deps.registry.env) : undefined)
  if (problems.length) throw new ForgeError(`the hero package is incomplete: ${problems.join('; ')}`, 409)

  const next = confirm(forge, 'stats')
  if (!next.ok) throw new ForgeError('the stats are not ready to confirm', 409)
  const heroId = randomUUID()
  const packageUrl = await deps.copy(`forge/${forge.id}/package.json`, `data:application/json;base64,${Buffer.from(JSON.stringify(pkg)).toString('base64')}`)
  const original = { ...build, heroId }
  const skills = Object.fromEntries(BUILD_SLOTS.map((s) => [s, { name: build.slots[s].name, flavour: build.slots[s].flavour, visual: build.slots[s].visual }]))
  // hero rows first, so a published forge always has its hero; if the forge commit then loses, undo them
  await deps.db.query(
    `insert into heroes (id, name, name_lower, creator_device, photos, skills, original_build, spec, package_url, creator_account)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [heroId, pkg.heroName, pkg.heroName.toLowerCase(), forge.deviceId ?? `account:${forge.accountId}`, JSON.stringify([pkg.assets.front]), JSON.stringify(skills), JSON.stringify(original), JSON.stringify(pkg.spec), packageUrl, forge.accountId],
  )
  if (forge.deviceId) await deps.db.query('insert into builds (id, hero_id, device_id, build) values ($1, $2, $3, $4)', [randomUUID(), heroId, forge.deviceId, JSON.stringify(original)])
  try {
    return await commit(deps.db, forge, { ...next.forge, build: original, publishedHeroId: heroId })
  } catch (error) {
    await deps.db.query('delete from builds where hero_id = $1', [heroId])
    await deps.db.query('delete from heroes where id = $1', [heroId])
    throw error
  }
}

/** A published hero's package by hero ID (R22). */
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
