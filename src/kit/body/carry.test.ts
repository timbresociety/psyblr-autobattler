import { beforeAll, describe, expect, it } from 'vitest'
import { CARRY_SLOTS } from '../rig/metarig.js'
import { carrySockets, CLEARANCE, type CarrySockets } from './carry.js'
import { readBody, type BodyFile } from './node.js'
import { presetDials, type ArchetypeId } from './physique.js'
import { bodyBase, shapeBody, type BodyShape } from './shape.js'

const BODIES = ['m', 'f'].flatMap((g) => ['tiny', 'small', 'medium', 'large', 'huge', 'colossal'].map((s) => `${g}-${s}`))
const bodies: { name: string; file: BodyFile; shape: BodyShape; slots: CarrySockets }[] = []

beforeAll(async () => {
  for (const name of BODIES) {
    const file = await readBody(new URL(`../../../public/heroes/v2/${name}.glb`, import.meta.url))
    const shape = shapeBody(bodyBase(file), [], { weight: 0.5, muscle: 0.5, age: 0 })
    bodies.push({ name, file, shape, slots: carrySockets(shape, { bones: file.bones, rest: file.rest }) })
  }
}, 60_000)

/** The nearest skin to a point, in metres. */
function nearest(shape: BodyShape, p: readonly number[]) {
  let best = Infinity
  const q = shape.positions
  for (let i = 0; i < q.length; i += 3) best = Math.min(best, Math.hypot(q[i] - p[0], q[i + 1] - p[1], q[i + 2] - p[2]))
  return best
}

describe('carry slots on every body (GAME.md §4)', () => {
  it('puts every slot just off the skin, never inside it or floating away', () => {
    for (const { name, shape, slots } of bodies) {
      for (const slot of CARRY_SLOTS) {
        const gap = nearest(shape, slots[slot].pos)
        const most = slot === 'back_flat' ? CLEARANCE + 0.09 : CLEARANCE + 0.02
        expect(gap, `${name} ${slot}`).toBeGreaterThan(CLEARANCE * 0.6)
        expect(gap, `${name} ${slot}`).toBeLessThan(most)
      }
    }
  })

  it('keeps each slot on its side and at its height', () => {
    for (const { name, file, slots } of bodies) {
      const r = file.rest
      expect(slots.back_r.pos[2], name).toBeLessThan(r.Spine2[2])
      expect(slots.lower_back.pos[2], name).toBeLessThan(r.Hips[2])
      expect(slots.back_flat.pos[2], name).toBeLessThan(slots.back_r.pos[2])
      // +x is the hero's left
      expect(slots.hip_l.pos[0], name).toBeGreaterThan(r.LeftUpLeg[0])
      expect(slots.hip_r.pos[0], name).toBeLessThan(r.RightUpLeg[0])
      expect(slots.thigh_l.pos[0], name).toBeGreaterThan(r.LeftUpLeg[0])
      expect(slots.thigh_r.pos[0], name).toBeLessThan(r.RightUpLeg[0])
      expect(slots.thigh_l.pos[1], name).toBeLessThan(slots.hip_l.pos[1])
      expect(slots.thigh_l.pos[1], name).toBeGreaterThan(r.LeftLeg[1])
      expect(slots.lower_back.pos[1], name).toBeLessThan(slots.back_r.pos[1])
      // the diagonals lean their grips over the shoulder they're named for
      expect(slots.back_r.up[0], name).toBeLessThan(0)
      expect(slots.back_l.up[0], name).toBeGreaterThan(0)
    }
  })

  it('follows the physique: a heavy build carries further out than a lean one on the same body', () => {
    const { file } = bodies.find((b) => b.name === 'm-medium')!
    const skeleton = { bones: file.bones, rest: file.rest }
    const built = (id: ArchetypeId) => carrySockets(shapeBody(bodyBase(file), [], presetDials(id), undefined, { skeleton, gender: 'm' }), skeleton)
    const lean = built('slender')
    const heavy = built('heavyweight')
    expect(heavy.hip_l.pos[0]).toBeGreaterThan(lean.hip_l.pos[0] + 0.01)
    expect(heavy.lower_back.pos[2]).toBeLessThan(lean.lower_back.pos[2] - 0.01)
    expect(heavy.thigh_r.pos[0]).toBeLessThan(lean.thigh_r.pos[0])
  })
})
