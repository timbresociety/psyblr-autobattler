import { active, ai, at, basic, buff, heal, movement, move, phys, shield, slow, spirit, unstoppable } from './dsl'

/**
 * Templates several roles draw from. The movement library lives here: every way a hero moves itself (dash, blink,
 * leap, grapple, sprint) is a movement-slot template, and no active or ultimate moves its caster (the skill library's
 * slot rule, docs/charter/skill-library.html).
 */
export const SHARED = [
  basic({ id: 'shared-ki-blast', name: 'Ki Blast', roles: ['support', 'tank', 'fighter', 'controller'], tags: ['ki', 'energy', 'blast', 'projectile', 'orb', 'chi'], delivery: at.proj(18), effects: [spirit(8, 0.7)], ai: ai('always', 1) }),
  basic({ id: 'shared-shotgun-blast', name: 'Shotgun Blast', roles: ['marksman', 'assassin', 'summoner'], tags: ['shotgun', 'blast', 'spread', 'close-range', 'scattergun'], delivery: at.cone(7, 3), effects: [phys(2, 0.6)], ai: ai('always', 1) }),
  basic({ id: 'shared-sidearm', name: 'Sidearm', roles: ['marksman', 'summoner', 'support', 'controller', 'tank'], tags: ['pistol', 'gun', 'revolver', 'handgun', 'sidearm', 'blaster'], delivery: at.proj(20, undefined, 40), effects: [phys(5, 0.9)], ai: ai('always', 1) }),

  active({ id: 'shared-energy-wave', name: 'Energy Wave', roles: ['fighter', 'mage'], tags: ['ki', 'energy', 'wave', 'blast', 'projectile', 'beam', 'kamehameha'], delivery: at.proj(20), effects: [spirit(60, 0.8)], cooldown: 7, ai: ai('poke', 5) }),
  active({ id: 'shared-guardian-bubble', name: 'Guardian Bubble', roles: ['tank', 'support'], tags: ['shield', 'bubble', 'protect', 'allies', 'barrier', 'dome'], delivery: at.aura(5), effects: [shield(90, 3, 'allies', 0.4)], cooldown: 16, ai: ai('support', 7) }),

  movement({ id: 'shared-sprint-burst', name: 'Sprint Burst', roles: ['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support', 'controller', 'summoner'], tags: ['sprint', 'run', 'speed', 'burst', 'haste'], delivery: at.self(), effects: [buff('moveSpeed', 50, 3)], cooldown: 9, ai: ai('escape', 3) }),
  movement({ id: 'shared-air-dash', name: 'Air Dash', roles: ['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support', 'controller', 'summoner'], tags: ['air-dash', 'dash', 'air', 'flight', 'zip', 'instant-transmission'], delivery: at.dash(6), effects: [move(6), buff('damage', 10, 2)], cooldown: 8, ai: ai('engage', 3) }),
  movement({ id: 'shared-grapple-hook', name: 'Grapple Hook', roles: ['assassin', 'marksman', 'fighter', 'summoner'], tags: ['grapple', 'hook', 'swing', 'zipline', 'rope', 'web'], delivery: at.grapple(18), effects: [move(14), heal(15, 0.1)], cooldown: 15, ai: ai('escape', 5) }),
  movement({ id: 'shared-bull-rush', name: 'Bull Rush', roles: ['tank', 'fighter'], tags: ['charge', 'rush', 'dash', 'knockback', 'tackle', 'ram', 'bull'], delivery: at.dash(8), effects: [move(8), unstoppable(0.6), phys(20, 0.3)], cooldown: 14, ai: ai('engage', 6) }),
  movement({ id: 'shared-phase-shift', name: 'Phase Shift', roles: ['assassin', 'mage', 'controller'], tags: ['phase', 'shift', 'ghost', 'intangible', 'blink', 'flicker'], delivery: at.blink(5), effects: [move(5, 0.5), buff('moveSpeed', 20, 2)], cooldown: 10, ai: ai('escape', 5) }),
  movement({ id: 'shared-time-recall', name: 'Time Recall', roles: ['mage', 'support', 'controller'], tags: ['return-to-past', 'rewind', 'time', 'recall', 'blink', 'heal', 'chrono'], delivery: at.blink(8), effects: [move(8), heal(50, 0.4)], cooldown: 14, ai: ai('escape', 6, { selfHealthBelow: 0.4 }) }),
  movement({ id: 'support-wind-step', name: 'Wind Step', roles: ['support', 'mage', 'controller'], tags: ['wind', 'step', 'breeze', 'glide', 'gust'], delivery: at.dash(7), effects: [move(7), buff('moveSpeed', 20, 3, 'allies')], cooldown: 9, ai: ai('escape', 4) }),
  movement({ id: 'marksman-jetpack', name: 'Jetpack', roles: ['marksman', 'summoner', 'tank'], tags: ['jetpack', 'flight', 'fly', 'rocket', 'thrusters', 'hover'], delivery: at.leap(10), effects: [move(10), shield(30, 2)], cooldown: 12, ai: ai('escape', 5) }),
  movement({ id: 'marksman-combat-roll', name: 'Combat Roll', roles: ['marksman', 'assassin', 'fighter', 'summoner'], tags: ['roll', 'dodge', 'tumble', 'evade'], delivery: at.dash(6), effects: [move(6), buff('attackSpeed', 30, 2)], cooldown: 7, ai: ai('escape', 4) }),
  movement({ id: 'tank-crater-leap', name: 'Crater Leap', roles: ['tank', 'fighter'], tags: ['leap', 'jump', 'slam', 'crater', 'land', 'hulk'], delivery: at.leap(9, 3), effects: [move(9), slow(30, 1.5), spirit(20, 0.2)], cooldown: 12, ai: ai('engage', 5) }),
  movement({ id: 'mage-teleport', name: 'Teleport', roles: ['mage', 'controller', 'summoner', 'support'], tags: ['teleport', 'blink', 'warp', 'portal', 'phase'], delivery: at.blink(10), effects: [move(10), shield(30, 1.5)], cooldown: 10, ai: ai('escape', 5) }),
  movement({ id: 'mage-levitate', name: 'Levitate', roles: ['mage', 'controller', 'support'], tags: ['levitate', 'float', 'flight', 'fly', 'hover'], delivery: at.dash(6), effects: [move(6), buff('moveSpeed', 35, 3)], cooldown: 9, ai: ai('escape', 4) }),
]
