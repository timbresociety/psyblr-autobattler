import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { ROLES } from '../../src/charter/roles'
import type { RoleId } from '../../src/charter/types'
import { defaultBuild } from '../../src/sim/fixtures'
import { randomBuild } from '../../src/sim/field'
import { createRng } from '../../src/sim/rng'
import { winRateVsField } from '../../src/sim/gate'

// the relative tuner's measurement (see README, step 1): each role's median over its default and the same four sampled
// kits as roles.test.ts, at the factors in out/rel-factors.json; relative.sh moves the factors toward equal medians
const DIR = 'tools/balance/out'
const factors: Record<string, number> = existsSync(`${DIR}/rel-factors.json`) ? JSON.parse(readFileSync(`${DIR}/rel-factors.json`, 'utf8')) : {}
for (const r of ROLES) {
  const f = factors[r.id] ?? 1
  r.base.weaponDamage *= f
  r.base.spiritPower *= f
  r.caps.weaponDamage *= f
  r.caps.spiritPower *= f
}

it('relative', () => {
  const mine = (process.env.TUNE_ROLES ?? '').split(',').filter(Boolean) as RoleId[]
  const out: Record<string, { median: number; rates: number[] }> = {}
  for (const id of mine) {
    const rng = createRng(4242 + id.length)
    const builds = [defaultBuild(id), ...Array.from({ length: 4 }, (_, k) => randomBuild(id, rng, `${id}-tune-${k}`))]
    const rates = builds.map((b) => winRateVsField(b, { duelsPerMember: Number(process.env.TUNE_DUELS ?? 25) }))
    const median = [...rates].sort((a, b) => a - b)[2]
    out[id] = { median, rates: rates.map((r) => Math.round(r * 1000) / 1000) }
    console.log(`REL ${id} median ${median.toFixed(3)} rates ${out[id].rates.join(' ')}`)
  }
  writeFileSync(`${DIR}/rel-${mine.join('-')}.json`, JSON.stringify(out))
}, 3_600_000)
