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
  /**
   * The motion each skill plays, in the kit's order (docs/plans/2026-11-01-combat-motion-plan.md): Mixamo clips of the
   * combat set, chosen by hand for the eight role heroes. Others get the catalogue's picks for their role's style.
   */
  motions?: readonly [string, string, string, string, string, string]
  /** Retune steps the balance gate gives this kit, as it would a forged hero's (negative lifts a weak kit). */
  retune?: number
}

export const DEMO_HEROES: readonly DemoHero[] = [
  { id: 'musk', faction: 'mogul', heroName: 'Elon "Starship" Musk', roleId: 'mage', sizeClass: 'large', hue: 0.58, element: 'cosmic', ultimate: 'Full Stack Launch', kit: ['mage-void-orb', 'mage-comet', 'mage-flame-pillar', 'mage-flux', 'mage-meteor-storm', 'mage-teleport'] },
  { id: 'huang', faction: 'mogul', heroName: 'Jensen "CUDA Core" Huang', roleId: 'marksman', sizeClass: 'medium', hue: 0.33, element: 'tech', ultimate: 'Tensor Barrage', kit: ['marksman-rifle-butt', 'marksman-ricochet', 'marksman-flashbang', 'marksman-headhunter', 'marksman-bullet-storm', 'marksman-jetpack'], motions: ['rifle_punch', 'firing_rifle', 'spell_cast', 'taunt', 'crouch_rapid_fire', 'big_jump'], retune: -12 },
  { id: 'bezos', faction: 'mogul', heroName: 'Jeff "Prime" Bezos', roleId: 'tank', sizeClass: 'huge', hue: 0.08, element: 'metal', ultimate: 'Same-Day Delivery', kit: ['tank-heavy-strike', 'tank-chain-hook', 'tank-barricade', 'tank-thick-hide', 'tank-avalanche', 'tank-bulldozer'], motions: ['ss_sword_and_shield_slash', 'throw_object', 'ss_sword_and_shield_power_up', 'standing_taunt_chest_thump', 'mutant_jump_attack', 'charge'] },
  { id: 'zuckerberg', faction: 'mogul', heroName: 'Mark "Metaverse" Zuckerberg', roleId: 'assassin', sizeClass: 'small', hue: 0.62, element: 'tech', ultimate: 'Infinite Scroll', kit: ['assassin-twin-daggers', 'assassin-death-mark', 'assassin-smoke-bomb', 'assassin-shadow-instinct', 'assassin-vendetta', 'assassin-shadow-step'], motions: ['double_dagger_stab', 'throwing', 'magic_standing_1h_cast_spell_01', 'taunt', 'dual_weapon_combo', 'aerial_evade'], retune: -10.5 },
  { id: 'nadella', faction: 'mogul', heroName: 'Satya "Copilot" Nadella', roleId: 'support', sizeClass: 'medium', hue: 0.55, element: 'light', ultimate: 'Cloud Ascension', kit: ['support-staff-strike', 'support-renew', 'support-healing-totem', 'support-aura-of-renewal', 'support-sanctuary', 'mage-teleport'], motions: ['axe_standing_melee_attack_horizontal', 'magic_standing_1h_magic_attack_01', 'magic_heal', 'magic_spell_casting', 'magic_standing_2h_magic_area_attack_01', 'corkscrew_evade'], retune: 5 },
  { id: 'altman', faction: 'mogul', heroName: 'Sam "AGI" Altman', roleId: 'controller', sizeClass: 'small', hue: 0.75, element: 'cosmic', ultimate: 'Scaling Law', kit: ['controller-psy-lash', 'controller-stasis-bolt', 'controller-time-dilation', 'controller-mind-fray', 'mage-time-stop', 'shared-phase-shift'], motions: ['gs_great_sword_slash', 'magic_standing_2h_magic_attack_01', 'gs_great_sword_casting', 'gs_great_sword_power_up', 'gs_great_sword_high_spin_attack', 'aerial_evade'], retune: 6 },
  { id: 'buffett', faction: 'mogul', heroName: 'Warren "Oracle" Buffett', roleId: 'summoner', sizeClass: 'tiny', hue: 0.14, element: 'money', ultimate: 'Compound Interest', kit: ['summoner-wrench', 'summoner-seeker-drone', 'summoner-war-drum', 'summoner-salvage', 'summoner-totem-of-war', 'summoner-thruster-skid'], motions: ['one_hand_club_combo', 'throwing_dice', 'casting_spell', 'taunt', 'wide_arm_spell_casting', 'sprint_to_backslide'], retune: -12 },
  { id: 'winfrey', faction: 'mogul', heroName: 'Oprah "You Get One" Winfrey', roleId: 'fighter', sizeClass: 'medium', hue: 0.85, element: 'sound', ultimate: 'Everybody Gets One', kit: ['fighter-combo-strikes', 'shared-energy-wave', 'fighter-war-stomp', 'fighter-bloodlust', 'fighter-blade-storm', 'fighter-gap-closer'], motions: ['jab_cross', 'magic_standing_2h_magic_attack_02', 'wide_arm_spell_casting', 'taunt', 'capoeira', 'sprinting_forward_roll'], retune: 2 },
  { id: 'ambani', faction: 'mogul', heroName: 'Mukesh "Jio" Ambani', roleId: 'tank', sizeClass: 'large', hue: 0.02, element: 'tech', ultimate: 'Network Effect', kit: ['tank-shoulder-cannon', 'tank-magnetize', 'tank-war-cry', 'tank-bulwark', 'tank-unbreakable', 'marksman-jetpack'], retune: -12 },
  { id: 'su', faction: 'mogul', heroName: 'Lisa "Zen Core" Su', roleId: 'assassin', sizeClass: 'tiny', hue: 0.0, element: 'lightning', ultimate: 'Chiplet Storm', kit: ['assassin-throwing-knives', 'assassin-kunai-volley', 'assassin-crippling-poison', 'assassin-precision', 'assassin-death-blossom', 'assassin-wall-run'], retune: -3.5 },
  { id: 'lincoln', faction: 'leader', heroName: 'Abraham "Honest Axe" Lincoln', roleId: 'fighter', sizeClass: 'huge', hue: 0.1, element: 'metal', ultimate: 'Emancipation Cleave', kit: ['fighter-spinning-blade', 'fighter-cleaving-arc', 'fighter-war-stomp', 'fighter-vampiric-edge', 'fighter-colossus-smash', 'shared-bull-rush'] },
  { id: 'churchill', faction: 'leader', heroName: 'Winston "Bulldog" Churchill', roleId: 'tank', sizeClass: 'large', hue: 0.05, element: 'fire', ultimate: 'Finest Hour', kit: ['tank-shoulder-cannon', 'tank-war-cry', 'tank-barricade', 'tank-last-stand', 'tank-great-wall', 'tank-crater-leap'], retune: -1.5 },
  { id: 'obama', faction: 'leader', heroName: 'Barack "Hope Beam" Obama', roleId: 'marksman', sizeClass: 'medium', hue: 0.6, element: 'light', ultimate: 'Yes We Can', kit: ['marksman-rifle-shot', 'marksman-hunters-mark', 'marksman-flashbang', 'marksman-steady-aim', 'marksman-rail-cannon', 'marksman-zipline'], retune: -12 },
  { id: 'trump', faction: 'leader', heroName: 'Donald "Dealmaker" Trump', roleId: 'fighter', sizeClass: 'large', hue: 0.12, element: 'money', ultimate: 'Art of the Deal', kit: ['fighter-brawler-shotgun', 'shared-energy-wave', 'fighter-crippling-blow', 'fighter-bloodlust', 'fighter-super-form', 'fighter-power-slide'], retune: -2 },
  { id: 'modi', faction: 'leader', heroName: 'Narendra "Saffron Storm" Modi', roleId: 'mage', sizeClass: 'medium', hue: 0.07, element: 'fire', ultimate: 'Digital India', kit: ['mage-spell-kick', 'mage-fireball', 'mage-thunderclap', 'mage-arcane-focus', 'mage-thunder-gods-wrath', 'mage-levitate'], motions: ['roundhouse_kick', 'fireball', 'two_hand_spell_casting', 'magic_standing_2h_cast_spell_01', 'magic_standing_2h_magic_area_attack_02', 'big_jump'] },
  { id: 'merkel', faction: 'leader', heroName: 'Angela "Iron Chancellor" Merkel', roleId: 'controller', sizeClass: 'medium', hue: 0.95, element: 'ice', ultimate: 'We Can Do This', kit: ['controller-bolas', 'controller-ice-wall', 'controller-silence-field', 'controller-unshaken', 'controller-glacial-prison', 'mage-teleport'], retune: -12 },
  { id: 'macron', faction: 'leader', heroName: 'Emmanuel "Jupiter" Macron', roleId: 'assassin', sizeClass: 'small', hue: 0.66, element: 'lightning', ultimate: 'En Marche', kit: ['assassin-shadow-bolt', 'assassin-silencing-strike', 'assassin-expose-weakness', 'assassin-blade-dancer', 'assassin-thousand-cuts', 'shared-phase-shift'] },
  { id: 'zelenskyy', faction: 'leader', heroName: 'Volodymyr "Kyiv Shield" Zelenskyy', roleId: 'tank', sizeClass: 'medium', hue: 0.16, element: 'metal', ultimate: 'I Need Ammunition', kit: ['shared-sidearm', 'tank-chain-hook', 'tank-barricade', 'tank-juggernaut', 'tank-immovable-object', 'shared-sprint-burst'], retune: -8.5 },
  { id: 'ardern', faction: 'leader', heroName: 'Jacinda "Kindness Wave" Ardern', roleId: 'support', sizeClass: 'small', hue: 0.45, element: 'water', ultimate: 'Be Kind', kit: ['support-chime-orb', 'support-renew', 'support-healing-burst', 'support-benediction', 'support-guardian-angel', 'support-wind-step'], retune: 5 },
  { id: 'yew', faction: 'leader', heroName: 'Lee Kuan "Miracle" Yew', roleId: 'summoner', sizeClass: 'tiny', hue: 0.0, element: 'tech', ultimate: 'First World Leap', kit: ['summoner-nail-gun', 'summoner-scrap-wall', 'summoner-shield-generator', 'summoner-tinkerer', 'summoner-citadel', 'marksman-rocket-jump'], retune: 1 },
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
  // the roster names a motion per skill; the passive's and the movement skill's are every hero's own (COMMON_MOTIONS)
  const motions = hero.motions && { combo1: hero.motions[0], active1: hero.motions[1], active2: hero.motions[2], ultimate: hero.motions[4] }
  const build = { ...result.build, slots, look: { ...demoLook(hero.id), skills, ...(motions ? { motions } : {}) } }
  // medium is the default and is stored as absent, the same as hydrateBuild
  return hero.sizeClass === 'medium' ? build : { ...build, sizeClass: hero.sizeClass }
}

export const demoRoster = (): Build[] => DEMO_HEROES.map(demoBuild)
