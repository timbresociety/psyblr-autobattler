import { COMMON_MOTIONS, type MotionSlot } from '../../../charter/motions'
import type { BuildSlot } from '../../../charter/types'

/**
 * The Forge's one kit element (GAME.md §11): a row per button, in the order of the keys under the hand. Each row is
 * what that button does (its skill, picked from the library), how it moves (the hero's own motions: V's three combo
 * strikes and its heavy blow), its effect's colour, and the reel take that plays it.
 */
export interface KitRow {
  key: 'V' | 'X' | 'LMB' | 'Q' | 'E' | 'F' | 'R'
  title: string
  /** The skill the button fires; X (block) has none. */
  slot?: BuildSlot
  /** The hero's own motions for it, picked from the library. */
  motions: readonly MotionSlot[]
  /** A motion every hero shares for it, when it has none of its own. */
  shared?: keyof typeof COMMON_MOTIONS
  /** The kit reel's take for it. */
  take: string
}

export const KIT_ROWS: readonly KitRow[] = [
  { key: 'V', title: 'Melee', slot: 'basic', motions: ['combo1', 'combo2', 'combo3', 'heavy'], take: 'combo' },
  { key: 'X', title: 'Block', motions: ['block'], take: 'block' },
  { key: 'LMB', title: 'Ranged', slot: 'active1', motions: ['active1'], take: 'ranged' },
  { key: 'Q', title: 'Spell', slot: 'active2', motions: ['active2'], take: 'active2' },
  { key: 'E', title: 'Movement', slot: 'movement', motions: [], shared: 'movement', take: 'movement' },
  { key: 'F', title: 'Passive', slot: 'passive', motions: [], shared: 'passive', take: 'passive' },
  { key: 'R', title: 'Ultimate', slot: 'ultimate', motions: ['ultimate'], take: 'ultimate' },
]

/** V's motions by the strike each one is, as the row lists them. */
export const MOTION_LABEL: Record<MotionSlot, string> = {
  combo1: 'Combo 1',
  combo2: 'Combo 2',
  combo3: 'Combo 3',
  heavy: 'Heavy',
  block: 'Block',
  active1: 'Shot',
  active2: 'Cast',
  ultimate: 'Ultimate',
}

/** The motions every hero shares that belong to no button's row: locomotion and evasion, under the rows. */
export const SHARED_MOVES = (Object.keys(COMMON_MOTIONS) as (keyof typeof COMMON_MOTIONS)[]).filter((k) => !KIT_ROWS.some((r) => r.shared === k))
