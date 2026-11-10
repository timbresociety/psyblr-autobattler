import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { rebuildSkeleton } from './rebind.js'

/** Hips, a spine, an arm hanging 45 degrees down on the left. */
function ours() {
  const bone = (name: string, x: number, y: number, parent?: THREE.Object3D) => {
    const b = new THREE.Bone()
    b.name = name
    b.position.set(x, y, 0)
    parent?.add(b)
    return b
  }
  const hips = bone('Hips', 0, 1)
  const spine = bone('Spine', 0, 0.5, hips)
  const arm = bone('LeftArm', 0.1, 0.2, spine)
  bone('LeftHand', 0.4, -0.4, arm)
  const root = new THREE.Group()
  root.add(hips)
  return root
}

const places = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true)
  const out: Record<string, number[]> = {}
  o.traverse((b) => b.name && (out[b.name] = b.getWorldPosition(new THREE.Vector3()).toArray().map((x) => +x.toFixed(4))))
  return out
}

describe('rebuildSkeleton', () => {
  it('leaves a mesh with our own joints exactly on our skeleton', () => {
    const reference = ours()
    const joints = new Map(Object.entries(places(reference)).map(([k, v]) => [k, new THREE.Vector3(...(v as [number, number, number]))]))
    expect(places(rebuildSkeleton(reference, joints).root)).toEqual(places(reference))
  })

  it('binds a mesh at its own pose and stands it at our rest on its own lengths', () => {
    const reference = ours()
    // the same hero with its arm out level, and twice as long
    const joints = new Map([['Hips', new THREE.Vector3(0, 1, 0)], ['Spine', new THREE.Vector3(0, 1.5, 0)], ['LeftArm', new THREE.Vector3(0.1, 1.7, 0)], ['LeftHand', new THREE.Vector3(0.1 + 0.8 * Math.SQRT2, 1.7, 0)]])
    const { root, bind } = rebuildSkeleton(reference, joints)
    const hand = places(root).LeftHand
    expect(hand[0]).toBeCloseTo(0.9, 3)
    expect(hand[1]).toBeCloseTo(0.9, 3)
    expect(new THREE.Vector3().setFromMatrixPosition(bind.get('LeftHand')!).x).toBeCloseTo(0.1 + 0.8 * Math.SQRT2, 3)
  })
})
