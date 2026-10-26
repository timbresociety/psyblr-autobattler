import type { SizeClass } from '../../charter/sizes.js'
import type { BuildSlot } from '../../charter/types.js'
import type { Vec3 } from './maths.js'

/** What happened in a tick, for the client to draw and sound (KTD3, KTD9). The engine never reads its own events. */
export type MatchEvent =
  | { type: 'cast'; hero: number; slot: BuildSlot; templateId: string }
  | { type: 'projectile'; id: number; hero: number; slot: BuildSlot; from: Vec3; radius: number; speed: number }
  | { type: 'impact'; hero: number; slot: BuildSlot; at: Vec3; radius: number; arcDegrees?: number; width?: number; range: number }
  | { type: 'hit'; source: number; target: number; slot: BuildSlot; amount: number; heavy: boolean }
  | { type: 'knockback'; hero: number; phase: 'start' | 'end' }
  /** A transformation began or ended; `size` is the class the hero has now (a form may keep its own). */
  | { type: 'form'; hero: number; phase: 'start' | 'end'; size: SizeClass }
  | { type: 'death'; hero: number }
  /** A shot or blast struck a piece of cover; breakable pieces report their health left. */
  | { type: 'cover-hit'; index: number; at: Vec3; health: number }
  | { type: 'cover-broken'; index: number; at: Vec3 }
  | { type: 'end'; winner: 0 | 1 | 'draw'; reason: 'wipe' | 'time' }
  /** A status landed on a hero: control, a debuff, a state, until a tick (cleanse reports the tick it fired). */
  | { type: 'status'; hero: number; status: string; until: number }
  /** A basic attack missed: blinded, or turned aside by evasion. */
  | { type: 'miss'; source: number; target: number }
  /** A lingering field or a trap: raised, pulsing, sprung or gone. */
  | { type: 'field'; id: number; owner: number; slot: BuildSlot; phase: 'start' | 'pulse' | 'end'; at: Vec3; radius: number; trap: boolean; sprung?: boolean }
  /** A turret: built, firing at a point, or gone. */
  | { type: 'turret'; id: number; owner: number; phase: 'start' | 'shot' | 'end'; at: Vec3; to?: Vec3 }
  /** A wall a skill raised, as a box: up, or fallen when its time ran out. */
  | { type: 'wall'; index: number; owner: number; phase: 'up' | 'down'; at: Vec3; hx: number; hz: number; top: number }
