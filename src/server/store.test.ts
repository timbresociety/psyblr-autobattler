import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { SCHEMA_SQL, type Db } from './db.js'
import { NotFoundError, OwnershipError, addHero, clearHeroPhotos, createHero, deleteBuild, getBuild, hideHero, isKnownDevice, issueDeviceId, listBuilds, popularHeroes, saveBuild, searchHeroes } from './store.js'
import { CATALOG_VERSION } from '../charter/templates/catalog.js'
import { defaultBuild } from '../sim/fixtures.js'
import { setAttribute } from '../charter/build.js'

let db: Db

beforeEach(async () => {
  process.env.BLOB_STORE_ID = 'teststore'
  const pg = new PGlite()
  await pg.exec(SCHEMA_SQL)
  db = pg as unknown as Db
})

const quickGate = { duelsPerMember: 4 }

async function newHero(name: string, device: string) {
  const build = { ...defaultBuild('fighter', name), heroName: name }
  return createHero(db, device, build, ['https://teststore.public.blob.vercel-storage.com/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp'], quickGate)
}

describe('personal loadout', () => {
  it('removing a hero takes it out of your loadout only; an added copy gives back its use', async () => {
    const owner = await issueDeviceId(db)
    const fan = await issueDeviceId(db)
    const hero = await newHero('Jensen', owner)
    const copy = await addHero(db, fan, hero.heroId)
    expect((await searchHeroes(db, 'jensen'))[0].useCount).toBe(1)
    await expect(deleteBuild(db, owner, copy.id)).rejects.toBeInstanceOf(OwnershipError)
    await deleteBuild(db, fan, copy.id)
    expect(await listBuilds(db, fan)).toEqual([])
    expect((await searchHeroes(db, 'jensen'))[0].useCount).toBe(0)
    // the creator's own copy can go too; the shared hero stays for everyone else
    await deleteBuild(db, owner, hero.buildId)
    expect(await listBuilds(db, owner)).toEqual([])
    expect((await searchHeroes(db, 'jensen')).map((h) => h.name)).toEqual(['Jensen'])
    await expect(deleteBuild(db, owner, hero.buildId)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('the most used heroes come first when browsing, and hidden ones never show', async () => {
    const owner = await issueDeviceId(db)
    const a = await newHero('Ada', owner)
    const b = await newHero('Bo', owner)
    await addHero(db, await issueDeviceId(db), b.heroId)
    expect((await popularHeroes(db)).map((h) => h.name)).toEqual(['Bo', 'Ada'])
    await hideHero(db, b.heroId)
    expect((await popularHeroes(db)).map((h) => h.id)).toEqual([a.heroId])
  })
})

describe('photo faces', () => {
  it('a face must come from this deployment\'s own uploads, like any other photo', async () => {
    const owner = await issueDeviceId(db)
    const points = new Array(956).fill(50)
    const look = (url: string) => ({ gender: 'm', hair: 'crop', armour: false, cape: false, colors: {}, face: { url, width: 512, height: 512, points } })
    const build = (url: string) => ({ ...defaultBuild('fighter', 'Faced'), heroName: 'Faced', look: look(url) })
    await expect(createHero(db, owner, build('https://evil.example/face.webp'), [], quickGate)).rejects.toThrow(/face photo/)
    const ok = await createHero(db, owner, build('https://teststore.public.blob.vercel-storage.com/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp'), [], quickGate)
    expect((await getBuild(db, owner, ok.buildId)).build.look?.face?.points).toHaveLength(956)
  })
})

describe('device IDs', () => {
  it('issues unguessable 128-bit IDs', async () => {
    const a = await issueDeviceId(db)
    const b = await issueDeviceId(db)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('global loadout', () => {
  it('search "jen" returns Jensen heroes ranked by use count, without device IDs', async () => {
    const owner = await issueDeviceId(db)
    const first = await newHero('Jensen', owner)
    await newHero('Jensen Classic', owner)
    await newHero('Elon', owner)
    await addHero(db, await issueDeviceId(db), first.heroId)
    const results = await searchHeroes(db, 'jen')
    expect(results.map((r) => r.name)).toEqual(['Jensen', 'Jensen Classic'])
    expect(JSON.stringify(results)).not.toContain(owner)
  })

  it('the creator edits their build, and a later adder still gets the original snapshot (AE7)', async () => {
    const owner = await issueDeviceId(db)
    const hero = await newHero('Jensen', owner)
    const mine = await getBuild(db, owner, hero.buildId)
    const edited = setAttribute(mine.build, 'agility', mine.build.spread.agility - 3)
    if (!edited.ok) throw new Error('edit failed')
    await saveBuild(db, owner, hero.buildId, edited.build, quickGate)
    const other = await addHero(db, await issueDeviceId(db), hero.heroId)
    expect(other.build.spread).toEqual(mine.build.spread)
    expect(other.build.spread).not.toEqual(edited.build.spread)
  })

  it('adding a hero creates a build and does not duplicate the hero', async () => {
    const owner = await issueDeviceId(db)
    const hero = await newHero('Sundar', owner)
    const adder = await issueDeviceId(db)
    await addHero(db, adder, hero.heroId)
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from heroes')
    expect(rows[0].n).toBe(1)
    expect((await listBuilds(db, adder)).length).toBe(1)
  })

  it('an unknown hero ID returns not-found', async () => {
    await expect(addHero(db, await issueDeviceId(db), 'nope')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('a device cannot read or write another device\'s build', async () => {
    const owner = await issueDeviceId(db)
    const hero = await newHero('Satya', owner)
    const intruder = await issueDeviceId(db)
    await expect(getBuild(db, intruder, hero.buildId)).rejects.toBeInstanceOf(OwnershipError)
    const mine = await getBuild(db, owner, hero.buildId)
    await expect(saveBuild(db, intruder, hero.buildId, mine.build, quickGate)).rejects.toBeInstanceOf(OwnershipError)
  })

  it('saving re-validates the build on the server and stamps a gate result', async () => {
    const owner = await issueDeviceId(db)
    const hero = await newHero('Liang', owner)
    const mine = await getBuild(db, owner, hero.buildId)
    const tampered = JSON.parse(JSON.stringify(mine.build))
    tampered.slots.active1.templateId = 'tank-chain-hook'
    await expect(saveBuild(db, owner, hero.buildId, tampered, quickGate)).rejects.toThrow(/invalid build/)
    const saved = await saveBuild(db, owner, hero.buildId, mine.build, quickGate)
    expect(['ready', 'blocked']).toContain(saved.build.gate.state)
    expect(typeof saved.build.gate.winRate).toBe('number')
    expect(saved.build.gate.catalogVersion).toBe(CATALOG_VERSION)
  })

  it('a hidden hero no longer appears in search; photos are kept until deleted, so a takedown can be retried', async () => {
    const owner = await issueDeviceId(db)
    const hero = await newHero('Mark', owner)
    expect(await hideHero(db, hero.heroId)).toEqual(['https://teststore.public.blob.vercel-storage.com/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp'])
    expect(await searchHeroes(db, 'mark')).toEqual([])
    expect(await hideHero(db, hero.heroId)).toEqual(['https://teststore.public.blob.vercel-storage.com/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp'])
    await clearHeroPhotos(db, hero.heroId)
    expect(await hideHero(db, hero.heroId)).toEqual([])
  })

  it('adding the same hero twice returns the same build and counts the device once', async () => {
    const owner = await issueDeviceId(db)
    const hero = await newHero('Eddie', owner)
    const adder = await issueDeviceId(db)
    const first = await addHero(db, adder, hero.heroId)
    const second = await addHero(db, adder, hero.heroId)
    expect(second.id).toBe(first.id)
    expect((await searchHeroes(db, 'eddie'))[0].useCount).toBe(1)
  })

  it('a build whose gate stamp predates the catalogue is returned as draft, to be checked again', async () => {
    const owner = await issueDeviceId(db)
    const hero = await newHero('Satya', owner)
    const mine = await getBuild(db, owner, hero.buildId)
    const old = { ...mine.build, gate: { ...mine.build.gate, state: 'ready', catalogVersion: CATALOG_VERSION - 1 } }
    await db.query('update builds set build = $1 where id = $2', [JSON.stringify(old), hero.buildId])
    expect((await getBuild(db, owner, hero.buildId)).build.gate.state).toBe('draft')
  })

  it('only server-issued device IDs are known', async () => {
    const id = await issueDeviceId(db)
    expect(await isKnownDevice(db, id)).toBe(true)
    expect(await isKnownDevice(db, 'f'.repeat(32))).toBe(false)
  })

  it('a build the gate blocks cannot become a shared hero', async () => {
    const owner = await issueDeviceId(db)
    await expect(createHero(db, owner, defaultBuild('assassin', 'Overpowered'), ['https://teststore.public.blob.vercel-storage.com/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp'], { ...quickGate, candidateScale: 4 })).rejects.toThrow(/blocked/)
  })

  it('rejects photo URLs outside the Blob store', async () => {
    const owner = await issueDeviceId(db)
    await expect(createHero(db, owner, defaultBuild('mage', 'Bezos'), ['https://evil.example.com/x.png'], quickGate)).rejects.toThrow(/photo/)
  })
})
