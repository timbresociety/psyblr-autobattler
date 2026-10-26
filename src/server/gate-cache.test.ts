import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { editSkillText } from '../charter/build'
import { defaultBuild } from '../sim/fixtures'
import { SCHEMA_SQL, type Db } from './db'
import { cachedGate, gateKey } from './gate-cache'

let db: Db
beforeEach(async () => {
  const pg = new PGlite()
  await pg.exec(SCHEMA_SQL)
  db = pg as unknown as Db
})

const quick = { duelsPerMember: 4 }

describe('gate cache (U6, KTD6)', () => {
  it('a second gate of the same numbers is served from the cache', async () => {
    const build = defaultBuild('mage')
    const first = await cachedGate(db, build, quick)
    // poison the stored result: if the gate ran again, this number would not come back
    await db.query("update gate_cache set outcome = jsonb_set(outcome, '{winRate}', '0.123')")
    const second = await cachedGate(db, build, quick)
    expect(second.winRate).toBe(0.123)
    expect(second.state).toBe(first.state)
    expect(second.build.gate.aiCalibrationVersion).toBe(first.build.gate.aiCalibrationVersion)
  })

  it('a cosmetic edit keeps the same key; a different template or spread does not', () => {
    const build = defaultBuild('fighter')
    const renamed = editSkillText({ ...build, heroName: 'Someone Else' }, 'ultimate', { name: 'New Name', flavour: 'shiny' })
    expect(renamed.ok).toBe(true)
    expect(gateKey(renamed.build)).toBe(gateKey(build))
    expect(gateKey({ ...build, spread: { ...build.spread, strength: build.spread.strength - 1, agility: build.spread.agility + 1 } })).not.toBe(gateKey(build))
    expect(gateKey(build, quick)).not.toBe(gateKey(build))
  })

  it('a blocked result replays with its strongest slot and alternatives', async () => {
    const opts = { ...quick, candidateScale: 4 }
    const first = await cachedGate(db, defaultBuild('assassin'), opts)
    expect(first.state).toBe('blocked')
    const again = await cachedGate(db, defaultBuild('assassin'), opts)
    expect(again.state).toBe('blocked')
    expect(again.strongestSlot).toBe(first.strongestSlot)
    expect(again.alternatives?.length).toBeGreaterThanOrEqual(2)
  })

  it('a database outage still gates the build instead of failing the save', async () => {
    const down = { query: async () => Promise.reject(new Error('connection refused')) } as unknown as Db
    const outcome = await cachedGate(down, defaultBuild('fighter'), quick)
    expect(outcome.state).toBe('ready')
  })

  it('the key changes when the gate itself is run differently', () => {
    const key = gateKey(defaultBuild('fighter'), quick)
    expect(gateKey(defaultBuild('fighter'), quick)).toBe(key)
    expect(gateKey(defaultBuild('fighter'), { ...quick, duelsPerMember: (quick.duelsPerMember ?? 30) + 1 })).not.toBe(key)
  })
})
