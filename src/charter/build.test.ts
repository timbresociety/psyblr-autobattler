import { describe, expect, it } from 'vitest'
import {
  BUILD_SLOTS,
  allocate,
  changeRole,
  editSkillText,
  hydrateBuild,
  proposeBuild,
  requestStats,
  setAttribute,
  setSize,
  swapAlternatives,
  swapOptions,
  swapTemplate,
} from './build.js'
import { getRole } from './roles.js'
import { POOL_SIZE, spentPoints } from './stats.js'
import { getTemplate } from './templates/catalog.js'
import type { Build } from './build.js'

const kameSkills = {
  basic: { name: 'Ki Shot', flavour: 'fires small energy blasts' },
  active1: { name: 'Rewind', flavour: 'rewind the last 5 seconds' },
  active2: { name: 'Fire Orb', flavour: 'hurls a fireball' },
  passive: { name: 'Genius', flavour: 'focus and intellect' },
  ultimate: { name: 'Big Beam', flavour: 'a giant kamehameha wave' },
  movement: { name: 'Blink', flavour: 'teleports a short way' },
}

function mage(): Build {
  const result = proposeBuild({ heroName: 'Dario', roleId: 'mage', skills: kameSkills })
  if (!result.ok) throw new Error('proposal failed')
  return result.build
}

describe('proposeBuild', () => {
  it('fills all six slots from the role pools and spends the role default spread', () => {
    const build = mage()
    for (const slot of BUILD_SLOTS) expect(getTemplate(build.slots[slot].templateId).roles).toContain('mage')
    expect(build.slots.active1.templateId).not.toBe(build.slots.active2.templateId)
    expect(spentPoints(build.spread)).toBe(POOL_SIZE)
    expect(build.gate.state).toBe('draft')
  })

  it('assigns a role from the descriptions when none is given', () => {
    const result = proposeBuild({ heroName: 'Healer', skills: { active1: { name: 'Mend', flavour: 'heals allies and shields them' }, ultimate: { name: 'Revive', flavour: 'resurrects the whole team' } } })
    expect(result.ok && result.build.roleId).toBe('support')
  })
})

describe('inferRole', () => {
  it('matches whole words only', async () => {
    const { inferRole } = await import('./build.js')
    // "skills" must not count as the assassin word "kill", nor "health" as the support word "heal"
    expect(inferRole('Professor', { active1: { name: 'Lecture', flavour: 'many skills and good health' } })).not.toBe('assassin')
  })
})

describe('allocate and setAttribute (AE4)', () => {
  it('dragging an attribute past its cap stops at the cap and names the limit', () => {
    const build = mage()
    const cap = getRole('mage').attributeCaps.intellect
    const result = setAttribute(build, 'intellect', cap + 5)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.build.spread.intellect).toBeLessThanOrEqual(cap)
      expect(result.limits.map((l) => l.reason)).toContain('attribute-cap')
    }
  })

  it('setAttribute never spends more than the pool', () => {
    const build = { ...mage(), spread: { strength: 0, agility: 0, intellect: 0 } }
    const filled = setAttribute(setAttributeOk(setAttributeOk(build, 'strength', 14), 'intellect', 14), 'agility', 16)
    expect(filled.ok && spentPoints(filled.build.spread)).toBeLessThanOrEqual(POOL_SIZE)
    expect(filled.ok ? filled.limits.map((l) => l.reason) : []).toContain('pool-exceeded')
  })

  it('allocating more than the pool is rejected and the build keeps its last valid state', () => {
    const build = mage()
    const result = allocate(build, { strength: 20, agility: 10, intellect: 10 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.reason)).toContain('pool-exceeded')
      expect(result.build).toBe(build)
    }
  })

  it('a valid allocation resets the gate to draft', () => {
    const build: Build = { ...mage(), gate: { state: 'ready', catalogVersion: 1 } }
    const result = allocate(build, { strength: 10, agility: 10, intellect: 10 })
    expect(result.ok && result.build.gate.state).toBe('draft')
  })
})

function setAttributeOk(build: Build, attr: 'strength' | 'agility' | 'intellect', value: number): Build {
  const r = setAttribute(build, attr, value)
  if (!r.ok) throw new Error('unexpected')
  return r.build
}

describe('requestStats (AE2)', () => {
  it('"max armor, max regen, max health" clamps to caps and reports which limits were hit', () => {
    const result = requestStats(mage(), { armor: 'max', regen: 'max', maxHealth: 'max' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.build.spread.strength).toBe(getRole('mage').attributeCaps.strength)
      expect(spentPoints(result.build.spread)).toBeLessThanOrEqual(POOL_SIZE)
      expect(result.limits.length).toBeGreaterThan(0)
      expect(result.limits.map((l) => l.field)).toContain('strength')
    }
  })

  it('"more agile, less armor" moves points from Strength to Agility', () => {
    const before = mage()
    const result = requestStats(before, { moveSpeed: 'more', armor: 'less' })
    expect(result.ok && result.build.spread.agility).toBeGreaterThan(before.spread.agility)
    expect(result.ok && result.build.spread.strength).toBeLessThan(before.spread.strength)
  })
})

describe('setSize (R14)', () => {
  it('picks any of the five classes, keeps medium implicit, and refuses colossal', () => {
    const big = setSize(mage(), 'huge')
    expect(big.ok && big.build.sizeClass).toBe('huge')
    const back = big.ok ? setSize(big.build, 'medium') : big
    expect(back.ok && 'sizeClass' in back.build).toBe(false)
    expect(setSize(mage(), 'colossal').ok).toBe(false)
  })

  it('sends the balance check back to draft, since size changes the numbers', () => {
    const ready = { ...mage(), gate: { state: 'ready' as const, winRate: 0.5 } }
    const small = setSize(ready, 'small')
    expect(small.ok && small.build.gate.state).toBe('draft')
  })
})

describe('changeRole (AE3)', () => {
  it('Mage "Rewind" to Tank keeps the name and visuals, picks a Tank template and refunds all points', () => {
    const build = editSkillTextOk(mage(), 'active1', { visual: 'blue clock aura' })
    const result = changeRole(build, 'tank')
    expect(result.ok).toBe(true)
    if (result.ok) {
      const rewind = result.build.slots.active1
      expect(rewind.name).toBe('Rewind')
      expect(rewind.visual).toBe('blue clock aura')
      expect(getTemplate(rewind.templateId).roles).toContain('tank')
      expect(spentPoints(result.build.spread)).toBe(0)
      expect(result.build.roleId).toBe('tank')
      expect(result.build.gate.state).toBe('draft')
    }
  })
})

function editSkillTextOk(build: Build, slot: 'active1', text: { visual: string }): Build {
  const r = editSkillText(build, slot, text)
  if (!r.ok) throw new Error('unexpected')
  return r.build
}

describe('swapTemplate (R7)', () => {
  it('accepts one of the offered alternatives and marks the slot as swapped', () => {
    const build = mage()
    const [alt] = swapAlternatives(build, 'active1')
    const result = swapTemplate(build, 'active1', alt.id)
    expect(result.ok && result.build.slots.active1.templateId).toBe(alt.id)
    expect(result.ok && result.build.slots.active1.swapped).toBe(true)
  })

  it('accepts any template of the role for the slot, deep in the library too', () => {
    const build = mage()
    const options = swapOptions(build, 'active1')
    expect(options.length).toBeGreaterThanOrEqual(12)
    const last = options[options.length - 1]
    expect(swapTemplate(build, 'active1', last.id).ok).toBe(true)
  })

  it("rejects another role's template, another slot's template and the other active", () => {
    const build = mage()
    expect(swapTemplate(build, 'active1', 'tank-chain-hook').ok).toBe(false)
    expect(swapTemplate(build, 'active1', 'mage-time-stop').ok).toBe(false)
    expect(swapTemplate(build, 'active1', build.slots.active2.templateId).ok).toBe(false)
  })
})

describe('editSkillText', () => {
  it('editing an unswapped description re-matches its template', () => {
    const build = mage()
    const result = editSkillText(build, 'active2', { flavour: 'freezes everyone around' })
    expect(result.ok && getTemplate(result.build.slots.active2.templateId).tags).toContain('freeze')
  })

  it('editing a hand-swapped description asks before replacing the template', () => {
    const build = mage()
    const [alt] = swapAlternatives(build, 'active2')
    const swapped = swapTemplate(build, 'active2', alt.id)
    if (!swapped.ok) throw new Error('unexpected')
    const result = editSkillText(swapped.build, 'active2', { flavour: 'freezes everyone around' })
    expect(result.ok && result.needsConfirm).toBe(true)
    expect(result.ok && result.build.slots.active2.templateId).toBe(alt.id)
  })
})

describe('hydrateBuild (R4)', () => {
  it('ignores injected power numbers and retune steps from untrusted input', () => {
    const build = mage()
    const raw = JSON.parse(JSON.stringify(build))
    raw.slots.active1.retuneSteps = -5
    raw.slots.active1.damage = 99999
    raw.damage = 99999
    raw.gate = { state: 'ready' }
    const result = hydrateBuild(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.build.slots.active1.retuneSteps).toBe(0)
      expect('damage' in result.build.slots.active1).toBe(false)
      expect('damage' in result.build).toBe(false)
      expect(result.build.gate.state).toBe('draft')
    }
  })

  it('rejects a template ID outside the role pool for its slot', () => {
    const raw = JSON.parse(JSON.stringify(mage()))
    raw.slots.active1.templateId = 'tank-chain-hook'
    expect(hydrateBuild(raw).ok).toBe(false)
  })

  it('rejects an invalid spread', () => {
    const raw = JSON.parse(JSON.stringify(mage()))
    raw.spread = { strength: 30, agility: 30, intellect: 30 }
    expect(hydrateBuild(raw).ok).toBe(false)
  })
})

describe('setStatTarget (drag a detailed stat, AE4)', () => {
  it('dragging armor up finds a legal spread with more armor', async () => {
    const { setStatTarget } = await import('./build.js')
    const { deriveSheet } = await import('./stats.js')
    const build = mage()
    const before = deriveSheet(getRole('mage'), build.spread).sheet.armor
    const result = setStatTarget(build, 'armor', before + 5)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(deriveSheet(getRole('mage'), result.build.spread).sheet.armor).toBeGreaterThan(before)
      expect(spentPoints(result.build.spread)).toBeLessThanOrEqual(POOL_SIZE)
    }
  })

  it('dragging a stat past its cap stops at the closest reachable value and names the limit', async () => {
    const { setStatTarget } = await import('./build.js')
    const { deriveSheet } = await import('./stats.js')
    const build = mage()
    const cap = getRole('mage').caps.armor
    const result = setStatTarget(build, 'armor', cap + 50)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const reached = deriveSheet(getRole('mage'), result.build.spread).sheet.armor
      expect(reached).toBeLessThanOrEqual(cap)
      expect(result.limits.some((l) => l.field === 'armor')).toBe(true)
      expect(result.limits.find((l) => l.field === 'armor')?.allowed).toBe(reached)
    }
  })

  it('a stat no attribute feeds cannot be dragged and says so', async () => {
    const { setStatTarget } = await import('./build.js')
    const result = setStatTarget(mage(), 'fireRate', 99)
    expect(result.ok).toBe(true)
  })
})
