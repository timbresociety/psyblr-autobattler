import { describe, expect, it, vi } from 'vitest'
import { candidates, pollTask, providerOrder, route, type Registry } from './router'
import { allFakes, fakeImage, fakeMesh, fakeRetarget, fakeRig } from './fakes'
import type { ImageProvider, Outcome } from './types'
import { createRegistry } from './registry'

function imageProvider(id: string, outcome: Outcome<{ urls: string[] }>, available = true): ImageProvider {
  return { id, capability: 'image', available: () => available, generate: vi.fn(async () => outcome) }
}

const live = (providers: ImageProvider[], env: Record<string, string> = {}): Registry => ({ providers, env: { FORGE_PROVIDERS_IMAGE: providers.map((p) => p.id).join(','), ...env } })

describe('provider router (U3)', () => {
  it('the first provider succeeding serves the stage, and no second provider is called', async () => {
    const a = imageProvider('a', { ok: true, value: { urls: ['u'] } })
    const b = imageProvider('b', { ok: true, value: { urls: ['v'] } })
    const r = await route<ImageProvider, { urls: string[] }>(live([a, b]), 'image', (p) => p.generate({ kind: 'sheet', prompt: 'x' }))
    expect(r).toMatchObject({ ok: true, provider: 'a' })
    expect(b.generate).not.toHaveBeenCalled()
  })

  it('a decline falls through to the next provider (AE5)', async () => {
    const a = imageProvider('a', { ok: false, kind: 'declined', reason: 'policy' })
    const b = imageProvider('b', { ok: true, value: { urls: ['v'] } })
    const r = await route<ImageProvider, { urls: string[] }>(live([a, b]), 'image', (p) => p.generate({ kind: 'sheet', prompt: 'x' }))
    expect(r).toMatchObject({ ok: true, provider: 'b' })
  })

  it('every provider declining returns a stage failure with each reason', async () => {
    const a = imageProvider('a', { ok: false, kind: 'declined', reason: 'policy a' })
    const b = imageProvider('b', { ok: false, kind: 'declined', reason: 'policy b' })
    const r = await route<ImageProvider, { urls: string[] }>(live([a, b]), 'image', (p) => p.generate({ kind: 'sheet', prompt: 'x' }))
    expect(r).toMatchObject({ ok: false, kind: 'declined' })
    expect(r.ok === false && r.reasons.map((x) => x.reason)).toEqual(['policy a', 'policy b'])
  })

  it('a thrown error counts as a failure and falls through', async () => {
    const a: ImageProvider = { id: 'a', capability: 'image', available: () => true, generate: async () => { throw new Error('boom') } }
    const b = imageProvider('b', { ok: true, value: { urls: ['v'] } })
    expect(await route<ImageProvider, { urls: string[] }>(live([a, b]), 'image', (p) => p.generate({ kind: 'sheet', prompt: 'x' }))).toMatchObject({ ok: true, provider: 'b' })
  })

  it('configuration overrides the provider order', () => {
    expect(providerOrder('director', {})).toEqual(['openai-compatible', 'anthropic'])
    expect(providerOrder('director', { FORGE_PROVIDERS_DIRECTOR: 'anthropic, openai-compatible' })).toEqual(['anthropic', 'openai-compatible'])
  })

  it('unavailable live providers are skipped; with none live outside production, fakes take over', () => {
    const registry: Registry = { providers: [imageProvider('openai-image', { ok: true, value: { urls: [] } }, false), fakeImage()], env: {} }
    expect(candidates(registry, 'image').map((p) => p.id)).toEqual(['fake-image'])
  })

  it('in production, fakes are never used, even with FORGE_FAKE_PROVIDERS=1', () => {
    const registry: Registry = { providers: [fakeImage()], env: { VERCEL_ENV: 'production', FORGE_FAKE_PROVIDERS: '1' } }
    expect(candidates(registry, 'image')).toEqual([])
  })

  it('a pending task polls to success on the same provider', async () => {
    const registry: Registry = { providers: allFakes(), env: { FORGE_FAKE_PROVIDERS: '1' } }
    const started = await route(registry, 'mesh', (p) => (p as ReturnType<typeof fakeMesh>).start({ imageUrl: 'img', quad: true, faceLimit: 50000 }))
    expect(started.ok).toBe('pending')
    if (started.ok !== 'pending') return
    const done = await pollTask(registry, started.provider, (p) => (p as ReturnType<typeof fakeMesh>).poll(started.taskId))
    expect(done).toMatchObject({ ok: true, provider: 'fake-mesh' })
  })

  it('every registered provider id is unique, so a task polls on the adapter that started it', () => {
    const ids = createRegistry({}).providers.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('fakes are deterministic', async () => {
    const a = await fakeImage().generate({ kind: 'sheet', prompt: 'jensen' })
    const b = await fakeImage().generate({ kind: 'sheet', prompt: 'jensen' })
    expect(a).toEqual(b)
    const rig = await fakeRig().start({ modelUrl: 'm', skeleton: 'mixamo' })
    const rig2 = await fakeRig().start({ modelUrl: 'm', skeleton: 'mixamo' })
    expect(rig).toEqual(rig2)
    const motion = await fakeRetarget().start({ riggedUrl: 'r', presets: ['idle', 'walk'] })
    expect(motion.ok).toBe('pending')
  })
})
