import { getDb } from '../../src/server/db'
import { errorResponse } from '../../src/server/http'
import { handleStripeEvent } from '../../src/server/payments'

/** POST /api/payments/webhook: Stripe checkout events, verified by signature before any grant. */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) return Response.json({ error: 'payments not configured' }, { status: 503 })
    const payload = await request.text()
    const result = await handleStripeEvent(await getDb(), payload, request.headers.get('stripe-signature'), process.env)
    return Response.json({ received: true, ...result })
  } catch (error) {
    return errorResponse(error)
  }
}
