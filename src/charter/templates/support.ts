import { active, ai, at, basic, buff, heal, movement, passive, push, shield, slow, spirit, stun, ultimate, move } from './dsl'

export const SUPPORT = [
  basic({ id: 'support-mending-shot', name: 'Mending Shot', roles: ['support'], tags: ['projectile', 'light', 'holy', 'orb', 'heal'], delivery: at.proj(16), effects: [spirit(6, 0.6), heal(4, 0.1, 'ally')], ai: ai('always', 1) }),
  basic({ id: 'support-staff-strike', name: 'Staff Strike', roles: ['support'], tags: ['staff', 'melee', 'strike', 'bonk', 'cane'], delivery: at.melee(3), effects: [spirit(10, 0.8)], ai: ai('always', 1) }),

  active({ id: 'support-healing-burst', name: 'Healing Burst', roles: ['support'], tags: ['heal', 'burst', 'restore', 'mend', 'cure', 'holy'], delivery: at.aura(6), effects: [heal(90, 0.6, 'allies')], cooldown: 10, ai: ai('support', 8) }),
  active({ id: 'support-barrier', name: 'Barrier', roles: ['support'], tags: ['barrier', 'shield', 'protect', 'ward', 'guard'], delivery: at.proj(15), effects: [shield(140, 3, 'ally', 0.8)], cooldown: 9, ai: ai('support', 7) }),
  active({ id: 'support-tailwind', name: 'Tailwind', roles: ['support'], tags: ['haste', 'speed', 'wind', 'tailwind', 'rush', 'allies'], delivery: at.aura(6), effects: [buff('moveSpeed', 35, 4, 'allies'), buff('attackSpeed', 15, 4, 'allies')], cooldown: 15, ai: ai('support', 6) }),
  active({ id: 'support-sleep-dart', name: 'Sleep Dart', roles: ['support'], tags: ['sleep', 'dart', 'tranquilizer', 'stun', 'disable'], delivery: at.proj(18), effects: [stun(1.5), spirit(15, 0.2)], cooldown: 13, ai: ai('peel', 7) }),
  active({ id: 'support-healing-totem', name: 'Healing Totem', roles: ['support'], tags: ['totem', 'zone', 'heal', 'regen', 'spring', 'well'], delivery: at.zone(10, 4), effects: [heal(100, 0.6, 'allies', 4)], cooldown: 14, ai: ai('support', 6) }),
  active({ id: 'support-empower', name: 'Empower', roles: ['support'], tags: ['empower', 'buff', 'power', 'strength', 'inspire', 'blessing'], delivery: at.aura(6), effects: [buff('damage', 20, 5, 'allies')], cooldown: 16, ai: ai('support', 6) }),
  active({ id: 'support-repel', name: 'Repel', roles: ['support'], tags: ['repel', 'push', 'knockback', 'gust', 'wave', 'peel'], delivery: at.aura(4), effects: [push(5), slow(30, 2), spirit(20, 0.2)], cooldown: 12, ai: ai('peel', 7, { selfHealthBelow: 0.6 }) }),

  passive({ id: 'support-aura-of-renewal', name: 'Aura of Renewal', roles: ['support'], tags: ['aura', 'renewal', 'regen', 'heal', 'allies'], delivery: at.aura(6), effects: [heal(5, 0.04, 'allies', 1)], trigger: 'always', ai: ai('always', 0) }),
  passive({ id: 'support-guardian-spirit', name: 'Guardian Spirit', roles: ['support'], tags: ['guardian', 'spirit', 'angel', 'save', 'low-health'], delivery: at.self(), effects: [shield(120, 3, 'self', 0.6)], trigger: 'lowHealth', ai: ai('always', 0) }),
  passive({ id: 'support-inspiring-strikes', name: 'Inspiring Strikes', roles: ['support'], tags: ['inspire', 'rally', 'morale', 'allies', 'on-hit'], delivery: at.aura(6), effects: [buff('attackSpeed', 10, 2, 'allies')], trigger: 'onHit', ai: ai('always', 0) }),

  ultimate({ id: 'support-revival-wave', name: 'Revival Wave', roles: ['support'], tags: ['revive', 'resurrect', 'wave', 'heal', 'miracle', 'senzu'], delivery: at.aura(8), effects: [heal(260, 1.2, 'allies'), shield(100, 4, 'allies', 0.4)], cooldown: 80, ai: ai('support', 9) }),
  ultimate({ id: 'support-sanctuary', name: 'Sanctuary', roles: ['support'], tags: ['sanctuary', 'dome', 'zone', 'protect', 'holy-ground'], delivery: at.zone(12, 6), effects: [buff('damageReduction', 40, 6, 'allies'), heal(80, 0.4, 'allies', 6)], cooldown: 75, ai: ai('support', 9) }),
  ultimate({ id: 'support-mass-haste', name: 'Mass Haste', roles: ['support'], tags: ['haste', 'speed', 'frenzy', 'war-cry', 'allies', 'rally'], delivery: at.aura(10), effects: [buff('attackSpeed', 40, 8, 'allies'), buff('moveSpeed', 30, 8, 'allies')], cooldown: 70, ai: ai('engage', 8) }),

  movement({ id: 'support-guardian-leap', name: 'Guardian Leap', roles: ['support'], tags: ['leap', 'ally', 'save', 'jump', 'guardian'], delivery: at.dash(10), effects: [move(10), shield(40, 2, 'ally')], cooldown: 12, ai: ai('support', 5) }),
  movement({ id: 'support-wind-step', name: 'Wind Step', roles: ['support'], tags: ['wind', 'step', 'breeze', 'glide'], delivery: at.dash(7), effects: [move(7), buff('moveSpeed', 20, 3, 'allies')], cooldown: 9, ai: ai('escape', 4) }),
]
