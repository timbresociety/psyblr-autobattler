import { randomUUID } from 'node:crypto'
import { FREE_GRANT, GLOBAL_DAILY_FREE_GRANTS } from '../forge/pricing'
import { bump, dayBucket, readCount } from './accounts'
import type { Db } from './db'

/**
 * Credit ledger with holds (KTD6). A paid step first places a hold, which debits the available balance in one
 * atomic statement and fails when the balance is short. Success turns the hold into a charge; a decline or
 * failure releases it. So concurrent forges can never spend provider money the player does not have.
 */

export class CreditError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function ensureAccount(db: Db, accountId: string) {
  await db.query('insert into credit_accounts (account_id) values ($1) on conflict do nothing', [accountId])
}

/** Add credits (grant or purchase) once per ref. Returns false when the ref was already used. */
async function credit(db: Db, accountId: string, kind: 'grant' | 'purchase', amount: number, ref: string): Promise<boolean> {
  await ensureAccount(db, accountId)
  const { rows } = await db.query(
    `with entry as (
       insert into credit_ledger (id, account_id, kind, amount, ref) values ($1, $2, $3, $4, $5)
       on conflict (kind, ref) do nothing returning amount
     )
     update credit_accounts set available = available + (select amount from entry)
     where account_id = $2 and exists (select 1 from entry) returning available`,
    [randomUUID(), accountId, kind, amount, ref],
  )
  return rows.length > 0
}

export async function balance(db: Db, accountId: string): Promise<number> {
  const { rows } = await db.query<{ available: number }>('select available from credit_accounts where account_id = $1', [accountId])
  return rows[0]?.available ?? 0
}

/** The one-time free grant (R3): once per account, once per IP per day, and under a global daily cap. */
export async function claimFreeGrant(db: Db, accountId: string, ip: string, now = new Date()): Promise<number> {
  const day = dayBucket(now)
  const already = await db.query("select 1 from credit_ledger where kind = 'grant' and ref = $1", [`free:${accountId}`])
  if (already.rows.length) throw new CreditError('the free hero has already been claimed', 409)
  if ((await readCount(db, `grant-ip:${ip}`, day)) >= 1) throw new CreditError('a free hero was already claimed from this network today', 429)
  if ((await readCount(db, 'grant-global', day)) >= GLOBAL_DAILY_FREE_GRANTS) throw new CreditError('free heroes are paused for today; try again tomorrow', 429)
  if (!(await credit(db, accountId, 'grant', FREE_GRANT, `free:${accountId}`))) throw new CreditError('the free hero has already been claimed', 409)
  await bump(db, `grant-ip:${ip}`, day)
  await bump(db, 'grant-global', day)
  return balance(db, accountId)
}

export async function grantPurchase(db: Db, accountId: string, credits: number, ref: string): Promise<boolean> {
  return credit(db, accountId, 'purchase', credits, ref)
}

/** Reserve a step's price. Idempotent per ref; throws when the available balance is short (AE2). */
export async function placeHold(db: Db, accountId: string, amount: number, ref: string): Promise<void> {
  if (amount <= 0) return
  await ensureAccount(db, accountId)
  const existing = await db.query("select 1 from credit_ledger where kind = 'hold' and ref = $1", [ref])
  if (existing.rows.length) return
  let rows: unknown[] = []
  try {
    ;({ rows } = await db.query(
    `with debit as (
       update credit_accounts set available = available - $3
       where account_id = $2 and available >= $3
         and not exists (select 1 from credit_ledger where kind = 'hold' and ref = $4)
       returning account_id
     )
     insert into credit_ledger (id, account_id, kind, amount, ref)
     select $1, $2, 'hold', $3, $4 from debit returning id`,
    [randomUUID(), accountId, amount, ref],
    ))
  } catch (error) {
    // A concurrent hold with the same ref won the unique index; the whole statement rolled back, so nothing was debited.
    if ((error as { code?: string }).code !== '23505') throw error
  }
  if (!rows.length) {
    const raced = await db.query("select 1 from credit_ledger where kind = 'hold' and ref = $1", [ref])
    if (!raced.rows.length) throw new CreditError('not enough credits for this step', 402)
  }
}

/** Close a hold: success charges it, failure or decline releases it. Idempotent per ref. */
export async function settleHold(db: Db, ref: string, success: boolean): Promise<void> {
  const { rows } = await db.query<{ account_id: string; amount: number }>("select account_id, amount from credit_ledger where kind = 'hold' and ref = $1", [ref])
  const hold = rows[0]
  if (!hold) return
  const closed = await db.query("select 1 from credit_ledger where kind in ('charge', 'release') and ref = $1", [ref])
  if (closed.rows.length) return
  if (success) {
    await db.query("insert into credit_ledger (id, account_id, kind, amount, ref) values ($1, $2, 'charge', $3, $4) on conflict do nothing", [randomUUID(), hold.account_id, hold.amount, ref])
    return
  }
  await db.query(
    `with entry as (
       insert into credit_ledger (id, account_id, kind, amount, ref) values ($1, $2, 'release', $3, $4)
       on conflict (kind, ref) do nothing returning amount
     )
     update credit_accounts set available = available + (select amount from entry)
     where account_id = $2 and exists (select 1 from entry)`,
    [randomUUID(), hold.account_id, hold.amount, ref],
  )
}

/** Recompute the balance from the ledger alone; must always equal credit_accounts.available. */
export async function ledgerBalance(db: Db, accountId: string): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `select coalesce(sum(case kind when 'grant' then amount when 'purchase' then amount when 'hold' then -amount when 'release' then amount else 0 end), 0)::int as total
     from credit_ledger where account_id = $1`,
    [accountId],
  )
  return rows[0].total
}
