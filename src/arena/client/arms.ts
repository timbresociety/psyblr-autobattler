import * as THREE from 'three'
import { GEAR_SLOTS, type ArmPiece, type GearSlot } from '../../charter/look.js'
import { measureFit, pieceFit } from './fit.js'
import { socketMatrix, type BodySockets } from './gear.js'
import type { LoadedKit } from './held.js'
import { makeRope, ROPES } from './rope.js'

/**
 * Weapons a hero swaps between its hands and its carry slots (kit/body/carry.ts), the dev lab's John among them: the
 * melee set comes out for a blow, the ranged set for a shot, and whichever is not out waits on its slot. Each piece is
 * its own model on a socket, as held pieces are (gear.ts), moved from one empty to the other.
 */

export type ArmUse = ArmPiece['use']

/** Whether a hero holds a gun in each hand (paired guns): its shots then fire akimbo (characters.ts, heroes.ts). */
export const akimbo = (arms: readonly ArmPiece[] | undefined): boolean => (arms ?? []).filter((a) => a.use === 'ranged' && a.hand).length >= 2

export interface Arms {
  /** Brings `use`'s weapons out and puts the rest away (`none`: all away, the hands free); true when anything moved. */
  wield: (use: ArmUse | 'none') => boolean
  /**
   * Turns the piece out in the right hand within the hand (none: as it was modelled for the hand), for a clip whose
   * own hand held its piece another way (characters.ts HOLDS).
   */
  turn: (by: THREE.Quaternion) => void
  /** Swings what hangs loose from the hands (a whip's thong, rope.ts) after them; `floor` where the hero stands. */
  step: (dt: number, floor?: number) => void
}

function skinnedMesh(model: THREE.Object3D): THREE.SkinnedMesh | undefined {
  let found: THREE.SkinnedMesh | undefined
  model.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh
  })
  return found
}

/**
 * Each hand socket of a body of ours in its bone's own space, as it would sit in the modelled hand (fit.ts): how far
 * into the palm it lies is taken off that body's own hands (see LoadedKit.hands).
 */
export function handFrames(body: THREE.Object3D, sockets: BodySockets): Partial<Record<GearSlot, THREE.Matrix4>> {
  const mesh = skinnedMesh(body)
  const out: Partial<Record<GearSlot, THREE.Matrix4>> = {}
  if (!mesh) return out
  const hand = measureFit(body).hand
  const at = new THREE.Vector3()
  for (const slot of GEAR_SLOTS) {
    const s = sockets[slot]
    const i = s ? mesh.skeleton.bones.findIndex((b) => b.name === s.bone) : -1
    if (!s || i < 0) continue
    const frame = mesh.skeleton.boneInverses[i].clone().multiply(socketMatrix(s))
    out[slot] = frame.setPosition(at.setFromMatrixPosition(frame).divideScalar(hand))
  }
  return out
}

/**
 * Hand sockets on a generated hero's own hand bones, where a body of ours has them (see handFrames), as deep in the
 * palm as its own hands are against the modelled ones, and scaled as a piece is for hands that size (fit.ts).
 */
export function hangHands(model: THREE.Object3D, kit: LoadedKit): void {
  const mesh = skinnedMesh(model)
  if (!mesh || !kit.hands) return
  const hand = measureFit(model).hand
  const piece = pieceFit(hand, kit.drawn)
  for (const slot of GEAR_SLOTS) {
    const frame = kit.hands[slot]
    const bone = mesh.skeleton.bones.find((b) => b.name === kit.sockets?.[slot]?.bone)
    if (!frame || !bone || model.getObjectByName(`socket:${slot}`)) continue
    const socket = new THREE.Object3D()
    socket.name = `socket:${slot}`
    frame.decompose(socket.position, socket.quaternion, socket.scale)
    socket.position.multiplyScalar(hand)
    socket.scale.multiplyScalar(piece)
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
 * goes on as it is. Each then sits with its middle on the slot and its back on it, the size it is in the hand (`scale`,
 * about the slot); a piece no hand holds is the body's size.
 */
function stowed(piece: THREE.Object3D, held: boolean, scale: number): THREE.Matrix4 {
  const sized = new THREE.Matrix4().makeScale(scale, scale, scale)
  if (!held) return sized
  // a coiled thong is measured as it lies, through its bones
  piece.updateMatrixWorld(true)
  const size = new THREE.Box3().setFromObject(piece, true).getSize(new THREE.Vector3())
  const gun = size.z > size.y
  // columns: where the piece's own x, y and z go
  const turn = gun ? new THREE.Matrix4().makeBasis(Z, X.clone().negate(), Y.clone().negate()) : new THREE.Matrix4().makeBasis(Z, Y.clone().negate(), X)
  const box = new THREE.Box3().setFromObject(piece, true).applyMatrix4(turn)
  const middle = box.getCenter(new THREE.Vector3())
  return sized.multiply(new THREE.Matrix4().makeTranslation(-middle.x, -middle.y, -box.min.z)).multiply(turn)
}

/** Hangs each of `arms` on its carry slot, the melee set in hand; undefined when none can hang. */
export function hangArms(model: THREE.Object3D, arms: readonly ArmPiece[], kit: LoadedKit): Arms | undefined {
  const fit = measureFit(model)
  model.updateWorldMatrix(true, true)
  const scaleOf = (o: THREE.Object3D) => o.getWorldScale(new THREE.Vector3()).x
  const hung = arms.flatMap((arm) => {
    const file = kit.pieces.get(arm.piece.url)
    const stow = arm.stow ? model.getObjectByName(`socket:${arm.stow}`) : undefined
    const hand = arm.hand ? model.getObjectByName(`socket:${arm.hand}`) : undefined
    // a piece with no slot is only ever in the hand
    if (!file || (arm.stow ? !stow : !hand)) return []
    const obj = file.scene.clone(true)
    obj.name = `arm:${arm.piece.id}`
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    const rope = arm.hand && ROPES.has(arm.piece.id) ? makeRope(obj) : undefined
    // put away, a piece keeps the size its hand gives it (the hand's socket carries the hero's fit, gear.ts)
    const size = !stow ? 1 : hand ? scaleOf(hand) / scaleOf(stow) : arm.hand ? pieceFit(fit.hand, kit.drawn) : fit.body
    return [{ use: arm.use, obj, stow, hand, rope, away: stowed(obj, !!arm.hand, size) }]
  })
  if (!hung.length) return undefined
  let out: ArmUse | 'none' | undefined
  const wield = (use: ArmUse | 'none') => {
    if (use === out) return false
    out = use
    for (const p of hung) {
      if (p.hand && p.use === use) {
        p.hand.add(p.obj)
        p.obj.position.set(0, 0, 0)
        p.obj.quaternion.identity()
        p.obj.scale.setScalar(1)
        p.rope?.coil(false)
      } else if (p.stow) {
        p.stow.add(p.obj)
        p.away.decompose(p.obj.position, p.obj.quaternion, p.obj.scale)
        p.rope?.coil(true)
      } else p.obj.removeFromParent()
    }
    return true
  }
  wield('melee')
  const ropes = hung.flatMap((p) => (p.rope ? [p.rope] : []))
  const turn = (by: THREE.Quaternion) => {
    for (const p of hung) if (p.hand?.name === 'socket:hand_r' && p.obj.parent === p.hand && !p.rope) p.obj.quaternion.copy(by)
  }
  return { wield, turn, step: (dt, floor) => ropes.forEach((r) => r.step(dt, floor)) }
}
