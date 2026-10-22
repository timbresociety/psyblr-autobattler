import type { SizeClass } from '../../charter/sizes'
import type { BuildSlot } from '../../charter/types'
import type { Vec3 } from './maths'

/** What happened in a tick, for the client to draw and sound (KTD3, KTD9). The engine never reads its own events. */
export type MatchEvent =
  | { type: 'cast'; hero: number; slot: BuildSlot; templateId: string }
  | { type: 'projectile'; id: number; hero: number; slot: BuildSlot; from: Vec3; radius: number; speed: number }
  | { type: 'impact'; hero: number; slot: BuildSlot; at: Vec3; radius: number; arcDegrees?: number; width?: number; range: number }
  | { type: 'hit'; source: number; target: number; slot: BuildSlot; amount: number; heavy: boolean }
  | { type: 'knockback'; hero: number; phase: 'start' | 'end' }
  | { type: 'resize'; hero: number; phase: 'start' | 'end'; size: SizeClass }
  | { type: 'death'; hero: number }
  | { type: 'end'; winner: 0 | 1 | 'draw'; reason: 'wipe' | 'time' }
