import { BUILD_SLOTS, proposeBuild, type Build } from '../charter/build.js'
import { defaultLook } from '../charter/look.js'
import type { Element, SkillLook } from '../charter/skill-look.js'
import type { SizeClass } from '../charter/sizes.js'
import type { BuildSlot, RoleId } from '../charter/types.js'
import type { AttitudeId } from '../kit/anim/attitude.js'
import { skillLookOf } from './recipes/looks.js'
import type { Starter } from './starters.js'

/**
 * The roster players see (owner, 2026-11-14): the six Johns and the six generated characters, each in its own mesh
 * (public/heroes/generated, by `look.mesh`) and each slot a catalogue template chosen for what the hero is. The Johns
 * fight for one squad, the characters for the other. The twenty drawn starters (starters.ts) stay as the balance
 * and test sample; no screen offers them.
 *
 * The Johns are one man, John, the house champion of the parlour, pulled from the gacha at each of its six sizes. Every
 * John fights a different way, so between them they show the kit library's families: blades and knives, kicks and
 * rifles, sword and gun, shield and cannon, hammer and turrets, staff and healing.
 *
 * Colossal John and Behemoth start colossal, which a forged hero cannot (GAME.md R44: only a form reaches it): the
 * roster's builds go to the match as written, never through hydrateBuild.
 */

interface Skill {
  templateId: string
  name: string
  flavour: string
  visual?: string
}

interface Hero {
  id: string
  squad: Starter['squad']
  heroName: string
  roleId: RoleId
  sizeClass: SizeClass
  /** The generated mesh it wears (public/heroes/generated/index.json label); our body until that file exists. */
  mesh: string
  attitude: AttitudeId
  element: Element
  /** Signature colour (0 to 1 round the wheel), for its suit and effects. */
  hue: number
  slots: Record<BuildSlot, Skill>
  /** Skill looks written down by hand; the rest are read from the template and the element. */
  skills?: Partial<Record<BuildSlot, SkillLook>>
}

const JOHNS: readonly Hero[] = [
  {
    id: 'john-tiny',
    hue: 0.75,
    squad: 'vanguard',
    heroName: 'Tiny John',
    roleId: 'assassin',
    sizeClass: 'tiny',
    mesh: 'john-tiny',
    attitude: 'low',
    element: 'shadow',
    slots: {
      basic: { templateId: 'melee-paired', name: 'Pocket Knives', flavour: 'Two short blades, in and out before the big ones turn round' },
      active1: { templateId: 'assassin-throwing-knives', name: 'Flick Knives', flavour: 'Throws a knife from each hand' },
      active2: { templateId: 'assassin-smoke-bomb', name: 'Chip Smoke', flavour: 'Drops a smoke bomb and slips away in it' },
      passive: { templateId: 'assassin-evasion', name: 'Underfoot', flavour: 'Too small to hit cleanly: dodges blows outright' },
      ultimate: { templateId: 'assassin-thousand-cuts', name: 'Thousand Cuts', flavour: 'Darts through every foe near, cutting each' },
      movement: { templateId: 'assassin-wall-run', name: 'Rail Runner', flavour: 'Runs along any wall or cabinet side' },
    },
  },
  {
    id: 'john-small',
    hue: 0.58,
    squad: 'vanguard',
    heroName: 'Small John',
    roleId: 'marksman',
    sizeClass: 'small',
    mesh: 'john-small',
    attitude: 'swagger',
    element: 'metal',
    slots: {
      basic: { templateId: 'melee-kicks', name: 'Boot Work', flavour: 'Kicks to keep a diver off his rifle' },
      active1: { templateId: 'marksman-burst-fire', name: 'Three-Round Burst', flavour: 'A carbine fired in bursts of three' },
      active2: { templateId: 'marksman-bear-trap', name: 'Snap Trap', flavour: 'Sets a trap that holds the first foe to step in it' },
      passive: { templateId: 'marksman-steady-aim', name: 'Steady Hands', flavour: 'Standing still, every shot lands harder' },
      ultimate: { templateId: 'marksman-gunslinger', name: 'High Noon', flavour: 'Draws on every foe in sight at once' },
      movement: { templateId: 'marksman-combat-roll', name: 'Combat Roll', flavour: 'Rolls clear and comes up reloaded' },
    },
  },
  {
    id: 'john',
    hue: 0.62,
    squad: 'vanguard',
    heroName: 'John',
    roleId: 'fighter',
    sizeClass: 'medium',
    mesh: 'john',
    attitude: 'neutral',
    element: 'energy',
    slots: {
      basic: { templateId: 'melee-blade', name: 'House Blade', flavour: 'The champion’s one-hand sword, a three-blow chain' },
      active1: { templateId: 'shared-sidearm', name: 'Sidearm', flavour: 'A pistol on the hip for anything out of reach' },
      active2: { templateId: 'fighter-riposte', name: 'Riposte', flavour: 'Parries the next blow and strikes back' },
      passive: { templateId: 'fighter-momentum', name: 'Momentum', flavour: 'Every hit landed makes the next one faster' },
      ultimate: { templateId: 'fighter-blade-storm', name: 'Blade Storm', flavour: 'Spins through the crowd, blade out' },
      movement: { templateId: 'shared-grapple-hook', name: 'Grapple', flavour: 'Fires a line and swings up onto the tables' },
    },
  },
  {
    id: 'john-large',
    hue: 0.08,
    squad: 'vanguard',
    heroName: 'Large John',
    roleId: 'tank',
    sizeClass: 'large',
    mesh: 'john-large',
    attitude: 'brute',
    element: 'earth',
    slots: {
      basic: { templateId: 'melee-shield', name: 'Sword and Board', flavour: 'Sword and shield, the shield first' },
      active1: { templateId: 'tank-shoulder-cannon', name: 'Shoulder Cannon', flavour: 'A heavy cannon fired from the shoulder' },
      active2: { templateId: 'tank-chain-hook', name: 'Chain Hook', flavour: 'Hooks a foe and drags him into the shield' },
      passive: { templateId: 'tank-iron-skin', name: 'Iron Skin', flavour: 'Takes less from every hit' },
      ultimate: { templateId: 'tank-earthquake', name: 'Earthquake', flavour: 'Stamps the floor and the whole table shakes' },
      movement: { templateId: 'tank-crater-leap', name: 'Crater Leap', flavour: 'Leaps in and lands hard enough to crack the felt' },
    },
  },
  {
    id: 'john-huge',
    hue: 0.12,
    squad: 'vanguard',
    heroName: 'Huge John',
    roleId: 'summoner',
    sizeClass: 'huge',
    mesh: 'john-huge',
    attitude: 'brute',
    element: 'tech',
    slots: {
      basic: { templateId: 'melee-club', name: 'Wrench', flavour: 'A big wrench, swung like a hammer' },
      active1: { templateId: 'summoner-nail-gun', name: 'Nail Gun', flavour: 'A rivet gun from the repair kit' },
      active2: { templateId: 'summoner-sentry-turret', name: 'Sentry Turret', flavour: 'Bolts down a turret that fires on its own' },
      passive: { templateId: 'summoner-tinkerer', name: 'Tinkerer', flavour: 'His machines build faster and last longer' },
      ultimate: { templateId: 'summoner-war-machine', name: 'War Machine', flavour: 'Builds a walking machine that fights beside him' },
      movement: { templateId: 'summoner-thruster-skid', name: 'Thruster Skid', flavour: 'Skids across the floor on boot thrusters' },
    },
  },
  {
    id: 'john-colossal',
    hue: 0.15,
    squad: 'vanguard',
    heroName: 'Colossal John',
    roleId: 'support',
    sizeClass: 'colossal',
    mesh: 'john-colossal',
    attitude: 'neutral',
    element: 'light',
    slots: {
      basic: { templateId: 'melee-staff', name: 'Pole Staff', flavour: 'A staff as long as a pool cue, swept in wide arcs' },
      active1: { templateId: 'support-mending-shot', name: 'Mending Shot', flavour: 'A bolt of light that hurts foes and heals friends' },
      active2: { templateId: 'support-healing-totem', name: 'Lucky Totem', flavour: 'Plants a totem that heals everyone near it' },
      passive: { templateId: 'support-aura-of-renewal', name: 'Shelter', flavour: 'Allies in his shadow mend over time' },
      ultimate: { templateId: 'support-sanctuary', name: 'Sanctuary', flavour: 'Shields everyone near him under a dome of light' },
      movement: { templateId: 'support-guardian-leap', name: 'Guardian Leap', flavour: 'Leaps to the ally in most trouble' },
    },
  },
]

const CHARACTERS: readonly Hero[] = [
  {
    id: 'broly',
    hue: 0.33,
    squad: 'outlaws',
    heroName: 'Broly',
    roleId: 'fighter',
    sizeClass: 'large',
    mesh: 'broly',
    attitude: 'brute',
    element: 'energy',
    slots: {
      basic: { templateId: 'melee-unarmed', name: 'Rage Barrage', flavour: 'Huge brawler punches and grabs, slams the enemy into the ground', visual: 'heavy fists, green shockwave' },
      active1: { templateId: 'shared-ki-blast', name: 'Ki Blast', flavour: 'Fires a fast green energy blast from one hand', visual: 'green energy bolt' },
      active2: { templateId: 'fighter-ground-breaker', name: 'Gigantic Slam', flavour: 'Leaps and smashes the ground, shattering it around him', visual: 'large green sphere, big explosion' },
      passive: { templateId: 'fighter-berserk', name: 'Endless Rage', flavour: 'Grows stronger the more damage he takes', visual: 'green aura' },
      ultimate: { templateId: 'fighter-avatar-form', name: 'Berserk Form', flavour: 'Transforms in a rage, growing into a giant titan with a green aura', visual: 'muscle swell, green and gold aura' },
      movement: { templateId: 'fighter-gap-closer', name: 'Berserk Rush', flavour: 'Charges forward through the air and rams anything in the way', visual: 'green streak' },
    },
    skills: {
      basic: { element: 'energy', palette: ['#eaffe0', '#5dff6a', '#0f9d3a'], form: 'flurry', pose: 'slam' },
      active1: { element: 'energy', palette: ['#eaffe0', '#5dff6a', '#0f9d3a'], form: 'bolt', pose: 'palm' },
      active2: { element: 'energy', palette: ['#eaffe0', '#5dff6a', '#0f9d3a'], form: 'quake', pose: 'slam' },
      passive: { element: 'energy', palette: ['#eaffe0', '#5dff6a', '#0f9d3a'], form: 'glow' },
      ultimate: { element: 'energy', palette: ['#fff8b0', '#9dff3a', '#d9b800'], transformation: { entry: 'burst', aura: 'flame', growth: 'swell' }, callout: true, form: 'glow' },
      movement: { element: 'energy', palette: ['#eaffe0', '#5dff6a', '#0f9d3a'], form: 'streak' },
    },
  },
  {
    id: 'harry',
    hue: 0.0,
    squad: 'outlaws',
    heroName: 'Harry',
    roleId: 'mage',
    sizeClass: 'medium',
    mesh: 'harry',
    attitude: 'neutral',
    element: 'light',
    slots: {
      basic: { templateId: 'melee-blade', name: 'Gryffindor Sword', flavour: 'The silver sword, drawn when a spell will not do', visual: 'silver blade, ruby hilt' },
      active1: { templateId: 'mage-arcane-bolt', name: 'Stupefy', flavour: 'A red stunning bolt from the wand', visual: 'red spell bolt, wand flick' },
      active2: { templateId: 'support-drink-the-blow', name: 'Protego', flavour: 'A shield charm that swallows the next spell or blow', visual: 'clear shimmering shield' },
      passive: { templateId: 'mage-chrono-rewind', name: 'Time-Turner', flavour: 'When struck down, turns back a few seconds instead', visual: 'golden hourglass glint' },
      ultimate: { templateId: 'mage-mega-beam', name: 'Expecto Patronum', flavour: 'A silver stag of light charges down the line', visual: 'silver-white beam, stag shape' },
      movement: { templateId: 'mage-levitate', name: 'Broom Flight', flavour: 'Rises and flies low over the tables', visual: 'broom, wind trail' },
    },
  },
  {
    id: 'groot',
    hue: 0.28,
    squad: 'outlaws',
    heroName: 'Groot',
    roleId: 'support',
    sizeClass: 'tiny',
    mesh: 'groot',
    attitude: 'neutral',
    element: 'nature',
    slots: {
      basic: { templateId: 'melee-whip', name: 'Branch Lash', flavour: 'His arms grow into branches and whip out', visual: 'bark limbs stretching' },
      active1: { templateId: 'support-siphon-beam', name: 'Sap Drain', flavour: 'A thread of green sap that drains a foe and feeds his friends', visual: 'green sap stream' },
      active2: { templateId: 'support-healing-totem', name: 'Sapling', flavour: 'Plants a sapling that heals everyone near it', visual: 'small glowing tree' },
      passive: { templateId: 'support-martyr', name: 'We Are Groot', flavour: 'Takes the blows meant for his friends', visual: 'leaves shielding allies' },
      ultimate: { templateId: 'support-sanctuary', name: 'Branch Cocoon', flavour: 'Grows a cocoon of branches around every ally near', visual: 'woven branch dome, glowing spores' },
      movement: { templateId: 'support-guardian-leap', name: 'Root Spring', flavour: 'Springs on his roots to a friend in trouble', visual: 'roots bursting from the floor' },
    },
  },
  {
    id: 'sleepless',
    hue: 0.68,
    squad: 'outlaws',
    heroName: 'Kei Sorrel',
    roleId: 'controller',
    sizeClass: 'medium',
    mesh: 'sleepless',
    attitude: 'low',
    element: 'shadow',
    slots: {
      basic: { templateId: 'melee-kicks', name: 'Lazy Kicks', flavour: 'Fights with his feet, hands kept in his pockets', visual: 'quick crouched kicks' },
      active1: { templateId: 'controller-bolas', name: 'Case Thread', flavour: 'Throws a weighted thread that ties a foe’s legs', visual: 'red string, weighted ends' },
      active2: { templateId: 'mage-spell-steal', name: 'I Know Your Move', flavour: 'Reads a foe and takes the next spell he was about to cast', visual: 'pale ink glyphs' },
      passive: { templateId: 'controller-mind-fray', name: 'Sleepless Mind', flavour: 'Every foe he controls loses his nerve a little more', visual: 'ink-stain smudges' },
      ultimate: { templateId: 'controller-labyrinth', name: 'The Trap Is Set', flavour: 'Every move was a clue: walls rise and close the case', visual: 'paper walls, chalk lines' },
      movement: { templateId: 'shared-time-recall', name: 'Back to the Scene', flavour: 'Snaps back to where he stood a moment ago', visual: 'ink afterimage' },
    },
  },
  {
    id: 'ironclad',
    hue: 0.02,
    squad: 'outlaws',
    heroName: 'Ironclad',
    roleId: 'tank',
    sizeClass: 'large',
    mesh: 'ironclad',
    attitude: 'brute',
    element: 'tech',
    slots: {
      basic: { templateId: 'melee-unarmed', name: 'Piston Fists', flavour: 'Armoured fists driven by pistons', visual: 'steel gauntlets, hydraulic hiss' },
      active1: { templateId: 'tank-shoulder-cannon', name: 'Shoulder Cannon', flavour: 'A cannon on the armour’s shoulder', visual: 'muzzle flash, smoke' },
      active2: { templateId: 'tank-seismic-slam', name: 'Hydraulic Slam', flavour: 'Drives both fists into the floor and stuns all near', visual: 'shock ring, steam' },
      passive: { templateId: 'tank-juggernaut', name: 'Heavy Plating', flavour: 'Once moving, nothing knocks him aside', visual: 'plates locking' },
      ultimate: { templateId: 'tank-titan-form', name: 'Heavy Shell', flavour: 'Locks on the outer armour and grows into a walking fortress', visual: 'armour plates unfolding, glowing core' },
      movement: { templateId: 'marksman-jetpack', name: 'Thrusters', flavour: 'Boot and back thrusters lift him into the air', visual: 'blue thruster flames' },
    },
  },
  {
    id: 'behemoth',
    hue: 0.04,
    squad: 'outlaws',
    heroName: 'Behemoth',
    roleId: 'tank',
    sizeClass: 'colossal',
    mesh: 'behemoth',
    attitude: 'brute',
    element: 'fire',
    slots: {
      basic: { templateId: 'melee-unarmed', name: 'Titan Fists', flavour: 'Fists the size of a slot machine', visual: 'huge sweeping punches' },
      active1: { templateId: 'tank-shockwave-punch', name: 'Steam Burst', flavour: 'Vents a blast of scalding steam from his body', visual: 'white steam cone' },
      active2: { templateId: 'tank-sonic-shockwave', name: 'Roar', flavour: 'A roar that throws everyone in front of him back', visual: 'shock ring, flying chips' },
      passive: { templateId: 'tank-regenerating-core', name: 'Steaming Flesh', flavour: 'Wounds close in a hiss of steam', visual: 'steam from the wounds' },
      ultimate: { templateId: 'tank-earthquake', name: 'Stampede', flavour: 'Stomps across the floor and shakes everything down', visual: 'cracking floor, dust' },
      movement: { templateId: 'tank-crater-leap', name: 'Titan Leap', flavour: 'One leap across the parlour, landing in a crater', visual: 'crater, dust ring' },
    },
  },
]

function rostered(hero: Hero): Starter {
  const skills = Object.fromEntries(BUILD_SLOTS.map((slot) => [slot, { name: hero.slots[slot].name, flavour: hero.slots[slot].flavour, visual: hero.slots[slot].visual }]))
  const proposal = proposeBuild({ heroName: hero.heroName, roleId: hero.roleId, skills })
  if (!proposal.ok) throw new Error(`roster build failed for ${hero.heroName}`)
  const slots = Object.fromEntries(BUILD_SLOTS.map((slot) => [slot, { ...proposal.build.slots[slot], templateId: hero.slots[slot].templateId }])) as Build['slots']
  const hue = hero.hue
  const looks: Partial<Record<BuildSlot, SkillLook>> = {}
  for (const slot of BUILD_SLOTS) {
    const look = hero.skills?.[slot] ?? skillLookOf({ slots }, slot, hero.element)
    if (look) looks[slot] = look
  }
  const look = { ...defaultLook(hero.roleId, hero.heroName, hue), gender: 'm' as const, mesh: hero.mesh, skills: looks, ...(hero.attitude === 'neutral' ? {} : { attitude: hero.attitude }) }
  const build: Build = { ...proposal.build, slots, look, ...(hero.sizeClass === 'medium' ? {} : { sizeClass: hero.sizeClass }) }
  return { id: hero.id, squad: hero.squad, heroName: hero.heroName, roleId: hero.roleId, sizeClass: hero.sizeClass, hue, element: hero.element, build }
}

/** The twelve heroes every screen offers: the Johns, then the characters. */
export const ROSTER: readonly Starter[] = [...JOHNS, ...CHARACTERS].map(rostered)
