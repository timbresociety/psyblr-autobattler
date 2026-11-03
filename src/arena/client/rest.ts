import type * as THREE from 'three'

/**
 * Bodies at rest (GAME.md §10): a hero that has lain dead and still for a while is drawn as it last lay, with no pose,
 * no cloth and none of its skeleton's matrices worked out again. By the middle of a 10 v 10 half the field is down,
 * and each body's ~130 bones were otherwise multiplied out every frame: three's scene walk recomputes every object's
 * world matrix each frame however still it is.
 */

/** Seconds a hero lies dead before its body rests: the longest death clip is over by then. */
export const REST_AFTER = 5

/** Whether a body may rest: dead long enough, not moved this frame, its cloth hanging still, its fallen body asleep. */
export function mayRest(downFor: number, moved: number, swinging: boolean, sleeping = true): boolean {
  return downFor >= REST_AFTER && moved < 1e-3 && !swinging && sleeping
}

const still = () => {}

/**
 * Freeze or thaw a body's matrices. Frozen, the scene's walk stops at its root (its own `updateMatrixWorld` does
 * nothing) and every part of it keeps the world matrix it last had, so it draws exactly where it lay.
 */
export function setResting(root: THREE.Object3D, resting: boolean): void {
  const frozen = Object.prototype.hasOwnProperty.call(root, 'updateMatrixWorld')
  if (resting === frozen) return
  if (resting) {
    root.updateMatrixWorld(true)
    root.updateMatrixWorld = still
  } else delete (root as { updateMatrixWorld?: unknown }).updateMatrixWorld
}

export const isResting = (root: THREE.Object3D) => Object.prototype.hasOwnProperty.call(root, 'updateMatrixWorld')
