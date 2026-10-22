import type { Delivery } from '../../charter/types'
import type { Preset } from '../../forge/motion/library'

/**
 * Viewer decisions, kept free of three.js so they test without WebGL (U12). The viewer loads the rigged GLB when
 * there is one, and a procedural mannequin otherwise (fakes, offline, or a mesh still generating).
 */

export type MotionPlay = { kind: 'clip'; url: string } | { kind: 'preset'; preset: Preset }

export function viewerSource(meshUrl: string | undefined): 'glb' | 'mannequin' {
  if (!meshUrl || meshUrl.startsWith('fake://')) return 'mannequin'
  return /\.glb(?:[?#]|$)/i.test(meshUrl) || meshUrl.startsWith('data:model/gltf-binary') ? 'glb' : 'mannequin'
}

/**
 * Which animation to play. A licensed clip plays by its file name; otherwise the Tripo preset, matched against
 * the retargeted GLB's animation names ("idle", "Armature|run", ...). Undefined means "no clip: pose procedurally".
 */
export function pickAnimation(play: MotionPlay, available: string[]): string | undefined {
  if (play.kind === 'clip') {
    const file = play.url.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '').toLowerCase()
    const hit = available.find((name) => name.toLowerCase() === file)
    if (hit) return hit
    return undefined
  }
  const exact = available.find((name) => name.toLowerCase() === play.preset)
  return exact ?? available.find((name) => name.toLowerCase().split(/[|:_\s-]/).includes(play.preset))
}

/** Seconds the effect stays up once triggered, by how the mechanic is delivered. Cooldown never matters here. */
const HOLD: Record<Delivery['kind'], number> = {
  melee: 0.25,
  projectile: 0,
  beam: 1.2,
  cone: 0.5,
  zone: 1.4,
  self: 1,
  aura: Infinity,
  dash: 0.4,
  blink: 0.3,
  grapple: 0.6,
}
const PROJECTILE_SPEED = 30

/**
 * When the effect sprite shows within one play of the motion: it starts at the impact point (40% in) and lasts
 * for the delivery's cast window; projectiles last their flight time over the template's range.
 */
export function effectWindow(delivery: Pick<Delivery, 'kind' | 'range'>, clipSeconds: number): { start: number; end: number } {
  if (delivery.kind === 'aura') return { start: 0, end: clipSeconds }
  const start = clipSeconds * 0.4
  const hold = delivery.kind === 'projectile' ? delivery.range / PROJECTILE_SPEED : HOLD[delivery.kind]
  return { start, end: Math.min(clipSeconds, start + hold) }
}

/** The effect's world size, from the mechanic's own range and radius (R18). */
export function effectScale(shape: { delivery: string; range: number; radius?: number }): { width: number; height: number } {
  if (shape.radius !== undefined) return { width: shape.radius * 2, height: shape.radius * 2 }
  if (shape.delivery === 'beam') return { width: shape.range, height: 1 }
  return { width: Math.max(1.5, Math.min(shape.range, 4)), height: Math.max(1.5, Math.min(shape.range, 4)) }
}
