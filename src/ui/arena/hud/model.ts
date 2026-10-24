import type { Build } from '../../../charter/build.js'
import type { BuildSlot, Template } from '../../../charter/types.js'
import type { Team } from '../../../arena/engine/state.js'
import { initials, shortName } from './format.js'
import { iconFor, toneFor, type IconKey, type Tone } from './icons'

/**
 * What the HUD knows about each hero that never changes during a match: names, portrait, and each skill's icon,
 * name and full cooldown. Built once per match; the 10 Hz store only carries what moves.
 */

export interface HudSkill {
  slot: BuildSlot
  icon: IconKey
  tone: Tone
  /** The player's own skill name (R3), else the mechanic's. */
  name: string
  /** The catalogue mechanic, e.g. "Fireball". */
  mechanic: string
  /** Seconds. */
  cooldown: number
}

export interface HudHeroInfo {
  id: number
  team: Team
  name: string
  short: string
  initials: string
  role: Build['roleId']
  portrait?: string
  skills: Record<BuildSlot, HudSkill>
}

export interface HeroSetupLike {
  build: Build
  kit: Record<BuildSlot, Template>
}

/** The ability keys of a roster card, in the order they read. */
export const CARD_SLOTS = ['active1', 'active2', 'ultimate'] as const
export const SLOT_KEY: Record<BuildSlot, string> = { basic: 'LMB', active1: 'Q', active2: 'E', passive: '', ultimate: 'R', movement: 'SHIFT' }

export function heroInfo(id: number, team: Team, setup: HeroSetupLike, portrait?: string): HudHeroInfo {
  const skills = {} as Record<BuildSlot, HudSkill>
  for (const slot of Object.keys(setup.kit) as BuildSlot[]) {
    const t = setup.kit[slot]
    const own = setup.build.slots[slot]?.name?.trim()
    skills[slot] = { slot, icon: iconFor(t), tone: toneFor(t), name: own || t.name, mechanic: t.name, cooldown: t.cooldown }
  }
  const name = setup.build.heroName
  return { id, team, name, short: shortName(name), initials: initials(name), role: setup.build.roleId, portrait, skills }
}

/** One entry per hero id, in the engine's order (side 0's formation, then side 1's). */
export function hudHeroes(setups: readonly HeroSetupLike[], teams: readonly Team[], portraits: readonly (string | undefined)[] = []): HudHeroInfo[] {
  return setups.map((s, id) => heroInfo(id, teams[id], s, portraits[id]))
}

const GENERIC: Record<BuildSlot, IconKey> = { basic: 'orb', active1: 'burst', active2: 'nova', passive: 'buff', ultimate: 'star', movement: 'dash' }

/** A stand-in when only the 10 Hz snapshot is at hand (tests, or a model not built yet): generic icons. */
export function infoFromHud(h: { id: number; team: Team; name: string; cooldowns: Partial<Record<BuildSlot, { total: number }>> }): HudHeroInfo {
  const skills = {} as Record<BuildSlot, HudSkill>
  for (const slot of Object.keys(GENERIC) as BuildSlot[]) {
    const name = SLOT_NAME[slot]
    skills[slot] = { slot, icon: GENERIC[slot], tone: slot === 'ultimate' ? 'spirit' : 'phys', name, mechanic: name, cooldown: h.cooldowns[slot]?.total ?? 0 }
  }
  return { id: h.id, team: h.team, name: h.name, short: shortName(h.name), initials: initials(h.name), role: 'fighter', skills }
}

const SLOT_NAME: Record<BuildSlot, string> = { basic: 'Basic attack', active1: 'Active 1', active2: 'Active 2', passive: 'Passive', ultimate: 'Ultimate', movement: 'Movement' }
