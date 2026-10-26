import * as THREE from 'three'
import { GEAR_SLOTS, type GearSlot } from '../../charter/look.js'
import type { Gltf } from './character-look.js'

/**
 * Rigid pieces on a body: each is its own small model (public/kit/pieces/ or a player's generated one), hung on a
 * socket the Blender pipeline placed on the body's bones (tools/blender/humanlib/sockets.py). The piece follows every
 * clip through its bone, so nothing is rigged per piece, and any piece fits any body. Loading lives with the rest of
 * the wardrobe (wear/items.ts).
 */

type Vec3 = [number, number, number]

/** Where a socket sits in the body's rest pose (glTF axes): its point, the piece's up and front, and its scale. */
export interface BodySocket {
  bone: string
  pos: Vec3
  /** The piece's +y (a blade's length runs along the thumb); straight up when absent. */
  up?: Vec3
  /** The piece's +z (a blade's edge faces the fingertips); the hero's front when absent. */
  fwd?: Vec3
  /** Head and face pieces scale to the body's head. */
  scale?: number
}
export type BodySockets = Partial<Record<GearSlot, BodySocket>>

/** A socket's rest transform in the body's scene space. */
export function socketMatrix(s: BodySocket): THREE.Matrix4 {
  const up = new THREE.Vector3(...(s.up ?? [0, 1, 0])).normalize()
  const fwd = new THREE.Vector3(...(s.fwd ?? [0, 0, 1]))
  const x = new THREE.Vector3().crossVectors(up, fwd).normalize()
  const z = new THREE.Vector3().crossVectors(x, up)
  const m = new THREE.Matrix4().makeBasis(x, up, z)
  m.scale(new THREE.Vector3().setScalar(s.scale ?? 1))
  return m.setPosition(...s.pos)
}

function skinnedMesh(model: THREE.Object3D): THREE.SkinnedMesh | undefined {
  let found: THREE.SkinnedMesh | undefined
  model.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh
  })
  return found
}

/**
 * An empty for each socket, parented to its bone at the socket's rest place. The skeleton's inverse bind matrices
 * take the rest pose into each bone's own space, so this works whatever pose the model is in when it's called.
 */
export function hangSockets(model: THREE.Object3D, sockets: BodySockets): Partial<Record<GearSlot, THREE.Object3D>> {
  const mesh = skinnedMesh(model)
  const out: Partial<Record<GearSlot, THREE.Object3D>> = {}
  if (!mesh) return out
  const { bones, boneInverses } = mesh.skeleton
  for (const slot of GEAR_SLOTS) {
    const s = sockets[slot]
    const i = s ? bones.findIndex((b) => b.name === s.bone) : -1
    if (!s || i < 0) continue
    const socket = new THREE.Object3D()
    socket.name = `socket:${slot}`
    boneInverses[i].clone().multiply(socketMatrix(s)).decompose(socket.position, socket.quaternion, socket.scale)
    bones[i].add(socket)
    out[slot] = socket
  }
  return out
}

/** A piece's materials with its 'primary' one in the player's colour (a glowing one glows in it too). */
export function tinted(material: THREE.Material, color: string): THREE.Material {
  if (!/^primary/.test(material.name)) return material
  const m = material.clone() as THREE.MeshStandardMaterial
  m.color?.setStyle(color, THREE.SRGBColorSpace)
  if (m.emissive && m.emissive.getHex() !== 0) m.emissive.setStyle(color, THREE.SRGBColorSpace)
  return m
}

/** A rigid piece to hang: the node name it takes, the socket it goes in, its model, and its primary colour. */
export interface Piece {
  name: string
  socket: GearSlot
  file: Gltf
  color?: string
}

/** Hang each piece on its socket. Pieces share their geometry with the loaded file; tinted materials are copies. */
export function hangPieces(model: THREE.Object3D, pieces: readonly Piece[], sockets: BodySockets): THREE.Object3D[] {
  if (!pieces.length) return []
  const hung = hangSockets(model, sockets)
  const worn: THREE.Object3D[] = []
  for (const piece of pieces) {
    const socket = hung[piece.socket]
    if (!socket) continue
    const obj = piece.file.scene.clone(true)
    obj.name = `gear:${piece.name}`
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      if (piece.color) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => tinted(m, piece.color!)) : tinted(mesh.material, piece.color)
    })
    socket.add(obj)
    worn.push(obj)
  }
  return worn
}
