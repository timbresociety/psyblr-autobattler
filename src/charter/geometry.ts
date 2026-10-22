import type { Delivery } from './types'

/**
 * Per-skill hit geometry (R43, KTD3). Each delivery carries what its kind needs; these defaults are what the template
 * DSL writes when an author gives none, and the budget prices any departure from them.
 */
export const GEOMETRY_DEFAULTS = { speed: 30, projectileRadius: 0.3, meleeArc: 90, width: 1 } as const

/** A cone's default arc spans its end radius at its range, rounded to whole degrees and stored as `arcDegrees`, so the engine reads a fixed number. */
export const coneArc = (range: number, radius: number) => Math.round((2 * Math.atan(radius / Math.max(range, 0.1)) * 180) / Math.PI)

/**
 * A delivery's hit geometry with every default filled in: the one place the engine, the AI and the client read it.
 * Catalogue templates always carry their fields (validateTemplate checks), so the fallbacks only cover hand-built ones.
 */
export function geometryOf(d: Delivery): { speed: number; projectileRadius: number; arcDegrees: number; width: number } {
  return {
    speed: d.speed ?? GEOMETRY_DEFAULTS.speed,
    projectileRadius: d.projectileRadius ?? GEOMETRY_DEFAULTS.projectileRadius,
    arcDegrees: d.arcDegrees ?? (d.kind === 'cone' ? coneArc(d.range, d.radius ?? 0) : GEOMETRY_DEFAULTS.meleeArc),
    width: d.width ?? GEOMETRY_DEFAULTS.width,
  }
}

/** The geometry fields this delivery's kind needs but does not have. */
export function missingGeometry(d: Delivery): string[] {
  const need: (keyof Delivery)[] = d.kind === 'projectile' ? ['speed', 'projectileRadius'] : d.kind === 'melee' || d.kind === 'cone' ? ['arcDegrees'] : d.kind === 'beam' ? ['width'] : []
  return need.filter((k) => !(typeof d[k] === 'number' && (d[k] as number) > 0))
}

/** Price multiplier for geometry; 1 at the defaults, so default skills cost what they always did. */
export function geometryMultiplier(d: Delivery): number {
  switch (d.kind) {
    case 'projectile':
      return (1 + ((d.speed ?? GEOMETRY_DEFAULTS.speed) - GEOMETRY_DEFAULTS.speed) / 150) * (1 + ((d.projectileRadius ?? GEOMETRY_DEFAULTS.projectileRadius) - GEOMETRY_DEFAULTS.projectileRadius) / 1.5)
    case 'melee':
      return 1 + ((d.arcDegrees ?? GEOMETRY_DEFAULTS.meleeArc) - GEOMETRY_DEFAULTS.meleeArc) / 360
    case 'cone':
      return 1 + ((d.arcDegrees ?? coneArc(d.range, d.radius ?? 0)) - coneArc(d.range, d.radius ?? 0)) / 360
    case 'beam':
      return 1 + ((d.width ?? GEOMETRY_DEFAULTS.width) - GEOMETRY_DEFAULTS.width) / 4
    default:
      return 1
  }
}
