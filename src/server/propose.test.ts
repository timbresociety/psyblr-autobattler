import { describe, expect, it, vi } from 'vitest'
import { InputError, chatEdit, proposeHero, type ModelCall } from './propose.js'
import { RateLimiter } from './rate-limit.js'
import { getTemplate } from '../charter/templates/catalog.js'
import { POOL_SIZE, spentPoints } from '../charter/stats.js'
import { proposeBuild } from '../charter/build.js'

const input = {
  heroName: 'Dario',
  skills: {
    active1: { name: 'Rewind', flavour: 'rewind the last 5 seconds' },
    ultimate: { name: 'Big Beam', flavour: 'a giant kamehameha wave' },
  },
}

const valid = {
  roleId: 'mage',
  templates: { basic: 'mage-arcane-bolt', active1: 'mage-chrono-rewind', active2: 'mage-fireball', passive: 'mage-arcane-focus', ultimate: 'mage-mega-beam', movement: 'mage-teleport' },
  spread: { strength: 6, agility: 6, intellect: 18 },
}

describe('proposeHero', () => {
  it('with a valid model answer, returns a valid draft build', async () => {
    const call: ModelCall = vi.fn(async () => valid)
    const result = await proposeHero(input, { callModel: call })
    expect(result.offline).toBe(false)
    expect(result.build.roleId).toBe('mage')
    expect(result.build.slots.active1.templateId).toBe('mage-chrono-rewind')
    expect(result.build.slots.active1.name).toBe('Rewind')
    expect(result.build.gate.state).toBe('draft')
  })

  it('the model names only the slots the player left unnamed, and never with numbers', async () => {
    const call: ModelCall = vi.fn(async () => ({ ...valid, names: { active1: 'Not This', active2: 'Ember Lance 9000', movement: 'Phase  Step' } }))
    const result = await proposeHero(input, { callModel: call })
    expect(result.build.slots.active1.name).toBe('Rewind')
    expect(result.build.slots.active2.name).toBe('Ember Lance')
    expect(result.build.slots.movement.name).toBe('Phase Step')
    expect(result.build.slots.basic.name).toBe('')
  })

  it('an unknown template ID falls back to the matcher for that slot', async () => {
    const call: ModelCall = async () => ({ ...valid, templates: { ...valid.templates, ultimate: 'made-up-nuke' } })
    const result = await proposeHero(input, { callModel: call })
    expect(getTemplate(result.build.slots.ultimate.templateId).roles).toContain('mage')
  })

  it('a template from another role falls back to the matcher', async () => {
    const call: ModelCall = async () => ({ ...valid, templates: { ...valid.templates, active2: 'tank-chain-hook' } })
    const result = await proposeHero(input, { callModel: call })
    expect(result.build.slots.active2.templateId).not.toBe('tank-chain-hook')
  })

  it('a spread over the pool is replaced by a legal one', async () => {
    const call: ModelCall = async () => ({ ...valid, spread: { strength: 30, agility: 30, intellect: 30 } })
    const result = await proposeHero(input, { callModel: call })
    expect(spentPoints(result.build.spread)).toBeLessThanOrEqual(POOL_SIZE)
  })

  it('a model failure or timeout returns a matcher-only proposal flagged offline', async () => {
    const call: ModelCall = async () => {
      throw new Error('timeout')
    }
    const result = await proposeHero(input, { callModel: call })
    expect(result.offline).toBe(true)
    expect(getTemplate(result.build.slots.active1.templateId).tags).toContain('return-to-past')
  })

  it('injected power numbers in the model answer never reach the build (R4)', async () => {
    const call: ModelCall = async () => ({ ...valid, damage: 9999, templates: { ...valid.templates }, retuneSteps: -9 }) as never
    const result = await proposeHero(input, { callModel: call })
    expect(JSON.stringify(result.build)).not.toContain('9999')
    expect(Object.values(result.build.slots).every((s) => s.retuneSteps === 0)).toBe(true)
  })

  it('an oversize skill description is rejected before any model call', async () => {
    const call = vi.fn()
    const big = { ...input, skills: { active1: { name: 'x', flavour: 'y'.repeat(1000) } } }
    await expect(proposeHero(big, { callModel: call as unknown as ModelCall })).rejects.toBeInstanceOf(InputError)
    expect(call).not.toHaveBeenCalled()
  })

  it('a device over its rate limit gets an offline proposal and the model is not called', async () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 })
    const call = vi.fn(async () => valid)
    await proposeHero(input, { callModel: call, limiter, keys: ['device-1'] })
    const second = await proposeHero(input, { callModel: call, limiter, keys: ['device-1'] })
    expect(second.offline).toBe(true)
    expect(call).toHaveBeenCalledTimes(1)
  })
})

describe('proposeHero input and actives', () => {
  it("the model's active1 equal to the matcher's active2 never leaves two identical actives", async () => {
    const base = proposeBuild({ heroName: 'Dario', roleId: 'mage', skills: input.skills }).build
    const call: ModelCall = async () => ({ ...valid, templates: { ...valid.templates, active1: base.slots.active2.templateId, active2: 'not-a-template' } })
    const result = await proposeHero(input, { callModel: call })
    expect(result.build.slots.active1.templateId).not.toBe(result.build.slots.active2.templateId)
  })

  it('malformed requests are input errors, not crashes', async () => {
    const call = vi.fn(async () => valid)
    await expect(proposeHero(undefined as never, { callModel: call })).rejects.toBeInstanceOf(InputError)
    await expect(proposeHero({ heroName: 'x', skills: 'nope' } as never, { callModel: call })).rejects.toBeInstanceOf(InputError)
    await expect(proposeHero({ heroName: 'x', skills: {}, roleId: 'wizard' } as never, { callModel: call })).rejects.toBeInstanceOf(InputError)
    await expect(proposeHero({ heroName: 'x', skills: {}, photoUrls: ['https://evil.example.com/a.png'] }, { callModel: call })).rejects.toBeInstanceOf(InputError)
    expect(call).not.toHaveBeenCalled()
  })
})

describe('chatEdit', () => {
  const base = proposeBuild({ heroName: 'Dario', roleId: 'mage', skills: {} }).build

  it('"more agile, less armor" moves points toward Agility', async () => {
    const call: ModelCall = async () => ({ goals: { moveSpeed: 'more', armor: 'less' }, roleId: null })
    const result = await chatEdit(base, 'more agile, less armor', { callModel: call })
    expect(result.build.spread.agility).toBeGreaterThan(base.spread.agility)
    expect(result.understood).toBe(true)
  })

  it('offline, simple stat wording is still understood', async () => {
    const call: ModelCall = async () => {
      throw new Error('down')
    }
    const result = await chatEdit(base, 'more agile, less armor', { callModel: call })
    expect(result.offline).toBe(true)
    expect(result.build.spread.agility).toBeGreaterThan(base.spread.agility)
  })

  it('offline, an edit the keyword parser cannot read says so instead of guessing', async () => {
    const call: ModelCall = async () => {
      throw new Error('down')
    }
    const result = await chatEdit(base, 'make her vibe more mysterious', { callModel: call })
    expect(result.offline).toBe(true)
    expect(result.understood).toBe(false)
    expect(result.build).toBe(base)
  })

  it('never returns numbers from model output; unknown goals are ignored', async () => {
    const call: ModelCall = async () => ({ goals: { armor: 'max', bogus: 'max', weaponDamage: 500 }, roleId: null })
    const result = await chatEdit(base, 'tankier', { callModel: call })
    expect(spentPoints(result.build.spread)).toBeLessThanOrEqual(POOL_SIZE)
  })
})
