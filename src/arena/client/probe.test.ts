import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { at, heroFacts, look, report, type ProbeTarget } from './probe.js'

/** A hero standing behind a low crate, seen from eye height: the crate hides its legs, nothing hides its head. */
function crateScene(): ProbeTarget {
  const scene = new THREE.Scene()
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial())
  ground.name = 'ground'
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 1).translate(0, 0.3, 0), new THREE.MeshBasicMaterial())
  crate.name = 'crate'
  crate.position.set(0, 0, 2)
  const hero = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4).translate(0, 0.9, 0), new THREE.MeshBasicMaterial())
  body.name = 'body'
  hero.add(body)
  const rival = new THREE.Group()
  rival.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.4).translate(0, 0.9, 0), new THREE.MeshBasicMaterial()))
  rival.position.set(3, 2, -1)
  scene.add(ground, crate, hero, rival)
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100)
  camera.position.set(0, 1.2, 6)
  camera.lookAt(0, 0.9, 0)
  return {
    scene,
    camera,
    heroes: () => [
      { root: hero, name: 'Modi', team: 0, alive: true },
      { root: rival, name: 'Musk', team: 1, alive: true },
    ],
  }
}

describe('the dev probe', () => {
  it('sees the hero in the middle of the picture, the ground below it and nothing above', () => {
    const view = look(crateScene(), 9, 9)
    const cell = (r: number, c: number) => view.cells[r * 9 + c]
    expect(cell(4, 4)).toMatchObject({ hero: 'Modi', part: 'body' })
    expect(cell(8, 4)?.part).toBe('ground')
    expect(cell(0, 4)).toBeUndefined()
  })

  it('lists everything under a point, nearest first', () => {
    const hits = at(crateScene(), 0.5, 0.5)
    expect(hits[0]).toMatchObject({ hero: 'Modi', part: 'body' })
    expect(hits.at(-1)?.part).toBe('ground')
    expect(hits[0].distance).toBeLessThan(hits.at(-1)!.distance)
  })

  it('says how much of a hero shows, what covers it, how high it stands and whether its enemy is in sight', () => {
    const [modi, musk] = heroFacts(crateScene())
    expect(modi.visible).toBeGreaterThan(0.5)
    expect(modi.visible).toBeLessThan(1)
    expect(modi.coveredBy).toEqual(['crate'])
    expect(modi.altitude).toBeCloseTo(0, 5)
    expect(modi.nearestEnemy).toEqual({ name: 'Musk', distance: expect.closeTo(3.74, 1), inSight: true })
    // the rival floats 2 m over the ground
    expect(musk.altitude).toBeCloseTo(2, 5)
  })

  it('looks through glows and barriers, and says what they tint', () => {
    const target = crateScene()
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }))
    glow.name = 'barrier'
    glow.position.set(0, 1, 1)
    target.scene.add(glow)
    expect(look(target, 9, 9).cells[4 * 9 + 4]).toMatchObject({ hero: 'Modi' })
    expect(look(target, 9, 9).veils.barrier).toBeGreaterThan(0)
    expect(heroFacts(target)[0].coveredBy).toEqual(['crate'])
  })

  it('reads a skinned mesh where its bones put it, not where it was bound', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const n = geometry.getAttribute('position').count
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [1, 0, 0, 0]).flat(), 4))
    const arm = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
    arm.name = 'arm'
    const bone = new THREE.Bone()
    arm.add(bone)
    arm.bind(new THREE.Skeleton([bone]))
    bone.position.set(3, 0, 0)
    const scene = new THREE.Scene()
    scene.add(arm)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(3, 0, 10)
    camera.lookAt(3, 0, 0)
    expect(at({ scene, camera }, 0.5, 0.5)[0]?.part).toBe('arm')
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    expect(at({ scene, camera }, 0.5, 0.5)).toEqual([])
  })

  it('writes the picture and the heroes as one text, the crate as a mark and the heroes as letters', () => {
    const text = report(crateScene(), 9, 9)
    expect(text).toMatch(/^camera at \(0\.0, 1\.2, 6\.0\), heading -?180°/)
    expect(text).toContain('A Modi')
    expect(text).toContain('a Musk')
    expect(text).toMatch(/covered by crate/)
    expect(text.split('\n').slice(2, 11).every((row) => row.length === 9)).toBe(true)
  })
})
