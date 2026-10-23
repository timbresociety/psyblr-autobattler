import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { ROLES } from '../../src/charter/roles'
import type { RoleId } from '../../src/charter/types'
import { defaultBuild } from '../../src/sim/fixtures'
import { randomBuild } from '../../src/sim/field'
import { createRng } from '../../src/sim/rng'
import { winRateVsField } from '../../src/sim/gate'

// throwaway balance tuner: scale each role's weapon and spirit damage so its default build sits at 50% against the
// field (health is fixed by role design). Factors from earlier rounds are applied to every role first.
const DIR = 'tools/balance/out'
const factors: Record<string, number> = existsSync(`${DIR}/factors.json`) ? JSON.parse(readFileSync(`${DIR}/factors.json`, 'utf8')) : {}
const BASE = new Map(ROLES.map((r) => [r.id, { wd: r.base.weaponDamage, sp: r.base.spiritPower, cwd: r.caps.weaponDamage, csp: r.caps.spiritPower }]))
function apply(id: string, f: number) {
  const r = ROLES.find((x) => x.id === id)!
  const b = BASE.get(r.id)!
  r.base.weaponDamage = b.wd * f
  r.base.spiritPower = b.sp * f
  r.caps.weaponDamage = b.cwd * f
  r.caps.spiritPower = b.csp * f
}
for (const [id, f] of Object.entries(factors)) apply(id, f)

it('tune', () => {
  const mine = (process.env.TUNE_ROLES ?? '').split(',').filter(Boolean) as RoleId[]
  const span = Number(process.env.TUNE_SPAN ?? 2.5)
  const steps = Number(process.env.TUNE_STEPS ?? 7)
  const out: Record<string, { factor: number; rate: number }> = {}
  for (const id of mine) {
    const field = undefined
    const start = factors[id] ?? 1
    let lo = start / span
    let hi = start * span
    let best = { factor: start, rate: NaN, err: Infinity }
    // the role's power is judged on the median of a sample of its kits (plus its default), not on one kit
    const rng = createRng(4242 + id.length)
    const sample = Number(process.env.TUNE_SAMPLE ?? 0)
    const builds = [defaultBuild(id), ...Array.from({ length: sample }, (_, k) => randomBuild(id, rng, `${id}-tune-${k}`))]
    const rateAt = (f: number) => {
      apply(id, f)
      const rates = builds.map((b) => winRateVsField(b, { field, duelsPerMember: Number(process.env.TUNE_DUELS ?? 30) })).sort((a, b) => a - b)
      const rate = rates[Math.floor(rates.length / 2)]
      if (Math.abs(rate - 0.5) < best.err) best = { factor: f, rate, err: Math.abs(rate - 0.5) }
      return rate
    }
    for (let i = 0; i < steps; i++) {
      const mid = Math.sqrt(lo * hi)
      if (rateAt(mid) > 0.5) hi = mid
      else lo = mid
    }
    apply(id, start)
    out[id] = { factor: Math.round(best.factor * 1000) / 1000, rate: Math.round(best.rate * 1000) / 1000 }
    console.log(`TUNED ${id} ${out[id].factor} ${out[id].rate}`)
  }
  writeFileSync(`${DIR}/out-${mine.join('-')}.json`, JSON.stringify(out))
}, 3_600_000)
