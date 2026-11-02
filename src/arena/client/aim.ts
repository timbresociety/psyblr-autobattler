import { capsule, type MatchState } from '../engine/state.js'
import { coverHit } from '../engine/cover.js'
import { chest } from '../engine/deliveries.js'
import { add, dot, scale, sub, type Vec3 } from '../engine/maths.js'

/** How far the crosshair reaches, metres: past it a shot flies at a point this far out. */
const REACH = 90

/**
 * Where the crosshair points, for a hero aimed over its shoulder: the camera sits behind and to the right, so a shot
 * that left the chest along the camera's own line would fly a metre to the left of the reticle all the way. The ray
 * from the camera through the reticle is followed, from the hero's own depth on, to the first enemy, ruin or the
 * ground it meets (or REACH metres out), and the shot is aimed from the chest at that point. What the reticle sits on
 * is what gets hit.
 */
export function convergedAim(match: MatchState, hero: number, eye: Vec3, forward: Vec3): { yaw: number; pitch: number } | undefined {
  const me = match.heroes[hero]
  if (!me) return undefined
  const from = chest(me)
  // nothing between the camera and the hero counts: the ray starts level with the hero
  const t0 = Math.max(0, dot(sub(from, eye), forward))
  let t = REACH
  for (const h of match.heroes) {
    if (!h.alive || h.team === me.team) continue
    const c = capsule(h)
    // the ray's closest approach to the capsule's axis, sampled along the axis
    for (let k = 0; k <= 4; k++) {
      const p = { x: h.position.x, y: h.position.y + (c.height * k) / 4, z: h.position.z }
      const along = dot(sub(p, eye), forward)
      if (along <= t0 || along >= t) continue
      const off = sub(p, add(eye, scale(forward, along)))
      if (dot(off, off) <= (c.radius + 0.15) ** 2) t = along
    }
  }
  if (match.cover) {
    const a = add(eye, scale(forward, t0))
    const b = add(eye, scale(forward, t))
    const hit = coverHit(match.cover.pieces, match.cover.health, a, b)
    if (hit) t = t0 + (t - t0) * hit.t
  }
  if (forward.y < -1e-3) t = Math.min(t, Math.max(t0, -eye.y / forward.y))
  const at = add(eye, scale(forward, Math.max(t, t0 + 2)))
  const d = sub(at, from)
  return { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z)) }
}
