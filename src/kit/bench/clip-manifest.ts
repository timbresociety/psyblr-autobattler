import { COMMON_MOTIONS, MOTIONS } from '../../charter/motions.js'
import { GAIT_CLIPS } from '../../arena/client/gait.js'
import { LIBRARY_MOVES } from '../../arena/client/library-gait.js'
import { COVERAGE } from '../anim/coverage.js'
import { WEAPON_GAIT, WEAPON_MOVES } from '../anim/weapon-gait.js'

/**
 * Every clip the game can play, with what it plays it for (the clip audit, docs/plans/2026-11-05-session-1-handoff.md),
 * read off the game's own tables so it can't fall behind them. `played` is a clip the engine or the catalogue reaches
 * today; a clip only the coverage manifest names is a `candidate`: it stands behind a role, nothing plays it yet.
 */
export type UseKind = 'gait' | 'stance' | 'held' | 'move' | 'strike' | 'shot' | 'spell' | 'react' | 'knockdown' | 'traversal' | 'emote'

export interface ClipUse {
  /** The table it comes from. */
  from: 'gait' | 'engine' | 'weapon' | 'kit' | 'common' | 'coverage'
  /** Its name there: an engine move, a gait, a motion's style and kind, a coverage role. */
  role: string
  kind: UseKind
}

/** The engine's moves that hold a pose or loop until the player leaves it, not one-shots (animation.ts HELD_KINDS). */
const HELD = new Set(['block', 'crouch', 'crouch_move', 'prone', 'prone_move', 'launched', 'zip', 'rail', 'hang', 'hang_left', 'hang_right', 'air'])
const REACTS = new Set(['hurt', 'stunned', 'fall'])
const TRAVERSAL = new Set(['mantle', 'catch', 'climb', 'land', 'land_roll', 'land_heavy'])
const STRIKES = new Set(['slash', 'ultimate'])
const SHOTS = new Set(['shoot', 'crouch_fire', 'prone_fire'])
const SPELLS = new Set(['cast', 'toggle', 'charge'])

const engineKind = (move: string): UseKind => (HELD.has(move) ? 'held' : REACTS.has(move) ? 'react' : TRAVERSAL.has(move) ? 'traversal' : STRIKES.has(move) ? 'strike' : SHOTS.has(move) ? 'shot' : SPELLS.has(move) ? 'spell' : 'move')

const MOTION_KIND: Record<string, UseKind> = { light: 'strike', heavy: 'strike', ranged: 'shot', spell: 'spell', movement: 'move', ultimate: 'strike', passive: 'spell', dodge: 'move', block: 'held', react: 'react', knockdown: 'knockdown', jump: 'move', move: 'move' }

/** What a coverage role's clips are, by the entry's kind and the role's name. */
function coverageKind(kind: string, role: string): UseKind {
  if (/^(idle|aimIdle|crouch|prone|block)$/.test(role) || role === 'ledgeHang') return 'held'
  if (/^(walk|run|sprint|jog|strafe|backpedal|aimWalk|crouchWalk|crawl)/.test(role)) return 'gait'
  if (kind === 'traversal') return 'traversal'
  if (role === 'light' || role === 'heavy') return 'strike'
  if (role === 'fire') return 'shot'
  if (role === 'cast') return 'spell'
  if (/hit|Hit|guardBroken/.test(role)) return 'react'
  if (/knockdown|getUp/.test(role)) return 'knockdown'
  if (role === 'emote' || role === 'entrance') return 'emote'
  return 'move'
}

/** Clip name to its uses, in the order the tables list them. */
export function clipManifest(stances: readonly string[] = []): Map<string, ClipUse[]> {
  const out = new Map<string, ClipUse[]>()
  const add = (clip: string, use: ClipUse) => out.set(clip, [...(out.get(clip) ?? []), use])
  for (const clip of GAIT_CLIPS) add(clip, { from: 'gait', role: clip, kind: 'gait' })
  for (const clip of stances) add(clip, { from: 'gait', role: 'stance', kind: 'stance' })
  for (const [move, clip] of Object.entries(LIBRARY_MOVES)) add(clip, { from: 'engine', role: move, kind: engineKind(move) })
  for (const [weapon, set] of Object.entries(WEAPON_GAIT)) {
    add(set.stance, { from: 'weapon', role: `${weapon} stance`, kind: 'stance' })
    for (const [gait, clip] of Object.entries(set.clips)) add(clip, { from: 'weapon', role: `${weapon} ${gait}`, kind: 'gait' })
  }
  for (const [weapon, moves] of Object.entries(WEAPON_MOVES)) for (const [move, clip] of Object.entries(moves)) add(clip, { from: 'weapon', role: `${weapon} ${move}`, kind: engineKind(move) })
  for (const m of MOTIONS) add(m.id, { from: 'kit', role: `${m.style} ${m.kind}`, kind: MOTION_KIND[m.kind] })
  for (const [slot, m] of Object.entries(COMMON_MOTIONS)) add(m.clip, { from: 'common', role: slot, kind: slot === 'passive' ? 'spell' : slot === 'prone' || slot === 'crouch' ? 'held' : slot === 'move' || slot === 'sprint' ? 'gait' : 'move' })
  for (const c of COVERAGE) for (const [role, r] of Object.entries(c.roles)) for (const clip of r.clips) add(clip, { from: 'coverage', role: `${c.id} ${role}`, kind: coverageKind(c.kind, role) })
  return out
}

/** Whether anything plays the clip today, rather than only standing behind a coverage role. */
export const isPlayed = (uses: readonly ClipUse[]) => uses.some((u) => u.from !== 'coverage')
