import { describe, expect, it } from 'vitest'
import { BUDGET_TOLERANCE, scoreTemplate, targetBudget, validateTemplate } from '../budget'
import { ROLE_IDS } from '../roles'
import type { SlotKind } from '../types'
import { CATALOG, defaultTemplate, getTemplate, poolFor } from './catalog'

const SLOT_KINDS: SlotKind[] = ['basic', 'active', 'passive', 'ultimate', 'movement']

/** A mechanic is its slot, delivery and effects; the ID and name do not count. */
const signature = (t: (typeof CATALOG)[number]) => JSON.stringify({ slot: t.slot, delivery: t.delivery, effects: t.effects, cooldown: t.cooldown, trigger: t.trigger })

describe('template catalogue', () => {
  it('holds at least 100 distinct mechanics', () => {
    expect(new Set(CATALOG.map(signature)).size).toBeGreaterThanOrEqual(100)
  })

  it('no two templates share identical effect parameters', () => {
    const seen = new Map<string, string>()
    for (const t of CATALOG) {
      const sig = signature(t)
      expect(seen.get(sig), `${t.id} duplicates ${seen.get(sig)}`).toBeUndefined()
      seen.set(sig, t.id)
    }
  })

  it('every role has at least 3 options in every slot', () => {
    for (const role of ROLE_IDS) {
      for (const slot of SLOT_KINDS) {
        expect(poolFor(role, slot).length, `${role} ${slot}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('every role has at least 6 actives, so a build can hold two different ones with alternatives', () => {
    for (const role of ROLE_IDS) expect(poolFor(role, 'active').length).toBeGreaterThanOrEqual(6)
  })

  it('every template passes schema validation and sits on its slot budget', () => {
    for (const t of CATALOG) {
      expect(validateTemplate(t), t.id).toEqual({ ok: true })
      const budget = targetBudget(t)
      expect(Math.abs(scoreTemplate(t) - budget) / budget, t.id).toBeLessThanOrEqual(BUDGET_TOLERANCE)
    }
  })

  it('IDs are unique and resolvable', () => {
    expect(new Set(CATALOG.map((t) => t.id)).size).toBe(CATALOG.length)
    for (const t of CATALOG) expect(getTemplate(t.id)).toBe(t)
    expect(() => getTemplate('nope')).toThrow()
  })

  it('movement templates add to the shared baseline: none removes dash or jump', () => {
    for (const t of CATALOG.filter((x) => x.slot === 'movement')) {
      expect(t.effects.some((e) => e.kind === 'mobility' || (e.kind === 'buff' && e.stat === 'moveSpeed'))).toBe(true)
    }
  })

  it('defaults come from the role itself', () => {
    for (const role of ROLE_IDS) {
      for (const slot of SLOT_KINDS) expect(defaultTemplate(role, slot).roles).toContain(role)
    }
  })
})
