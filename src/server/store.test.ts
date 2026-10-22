import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { SCHEMA_SQL, type Db } from './db'
import { NotFoundError, OwnershipError, addHero, createHero, getBuild, hideHero, issueDeviceId, listBuilds, saveBuild, searchHeroes } from './store'
import { defaultBuild } from '../sim/fixtures'
import { setAttribute } from '../charter/build'

let db: Db

beforeEach(async () => {
  const pg = new PGlite()
  await pg.exec(SCHEMA_SQL)
  db = pg as unknown as Db
})

const quickGate = { duelsPerMember: 4 }

async function newHero(name: string, device: string) {
  const build = { ...defaultBuild('fighter', name), heroName: name }
  return createHero(db, device, build, ['https://x.public.blob.vercel-storage.com/a.webp'], quickGate)
}

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
  })

  it('a hidden hero no longer appears in search (takedown path)', async () => {
    const owner = await issueDeviceId(db)
    const hero = await newHero('Mark', owner)
    await hideHero(db, hero.heroId)
    expect(await searchHeroes(db, 'mark')).toEqual([])
  })

  it('rejects photo URLs outside the Blob store', async () => {
    const owner = await issueDeviceId(db)
    await expect(createHero(db, owner, defaultBuild('mage', 'Bezos'), ['https://evil.example.com/x.png'], quickGate)).rejects.toThrow(/photo/)
  })
})
