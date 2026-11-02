import type { Build } from '../../charter/build.js'
import { COMMON_MOTIONS, MOTION_SKILL, MOTION_SLOT_KINDS, MOTION_SLOTS, fitOf, pickMotion, type MotionSlot, type Style } from '../../charter/motions.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { BuildSlot, RangedStyle, RoleId } from '../../charter/types.js'
import { animIndexNow } from '../client/anim-index.js'
import type { MeleeBlow } from '../engine/combat.js'

/** How each role fights when neither its kit nor its look says (a build from before the rows). */
export const ROLE_STYLE: Record<RoleId, Style> = {
  tank: 'shield',
  fighter: 'unarmed',
  assassin: 'blade',
  mage: 'kicks',
  marksman: 'rifle',
  support: 'staff',
  controller: 'greatsword',
  summoner: 'club',
}

/** Roles that keep their range, and so carry their ranged weapon while they move (deliveries.ts isRanged). */
const KEEPS_RANGE = new Set<RoleId>(['mage', 'marksman', 'support', 'controller', 'summoner'])

/** The clips a ranged weapon's style plays (§4 LMB): guns their own, a thrown weapon anything, magic the magic set. */
const RANGED_CLIPS: Record<RangedStyle, Style> = { pistol: 'pistol', rifle: 'rifle', thrown: 'any', magic: 'magic' }

/**
 * The hero's melee style (§4 V): its look's when it names one (a dev or Forge override), else its melee template's,
 * else its role's. The combo, the heavy blow and the block are picked from it.
 */
export const styleOf = (build: Pick<Build, 'roleId' | 'look' | 'slots'>): Style => build.look?.style ?? templateOf(build, 'basic')?.style ?? ROLE_STYLE[build.roleId]

/** The style the ranged weapon's clip is picked from. */
export const rangedStyleOf = (build: Pick<Build, 'roleId' | 'look' | 'slots'>): Style => {
  const ranged = templateOf(build, 'active1')?.ranged
  return ranged ? RANGED_CLIPS[ranged.style] : styleOf(build)
}

/**
 * The gun a hero moves with (§12 weapon-held locomotion): its look's when it names one, else a pistol or rifle on its
 * LMB when its role keeps its range; a melee role moves unarmed between swings.
 */
export function carriedStyle(build: Pick<Build, 'roleId' | 'look' | 'slots'>): Style | undefined {
  if (build.look?.style) return build.look.style
  const ranged = templateOf(build, 'active1')?.ranged
  return ranged && KEEPS_RANGE.has(build.roleId) && (ranged.style === 'rifle' || ranged.style === 'pistol') ? ranged.style : undefined
}

/** A slot's catalogue template, or undefined for one the catalogue doesn't know. */
export function templateOf(build: Pick<Build, 'slots'>, slot: BuildSlot) {
  const id = build.slots[slot]?.templateId
  try {
    return id ? getTemplate(id) : undefined
  } catch {
    return undefined
  }
}

const picked = new WeakMap<object, Record<MotionSlot, string | undefined>>()

/**
 * The hero's own eight motions (MOTION_SLOTS): its look's own, else the catalogue's pick for each in the hero's style,
 * a skill's fitting what it does (fitOf), never two the same. Worked out once per build and kept while the library's
 * index stays the same; undefined ones only before it has loaded.
 */
export function kitMotions(build: Build): Record<MotionSlot, string | undefined> {
  const known = picked.get(build)
  if (known) return known
  const combat = animIndexNow('standard')?.genders.m.sets.combat
  const has = combat ? (id: string) => id in combat : undefined
  const chosen = { ...build.look?.motions }
  const taken = new Set(Object.values(chosen).filter(Boolean) as string[])
  const out = {} as Record<MotionSlot, string | undefined>
  for (const slot of MOTION_SLOTS) {
    const skill = MOTION_SKILL[slot]
    const fit = skill ? fitOf(templateOf(build, skill), skill) : { clips: [], kinds: MOTION_SLOT_KINDS[slot] }
    // a combo's steps take their own kinds: the opener and the second are light, the finisher heavy
    const kinds = slot === 'combo1' ? MOTION_SLOT_KINDS.combo1 : fit.kinds
    const pick = chosen[slot] ?? pickMotion(kinds, slot === 'active1' ? rangedStyleOf(build) : styleOf(build), `${build.heroName}/${skill ? (build.slots[skill]?.templateId ?? slot) : slot}`, taken, has, fit.clips) ?? (slot === 'block' ? 'standing_block_idle' : undefined)
    if (pick) taken.add(pick)
    out[slot] = pick
  }
  if (combat) picked.set(build, out)
  return out
}

/**
 * The motion a skill plays: its own (kitMotions; the basic attack's is the combo's opener), or for the passive's toggle
 * and the movement skill the one every hero shares (COMMON_MOTIONS).
 */
export function skillMotion(build: Build, slot: BuildSlot): string | undefined {
  if (slot === 'passive' || slot === 'movement') return COMMON_MOTIONS[slot].clip
  return kitMotions(build)[slot === 'basic' ? 'combo1' : slot]
}

/** A hero's basic attack chain (light, light, the finisher) and its charged heavy blow, each its own clip. */
export interface MeleeSet {
  chain: readonly [string, string, string]
  heavy: string
}

/** The clips the V attack plays (kitMotions): the combo's three steps and the held heavy blow. */
export function meleeSet(build: Build): MeleeSet | undefined {
  if (!animIndexNow('standard')) return undefined
  const k = kitMotions(build)
  return { chain: [k.combo1 ?? 'jab_cross', k.combo2 ?? 'cross_punch', k.combo3 ?? 'uppercut'], heavy: k.heavy ?? 'surprise_uppercut' }
}

/** The clip a basic attack's blow plays: its step of the chain, or the charged heavy blow. */
export function meleeClip(build: Build, blow: MeleeBlow): string | undefined {
  const set = meleeSet(build)
  return set && (blow.heavy !== undefined ? set.heavy : set.chain[Math.min(2, blow.step)])
}

/** The guard the hero holds while blocking (kitMotions). */
export const blockMotion = (build: Build): string => kitMotions(build).block ?? 'standing_block_idle'
