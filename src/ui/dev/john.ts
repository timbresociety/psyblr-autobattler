import type { Build } from '../../charter/build'
import { defaultLook } from '../../charter/look'
import { ALL_SIZE_CLASSES, SIZES, type SizeClass } from '../../charter/sizes'
import type { BuildSlot, MeleeStyle } from '../../charter/types'
import { heroHue } from '../../arena/client/character-look'
import type { BotMode, LabBot } from '../../arena/engine/lab'
import { MELEE_SETS, shotClips, skillClips, templateKey } from '../../arena/recipes/motions'
import { DEFAULT_KIT, labArms, labTemplate, lmb as lmbWeapon, LMB_FAMILIES, V_OPTIONS, type LabKit, type LmbFamily, type LmbFlight, type LmbMode } from '../../arena/lab/library'
import { STARTERS, starterBuild } from '../../arena/starters'
import type { AttitudeId } from '../../kit/anim/attitude'
import type { TriedHero } from '../../kit/bench/hero-file'
import { presetDials, type ArchetypeId } from '../../kit/body/physique'

/**
 * Who John is, shared by his lab (`/dev/john`) and his moves (`/dev/moves`): the picks kept in this browser, every John
 * there is, and John as the client draws him.
 */

export const PREFS = 'john-lab:prefs'
const MEDIUM_HEIGHT = 1.85

export interface Prefs {
  /** Which John: `mesh:<label>` for a generated mesh, `body:<size>` for our own body at that size. */
  john: string
  gender: 'm' | 'f'
  physique?: ArchetypeId
  attitude: AttitudeId
  kit: Required<LabKit>
  lmb: { family: LmbFamily; mode: LmbMode; flight: LmbFlight }
  bots: Record<LabBot, BotMode>
}

export const DEFAULT_PREFS: Prefs = {
  john: 'body:medium',
  gender: 'm',
  attitude: 'neutral',
  kit: DEFAULT_KIT,
  lmb: { family: 'pistol', mode: 'single', flight: 'straight' },
  bots: { ally: 'still', dummy: 'still', enemy: 'still' },
}

export const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}
export const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // a private window: the lab still works, it just forgets
  }
}

/** Whether every saved pick is still an option on its button. */
const validKit = (kit: LabKit): boolean => Object.entries(kit).every(([slot, id]) => labTemplate(id)?.slot === slot)

/** The saved picks, or the default kit where a later lab renamed an option. */
export function savedPrefs(): Prefs {
  const saved = read(PREFS, DEFAULT_PREFS)
  return validKit(saved.kit) ? saved : { ...saved, kit: DEFAULT_KIT, lmb: DEFAULT_PREFS.lmb }
}

/** The size class a mesh this tall stands nearest. */
const sizeOf = (height: number): SizeClass => ALL_SIZE_CLASSES.reduce((best, c) => (Math.abs(SIZES[c].scale - height / MEDIUM_HEIGHT) < Math.abs(SIZES[best].scale - height / MEDIUM_HEIGHT) ? c : best), 'medium' as SizeClass)

export interface John {
  key: string
  label: string
  size: SizeClass
  hero?: TriedHero
}

/** Every John: each generated mesh at its size, then our own body at every size. */
export function johnsOf(heroes: readonly TriedHero[]): John[] {
  const meshes = heroes
    .filter((h) => h.file)
    .map((h) => ({ key: `mesh:${h.label}`, label: `${SIZES[sizeOf(h.height)].label} John · ${h.label} (${h.height} m)`, size: sizeOf(h.height), hero: h }))
    .sort((a, b) => ALL_SIZE_CLASSES.indexOf(a.size) - ALL_SIZE_CLASSES.indexOf(b.size))
  const bodies = ALL_SIZE_CLASSES.map((size) => ({ key: `body:${size}`, label: `${SIZES[size].label} John · our body`, size }))
  return [...meshes, ...bodies]
}

export const fighter = (squad: 'vanguard' | 'outlaws', role: string) => starterBuild(STARTERS.find((s) => s.squad === squad && s.roleId === role)!)

/** John as the client draws him: the clips follow his V family and LMB grip; the engine takes the lab's own kit. */
export function johnBuild(prefs: Prefs, john: John): Build {
  const build = fighter('vanguard', 'fighter')
  build.heroName = 'John'
  build.sizeClass = john.size
  const look = build.look ?? defaultLook('fighter', 'John', heroHue('John'))
  build.look = { ...look, gender: john.hero?.gender ?? prefs.gender, attitude: prefs.attitude }
  if (!john.hero && prefs.physique) build.look.physique = presetDials(prefs.physique)
  else delete build.look.physique
  const style = (V_OPTIONS.find((o) => o.id === prefs.kit.basic)?.template.style ?? 'blade') as MeleeStyle
  build.slots.basic = { ...build.slots.basic, templateId: `melee-${style}` }
  const lmb = LMB_FAMILIES.find((f) => f.id === prefs.lmb.family)!
  build.slots.active1 = { ...build.slots.active1, templateId: lmb.standIn }
  // his weapons swap in and out by what he does: the V family's for a blow, the LMB family's for a shot
  // the stand-in skill is the nearest the catalogue has: his shot is his grip's and way of firing's own (paired guns, a
  // heavy gun, a bow and every way of firing are the lab's alone), and his Q, E, F and R play the clip of what the lab
  // gave him (its shape or kind; an R lock-on his family's flurry), not his stand-in kit's. Each the first that nothing
  // else of his plays, as kitMotions picks them
  const set = MELEE_SETS[style]
  const taken = new Set<string>([...set.chain, set.heavy, set.block, set.dash, set.air, set.slam, set.launcher, set.grab])
  const own = (clips: readonly string[] | undefined) => {
    const clip = clips?.find((c) => !taken.has(c)) ?? clips?.[0]
    if (clip) taken.add(clip)
    return clip
  }
  const weapon = lmbWeapon(prefs.lmb.family, prefs.lmb.mode, prefs.lmb.flight)
  const shot = own(shotClips(weapon))
  if (shot) build.look.motions = { ...build.look.motions, active1: shot }
  // and what each is, for any other source of clips that goes by that (the stand-ins' own templates would say otherwise)
  const kinds: Partial<Record<BuildSlot, string | undefined>> = { active1: templateKey(weapon, 'active1') }
  for (const slot of ['active2', 'movement', 'passive', 'ultimate'] as const) {
    const pick = labTemplate(prefs.kit[slot])?.template
    const clip = pick && own(skillClips(pick, slot, style))
    if (clip) build.look.motions = { ...build.look.motions, [slot]: clip }
    if (pick) kinds[slot] = templateKey(pick, slot)
  }
  build.look.kinds = Object.fromEntries(Object.entries(kinds).filter(([, key]) => key)) as Partial<Record<BuildSlot, string>>
  delete build.look.gear
  build.look.arms = labArms(style, prefs.lmb.family)
  return build
}
