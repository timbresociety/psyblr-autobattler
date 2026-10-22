import { active, ai, at, basic, buff, heal, movement, passive, phys, push, shield, slow, spirit, stun, ultimate, move } from './dsl'

export const FIGHTER = [
  basic({ id: 'fighter-combo-strikes', name: 'Combo Strikes', roles: ['fighter'], tags: ['melee', 'combo', 'punch', 'kick', 'martial-arts', 'fist'], delivery: at.melee(2.5), effects: [phys(8, 1)], ai: ai('always', 1) }),
  basic({ id: 'fighter-spinning-blade', name: 'Spinning Blade', roles: ['fighter'], tags: ['sword', 'blade', 'slash', 'spin', 'cleave', 'katana'], delivery: at.cone(3, 2), effects: [phys(5, 0.8)], ai: ai('always', 1) }),
  basic({ id: 'fighter-brawler-shotgun', name: 'Brawler Shotgun', roles: ['fighter'], tags: ['shotgun', 'gun', 'blast', 'spread', 'buckshot'], delivery: at.cone(6, 3), effects: [phys(3, 0.6)], ai: ai('always', 1) }),

  active({ id: 'fighter-rising-uppercut', name: 'Rising Uppercut', roles: ['fighter'], tags: ['uppercut', 'launch', 'stun', 'punch', 'knock-up'], delivery: at.melee(3), effects: [push(3), stun(0.6), phys(40, 0.7)], cooldown: 8, ai: ai('engage', 7) }),
  active({ id: 'fighter-whirlwind', name: 'Whirlwind', roles: ['fighter'], tags: ['spin', 'whirlwind', 'tornado', 'cyclone', 'aoe', 'wind'], delivery: at.aura(3), effects: [phys(60, 0.8, 2)], cooldown: 9, ai: ai('engage', 6, { minTargets: 2 }) }),
  active({ id: 'fighter-gap-rush', name: 'Gap Rush', roles: ['fighter'], tags: ['rush', 'dash', 'lunge', 'gap-close', 'charge', 'instant-transmission'], delivery: at.dash(9), effects: [move(9), phys(35, 0.6)], cooldown: 8, ai: ai('engage', 8) }),
  active({ id: 'fighter-berserk', name: 'Berserk', roles: ['fighter'], tags: ['rage', 'berserk', 'fury', 'frenzy', 'buff', 'anger'], delivery: at.self(), effects: [buff('attackSpeed', 40, 5), buff('damage', 15, 5)], cooldown: 15, ai: ai('engage', 6) }),
  active({ id: 'shared-energy-wave', name: 'Energy Wave', roles: ['fighter', 'mage'], tags: ['ki', 'energy', 'wave', 'blast', 'projectile', 'beam', 'kamehameha'], delivery: at.proj(20), effects: [spirit(60, 0.8)], cooldown: 7, ai: ai('poke', 5) }),
  active({ id: 'fighter-ground-breaker', name: 'Ground Breaker', roles: ['fighter'], tags: ['slam', 'ground', 'shatter', 'slow', 'earth', 'smash'], delivery: at.zone(0, 3.5), effects: [slow(35, 2), phys(45, 0.7)], cooldown: 9, ai: ai('engage', 5, { minTargets: 1 }) }),
  active({ id: 'fighter-counter-stance', name: 'Counter Stance', roles: ['fighter'], tags: ['counter', 'parry', 'block', 'stance', 'riposte'], delivery: at.self(), effects: [shield(80, 1.5), buff('damage', 30, 3)], cooldown: 12, ai: ai('sustain', 6, { selfHealthBelow: 0.7 }) }),

  passive({ id: 'fighter-bloodlust', name: 'Bloodlust', roles: ['fighter'], tags: ['lifesteal', 'blood', 'vampire', 'drain', 'heal'], delivery: at.self(), effects: [heal(6, 0.05)], trigger: 'onHit', ai: ai('always', 0) }),
  passive({ id: 'fighter-momentum', name: 'Momentum', roles: ['fighter'], tags: ['momentum', 'combo', 'crit', 'flurry', 'third-hit'], delivery: at.melee(2.5), effects: [phys(20, 0.4)], trigger: 'everyThirdHit', ai: ai('always', 0) }),
  passive({ id: 'fighter-battle-trance', name: 'Battle Trance', roles: ['fighter'], tags: ['trance', 'adrenaline', 'second-wind', 'low-health', 'speed'], delivery: at.self(), effects: [buff('attackSpeed', 40, 4), buff('moveSpeed', 20, 4)], trigger: 'lowHealth', ai: ai('always', 0) }),

  ultimate({ id: 'fighter-super-form', name: 'Super Form', roles: ['fighter'], tags: ['transform', 'super', 'saiyan', 'power-up', 'form', 'gear', 'awaken'], delivery: at.self(), effects: [buff('damage', 30, 10), buff('attackSpeed', 30, 10), buff('moveSpeed', 20, 10)], cooldown: 70, ai: ai('engage', 9) }),
  ultimate({ id: 'fighter-meteor-combo', name: 'Meteor Combo', roles: ['fighter'], tags: ['combo', 'meteor', 'barrage', 'finisher', 'stun', 'rush'], delivery: at.melee(3), effects: [stun(1), phys(200, 1.6)], cooldown: 60, ai: ai('finisher', 9, { targetHealthBelow: 0.6 }) }),
  ultimate({ id: 'fighter-limit-break', name: 'Limit Break', roles: ['fighter'], tags: ['limit-break', 'explosion', 'dash', 'nova', 'burst'], delivery: at.zone(12, 4), effects: [move(12), phys(140, 1.2)], cooldown: 65, ai: ai('engage', 8, { minTargets: 2 }) }),

  movement({ id: 'fighter-sky-step', name: 'Sky Step', roles: ['fighter'], tags: ['double-jump', 'jump', 'air', 'flight', 'sky'], delivery: at.dash(6), effects: [move(6), buff('moveSpeed', 25, 2)], cooldown: 8, ai: ai('engage', 4) }),
  movement({ id: 'fighter-power-slide', name: 'Power Slide', roles: ['fighter'], tags: ['slide', 'dash', 'kick', 'sweep'], delivery: at.dash(7), effects: [move(7), phys(15, 0.2)], cooldown: 8, ai: ai('engage', 4) }),
]
