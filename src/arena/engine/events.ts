import type { SizeClass } from '../../charter/sizes.js'
import type { BuildSlot } from '../../charter/types.js'
import type { Vec3 } from './maths.js'

/** What happened in a tick, for the client to draw and sound (KTD3, KTD9). The engine never reads its own events. */
export type MatchEvent =
  /** A cast began its wind-up: it lands on tick `release` and the hero is free again on tick `ends` (phase 1). */
  | { type: 'cast'; hero: number; slot: BuildSlot; templateId: string; release: number; ends: number; melee?: { step: number; heavy?: number } }
  /** The cast landed: the hit, the shot leaving the hand or the dash starting, all on this tick. */
  | { type: 'release'; hero: number; slot: BuildSlot }
  /** Control, a knockback or another cast cut a wind-up short, so it never lands. */
  | { type: 'interrupt'; hero: number; slot: BuildSlot }
  | { type: 'projectile'; id: number; hero: number; slot: BuildSlot; from: Vec3; radius: number; speed: number }
  | { type: 'impact'; hero: number; slot: BuildSlot; at: Vec3; radius: number; arcDegrees?: number; width?: number; range: number }
  | { type: 'hit'; source: number; target: number; slot: BuildSlot; amount: number; heavy: boolean }
  | { type: 'knockback'; hero: number; phase: 'start' | 'end' }
  /** A jump, a second jump in the air, a dash or a slide began, or the hero landed, falling at `speed` m/s (phase 2). */
  /** F switched the passive on or off; `dry` when it ran out of energy and switched itself off. */
  | { type: 'passive'; hero: number; on: boolean; dry?: boolean }
  /** The ranged weapon began reloading (until tick `until`), or finished. */
  | { type: 'reload'; hero: number; phase: 'start' | 'end'; until: number }
  /** A shot turned back by a reflect. */
  | { type: 'reflect'; hero: number; projectile: number }
  | { type: 'move'; hero: number; move: 'jump' | 'air-jump' | 'dash' | 'slide' | 'land' | 'roll' | 'mantle' | 'land-roll' | 'land-heavy' | 'zip-on' | 'zip-off'; speed?: number }
  /** Melee (the canon): a heavy charge began, a guard caught a strike, a launched hero took control back. */
  | { type: 'melee'; hero: number; what: 'charge' | 'blocked' | 'guard-broken' | 'regain' | 'launch'; by?: number }
  /** A transformation began or ended; `size` is the class the hero has now (a form may keep its own). */
  | { type: 'form'; hero: number; phase: 'start' | 'end'; size: SizeClass }
  | { type: 'death'; hero: number }
  /** A shot or blast struck a piece of cover; breakable pieces report their health left. */
  | { type: 'cover-hit'; index: number; at: Vec3; health: number }
  | { type: 'cover-broken'; index: number; at: Vec3 }
  /** A knocked-back hero struck a wall or a prop (piece `index`) at `at`, moving at `speed` m/s (§6b). */
  | { type: 'slam'; hero: number; at: Vec3; index: number; speed: number }
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
