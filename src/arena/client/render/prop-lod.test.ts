import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PROP_REACH, PropLod, propLods } from './prop-lod.js'

function rubble(xs: number[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), xs.length)
  xs.forEach((x, i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, 0)))
  mesh.name = 'rubble'
  return mesh
}

describe('distance LOD on props (GAME.md §10)', () => {
  it(`draws only the rubble within ${PROP_REACH} m of the camera, and each again as the camera comes near it`, () => {
    const mesh = rubble([0, 10, 40, 60, 100])
    const lod = new PropLod(mesh)
    expect(lod.update(new THREE.Vector3(0, 2, 0))).toBe(3)
    const m = new THREE.Matrix4()
    const xs = Array.from({ length: mesh.count }, (_v, i) => (mesh.getMatrixAt(i, m), new THREE.Vector3().setFromMatrixPosition(m).x))
    expect(xs.sort((a, b) => a - b)).toEqual([0, 10, 40])
    expect(lod.update(new THREE.Vector3(100, 2, 0))).toBe(2)
    expect(lod.update(new THREE.Vector3(50, 2, 0))).toBe(3)
  })

  it('a small camera move keeps the sort; the bounds cover every rock', () => {
    const mesh = rubble([0, 60])
    const lod = new PropLod(mesh)
    lod.update(new THREE.Vector3(0, 0, 0))
    expect(mesh.count).toBe(1)
    expect(lod.update(new THREE.Vector3(1.5, 0, 0))).toBe(1)
    expect(lod.update(new THREE.Vector3(15.5, 0, 0))).toBe(2)
    expect(mesh.boundingSphere!.radius).toBeGreaterThan(29)
  })

  it('finds the rubble in a scene, placed where its parent puts it', () => {
    const group = new THREE.Group()
    group.position.x = 200
    group.add(rubble([0]), new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1))
    const lods = propLods(group)
    expect(lods).toHaveLength(1)
    expect(lods[0].update(new THREE.Vector3(200, 0, 0))).toBe(1)
    expect(lods[0].update(new THREE.Vector3(0, 0, 0))).toBe(0)
  })
})
