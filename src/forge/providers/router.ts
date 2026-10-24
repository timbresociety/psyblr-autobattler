import type { AnyProvider, Capability, Env, Outcome } from './types.js'

/** The default provider order per capability (KTD3). Override with FORGE_PROVIDERS_<CAPABILITY>=id,id. */
export const DEFAULT_ORDER: Record<Capability, string[]> = {
  director: ['openai-compatible', 'anthropic'],
  image: ['openai-image'],
  mesh: ['tripo-mesh'],
  rig: ['tripo-rig'],
  retarget: ['tripo-retarget'],
  moderation: ['anthropic-moderation'],
}

export function isProduction(env: Env): boolean {
  return env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production'
}

/**
 * Fakes are a development and offline path (KTD3). A preview deployment may opt in too, so the paid flows can be clicked
 * through without paying a provider (Vercel runs previews with NODE_ENV=production); production ignores the switch.
 */
export function fakeMode(env: Env): boolean {
  if (env.FORGE_FAKE_PROVIDERS !== '1' || env.VERCEL_ENV === 'production') return false
  return env.VERCEL_ENV === 'preview' || !isProduction(env)
}

export function providerOrder(capability: Capability, env: Env): string[] {
  const override = env[`FORGE_PROVIDERS_${capability.toUpperCase()}`]
  return override ? override.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORDER[capability]
}

export type Routed<T> =
  | { ok: true; value: T; provider: string }
  | { ok: 'pending'; taskId: string; provider: string }
  | { ok: false; kind: 'declined' | 'failed' | 'unavailable'; reasons: { provider: string; kind: string; reason: string }[] }

export interface Registry {
  /** Live and fake providers by id. */
  providers: AnyProvider[]
  env: Env
}

/** The providers to try for a capability, in order. Fake mode uses fakes; otherwise live ones that are available. */
export function candidates<P extends AnyProvider>(registry: Registry, capability: Capability): P[] {
  const all = registry.providers.filter((p) => p.capability === capability) as P[]
  if (fakeMode(registry.env)) return all.filter((p) => p.id.startsWith('fake-'))
  const order = providerOrder(capability, registry.env)
  const live = order.map((id) => all.find((p) => p.id === id)).filter((p): p is P => !!p && p.available())
  if (live.length) return live
  // nothing live is configured: outside production, the offline path keeps the forge usable
  return isProduction(registry.env) ? [] : all.filter((p) => p.id.startsWith('fake-'))
}

/**
 * Walk the capability's providers in order. A success or a started task ends the walk; a decline or failure
 * falls through to the next provider (R23, F3). The caller never re-routes a pending task.
 */
export async function route<P extends AnyProvider, T>(registry: Registry, capability: Capability, call: (provider: P) => Promise<Outcome<T>>): Promise<Routed<T>> {
  const providers = candidates<P>(registry, capability)
  if (!providers.length) return { ok: false, kind: 'unavailable', reasons: [{ provider: '-', kind: 'unavailable', reason: `no ${capability} provider is configured` }] }
  const reasons: { provider: string; kind: string; reason: string }[] = []
  for (const provider of providers) {
    let outcome: Outcome<T>
    try {
      outcome = await call(provider)
    } catch (error) {
      outcome = { ok: false, kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
    if (outcome.ok === true) return { ok: true, value: outcome.value, provider: provider.id }
    if (outcome.ok === 'pending') return { ok: 'pending', taskId: outcome.taskId, provider: provider.id }
    reasons.push({ provider: provider.id, kind: outcome.kind, reason: outcome.reason })
  }
  return { ok: false, kind: reasons.every((r) => r.kind === 'declined') ? 'declined' : 'failed', reasons }
}

/** Poll a started task on the provider that started it. */
export async function pollTask<T>(registry: Registry, providerId: string, poll: (provider: AnyProvider) => Promise<Outcome<T>>): Promise<Routed<T>> {
  const provider = registry.providers.find((p) => p.id === providerId)
  if (!provider) return { ok: false, kind: 'failed', reasons: [{ provider: providerId, kind: 'failed', reason: 'provider no longer registered' }] }
  try {
    const outcome = await poll(provider)
    if (outcome.ok === true) return { ok: true, value: outcome.value, provider: providerId }
    if (outcome.ok === 'pending') return { ok: 'pending', taskId: outcome.taskId, provider: providerId }
    return { ok: false, kind: outcome.kind, reasons: [{ provider: providerId, kind: outcome.kind, reason: outcome.reason }] }
  } catch (error) {
    return { ok: false, kind: 'failed', reasons: [{ provider: providerId, kind: 'failed', reason: error instanceof Error ? error.message : String(error) }] }
  }
}
