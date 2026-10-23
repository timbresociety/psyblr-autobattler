import { proposeBuild, type Build } from '../../charter/build'
import type { SizeClass } from '../../charter/sizes'
import type { RoleId } from '../../charter/types'

/**
 * The demo roster (U1): 10 business moguls and 10 political leaders as superhero and anime-inspired parodies.
 * They load the performance bench and fill the staging loadout before any hero is forged.
 */

export type DemoFaction = 'mogul' | 'leader'

export interface DemoHero {
  faction: DemoFaction
  heroName: string
  roleId: RoleId
  sizeClass: SizeClass
  /** Signature colour for the bench body and its effects. */
  hue: number
  ultimate: string
}

export const DEMO_HEROES: readonly DemoHero[] = [
  { faction: 'mogul', heroName: 'Elon "Starship" Musk', roleId: 'mage', sizeClass: 'large', hue: 0.58, ultimate: 'Full Stack Launch' },
  { faction: 'mogul', heroName: 'Jensen "CUDA Core" Huang', roleId: 'marksman', sizeClass: 'medium', hue: 0.33, ultimate: 'Tensor Barrage' },
  { faction: 'mogul', heroName: 'Jeff "Prime" Bezos', roleId: 'tank', sizeClass: 'huge', hue: 0.08, ultimate: 'Same-Day Delivery' },
  { faction: 'mogul', heroName: 'Mark "Metaverse" Zuckerberg', roleId: 'assassin', sizeClass: 'small', hue: 0.62, ultimate: 'Infinite Scroll' },
  { faction: 'mogul', heroName: 'Satya "Copilot" Nadella', roleId: 'support', sizeClass: 'medium', hue: 0.55, ultimate: 'Cloud Ascension' },
  { faction: 'mogul', heroName: 'Sam "AGI" Altman', roleId: 'controller', sizeClass: 'small', hue: 0.75, ultimate: 'Scaling Law' },
  { faction: 'mogul', heroName: 'Warren "Oracle" Buffett', roleId: 'summoner', sizeClass: 'tiny', hue: 0.14, ultimate: 'Compound Interest' },
  { faction: 'mogul', heroName: 'Oprah "You Get One" Winfrey', roleId: 'fighter', sizeClass: 'medium', hue: 0.85, ultimate: 'Everybody Gets One' },
  { faction: 'mogul', heroName: 'Mukesh "Jio" Ambani', roleId: 'tank', sizeClass: 'large', hue: 0.02, ultimate: 'Network Effect' },
  { faction: 'mogul', heroName: 'Lisa "Zen Core" Su', roleId: 'assassin', sizeClass: 'tiny', hue: 0.0, ultimate: 'Chiplet Storm' },
  { faction: 'leader', heroName: 'Abraham "Honest Axe" Lincoln', roleId: 'fighter', sizeClass: 'huge', hue: 0.1, ultimate: 'Emancipation Cleave' },
  { faction: 'leader', heroName: 'Winston "Bulldog" Churchill', roleId: 'tank', sizeClass: 'large', hue: 0.05, ultimate: 'Finest Hour' },
  { faction: 'leader', heroName: 'Barack "Hope Beam" Obama', roleId: 'marksman', sizeClass: 'medium', hue: 0.6, ultimate: 'Yes We Can' },
  { faction: 'leader', heroName: 'Donald "Dealmaker" Trump', roleId: 'fighter', sizeClass: 'large', hue: 0.12, ultimate: 'Art of the Deal' },
  { faction: 'leader', heroName: 'Narendra "Saffron Storm" Modi', roleId: 'mage', sizeClass: 'medium', hue: 0.07, ultimate: 'Digital India' },
  { faction: 'leader', heroName: 'Angela "Iron Chancellor" Merkel', roleId: 'controller', sizeClass: 'medium', hue: 0.95, ultimate: 'We Can Do This' },
  { faction: 'leader', heroName: 'Emmanuel "Jupiter" Macron', roleId: 'assassin', sizeClass: 'small', hue: 0.66, ultimate: 'En Marche' },
  { faction: 'leader', heroName: 'Volodymyr "Kyiv Shield" Zelenskyy', roleId: 'tank', sizeClass: 'medium', hue: 0.16, ultimate: 'I Need Ammunition' },
  { faction: 'leader', heroName: 'Jacinda "Kindness Wave" Ardern', roleId: 'support', sizeClass: 'small', hue: 0.45, ultimate: 'Be Kind' },
  { faction: 'leader', heroName: 'Lee Kuan "Miracle" Yew', roleId: 'summoner', sizeClass: 'tiny', hue: 0.0, ultimate: 'First World Leap' },
]

/** A Charter build for a demo hero: the role's proposed kit, with the hero's own ultimate name. */
export function demoBuild(hero: DemoHero): Build {
  const result = proposeBuild({ heroName: hero.heroName, roleId: hero.roleId, skills: { ultimate: { name: hero.ultimate, flavour: '' } } })
  if (!result.ok) throw new Error(`demo build failed for ${hero.heroName}`)
  // medium is the default and is stored as absent, the same as hydrateBuild
  return hero.sizeClass === 'medium' ? result.build : { ...result.build, sizeClass: hero.sizeClass }
}

export const demoRoster = (): Build[] => DEMO_HEROES.map(demoBuild)
