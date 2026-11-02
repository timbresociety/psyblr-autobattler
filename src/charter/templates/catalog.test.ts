import { describe, expect, it } from 'vitest'
import { BUDGET_TOLERANCE, scoreTemplate, targetBudget, uptime, validateTemplate } from '../budget.js'
import { FAMILIES, SPELL_FAMILIES, SPELL_SHAPES, familiesOf, shapeOf } from '../families.js'
import { ROLE_IDS } from '../roles.js'
import type { ControlType, DebuffType, Effect, MeleeStyle, RangedStyle, SlotKind, StateType, Template } from '../types.js'
import { CATALOG, currentTemplate, defaultTemplate, fitsSlot, getTemplate, poolFor, typingError } from './catalog.js'
import { MELEE_STYLES } from './styles.js'

const SLOT_KINDS: SlotKind[] = ['melee', 'ranged', 'spell', 'passive', 'ultimate', 'movement']

/** A mechanic is its slot, delivery and effects; the ID and name do not count. */
const signature = (t: Template) => JSON.stringify({ slot: t.slot, delivery: t.delivery, effects: t.effects, cooldown: t.cooldown, trigger: t.trigger, style: t.style, ranged: t.ranged, energy: t.energy })
const kinds = (t: Template) => t.effects.map((e) => e.kind)
const of = (slot: SlotKind) => CATALOG.filter((t) => t.slot === slot)

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

  it('every role has room to choose in every row: all seven melee styles, five ranged weapons, and seven or more of the rest', () => {
    for (const role of ROLE_IDS) {
      for (const slot of SLOT_KINDS) {
        const need = slot === 'melee' ? 7 : slot === 'ranged' ? 5 : slot === 'spell' ? 11 : 7
        expect(poolFor(role, slot).length, `${role} ${slot}`).toBeGreaterThanOrEqual(need)
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

  it('defaults come from the role itself', () => {
    for (const role of ROLE_IDS) {
      for (const slot of SLOT_KINDS) expect(defaultTemplate(role, slot).roles).toContain(role)
    }
  })
})

describe('the kit rows and their typing rules (GAME.md §4)', () => {
  const base: Template = { id: 'x', name: 'X', slot: 'spell', roles: ['fighter'], tags: ['x'], delivery: { kind: 'projectile', range: 10, speed: 30, projectileRadius: 0.3 }, effects: [{ kind: 'damage', amount: 10, ratio: 0.5, scaling: 'spiritPower', type: 'spirit' }], cooldown: 8, ai: { use: 'poke', priority: 1 }, family: 'burst' }

  it('every template in the catalogue keeps its row\'s rule, so none can be stored in a wrong slot', () => {
    for (const t of CATALOG) expect(typingError(t), t.id).toBeUndefined()
    for (const slot of SLOT_KINDS) for (const role of ROLE_IDS) for (const t of poolFor(role, slot)) expect(t.slot).toBe(slot)
  })

  it('melee holds only a weapon style: one per style, a swing with the style\'s reach and arc, open to every role', () => {
    const styles = of('melee')
    expect(styles.map((t) => t.style).sort()).toEqual((Object.keys(MELEE_STYLES) as MeleeStyle[]).sort())
    for (const t of styles) {
      expect(t.delivery).toMatchObject({ kind: 'melee', range: MELEE_STYLES[t.style!].reach, arcDegrees: MELEE_STYLES[t.style!].arc })
      expect(t.effects.every((e) => e.kind === 'damage' && e.scaling === 'weaponDamage'), t.id).toBe(true)
      expect(t.roles.length).toBe(8)
    }
    expect(typingError({ ...base, slot: 'melee', cooldown: 0, delivery: { kind: 'melee', range: 2.5, arcDegrees: 90 } })).toBe('no weapon style')
    expect(typingError({ ...base, slot: 'melee', cooldown: 0, style: 'blade' })).toBe('not a swing')
  })

  it('ranged holds only what fires from the hand or a weapon on repeat: a weapon, a shot, no cooldown, no move', () => {
    const styles = new Set<RangedStyle>(of('ranged').map((t) => t.ranged!.style))
    expect([...styles].sort()).toEqual(['magic', 'pistol', 'rifle', 'thrown'])
    expect(of('ranged').some((t) => t.ranged!.mode === 'pellets')).toBe(true)
    for (const t of of('ranged')) expect(t.ranged!.rate * t.ranged!.magazine * t.ranged!.reload, t.id).toBeGreaterThan(0)
    const gun = { ...base, slot: 'ranged' as const, cooldown: 0, ranged: { style: 'pistol' as const, mode: 'single' as const, rate: 2, magazine: 10, reload: 1.5 } }
    expect(typingError(gun)).toBeUndefined()
    expect(typingError({ ...gun, ranged: undefined })).toBe('no weapon')
    expect(typingError({ ...gun, cooldown: 6 })).toBe('a cooldown instead of a fire rate')
    expect(typingError({ ...gun, delivery: { kind: 'zone', range: 10, radius: 3 } })).toBe('does not fire')
    // Ki Blast and Energy Wave are ranged now, and the chain hook is a spell (§13)
    expect(getTemplate('shared-ki-blast').slot).toBe('ranged')
    expect(getTemplate('shared-energy-wave').slot).toBe('ranged')
    expect(getTemplate('tank-chain-hook').slot).toBe('spell')
  })

  it('Q holds nothing melee and nothing self-only, and every spell has one family and one shape', () => {
    expect(typingError(base)).toBeUndefined()
    expect(typingError({ ...base, delivery: { kind: 'melee', range: 3, arcDegrees: 90 } })).toBe('melee')
    expect(typingError({ ...base, delivery: { kind: 'self', range: 0 }, effects: [{ kind: 'buff', stat: 'damage', pct: 20, duration: 4, target: 'self' }] })).toBe('self-only')
    expect(typingError({ ...base, family: undefined })).toBe('no family')
    for (const t of of('spell')) {
      expect(SPELL_FAMILIES, t.id).toContain(t.family)
      expect(SPELL_SHAPES, t.id).toContain(shapeOf(t))
    }
  })

  it('the spell universe fills all ten families with at least four spells each', () => {
    for (const f of SPELL_FAMILIES) expect(of('spell').filter((t) => t.family === f).length, f).toBeGreaterThanOrEqual(4)
  })

  it('the eleven strikes that were in Q are spells now, none of them melee', () => {
    const now = ['fighter-force-palm', 'fighter-updraft', 'assassin-shadow-lunge', 'assassin-venom-dart', 'assassin-paralysis-needle', 'assassin-hush-sigil', 'assassin-expose', 'fighter-crippling-hex', 'fighter-disarm-lash', 'fighter-rend', 'tank-ground-sunder']
    for (const id of now) {
      expect(getTemplate(id).slot, id).toBe('spell')
      expect(getTemplate(id).delivery.kind, id).not.toBe('melee')
    }
  })

  it('F holds nothing that reaches anyone else (a rider on the hero\'s own hits rides its blow), and every passive has a meter', () => {
    const toggle = { ...base, slot: 'passive' as const, cooldown: 0, delivery: { kind: 'self' as const, range: 0 }, trigger: 'always' as const, energy: { seconds: 10, refill: 10 }, family: undefined }
    expect(typingError({ ...toggle, effects: [{ kind: 'buff', stat: 'damage', pct: 10, duration: 1, target: 'self' }] })).toBeUndefined()
    expect(typingError({ ...toggle, effects: [{ kind: 'buff', stat: 'damage', pct: 10, duration: 1, target: 'allies' }] })).toBe('reaches others')
    expect(typingError({ ...toggle, effects: [{ kind: 'stun', duration: 1 }] })).toBe('reaches others')
    expect(typingError({ ...toggle, trigger: 'onHit', effects: [{ kind: 'slow', pct: 20, duration: 1 }] })).toBeUndefined()
    expect(typingError({ ...toggle, energy: undefined, effects: [{ kind: 'buff', stat: 'damage', pct: 10, duration: 1, target: 'self' }] })).toBe('no energy meter')
    for (const t of of('passive')) expect(uptime(t), t.id).toBeLessThan(1)
  })

  it('the self-only actives moved to F, on meters that refill over their old cooldowns', () => {
    const moved = ['fighter-berserk', 'fighter-blood-rage', 'fighter-counter-stance', 'fighter-second-wind', 'fighter-unstoppable-fury', 'assassin-evasive-dance', 'assassin-shadow-realm', 'assassin-vanish', 'mage-arcane-surge', 'mage-mana-shield', 'mage-chrono-rewind', 'marksman-overdrive', 'marksman-rapid-reload', 'summoner-overclock', 'tank-iron-skin', 'tank-shield-wall', 'tank-unbreakable-will']
    for (const id of moved) {
      const t = getTemplate(id)
      expect(t.slot, id).toBe('passive')
      expect(t.energy?.refill, id).toBeGreaterThanOrEqual(6)
    }
  })

  it('transformations are passives too: forms and resizes, switched on with F', () => {
    const forms = of('passive').filter((t) => t.effects.some((e) => e.kind === 'resize' || e.kind === 'form'))
    expect(forms.length).toBeGreaterThanOrEqual(4)
    expect(forms.some((t) => t.effects.some((e) => e.kind === 'resize' && (e.sizeClass === 'small' || e.sizeClass === 'tiny')))).toBe(true)
    expect(forms.some((t) => t.effects.some((e) => e.kind === 'resize' && e.sizeClass === 'huge'))).toBe(true)
  })

  it('E holds only things that move the caster, and nothing it carries reaches anyone else', () => {
    const dash = { ...base, slot: 'movement' as const, delivery: { kind: 'dash' as const, range: 6 }, effects: [{ kind: 'mobility' as const, distance: 6 }], family: undefined }
    expect(typingError(dash)).toBeUndefined()
    expect(typingError({ ...dash, effects: [{ kind: 'buff', stat: 'moveSpeed', pct: 40, duration: 3, target: 'self' }] })).toBe('does not move the caster')
    expect(typingError({ ...dash, effects: [{ kind: 'mobility', distance: 6 }, { kind: 'slow', pct: 20, duration: 1 }] })).toBe('reaches others')
    for (const t of of('movement')) expect(['dash', 'blink', 'grapple', 'leap']).toContain(t.delivery.kind)
  })

  it('no ultimate, spell, weapon or passive moves its caster: that is the movement row\'s', () => {
    for (const t of CATALOG.filter((x) => x.slot !== 'movement')) expect(kinds(t), t.id).not.toContain('mobility')
  })

  it('fitsSlot is the row and its rule together', () => {
    expect(fitsSlot(getTemplate('melee-blade'), 'melee')).toBe(true)
    expect(fitsSlot(getTemplate('melee-blade'), 'spell')).toBe(false)
  })
})

describe('the skill library', () => {
  it('every effect family is in the catalogue, and every role reaches at least seven of the ten', () => {
    const used = new Set(CATALOG.flatMap(familiesOf))
    for (const f of FAMILIES) expect(used.has(f), f).toBe(true)
    for (const role of ROLE_IDS) {
      const reach = new Set(CATALOG.filter((t) => t.roles.includes(role)).flatMap(familiesOf))
      expect(reach.size, role).toBeGreaterThanOrEqual(7)
    }
  })

  it('every kind of control, debuff and state the engine knows is used by at least one template', () => {
    const control: ControlType[] = ['root', 'silence', 'disarm', 'sleep', 'blind', 'grounded', 'fear', 'taunt', 'break']
    const debuffs: DebuffType[] = ['armorShred', 'spiritShred', 'vulnerable', 'wound', 'mark']
    const states: StateType[] = ['unstoppable', 'stealth', 'invulnerable', 'cleanse', 'reflect']
    const count = (match: (e: Effect) => boolean) => CATALOG.filter((t) => t.effects.some(match)).length
    for (const c of control) expect(count((e) => e.kind === 'control' && e.type === c), c).toBeGreaterThanOrEqual(1)
    for (const d of debuffs) expect(count((e) => e.kind === 'debuff' && e.type === d), d).toBeGreaterThanOrEqual(1)
    for (const s of states) expect(count((e) => e.kind === 'state' && e.type === s), s).toBeGreaterThanOrEqual(1)
    for (const k of ['stun', 'knockup', 'pull', 'displace', 'refresh', 'field', 'trap', 'wall', 'turret', 'resize', 'reveal', 'swapHealth', 'steal', 'rewind'] as const) expect(count((e) => e.kind === k), k).toBeGreaterThanOrEqual(1)
  })

  it('a stored build holding a retired template gets its successor, in the same row and role pool', () => {
    expect(currentTemplate('fighter-gap-rush', 'fighter', 'spell')).toBe('fighter-force-palm')
    expect(currentTemplate('fighter-haymaker', 'fighter', 'spell')).toBe('fighter-force-palm')
    expect(currentTemplate('tank-sunder', 'tank', 'spell')).toBe('tank-ground-sunder')
    // a melee basic retired into its weapon style
    expect(currentTemplate('assassin-iaido', 'assassin', 'melee')).toBe('melee-blade')
    expect(currentTemplate('fighter-war-hammer', 'fighter', 'melee')).toBe('melee-club')
    // a self-buff moved to F: the spell slot it sat in takes the row's first choice
    expect(currentTemplate('fighter-berserk', 'fighter', 'spell')).toBe(defaultTemplate('fighter', 'spell').id)
    expect(currentTemplate('fighter-berserk', 'fighter', 'passive')).toBe('fighter-berserk')
    expect(currentTemplate('made-up', 'tank', 'spell')).toBeUndefined()
  })
})
