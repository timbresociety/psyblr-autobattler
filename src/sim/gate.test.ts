import { describe, expect, it } from 'vitest'
import { GATE_CEILING, GATE_FLOOR, GATE_HOPELESS, runGate } from './gate.js'
import { handleGateMessage } from './gate-protocol.js'
import { defaultBuild } from './fixtures.js'
import { CATALOG_VERSION } from '../charter/templates/catalog.js'
import { CALIBRATION_VERSION } from './calibration.js'
import { hydrateBuild } from '../charter/build.js'
import { renderTooltip } from '../charter/tooltip.js'
import { getTemplate } from '../charter/templates/catalog.js'
import { deriveSheet } from '../charter/stats.js'
import { getRole } from '../charter/roles.js'

const quick = { duelsPerMember: 6 }

describe('balance gate (R15, KTD7)', () => {
  it('a normal catalogue build passes without retuning', () => {
    // the default mage sits inside the fair band against the field, between the floor and the pass line
    const result = runGate(defaultBuild('mage'))
    expect(result.state).toBe('ready')
    expect(Object.values(result.build.slots).every((s) => s.retuneSteps === 0)).toBe(true)
    expect(result.winRate).toBeLessThanOrEqual(GATE_CEILING)
  })

  it('an overtuned build is retuned under the ceiling, and its tooltips show lower numbers', () => {
    const build = defaultBuild('marksman')
    const result = runGate(build, { ...quick, candidateScale: 1.35 })
    expect(result.state).toBe('ready')
    expect(result.winRate).toBeLessThanOrEqual(GATE_CEILING)
    const steps = result.build.slots.basic.retuneSteps
    expect(steps).toBeGreaterThan(0)
    const sheet = deriveSheet(getRole('marksman'), build.spread).sheet
    const t = getTemplate(build.slots.basic.templateId)
    const before = renderTooltip(t, { name: 'x', flavour: '' }, sheet, 0).lines[0]
    const after = renderTooltip(t, { name: 'x', flavour: '' }, sheet, steps).lines[0]
    expect(after).not.toBe(before)
  })

  it('a build still over the ceiling after the retune limit is blocked, with its strongest slot and alternatives (AE5)', () => {
    const result = runGate(defaultBuild('assassin'), { ...quick, candidateScale: 4 })
    expect(result.state).toBe('blocked')
    expect(result.strongestSlot).toBeDefined()
    expect(result.alternatives?.length).toBeGreaterThanOrEqual(2)
  })

  it('a build far under the field is lifted toward the floor rather than sent in hopeless', () => {
    const result = runGate(defaultBuild('fighter'), { ...quick, candidateScale: 0.7 })
    expect(result.state).toBe('ready')
    expect(result.build.slots.basic.retuneSteps).toBeLessThan(0)
    expect(result.winRate).toBeGreaterThanOrEqual(GATE_FLOOR - 0.12)
    expect(result.winRate).toBeLessThanOrEqual(GATE_CEILING)
  })

  it('a kit still hopeless at the full lift is blocked as too weak, naming a slot to change', () => {
    const result = runGate(defaultBuild('assassin'), { ...quick, candidateScale: 0.15 })
    expect(result.state).toBe('blocked')
    expect(result.build.gate.blockedFor).toBe('weak')
    expect(result.strongestSlot).toBeDefined()
    expect(result.winRate).toBeLessThan(GATE_HOPELESS)
  })

  it('stamps the result with the catalogue and calibration versions', () => {
    const result = runGate(defaultBuild('tank'), quick)
    expect(result.build.gate).toMatchObject({ catalogVersion: CATALOG_VERSION, calibrationVersion: CALIBRATION_VERSION, state: result.state })
  })

  it('a retuned build keeps its retune steps when stored, but hydrating untrusted input resets them', () => {
    const result = runGate(defaultBuild('marksman'), { ...quick, candidateScale: 1.35 })
    const stored = JSON.parse(JSON.stringify(result.build))
    expect(stored.slots.basic.retuneSteps).toBe(result.build.slots.basic.retuneSteps)
    const hydrated = hydrateBuild(stored)
    expect(hydrated.ok && hydrated.build.slots.basic.retuneSteps).toBe(0)
  })

  it('the worker path and the Node path give identical results for the same seed', () => {
    const build = defaultBuild('mage')
    expect(handleGateMessage({ build, options: quick })).toEqual(runGate(build, quick))
  })
})
