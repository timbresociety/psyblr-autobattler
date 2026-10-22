import { active, ai, at, basic, buff, heal, movement, passive, phys, push, shield, slow, spirit, stun, ultimate, move } from './dsl'

export const TANK = [
  basic({ id: 'tank-heavy-strike', name: 'Heavy Strike', roles: ['tank'], tags: ['melee', 'punch', 'strike', 'heavy', 'hammer', 'smash'], delivery: at.melee(3), effects: [phys(10, 1)], ai: ai('always', 1) }),
  basic({ id: 'tank-shoulder-cannon', name: 'Shoulder Cannon', roles: ['tank'], tags: ['projectile', 'cannon', 'shot', 'gun', 'blast', 'ranged'], delivery: at.proj(14), effects: [phys(6, 0.8)], ai: ai('always', 1) }),
  basic({ id: 'tank-shockwave-punch', name: 'Shockwave Punch', roles: ['tank'], tags: ['cone', 'shockwave', 'punch', 'wave', 'earth', 'quake'], delivery: at.cone(4, 2), effects: [phys(4, 0.7)], ai: ai('always', 1) }),

  active({ id: 'tank-seismic-slam', name: 'Seismic Slam', roles: ['tank'], tags: ['slam', 'stun', 'earth', 'shockwave', 'ground', 'quake', 'zone'], delivery: at.zone(0, 4), effects: [stun(0.8), phys(40, 0.6)], cooldown: 10, ai: ai('engage', 7, { minTargets: 2 }) }),
  active({ id: 'tank-shield-wall', name: 'Shield Wall', roles: ['tank'], tags: ['shield', 'barrier', 'defend', 'block', 'wall', 'guard'], delivery: at.self(), effects: [shield(150, 3, 'self', 0.6)], cooldown: 12, ai: ai('sustain', 6, { selfHealthBelow: 0.6 }) }),
  active({ id: 'tank-chain-hook', name: 'Chain Hook', roles: ['tank'], tags: ['hook', 'pull', 'grapple', 'chain', 'drag', 'yank'], delivery: at.grapple(16), effects: [push(6), stun(0.5), phys(30, 0.4)], cooldown: 12, ai: ai('engage', 8) }),
  active({ id: 'tank-bull-charge', name: 'Bull Charge', roles: ['tank'], tags: ['charge', 'rush', 'dash', 'knockback', 'tackle', 'ram'], delivery: at.dash(10), effects: [move(10), push(4), phys(30, 0.5)], cooldown: 11, ai: ai('engage', 7) }),
  active({ id: 'tank-iron-skin', name: 'Iron Skin', roles: ['tank'], tags: ['harden', 'armor', 'stone', 'buff', 'steel', 'metal', 'tough'], delivery: at.self(), effects: [buff('damageReduction', 40, 4)], cooldown: 14, ai: ai('sustain', 6, { selfHealthBelow: 0.5 }) }),
  active({ id: 'tank-ground-spikes', name: 'Ground Spikes', roles: ['tank'], tags: ['spikes', 'earth', 'slow', 'zone', 'thorns', 'rock'], delivery: at.zone(12, 3), effects: [slow(40, 2), phys(35, 0.5)], cooldown: 9, ai: ai('poke', 5, { minTargets: 1 }) }),
  active({ id: 'shared-guardian-bubble', name: 'Guardian Bubble', roles: ['tank', 'support'], tags: ['shield', 'bubble', 'protect', 'allies', 'barrier', 'dome'], delivery: at.aura(5), effects: [shield(90, 3, 'allies', 0.4)], cooldown: 16, ai: ai('support', 7) }),

  passive({ id: 'tank-thick-hide', name: 'Thick Hide', roles: ['tank'], tags: ['armor', 'tough', 'hide', 'defend', 'durable'], delivery: at.self(), effects: [buff('damageReduction', 10, 1)], trigger: 'always', ai: ai('always', 0) }),
  passive({ id: 'tank-last-stand', name: 'Last Stand', roles: ['tank'], tags: ['last-stand', 'survive', 'rage', 'endure', 'low-health'], delivery: at.self(), effects: [buff('damageReduction', 30, 4), heal(40, 0.2)], trigger: 'lowHealth', ai: ai('always', 0) }),
  passive({ id: 'tank-regenerating-core', name: 'Regenerating Core', roles: ['tank'], tags: ['regen', 'heal', 'recover', 'core', 'healing-factor'], delivery: at.self(), effects: [heal(8, 0.05, 'self', 1)], trigger: 'always', ai: ai('always', 0) }),

  ultimate({ id: 'tank-titan-form', name: 'Titan Form', roles: ['tank'], tags: ['transform', 'titan', 'giant', 'form', 'power-up', 'buff'], delivery: at.self(), effects: [buff('damageReduction', 45, 8), buff('damage', 25, 8), heal(120, 0.5)], cooldown: 70, ai: ai('engage', 9, { minTargets: 2 }) }),
  ultimate({ id: 'tank-earthquake', name: 'Earthquake', roles: ['tank'], tags: ['earthquake', 'stun', 'zone', 'earth', 'quake', 'slam', 'ground'], delivery: at.zone(0, 7), effects: [stun(1.5), phys(120, 1.2)], cooldown: 70, ai: ai('engage', 9, { minTargets: 3 }) }),
  ultimate({ id: 'tank-unbreakable', name: 'Unbreakable', roles: ['tank'], tags: ['invulnerable', 'shield', 'unbreakable', 'immortal', 'fortress'], delivery: at.aura(6), effects: [shield(250, 5, 'allies', 1), slow(30, 3)], cooldown: 75, ai: ai('support', 9, { selfHealthBelow: 0.5 }) }),

  movement({ id: 'tank-crater-leap', name: 'Crater Leap', roles: ['tank'], tags: ['leap', 'jump', 'slam', 'crater', 'land'], delivery: at.dash(9), effects: [move(9), slow(30, 1.5), spirit(20, 0.2)], cooldown: 12, ai: ai('engage', 5) }),
  movement({ id: 'tank-bulldozer', name: 'Bulldozer', roles: ['tank'], tags: ['bulldoze', 'dash', 'rush', 'shield', 'plow'], delivery: at.dash(8), effects: [move(8), shield(40, 2)], cooldown: 10, ai: ai('engage', 4) }),
]
