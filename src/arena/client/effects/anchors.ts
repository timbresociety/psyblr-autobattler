import * as THREE from 'three'
import { floorUnder } from '../../engine/cover.js'
import type { MatchState } from '../../engine/state.js'

/**
 * Where each effect plays (GAME.md §6, "effects land where they happen"): nothing is centred on the torso by default.
 * The cast flash comes off the hand or weapon on the release, a shot leaves the muzzle, a hit lands on the victim where
 * the blow or shot met its body, a melee spark where the weapon's tip met it, a zone on the floor at its centre, and a
 * buff, state or aura on the body.
 */
export type Anchor = 'hand' | 'muzzle' | 'contact' | 'tip' | 'ground' | 'body'
export type Placed = 'cast flash' | 'projectile' | 'impact' | 'melee spark' | 'zone' | 'aura'
export const ANCHOR: Record<Placed, Anchor> = {
  'cast flash': 'hand',
  projectile: 'muzzle',
  impact: 'contact',
  'melee spark': 'tip',
  zone: 'ground',
  aura: 'body',
}

/** How far above a point the floor under it may be looked for: a hand, a shot or a chest stands over its own floor. */
const LOOK_UP = 0.6

/** The floor under a point: the top of the map piece under it (a slab, a deck, a ramp), else the ground at 0. */
export function groundUnder(match: Pick<MatchState, 'cover'>, p: { x: number; y: number; z: number }): number {
  const cover = match.cover
  return cover ? floorUnder(cover.pieces, cover.health, p, p.y + LOOK_UP) : 0
}

/** A body to land on: an upright capsule standing on `feet`. */
export interface Body {
  feet: { x: number; y: number; z: number }
  radius: number
  height: number
}

/**
 * Where something coming from `from` meets a body: the point on its capsule nearest `from`. A shot from the side lands
 * on the near flank at the shot's height, a blow from above on the crown, one from below on the shins.
 */
export function contactPoint(body: Body, from: { x: number; y: number; z: number }, out = new THREE.Vector3()): THREE.Vector3 {
  const { feet, radius, height } = body
  const low = feet.y + radius
  const high = feet.y + Math.max(radius, height - radius)
  const y = Math.min(high, Math.max(low, from.y))
  out.set(from.x - feet.x, from.y - y, from.z - feet.z)
  const d = out.length()
  // from inside the body: its front at that height
  if (d < 1e-6) return out.set(feet.x, y, feet.z + radius)
  return out.multiplyScalar(radius / d).add(new THREE.Vector3(feet.x, y, feet.z))
}
