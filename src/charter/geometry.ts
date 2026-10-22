import type { Delivery } from './types'

/**
 * Per-skill hit geometry (R43, KTD3). Each delivery carries what its kind needs; these defaults are what the template
 * DSL writes when an author gives none, and the budget prices any departure from them.
 */
export const GEOMETRY_DEFAULTS = { speed: 30, projectileRadius: 0.3, meleeArc: 90, width: 1 } as const

/** A cone's default arc spans its end radius at its range, in whole degrees so every platform reads the same number. */
export const coneArc = (range: number, radius: number) => Math.round((2 * Math.atan(radius / Math.max(range, 0.1)) * 180) / Math.PI)

/** The kinds that need each field. */
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
