import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { CoverPiece } from '../engine/cover.js'
import { bake } from './greybox.js'

/** A floor tile's top at (x, z), its colour all 1 before baking. */
function tile(x: number, z: number, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2).translate(x, y, z).toNonIndexed()
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3))
  return g
}
const light = (g: THREE.BufferGeometry) => g.getAttribute('color').getX(0)

describe('baked light on the grey box (GAME.md §10)', () => {
  const ground: CoverPiece = { shape: { kind: 'block', x: 0, z: 0, hx: 20, hz: 20 }, base: 0, top: 0.5, look: 'grey' }
  const deck: CoverPiece = { shape: { kind: 'block', x: 10, z: 0, hx: 4, hz: 4 }, base: 4, top: 4.5, look: 'grey' }
  const wall: CoverPiece = { shape: { kind: 'block', x: -10, z: 0, hx: 0.5, hz: 6 }, base: 0.5, top: 4, look: 'wall' }
  const pieces = [ground, deck, wall]

  it('an open floor keeps its colour; under a deck it is darker, but never black', () => {
    const open = tile(0, 0, 0.5)
    const under = tile(10, 0, 0.5)
    bake(open, pieces)
    bake(under, pieces)
    expect(light(open)).toBe(1)
    expect(light(under)).toBeLessThan(0.75)
    expect(light(under)).toBeGreaterThan(0.4)
  })

  it('a floor against a wall darkens where they meet', () => {
    const foot = tile(-9.3, 0, 0.5)
    bake(foot, pieces)
    expect(light(foot)).toBeLessThan(0.97)
  })
})
