/** Shared HTTP helpers for live adapters. Every adapter takes a fetch implementation so tests never reach the network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const TIMEOUT_MS = 30_000

export async function postJson(fetchImpl: FetchLike, url: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

export async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const res = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

/** Map an HTTP status to an adapter outcome reason when the call did not succeed. */
export function httpFailure(status: number, json: unknown): { ok: false; kind: 'failed'; reason: string } {
  const message = (json as { message?: string; error?: { message?: string } })?.error?.message ?? (json as { message?: string })?.message ?? ''
  if (status === 429) return { ok: false, kind: 'failed', reason: `rate limited, retry later ${message}`.trim() }
  return { ok: false, kind: 'failed', reason: `HTTP ${status} ${message}`.trim() }
}
