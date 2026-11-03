import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { HeroLod, LOD, POSE_EVERY, lodReady, simplified, tierAt, tiersFor } from './lod.js'

const tris = (g: THREE.BufferGeometry) => g.index!.count / 3

/** A stand-in hero: a body, an outfit and a head of thousands of triangles, small parts in the mouth, and a hat. */
function hero() {
  const root = new THREE.Group()
  const add = (name: string, geometry: THREE.BufferGeometry, shadow = true) => {
    const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    m.name = name
    m.castShadow = shadow
    root.add(m)
    return m
  }
  const body = add('hero', new THREE.SphereGeometry(1, 128, 64))
  const outfit = add('outfit', new THREE.CylinderGeometry(1, 1, 2, 96, 48))
  const head = add('head', new THREE.SphereGeometry(0.3, 96, 48))
  const teeth = add('teeth:upper', new THREE.TorusGeometry(0.1, 0.02, 24, 64), false)
  const eye = add('sclera', new THREE.SphereGeometry(0.012, 64, 24), false)
  const hat = add('wizard_hat_1', new THREE.ConeGeometry(0.3, 0.6, 24, 4))
  return { root, body, outfit, head, teeth, eye, hat }
}

describe('character levels of detail (GAME.md §10)', () => {
  beforeAll(() => lodReady())

  it('near to 15 m, mid to 40, far to 120, a card beyond', () => {
    expect([5, 15, 16, 40, 41, 120, 121].map((d) => tierAt(d))).toEqual(['near', 'near', 'mid', 'mid', 'far', 'far', 'impostor'])
    expect(POSE_EVERY).toEqual({ near: 1, mid: 2, far: 4, impostor: 0 })
  })

  it('a hero on the line keeps its tier until it is clearly past it; coming closer changes at once', () => {
    expect(tierAt(16, 'near')).toBe('near')
    expect(tierAt(15 + LOD.margin + 0.1, 'near')).toBe('mid')
    expect(tierAt(14, 'mid')).toBe('near')
    // a camera cut far away skips straight past the tiers between
    expect(tierAt(200, 'near')).toBe('impostor')
  })

  it('at most ten heroes near at once, the closest; the rest are drawn mid', () => {
    const d = Array.from({ length: 14 }, (_v, i) => 14 - i * 0.5)
    const tiers = tiersFor(d)
    expect(tiers.filter((t) => t === 'near')).toHaveLength(LOD.nearCap)
    // the four farthest of the fourteen are the ones dropped
    expect(tiers.slice(0, 4)).toEqual(['mid', 'mid', 'mid', 'mid'])
  })

  it('a simplified mesh keeps its vertices and face shapes and drops triangles, group by group', () => {
    const g = new THREE.SphereGeometry(1, 64, 32)
    g.morphAttributes.position = [g.attributes.position.clone()]
    g.addGroup(0, 3000, 0)
    g.addGroup(3000, g.index!.count - 3000, 1)
    const s = simplified(g, 0.1)
    expect(s.attributes.position).toBe(g.attributes.position)
    expect(s.morphAttributes.position?.[0]).toBe(g.morphAttributes.position[0])
    expect(tris(s)).toBeLessThan(tris(g) * 0.15)
    expect(s.groups.map((x) => x.materialIndex)).toEqual([0, 1])
    expect(s.groups[1].start).toBe(s.groups[0].count)
  })

  it('a hero comes to its tier budget, hides its small parts, casts no shadow far off, and is whole again near', () => {
    const h = hero()
    const lod = new HeroLod(h.root)
    const whole = lod.drawn()
    const hat = h.hat.geometry
    expect(whole).toBeGreaterThan(30000)
    lod.prepare()
    lod.apply('mid')
    expect(lod.drawn()).toBeLessThan(LOD.triangles.mid * 1.15)
    expect(h.teeth.visible).toBe(false)
    // the hat is small: drawn whole, its outline intact
    expect(h.hat.geometry).toBe(hat)
    expect(h.body.castShadow).toBe(true)
    lod.apply('far')
    expect(lod.drawn()).toBeLessThan(LOD.triangles.far * 1.15)
    expect(h.body.castShadow || h.outfit.castShadow || h.hat.castShadow).toBe(false)
    lod.apply('impostor')
    expect(lod.drawn()).toBe(0)
    lod.apply('near', true)
    expect(lod.drawn()).toBe(whole)
    expect(h.teeth.visible && h.body.castShadow && h.hat.castShadow).toBe(true)
    expect(h.teeth.castShadow).toBe(false)
  })

  it("near but past arm's length: the body whole, the mouth hidden, the eyes rougher, the gear casting no shadow", () => {
    const h = hero()
    const lod = new HeroLod(h.root)
    const eye = h.eye.geometry
    const body = h.body.geometry
    lod.prepare()
    lod.apply('near')
    expect(h.body.geometry).toBe(body)
    expect(h.teeth.visible).toBe(false)
    expect(tris(h.eye.geometry)).toBeLessThan(tris(eye) * 0.3)
    expect(h.hat.castShadow).toBe(false)
    expect(h.body.castShadow).toBe(true)
    lod.apply('near', true)
    expect(h.eye.geometry).toBe(eye)
    expect(h.teeth.visible && h.hat.castShadow).toBe(true)
  })
})
