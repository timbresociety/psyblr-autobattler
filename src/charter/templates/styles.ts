import type { MeleeStyle, RoleId, Template } from '../types.js'
import { ai, at, melee, phys } from './dsl.js'

/**
 * The melee row (GAME.md §4 V): a weapon style, not a template. The style sets the clips (the coverage manifest's light,
 * heavy and guard roles), the reach and arc of a swing and how far the striker lunges in; the damage comes from the
 * role's weapon damage. Every role may take every style. `lunge` is metres the swing carries the body toward the
 * target in front (§5 magnetism); the combo windows come from the style's clips (style-timing.json).
 */
export const MELEE_STYLES: Record<MeleeStyle, { name: string; reach: number; arc: number; lunge: number; tags: string[] }> = {
  unarmed: { name: 'Unarmed', reach: 2.4, arc: 100, lunge: 1.4, tags: ['punch', 'fist', 'martial-arts', 'boxing', 'brawler', 'elbow', 'knee', 'claw'] },
  kicks: { name: 'Kicks', reach: 2.7, arc: 110, lunge: 1.2, tags: ['kick', 'taekwondo', 'capoeira', 'muay-thai', 'legs', 'stomp'] },
  blade: { name: 'Blade', reach: 2.6, arc: 100, lunge: 1.6, tags: ['blade', 'dagger', 'knife', 'sword', 'katana', 'iaido', 'slash', 'stab'] },
  greatsword: { name: 'Greatsword', reach: 3.3, arc: 140, lunge: 1, tags: ['greatsword', 'claymore', 'zweihander', 'buster-sword', 'cleave', 'big-sword'] },
  shield: { name: 'Sword and shield', reach: 2.7, arc: 110, lunge: 1.1, tags: ['shield', 'knight', 'paladin', 'bash', 'guard', 'sword-and-board'] },
  staff: { name: 'Axe or staff', reach: 3.2, arc: 130, lunge: 1, tags: ['axe', 'staff', 'spear', 'polearm', 'whip', 'chain', 'halberd', 'bo'] },
  club: { name: 'Club', reach: 2.9, arc: 120, lunge: 1.1, tags: ['club', 'bat', 'hammer', 'mace', 'wrench', 'maul', 'smash'] },
  // the locked library's other four families (GAME.md §4 V)
  paired: { name: 'Paired', reach: 2.4, arc: 110, lunge: 1.5, tags: ['dual-wield', 'twin-blades', 'dual-daggers', 'tonfa', 'sai', 'twin-axes'] },
  axe: { name: 'Chop and reap', reach: 3, arc: 130, lunge: 1.1, tags: ['great-axe', 'scythe', 'kama', 'pickaxe', 'reaper', 'hatchet'] },
  spear: { name: 'Thrust', reach: 3.6, arc: 60, lunge: 1.4, tags: ['lance', 'trident', 'naginata', 'pike', 'javelin', 'impale'] },
  whip: { name: 'Flexible', reach: 4.2, arc: 90, lunge: 0.8, tags: ['lash', 'kusarigama', 'rope-dart', 'nunchaku', 'meteor-hammer', 'flail'] },
}

/** The clip set each melee family plays (charter/motions.ts STYLES): every family has its own (owner, 2026-11-11). */
export const CLIP_STYLE: Record<MeleeStyle, MeleeStyle> = {
  unarmed: 'unarmed',
  kicks: 'kicks',
  blade: 'blade',
  greatsword: 'greatsword',
  shield: 'shield',
  staff: 'staff',
  club: 'club',
  paired: 'paired',
  axe: 'axe',
  spear: 'spear',
  whip: 'whip',
}

/** The styles added after the starters were drawn (the locked library's), left out of their draw. */
export const LATER_STYLES: ReadonlySet<string> = new Set(['melee-paired', 'melee-axe', 'melee-spear', 'melee-whip'])

const EVERY: RoleId[] = ['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support', 'controller', 'summoner']

export const STYLE_TEMPLATES: Template[] = (Object.entries(MELEE_STYLES) as [MeleeStyle, (typeof MELEE_STYLES)[MeleeStyle]][]).map(([style, s]) =>
  melee({ id: `melee-${style}`, style, name: s.name, roles: EVERY, tags: ['melee', ...s.tags], delivery: at.melee(s.reach, s.arc), effects: [phys(8, 1)], ai: ai('always', 1) }),
)

/** The basic templates §4 retired into the styles; a stored build takes the style instead. Their riders are dropped. */
export const RETIRED_TO_STYLE: Record<string, MeleeStyle> = {
  'tank-heavy-strike': 'club',
  'tank-shield-bash': 'shield',
  'tank-anchor-chain': 'staff',
  'tank-thunder-stomp': 'kicks',
  'fighter-combo-strikes': 'unarmed',
  'fighter-spinning-blade': 'blade',
  'fighter-claw-rake': 'unarmed',
  'fighter-war-hammer': 'club',
  'fighter-chain-whip': 'staff',
  'assassin-twin-daggers': 'blade',
  'assassin-iaido': 'blade',
  'mage-spell-kick': 'kicks',
  'marksman-rifle-butt': 'unarmed',
  'support-staff-strike': 'staff',
  'controller-psy-lash': 'staff',
  'summoner-wrench': 'club',
}
