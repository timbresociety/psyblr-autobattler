import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { initialCoverHealth, type CoverPiece } from '../engine/cover.js'
import { OCCLUDED_LAYER, occluded, setOccluded, sightHealth } from './occlusion.js'

const block = (x: number, z: number, hx: number, hz: number, base: number, top: number, look: CoverPiece['look'] = 'grey'): CoverPiece => ({ shape: { kind: 'block', x, z, hx, hz }, base, top, look })

describe('occlusion by zone and level (GAME.md §10)', () => {
  const deck = block(0, 0, 10, 10, 4, 4.5)
  const wall = block(0, 5, 6, 0.5, 0, 4)
  const low = block(0, 5, 6, 0.5, 0, 1.2, 'barricade')
  const see = (pieces: CoverPiece[]) => sightHealth(pieces, initialCoverHealth(pieces))

  it('a hero in the open is drawn', () => {
    expect(occluded({ x: 0, y: 3, z: -10 }, { x: 0, y: 0, z: 10 }, 1.8, [], [])).toBe(false)
  })

  it('a hero on the deck is hidden from under it, and drawn from beside it', () => {
    const pieces = [deck]
    expect(occluded({ x: 2, y: 1.7, z: 1 }, { x: -3, y: 4.5, z: 4 }, 1.8, pieces, see(pieces))).toBe(true)
    expect(occluded({ x: 20, y: 6, z: 0 }, { x: -3, y: 4.5, z: 4 }, 1.8, pieces, see(pieces))).toBe(false)
  })

  it('a hero behind a wall is hidden; over a low barricade its head shows, so it is drawn', () => {
    expect(occluded({ x: 0, y: 1.7, z: -5 }, { x: 0, y: 0, z: 9 }, 1.8, [wall], see([wall]))).toBe(true)
    expect(occluded({ x: 0, y: 1.7, z: -5 }, { x: 0, y: 0, z: 9 }, 1.8, [low], see([low]))).toBe(false)
  })

  it('glass hides nobody, nor does a piece the camera has been pushed into', () => {
    const glass = { ...wall, look: 'glass' as const }
    expect(occluded({ x: 0, y: 1.7, z: -5 }, { x: 0, y: 0, z: 9 }, 1.8, [glass], see([glass]))).toBe(false)
    expect(occluded({ x: 0, y: 1.7, z: 5 }, { x: 0, y: 0, z: 9 }, 1.8, [wall], see([wall]))).toBe(false)
  })

  it('a broken wall hides nobody', () => {
    const health = see([wall])
    health[0] = 0
    expect(occluded({ x: 0, y: 1.7, z: -5 }, { x: 0, y: 0, z: 9 }, 1.8, [wall], health)).toBe(false)
  })

  it('a hidden hero leaves the camera for the shadow layer, and comes back whole', () => {
    const root = new THREE.Group().add(new THREE.Mesh(), new THREE.Group().add(new THREE.Mesh()))
    const camera = new THREE.PerspectiveCamera()
    setOccluded(root, true)
    root.traverse((o) => expect(o.layers.test(camera.layers)).toBe(false))
    root.traverse((o) => expect(o.layers.isEnabled(OCCLUDED_LAYER)).toBe(true))
    setOccluded(root, false)
    root.traverse((o) => expect(o.layers.test(camera.layers)).toBe(true))
  })
})
