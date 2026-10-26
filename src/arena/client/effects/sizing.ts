import { SIZES, type SizeClass } from '../../../charter/sizes.js'
import { ENGINE } from '../../engine/calibration.js'
import type { MatchEvent } from '../../engine/events.js'
import type { RecipeLayer } from '../../recipes/schema.js'

/**
 * How big each effect layer is in the world (R11, KTD11). Sizes come from the engine event that carried the hit
 * geometry, so a damaging layer is drawn exactly as big as what can hit, and glow layers grow from the same number.
 */

export type ImpactEvent = Extract<MatchEvent, { type: 'impact' }>

/** The geometry a layer scales against: the area's radius, a beam's width, a melee or cone's reach. */
export function baseSize(e: Pick<ImpactEvent, 'radius' | 'range' | 'width' | 'arcDegrees'>, projectileRadius = 0.3): number {
  if (e.width) return e.width / 2
  if (e.radius) return e.radius
  if (e.arcDegrees) return e.range
  return projectileRadius
}

export function layerSize(layer: Pick<RecipeLayer, 'size' | 'damaging'>, base: number): number {
  // a damaging layer can never be drawn past the hit area, whatever its recipe says
  return (layer.damaging ? Math.min(1, layer.size) : layer.size) * base
}

/** The form mesh is scaled with the hero's capsule, so what the audience sees is what can be hit (AE6). */
export function formScale(size: SizeClass): number {
  return (ENGINE.capsule.radius + SIZES[size].hitRadius) / ENGINE.capsule.radius
}

export interface HitFeel {
  hitStop: number
  shake: number
  blood: number
}

/** Heavy hits freeze the picture for a beat and shake the camera; light ones only spark (KTD11). */
export function hitFeel(e: Extract<MatchEvent, { type: 'hit' }>): HitFeel {
  if (!e.heavy) return { hitStop: 0, shake: 0, blood: 6 }
  return { hitStop: 0.065, shake: 0.35, blood: 22 }
}

/**
 * The z-rotation that lays a cone fan (built around local +y, then turned flat by -90 degrees about x) along the aim
 * direction `dir` on the ground.
 */
export const coneYaw = (dir: { x: number; z: number }) => Math.atan2(dir.x, dir.z) + Math.PI
