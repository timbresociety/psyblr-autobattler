import { normalizeTemplate, validateTemplate } from '../budget'
import type { RoleId, SlotKind, Template } from '../types'
import { ASSASSIN } from './assassin'
import { FIGHTER } from './fighter'
import { MAGE } from './mage'
import { MARKSMAN } from './marksman'
import { SHARED } from './shared'
import { SUPPORT } from './support'
import { TANK } from './tank'

/** Bump when template numbers change, so stored gate results can be re-checked. */
export const CATALOG_VERSION = 1

export const RAW_TEMPLATES: readonly Template[] = [...TANK, ...FIGHTER, ...ASSASSIN, ...MAGE, ...MARKSMAN, ...SUPPORT, ...SHARED]

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

/** A role's options for one slot kind, the role's own templates first. */
export function poolFor(role: RoleId, slot: SlotKind): Template[] {
  return CATALOG.filter((t) => t.slot === slot && t.roles.includes(role))
}

/** The template the engine proposes when a description gives no signal. */
export function defaultTemplate(role: RoleId, slot: SlotKind): Template {
  const pool = poolFor(role, slot)
  if (!pool.length) throw new Error(`Role ${role} has no ${slot} templates`)
  return pool[0]
}
