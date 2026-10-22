import { AuthError, startSignIn } from '../../src/server/accounts'
import { getDb } from '../../src/server/db'
import { pickEmailSender } from '../../src/server/email'
import { clientIp, errorResponse, readJson } from '../../src/server/http'

/** POST /api/auth/start { email } -> sends a magic sign-in link (KTD5). */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request, 2_000)
    const base = process.env.PUBLIC_BASE_URL || new URL(request.url).origin
    await startSignIn(await getDb(), String(body.email ?? ''), clientIp(request), pickEmailSender(process.env), base)
    return Response.json({ sent: true })
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status })
    return errorResponse(error)
  }
}
