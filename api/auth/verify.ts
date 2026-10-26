import { verifySignIn } from '../../src/server/accounts'
import { getDb } from '../../src/server/db'
import { clientIp, deviceId, errorResponse, readJson } from '../../src/server/http'
import { sessionCookie } from '../../src/server/sessions'

/** POST /api/auth/verify { token } -> sets the session cookie. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request, 2_000)
    const signedIn = await verifySignIn(await getDb(), String(body.token ?? ''), clientIp(request), deviceId(request))
    return Response.json({ accountId: signedIn.accountId, isNew: signedIn.isNew }, { headers: { 'set-cookie': sessionCookie(signedIn.sessionId, process.env) } })
  } catch (error) {
    return errorResponse(error)
  }
}
