import { it } from 'vitest'
import { ROLE_IDS } from '../../src/charter/roles'
import type { RoleId } from '../../src/charter/types'
import { randomBuild } from '../../src/sim/field'
import { createRng } from '../../src/sim/rng'
import { defaultBuild } from '../../src/sim/fixtures'
import { winRateVsField } from '../../src/sim/gate'

// throwaway check: each role's default and the median of its default plus four sampled kits, in 3v3 skirmishes
it('check', () => {
  const roles = (process.env.ROLES ? process.env.ROLES.split(',') : ROLE_IDS) as RoleId[]
  for (const id of roles) {
    const rng = createRng(4242 + id.length)
    const builds = [defaultBuild(id), ...Array.from({ length: 4 }, (_, k) => randomBuild(id, rng, `${id}-tune-${k}`))]
    const rates = builds.map((b) => winRateVsField(b, { duelsPerMember: 12 }))
    const sorted = [...rates].sort((a, b) => a - b)
    console.log('CHECK', id.padEnd(10), 'default', (rates[0] * 100).toFixed(0), 'median', (sorted[2] * 100).toFixed(0), 'all', rates.map((r) => (r * 100).toFixed(0)).join(' '))
  }
}, 3_600_000)
