import { createHmac } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SCHEMA_SQL, type Db } from './db.js'
import { FREE_GRANT, GLOBAL_DAILY_FREE_GRANTS, PACKS, STAGE_PRICES, stagePrice } from '../forge/pricing.js'
import { balance, claimFreeGrant, ledgerBalance, placeHold, settleHold } from './credits.js'
import { fakePayments, handleStripeEvent, packById, pickPayments, verifyStripeSignature } from './payments.js'

let db: Db
let n = 0
async function account(): Promise<string> {
  const id = `acct-${++n}`
  await db.query('insert into accounts (id, email, email_normalized) values ($1, $2, $2)', [id, `${id}@example.com`])
  return id
}

beforeEach(async () => {
  const pg = new PGlite()
  await pg.exec(SCHEMA_SQL)
  db = pg as unknown as Db
})

const SECRET = 'whsec_test'
function signed(event: object, t = 1_800_000_000) {
  const payload = JSON.stringify(event)
  const v1 = createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex')
  return { payload, header: `t=${t},v1=${v1}`, t }
}
const completed = (id: string, accountId: string, amount: number) => ({
  id,
  type: 'checkout.session.completed',
  data: { object: { client_reference_id: accountId, amount_total: amount, currency: 'usd', payment_status: 'paid' } },
})

describe('pricing', () => {
  it('the free grant covers one hero with every capped retry, and spec/stats are free', () => {
    expect(stagePrice('spec')).toBe(0)
    expect(stagePrice('stats')).toBe(0)
    // every paid stage, the optional form included, with all three retries
    expect(FREE_GRANT).toBe(Object.values(STAGE_PRICES).reduce((s, p) => s + (p ?? 0), 0) * 4)
  })
})

describe('credit ledger (U8)', () => {
  it('a free grant is once per account', async () => {
    const a = await account()
    expect(await claimFreeGrant(db, a, '1.1.1.1')).toBe(FREE_GRANT)
    await expect(claimFreeGrant(db, a, '2.2.2.2')).rejects.toMatchObject({ status: 409 })
    expect(await balance(db, a)).toBe(FREE_GRANT)
  })

  it('one free grant per IP per day, and a global daily cap', async () => {
    await claimFreeGrant(db, await account(), '1.1.1.1')
    await expect(claimFreeGrant(db, await account(), '1.1.1.1')).rejects.toMatchObject({ status: 429 })
    await db.query("insert into counters (key, bucket, count) values ('grant-global', $1, $2) on conflict (key, bucket) do update set count = $2", [new Date().toISOString().slice(0, 10), GLOBAL_DAILY_FREE_GRANTS])
    await expect(claimFreeGrant(db, await account(), '9.9.9.9')).rejects.toMatchObject({ status: 429 })
  })

  it('two concurrent paid steps on a balance for one get exactly one hold', async () => {
    const a = await account()
    await fakePayments().checkout(db, { ...PACKS[0], credits: 60 }, a, 'https://x/')
    const results = await Promise.allSettled([placeHold(db, a, 60, 'f1:mesh:1'), placeHold(db, a, 60, 'f2:mesh:1')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 402 } })
    expect(await balance(db, a)).toBe(0)
  })

  it('holds are idempotent per ref; success charges, failure releases', async () => {
    const a = await account()
    await claimFreeGrant(db, a, '1.1.1.1')
    await placeHold(db, a, 60, 'f:mesh:1')
    await placeHold(db, a, 60, 'f:mesh:1')
    expect(await balance(db, a)).toBe(FREE_GRANT - 60)
    await settleHold(db, 'f:mesh:1', true)
    await settleHold(db, 'f:mesh:1', false)
    expect(await balance(db, a)).toBe(FREE_GRANT - 60)
    await placeHold(db, a, 50, 'f:motion:1')
    await settleHold(db, 'f:motion:1', false)
    await settleHold(db, 'f:motion:1', false)
    expect(await balance(db, a)).toBe(FREE_GRANT - 60)
    expect(await ledgerBalance(db, a)).toBe(await balance(db, a))
  })

  it('a hold larger than the balance is refused without a ledger row', async () => {
    const a = await account()
    await expect(placeHold(db, a, 10, 'f:concept:1')).rejects.toMatchObject({ status: 402 })
    const { rows } = await db.query('select 1 from credit_ledger where account_id = $1', [a])
    expect(rows).toHaveLength(0)
  })
})

describe('payments (U8)', () => {
  const env = { STRIPE_WEBHOOK_SECRET: SECRET }

  it('a verified completed checkout grants the matching pack once', async () => {
    const a = await account()
    const { payload, header, t } = signed(completed('evt_1', a, PACKS[1].amountCents))
    expect(await handleStripeEvent(db, payload, header, env, t)).toEqual({ granted: PACKS[1].credits })
    expect(await handleStripeEvent(db, payload, header, env, t)).toEqual({ granted: 0 })
    expect(await balance(db, a)).toBe(PACKS[1].credits)
  })

  it('a paid webhook with a mismatched amount grants nothing and fails loudly so Stripe retries', async () => {
    const a = await account()
    const { payload, header, t } = signed(completed('evt_2', a, 1))
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(handleStripeEvent(db, payload, header, env, t)).rejects.toMatchObject({ status: 500 })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
    expect(await balance(db, a)).toBe(0)
  })

  it('an unpaid or non-checkout event grants nothing', async () => {
    const a = await account()
    const unpaid = completed('evt_4', a, PACKS[0].amountCents)
    unpaid.data.object.payment_status = 'unpaid'
    const u = signed(unpaid)
    expect(await handleStripeEvent(db, u.payload, u.header, env, u.t)).toEqual({ granted: 0 })
    const other = signed({ ...completed('evt_5', a, PACKS[0].amountCents), type: 'charge.refunded' })
    expect(await handleStripeEvent(db, other.payload, other.header, env, other.t)).toEqual({ granted: 0 })
    expect(await balance(db, a)).toBe(0)
  })

  it('a bad or stale signature is rejected before anything is read', async () => {
    const a = await account()
    const { payload, header, t } = signed(completed('evt_3', a, PACKS[0].amountCents))
    await expect(handleStripeEvent(db, payload, header.replace(/v1=./, 'v1=0'), env, t)).rejects.toMatchObject({ status: 400 })
    expect(verifyStripeSignature(payload, header, SECRET, t + 301)).toBe(false)
    expect(verifyStripeSignature(payload, null, SECRET, t)).toBe(false)
  })

  it('purchases take a pack ID only; production without Stripe has no payments', () => {
    expect(packById('medium')?.credits).toBe(1000)
    expect(packById({ credits: 1e9 })).toBeUndefined()
    expect(pickPayments({ VERCEL_ENV: 'production' })).toBeUndefined()
    expect(pickPayments({})?.id).toBe('fake-payments')
    expect(pickPayments({ STRIPE_SECRET_KEY: 'sk' })?.id).toBe('stripe')
  })
})
