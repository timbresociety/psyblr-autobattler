import { balance, claimFreeGrant } from '../../src/server/credits'
import { getDb } from '../../src/server/db'
import { clientIp, errorResponse } from '../../src/server/http'
import { requireAccount } from '../../src/server/sessions'
import { FREE_GRANT, PACKS } from '../../src/forge/pricing'

/** GET /api/credits -> { balance, freeGrant, packs }. POST claims the one free hero (R3). */
export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb()
    const { accountId } = await requireAccount(request, db)
    const { rows } = await db.query("select 1 from credit_ledger where kind = 'grant' and ref = $1", [`free:${accountId}`])
    return Response.json({
      balance: await balance(db, accountId),
      freeGrant: FREE_GRANT,
      freeClaimed: rows.length > 0,
      packs: PACKS.map(({ id, credits, amountCents, currency }) => ({ id, credits, amountCents, currency })),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const db = await getDb()
    const { accountId } = await requireAccount(request, db)
    return Response.json({ balance: await claimFreeGrant(db, accountId, clientIp(request)) })
  } catch (error) {
    return errorResponse(error)
  }
}
