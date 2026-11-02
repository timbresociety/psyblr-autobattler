import { Quaternion, Vector3 } from 'three'

/**
 * A joint's turn from its rest, split the way joint limits are written (GAME.md §9.2, ranges of motion): a twist about
 * the bone's own length (local +Y on the Mixamo-named rig, where every bone points at its child) and a swing that
 * tips that length away, given as a rotation vector about the bone's local X and Z. Degrees throughout.
 *
 * The swing vector is continuous up to a half turn, so a shoulder thrown overhead reads 150° and not a wrapped -30°.
 */
export interface SwingTwist {
  twist: number
  x: number
  z: number
}

const DEG = 180 / Math.PI
const Y = new Vector3(0, 1, 0)
const d = new Vector3()
const swing = new Quaternion()
const twistQ = new Quaternion()

/** `delta` is the bone's local rotation with its rest taken off: rest⁻¹ · pose. */
export function swingTwist(delta: Quaternion, out: SwingTwist = { twist: 0, x: 0, z: 0 }): SwingTwist {
  d.copy(Y).applyQuaternion(delta)
  const cos = Math.min(1, Math.max(-1, d.y))
  const angle = Math.acos(cos)
  // Y × d = (d.z, 0, -d.x): the axis the length tips about, always across the bone
  const across = Math.hypot(d.z, d.x)
  if (across < 1e-9) {
    out.x = 0
    out.z = angle > 1 ? 180 : 0
    swing.set(0, 0, 0, 1)
    if (angle > 1) swing.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI)
  } else {
    out.x = ((d.z / across) * angle) * DEG
    out.z = ((-d.x / across) * angle) * DEG
    swing.setFromAxisAngle(new Vector3(d.z / across, 0, -d.x / across), angle)
  }
  // what is left once the swing is taken off is a turn about the length
  twistQ.copy(swing).invert().multiply(delta)
  out.twist = 2 * Math.atan2(twistQ.y, twistQ.w) * DEG
  if (out.twist > 180) out.twist -= 360
  if (out.twist < -180) out.twist += 360
  return out
}

/** The rotation a swing-twist names, back again: swing · twist. */
export function fromSwingTwist(st: SwingTwist, out: Quaternion = new Quaternion()): Quaternion {
  const sx = st.x / DEG
  const sz = st.z / DEG
  const angle = Math.hypot(sx, sz)
  if (angle < 1e-9) swing.identity()
  else swing.setFromAxisAngle(new Vector3(sx / angle, 0, sz / angle), angle)
  twistQ.setFromAxisAngle(Y, st.twist / DEG)
  return out.copy(swing).multiply(twistQ)
}
