import { describe, expect, it } from 'vitest'
import { BUDGET_TOLERANCE, scoreTemplate, targetBudget, validateTemplate } from '../budget'
import { FAMILIES, familiesOf } from '../families'
import { ROLE_IDS } from '../roles'
import type { ControlType, DebuffType, Effect, RoleId, SlotKind, StateType } from '../types'
import { CATALOG, currentTemplate, defaultTemplate, getTemplate, poolFor } from './catalog'

const SLOT_KINDS: SlotKind[] = ['basic', 'active', 'passive', 'ultimate', 'movement']

/** A mechanic is its slot, delivery and effects; the ID and name do not count. */
const signature = (t: (typeof CATALOG)[number]) => JSON.stringify({ slot: t.slot, delivery: t.delivery, effects: t.effects, cooldown: t.cooldown, trigger: t.trigger })

describe('template catalogue', () => {
  it('holds at least 250 distinct mechanics', () => {
    expect(new Set(CATALOG.map(signature)).size).toBeGreaterThanOrEqual(250)
  })

  it('no two templates share identical effect parameters', () => {
    const seen = new Map<string, string>()
    for (const t of CATALOG) {
      const sig = signature(t)
      expect(seen.get(sig), `${t.id} duplicates ${seen.get(sig)}`).toBeUndefined()
      seen.set(sig, t.id)
    }
  })

  it('every role has room to choose in every slot: 7 options or more, and 14 actives for the two active slots', () => {
    for (const role of ROLE_IDS) {
      for (const slot of SLOT_KINDS) {
        expect(poolFor(role, slot).length, `${role} ${slot}`).toBeGreaterThanOrEqual(slot === 'active' ? 14 : 7)
      }
    }
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

const MOVES_CASTER = ['dash', 'blink', 'grapple', 'leap']
const kinds = (t: (typeof CATALOG)[number]) => t.effects.map((e) => e.kind)

describe('the skill library (docs/charter/skill-library.html)', () => {
  it('only the movement slot moves its caster: no dash, blink, leap or grapple hides in an active, ultimate, basic or passive', () => {
    for (const t of CATALOG.filter((x) => x.slot !== 'movement')) {
      expect(kinds(t), t.id).not.toContain('mobility')
      expect(MOVES_CASTER, t.id).not.toContain(t.delivery.kind)
    }
  })

  it('basic attacks always deal damage and never carry hard control', () => {
    const hard = (e: Effect) => e.kind === 'stun' || e.kind === 'knockup' || (e.kind === 'control' && e.type !== 'grounded')
    for (const t of CATALOG.filter((x) => x.slot === 'basic')) {
      expect(kinds(t), t.id).toContain('damage')
      expect(t.effects.some(hard), t.id).toBe(false)
    }
  })

  it('every effect family is in the catalogue, and every role reaches at least seven of the ten', () => {
    const used = new Set(CATALOG.flatMap(familiesOf))
    for (const f of FAMILIES) expect(used.has(f), f).toBe(true)
    for (const role of ROLE_IDS) {
      const reach = new Set(CATALOG.filter((t) => t.roles.includes(role)).flatMap(familiesOf))
      expect(reach.size, role).toBeGreaterThanOrEqual(7)
    }
  })

  it('every kind of control, debuff and state the engine knows is used by at least two templates', () => {
    const control: ControlType[] = ['root', 'silence', 'disarm', 'sleep', 'blind', 'grounded', 'fear', 'taunt', 'break']
    const debuffs: DebuffType[] = ['armorShred', 'spiritShred', 'vulnerable', 'wound', 'mark']
    const states: StateType[] = ['unstoppable', 'stealth', 'invulnerable', 'cleanse']
    const count = (match: (e: Effect) => boolean) => CATALOG.filter((t) => t.effects.some(match)).length
    for (const c of control) expect(count((e) => e.kind === 'control' && e.type === c), c).toBeGreaterThanOrEqual(2)
    for (const d of debuffs) expect(count((e) => e.kind === 'debuff' && e.type === d), d).toBeGreaterThanOrEqual(2)
    for (const s of states) expect(count((e) => e.kind === 'state' && e.type === s), s).toBeGreaterThanOrEqual(2)
    for (const k of ['stun', 'knockup', 'pull', 'displace', 'refresh', 'field', 'trap', 'wall', 'turret', 'resize'] as const) expect(count((e) => e.kind === k), k).toBeGreaterThanOrEqual(2)
  })

  it('each role owns its signature: control for controllers, constructs for summoners, protection for supports', () => {
    const owns = (role: RoleId, test: (t: (typeof CATALOG)[number]) => boolean) => CATALOG.filter((t) => t.roles.includes(role) && t.slot !== 'basic' && test(t)).length
    expect(owns('controller', (t) => familiesOf(t).includes('control'))).toBeGreaterThanOrEqual(20)
    expect(owns('summoner', (t) => familiesOf(t).includes('construct'))).toBeGreaterThanOrEqual(15)
    expect(owns('support', (t) => familiesOf(t).includes('protect'))).toBeGreaterThanOrEqual(15)
  })

  it('a stored build holding a retired template gets its successor, in the same slot and role pool', () => {
    expect(currentTemplate('fighter-gap-rush', 'fighter', 'active')).toBe('fighter-haymaker')
    expect(currentTemplate('mage-recall-step', 'support', 'active')).toBe('mage-chrono-rewind')
    expect(currentTemplate('assassin-shadow-step', 'assassin', 'active')).toBe('assassin-expose-weakness')
    expect(currentTemplate('assassin-shadow-step', 'assassin', 'movement')).toBe('assassin-shadow-step')
    expect(currentTemplate('made-up', 'tank', 'active')).toBeUndefined()
  })
})
