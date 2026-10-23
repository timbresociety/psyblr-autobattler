import { describe, expect, it } from 'vitest'
import { devSignInLink, fakeEmailSender, pickEmailSender, resendSender } from './email'

const LINK = 'http://localhost:3110/?signin=abc'

describe('the dev sign-in link', () => {
  it('the dev server (the fake sender with fake providers on) hands the link back', () => {
    expect(devSignInLink(fakeEmailSender(), { FORGE_FAKE_PROVIDERS: '1' }, LINK)).toBe(LINK)
  })

  it('production never hands it back, even with the fake switch set', () => {
    expect(devSignInLink(fakeEmailSender(), { FORGE_FAKE_PROVIDERS: '1', VERCEL_ENV: 'production' }, LINK)).toBeUndefined()
    expect(devSignInLink(fakeEmailSender(), { FORGE_FAKE_PROVIDERS: '1', NODE_ENV: 'production' }, LINK)).toBeUndefined()
    expect(pickEmailSender({ NODE_ENV: 'production' })).toBeUndefined()
  })

  it('a deployment without fake providers only logs it', () => {
    expect(devSignInLink(fakeEmailSender(), {}, LINK)).toBeUndefined()
    expect(devSignInLink(undefined, { FORGE_FAKE_PROVIDERS: '1' }, LINK)).toBeUndefined()
  })

  it('a real email sender never hands it back', () => {
    expect(devSignInLink(resendSender({ RESEND_API_KEY: 'k', EMAIL_FROM: 'f@x.test' }), { FORGE_FAKE_PROVIDERS: '1' }, LINK)).toBeUndefined()
  })
})
