import * as THREE from 'three'
import { GEAR_SLOTS, type GearSlot, type HeroLook } from '../../charter/look.js'
import { bodyKit, bodyKitNow } from './body-kit.js'
import type { Gltf } from './character-look.js'

/**
 * Gear on a body: each piece is its own small model (public/kit/pieces/ or a player's generated one), hung on a socket
 * the Blender pipeline placed on the body's bones (tools/blender/humanlib/sockets.py). The piece follows every clip
 * through its bone, so nothing is rigged per piece, and any piece fits any body.
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
function tinted(material: THREE.Material, color: string): THREE.Material {
  if (!/^primary/.test(material.name)) return material
  const m = material.clone() as THREE.MeshStandardMaterial
  m.color?.setStyle(color, THREE.SRGBColorSpace)
  if (m.emissive && m.emissive.getHex() !== 0) m.emissive.setStyle(color, THREE.SRGBColorSpace)
  return m
}

/** What a hero's gear needs to be drawn: its body's sockets and every worn piece's model. */
export interface LoadedGear {
  sockets: BodySockets
  files: Map<string, Gltf>
}

/** Hang each worn piece on its socket. Pieces share their geometry with the loaded file; tinted materials are copies. */
export function wearGear(model: THREE.Object3D, gear: HeroLook['gear'], loaded: LoadedGear): THREE.Object3D[] {
  const hung = hangSockets(model, loaded.sockets)
  const worn: THREE.Object3D[] = []
  for (const slot of GEAR_SLOTS) {
    const piece = gear?.[slot]
    const socket = hung[slot]
    const file = piece ? loaded.files.get(piece.url) : undefined
    if (!piece || !socket || !file) continue
    const obj = file.scene.clone(true)
    obj.name = `gear:${slot}`
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

const pieces = new Map<string, Promise<Gltf | undefined>>()
const ready = new Map<string, Gltf | undefined>()

/** A piece's model, loaded once; undefined when it can't load (the hero goes without it, never without a fight). */
export function loadPiece(url: string, load: (url: string) => Promise<Gltf>): Promise<Gltf | undefined> {
  let piece = pieces.get(url)
  if (!piece) {
    piece = load(url)
      .catch(() => undefined)
      .then((file) => {
        ready.set(url, file)
        return file
      })
    pieces.set(url, piece)
  }
  return piece
}

const wornUrls = (gear: HeroLook['gear']) => [...new Set(GEAR_SLOTS.flatMap((slot) => (gear?.[slot] ? [gear[slot]!.url] : [])))]

/** Everything a hero's gear needs; undefined when it wears none or its body has no sockets. */
export async function loadGear(body: string, gear: HeroLook['gear'], load: (url: string) => Promise<Gltf>): Promise<LoadedGear | undefined> {
  const urls = wornUrls(gear)
  if (!urls.length) return undefined
  const [kit, ...files] = await Promise.all([bodyKit(body), ...urls.map((url) => loadPiece(url, load))])
  if (!kit?.sockets) return undefined
  return { sockets: kit.sockets, files: new Map(urls.flatMap((url, i) => (files[i] ? [[url, files[i]!] as const] : []))) }
}

/**
 * The same from what has already loaded, for drawing in one go (the roster's busts): null while anything is still on
 * its way, calling `changed` as each piece lands; undefined when there's nothing to wear.
 */
export function gearNow(body: string, gear: HeroLook['gear'], load: (url: string) => Promise<Gltf>, changed: () => void): LoadedGear | undefined | null {
  const urls = wornUrls(gear)
  if (!urls.length) return undefined
  const kit = bodyKitNow(body, changed)
  let waiting = kit === null
  for (const url of urls) {
    if (ready.has(url)) continue
    waiting = true
    void loadPiece(url, load).then(changed)
  }
  if (waiting) return null
  if (!kit?.sockets) return undefined
  return { sockets: kit.sockets, files: new Map(urls.flatMap((url) => (ready.get(url) ? [[url, ready.get(url)!] as const] : []))) }
}
