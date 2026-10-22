import { active, ai, at, basic, buff, execute, movement, passive, phys, push, shield, slow, stun, ultimate, move } from './dsl'

export const MARKSMAN = [
  basic({ id: 'marksman-rifle-shot', name: 'Rifle Shot', roles: ['marksman'], tags: ['rifle', 'gun', 'shot', 'bullet', 'projectile', 'sniper'], delivery: at.proj(26), effects: [phys(4, 1)], ai: ai('always', 1) }),
  basic({ id: 'marksman-burst-fire', name: 'Burst Fire', roles: ['marksman'], tags: ['burst', 'smg', 'rapid-fire', 'pistol', 'bullets'], delivery: at.proj(18), effects: [phys(6, 1, 0.3)], ai: ai('always', 1) }),
  basic({ id: 'marksman-longbow', name: 'Longbow', roles: ['marksman'], tags: ['bow', 'arrow', 'archer', 'longbow', 'crossbow'], delivery: at.proj(30), effects: [phys(2, 0.9)], ai: ai('always', 1) }),

  active({ id: 'marksman-piercing-shot', name: 'Piercing Shot', roles: ['marksman'], tags: ['pierce', 'railgun', 'beam', 'line', 'penetrate'], delivery: at.beam(30), effects: [phys(55, 0.9)], cooldown: 9, ai: ai('poke', 6) }),
  active({ id: 'marksman-scatter-shot', name: 'Scatter Shot', roles: ['marksman'], tags: ['scatter', 'shotgun', 'spread', 'cone', 'slow'], delivery: at.cone(10, 4), effects: [phys(35, 0.6), slow(30, 1.5)], cooldown: 8, ai: ai('peel', 6, { minTargets: 1 }) }),
  active({ id: 'marksman-concussive-round', name: 'Concussive Round', roles: ['marksman'], tags: ['concussive', 'knockback', 'blast', 'push', 'repel'], delivery: at.proj(20), effects: [push(5), phys(30, 0.5)], cooldown: 10, ai: ai('peel', 7) }),
  active({ id: 'marksman-bear-trap', name: 'Bear Trap', roles: ['marksman'], tags: ['trap', 'snare', 'root', 'stun', 'mine'], delivery: at.zone(10, 2), effects: [stun(1.2), phys(20, 0.3)], cooldown: 12, ai: ai('peel', 6) }),
  active({ id: 'marksman-overdrive', name: 'Overdrive', roles: ['marksman'], tags: ['overdrive', 'rapid', 'haste', 'adrenaline', 'buff'], delivery: at.self(), effects: [buff('attackSpeed', 50, 5)], cooldown: 14, ai: ai('engage', 6) }),
  active({ id: 'marksman-snipe', name: 'Snipe', roles: ['marksman'], tags: ['snipe', 'headshot', 'scope', 'long-range', 'sniper'], delivery: at.proj(40), effects: [phys(140, 1.6)], cooldown: 18, ai: ai('finisher', 7, { targetHealthBelow: 0.5 }) }),
  active({ id: 'marksman-incendiary-grenade', name: 'Incendiary Grenade', roles: ['marksman'], tags: ['grenade', 'fire', 'burn', 'explosive', 'molotov', 'dot'], delivery: at.zone(14, 3), effects: [phys(60, 0.6, 3)], cooldown: 10, ai: ai('poke', 5, { minTargets: 2 }) }),

  passive({ id: 'marksman-headhunter', name: 'Headhunter', roles: ['marksman'], tags: ['headshot', 'crit', 'third-hit', 'precision'], delivery: at.proj(26), effects: [phys(15, 0.45)], trigger: 'everyThirdHit', ai: ai('always', 0) }),
  passive({ id: 'marksman-steady-aim', name: 'Steady Aim', roles: ['marksman'], tags: ['aim', 'steady', 'focus', 'marksmanship'], delivery: at.self(), effects: [buff('attackSpeed', 12, 1)], trigger: 'always', ai: ai('always', 0) }),
  passive({ id: 'marksman-kill-rush', name: 'Kill Rush', roles: ['marksman'], tags: ['bounty', 'kill', 'rush', 'momentum', 'hunt'], delivery: at.self(), effects: [buff('moveSpeed', 40, 4), buff('attackSpeed', 30, 4)], trigger: 'onKill', ai: ai('always', 0) }),

  ultimate({ id: 'marksman-orbital-strike', name: 'Orbital Strike', roles: ['marksman'], tags: ['orbital', 'satellite', 'airstrike', 'laser', 'strike', 'bombard'], delivery: at.zone(35, 5), effects: [phys(220, 1.6)], cooldown: 70, ai: ai('engage', 8, { minTargets: 2 }) }),
  ultimate({ id: 'marksman-bullet-storm', name: 'Bullet Storm', roles: ['marksman'], tags: ['minigun', 'storm', 'barrage', 'gatling', 'suppress'], delivery: at.cone(14, 6), effects: [phys(200, 1.6, 3)], cooldown: 65, ai: ai('engage', 8, { minTargets: 2 }) }),
  ultimate({ id: 'marksman-deadeye', name: 'Deadeye', roles: ['marksman'], tags: ['deadeye', 'execute', 'lock-on', 'one-shot', 'finisher'], delivery: at.proj(35), effects: [execute(40, 100), phys(120, 1.2)], cooldown: 60, ai: ai('finisher', 9, { targetHealthBelow: 0.45 }) }),

  movement({ id: 'marksman-combat-roll', name: 'Combat Roll', roles: ['marksman'], tags: ['roll', 'dodge', 'tumble', 'evade'], delivery: at.dash(6), effects: [move(6), buff('attackSpeed', 30, 2)], cooldown: 7, ai: ai('escape', 4) }),
  movement({ id: 'marksman-jetpack', name: 'Jetpack', roles: ['marksman'], tags: ['jetpack', 'flight', 'fly', 'rocket', 'thrusters', 'hover'], delivery: at.dash(10), effects: [move(10), shield(30, 2)], cooldown: 12, ai: ai('escape', 5) }),
]
