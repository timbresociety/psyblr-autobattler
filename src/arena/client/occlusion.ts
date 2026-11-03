import type * as THREE from 'three'
import { coverHit, type CoverHealth, type CoverPiece } from '../engine/cover.js'
import type { Vec3 } from '../engine/maths.js'

/**
 * Occlusion by zone and level (GAME.md §10): a hero the house's stone hides from the camera, on a deck overhead or a
 * level below, behind a wall, isn't drawn. It moves to a layer only the sun's shadow cameras see, so its shadow still
 * falls where the camera can see it.
 */
export const OCCLUDED_LAYER = 2

/** Pieces the eye sees through. */
const SEE_THROUGH = new Set<CoverPiece['look']>(['glass', 'rail'])

/** How far beyond the body the lines of sight aim, so a hero shows a little before any of it comes round a corner. */
const PAD = 0.4
/** Frames a hero must stay hidden before it stops being drawn; it comes back the frame a line of sight clears. */
export const HIDE_AFTER = 3

/** The cover's health with everything the eye sees through counted as gone, made once per map. */
export function sightHealth(pieces: readonly CoverPiece[], health: readonly CoverHealth[], out: CoverHealth[] = []): CoverHealth[] {
  out.length = pieces.length
  for (let i = 0; i < pieces.length; i++) out[i] = SEE_THROUGH.has(pieces[i].look) ? 0 : health[i]
  return out
}

const point = { x: 0, y: 0, z: 0 }

/**
 * True when stone stands between `eye` and every edge of a body standing at `at`, `height` tall: its head, its feet
 * and both sides as the eye sees them. An eye inside a piece (a camera pressed into a wall) counts that piece as clear.
 */
export function occluded(eye: Vec3, at: Vec3, height: number, pieces: readonly CoverPiece[], health: readonly CoverHealth[]): boolean {
  const dx = at.x - eye.x
  const dz = at.z - eye.z
  const flat = Math.sqrt(dx * dx + dz * dz) || 1
  // across the line of sight, level with the ground
  const sx = (-dz / flat) * (0.5 + PAD)
  const sz = (dx / flat) * (0.5 + PAD)
  const mid = at.y + height / 2
  const edges: [number, number, number][] = [
    [at.x, at.y + height + PAD, at.z],
    [at.x, at.y + 0.1, at.z],
    [at.x + sx, mid, at.z + sz],
    [at.x - sx, mid, at.z - sz],
  ]
  for (const [x, y, z] of edges) {
    point.x = x
    point.y = y
    point.z = z
    const hit = coverHit(pieces, health, eye, point)
    if (!hit || hit.t <= 0) return false
  }
  return true
}

/** Draw `root` for the camera, or for the sun's shadow only. */
export function setOccluded(root: THREE.Object3D, hidden: boolean): void {
  root.traverse((o) => o.layers.set(hidden ? OCCLUDED_LAYER : 0))
}
