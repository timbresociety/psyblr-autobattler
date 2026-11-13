import * as THREE from 'three'
import { GEAR_SLOTS, type GearSlot } from '../../charter/look.js'
import type { Gltf } from './character-look.js'
import { measureFit, pieceFit } from './fit.js'

/**
 * Rigid pieces on a body: each is its own small model (public/kit/pieces/ or a player's generated one), hung on a
 * socket the Blender pipeline placed on the body's bones (tools/blender/humanlib/sockets.py). The piece follows every
 * clip through its bone, so nothing is rigged per piece, and any piece fits any body: a hand's socket is scaled to the
 * hand it is on (fit.ts). Loading lives in held.ts.
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

/** How far round a socket the body's surface counts toward where it moves, in metres. */
const SOCKET_REACH = 0.05

/**
 * Sockets moved with a hero's shape. The pipeline places them on the body as built, but a physique or a face moves the
 * surface under them: an older or heavier hero's head sits up to two centimetres lower, and a socket left where it was
 * floats glasses and hats above it. Each socket moves by how the surface within SOCKET_REACH of it moved, from the
 * built body's welded rest `positions` to the hero's (`shaped`), nearer points counting more. One with no surface that
 * near stays put.
 */
export function shapedSockets(sockets: BodySockets, positions: ArrayLike<number>, shaped: ArrayLike<number>): BodySockets {
  const out: BodySockets = {}
  for (const [slot, s] of Object.entries(sockets) as [GearSlot, BodySocket][]) {
    const move = [0, 0, 0]
    let total = 0
    for (let i = 0; i < positions.length; i += 3) {
      const d = Math.hypot(positions[i] - s.pos[0], positions[i + 1] - s.pos[1], positions[i + 2] - s.pos[2])
      if (d >= SOCKET_REACH) continue
      const w = (1 - d / SOCKET_REACH) ** 2
      for (let k = 0; k < 3; k++) move[k] += (shaped[i + k] - positions[i + k]) * w
      total += w
    }
    out[slot] = total ? { ...s, pos: [s.pos[0] + move[0] / total, s.pos[1] + move[1] / total, s.pos[2] + move[2] / total] } : s
  }
  return out
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
 * take the rest pose into each bone's own space, so this works whatever pose the model is in when it's called. Each is
 * a hand's, scaled to the hero's hands as it is drawn (fit.ts, `drawn`): what hangs on it is modelled for the medium body's.
 */
export function hangSockets(model: THREE.Object3D, sockets: BodySockets, drawn = 1): Partial<Record<GearSlot, THREE.Object3D>> {
  const mesh = skinnedMesh(model)
  const out: Partial<Record<GearSlot, THREE.Object3D>> = {}
  if (!mesh) return out
  const { bones, boneInverses } = mesh.skeleton
  const fit = pieceFit(measureFit(model).hand, drawn)
  for (const slot of GEAR_SLOTS) {
    const s = sockets[slot]
    const i = s ? bones.findIndex((b) => b.name === s.bone) : -1
    if (!s || i < 0) continue
    const socket = new THREE.Object3D()
    socket.name = `socket:${slot}`
    boneInverses[i].clone().multiply(socketMatrix(s)).decompose(socket.position, socket.quaternion, socket.scale)
    socket.scale.multiplyScalar(fit)
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
export function hangPieces(model: THREE.Object3D, pieces: readonly Piece[], sockets: BodySockets, drawn = 1): THREE.Object3D[] {
  if (!pieces.length) return []
  const hung = hangSockets(model, sockets, drawn)
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
