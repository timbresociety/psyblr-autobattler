import { ai, at, basic, buff, movement, phys, spirit, move } from './dsl'

/** Templates several roles draw from, so every role has at least three options in every slot (R7). */
export const SHARED = [
  basic({ id: 'shared-ki-blast', name: 'Ki Blast', roles: ['support', 'tank', 'fighter'], tags: ['ki', 'energy', 'blast', 'projectile', 'orb', 'chi'], delivery: at.proj(18), effects: [spirit(8, 0.7)], ai: ai('always', 1) }),
  basic({ id: 'shared-shotgun-blast', name: 'Shotgun Blast', roles: ['marksman', 'assassin'], tags: ['shotgun', 'blast', 'spread', 'close-range', 'scattergun'], delivery: at.cone(7, 3), effects: [phys(2, 0.6)], ai: ai('always', 1) }),
  movement({ id: 'shared-sprint-burst', name: 'Sprint Burst', roles: ['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support'], tags: ['sprint', 'run', 'speed', 'burst', 'haste'], delivery: at.self(), effects: [buff('moveSpeed', 50, 3)], cooldown: 9, ai: ai('escape', 3) }),
  movement({ id: 'shared-air-dash', name: 'Air Dash', roles: ['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support'], tags: ['air-dash', 'dash', 'air', 'flight', 'zip', 'instant-transmission'], delivery: at.dash(6), effects: [move(6), buff('damage', 10, 2)], cooldown: 8, ai: ai('engage', 3) }),
]
