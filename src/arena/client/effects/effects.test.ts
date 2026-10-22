import { describe, expect, it } from 'vitest'
import { capsule, createHero, prepareHero } from '../../engine/state'
import { defaultBuild } from '../../../sim/fixtures'
import { defaultRecipe } from '../../recipes/defaults'
import * as THREE from 'three'
import { baseSize, coneYaw, formScale, hitFeel, layerSize } from './sizing'
import { ring, take } from './ring'

describe('effect kit runtime (U14)', () => {
  it("draws a zone's damaging ring at exactly its radius, with glow outside it", () => {
    const recipe = defaultRecipe('zone')
    const base = baseSize({ radius: 4, range: 10 })
    const core = recipe.layers.find((l) => l.damaging)!
    expect(layerSize(core, base)).toBe(4)
    expect(layerSize({ size: 1.6 }, base)).toBeGreaterThan(4)
    expect(layerSize({ size: 1.6, damaging: true }, base)).toBe(4)
  })

  it("draws a beam's damaging core at exactly its width", () => {
    expect(2 * layerSize(defaultRecipe('beam').layers.find((l) => l.damaging)!, baseSize({ radius: 0, range: 16, width: 1.4 }))).toBeCloseTo(1.4)
  })

  it('covers AE6: a colossal form is scaled with the hero capsule', () => {
    const hero = createHero(prepareHero(defaultBuild('tank')), 0, 0, { x: 0, y: 0, z: 0 })
    const medium = capsule(hero).radius
    hero.size = 'colossal'
    expect(formScale('colossal')).toBeCloseTo(capsule(hero).radius / medium)
  })

  it('reuses its slots: 1,000 casts never grow the pool, and the oldest are overwritten first', () => {
    const r = ring(500)
    const starts = new Set<number>()
    for (let i = 0; i < 1000; i++) for (const [s, n] of take(r, 12)) for (let k = 0; k < n; k++) starts.add(s + k)
    expect(Math.max(...starts)).toBeLessThan(500)
    const r2 = ring(10)
    take(r2, 8)
    expect(take(r2, 5)).toEqual([[8, 2], [0, 3]])
  })

  it('lays a cone along the aim, not behind the caster', () => {
    for (const dir of [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: -0.6, z: -0.8 }]) {
      const o = new THREE.Object3D()
      o.rotation.set(-Math.PI / 2, 0, coneYaw(dir))
      o.updateMatrixWorld()
      const centre = new THREE.Vector3(0, 1, 0).applyMatrix4(o.matrixWorld)
      expect(centre.x).toBeCloseTo(dir.x)
      expect(centre.y).toBeCloseTo(0)
      expect(centre.z).toBeCloseTo(dir.z)
    }
  })

  it('freezes and shakes only on heavy hits', () => {
    expect(hitFeel({ type: 'hit', source: 0, target: 1, slot: 'basic', amount: 10, heavy: false }).hitStop).toBe(0)
    const heavy = hitFeel({ type: 'hit', source: 0, target: 1, slot: 'ultimate', amount: 400, heavy: true })
    expect(heavy.hitStop).toBeGreaterThan(0.04)
    expect(heavy.hitStop).toBeLessThan(0.09)
    expect(heavy.shake).toBeGreaterThan(0)
  })
})
