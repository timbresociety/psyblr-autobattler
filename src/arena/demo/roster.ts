import { BUILD_SLOTS, proposeBuild, type Build } from '../../charter/build.js'
import type { Element, SkillLook } from '../../charter/skill-look.js'
import type { SizeClass } from '../../charter/sizes.js'
import type { BuildSlot, RoleId } from '../../charter/types.js'
import { skillLookOf } from '../recipes/looks.js'
import { demoLook } from './looks.js'

/**
 * The demo roster (U1): 10 business moguls and 10 political leaders as superhero and anime-inspired parodies.
 * They load the performance bench and fill the staging loadout before any hero is forged.
 */

export type DemoFaction = 'mogul' | 'leader'

export const FACTION_NAME: Record<DemoFaction, string> = { mogul: 'Moguls', leader: 'World leaders' }

export interface DemoHero {
  /** Its look (looks.ts) and its portrait (public/kit/faces/<id>.webp). */
  id: string
  faction: DemoFaction
  heroName: string
  roleId: RoleId
  sizeClass: SizeClass
  /** Signature colour for the bench body and its effects. */
  hue: number
  /** What their skills are made of when the skill's own words name nothing: Musk's are cosmic, Buffett's are money. */
  element: Element
  ultimate: string
  /** The kit, one template per slot (basic, active 1, active 2, passive, ultimate, movement), chosen to fit the persona. */
  kit: readonly [string, string, string, string, string, string]
  /** Retune steps the balance gate gives this kit, as it would a forged hero's (negative lifts a weak kit). */
  retune?: number
}

export const DEMO_HEROES: readonly DemoHero[] = [
  { id: 'musk', faction: 'mogul', heroName: 'Elon "Starship" Musk', roleId: 'mage', sizeClass: 'large', hue: 0.58, element: 'cosmic', ultimate: 'Full Stack Launch', kit: ['mage-void-orb', 'mage-comet', 'mage-flame-pillar', 'mage-flux', 'mage-meteor-storm', 'mage-teleport'], retune: 3 },
  { id: 'huang', faction: 'mogul', heroName: 'Jensen "CUDA Core" Huang', roleId: 'marksman', sizeClass: 'medium', hue: 0.33, element: 'tech', ultimate: 'Tensor Barrage', kit: ['marksman-railgun', 'marksman-ricochet', 'marksman-overdrive', 'marksman-headhunter', 'marksman-bullet-storm', 'marksman-jetpack'], retune: 4 },
  { id: 'bezos', faction: 'mogul', heroName: 'Jeff "Prime" Bezos', roleId: 'tank', sizeClass: 'huge', hue: 0.08, element: 'metal', ultimate: 'Same-Day Delivery', kit: ['tank-heavy-strike', 'tank-chain-hook', 'tank-barricade', 'tank-thick-hide', 'tank-avalanche', 'tank-bulldozer'], retune: -0.5 },
  { id: 'zuckerberg', faction: 'mogul', heroName: 'Mark "Metaverse" Zuckerberg', roleId: 'assassin', sizeClass: 'small', hue: 0.62, element: 'tech', ultimate: 'Infinite Scroll', kit: ['assassin-silenced-pistol', 'assassin-death-mark', 'assassin-vanish', 'assassin-shadow-instinct', 'assassin-vendetta', 'assassin-shadow-step'], retune: -8.5 },
  { id: 'nadella', faction: 'mogul', heroName: 'Satya "Copilot" Nadella', roleId: 'support', sizeClass: 'medium', hue: 0.55, element: 'light', ultimate: 'Cloud Ascension', kit: ['support-light-ray', 'support-healing-totem', 'support-purify', 'support-aura-of-renewal', 'support-sanctuary', 'mage-teleport'] },
  { id: 'altman', faction: 'mogul', heroName: 'Sam "AGI" Altman', roleId: 'controller', sizeClass: 'small', hue: 0.75, element: 'cosmic', ultimate: 'Scaling Law', kit: ['controller-gravity-orb', 'controller-time-dilation', 'controller-silence-field', 'controller-mind-fray', 'mage-time-stop', 'shared-phase-shift'], retune: 1.5 },
  { id: 'buffett', faction: 'mogul', heroName: 'Warren "Oracle" Buffett', roleId: 'summoner', sizeClass: 'tiny', hue: 0.14, element: 'money', ultimate: 'Compound Interest', kit: ['summoner-drone-zap', 'summoner-war-drum', 'summoner-proximity-mine', 'summoner-salvage', 'summoner-totem-of-war', 'summoner-thruster-skid'], retune: -1 },
  { id: 'winfrey', faction: 'mogul', heroName: 'Oprah "You Get One" Winfrey', roleId: 'fighter', sizeClass: 'medium', hue: 0.85, element: 'sound', ultimate: 'Everybody Gets One', kit: ['fighter-combo-strikes', 'fighter-second-wind', 'fighter-haymaker', 'fighter-bloodlust', 'fighter-blade-storm', 'fighter-gap-closer'] },
  { id: 'ambani', faction: 'mogul', heroName: 'Mukesh "Jio" Ambani', roleId: 'tank', sizeClass: 'large', hue: 0.02, element: 'tech', ultimate: 'Network Effect', kit: ['tank-shoulder-cannon', 'tank-magnetize', 'tank-fortify', 'tank-bulwark', 'tank-unbreakable', 'marksman-jetpack'], retune: -5.5 },
  { id: 'su', faction: 'mogul', heroName: 'Lisa "Zen Core" Su', roleId: 'assassin', sizeClass: 'tiny', hue: 0.0, element: 'lightning', ultimate: 'Chiplet Storm', kit: ['assassin-throwing-knives', 'assassin-kunai-volley', 'assassin-crippling-poison', 'assassin-precision', 'assassin-death-blossom', 'assassin-wall-run'], retune: 4 },
  { id: 'lincoln', faction: 'leader', heroName: 'Abraham "Honest Axe" Lincoln', roleId: 'fighter', sizeClass: 'huge', hue: 0.1, element: 'metal', ultimate: 'Emancipation Cleave', kit: ['fighter-spinning-blade', 'fighter-cleaving-arc', 'fighter-second-wind', 'fighter-vampiric-edge', 'fighter-colossus-smash', 'shared-bull-rush'], retune: -12 },
  { id: 'churchill', faction: 'leader', heroName: 'Winston "Bulldog" Churchill', roleId: 'tank', sizeClass: 'large', hue: 0.05, element: 'fire', ultimate: 'Finest Hour', kit: ['tank-shoulder-cannon', 'tank-war-cry', 'tank-iron-skin', 'tank-last-stand', 'tank-great-wall', 'tank-crater-leap'], retune: -6.5 },
  { id: 'obama', faction: 'leader', heroName: 'Barack "Hope Beam" Obama', roleId: 'marksman', sizeClass: 'medium', hue: 0.6, element: 'light', ultimate: 'Yes We Can', kit: ['marksman-rifle-shot', 'marksman-hunters-mark', 'marksman-flashbang', 'marksman-steady-aim', 'marksman-rail-cannon', 'marksman-zipline'], retune: -1.5 },
  { id: 'trump', faction: 'leader', heroName: 'Donald "Dealmaker" Trump', roleId: 'fighter', sizeClass: 'large', hue: 0.12, element: 'money', ultimate: 'Art of the Deal', kit: ['fighter-brawler-shotgun', 'fighter-unstoppable-fury', 'fighter-crippling-blow', 'fighter-bloodlust', 'fighter-super-form', 'fighter-power-slide'], retune: -5 },
  { id: 'modi', faction: 'leader', heroName: 'Narendra "Saffron Storm" Modi', roleId: 'mage', sizeClass: 'medium', hue: 0.07, element: 'fire', ultimate: 'Digital India', kit: ['mage-chain-spark', 'mage-fireball', 'mage-thunderclap', 'mage-arcane-focus', 'mage-thunder-gods-wrath', 'mage-levitate'], retune: 3 },
  { id: 'merkel', faction: 'leader', heroName: 'Angela "Iron Chancellor" Merkel', roleId: 'controller', sizeClass: 'medium', hue: 0.95, element: 'ice', ultimate: 'We Can Do This', kit: ['controller-bolas', 'controller-ice-wall', 'controller-silence-field', 'controller-unshaken', 'controller-glacial-prison', 'mage-teleport'], retune: -12 },
  { id: 'macron', faction: 'leader', heroName: 'Emmanuel "Jupiter" Macron', roleId: 'assassin', sizeClass: 'small', hue: 0.66, element: 'lightning', ultimate: 'En Marche', kit: ['assassin-shadow-bolt', 'assassin-silencing-strike', 'assassin-expose-weakness', 'assassin-blade-dancer', 'assassin-thousand-cuts', 'shared-phase-shift'], retune: -6 },
  { id: 'zelenskyy', faction: 'leader', heroName: 'Volodymyr "Kyiv Shield" Zelenskyy', roleId: 'tank', sizeClass: 'medium', hue: 0.16, element: 'metal', ultimate: 'I Need Ammunition', kit: ['shared-sidearm', 'tank-shield-wall', 'tank-fortify', 'tank-juggernaut', 'tank-immovable-object', 'shared-sprint-burst'], retune: -8 },
  { id: 'ardern', faction: 'leader', heroName: 'Jacinda "Kindness Wave" Ardern', roleId: 'support', sizeClass: 'small', hue: 0.45, element: 'water', ultimate: 'Be Kind', kit: ['support-chime-orb', 'support-renew', 'support-healing-burst', 'support-benediction', 'support-guardian-angel', 'support-wind-step'], retune: 1 },
  { id: 'yew', faction: 'leader', heroName: 'Lee Kuan "Miracle" Yew', roleId: 'summoner', sizeClass: 'tiny', hue: 0.0, element: 'tech', ultimate: 'First World Leap', kit: ['summoner-nail-gun', 'summoner-scrap-wall', 'summoner-shield-generator', 'summoner-tinkerer', 'summoner-citadel', 'marksman-rocket-jump'] },
]

/** A Charter build for a demo hero: its persona's kit, its own ultimate name, the gate's retune steps, and its look. */
export function demoBuild(hero: DemoHero): Build {
  const result = proposeBuild({ heroName: hero.heroName, roleId: hero.roleId, skills: { ultimate: { name: hero.ultimate, flavour: '' } } })
  if (!result.ok) throw new Error(`demo build failed for ${hero.heroName}`)
  const slots = Object.fromEntries(BUILD_SLOTS.map((slot, i) => [slot, { ...result.build.slots[slot], templateId: hero.kit[i], retuneSteps: hero.retune ?? 0 }])) as Build['slots']
  // each skill's look is read once from its words and the hero's element, and kept with the hero like a forged one's
  const skills: Partial<Record<BuildSlot, SkillLook>> = {}
  for (const slot of BUILD_SLOTS) {
    const look = skillLookOf({ slots }, slot, hero.element)
    if (look) skills[slot] = look
  }
  const build = { ...result.build, slots, look: { ...demoLook(hero.id), skills } }
  // medium is the default and is stored as absent, the same as hydrateBuild
  return hero.sizeClass === 'medium' ? build : { ...build, sizeClass: hero.sizeClass }
}

export const demoRoster = (): Build[] => DEMO_HEROES.map(demoBuild)
