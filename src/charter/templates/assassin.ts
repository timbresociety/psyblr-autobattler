import { active, ai, at, basic, buff, execute, heal, movement, passive, phys, slow, spirit, stun, ultimate, move } from './dsl'

export const ASSASSIN = [
  basic({ id: 'assassin-twin-daggers', name: 'Twin Daggers', roles: ['assassin'], tags: ['dagger', 'knife', 'stab', 'melee', 'blade', 'claw'], delivery: at.melee(2.2), effects: [phys(6, 1)], ai: ai('always', 1) }),
  basic({ id: 'assassin-throwing-knives', name: 'Throwing Knives', roles: ['assassin'], tags: ['throw', 'knife', 'kunai', 'shuriken', 'projectile'], delivery: at.proj(16), effects: [phys(4, 0.8)], ai: ai('always', 1) }),
  basic({ id: 'assassin-shadow-bolt', name: 'Shadow Bolt', roles: ['assassin'], tags: ['shadow', 'dark', 'void', 'bolt', 'projectile'], delivery: at.proj(14), effects: [spirit(10, 0.7)], ai: ai('always', 1) }),

  active({ id: 'assassin-shadow-step', name: 'Shadow Step', roles: ['assassin'], tags: ['blink', 'teleport', 'shadow', 'behind', 'step', 'flash'], delivery: at.blink(10), effects: [move(10), phys(40, 0.8)], cooldown: 9, ai: ai('engage', 8, { targetHealthBelow: 0.7 }) }),
  active({ id: 'assassin-backstab', name: 'Backstab', roles: ['assassin'], tags: ['execute', 'backstab', 'finisher', 'assassinate', 'kill'], delivery: at.melee(2.5), effects: [execute(30, 80), phys(40, 0.8)], cooldown: 10, ai: ai('finisher', 9, { targetHealthBelow: 0.35 }) }),
  active({ id: 'assassin-smoke-bomb', name: 'Smoke Bomb', roles: ['assassin'], tags: ['smoke', 'escape', 'bomb', 'cloud', 'slow', 'vanish'], delivery: at.zone(0, 3), effects: [slow(40, 2.5), buff('moveSpeed', 40, 2.5)], cooldown: 14, ai: ai('escape', 7, { selfHealthBelow: 0.4 }) }),
  active({ id: 'assassin-venom-blade', name: 'Venom Blade', roles: ['assassin'], tags: ['poison', 'venom', 'toxin', 'dot', 'acid', 'bleed'], delivery: at.melee(2.5), effects: [phys(70, 0.8, 4)], cooldown: 8, ai: ai('poke', 6) }),
  active({ id: 'assassin-death-mark', name: 'Death Mark', roles: ['assassin'], tags: ['mark', 'hunt', 'target', 'curse', 'prey'], delivery: at.proj(18), effects: [spirit(30, 0.4), buff('damage', 25, 5)], cooldown: 12, ai: ai('open', 7) }),
  active({ id: 'assassin-shuriken-fan', name: 'Shuriken Fan', roles: ['assassin'], tags: ['shuriken', 'fan', 'spread', 'cone', 'barrage', 'needles'], delivery: at.cone(8, 3), effects: [phys(35, 0.6)], cooldown: 7, ai: ai('poke', 5, { minTargets: 1 }) }),
  active({ id: 'assassin-vanish', name: 'Vanish', roles: ['assassin'], tags: ['stealth', 'invisible', 'vanish', 'cloak', 'disappear', 'phase'], delivery: at.self(), effects: [move(0, 1.2), buff('moveSpeed', 30, 3), buff('damage', 20, 3)], cooldown: 16, ai: ai('escape', 8, { selfHealthBelow: 0.3 }) }),

  passive({ id: 'assassin-cull-the-weak', name: 'Cull the Weak', roles: ['assassin'], tags: ['execute', 'predator', 'cull', 'finisher'], delivery: at.self(), effects: [execute(25, 30)], trigger: 'always', ai: ai('always', 0) }),
  passive({ id: 'assassin-precision', name: 'Precision', roles: ['assassin'], tags: ['crit', 'precision', 'third-hit', 'vital-strike'], delivery: at.melee(2.5), effects: [phys(18, 0.5)], trigger: 'everyThirdHit', ai: ai('always', 0) }),
  passive({ id: 'assassin-evasion', name: 'Evasion', roles: ['assassin'], tags: ['evasion', 'dodge', 'nimble', 'agile', 'low-health'], delivery: at.self(), effects: [buff('damageReduction', 25, 3), buff('moveSpeed', 30, 3)], trigger: 'lowHealth', ai: ai('always', 0) }),

  ultimate({ id: 'assassin-death-blossom', name: 'Death Blossom', roles: ['assassin'], tags: ['blossom', 'spin', 'blades', 'aoe', 'slow', 'storm'], delivery: at.aura(5), effects: [phys(160, 1.4, 2), slow(40, 2)], cooldown: 60, ai: ai('engage', 8, { minTargets: 2 }) }),
  ultimate({ id: 'assassin-thousand-cuts', name: 'Thousand Cuts', roles: ['assassin'], tags: ['thousand-cuts', 'blink', 'execute', 'flurry', 'finisher', 'omnislash'], delivery: at.blink(12), effects: [move(12, 1), execute(40, 60), phys(150, 1.4)], cooldown: 65, ai: ai('finisher', 9, { targetHealthBelow: 0.5 }) }),
  ultimate({ id: 'assassin-phantom-rush', name: 'Phantom Rush', roles: ['assassin'], tags: ['phantom', 'clone', 'rush', 'afterimage', 'dash'], delivery: at.dash(15), effects: [move(15, 1.5), phys(120, 1.2), stun(0.6)], cooldown: 70, ai: ai('engage', 8) }),

  movement({ id: 'assassin-wall-run', name: 'Wall Run', roles: ['assassin'], tags: ['wall-run', 'parkour', 'run', 'climb'], delivery: at.dash(8), effects: [move(8), buff('moveSpeed', 30, 2)], cooldown: 9, ai: ai('escape', 4) }),
  movement({ id: 'shared-grapple-hook', name: 'Grapple Hook', roles: ['assassin', 'marksman'], tags: ['grapple', 'hook', 'swing', 'zipline', 'rope', 'web'], delivery: at.grapple(18), effects: [move(14), heal(15, 0.1)], cooldown: 15, ai: ai('escape', 5) }),
]
