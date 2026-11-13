import * as THREE from 'three'
import { hangShare, type Spread } from '../../../kit/body/spread.js'
import { AIM_SHARES, aimChain, aimLinks, gripWeight, LOOK_SHARES } from '../../../kit/rig/aim.js'
import { legReach } from '../feet.js'

/**
 * The fix-ups after the clip (GAME.md §9.6), on the standard rig: the arms and legs spread by the body's girth, the off
 * hand onto a two-handed grip, and the look and aim spread up the back within joint limits. Each runs on the pose the
 * clip and the other layers left, and `undo` puts every bone it turned back before the next update, like the twist.
 */

/** What the hero's eyes and weapon follow this frame: its aim, and how much of the body comes round to it. */
export interface Gaze {
  yaw: number
  pitch: number
  /** 'aim' brings the back round as well (a cast or a shot), 'look' the neck and head, 'off' nothing. */
  mode: 'aim' | 'look' | 'off'
  /**
   * Run once the look and aim are on and before the off hand takes its grip: the view's own turn of what the hands hold
   * onto the aim (characters.ts pointWeapon), so the grip is taken on the weapon where it ends up.
   */
  point?: () => void
  /**
   * The least the off hand takes of its grip (0 to 1): a long gun, a launcher or a staff is held in both hands through
   * its shot, wherever the clip left the off hand. Without it the grip is taken only as far as the clip brings the hand
   * near.
   */
  grip?: number
}

export interface Fixups {
  apply: (dt: number, gaze: Gaze) => void
  undo: () => void
  /** The last frame's leftovers, for the bench and probes: degrees the aim fell short, the grip's weight. */
  readonly state: { aimLeft: number; grip: number }
}

/** How far the off hand reaches past the main hand along the weapon for a two-handed grip, metres on a 1.8 m hero. */
const GRIP_SPAN = 0.2
/** How fast the look and aim come on and go off, per second. */
const GAZE_RATE = 4
const WEIGHT = { aim: 0.85, look: 0.5, off: 0 }

const UP = new THREE.Vector3(0, 1, 0)
const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const q = new THREE.Quaternion()
const rootQ = new THREE.Quaternion()
const parentQ = new THREE.Quaternion()
const boneQ = new THREE.Quaternion()

function turnBy(bone: THREE.Object3D, world: THREE.Quaternion) {
  bone.parent!.matrixWorld.decompose(v[3], parentQ, v[3])
  bone.matrixWorld.decompose(v[3], boneQ, v[3])
  bone.quaternion.copy(parentQ.invert().multiply(world).multiply(boneQ))
  bone.updateMatrixWorld(true)
}

/**
 * `spread` is what this body adds past the reference (extraSpread), `tip` the world point of what the right hand
 * holds (undefined when it holds nothing), `height` the hero's standing height in metres.
 */
export function fixups(scene: THREE.Object3D, root: THREE.Object3D, spread: Spread | undefined, tip: (out: THREE.Vector3) => THREE.Vector3 | undefined, height: number): Fixups {
  const find = (name: string) => scene.getObjectByName(name)
  scene.updateMatrixWorld(true)
  // a limb, its next joint (which way it points) and the way out from the body, in the model's own frame: +x is the hero's left
  const limbs = spread
    ? (['Left', 'Right'] as const).flatMap((side) => {
        const out = new THREE.Vector3(side === 'Left' ? 1 : -1, 0, 0)
        return [
          { bone: find(`${side}Arm`), next: find(`${side}ForeArm`), out, amount: spread.arm },
          { bone: find(`${side}UpLeg`), next: find(`${side}Leg`), out, amount: spread.leg },
        ].filter((l): l is { bone: THREE.Object3D; next: THREE.Object3D; out: THREE.Vector3; amount: number } => !!l.bone && !!l.next && l.amount > 1e-3)
      })
    : []
  const aim = aimLinks(find, AIM_SHARES)
  const look = aimLinks(find, LOOK_SHARES)
  const head = find('Head')
  // which way the head faces, in its own frame: the model's front at rest
  root.getWorldQuaternion(rootQ)
  const facing = head ? new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ).applyQuaternion(head.getWorldQuaternion(q).invert()) : undefined
  const off = { arm: find('LeftArm'), fore: find('LeftForeArm'), hand: find('LeftHand') }
  const main = find('RightHand')
  const touched = [...new Set([...limbs.map((l) => l.bone), ...aim.map((l) => l.bone), ...look.map((l) => l.bone), off.arm, off.fore].filter((b): b is THREE.Object3D => !!b))]
  const saved = touched.map(() => new THREE.Quaternion())
  let applied = false
  let weight = 0
  let chain: typeof aim = look
  const state = { aimLeft: 0, grip: 0 }

  return {
    state,
    undo: () => {
      if (applied) touched.forEach((b, k) => b.quaternion.copy(saved[k]))
      applied = false
    },
    apply: (dt, gaze) => {
      touched.forEach((b, k) => saved[k].copy(b.quaternion))
      applied = true
      root.updateMatrixWorld(true)
      root.getWorldQuaternion(rootQ)
      const up = v[0].copy(UP).applyQuaternion(rootQ)
      // the limbs out from the body, as far as each hangs down
      for (const l of limbs) {
        const at = l.bone.getWorldPosition(v[1])
        const dir = l.next.getWorldPosition(v[2]).sub(at).normalize()
        const share = hangShare(-dir.dot(up))
        if (!share) continue
        const axis = dir.cross(v[1].copy(l.out).applyQuaternion(rootQ))
        if (axis.lengthSq() < 1e-8) continue
        turnBy(l.bone, q.setFromAxisAngle(axis.normalize(), l.amount * share))
      }
      // the look and the aim: the neck and head always, the back too for a cast or a shot; eased on and off
      const want = WEIGHT[gaze.mode]
      weight += Math.max(-GAZE_RATE * dt, Math.min(GAZE_RATE * dt, want - weight))
      if (gaze.mode !== 'off') chain = gaze.mode === 'aim' ? aim : look
      if (facing && chain.length && weight > 1e-3) {
        const cp = Math.cos(gaze.pitch)
        const target = v[1].set(Math.sin(gaze.yaw) * cp, Math.sin(gaze.pitch), Math.cos(gaze.yaw) * cp)
        state.aimLeft = aimChain(chain, facing, target, up.clone(), weight)
      } else state.aimLeft = 0
      gaze.point?.()
      // the off hand onto a two-handed grip, when the clip brings it near
      state.grip = 0
      const tipAt = main && off.arm && off.fore && off.hand ? tip(v[1]) : undefined
      if (tipAt) {
        // by the hero as it stands in the world: `height` is the body's own, and a size class scales the whole of it (a
        // colossal hero's hand, 1.6 times as far from its weapon in metres, took no grip at all)
        const tall = Math.max(height, 1.8 * root.getWorldScale(v[3]).y)
        const palm = main!.getWorldPosition(v[2])
        const grip = v[1].sub(palm).normalize().multiplyScalar((GRIP_SPAN * tall) / 1.8).add(palm)
        const hand = off.hand!.getWorldPosition(v[3])
        const w = Math.max(gaze.grip ?? 0, gripWeight(hand.distanceTo(grip), tall))
        state.grip = w
        if (w > 0) {
          const goal = hand.lerp(grip, w).clone()
          // the elbow bends out and back, as it does round a staff or a rifle stock
          const bendTo = new THREE.Vector3(1, 0, -1).normalize().applyQuaternion(rootQ)
          legReach(off.arm!, off.fore!, off.hand!, goal, bendTo)
        }
      }
    },
  }
}
