import type { SizeClass } from '../../charter/sizes.js'
import type { BuildSlot } from '../../charter/types.js'
import type { BlowKind } from './combat.js'
import type { Vec3 } from './maths.js'

/** What happened in a tick, for the client to draw and sound (KTD3, KTD9). The engine never reads its own events. */
export type MatchEvent =
  /** A cast began its wind-up: it lands on tick `release` and the hero is free again on tick `ends` (phase 1). */
  | { type: 'cast'; hero: number; slot: BuildSlot; templateId: string; release: number; ends: number; melee?: { step: number; heavy?: number; kind?: BlowKind } }
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
  | { type: 'move'; hero: number; move: 'jump' | 'air-jump' | 'dash' | 'slide' | 'land' | 'roll' | 'mantle' | 'land-roll' | 'land-heavy' | 'zip-on' | 'zip-off' | 'hang' | 'climb' | 'let-go' | 'dive' | 'chase' | 'wake-roll' | 'wall-run' | 'wall-jump' | 'pad' | 'teleport' | 'swap' | 'homing' | 'swing' | 'flight' | 'glide' | 'wall-crawl' | 'burrow' | 'emerge' | 'ride' | 'power-slide'; speed?: number }
  /** A line an E skill hung (a Zipline), from `a` to `b`, or taken down. */
  | { type: 'line'; index: number; owner: number; phase: 'up' | 'down'; a: Vec3; b: Vec3 }
  /** Melee (the canon): a heavy charge began, a guard caught a strike, a launched hero took control back. */
  /**
   * The full kit's fight moves (GAME.md §4): a perfect guard and the stagger it gives, knockdowns and getting up, the
   * grab (or its miss) and the throw, the slam and its landing, an air hit holding its target up, and the third
   * spiking it down.
   */
  | { type: 'melee'; hero: number; what: 'charge' | 'blocked' | 'guard-broken' | 'regain' | 'launch' | 'parry' | 'stagger' | 'knockdown' | 'get-up' | 'grab' | 'grab-miss' | 'throw' | 'slam' | 'slam-land' | 'juggle' | 'spike'; by?: number }
  /** A held beam began or ended (channel mode); two beams met and clashed, or the clash broke toward `loser`. */
  | { type: 'beam'; hero: number; phase: 'on' | 'off' }
  | { type: 'clash'; a: number; b: number; phase: 'start' | 'end'; loser?: number; at: Vec3 }
  /** A shot bounced off a wall, or turned back for its owner's hand. */
  | { type: 'flight'; id: number; what: 'bounce' | 'return'; at: Vec3 }
  /** A hold-to-charge cast began charging, or was let go at `power` (§4 Systems). */
  | { type: 'charge'; hero: number; slot: BuildSlot; phase: 'start' | 'release'; power?: number }
  /** Downed at no health, an ally starting to revive it, revived, or bled out (GAME.md §4 Team). */
  | { type: 'downed'; hero: number; phase: 'down' | 'revive-start' | 'revived' | 'out'; by?: number }
  /** A transformation began or ended; `size` is the class the hero has now (a form may keep its own). */
  | { type: 'form'; hero: number; phase: 'start' | 'end' | 'stage'; size: SizeClass; stage?: number }
  /** A hit carried the striker's element onto `hero` (lightning leaping on to `to`). */
  | { type: 'element'; hero: number; from: number; element: 'flame' | 'frost' | 'lightning'; to?: number }
  /** A cast spent from the power meter, leaving `power`. */
  | { type: 'power'; hero: number; power: number }
  /** A Strike locked on to `target`, landed blow `n`, or let go. */
  | { type: 'lockon'; hero: number; target: number; phase: 'start' | 'blow' | 'end'; n: number }
  /** A fusion of `hero` with `ally` began or ended. */
  | { type: 'fuse'; hero: number; ally: number; phase: 'start' | 'end' }
  /** A team-up: `ally` threw `hero`, or `hero` came down. */
  | { type: 'teamup'; hero: number; ally: number; phase: 'throw' | 'land' }
  | { type: 'death'; hero: number }
  /** A shot or blast struck a piece of cover; breakable pieces report their health left. */
  | { type: 'cover-hit'; index: number; at: Vec3; health: number }
  | { type: 'cover-broken'; index: number; at: Vec3 }
  /** A knocked-back hero struck a wall or a prop (piece `index`) at `at`, moving at `speed` m/s (§6b). */
  | { type: 'slam'; hero: number; at: Vec3; index: number; speed: number }
  | { type: 'end'; winner: 0 | 1 | 'draw'; reason: 'wipe' | 'time' }
  /** The house edge (house-rules.ts) began closing, or stopped: `phase` closes have begun. */
  | { type: 'edge'; phase: number; closing: boolean }
  /** The edge took `amount` health from a hero left outside it. */
  | { type: 'edge-hurt'; hero: number; amount: number }
  /** The House Vault cracked open, or a squad took the jackpot from it, or stole it from the squad holding it. */
  | { type: 'vault'; what: 'open' | 'cracked' | 'stolen'; team?: 0 | 1 }
  /** A status landed on a hero: control, a debuff, a state, until a tick (cleanse reports the tick it fired). */
  | { type: 'status'; hero: number; status: string; until: number }
  /** A basic attack missed: blinded, or turned aside by evasion. */
  | { type: 'miss'; source: number; target: number }
  /** A lingering field or a trap: raised, pulsing, sprung or gone. */
  | { type: 'field'; id: number; owner: number; slot: BuildSlot; phase: 'start' | 'pulse' | 'end'; at: Vec3; radius: number; trap: boolean; sprung?: boolean }
  /** A turret: built, firing at a point, or gone. */
  | { type: 'turret'; id: number; owner: number; phase: 'start' | 'shot' | 'end'; at: Vec3; to?: Vec3 }
  /** A wall a skill raised, as a box: up, or fallen when its time ran out. */
  | { type: 'wall'; index: number; owner: number; phase: 'up' | 'down'; at: Vec3; hx: number; hz: number; top: number; look?: string; base?: number; slope?: { rise: 'x+' | 'x-' | 'z+' | 'z-'; low: number } }
  /** A counter answered `source`'s blow on `hero` (§4 Q Counter). */
  | { type: 'counter'; hero: number; source: number; answer: 'strike' | 'substitute' | 'reflect' | 'absorb' }
  /** A summoned body came in or went (§4 Q Summon). */
  | { type: 'summon'; hero: number; owner: number; what: 'minion' | 'clone' | 'decoy' | 'titan'; phase: 'in' | 'out' }
  /** A pair of portals opened, closed, or took hero `who` through from `a` to `b` (or back). */
  | { type: 'portal'; id: number; owner: number; phase: 'open' | 'close' | 'through'; a: Vec3; b: Vec3; who?: number }
  /** A hero's kit was replaced (a copy, a switch, a form's moveset), from hero `from`'s, or given back. */
  | { type: 'kit'; hero: number; phase: 'start' | 'end'; why: 'copy' | 'switch' | 'form'; from?: number }
  /** Hero `by` took control of `hero`, or let go. */
  | { type: 'possess'; hero: number; by: number; phase: 'start' | 'end' }
  /** Hero `by` lifted `hero` into the air, or threw it. */
  | { type: 'lift'; hero: number; by: number; phase: 'up' | 'throw' }
