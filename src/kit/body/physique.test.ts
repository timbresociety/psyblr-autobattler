import { beforeAll, describe, expect, it } from 'vitest'
import { HELPER_BONES, MUSCLE_REGIONS } from '../rig/metarig.js'
import { readBody, type BodyFile } from './node.js'
import { ARCHETYPES, dial, headScale, heightScale, helperGain, PRESETS, postureTurns, sculptVolume, type PhysiqueDials } from './physique.js'
import { bodyLandmarks, girth, type Skeleton } from './regions.js'
import { bodyBase, shapeBody, type BodyBase } from './shape.js'

const file = (b: string) => new URL(`../../../public/heroes/v2/${b}.glb`, import.meta.url)
const bodies: Record<string, { file: BodyFile; base: BodyBase; skeleton: Skeleton }> = {}

beforeAll(async () => {
  for (const b of ['f-medium', 'm-medium']) {
    const f = await readBody(file(b))
    bodies[b] = { file: f, base: bodyBase(f), skeleton: { bones: f.bones, rest: f.rest } }
  }
})

const N: PhysiqueDials = { weight: 0.5, muscle: 0.5, age: 0 }

function shaped(b: string, p: Partial<PhysiqueDials>, gender: 'm' | 'f' = b[0] as 'm' | 'f') {
  const { base, skeleton } = bodies[b]
  return shapeBody(base, [], { ...N, ...p }, undefined, { skeleton, gender })
}

/** The furthest any vertex moved, and how many moved more than a millimetre. */
function moved(a: ArrayLike<number>, b: ArrayLike<number>) {
  let most = 0
  let count = 0
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2])
    most = Math.max(most, d)
    if (d > 0.001) count++
  }
  return { most, count }
}

describe('physique: Structure × Volume (§9.3)', () => {
  it('ships the twelve archetypes of the fantasy table, each with its three examples', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([...ARCHETYPES])
    expect(PRESETS).toHaveLength(12)
    for (const p of PRESETS) expect(p.examples.every((e) => e.length > 2)).toBe(true)
    expect(PRESETS.find((p) => p.id === 'bodybuilder')?.examples).toContain('Hulk')
  })

  it('keeps every preset height choosable (1.0 to 2.6 m) and its dials in range', () => {
    for (const p of PRESETS) {
      expect(p.dials.height!).toBeGreaterThanOrEqual(1)
      expect(p.dials.height!).toBeLessThanOrEqual(2.6)
      for (const [k, v] of Object.entries(p.dials)) if (typeof v === 'number' && k !== 'height') expect(v, `${p.id}.${k}`).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('locks the adult figure at neutral on the child-proportioned preset', () => {
    const child = { ...PRESETS[0].dials, bustSize: 1, glutes: 1, hipCurve: 1 }
    expect(child.child).toBe(true)
    expect(dial(child, 'bustSize')).toBe(0.5)
    expect(dial(child, 'glutes')).toBe(0.5)
    expect(dial({ ...child, child: false }, 'bustSize')).toBe(1)
    const f = shaped('f-medium', child)
    const plain = shaped('f-medium', { ...child, bustSize: 0.5, glutes: 0.5, hipCurve: 0.5 })
    expect(moved(f.positions, plain.positions).most).toBe(0)
  })

  it('reads a head dial as heads tall: 9 heroic through 4.5 chibi-leaning', () => {
    expect(headScale({ head: 0.5 })).toBe(1)
    expect(headScale({ head: 1 })).toBeCloseTo(1.67, 2)
    expect(headScale({ head: 0 })).toBeCloseTo(0.83, 2)
    expect(heightScale({ height: 2.6 })).toBeCloseTo(2.6 / 1.8)
    expect(heightScale({ height: 9 })).toBeCloseTo(2.6 / 1.8)
    expect(heightScale({}, 1.15)).toBe(1.15)
  })

  it('gives muscle helpers no effect on lean or soft bodies and full effect at DBZ', () => {
    for (const r of MUSCLE_REGIONS) {
      expect(helperGain({ ...N, muscle: 0.3 }, r)).toBe(0)
      expect(helperGain({ ...N, muscle: 1 }, r)).toBe(1)
    }
    expect(helperGain({ ...N, muscle: 0.7, regional: { arms: 1 } }, 'arms')).toBe(1)
    expect(helperGain({ ...N, muscle: 0.7, regional: { arms: 0 } }, 'arms')).toBe(0)
  })

  it('leaves the body as made when every dial is neutral', () => {
    const { base } = bodies['m-medium']
    expect(moved(shaped('m-medium', {}).positions, base.positions).most).toBe(0)
  })

  it('swells a region with its dial and leaves the rest of the body alone', () => {
    const plain = shaped('m-medium', {})
    const big = shaped('m-medium', { regional: { arms: 1 } })
    const { skeleton } = bodies['m-medium']
    const g0 = girth(plain, skeleton, 'LeftArm', 'LeftForeArm', 0.5, ['LeftArm', 'LeftArmTwist'])
    const g1 = girth(big, skeleton, 'LeftArm', 'LeftForeArm', 0.5, ['LeftArm', 'LeftArmTwist'])
    expect(g1 / g0).toBeGreaterThan(1.04)
    // nothing below the hips moves for the arms
    const hips = skeleton.rest.Hips[1]
    for (let i = 0; i < plain.positions.length; i += 3) if (plain.positions[i + 1] < hips - 0.1) expect(big.positions[i + 1]).toBe(plain.positions[i + 1])
  })

  it('grows, lifts and spreads the bust on an adult female body, a little on a male chest', () => {
    const { skeleton } = bodies['f-medium']
    const plain = shaped('f-medium', {})
    const lm0 = bodyLandmarks(plain, skeleton).breast.Left!
    const big = shaped('f-medium', { bustSize: 1 })
    const lm1 = bodyLandmarks(big, skeleton).breast.Left!
    expect(lm1.at[2] - lm0.at[2]).toBeGreaterThan(0.012)
    const lifted = bodyLandmarks(shaped('f-medium', { bustLift: 1 }), skeleton).breast.Left!
    expect(lifted.at[1] - lm0.at[1]).toBeGreaterThan(0.004)
    const male = moved(shaped('m-medium', { bustSize: 1 }).positions, shaped('m-medium', {}).positions).most
    const female = moved(big.positions, plain.positions).most
    expect(male).toBeGreaterThan(0)
    expect(male).toBeLessThan(female * 0.5)
  })

  it('narrows the waist, deepens the chest and thickens the neck', () => {
    const plain = shaped('m-medium', {})
    for (const p of [{ waist: 0 }, { chestDepth: 1 }, { neckThickness: 1 }, { belly: 1 }, { glutes: 1 }, { thighs: 1 }, { hipCurve: 1 }, { ribcage: 1 }] as Partial<PhysiqueDials>[]) {
      const m = moved(shaped('m-medium', p).positions, plain.positions)
      expect(m.most, JSON.stringify(p)).toBeGreaterThan(0.004)
      expect(m.most, JSON.stringify(p)).toBeLessThan(0.12)
      expect(m.count, JSON.stringify(p)).toBeGreaterThan(30)
    }
  })

  it('never tears the surface: no vertex moves far from its neighbours on the most extreme presets', () => {
    for (const id of ['bodybuilder', 'heavyweight', 'heroine'] as const) {
      const p = PRESETS.find((a) => a.id === id)!
      const b = `${p.gender}-medium`
      const plain = shaped(b, { weight: p.dials.weight, muscle: p.dials.muscle })
      const s = shaped(b, p.dials)
      const tris = s.surface.triangles
      let worst = 0
      for (let t = 0; t < tris.length; t += 3)
        for (const [a, c] of [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]]) {
          const before = Math.hypot(plain.positions[a * 3] - plain.positions[c * 3], plain.positions[a * 3 + 1] - plain.positions[c * 3 + 1], plain.positions[a * 3 + 2] - plain.positions[c * 3 + 2])
          const after = Math.hypot(s.positions[a * 3] - s.positions[c * 3], s.positions[a * 3 + 1] - s.positions[c * 3 + 1], s.positions[a * 3 + 2] - s.positions[c * 3 + 2])
          if (before > 0.002) worst = Math.max(worst, after / before)
        }
      expect(worst, id).toBeLessThan(1.8)
    }
  })

  it('bends the rest pose for posture and pelvis tilt, and not at all when upright', () => {
    expect(postureTurns({ posture: 'upright' })).toEqual({})
    const stoop = postureTurns({ posture: 'stoop' })
    expect(stoop.Spine2).toBeGreaterThan(5)
    const tilt = postureTurns({ pelvisTilt: 1 })
    expect(tilt.Hips).toBeCloseTo(12)
    expect(tilt.Spine).toBeCloseTo(-9.6)
  })

  it('places every muscle helper inside the body, under its own skin', () => {
    const { base, skeleton } = bodies['m-medium']
    const s = shapeBody(base, [], N)
    for (const b of HELPER_BONES.filter((h) => h.kind === 'muscle')) {
      const g = girth(s, skeleton, b.place!.from, b.place!.to, b.place!.along, b.region!.bones)
      expect(g, b.name).toBeGreaterThan(0.02)
      expect(g, b.name).toBeLessThan(0.3)
    }
  })

  it('sculpts the same body every time', () => {
    const p = PRESETS.find((a) => a.id === 'powerhouse')!.dials
    const a = shaped('m-medium', p).positions
    const b = shaped('m-medium', p).positions
    expect(moved(a, b).most).toBe(0)
  })

  it('moves positions only through sculptVolume, in place', () => {
    const { base, skeleton } = bodies['m-medium']
    const s = shapeBody(base, [], N)
    const pos = Float32Array.from(s.positions)
    sculptVolume(s, skeleton, { ...N, waist: 0 }, 'm', pos)
    expect(moved(pos, s.positions).most).toBeGreaterThan(0)
  })
})
