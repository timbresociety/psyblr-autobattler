import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { makeRope } from './rope.js'

/** A thong modelled as a whip is: a thin tube hanging 0.88 m down -y from its grip at the origin, its pommel above. */
function whip() {
  const geometry = new THREE.CylinderGeometry(0.01, 0.01, 1, 6, 40).translate(0, -0.38, 0)
  const piece = new THREE.Group()
  piece.rotation.z = 0.3
  piece.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()))
  return piece
}

const skinOf = (piece: THREE.Object3D) => piece.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh
/** The thong's joints in the world: every bone after the handle's. */
const joints = (piece: THREE.Object3D) => {
  piece.updateMatrixWorld(true)
  return skinOf(piece).skeleton.bones.slice(1).map((b) => b.getWorldPosition(new THREE.Vector3()))
}

describe('a whip on a chain (rope physics)', () => {
  it('comes out of the hand on +y and lies coiled under its handle when put away', () => {
    const piece = whip()
    makeRope(piece)
    const at = joints(piece)
    expect(at[0].length()).toBeCloseTo(0.1, 3)
    // coiled: no joint further than the handle's end plus a loop's width
    for (const p of at) expect(p.distanceTo(at[0])).toBeLessThan(0.2)
  })

  it('hangs down from a still hand, every link at its length', () => {
    const scene = new THREE.Scene()
    const piece = whip()
    scene.add(piece)
    const rope = makeRope(piece)!
    rope.coil(false)
    for (let i = 0; i < 240; i++) rope.step(1 / 60)
    const at = joints(piece)
    const tip = at.at(-1)!
    expect(tip.y).toBeLessThan(at[0].y - 0.15)
    for (let k = 1; k < at.length; k++) expect(at[k].distanceTo(at[k - 1])).toBeCloseTo(0.78 / (at.length - 1), 2)
  })

  it('trails behind a hand that sweeps, and stays off the floor', () => {
    const scene = new THREE.Scene()
    const piece = whip()
    scene.add(piece)
    piece.position.y = 0.5
    const rope = makeRope(piece)!
    rope.coil(false)
    for (let i = 0; i < 120; i++) rope.step(1 / 60, 0)
    for (const p of joints(piece)) expect(p.y).toBeGreaterThanOrEqual(0.0099)
    for (let i = 0; i < 12; i++) {
      piece.position.x += 0.08
      rope.step(1 / 60, 0)
    }
    const at = joints(piece)
    expect(at.at(-1)!.x).toBeLessThan(at[0].x - 0.15)
  })
})
