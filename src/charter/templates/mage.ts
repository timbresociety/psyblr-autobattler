import { active, ai, at, basic, buff, heal, movement, passive, push, shield, slow, spirit, stun, ultimate, move } from './dsl'

export const MAGE = [
  basic({ id: 'mage-arcane-bolt', name: 'Arcane Bolt', roles: ['mage'], tags: ['bolt', 'arcane', 'magic', 'projectile', 'orb', 'spell'], delivery: at.proj(20), effects: [spirit(10, 0.8)], ai: ai('always', 1) }),
  basic({ id: 'mage-chain-spark', name: 'Chain Spark', roles: ['mage'], tags: ['lightning', 'spark', 'electric', 'thunder', 'beam', 'shock'], delivery: at.beam(12), effects: [spirit(8, 0.7)], ai: ai('always', 1) }),
  basic({ id: 'mage-ember-spray', name: 'Ember Spray', roles: ['mage'], tags: ['fire', 'flame', 'ember', 'spray', 'cone', 'breath'], delivery: at.cone(7, 3), effects: [spirit(4, 0.5)], ai: ai('always', 1) }),

  active({ id: 'mage-fireball', name: 'Fireball', roles: ['mage'], tags: ['fire', 'fireball', 'explosion', 'burn', 'flame', 'blast'], delivery: at.proj(22, 2.5), effects: [spirit(50, 0.7), spirit(20, 0.2, 3)], cooldown: 8, ai: ai('poke', 6) }),
  active({ id: 'mage-frost-nova', name: 'Frost Nova', roles: ['mage'], tags: ['ice', 'frost', 'freeze', 'nova', 'cold', 'slow'], delivery: at.aura(4), effects: [slow(50, 2.5), spirit(35, 0.5)], cooldown: 10, ai: ai('peel', 7, { minTargets: 1 }) }),
  active({ id: 'mage-lightning-lance', name: 'Lightning Lance', roles: ['mage'], tags: ['lightning', 'beam', 'thunder', 'lance', 'electric', 'stun'], delivery: at.beam(16), effects: [stun(0.4), spirit(55, 0.7)], cooldown: 9, ai: ai('poke', 6) }),
  active({ id: 'mage-recall-step', name: 'Recall Step', roles: ['mage', 'support'], tags: ['return-to-past', 'rewind', 'time', 'recall', 'blink', 'heal'], delivery: at.blink(8), effects: [move(8), heal(60, 0.5)], cooldown: 14, ai: ai('escape', 8, { selfHealthBelow: 0.35 }) }),
  active({ id: 'mage-gravity-well', name: 'Gravity Well', roles: ['mage'], tags: ['gravity', 'black-hole', 'pull', 'vortex', 'singularity', 'slow'], delivery: at.zone(14, 4), effects: [push(4), slow(40, 2), spirit(25, 0.3)], cooldown: 13, ai: ai('engage', 7, { minTargets: 2 }) }),
  active({ id: 'mage-arcane-barrage', name: 'Arcane Barrage', roles: ['mage'], tags: ['barrage', 'missiles', 'volley', 'rapid', 'arcane'], delivery: at.proj(18), effects: [spirit(80, 0.9, 1.5)], cooldown: 8, ai: ai('poke', 5) }),
  active({ id: 'mage-mana-shield', name: 'Mana Shield', roles: ['mage'], tags: ['mana', 'shield', 'barrier', 'ward', 'arcane'], delivery: at.self(), effects: [shield(120, 3, 'self', 0.8)], cooldown: 13, ai: ai('sustain', 6, { selfHealthBelow: 0.5 }) }),

  passive({ id: 'mage-overcharge', name: 'Overcharge', roles: ['mage'], tags: ['overcharge', 'surge', 'third-hit', 'charge', 'energy'], delivery: at.proj(20), effects: [spirit(20, 0.4)], trigger: 'everyThirdHit', ai: ai('always', 0) }),
  passive({ id: 'mage-arcane-focus', name: 'Arcane Focus', roles: ['mage'], tags: ['focus', 'power', 'wisdom', 'genius', 'intellect'], delivery: at.self(), effects: [buff('damage', 10, 1)], trigger: 'always', ai: ai('always', 0) }),
  passive({ id: 'mage-spell-vamp', name: 'Spell Vamp', roles: ['mage'], tags: ['drain', 'vampire', 'siphon', 'life-drain', 'leech'], delivery: at.self(), effects: [heal(5, 0.06)], trigger: 'onHit', ai: ai('always', 0) }),

  ultimate({ id: 'mage-meteor-storm', name: 'Meteor Storm', roles: ['mage'], tags: ['meteor', 'storm', 'rain', 'fire', 'apocalypse', 'sky'], delivery: at.zone(25, 6), effects: [spirit(160, 1.4, 3), slow(30, 3)], cooldown: 70, ai: ai('engage', 8, { minTargets: 3 }) }),
  ultimate({ id: 'mage-mega-beam', name: 'Mega Beam', roles: ['mage'], tags: ['beam', 'kamehameha', 'laser', 'cannon', 'wave', 'final-flash'], delivery: at.beam(30), effects: [spirit(260, 2), push(5)], cooldown: 65, ai: ai('finisher', 9, { targetHealthBelow: 0.7 }) }),
  ultimate({ id: 'mage-time-stop', name: 'Time Stop', roles: ['mage'], tags: ['time', 'stop', 'freeze', 'chrono', 'za-warudo', 'stasis'], delivery: at.zone(14, 6), effects: [stun(2), spirit(60, 0.5)], cooldown: 80, ai: ai('engage', 9, { minTargets: 3 }) }),

  movement({ id: 'mage-teleport', name: 'Teleport', roles: ['mage'], tags: ['teleport', 'blink', 'warp', 'portal', 'phase'], delivery: at.blink(10), effects: [move(10), shield(30, 1.5)], cooldown: 10, ai: ai('escape', 5) }),
  movement({ id: 'mage-levitate', name: 'Levitate', roles: ['mage'], tags: ['levitate', 'float', 'flight', 'fly', 'hover'], delivery: at.dash(6), effects: [move(6), buff('moveSpeed', 35, 3)], cooldown: 9, ai: ai('escape', 4) }),
]
