import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { REST_AFTER, isResting, mayRest, setResting } from './rest.js'

/** A body: a root with a two-bone chain under it, in a scene. */
function body() {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  const hip = new THREE.Bone()
  const knee = new THREE.Bone()
  knee.position.set(0, -0.5, 0)
  hip.add(knee)
  root.add(hip)
  scene.add(root)
  root.position.set(3, 0, 4)
  scene.updateMatrixWorld()
  return { scene, root, hip, knee }
}

describe('bodies at rest (GAME.md §10)', () => {
  it('rests only a body dead long enough, still, its cloth hanging and its fallen body asleep', () => {
    expect(mayRest(REST_AFTER, 0, false)).toBe(true)
    expect(mayRest(REST_AFTER - 0.1, 0, false)).toBe(false)
    expect(mayRest(REST_AFTER, 0.05, false)).toBe(false)
    expect(mayRest(REST_AFTER, 0, true)).toBe(false)
    expect(mayRest(REST_AFTER, 0, false, false)).toBe(false)
  })

  it('a resting body keeps the matrices it lay with while the scene updates, and thaws again', () => {
    const { scene, root, hip, knee } = body()
    const lay = knee.matrixWorld.clone()
    setResting(root, true)
    expect(isResting(root)).toBe(true)
    // anything still writing to it is not drawn, and the scene's walk does not reach it
    hip.rotation.x = 1
    root.position.x = 9
    scene.updateMatrixWorld()
    expect(knee.matrixWorld.equals(lay)).toBe(true)
    // it can be asked to rest twice
    setResting(root, true)
    setResting(root, false)
    expect(isResting(root)).toBe(false)
    scene.updateMatrixWorld()
    expect(knee.matrixWorld.equals(lay)).toBe(false)
    expect(new THREE.Vector3().setFromMatrixPosition(root.matrixWorld).x).toBe(9)
  })

  it('freezes what it lay as at the moment it rests, even if the last frame had not been walked yet', () => {
    const { scene, root, knee } = body()
    root.position.set(-2, 0, 0)
    setResting(root, true)
    scene.updateMatrixWorld()
    expect(new THREE.Vector3().setFromMatrixPosition(knee.matrixWorld).toArray()).toEqual([-2, -0.5, 0])
  })
})
