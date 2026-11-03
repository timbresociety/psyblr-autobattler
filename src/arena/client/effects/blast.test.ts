import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { HOUSE, LEVEL } from '../../engine/house.js'
import { initialCoverHealth } from '../../engine/cover.js'
import { groundUnder } from './anchors.js'
import { LAYERS, TIERS, createBlasts, detailAt, elementOf, feelAt, tierOf, type Feel } from './blast.js'
import { DEBRIS_BUDGET, DebrisPool } from './debris.js'
import { DECAL_BUDGET, Decals } from './decals.js'
import { Props, fracture, houseProps } from './props.js'

const match = { cover: { pieces: HOUSE, health: initialCoverHealth(HOUSE) } }
const floorAt = (p: { x: number; y: number; z: number }) => groundUnder(match, p)

describe('blasts (GAME.md §6b)', () => {
  it('five tiers by cause: light, heavy, combo finisher, spell, ultimate', () => {
    expect(tierOf('basic', false)).toBe('light')
    expect(tierOf('basic', false, { step: 1 })).toBe('light')
    expect(tierOf('basic', false, { step: 2 })).toBe('finisher')
    expect(tierOf('basic', false, { heavy: 0.6 })).toBe('heavy')
    expect(tierOf('basic', true)).toBe('heavy')
    expect(tierOf('active1', false)).toBe('spell')
    expect(tierOf('active2', true)).toBe('spell')
    expect(tierOf('ultimate', false)).toBe('ultimate')
    expect(tierOf('movement', true)).toBe('heavy')
  })

  it('every blast above a light hit is layered all six ways, and the feel grows with the tier', () => {
    expect(LAYERS).toEqual(['anticipation', 'ring', 'plume', 'debris', 'sparks', 'haze'])
    for (const t of ['finisher', 'spell', 'ultimate'] as const) expect(TIERS[t].layers).toEqual(LAYERS)
    // radial blur and speed lines on heavies and ultimates, the impact frame on ultimates only
    for (const t of ['heavy', 'finisher', 'ultimate'] as const) expect(TIERS[t].blur > 0 && TIERS[t].lines).toBe(true)
    expect(Object.entries(TIERS).filter(([, s]) => s.impactFrame).map(([t]) => t)).toEqual(['ultimate'])
    // craters where heavies and ultimates land
    expect(TIERS.heavy.crater && TIERS.ultimate.crater && !TIERS.light.crater).toBe(true)
    const order = ['light', 'heavy', 'finisher', 'ultimate'] as const
    for (let i = 1; i < order.length; i++) {
      expect(TIERS[order[i]].stop).toBeGreaterThan(TIERS[order[i - 1]].stop)
      expect(TIERS[order[i]].shake).toBeGreaterThan(TIERS[order[i - 1]].shake)
    }
  })

  it('a spell leaves its element on the floor', () => {
    expect(elementOf(['ice', 'ray'])).toBe('frost')
    expect(elementOf(['fireball', 'fire'])).toBe('scorch')
    expect(elementOf(['poison', 'cloud'])).toBe('acid')
    expect(elementOf(['lightning'])).toBe('char')
    expect(elementOf(['shadow', 'bolt'])).toBe('void')
    expect(elementOf(['holy'])).toBe('holy')
    expect(elementOf(['earth', 'quake'])).toBe('crater')
    expect(elementOf(['arcane'])).toBe('scorch')
  })

  it('an ultimate on the house floor: the feel fires once, debris flies, a crater and its element lie on the floor', () => {
    const debris = new DebrisPool(floorAt)
    const decals = new Decals(floorAt)
    const felt: Feel[] = []
    const tasks: (() => void)[] = []
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, LEVEL.main + 10, -20)
    const blast = createBlasts({ flash: () => {}, sparkle: () => {}, puff: () => {}, show: (_k, _c, _d, place, update) => {
      const m = new THREE.Mesh()
      place(m)
      update(0.5, m)
    }, later: (_s, fn) => tasks.push(fn), floorAt, camera: () => camera, debris, decals, clock: () => 0, feel: (f) => felt.push(f) })
    blast('ultimate', new THREE.Vector3(20, LEVEL.main + 0.5, -10), new THREE.Color(1, 0.5, 0.2), { radius: 4, mark: 'scorch' })
    while (tasks.length) tasks.shift()!()
    expect(felt).toHaveLength(1)
    expect(felt[0].impactFrame).toBe(true)
    expect(debris.live()).toBeGreaterThan(20)
    expect(decals.live()).toBe(2)
    // the chunks land on the main floor, not at y 0
    for (let i = 0; i < 240; i++) debris.step(1 / 60)
    const p = new THREE.Vector3()
    const m = new THREE.Matrix4()
    let low = Infinity
    for (let i = 0; i < debris.mesh.count; i++) {
      debris.mesh.getMatrixAt(i, m)
      p.setFromMatrixPosition(m)
      if (m.elements[0] !== 0) low = Math.min(low, p.y)
    }
    expect(low).toBeGreaterThan(LEVEL.main - 0.01)
  })

  it('the hit feel is for blasts near the camera: a brawl across the map neither shakes nor blurs this view', () => {
    const near = feelAt(TIERS.ultimate, 8, true)
    expect(near.blur).toBe(TIERS.ultimate.blur)
    expect(near.impactFrame && near.lines).toBe(true)
    expect(near.stop).toBe(TIERS.ultimate.stop)
    const far = feelAt(TIERS.ultimate, 60, true)
    expect(far.shake + far.kick + far.blur + far.stop).toBe(0)
    expect(far.lines || far.impactFrame).toBe(false)
    // close behind the camera: felt (shake, stop) but nothing drawn toward it
    const behind = feelAt(TIERS.heavy, 5, false)
    expect(behind.shake).toBeGreaterThan(0)
    expect(behind.blur).toBe(0)
    expect(behind.lines).toBe(false)
  })

  it('effects thin with distance from the camera', () => {
    expect(detailAt(10)).toBe(1)
    expect(detailAt(60)).toBeLessThan(1)
    expect(detailAt(500)).toBeCloseTo(0.33)
  })
})

describe('the MacBook Air budget (§6b)', () => {
  it('never more than 300 debris chunks or 64 decals alive, the oldest giving way', () => {
    expect(DEBRIS_BUDGET).toBe(300)
    expect(DECAL_BUDGET).toBe(64)
    const debris = new DebrisPool(() => 0)
    for (let k = 0; k < 40; k++) debris.throw({ at: { x: 0, y: 1, z: 0 }, count: 20, speed: 3, up: 3, size: [0.1, 0.2], color: new THREE.Color(), life: 10 })
    expect(debris.live()).toBe(300)
    const decals = new Decals(() => 0)
    for (let k = 0; k < 200; k++) decals.place('crater', { x: k, y: 0, z: 0 }, 1, k * 0.01)
    expect(decals.live()).toBe(64)
    // marks drawn alike are one instanced draw, however many lie on the floor
    const kinds = ['crater', 'scorch', 'frost', 'acid', 'char', 'void', 'holy', 'skid'] as const
    for (let k = 0; k < 64; k++) decals.place(kinds[k % kinds.length], { x: k * 3, y: 0, z: 5 }, 1, 2 + k * 0.01)
    expect(decals.live()).toBe(64)
    expect(decals.draws()).toBe(6)
    // blows on one spot deepen the crater already there instead of spending the budget
    const spot = new Decals(() => 0)
    for (let k = 0; k < 50; k++) spot.place('crater', { x: 0.1 * (k % 3), y: 0, z: 0 }, 1.3, k * 0.1)
    expect(spot.live()).toBe(1)
    spot.place('scorch', { x: 0, y: 0, z: 0 }, 1.3, 5)
    expect(spot.live()).toBe(2)
    // and they fade: long after, nothing is left
    for (let i = 0; i < 60 * 20; i++) debris.step(1 / 60)
    decals.step(100)
    expect(debris.live()).toBe(0)
    expect(decals.live()).toBe(0)
  })
})

describe('breakable props (§6b)', () => {
  const props = houseProps(floorAt)

  it('the house is dressed with every kind of breakable, each standing on a floor', () => {
    const kinds = new Set(props.map((p) => p.kind))
    for (const k of ['chips', 'card', 'dice', 'capsule', 'panel', 'sign', 'railing'] as const) expect(kinds.has(k), k).toBe(true)
    for (const p of props) {
      const bottom = Math.min(...p.parts.map((q) => q.at.y - q.size.y / 2))
      const floor = floorAt({ x: p.parts[0].at.x, y: bottom + 0.05, z: p.parts[0].at.z })
      // on its floor, or (a cabinet panel) on a machine's face
      if (p.kind !== 'panel') expect(Math.abs(bottom - floor), `${p.kind} at ${p.centre.toArray()}`).toBeLessThan(0.05)
    }
  })

  it('pre-fractured: a blast hides the prop and throws its own chunks, cut ahead of time', () => {
    const fresh = new Props(houseProps(floorAt))
    const debris = new DebrisPool(floorAt)
    const panel = fresh.props.find((p) => p.kind === 'panel')!
    const chunks = panel.chunks.length
    expect(chunks).toBeGreaterThan(3)
    const before = fresh.standing()
    expect(fresh.blast(panel.centre, 0.5, debris)).toBeGreaterThanOrEqual(1)
    expect(panel.broken).toBe(true)
    expect(fresh.standing()).toBeLessThan(before)
    expect(debris.live()).toBeGreaterThanOrEqual(chunks)
    // the chunks are the same ones it was cut into
    expect(panel.chunks).toHaveLength(chunks)
  })

  it('a body knocked into a sturdy prop breaks it; walking past only scatters the loose things', () => {
    const fresh = new Props(houseProps(floorAt))
    const debris = new DebrisPool(floorAt)
    const sign = fresh.props.find((p) => p.kind === 'sign')!
    const feet = { x: sign.centre.x, y: LEVEL.main, z: sign.centre.z }
    expect(fresh.body(feet, 0.4, 1.8, false, debris)).toBe(0)
    expect(sign.broken).toBe(false)
    expect(fresh.body(feet, 0.4, 1.8, true, debris)).toBeGreaterThanOrEqual(1)
    expect(sign.broken).toBe(true)
    const capsule = fresh.props.find((p) => p.kind === 'capsule')!
    expect(fresh.body({ x: capsule.centre.x, y: LEVEL.main, z: capsule.centre.z }, 0.4, 1.8, false, debris)).toBeGreaterThanOrEqual(1)
  })

  it("the engine's glass and card bridges break into their own pre-cut pieces, glass in smaller shards", () => {
    const glass = HOUSE.find((p) => p.look === 'glass')!
    const card = HOUSE.find((p) => p.look === 'card')!
    const shards = fracture(glass)
    const planks = fracture(card)
    expect(shards.length).toBeGreaterThan(4)
    expect(planks.length).toBeLessThanOrEqual(40)
    const vol = (c: { size: { x: number; y: number; z: number } }) => c.size.x * c.size.y * c.size.z
    expect(Math.max(...shards.map(vol))).toBeLessThan(Math.max(...planks.map(vol)))
    // glass flies as thin pane shards, not blocks
    for (const c of shards) expect(Math.min(c.size.x, c.size.z)).toBeLessThanOrEqual(0.05)
    // the same cut every time: nothing is fractured at runtime
    expect(fracture(glass, 3)).toEqual(fracture(glass, 3))
  })
})
