import { ai, at, buff, heal, melee, movement, passive, phys, ranged, spell, ultimate } from '../../charter/templates/dsl.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { ArmPiece, GearSlot } from '../../charter/look.js'
import type { CarrySlot } from '../../kit/rig/metarig.js'
import type { BuildSlot, Delivery, Effect, Flight, MeleeStyle, RangedSpec, SpellFamily, Template, TraverseKind } from '../../charter/types.js'

/**
 * John's lab (`/dev/john`, session 2 plan): one of everything in the locked library (GAME.md §4), to pick onto John's
 * buttons, and the checklist the owner marks. The catalogue reuses what it has; what only the locked library has (the
 * new Q pieces, the E kinds, the elemental sheaths, the new R shapes) is made here, on short cooldowns so a row can be
 * tried again and again. None of it is in the catalogue: the Forge never offers it.
 */

export interface LabOption {
  id: string
  label: string
  /** The family or kind it stands for, as GAME.md §4 names it. */
  group: string
  slot: BuildSlot
  template: Template
  /** For Q: who to try it on. */
  targets?: readonly LabTarget[]
  /** Its bodies are made when the match starts (summons): picking it restarts the fight. */
  restart?: boolean
}

export type LabTarget = 'dummy' | 'enemy' | 'ally'

const ROLES = ['fighter' as const]
const TAGS = ['lab']
/** The lab's cooldowns: short, so a row can be tried again at once. */
const QUICK = { q: 2, e: 1.5, r: 6 }
const quick = (t: Template, seconds: number): Template => ({ ...t, cooldown: Math.min(t.cooldown, seconds) })
const fromCatalog = (id: string, seconds: number) => quick(getTemplate(id), seconds)

// V: the eleven families, each the catalogue's own template for its style

const V_FAMILIES: readonly [MeleeStyle, string][] = [
  ['paired', 'Paired'],
  ['shield', 'With a shield'],
  ['unarmed', 'Fists'],
  ['kicks', 'Kicks'],
  ['blade', 'One-hand edge'],
  ['greatsword', 'Two-hand edge'],
  ['axe', 'Chop and reap'],
  ['club', 'Smash'],
  ['spear', 'Thrust'],
  ['staff', 'Staff spin'],
  ['whip', 'Flexible'],
]

export const V_OPTIONS: readonly LabOption[] = V_FAMILIES.map(([style, label]) => ({ id: `v-${style}`, label, group: 'V', slot: 'basic', template: getTemplate(`melee-${style}`) }))

// LMB: a family (its grip), a way to fire and a way the shot flies, put together on the spot

export type LmbFamily = 'emitter' | 'thrown' | 'pistol' | 'paired' | 'rifle' | 'heavy' | 'bow' | 'magic1' | 'magic2'
export type LmbMode = 'single' | 'burst' | 'spread' | 'beam' | 'channel' | 'auto' | 'charge'
export type LmbFlight = Flight

export const LMB_FAMILIES: readonly { id: LmbFamily; label: string; spec: Pick<RangedSpec, 'style' | 'hands'>; standIn: string }[] = [
  { id: 'emitter', label: 'Body emitter', spec: { style: 'emitter' }, standIn: 'shared-ki-blast' },
  { id: 'thrown', label: 'Thrown', spec: { style: 'thrown' }, standIn: 'assassin-throwing-knives' },
  { id: 'pistol', label: 'One-hand gun', spec: { style: 'pistol' }, standIn: 'shared-sidearm' },
  { id: 'paired', label: 'Paired guns', spec: { style: 'paired' }, standIn: 'shared-sidearm' },
  { id: 'rifle', label: 'Long gun', spec: { style: 'rifle' }, standIn: 'marksman-rifle-shot' },
  { id: 'heavy', label: 'Heavy gun', spec: { style: 'heavy' }, standIn: 'tank-shoulder-cannon' },
  { id: 'bow', label: 'Bow', spec: { style: 'bow' }, standIn: 'marksman-longbow' },
  { id: 'magic1', label: 'Magic, one hand', spec: { style: 'magic', hands: 1 }, standIn: 'mage-arcane-bolt' },
  { id: 'magic2', label: 'Magic, two hands', spec: { style: 'magic', hands: 2 }, standIn: 'shared-energy-wave' },
]

export const LMB_MODES: readonly { id: LmbMode; label: string }[] = [
  { id: 'single', label: 'Single shots' },
  { id: 'burst', label: 'Burst' },
  { id: 'spread', label: 'Spread' },
  { id: 'beam', label: 'Beam' },
  { id: 'channel', label: 'Held beam (clashes)' },
  { id: 'auto', label: 'Hold for full auto' },
  { id: 'charge', label: 'Hold to charge' },
]

export const LMB_FLIGHTS: readonly { id: LmbFlight; label: string }[] = [
  { id: 'straight', label: 'Straight' },
  { id: 'lobbed', label: 'Lobbed arc' },
  { id: 'bouncing', label: 'Bouncing' },
  { id: 'returning', label: 'Returning' },
  { id: 'homing', label: 'Homing' },
  { id: 'guided', label: 'Guided' },
]

/** Whether a way to fire sends a shot that flies (a spread is a cone and a beam lands at once: neither flies). */
export const flies = (mode: LmbMode) => mode !== 'spread' && mode !== 'beam' && mode !== 'channel'

export const lmbId = (family: LmbFamily, mode: LmbMode, flight: LmbFlight = 'straight') => `lmb-${family}-${mode}-${flies(mode) ? flight : 'straight'}`

/** An LMB weapon of `family` firing `mode`, its shots flying `flight`. */
export function lmb(family: LmbFamily, mode: LmbMode, flight: LmbFlight = 'straight'): Template {
  const f = LMB_FAMILIES.find((x) => x.id === family)!
  const base: RangedSpec = { ...f.spec, mode: 'single', rate: 2, magazine: 12, reload: 1.4 }
  const spec: RangedSpec =
    mode === 'burst' ? { ...base, mode: 'burst', burst: 3, rate: 1, magazine: 24 }
    : mode === 'spread' ? { ...base, mode: 'pellets', pellets: 6, rate: 1.1, magazine: 8 }
    : mode === 'beam' ? { ...base, mode: 'beam', rate: 0.9, magazine: 6 }
    : mode === 'channel' ? { ...base, mode: 'channel', rate: 6, magazine: 300 }
    : mode === 'auto' ? { ...base, mode: 'auto', rate: 7, magazine: 30, reload: 1.8 }
    : base
  const shot: Delivery = flight === 'lobbed' ? { ...at.proj(30, 2, 18), flight } : flight === 'bouncing' ? { ...at.proj(30, undefined, 30), flight, bounces: 2 } : flight === 'straight' ? at.proj(30, undefined, 40) : { ...at.proj(30, undefined, 22), flight }
  const delivery = mode === 'spread' ? at.cone(10, 3) : mode === 'beam' || mode === 'channel' ? at.beam(20, 0.8) : shot
  return {
    ...ranged({ id: lmbId(family, mode, flight), name: `${f.label}: ${mode}`, roles: ROLES, tags: TAGS, ai: ai('poke', 1), delivery, effects: [phys(mode === 'channel' ? 6 : 20, 0)], ranged: spec }),
    ...(mode === 'charge' ? { charge: { seconds: 1, min: 0.4, max: 2.5 } } : {}),
  }
}

// Q: the eleven families, each on what it applies to

const q = (id: string, family: SpellFamily, delivery: Delivery, effects: Effect[], extra: Partial<Template> = {}): Template => ({
  ...spell({ id: `lab-${id}`, name: id, family, roles: ROLES, tags: TAGS, ai: ai('poke', 1), cooldown: QUICK.q, delivery, effects }),
  ...extra,
})
const FOES: readonly LabTarget[] = ['dummy', 'enemy']
const FRIEND: readonly LabTarget[] = ['ally']
const ANY: readonly LabTarget[] = ['dummy', 'enemy', 'ally']

export const Q_OPTIONS: readonly LabOption[] = [
  { id: 'q-riposte', label: 'Riposte (parry-strike)', group: 'Counter', slot: 'active2', template: fromCatalog('fighter-riposte', QUICK.q), targets: ['enemy'] },
  { id: 'q-substitution', label: 'Substitution', group: 'Counter', slot: 'active2', template: fromCatalog('assassin-substitution', QUICK.q), targets: ['enemy'] },
  { id: 'q-mirror', label: 'Mirror guard (reflect)', group: 'Counter', slot: 'active2', template: fromCatalog('tank-mirror-guard', QUICK.q), targets: ['enemy'] },
  { id: 'q-drink', label: 'Drink the blow (absorb)', group: 'Counter', slot: 'active2', template: fromCatalog('support-drink-the-blow', QUICK.q), targets: ['enemy'] },
  { id: 'q-minions', label: 'Minions', group: 'Summon', slot: 'active2', template: q('minions', 'summon', at.self(), [{ kind: 'summon', what: 'minion', count: 2, duration: 10 }]), targets: FOES, restart: true },
  { id: 'q-clone', label: 'Clone', group: 'Summon', slot: 'active2', template: q('clone', 'summon', at.self(), [{ kind: 'summon', what: 'clone', count: 1, duration: 10 }]), targets: FOES, restart: true },
  { id: 'q-decoy', label: 'Decoy', group: 'Summon', slot: 'active2', template: q('decoy', 'summon', at.self(), [{ kind: 'summon', what: 'decoy', count: 1, duration: 6 }]), targets: ['enemy'], restart: true },
  { id: 'q-wall', label: 'Wall', group: 'Construct', slot: 'active2', template: fromCatalog('tank-barricade', QUICK.q), targets: FOES },
  { id: 'q-barrier', label: 'One-way barrier', group: 'Construct', slot: 'active2', template: q('barrier', 'construct', at.zone(4, 0.5), [{ kind: 'barrier', length: 5, height: 3, duration: 8, health: 5000 }]), targets: ['enemy'] },
  { id: 'q-ramp', label: 'Ramp', group: 'Construct', slot: 'active2', template: q('ramp', 'construct', at.self(), [{ kind: 'terrain', shape: 'ramp', length: 6, width: 2, height: 2.5, duration: 10 }]) },
  { id: 'q-platform', label: 'Platform', group: 'Construct', slot: 'active2', template: q('platform', 'construct', at.zone(5, 1), [{ kind: 'terrain', shape: 'platform', length: 3, width: 3, height: 2, duration: 10 }]) },
  { id: 'q-path', label: 'Ice path', group: 'Construct', slot: 'active2', template: q('path', 'construct', at.self(), [{ kind: 'terrain', shape: 'path', length: 10, width: 1.6, height: 1.2, duration: 10 }]) },
  { id: 'q-portal', label: 'Portal', group: 'Construct', slot: 'active2', template: q('portal', 'construct', at.zone(10, 1), [{ kind: 'portal', duration: 10 }]) },
  { id: 'q-turret', label: 'Turret', group: 'Construct', slot: 'active2', template: fromCatalog('summoner-sentry-turret', QUICK.q), targets: FOES },
  { id: 'q-trap', label: 'Trap', group: 'Construct', slot: 'active2', template: fromCatalog('marksman-bear-trap', QUICK.q), targets: ['enemy'] },
  { id: 'q-totem', label: 'Totem', group: 'Construct', slot: 'active2', template: fromCatalog('support-healing-totem', QUICK.q), targets: FRIEND },
  { id: 'q-swap-health', label: 'Swap health', group: 'Trick', slot: 'active2', template: fromCatalog('controller-health-swap', QUICK.q), targets: FOES },
  { id: 'q-steal', label: 'Steal a spell', group: 'Trick', slot: 'active2', template: fromCatalog('mage-spell-steal', QUICK.q), targets: FOES },
  { id: 'q-rewind', label: 'Rewind', group: 'Trick', slot: 'active2', template: fromCatalog('support-rewind', QUICK.q), targets: FRIEND },
  { id: 'q-copy', label: 'Copy a kit', group: 'Trick', slot: 'active2', template: q('copy', 'trick', at.proj(20), [{ kind: 'copyKit', duration: 8 }]), targets: FOES },
  { id: 'q-possess', label: 'Possession', group: 'Trick', slot: 'active2', template: q('possess', 'trick', at.proj(20), [{ kind: 'possess', duration: 4 }]), targets: FOES },
  { id: 'q-stun', label: 'Stun', group: 'Control', slot: 'active2', template: fromCatalog('tank-seismic-slam', QUICK.q), targets: FOES },
  { id: 'q-root', label: 'Root and grip', group: 'Control', slot: 'active2', template: fromCatalog('tank-earthen-grip', QUICK.q), targets: FOES },
  { id: 'q-hook', label: 'Pull (hook)', group: 'Displacement', slot: 'active2', template: fromCatalog('tank-chain-hook', QUICK.q), targets: FOES },
  { id: 'q-push', label: 'Push', group: 'Displacement', slot: 'active2', template: fromCatalog('tank-sonic-shockwave', QUICK.q), targets: FOES },
  { id: 'q-lift', label: 'Lift and throw', group: 'Displacement', slot: 'active2', template: q('lift', 'displacement', at.proj(20), [{ kind: 'lift', height: 3, hold: 1.2, distance: 8 }]), targets: FOES },
  { id: 'q-heal', label: 'Heal', group: 'Support', slot: 'active2', template: fromCatalog('support-healing-burst', QUICK.q), targets: FRIEND },
  { id: 'q-shield', label: 'Shield an ally', group: 'Support', slot: 'active2', template: fromCatalog('support-barrier', QUICK.q), targets: FRIEND },
  { id: 'q-revive', label: 'Revive at range', group: 'Support', slot: 'active2', template: q('revive', 'support', at.zone(10, 2), [{ kind: 'revive', share: 0.5, target: 'ally' }]), targets: FRIEND },
  { id: 'q-curse', label: 'Mark and bleed', group: 'Curse', slot: 'active2', template: fromCatalog('assassin-death-mark', QUICK.q), targets: FOES },
  { id: 'q-zone', label: 'Blizzard', group: 'Zone', slot: 'active2', template: fromCatalog('mage-blizzard', QUICK.q), targets: FOES },
  { id: 'q-reveal', label: 'Reveal pulse', group: 'Vision', slot: 'active2', template: fromCatalog('marksman-reveal-pulse', QUICK.q), targets: FOES },
  { id: 'q-fireball', label: 'Fireball', group: 'Burst', slot: 'active2', template: fromCatalog('mage-fireball', QUICK.q), targets: ANY.filter((t) => t !== 'ally') },
  { id: 'q-wave', label: 'Charged energy wave (hold Q)', group: 'Burst', slot: 'active2', template: q('wave', 'burst', at.proj(25, 1.5, 30), [phys(60, 0)], { charge: { seconds: 1.2, min: 0.5, max: 2 } }), targets: FOES },
  { id: 'q-cost', label: 'Spends half the power meter', group: 'Systems', slot: 'active2', template: q('cost', 'burst', at.proj(25), [phys(80, 0)], { cost: 0.5, cooldown: 1 }), targets: FOES },
  { id: 'q-charges', label: 'Two charges', group: 'Systems', slot: 'active2', template: q('charges', 'burst', at.proj(25), [phys(30, 0)], { charges: 2, cooldown: 4 }), targets: FOES },
]

// E: every way of moving, and the four shared moves done better

const e = (how: TraverseKind, distance: number, duration: number, extra: Effect[] = []): Template =>
  movement({ id: `lab-e-${how}`, name: how, roles: ROLES, tags: TAGS, ai: ai('escape', 1), cooldown: QUICK.e, delivery: at.self(), effects: [{ kind: 'traverse', how, distance, duration }, ...extra] })

export const E_OPTIONS: readonly LabOption[] = [
  { id: 'e-blink', label: 'Blink', group: 'Instant', slot: 'movement', template: fromCatalog('shared-phase-shift', QUICK.e) },
  { id: 'e-teleport', label: 'Teleport to a mark or a target', group: 'Instant', slot: 'movement', template: e('teleport', 15, 0) },
  { id: 'e-swap', label: 'Swap places', group: 'Instant', slot: 'movement', template: e('swap', 15, 0) },
  { id: 'e-dash', label: 'Dash', group: 'Line', slot: 'movement', template: fromCatalog('shared-air-dash', QUICK.e) },
  { id: 'e-homing', label: 'Homing dash', group: 'Line', slot: 'movement', template: e('homing', 12, 0, [phys(40, 0)]) },
  { id: 'e-leap', label: 'Leap', group: 'Arc', slot: 'movement', template: fromCatalog('fighter-sky-step', QUICK.e) },
  { id: 'e-grapple', label: 'Grapple to a point', group: 'Line attached', slot: 'movement', template: fromCatalog('shared-grapple-hook', QUICK.e) },
  { id: 'e-swing', label: 'Swing on a line', group: 'Line attached', slot: 'movement', template: e('swing', 14, 4) },
  { id: 'e-flight', label: 'Flight and hover', group: 'Held', slot: 'movement', template: e('flight', 0, 6) },
  { id: 'e-glide', label: 'Glide', group: 'Held', slot: 'movement', template: e('glide', 0, 6) },
  { id: 'e-crawl', label: 'Wall-crawl', group: 'Held', slot: 'movement', template: e('wallCrawl', 0, 6) },
  { id: 'e-burrow', label: 'Burrow', group: 'Held', slot: 'movement', template: e('burrow', 0, 2.5, [phys(50, 0)]) },
  { id: 'e-ride', label: 'Ride an ally', group: 'Held', slot: 'movement', template: e('ride', 8, 6) },
  { id: 'e-wall-run', label: 'Wall Run (any wall)', group: 'Shared, done better', slot: 'movement', template: e('wallRun', 0, 6) },
  { id: 'e-roll', label: 'Combat Roll', group: 'Shared, done better', slot: 'movement', template: e('combatRoll', 6, 0) },
  { id: 'e-slide', label: 'Power Slide', group: 'Shared, done better', slot: 'movement', template: e('powerSlide', 9, 0, [phys(30, 0)]) },
  { id: 'e-zipline', label: 'Zipline (fire your own)', group: 'Shared, done better', slot: 'movement', template: e('zipline', 20, 6) },
]

// F: auras, each a toggle on its own meter

const sheath = (element: 'flame' | 'frost' | 'lightning'): Template =>
  passive({ id: `lab-f-${element}`, name: `${element} sheath`, roles: ROLES, tags: TAGS, ai: ai('always', 1), delivery: at.self(), effects: [{ kind: 'element', element }], trigger: 'always' })

export const F_OPTIONS: readonly LabOption[] = [
  { id: 'f-flame', label: 'Flame sheath', group: 'Element', slot: 'passive', template: sheath('flame') },
  { id: 'f-frost', label: 'Frost sheath', group: 'Element', slot: 'passive', template: sheath('frost') },
  { id: 'f-lightning', label: 'Lightning sheath', group: 'Element', slot: 'passive', template: sheath('lightning') },
  { id: 'f-thorns', label: 'Thorns (when hit)', group: 'Trigger', slot: 'passive', template: passive({ id: 'lab-f-thorns', name: 'Thorns', roles: ROLES, tags: TAGS, ai: ai('always', 1), delivery: at.self(), effects: [phys(30, 0)], trigger: 'whenHit' }) },
  { id: 'f-berserk', label: 'Berserk (numbers)', group: 'Numbers', slot: 'passive', template: getTemplate('fighter-berserk') },
  { id: 'f-vanish', label: 'Vanish (state)', group: 'State', slot: 'passive', template: getTemplate('assassin-vanish') },
  { id: 'f-mana-shield', label: 'Mana shield', group: 'Numbers', slot: 'passive', template: getTemplate('mage-mana-shield') },
  // the catalogue's auras are all the caster's own (Benediction's buffs are filed for the support alone), so the lab
  // makes one that reaches the allies near
  {
    id: 'f-allies',
    label: 'Blessing (allies near you)',
    group: 'Allies',
    slot: 'passive',
    template: passive({ id: 'lab-f-allies', name: 'Blessing', roles: ROLES, tags: TAGS, ai: ai('always', 1), delivery: at.aura(8), effects: [buff('damageReduction', 6, 1, 'allies'), buff('moveSpeed', 8, 1, 'allies')], trigger: 'always' }),
  },
]

// R: the eight shapes

const r = (id: string, delivery: Delivery, effects: Effect[], extra: Partial<Template> = {}): Template => ({
  ...ultimate({ id: `lab-r-${id}`, name: id, roles: ROLES, tags: TAGS, ai: ai('engage', 1), cooldown: QUICK.r, delivery, effects }),
  ...extra,
})

export const R_OPTIONS: readonly LabOption[] = [
  { id: 'r-strike', label: 'Strike: the lock-on', group: 'Strike', slot: 'ultimate', template: r('strike', at.melee(3), [{ kind: 'lockon', hits: 4, duration: 1.2 }, phys(200, 0)]) },
  { id: 'r-devastation', label: 'Earthquake', group: 'Devastation', slot: 'ultimate', template: fromCatalog('tank-earthquake', QUICK.r) },
  { id: 'r-domain', label: 'Inferno', group: 'Domain', slot: 'ultimate', template: fromCatalog('mage-inferno', QUICK.r) },
  { id: 'r-rally', label: 'Mass revive', group: 'Rally', slot: 'ultimate', template: r('rally', at.aura(12), [{ kind: 'revive', share: 0.6, target: 'allies' }, heal(60, 0.2, 'allies')]) },
  { id: 'r-rampage', label: 'Bloodbath', group: 'Rampage', slot: 'ultimate', template: fromCatalog('fighter-bloodbath', QUICK.r) },
  {
    id: 'r-form',
    label: 'Staged form (R again to step up)',
    group: 'Ultimate form',
    slot: 'ultimate',
    template: r('form', at.self(), [{ kind: 'form', duration: 20, stages: 3 }], { switchTo: { basic: getTemplate('melee-greatsword') } }),
  },
  { id: 'r-titan-form', label: 'Titan form', group: 'Ultimate form', slot: 'ultimate', template: fromCatalog('tank-titan-form', QUICK.r) },
  { id: 'r-titan', label: 'Titan summon', group: 'Titan summon', slot: 'ultimate', template: r('titan', at.self(), [{ kind: 'summon', what: 'titan', count: 1, duration: 12 }]), restart: true },
  {
    id: 'r-switch',
    label: 'Kit switch (spear and rifle)',
    group: 'Kit switch',
    slot: 'ultimate',
    template: r('switch', at.self(), [{ kind: 'kitSwitch', duration: 12 }], { switchTo: { basic: getTemplate('melee-spear'), active1: lmb('rifle', 'auto') } }),
  },
  { id: 'r-fuse', label: 'Fusion (with the ally)', group: 'Systems', slot: 'ultimate', template: r('fuse', at.self(), [{ kind: 'fuse', duration: 8 }]) },
]

export const OPTIONS: readonly LabOption[] = [...V_OPTIONS, ...Q_OPTIONS, ...E_OPTIONS, ...F_OPTIONS, ...R_OPTIONS]

/** The option with this id, or an LMB weapon by its id (`lmb-family-mode-flight`). */
export function labTemplate(id: string): { slot: BuildSlot; template: Template; restart?: boolean } | undefined {
  const o = OPTIONS.find((x) => x.id === id)
  if (o) return o
  const m = /^lmb-(\w+)-(\w+)-(\w+)$/.exec(id)
  if (!m || !LMB_FAMILIES.some((f) => f.id === m[1]) || !LMB_MODES.some((x) => x.id === m[2]) || !(m[3] === 'straight' || LMB_FLIGHTS.some((x) => x.id === m[3]))) return undefined
  return { slot: 'active1', template: lmb(m[1] as LmbFamily, m[2] as LmbMode, m[3] as LmbFlight) }
}

/** What John carries in each slot, by option id; anything left out stays as his build has it. */
export type LabKit = Partial<Record<BuildSlot, string>>

export const DEFAULT_KIT: Required<LabKit> = {
  basic: 'v-blade',
  active1: lmbId('pistol', 'single'),
  active2: 'q-stun',
  movement: 'e-dash',
  passive: 'f-flame',
  ultimate: 'r-strike',
}

// the checklist

export interface LabRow {
  id: string
  /** The checklist section: V, LMB, Q, E, F, R, Systems, Traversal or Crossings. */
  section: string
  label: string
  /** What to do, in a line. */
  how?: string
  /** The loadout the row needs, put on John when the row is picked. */
  kit?: LabKit
  /** The bot modes the row needs. */
  bots?: Partial<Record<'ally' | 'dummy' | 'enemy', 'still' | 'block' | 'beam' | 'fight'>>
}

const V_MOVES: readonly [string, string][] = [
  ['light', 'Light chain: V, V, V; the third knocks back'],
  ['heavy', 'Charged heavy: hold V'],
  ['guard', 'Guard and guard hit: X against the enemy on Fight'],
  ['dash', 'Dash attack: V while sprinting'],
  ['air', 'Air attack: V in the air'],
  ['slam', 'Air slam: hold V in the air'],
  ['launch', 'Launcher, chase and air juggle: back + V, then V in the air'],
  ['grab', 'Grab and throw: V + X, close in'],
]

const TRAVERSAL: readonly [string, string][] = [
  ['hang', 'Hang from the ledge'],
  ['shimmy', 'Shimmy along the ledge'],
  ['climb', 'Climb up from the hang'],
  ['mantle', 'Mantle the ledge'],
  ['zipline', 'Ride the zipline'],
  ['wall-run', 'Wall-run the marked wall, and wall-jump off it'],
  ['slide', 'Slide'],
  ['pad', 'Jump pad'],
]

export const ROWS: readonly LabRow[] = [
  ...V_OPTIONS.flatMap((o) =>
    V_MOVES.map(([move, how]) => ({ id: `${o.id}.${move}`, section: 'V', label: `${o.label}: ${how.split(':')[0]}`, how, kit: { basic: o.id }, bots: move === 'guard' ? { enemy: 'fight' as const } : undefined })),
  ),
  ...LMB_FAMILIES.flatMap((f) => LMB_MODES.map((m) => ({ id: `${lmbId(f.id, m.id)}`, section: 'LMB', label: `${f.label}: ${m.label}`, kit: { active1: lmbId(f.id, m.id) }, bots: m.id === 'channel' ? { enemy: 'beam' as const } : undefined }))),
  ...LMB_FLIGHTS.map((fl) => ({ id: `flight.${fl.id}`, section: 'LMB', label: `Flight: ${fl.label}`, how: fl.id === 'bouncing' ? 'Bank a shot off the run wall' : fl.id === 'guided' ? 'Steer the shot with the aim as it flies' : undefined, kit: { active1: lmbId('magic1', 'single', fl.id) } })),
  ...Q_OPTIONS.flatMap((o) =>
    (o.targets ?? ['self' as const]).map((t) => ({ id: `${o.id}.${t}`, section: 'Q', label: `${o.group}: ${o.label}${t === 'self' ? '' : ` on the ${t}`}`, kit: { active2: o.id }, bots: t === 'enemy' && o.group === 'Counter' ? { enemy: 'fight' as const } : undefined })),
  ),
  ...E_OPTIONS.map((o) => ({ id: o.id, section: 'E', label: `${o.group}: ${o.label}`, how: o.id === 'e-ride' || o.id === 'e-swap' ? 'Aim at the ally' : o.id === 'e-crawl' ? 'Into the run wall or the ledge' : undefined, kit: { movement: o.id } })),
  ...F_OPTIONS.map((o) => ({ id: o.id, section: 'F', label: `${o.group}: ${o.label}`, how: o.id === 'f-allies' ? 'Stand by the ally and F on: it runs quicker and takes less while near you; walk off and it stops' : 'F on, watch the meter drain, F off; on again', kit: { passive: o.id } })),
  ...R_OPTIONS.map((o) => ({ id: o.id, section: 'R', label: `${o.group}: ${o.label}`, how: o.id === 'r-rally' ? 'Let the ally go down first (enemy on Fight)' : undefined, kit: { ultimate: o.id } })),
  { id: 'sys.teamup', section: 'Systems', label: 'Team-up: interact beside the ally to be thrown', how: 'Stand by the ally, aim at the dummy, press the interact key' },
  { id: 'sys.fuse', section: 'Systems', label: 'Fusion', kit: { ultimate: 'r-fuse' } },
  { id: 'sys.clash', section: 'Systems', label: 'Beam clash', how: 'Hold LMB into the enemy bot on Beam', kit: { active1: lmbId('magic2', 'channel') }, bots: { enemy: 'beam' } },
  { id: 'sys.power', section: 'Systems', label: 'The spendable power meter', how: 'Hit to fill it, then Q', kit: { active2: 'q-cost' } },
  { id: 'sys.charges', section: 'Systems', label: 'Ability charges', how: 'Q, Q, Q: two go, the third waits', kit: { active2: 'q-charges' } },
  { id: 'sys.charge-lmb', section: 'Systems', label: 'Hold to charge on LMB', kit: { active1: lmbId('bow', 'charge') } },
  { id: 'sys.charge-q', section: 'Systems', label: 'Hold to charge on Q', kit: { active2: 'q-wave' } },
  ...TRAVERSAL.map(([id, label]) => ({ id: `trav.${id}`, section: 'Traversal', label: `${label}, both weapons stowed`, kit: { basic: 'v-greatsword', active1: lmbId('bow', 'single') } })),
  { id: 'cross.carry', section: 'Crossings', label: 'A weapon pair the carry solver moves off its first slot (greatsword and bow)', kit: { basic: 'v-greatsword', active1: lmbId('bow', 'single') } },
  { id: 'cross.switch', section: 'Crossings', label: 'R Kit switch mid-combo', how: 'V, V, then R, then V', kit: { ultimate: 'r-switch' } },
  { id: 'cross.aura-form', section: 'Crossings', label: 'F aura during an R form', kit: { passive: 'f-flame', ultimate: 'r-form' } },
  { id: 'cross.counter-charge', section: 'Crossings', label: 'A hold-to-charge cast cancelled by a Counter', how: 'Set the enemy on Fight with a Counter; hold Q into it', kit: { active2: 'q-wave' }, bots: { enemy: 'fight' } },
]

export const SECTIONS = ['V', 'LMB', 'Q', 'E', 'F', 'R', 'Systems', 'Traversal', 'Crossings'] as const

/** One of the lab's weapons (tools/blender/weapons.py), out for `use` in `hand`. */
interface Weapon {
  id: string
  hand?: GearSlot
}

/**
 * A carry kind (GAME.md §4, "Where weapons are carried"): its weapons, and the slots they may wait on in order of
 * preference. A pair, or a bow and its quiver, moves together, so each choice gives every one of its weapons a slot;
 * a pair crossed in one slot names it twice.
 */
interface CarryKind {
  weapons: readonly Weapon[]
  slots: readonly (readonly CarrySlot[])[]
}

const one = (id: string, hand: GearSlot, ...slots: CarrySlot[]): CarryKind => ({ weapons: [{ id, hand }], slots: slots.map((s) => [s]) })

/** A bow's slots against its quiver's, each choice ranked by both together. */
const BOW_AND_QUIVER: readonly (readonly CarrySlot[])[] = (['back_l', 'back_r'] as const)
  .flatMap((bow, i) => (['hip_r', 'lower_back', 'back_flat'] as const).map((quiver, j) => ({ slots: [bow, quiver] as const, rank: i + j })))
  .sort((a, b) => a.rank - b.rank)
  .map((c) => c.slots)

/** John's melee weapon for each V family, by its carry kind; fists and feet carry nothing. */
const MELEE_CARRY: Record<MeleeStyle, CarryKind | undefined> = {
  unarmed: undefined,
  kicks: undefined,
  blade: one('katana', 'hand_r', 'hip_l', 'back_r', 'lower_back'),
  greatsword: one('greatsword', 'hand_r', 'back_r', 'back_l'),
  shield: { weapons: [{ id: 'arming-sword', hand: 'hand_r' }, { id: 'round-shield', hand: 'hand_l' }], slots: [['hip_l', 'back_flat'], ['back_r', 'back_flat']] },
  staff: one('bo-staff', 'hand_r', 'back_r', 'back_l'),
  // a two-handed maul: a long two-hand weapon, not a one-hand smash
  club: one('warhammer', 'hand_r', 'back_r', 'back_l'),
  paired: { weapons: [{ id: 'twin-short-sword', hand: 'hand_r' }, { id: 'twin-short-sword', hand: 'hand_l' }], slots: [['lower_back', 'lower_back'], ['thigh_r', 'thigh_l'], ['hip_r', 'hip_l']] },
  axe: one('scythe', 'hand_r', 'back_r', 'back_l'),
  spear: one('spear', 'hand_r', 'back_r', 'back_l'),
  whip: one('whip', 'hand_r', 'hip_r', 'hip_l', 'lower_back'),
}

/** And its ranged weapon for each LMB family; a body emitter carries nothing. */
const RANGED_CARRY: Record<LmbFamily, CarryKind | undefined> = {
  emitter: undefined,
  thrown: one('kunai', 'hand_r', 'thigh_l', 'hip_r', 'lower_back'),
  pistol: one('pistol', 'hand_r', 'thigh_r', 'hip_r', 'lower_back'),
  paired: { weapons: [{ id: 'pistol', hand: 'hand_r' }, { id: 'pistol', hand: 'hand_l' }], slots: [['thigh_r', 'thigh_l'], ['hip_r', 'hip_l']] },
  rifle: one('assault-rifle', 'hand_r', 'back_l', 'back_r'),
  heavy: one('rocket-launcher', 'hand_r', 'back_flat', 'hip_r'),
  bow: { weapons: [{ id: 'recurve-bow', hand: 'hand_l' }, { id: 'quiver' }], slots: BOW_AND_QUIVER },
  magic1: one('wand', 'hand_r', 'thigh_l', 'hip_r', 'lower_back'),
  magic2: one('mage-staff', 'hand_r', 'back_l', 'back_r'),
}

/**
 * Where a melee kind and a ranged kind wait together: the choices with the lowest total rank that use no slot twice
 * between them (GAME.md §4). Undefined for a kind that carries nothing.
 */
export function carrySlots(melee: CarryKind | undefined, ranged: CarryKind | undefined): { melee?: readonly CarrySlot[]; ranged?: readonly CarrySlot[] } {
  const ms = melee?.slots ?? [[]]
  const rs = ranged?.slots ?? [[]]
  let best: { melee: readonly CarrySlot[]; ranged: readonly CarrySlot[]; rank: number } | undefined
  ms.forEach((m, i) =>
    rs.forEach((r, j) => {
      if (m.some((s) => r.includes(s)) || (best && best.rank <= i + j)) return
      best = { melee: m, ranged: r, rank: i + j }
    }),
  )
  if (!best) throw new Error('no carry without a clash')
  return { ...(melee ? { melee: best.melee } : {}), ...(ranged ? { ranged: best.ranged } : {}) }
}

const armsOf = (kind: CarryKind | undefined, slots: readonly CarrySlot[] | undefined, use: ArmPiece['use']): ArmPiece[] =>
  kind && slots ? kind.weapons.map((w, k) => ({ piece: { id: w.id, url: `/kit/weapons/${w.id}.glb` }, use, ...(w.hand ? { hand: w.hand } : {}), stow: slots[k] })) : []

/** Every weapon John carries with this V family and LMB family, each on the slot the carry rule gives it. */
export function labArms(style: MeleeStyle, family: LmbFamily): readonly ArmPiece[] {
  const melee = MELEE_CARRY[style]
  const ranged = RANGED_CARRY[family]
  const slots = carrySlots(melee, ranged)
  return [...armsOf(melee, slots.melee, 'melee'), ...armsOf(ranged, slots.ranged, 'ranged')]
}

/** Every V family's carry kind against every LMB family's: the pairings the carry rule must place without a clash. */
export const CARRY_PAIRS = Object.entries(MELEE_CARRY).flatMap(([style, melee]) => Object.entries(RANGED_CARRY).map(([family, ranged]) => ({ style: style as MeleeStyle, family: family as LmbFamily, melee, ranged })))
