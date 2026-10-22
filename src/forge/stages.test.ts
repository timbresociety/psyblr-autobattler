import { defaultBuild } from '../sim/fixtures'
import { describe, expect, it } from 'vitest'
import { STAGE_ORDER, STAGE_TABLE, begin, confirm, createForge, editInputs, fail, retry, succeed, formAvailable, formSize, skip } from './stages'
import type { Forge, StageId } from './types'

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`unexpected rejection: ${JSON.stringify(r)}`)
  return r as Extract<T, { ok: true }>
}

/** Drive a stage to ready. */
function ready(forge: Forge, stage: StageId): Forge {
  const started = ok(begin(forge, stage)).forge
  return ok(succeed(started, stage, { image: `blob://${stage}` })).forge
}

describe('forge state machine (U1)', () => {
  it('starts at spec with every stage in draft', () => {
    const forge = createForge('f1', 'acct1')
    expect(forge.current).toBe('spec')
    for (const id of STAGE_ORDER) expect(forge.stages[id].status).toBe('draft')
  })

  it('confirming a ready stage approves it and opens the next', () => {
    const forge = ok(confirm(ready(createForge('f1', 'a'), 'spec'), 'spec')).forge
    expect(forge.stages.spec.status).toBe('approved')
    expect(forge.current).toBe('concept')
  })

  it('an approved stage can never be regenerated', () => {
    const forge = ok(confirm(ready(createForge('f1', 'a'), 'spec'), 'spec')).forge
    expect(begin(forge, 'spec')).toMatchObject({ ok: false, reason: 'frozen' })
    expect(retry(forge, 'spec')).toMatchObject({ ok: false, reason: 'frozen' })
    expect(editInputs(forge, 'spec', { prompt: 'x' })).toMatchObject({ ok: false, reason: 'frozen' })
  })

  it('a retry beyond the cap is rejected', () => {
    let forge = ok(confirm(ready(createForge('f1', 'a'), 'spec'), 'spec')).forge
    forge = ready(forge, 'concept')
    for (let i = 0; i < STAGE_TABLE.concept.retryCap; i++) {
      forge = ok(retry(forge, 'concept')).forge
      forge = ok(succeed(forge, 'concept', { image: 'blob://again' })).forge
    }
    expect(retry(forge, 'concept')).toMatchObject({ ok: false, reason: 'retry-cap' })
  })

  it('a failed stage can be retried without using a retry', () => {
    let forge = ok(confirm(ready(createForge('f1', 'a'), 'spec'), 'spec')).forge
    forge = ok(begin(forge, 'concept')).forge
    forge = ok(fail(forge, 'concept', 'all providers declined')).forge
    expect(forge.stages.concept.status).toBe('failed')
    forge = ok(retry(forge, 'concept')).forge
    expect(forge.stages.concept.retriesUsed).toBe(0)
    expect(forge.stages.concept.status).toBe('generating')
  })

  it('acting on a stage out of order is rejected', () => {
    const forge = createForge('f1', 'a')
    expect(begin(forge, 'mesh')).toMatchObject({ ok: false, reason: 'out-of-order' })
    expect(confirm(forge, 'spec')).toMatchObject({ ok: false, reason: 'bad-status' })
  })

  it('editing a ready stage returns it to draft and keeps the retry count', () => {
    let forge = ok(confirm(ready(createForge('f1', 'a'), 'spec'), 'spec')).forge
    forge = ready(forge, 'concept')
    forge = ok(retry(forge, 'concept')).forge
    forge = ok(succeed(forge, 'concept', { image: 'x' })).forge
    forge = ok(editInputs(forge, 'concept', { note: 'more lightning' })).forge
    expect(forge.stages.concept.status).toBe('draft')
    expect(forge.stages.concept.retriesUsed).toBe(1)
    expect(forge.stages.concept.inputs).toMatchObject({ note: 'more lightning' })
  })

  it('regenerating after an edit spends a retry, so edits cannot bypass the cap', () => {
    let forge = ok(confirm(ready(createForge('f1', 'a'), 'spec'), 'spec')).forge
    forge = ready(forge, 'concept')
    for (let i = 0; i < STAGE_TABLE.concept.retryCap; i++) {
      forge = ok(editInputs(forge, 'concept', { note: String(i) })).forge
      forge = ok(begin(forge, 'concept')).forge
      forge = ok(succeed(forge, 'concept', { image: 'x' })).forge
    }
    forge = ok(editInputs(forge, 'concept', { note: 'one more' })).forge
    expect(begin(forge, 'concept')).toMatchObject({ ok: false, reason: 'retry-cap' })
  })

  it('every successful generation bumps the attempt number, which keys charges', () => {
    let forge = ok(confirm(ready(createForge('f1', 'a'), 'spec'), 'spec')).forge
    forge = ready(forge, 'concept')
    const first = forge.stages.concept.attempt
    forge = ok(retry(forge, 'concept')).forge
    expect(forge.stages.concept.attempt).toBe(first + 1)
  })

  it('confirming stats publishes the forge', () => {
    let forge = createForge('f1', 'a')
    // with no transforming ultimate the form stage passes by on its own
    for (const id of STAGE_ORDER) if (forge.current === id) forge = ok(confirm(ready(forge, id), id)).forge
    expect(forge.current).toBe('published')
    expect(forge.stages.form.inputs.skipped).toBe(true)
  })

  it('offers the form stage only to a hero whose ultimate transforms it (R34)', () => {
    const titan = defaultBuild('tank')
    const withTitan = { ...titan, slots: { ...titan.slots, ultimate: { ...titan.slots.ultimate, templateId: 'tank-titan-form' } } }
    const plain = { ...titan, slots: { ...titan.slots, ultimate: { ...titan.slots.ultimate, templateId: 'tank-earthquake' } } }
    expect(formAvailable(withTitan)).toBe(true)
    expect(formSize(withTitan)).toBe('colossal')
    expect(formAvailable(plain)).toBe(false)
    const atUltimate = (build: typeof titan) => {
      let forge: Forge = { ...createForge('f', 'a'), build }
      for (const id of STAGE_ORDER.slice(0, STAGE_ORDER.indexOf('ultimate') + 1)) forge = ok(confirm(ready(forge, id), id)).forge
      return forge
    }
    expect(atUltimate(plain).current).toBe('stats')
    const offered = atUltimate(withTitan)
    expect(offered.current).toBe('form')
    const skipped = ok(skip(offered, 'form')).forge
    expect(skipped.current).toBe('stats')
    expect(skipped.stages.form.artifacts).toEqual({})
    expect(skip(skipped, 'stats').ok).toBe(false)
  })
})
