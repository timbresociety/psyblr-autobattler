import { normalizeTemplate, validateTemplate } from '../budget.js'
import type { Effect, RoleId, SlotKind, Template } from '../types.js'
import { ASSASSIN } from './assassin.js'
import { CONTROLLER } from './controller.js'
import { FIGHTER } from './fighter.js'
import { MAGE } from './mage.js'
import { MARKSMAN } from './marksman.js'
import { SHARED } from './shared.js'
import { FORMS, SPELLS } from './spells.js'
import { RETIRED_TO_STYLE, STYLE_TEMPLATES } from './styles.js'
import { SUMMONER } from './summoner.js'
import { SUPPORT } from './support.js'
import { TANK } from './tank.js'

const SHOT_KINDS = new Set<Template['delivery']['kind']>(['projectile', 'beam', 'cone'])
const MOVE_KINDS = new Set<Template['delivery']['kind']>(['dash', 'blink', 'grapple', 'leap'])
/** A passive whose effects ride the hero's own blows may put them on what it hits (a bleed on hit, §4: riders become passives). */
const RIDER_TRIGGERS = new Set(['onHit', 'everyThirdHit'])

/** Bump when template or role numbers change, so stored gate results can be re-checked. */
export const CATALOG_VERSION = 13

export const RAW_TEMPLATES: readonly Template[] = [...STYLE_TEMPLATES, ...TANK, ...FIGHTER, ...ASSASSIN, ...MAGE, ...MARKSMAN, ...SUPPORT, ...CONTROLLER, ...SUMMONER, ...SHARED, ...SPELLS, ...FORMS]

export function getTemplate(id: string): Template {
  const template = BY_ID.get(id)
  if (!template) throw new Error(`Unknown template: ${id}`)
  return template
}

export function hasTemplate(id: string): boolean {
  return BY_ID.has(id)
}

const POOLS = new Map<string, Template[]>()

/** A template that only does things to its caster: nothing in it reaches an ally, an enemy or the ground (§4: F's, not Q's). */
export const isSelfBuff = (t: Template) => !t.effects.some(reachesOthers)

/** Whether an effect lands on anyone but the hero itself: an ally, or an enemy, or the ground others stand on. */
export function reachesOthers(e: Effect): boolean {
  switch (e.kind) {
    case 'mobility':
    case 'resize':
    case 'form':
    case 'refresh':
    case 'execute':
      return false
    case 'buff':
    case 'heal':
    case 'shield':
    case 'state':
      return e.target !== 'self'
    default:
      return true
  }
}

/**
 * The row's typing rule (GAME.md §4) a template breaks, or undefined when it fits: melee holds only a weapon style;
 * ranged only what fires from the hand or a weapon, on repeat; Q nothing melee and nothing self-only; F nothing that
 * reaches anyone else (a rider on the hero's own hits rides its blow); E only what moves the caster; no ultimate moves
 * its caster either (that's E's).
 */
export function typingError(t: Template): string | undefined {
  const moves = t.effects.some((e) => e.kind === 'mobility')
  switch (t.slot) {
    case 'melee':
      return !t.style ? 'no weapon style' : t.delivery.kind !== 'melee' ? 'not a swing' : t.cooldown !== 0 ? 'a cooldown' : undefined
    case 'ranged':
      return !t.ranged ? 'no weapon' : !SHOT_KINDS.has(t.delivery.kind) ? 'does not fire' : t.cooldown !== 0 ? 'a cooldown instead of a fire rate' : moves ? 'moves the caster' : undefined
    case 'spell':
      if (!t.family) return 'no family'
      if (t.delivery.kind === 'melee') return 'melee'
      if (isSelfBuff(t)) return 'self-only'
      return moves ? 'moves the caster' : undefined
    case 'passive': {
      const riders = RIDER_TRIGGERS.has(t.trigger ?? 'always')
      if (t.effects.some((e) => reachesOthers(e) && (!riders || ((e.kind === 'buff' || e.kind === 'heal' || e.kind === 'shield' || e.kind === 'state') && e.target !== 'self')))) return 'reaches others'
      return moves ? 'moves the caster' : !t.energy ? 'no energy meter' : undefined
    }
    case 'movement':
      if (!moves || !MOVE_KINDS.has(t.delivery.kind)) return 'does not move the caster'
      return t.effects.some(reachesOthers) ? 'reaches others' : undefined
    case 'ultimate':
      return moves ? 'moves the caster' : undefined
  }
}

/** Whether a template may fill a slot of `slot` kind: it's of that row and keeps the row's typing rule. */
export const fitsSlot = (t: Template, slot: SlotKind) => t.slot === slot && !typingError(t)

function build(): Template[] {
  return RAW_TEMPLATES.map((raw) => {
    const check = validateTemplate(raw)
    if (!check.ok) throw new Error(`Invalid template ${raw.id}: ${check.errors.map((e) => e.field).join(', ')}`)
    // the typing rules hold for the catalogue itself, so no slot can be handed a wrong item (§4)
    const wrong = typingError(raw)
    if (wrong) throw new Error(`Template ${raw.id} breaks the ${raw.slot} row's typing rule: ${wrong}`)
    return normalizeTemplate(raw)
  })
}

/** Every template, numbers normalized to its slot budget. Builds reference these by ID (KTD2). */
export const CATALOG: readonly Template[] = build()

const BY_ID = new Map(CATALOG.map((t) => [t.id, t]))

/**
 * A role's options for one slot kind, the role's own templates first (those named after it), then the ones it shares
 * in catalogue order. Computed once per pair; the catalogue never changes.
 */
export function poolFor(role: RoleId, slot: SlotKind): Template[] {
  const key = `${role}|${slot}`
  let pool = POOLS.get(key)
  if (!pool) {
    const all = CATALOG.filter((t) => fitsSlot(t, slot) && t.roles.includes(role))
    const own = (t: Template) => t.id.startsWith(`${role}-`)
    POOLS.set(key, (pool = [...all.filter(own), ...all.filter((t) => !own(t))]))
  }
  return pool
}

/**
 * Templates taken out of a slot, and what a stored build gets instead. The skill library moved every dash, blink and
 * leap into the movement slot; §4 turned the eleven strikes in Q into spells and retired the melee basics into styles.
 */
const RETIRED: Record<string, string> = {
  'fighter-gap-rush': 'fighter-force-palm',
  'assassin-shadow-step': 'assassin-expose',
  'assassin-phantom-rush': 'assassin-night-fall',
  'mage-recall-step': 'mage-chrono-rewind',
  'tank-bull-charge': 'tank-body-slam',
  'fighter-haymaker': 'fighter-force-palm',
  'fighter-rising-uppercut': 'fighter-updraft',
  'assassin-backstab': 'assassin-shadow-lunge',
  'assassin-venom-blade': 'assassin-venom-dart',
  'assassin-nerve-strike': 'assassin-paralysis-needle',
  'assassin-silencing-strike': 'assassin-hush-sigil',
  'assassin-expose-weakness': 'assassin-expose',
  'fighter-crippling-blow': 'fighter-crippling-hex',
  'fighter-disarming-strike': 'fighter-disarm-lash',
  'fighter-rending-strike': 'fighter-rend',
  'tank-sunder': 'tank-ground-sunder',
  ...Object.fromEntries(Object.entries(RETIRED_TO_STYLE).map(([id, style]) => [id, `melee-${style}`])),
}

/** What a stored build's slot should hold now: the template itself, its successor, or undefined when it never existed. */
export function currentTemplate(id: string, role: RoleId, slot: SlotKind): string | undefined {
  const pool = poolFor(role, slot)
  if (pool.some((t) => t.id === id)) return id
  const next = RETIRED[id]
  if (next && pool.some((t) => t.id === next)) return next
  // one of the role's that moved to another row (a self-buff to F, a ranged basic to LMB) gives way to the slot's first choice
  return BY_ID.get(id)?.roles.includes(role) || next ? defaultTemplate(role, slot).id : undefined
}

/** The template the engine proposes when a description gives no signal. */
export function defaultTemplate(role: RoleId, slot: SlotKind): Template {
  const pool = poolFor(role, slot)
  if (!pool.length) throw new Error(`Role ${role} has no ${slot} templates`)
  return pool[0]
}
