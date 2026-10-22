import { isProduction } from '../forge/providers/router'
import type { Env } from '../forge/providers/types'
import { TIMEOUT_MS, type FetchLike } from '../forge/providers/live/http'

/** Sends sign-in links (KTD5). The fake keeps an outbox for tests and local development; production never uses it. */
export interface EmailSender {
  id: string
  available(): boolean
  send(to: string, subject: string, text: string): Promise<void>
}

export function fakeEmailSender(): EmailSender & { outbox: { to: string; subject: string; text: string }[] } {
  const outbox: { to: string; subject: string; text: string }[] = []
  return {
    id: 'fake-email',
    outbox,
    available: () => true,
    async send(to, subject, text) {
      outbox.push({ to, subject, text })
      // development only (production never builds this sender): the link goes to the dev server log (KTD5)
      if (!process.env.VITEST) console.info(`[dev email] to ${to}: ${text}`)
    },
  }
}

export function resendSender(env: Env, fetchImpl: FetchLike = fetch): EmailSender {
  return {
    id: 'resend',
    available: () => !!(env.RESEND_API_KEY && env.EMAIL_FROM),
    async send(to, subject, text) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
      })
      if (!res.ok) throw new Error(`email send failed: ${res.status}`)
    },
  }
}

/** The real sender when configured; the fake only outside production. Undefined means sign-in is unavailable. */
export function pickEmailSender(env: Env, fetchImpl?: FetchLike): EmailSender | undefined {
  const live = resendSender(env, fetchImpl)
  if (live.available()) return live
  return isProduction(env) ? undefined : fakeEmailSender()
}
