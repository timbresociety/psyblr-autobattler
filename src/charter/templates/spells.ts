import { ai, at, heal, shield, blind, cripple, disarm, execute, field, form, knockup, mark, phys, push, reflect, resize, reveal, rewind, root, shred, silence, slow, spell, spirit, steal, stun, swapHealth, vulnerable, wall, wound, buff, passive, unstoppable } from './dsl.js'

/**
 * The spell universe's new entries (GAME.md §4 Q): the eleven melee strikes that were in Q, each now a spell of its
 * family (the table in §4; names and effects are the owner's open question 5), and the spells the families needed to
 * reach four each (construct, vision and trick). Then the transformations the passive row holds (§4 F).
 */
export const SPELLS = [
  // the strikes that were in Q
  spell({ id: 'fighter-force-palm', family: 'control', name: 'Force Palm', roles: ['fighter'], tags: ['palm', 'push', 'stun', 'ki', 'force', 'shove', 'haymaker'], delivery: at.cone(4, 2.5), effects: [push(4), stun(0.5), spirit(40, 0.6)], cooldown: 10, ai: ai('engage', 7) }),
  spell({ id: 'fighter-updraft', family: 'displacement', name: 'Updraft', roles: ['fighter'], tags: ['updraft', 'launch', 'knock-up', 'uppercut', 'wind', 'tornado'], delivery: at.zone(8, 1.8), effects: [knockup(0.7), spirit(35, 0.6)], cooldown: 9, ai: ai('engage', 7) }),
  // a blink would be the movement row's: the lunge is the shadow's, which marks what it reaches (§4 E holds the moves)
  spell({ id: 'assassin-shadow-lunge', family: 'curse', name: 'Shadow Lunge', roles: ['assassin'], tags: ['shadow', 'lunge', 'mark', 'backstab', 'execute', 'finisher'], delivery: at.proj(9, undefined, 30), effects: [mark(20, 4), execute(30, 60), phys(30, 0.6)], cooldown: 10, ai: ai('finisher', 8, { targetHealthBelow: 0.5 }) }),
  spell({ id: 'assassin-venom-dart', family: 'curse', name: 'Venom Dart', roles: ['assassin'], tags: ['poison', 'venom', 'toxin', 'dot', 'dart', 'blowgun'], delivery: at.proj(16), effects: [phys(70, 0.8, 4)], cooldown: 8, ai: ai('poke', 6) }),
  spell({ id: 'assassin-paralysis-needle', family: 'control', name: 'Paralysis Needle', roles: ['assassin', 'controller'], tags: ['needle', 'paralyze', 'nerve', 'root', 'senbon', 'pressure-point'], delivery: at.proj(14), effects: [root(1.2), slow(30, 2), phys(25, 0.4)], cooldown: 11, ai: ai('engage', 6) }),
  spell({ id: 'assassin-hush-sigil', family: 'control', name: 'Hush Sigil', roles: ['assassin', 'controller', 'mage'], tags: ['silence', 'hush', 'sigil', 'mute', 'quiet', 'seal'], delivery: at.proj(14), effects: [silence(1.5), spirit(30, 0.5)], cooldown: 11, ai: ai('engage', 7) }),
  spell({ id: 'assassin-expose', family: 'curse', name: 'Expose', roles: ['assassin', 'marksman'], tags: ['expose', 'weakness', 'vulnerable', 'weak-spot', 'mark'], delivery: at.proj(16), effects: [vulnerable(20, 4), spirit(25, 0.4)], cooldown: 10, ai: ai('open', 7) }),
  spell({ id: 'fighter-crippling-hex', family: 'curse', name: 'Crippling Hex', roles: ['fighter', 'controller'], tags: ['cripple', 'hex', 'slow', 'hamstring', 'curse', 'maim'], delivery: at.proj(14), effects: [cripple(40, 2.5), slow(30, 2.5), spirit(25, 0.4)], cooldown: 10, ai: ai('engage', 6) }),
  spell({ id: 'fighter-disarm-lash', family: 'control', name: 'Disarm Lash', roles: ['fighter', 'assassin'], tags: ['disarm', 'lash', 'whip', 'knock-weapon', 'riposte'], delivery: at.beam(7, 1), effects: [disarm(1.5), spirit(25, 0.4)], cooldown: 11, ai: ai('engage', 6) }),
  spell({ id: 'fighter-rend', family: 'curse', name: 'Rend', roles: ['fighter'], tags: ['rend', 'wound', 'bleed', 'gash', 'anti-heal', 'claw'], delivery: at.cone(5, 3), effects: [wound(40, 3), shred(5, 3), phys(30, 0.5)], cooldown: 9, ai: ai('engage', 6) }),
  spell({ id: 'tank-ground-sunder', family: 'curse', shape: 'line', name: 'Ground Sunder', roles: ['tank', 'fighter'], tags: ['sunder', 'armor-break', 'shatter', 'fissure', 'ground', 'shred'], delivery: at.beam(9, 1.6), effects: [shred(10, 4), slow(25, 2), phys(35, 0.5)], cooldown: 9, ai: ai('engage', 6) }),

  // counter: the next blow is answered instead of taken (§4 Q Counter)
  spell({ id: 'fighter-riposte', family: 'counter', name: 'Riposte', roles: ['fighter', 'assassin', 'tank'], tags: ['counter', 'riposte', 'parry', 'answer', 'retaliate', 'stance'], delivery: at.self(), effects: [{ kind: 'counter', duration: 1.2, answer: 'strike' }, phys(50, 0.8)], cooldown: 8, ai: ai('peel', 6) }),
  spell({ id: 'assassin-substitution', family: 'counter', name: 'Substitution', roles: ['assassin', 'fighter'], tags: ['substitute', 'log', 'decoy', 'vanish', 'swap', 'escape'], delivery: at.self(), effects: [{ kind: 'counter', duration: 2.5, answer: 'substitute' }], cooldown: 8, ai: ai('peel', 6) }),
  spell({ id: 'tank-mirror-guard', family: 'counter', name: 'Mirror Guard', roles: ['tank', 'controller'], tags: ['mirror', 'reflect', 'rebound', 'guard', 'return', 'deflect'], delivery: at.self(), effects: [{ kind: 'counter', duration: 2.5, answer: 'reflect' }], cooldown: 8, ai: ai('peel', 6) }),
  spell({ id: 'support-drink-the-blow', family: 'counter', name: 'Drink the Blow', roles: ['support', 'mage', 'tank'], tags: ['absorb', 'drink', 'siphon', 'soak', 'feed', 'sponge'], delivery: at.self(), effects: [{ kind: 'counter', duration: 2, answer: 'absorb' }, heal(20, 0.2)], cooldown: 8, ai: ai('peel', 6) }),

  // construct: geometry on the map
  spell({ id: 'controller-ice-pillar', family: 'construct', name: 'Ice Pillar', roles: ['controller', 'mage', 'tank'], tags: ['ice', 'pillar', 'column', 'ramp', 'iceman', 'block'], delivery: at.zone(10, 1.5), effects: [wall(2.4, 7, 500, 3.5), knockup(0.4, 1.5), spirit(25, 0.3)], cooldown: 12, ai: ai('peel', 5) }),

  // vision: information and its denial
  spell({ id: 'marksman-reveal-pulse', family: 'vision', name: 'Reveal Pulse', roles: ['marksman', 'assassin', 'controller'], tags: ['reveal', 'pulse', 'scan', 'sonar', 'detect', 'wallhack'], delivery: at.aura(9), effects: [reveal(4), mark(6, 4), spirit(10, 0.1)], cooldown: 18, ai: ai('open', 5) }),
  spell({ id: 'support-echo-ping', family: 'vision', name: 'Echo Ping', roles: ['support', 'summoner', 'marksman'], tags: ['echo', 'ping', 'sonar', 'radar', 'detect', 'scout'], delivery: at.zone(20, 6), effects: [reveal(4), slow(15, 1), spirit(15, 0.2)], cooldown: 14, ai: ai('open', 5) }),
  spell({ id: 'assassin-smoke-screen', family: 'vision', name: 'Smoke Screen', roles: ['assassin', 'marksman', 'summoner'], tags: ['smoke', 'screen', 'cloud', 'blind', 'cover', 'fog'], delivery: at.zone(12, 3.5), effects: [field(3, 1), blind(0.8), spirit(5, 0.05)], cooldown: 16, ai: ai('peel', 6) }),

  // trick: bends the rules of a fight
  spell({ id: 'tank-reflect-barrier', family: 'trick', name: 'Reflect Barrier', roles: ['tank', 'support', 'controller'], tags: ['reflect', 'mirror', 'barrier', 'deflect', 'bounce', 'return'], delivery: at.aura(5), effects: [reflect(1.6), shield(30, 2, 'allies', 0.3)], cooldown: 16, ai: ai('peel', 6) }),
  spell({ id: 'controller-health-swap', family: 'trick', name: 'Health Swap', roles: ['controller', 'assassin', 'mage'], tags: ['swap', 'health', 'trade', 'life', 'exchange', 'switch'], delivery: at.proj(12), effects: [swapHealth(0.3), spirit(20, 0.3)], cooldown: 20, ai: ai('sustain', 7, { selfHealthBelow: 0.4 }) }),
  spell({ id: 'mage-spell-steal', family: 'trick', name: 'Spell Steal', roles: ['mage', 'controller', 'support'], tags: ['steal', 'spell', 'thief', 'drain', 'copy', 'siphon'], delivery: at.proj(14), effects: [steal(6), spirit(20, 0.3)], cooldown: 12, ai: ai('engage', 5) }),
  spell({ id: 'support-rewind', family: 'trick', name: 'Rewind', roles: ['support', 'mage'], tags: ['rewind', 'time', 'chrono', 'undo', 'restore', 'past'], delivery: at.proj(14), effects: [rewind(3), heal(30, 0.2, 'ally')], cooldown: 16, ai: ai('support', 7) }),
]

/**
 * Transformations live in the passive row (§4 F): switched on with F and lasting as long as their energy, each carries
 * a size, a buff or two and a look. The ultimate can still hold a stronger, shorter form.
 */
export const FORMS = [
  passive({ id: 'shared-super-form', name: 'Super Form', roles: ['fighter', 'assassin', 'mage', 'marksman'], tags: ['transform', 'super', 'saiyan', 'aura', 'power-up', 'form', 'golden'], delivery: at.self(), effects: [form(1), buff('damage', 12, 1), buff('attackSpeed', 12, 1)], trigger: 'always', energy: { seconds: 10, refill: 22 }, ai: ai('always', 0) }),
  passive({ id: 'shared-shrink', name: 'Shrink', roles: ['assassin', 'marksman', 'controller', 'summoner'], tags: ['shrink', 'tiny', 'ant', 'small', 'transform', 'quantum'], delivery: at.self(), effects: [resize('small', 1), buff('evasion', 15, 1), buff('moveSpeed', 15, 1)], trigger: 'always', energy: { seconds: 10, refill: 22 }, ai: ai('always', 0) }),
  passive({ id: 'shared-giant-body', name: 'Giant Body', roles: ['tank', 'fighter', 'support'], tags: ['giant', 'grow', 'titan', 'huge', 'transform', 'colossus'], delivery: at.self(), effects: [resize('large', 1), buff('damageReduction', 15, 1), buff('damage', 8, 1)], trigger: 'always', energy: { seconds: 10, refill: 22 }, ai: ai('always', 0) }),
  passive({ id: 'shared-titan-form', name: 'Titan Form', roles: ['tank', 'fighter'], tags: ['titan', 'colossal', 'kaiju', 'giant', 'transform', 'attack-on-titan'], delivery: at.self(), effects: [resize('huge', 1), buff('damageReduction', 20, 1), unstoppable(1)], trigger: 'always', energy: { seconds: 7, refill: 28 }, ai: ai('always', 0) }),
  passive({ id: 'shared-elemental-body', name: 'Elemental Body', roles: ['mage', 'controller', 'summoner', 'support'], tags: ['elemental', 'fire', 'flame-body', 'ice-body', 'lightning', 'transform'], delivery: at.self(), effects: [form(1), buff('lifesteal', 15, 1), buff('damageReduction', 10, 1)], trigger: 'always', energy: { seconds: 10, refill: 22 }, ai: ai('always', 0) }),
]

