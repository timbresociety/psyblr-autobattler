import { startSignIn } from '../../src/server/accounts.js'
import { getDb } from '../../src/server/db.js'
import { devSignInLink, pickEmailSender } from '../../src/server/email.js'
import { clientIp, errorResponse, readJson } from '../../src/server/http.js'

/** POST /api/auth/start { email } -> sends a magic sign-in link (KTD5); the dev server also returns it as devLink. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request, 2_000)
    const base = process.env.PUBLIC_BASE_URL || new URL(request.url).origin
    const sender = pickEmailSender(process.env)
    const link = await startSignIn(await getDb(), String(body.email ?? ''), clientIp(request), sender, base)
    const devLink = devSignInLink(sender, process.env, link)
    return Response.json(devLink ? { sent: true, devLink } : { sent: true })
  } catch (error) {
    return errorResponse(error)
  }
}
