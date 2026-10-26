import { accountEmail, getSession, logout } from '../../src/server/accounts'
import { getDb } from '../../src/server/db'
import { errorResponse } from '../../src/server/http'
import { clearedCookie, readSessionCookie } from '../../src/server/sessions'

/** GET /api/auth/session -> { signedIn, email }. DELETE logs out. */
export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb()
    const session = await getSession(db, readSessionCookie(request))
    if (!session) return Response.json({ signedIn: false })
    return Response.json({ signedIn: true, email: await accountEmail(db, session.accountId) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const id = readSessionCookie(request)
    if (id) await logout(await getDb(), id)
    return Response.json({ signedIn: false }, { headers: { 'set-cookie': clearedCookie(process.env) } })
  } catch (error) {
    return errorResponse(error)
  }
}
