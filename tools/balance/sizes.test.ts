import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { SIZE_HEALTH, SIZES, type SizeClass } from '../../src/charter/sizes'
import type { RoleId } from '../../src/charter/types'
import { defaultBuild } from '../../src/sim/fixtures'
import { winRateVsField } from '../../src/sim/gate'

// throwaway size tuner: the health multiplier each role pays for each size class, bisected so the default build at
// that size sits at 50% against the (medium) field, at the gate's own settings
it('size', () => {
  const mine = (process.env.TUNE_ROLES ?? '').split(',').filter(Boolean) as RoleId[]
  const out: Record<string, Record<string, { mul: number; rate: number }>> = {}
  for (const role of mine) {
    out[role] = {}
    const table = (SIZE_HEALTH[role] ??= {})
    // each size should be as good as the same role at medium, so a size is a choice of shape, not of strength
    const target = winRateVsField(defaultBuild(role), { duelsPerMember: Number(process.env.TUNE_DUELS ?? 25) })
    console.log(`SIZE ${role} medium ${target}`)
    for (const size of ['tiny', 'small', 'large', 'huge'] as SizeClass[]) {
      const start = table[size] ?? SIZES[size].healthMul
      const span = Number(process.env.TUNE_SPAN ?? 1.6)
      let lo = start / span
      let hi = start * span
      let best = { mul: start, rate: NaN, err: Infinity }
      for (let i = 0; i < Number(process.env.TUNE_STEPS ?? 7); i++) {
        const mid = Math.sqrt(lo * hi)
        table[size] = mid
        const rate = winRateVsField({ ...defaultBuild(role), sizeClass: size }, { duelsPerMember: Number(process.env.TUNE_DUELS ?? 25) })
        if (Math.abs(rate - target) < best.err) best = { mul: mid, rate, err: Math.abs(rate - target) }
        // more health wins more
        if (rate > target) hi = mid
        else lo = mid
      }
      table[size] = best.mul
      out[role][size] = { mul: Math.round(best.mul * 1000) / 1000, rate: Math.round(best.rate * 1000) / 1000 }
      console.log(`SIZE ${role} ${size} ${out[role][size].mul} ${out[role][size].rate}`)
    }
  }
  writeFileSync(`tools/balance/out/size-${mine.join('-')}.json`, JSON.stringify(out))
}, 3_600_000)
