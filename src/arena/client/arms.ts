import * as THREE from 'three'
import { GEAR_SLOTS, type ArmPiece, type GearSlot } from '../../charter/look.js'
import { socketMatrix, type BodySockets } from './gear.js'
import type { LoadedKit } from './held.js'

/**
 * Weapons a hero swaps between its hands and its carry slots (kit/body/carry.ts), the dev lab's John among them: the
 * melee set comes out for a blow, the ranged set for a shot, and whichever is not out waits on its slot. Each piece is
 * its own model on a socket, as held pieces are (gear.ts), moved from one empty to the other.
 */

export type ArmUse = ArmPiece['use']

/** Whether a hero holds a gun in each hand (paired guns): its shots then fire akimbo (characters.ts, heroes.ts). */
export const akimbo = (arms: readonly ArmPiece[] | undefined): boolean => (arms ?? []).filter((a) => a.use === 'ranged' && a.hand).length >= 2

export interface Arms {
  /** Brings `use`'s weapons out and puts the rest away; true when anything moved. */
  wield: (use: ArmUse) => boolean
}

function skinnedMesh(model: THREE.Object3D): THREE.SkinnedMesh | undefined {
  let found: THREE.SkinnedMesh | undefined
  model.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh
  })
  return found
}

/** Each hand socket of a body of ours in its bone's own space (see LoadedKit.hands). */
export function handFrames(body: THREE.Object3D, sockets: BodySockets): Partial<Record<GearSlot, THREE.Matrix4>> {
  const mesh = skinnedMesh(body)
  const out: Partial<Record<GearSlot, THREE.Matrix4>> = {}
  if (!mesh) return out
  for (const slot of GEAR_SLOTS) {
    const s = sockets[slot]
    const i = s ? mesh.skeleton.bones.findIndex((b) => b.name === s.bone) : -1
    if (s && i >= 0) out[slot] = mesh.skeleton.boneInverses[i].clone().multiply(socketMatrix(s))
  }
  return out
}

/** Hand sockets on a generated hero's own hand bones, where a body of ours has them (see handFrames). */
export function hangHands(model: THREE.Object3D, kit: LoadedKit): void {
  const mesh = skinnedMesh(model)
  if (!mesh || !kit.hands) return
  for (const slot of GEAR_SLOTS) {
    const frame = kit.hands[slot]
    const bone = mesh.skeleton.bones.find((b) => b.name === kit.sockets?.[slot]?.bone)
    if (!frame || !bone || model.getObjectByName(`socket:${slot}`)) continue
    const socket = new THREE.Object3D()
    socket.name = `socket:${slot}`
    frame.decompose(socket.position, socket.quaternion, socket.scale)
    bone.add(socket)
  }
}

const X = new THREE.Vector3(1, 0, 0)
const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)

/**
 * How a piece lies on its carry slot, in the slot's space. A slot's +y runs toward the end a hand reaches for and its
 * +z away from the body (carry.ts); a piece is modelled for the hand (gear.ts), its grip at the origin with a blade up
 * +y and its edge toward +z, a gun's barrel along +z and its grip down. Stowed, a blade hangs point down with its flat
 * on the body and a gun barrel down with its grip back; a piece no hand holds (a quiver) is modelled for its slot and
 * goes on as it is. Each then sits with its middle on the slot and its back on it.
 */
function stowed(piece: THREE.Object3D, held: boolean): THREE.Matrix4 {
  if (!held) return new THREE.Matrix4()
  const size = new THREE.Box3().setFromObject(piece).getSize(new THREE.Vector3())
  const gun = size.z > size.y
  // columns: where the piece's own x, y and z go
  const turn = gun ? new THREE.Matrix4().makeBasis(Z, X.clone().negate(), Y.clone().negate()) : new THREE.Matrix4().makeBasis(Z, Y.clone().negate(), X)
  const box = new THREE.Box3().setFromObject(piece).applyMatrix4(turn)
  const middle = box.getCenter(new THREE.Vector3())
  return new THREE.Matrix4().makeTranslation(-middle.x, -middle.y, -box.min.z).multiply(turn)
}

/** Hangs each of `arms` on its carry slot, the melee set in hand; undefined when none can hang. */
export function hangArms(model: THREE.Object3D, arms: readonly ArmPiece[], kit: LoadedKit): Arms | undefined {
  const hung = arms.flatMap((arm) => {
    const file = kit.pieces.get(arm.piece.url)
    const stow = model.getObjectByName(`socket:${arm.stow}`)
    if (!file || !stow) return []
    const obj = file.scene.clone(true)
    obj.name = `arm:${arm.piece.id}`
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    const hand = arm.hand ? model.getObjectByName(`socket:${arm.hand}`) : undefined
    return [{ use: arm.use, obj, stow, hand, away: stowed(obj, !!arm.hand) }]
  })
  if (!hung.length) return undefined
  let out: ArmUse | undefined
  const wield = (use: ArmUse) => {
    if (use === out) return false
    out = use
    for (const p of hung) {
      if (p.hand && p.use === use) {
        p.hand.add(p.obj)
        p.obj.position.set(0, 0, 0)
        p.obj.quaternion.identity()
        p.obj.scale.setScalar(1)
      } else {
        p.stow.add(p.obj)
        p.away.decompose(p.obj.position, p.obj.quaternion, p.obj.scale)
      }
    }
    return true
  }
  wield('melee')
  return { wield }
}
