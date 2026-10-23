import { describe, expect, it } from 'vitest'
import { ROLE_IDS } from '../charter/roles'
import { SIZE_CLASSES } from '../charter/sizes'
import { AI_CALIBRATION_VERSION, CALIBRATION_VERSION } from './calibration'
import { defaultBuild } from './fixtures'
import { isGateStale, runGate, winRateVsField } from './gate'
import { CATALOG_VERSION } from '../charter/templates/catalog'

describe('gate on the 3D engine (U6, KTD6)', () => {
  // CPU time of this process, so other test files running in parallel do not count against the budget
  const cpuMs = (run: () => void) => {
    const start = process.cpuUsage()
    run()
    const used = process.cpuUsage(start)
    return (used.user + used.system) / 1000
  }

  // The gate plays 3v3 skirmishes, about three duels' work each, so in the browser every measurement is spread over a
  // pool of workers (src/ui/api.ts). On one core here a passing gate is one measurement and a blocked worst case about
  // eight. Vitest's transform roughly doubles CPU time, and inside the full parallel suite macOS moves busy processes
  // onto efficiency cores, so only `npm run bench:gate` checks the time; the default suite checks only the outcomes.
  const timed = process.env.GATE_BENCH === '1'
  it('a passing gate is one measurement and a blocked worst case stays bounded', () => {
    const passing = cpuMs(() => expect(runGate(defaultBuild('mage')).state).toBe('ready'))
    const blocked = cpuMs(() => expect(runGate(defaultBuild('assassin'), { candidateScale: 4 }).state).toBe('blocked'))
    if (timed) {
      expect(passing).toBeLessThan(25_000)
      expect(blocked).toBeLessThan(200_000)
    }
  }, 600_000)

  it('a build stamped with an older engine or AI calibration is stale', () => {
    const now = { state: 'ready' as const, catalogVersion: CATALOG_VERSION, calibrationVersion: CALIBRATION_VERSION, aiCalibrationVersion: AI_CALIBRATION_VERSION }
    const build = defaultBuild('tank')
    expect(isGateStale({ ...build, gate: now })).toBe(false)
    expect(isGateStale({ ...build, gate: { ...now, calibrationVersion: 2 } })).toBe(true)
    expect(isGateStale({ ...build, gate: { ...now, aiCalibrationVersion: AI_CALIBRATION_VERSION - 1 } })).toBe(true)
  })

  it('each choosable size class averages between 45% and 55% against the field', () => {
    for (const size of SIZE_CLASSES) {
      const rates = ROLE_IDS.map((r) => winRateVsField({ ...defaultBuild(r), ...(size === 'medium' ? {} : { sizeClass: size }) }, { duelsPerMember: 12 }))
      const avg = rates.reduce((a, b) => a + b, 0) / rates.length
      expect(avg, size).toBeGreaterThanOrEqual(0.45)
      expect(avg, size).toBeLessThanOrEqual(0.55)
    }
  }, 600_000)
})
