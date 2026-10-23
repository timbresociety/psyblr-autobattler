import { DEMO_HEROES } from '../../arena/demo/roster'
import type { BuildSlot, RoleId, Template } from '../../charter/types'

/**
 * What the front end needs to draw a hero without a renderer: its suit colour, its role colour, and which of the
 * character's clips plays a skill. The 3D preview and the portraits read these, so they agree with each other.
 */

/** A demo hero's own suit colour, else a stable one from the name (so a hero keeps its colours while it is edited). */
export function heroHue(name: string): number {
  const demo = DEMO_HEROES.find((h) => h.heroName === name)
  if (demo) return demo.hue
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

/** The role colours of theme.css (`.role-<id>`), for the 3D stage's floor light. */
export const ROLE_RGB: Record<RoleId, [number, number, number]> = {
  tank: [242, 196, 107],
  fighter: [255, 143, 90],
  assassin: [196, 155, 255],
  mage: [255, 122, 217],
  marksman: [127, 227, 255],
  support: [134, 240, 168],
}

/** The arena character's clips (public/heroes/*.glb). */
export type StageClip = 'idle' | 'run' | 'fly' | 'hover' | 'slash' | 'shoot' | 'cast' | 'ultimate' | 'hurt' | 'stunned' | 'fall'

/** Which clip shows a skill: a swing for close skills, a shot or a two-handed blast for ranged ones (as in the arena). */
export function castClip(template: Pick<Template, 'delivery'>, slot: BuildSlot): StageClip {
  if (slot === 'ultimate') return 'ultimate'
  if (slot === 'movement') return 'hover'
  const kind = template.delivery.kind
  if (kind === 'melee' || kind === 'cone' || kind === 'dash' || kind === 'grapple') return 'slash'
  if (kind === 'projectile') return slot === 'basic' ? 'shoot' : 'cast'
  return 'cast'
}

/** True when this browser can draw WebGL2 (jsdom and very old browsers cannot; the UI falls back to initials). */
export function webglAvailable(): boolean {
  return typeof window !== 'undefined' && typeof (window as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext !== 'undefined'
}
