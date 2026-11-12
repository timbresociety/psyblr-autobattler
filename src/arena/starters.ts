import { BUILD_SLOTS, SLOT_KIND, proposeBuild, type Build } from '../charter/build.js'
import { defaultLook, type HeroLook } from '../charter/look.js'
import { ELEMENTS, type Element, type SkillLook } from '../charter/skill-look.js'
import type { SizeClass } from '../charter/sizes.js'
import { poolFor } from '../charter/templates/catalog.js'
import { LATER_STYLES } from '../charter/templates/styles.js'
import type { BuildSlot, RoleId } from '../charter/types.js'
import { skillLookOf } from './recipes/looks.js'

/**
 * The starter squads (GAME.md §13: the demo roster is dropped, balance uses generated kits). Two squads of ten
 * generated heroes fill the staging row, the loadout and the arena's try-it before anyone forges a hero: every role at
 * least once a squad, a kit drawn from each row's pool, an invented name, a body and colours drawn from the same seed.
 * Nothing about them is hand-made, so each starter is a fair sample of what the Forge builds.
 */

export type Squad = 'vanguard' | 'outlaws'

export const SQUAD_NAME: Record<Squad, string> = { vanguard: 'Vanguard', outlaws: 'Outlaws' }
export const SQUADS: readonly Squad[] = ['vanguard', 'outlaws']

export interface Starter {
  id: string
  squad: Squad
  heroName: string
  roleId: RoleId
  sizeClass: SizeClass
  /** Signature colour for the stand-in body and its effects. */
  hue: number
  /** What its skills are made of when their words name nothing. */
  element: Element
  build: Build
}

const ROLE_ORDER: readonly RoleId[] = ['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support', 'controller', 'summoner']
const SIZES: readonly SizeClass[] = ['tiny', 'small', 'medium', 'medium', 'medium', 'large', 'huge']
const FIRST = ['Ash', 'Bram', 'Cinder', 'Dax', 'Echo', 'Fen', 'Gale', 'Hex', 'Iris', 'Jinx', 'Kestrel', 'Lark', 'Mire', 'Nova', 'Onyx', 'Pike', 'Quill', 'Rook', 'Sable', 'Tamsin', 'Umber', 'Vesper', 'Wren', 'Xan', 'Yara', 'Zephyr']
const EPITHET = ['Ironhide', 'Quickstep', 'Nightglass', 'Emberfall', 'Stormcall', 'Duskmantle', 'Brightwater', 'Stonejaw', 'Hollowbranch', 'Redthorn', 'Frostvein', 'Goldspark', 'Ashwhisper', 'Highwind', 'Deeproot', 'Starling', 'Coldiron', 'Wildfire', 'Silverleaf', 'Thornwick', 'Blackmoor', 'Swiftwater', 'Sunhallow', 'Ravencrest']
// the hair styles the starters once drew from: only their count matters now, for the draw (see generate)
const HAIR: readonly string[] = ['buzz', 'crop', 'short', 'curly', 'swept', 'spiky', 'bob', 'long', 'volume', 'none']
// brow colours
const HAIR_COLORS = ['#1d1612', '#3c2819', '#5a3a22', '#8a5a33', '#c79a5b', '#d8c7a3', '#6b6b70', '#7a1f1f']

/** A small seeded generator (mulberry32): the same seed always gives the same squads. */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Three decimals, as a stored look keeps them. */
const round = (x: number) => Math.round(x * 1000) / 1000

const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)]

/** One squad's roles: all eight, then two more drawn at random. */
const squadRoles = (rng: () => number): RoleId[] => [...ROLE_ORDER, pick(rng, ROLE_ORDER), pick(rng, ROLE_ORDER)]

function generate(seed: number): Starter[] {
  const rng = seeded(seed)
  // the HUD and the kill feed name a hero by its surname, so no two starters share one
  const surnames = new Set<string>()
  const out: Starter[] = []
  for (const squad of SQUADS) {
    for (const roleId of squadRoles(rng)) {
      let surname = ''
      do surname = pick(rng, EPITHET)
      while (surnames.has(surname))
      surnames.add(surname)
      const heroName = `${pick(rng, FIRST)} ${surname}`
      const sizeClass = pick(rng, SIZES)
      const hue = Math.round(rng() * 1000) / 1000
      const element = pick(rng, ELEMENTS)
      const proposal = proposeBuild({ heroName, roleId, skills: {} })
      if (!proposal.ok) throw new Error(`starter build failed for ${heroName}`)
      const slots = Object.fromEntries(
        BUILD_SLOTS.map((slot) => {
          // the counter family and the new melee families came after the starters were drawn: left out, so every
          // starter keeps the skills it had
          const pool = poolFor(roleId, SLOT_KIND[slot]).filter((t) => t.family !== 'counter' && !LATER_STYLES.has(t.id))
          return [slot, { ...proposal.build.slots[slot], templateId: pick(rng, pool).id }]
        }),
      ) as Build['slots']
      const gender = rng() < 0.5 ? 'm' : 'f'
      const browColor = pick(rng, HAIR_COLORS)
      // every colour written down, so a remix under another name looks the same
      const base = defaultLook(roleId, heroName, hue)
      const physique = { weight: round(0.3 + rng() * 0.4), muscle: round(0.3 + rng() * 0.5), age: round(rng() * 0.6) }
      // heroes are drawn bare now (owner, 2026-11-04); the draw that picked a hair style stays, so every starter after
      // this one keeps its skills
      pick(rng, HAIR)
      const look: HeroLook = { ...base, gender, physique, colors: { ...base.colors, brow: browColor } }
      // each skill's look is read once from its template and the hero's element, and kept with the hero like a forged one's
      const skills: Partial<Record<BuildSlot, SkillLook>> = {}
      for (const slot of BUILD_SLOTS) {
        const skill = skillLookOf({ slots }, slot, element)
        if (skill) skills[slot] = skill
      }
      const build: Build = { ...proposal.build, slots, look: { ...look, skills }, ...(sizeClass === 'medium' ? {} : { sizeClass }) }
      out.push({ id: `${squad}-${out.length}`, squad, heroName, roleId, sizeClass, hue, element, build })
    }
  }
  return out
}

/** The starters every staging row and loadout begins with. */
export const STARTERS: readonly Starter[] = generate(20261102)

/** A starter's build, copied so nothing that edits one can reach another. */
export const starterBuild = (starter: Starter): Build => structuredClone(starter.build)
