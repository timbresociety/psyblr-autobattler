import { getDb } from '../../src/server/db'
import { errorResponse, readJson } from '../../src/server/http'
import { packById, pickPayments } from '../../src/server/payments'
import { requireAccount } from '../../src/server/sessions'

/** POST /api/credits/purchase { pack } -> { url } of a checkout. Only a pack ID is accepted (KTD6). */
export async function POST(request: Request): Promise<Response> {
  try {
    const db = await getDb()
    const { accountId } = await requireAccount(request, db)
    const pack = packById((await readJson(request, 1_000)).pack)
    if (!pack) return Response.json({ error: 'unknown pack' }, { status: 400 })
    const payments = pickPayments(process.env)
    if (!payments) return Response.json({ error: 'purchases are not available yet' }, { status: 503 })
    const base = process.env.PUBLIC_BASE_URL || new URL(request.url).origin
    return Response.json(await payments.checkout(db, pack, accountId, `${base}/`))
  } catch (error) {
    return errorResponse(error)
  }
}
