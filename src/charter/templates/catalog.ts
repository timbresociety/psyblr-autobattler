import { normalizeTemplate, validateTemplate } from '../budget'
import type { RoleId, SlotKind, Template } from '../types'
import { ASSASSIN } from './assassin'
import { CONTROLLER } from './controller'
import { FIGHTER } from './fighter'
import { MAGE } from './mage'
import { MARKSMAN } from './marksman'
import { SHARED } from './shared'
import { SUMMONER } from './summoner'
import { SUPPORT } from './support'
import { TANK } from './tank'

/** Bump when template or role numbers change, so stored gate results can be re-checked. */
export const CATALOG_VERSION = 8

export const RAW_TEMPLATES: readonly Template[] = [...TANK, ...FIGHTER, ...ASSASSIN, ...MAGE, ...MARKSMAN, ...SUPPORT, ...CONTROLLER, ...SUMMONER, ...SHARED]

function build(): Template[] {
  return RAW_TEMPLATES.map((raw) => {
    const check = validateTemplate(raw)
    if (!check.ok) throw new Error(`Invalid template ${raw.id}: ${check.errors.map((e) => e.field).join(', ')}`)
    return normalizeTemplate(raw)
  })
}

/** Every template, numbers normalized to its slot budget. Builds reference these by ID (KTD2). */
export const CATALOG: readonly Template[] = build()

const BY_ID = new Map(CATALOG.map((t) => [t.id, t]))

export function getTemplate(id: string): Template {
  const template = BY_ID.get(id)
  if (!template) throw new Error(`Unknown template: ${id}`)
  return template
}

export function hasTemplate(id: string): boolean {
  return BY_ID.has(id)
}

const POOLS = new Map<string, Template[]>()

/**
 * A role's options for one slot kind, the role's own templates first (those named after it), then the ones it shares
 * in catalogue order. Computed once per pair; the catalogue never changes.
 */
export function poolFor(role: RoleId, slot: SlotKind): Template[] {
  const key = `${role}|${slot}`
  let pool = POOLS.get(key)
  if (!pool) {
    const all = CATALOG.filter((t) => t.slot === slot && t.roles.includes(role))
    const own = (t: Template) => t.id.startsWith(`${role}-`)
    POOLS.set(key, (pool = [...all.filter(own), ...all.filter((t) => !own(t))]))
  }
  return pool
}

/**
 * Templates taken out of a slot, and what a stored build gets instead. The skill library moved every dash, blink and
 * leap into the movement slot, so the old actives and ultimates that moved their caster are gone from those slots.
 */
const RETIRED: Record<string, string> = {
  'fighter-gap-rush': 'fighter-haymaker',
  'assassin-shadow-step': 'assassin-expose-weakness',
  'assassin-phantom-rush': 'assassin-night-fall',
  'mage-recall-step': 'mage-chrono-rewind',
  'tank-bull-charge': 'tank-body-slam',
}

/** What a stored build's slot should hold now: the template itself, its successor, or undefined when it never existed. */
export function currentTemplate(id: string, role: RoleId, slot: SlotKind): string | undefined {
  const pool = poolFor(role, slot)
  if (pool.some((t) => t.id === id)) return id
  const next = RETIRED[id]
  if (!next) return undefined
  return pool.some((t) => t.id === next) ? next : defaultTemplate(role, slot).id
}

/** The template the engine proposes when a description gives no signal. */
export function defaultTemplate(role: RoleId, slot: SlotKind): Template {
  const pool = poolFor(role, slot)
  if (!pool.length) throw new Error(`Role ${role} has no ${slot} templates`)
  return pool[0]
}
