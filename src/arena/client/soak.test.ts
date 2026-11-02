import { describe, expect, it } from 'vitest'
import { STARTERS, starterBuild } from '../starters.js'
import { createMatch } from '../engine/match.js'
import { AIM_STEPS, slotBit } from '../engine/state.js'
import { DEFAULT_SOAK, createSoakRecorder, forceUltimates, frameStats, soakCommand, soakOptions } from './soak.js'

const env = { userAgent: 'test', viewport: { width: 1440, height: 900, pixelRatio: 2 }, startedAt: '2026-10-30T00:00:00Z' }
const arena = () =>
  createMatch(
    STARTERS.slice(0, 3).map((h) => ({ build: starterBuild(h) })),
    STARTERS.slice(10, 13).map((h) => ({ build: starterBuild(h) })),
    7,
  )

describe('soak test (Forge goal, phase 0)', () => {
  it('reads its options from the address, keeping defaults for anything missing or invalid', () => {
    expect(soakOptions('?soak')).toEqual(DEFAULT_SOAK)
    expect(soakOptions('?soak&minutes=2&ults=10&wave=4&seed=9&match=-3')).toEqual({ ...DEFAULT_SOAK, minutes: 2, ultimateEvery: 10, ultimatesPerWave: 4, seed: 9 })
  })

  it('steers the scripted player at the nearest enemy, sideways at range, swinging every tick', () => {
    const { match } = arena()
    const me = match.heroes[0]
    const foe = match.heroes.filter((h) => h.team !== me.team).sort((a, b) => Math.hypot(a.position.x - me.position.x, a.position.z - me.position.z) - Math.hypot(b.position.x - me.position.x, b.position.z - me.position.z))[0]
    foe.position = { x: me.position.x, y: 0, z: me.position.z + 4 }
    match.tick = 1
    const c = soakCommand(match, 0)
    // the enemy is straight down +z, which is yaw 0
    expect(((c.aimYaw % AIM_STEPS) + AIM_STEPS) % AIM_STEPS).toBe(0)
    expect(Math.abs(c.moveX)).toBeCloseTo(1)
    expect(c.moveZ).toBeCloseTo(0)
    expect(c.buttons).toBe(slotBit('basic'))
    match.tick = 30
    expect(soakCommand(match, 0).buttons & slotBit('ultimate')).toBeTruthy()
  })

  it('takes ultimates off cooldown on both sides at once', () => {
    const { match } = arena()
    for (const h of match.heroes) h.cooldowns.ultimate = 999
    const picked = forceUltimates(match, 4, 0)
    expect(picked).toHaveLength(4)
    expect(new Set(picked.map((i) => match.heroes[i].team)).size).toBe(2)
    for (const i of picked) expect(match.heroes[i].cooldowns.ultimate).toBe(0)
    match.heroes[0].alive = false
    expect(forceUltimates(match, 6, 1)).not.toContain(0)
  })

  it('grades frames and keeps the spikes with what was happening', () => {
    expect(frameStats([])).toMatchObject({ frames: 0, medianMs: 0, worstMs: 0 })
    const r = createSoakRecorder({ ...DEFAULT_SOAK, minutes: 1 }, env)
    const base = { match: 0, alive: 20, controlled: true, quality: 'full' as const, pixelRatio: 2, drawCalls: 300, triangles: 1e6, geometries: 100, textures: 50 }
    r.context({ ...base, phase: 'loading' })
    r.frame(250)
    r.context({ ...base, phase: 'fight' })
    r.events([{ type: 'cast', hero: 3, slot: 'ultimate', templateId: 'x', release: 30, ends: 60 }])
    for (let i = 0; i < 600; i++) r.frame(i === 30 ? 48 : 16.7)
    r.sample()
    const report = r.report()
    expect(report.fight.frames).toBe(600)
    expect(report.fight.medianMs).toBeCloseTo(16.7)
    expect(report.all.worstMs).toBe(250)
    expect(report.spikes.map((s) => [s.phase, s.ms])).toEqual([
      ['loading', 250],
      ['fight', 48],
    ])
    expect(report.spikes[1].ultimates).toBe(1)
    expect(report.samples[0]).toMatchObject({ phase: 'fight', frames: 600, ultimates: 1 })
    expect(report.pass.frames).toBe(true)
    expect(report.finished).toBe(false)
  })
})
