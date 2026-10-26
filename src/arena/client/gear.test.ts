import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { hangSockets, socketMatrix, wearGear, type BodySockets } from './gear.js'

/** A one-bone skinned body whose bone sits at (0, 1, 0) at rest. */
function body() {
  const bone = new THREE.Bone()
  bone.name = 'hand_R'
  bone.position.set(0, 1, 0)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial())
  const root = new THREE.Group()
  root.add(bone, mesh)
  root.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton([bone]))
  return { root, bone }
}

const sockets: BodySockets = { hand_r: { bone: 'hand_R', pos: [0.1, 1.2, 0.3], up: [1, 0, 0], fwd: [0, 0, 1] } }

describe('gear on a body', () => {
  it("a socket's frame puts the piece's length along its up and its edge along its front", () => {
    const m = socketMatrix({ bone: 'b', pos: [1, 2, 3], up: [1, 0, 0], fwd: [0, 0, 1], scale: 2 })
    const tip = new THREE.Vector3(0, 1, 0).applyMatrix4(m)
    expect(tip.toArray().map((v) => +v.toFixed(5))).toEqual([3, 2, 3])
    const edge = new THREE.Vector3(0, 0, 1).applyMatrix4(m)
    expect(edge.toArray().map((v) => +v.toFixed(5))).toEqual([1, 2, 5])
  })

  it('hangs a socket at its rest place even on a posed body, and it follows the bone', () => {
    const { root, bone } = body()
    // pose the body first: the socket still lands where it would have at rest, carried by the bone's turn
    bone.rotation.z = Math.PI / 2
    root.updateMatrixWorld(true)
    const socket = hangSockets(root, sockets).hand_r!
    root.updateMatrixWorld(true)
    const at = new THREE.Vector3().setFromMatrixPosition(socket.matrixWorld)
    // rest offset from the bone (0.1, 0.2, 0.3), turned 90 degrees about z: (-0.2, 0.1, 0.3) from (0, 1, 0)
    expect(at.toArray().map((v) => +v.toFixed(5))).toEqual([-0.2, 1.1, 0.3])
  })

  it('wears a piece in its socket, its primary material in the chosen colour and the rest untouched', () => {
    const { root } = body()
    const primary = new THREE.MeshStandardMaterial({ name: 'primary', color: 0xff0000 })
    const steel = new THREE.MeshStandardMaterial({ name: 'steel' })
    const scene = new THREE.Group()
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), primary), new THREE.Mesh(new THREE.BufferGeometry(), steel))
    const [worn] = wearGear(root, { hand_r: { id: 'katana', url: '/kit/pieces/katana.glb', color: '#00ff00' } }, { sockets, files: new Map([['/kit/pieces/katana.glb', { scene, animations: [] }]]) })
    expect(worn.parent?.name).toBe('socket:hand_r')
    const [a, b] = worn.children as THREE.Mesh[]
    expect((a.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('00ff00')
    expect(primary.color.getHexString()).toBe('ff0000')
    expect(b.material).toBe(steel)
    expect(a.castShadow).toBe(true)
  })

  it('skips a slot whose piece did not load', () => {
    const { root } = body()
    expect(wearGear(root, { hand_r: { id: 'katana', url: '/kit/pieces/katana.glb' } }, { sockets, files: new Map() })).toEqual([])
  })
})
