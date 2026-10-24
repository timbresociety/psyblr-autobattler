/**
 * Every /api route in one serverless function. Vercel's Hobby plan deploys at most 12 functions, and the app has more
 * routes than that, so vercel.json rewrites /api/* here, this router reads the route and hands the request to that
 * route's own module in routes/, loading only that module. The local dev server dispatches through this same file
 * (scripts/dev-api.ts).
 */

type Handler = (request: Request) => Promise<Response>
/** A route module exports a handler per HTTP method, and may export helpers beside them. */
type RouteModule = Record<string, unknown>

const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE'])

/** /api/<key> → its module. Each import is a static string, so Vercel's file tracer bundles every route. */
export const ROUTES: Record<string, () => Promise<RouteModule>> = {
  'admin/hide': () => import('../routes/admin/hide.js'),
  'assets/search': () => import('../routes/assets/search.js'),
  'auth/session': () => import('../routes/auth/session.js'),
  'auth/start': () => import('../routes/auth/start.js'),
  'auth/verify': () => import('../routes/auth/verify.js'),
  builds: () => import('../routes/builds/index.js'),
  'charter/propose': () => import('../routes/charter/propose.js'),
  credits: () => import('../routes/credits/index.js'),
  'credits/purchase': () => import('../routes/credits/purchase.js'),
  device: () => import('../routes/device.js'),
  heroes: () => import('../routes/heroes/index.js'),
  'heroes/package': () => import('../routes/heroes/package.js'),
  'heroes/search': () => import('../routes/heroes/search.js'),
  'payments/webhook': () => import('../routes/payments/webhook.js'),
  'photos/upload': () => import('../routes/photos/upload.js'),
  pieces: () => import('../routes/pieces/index.js'),
}

/**
 * The route key of a request: /api/heroes/search?q=x is "heroes/search". On Vercel the rewrite delivers the route in
 * `__route`, since the function may see its own path; locally the path itself carries it.
 */
export function routeKey(url: string): string {
  const parsed = new URL(url)
  const rewritten = parsed.searchParams.get('__route')
  return (rewritten ?? parsed.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '')
}

export async function dispatch(request: Request): Promise<Response> {
  const load = ROUTES[routeKey(request.url)]
  if (!load) return Response.json({ error: 'no such route' }, { status: 404 })
  const handler = METHODS.has(request.method) ? (await load())[request.method] : undefined
  if (typeof handler !== 'function') return Response.json({ error: 'method not allowed' }, { status: 405 })
  return (handler as Handler)(request)
}

export const GET = dispatch
export const POST = dispatch
export const PUT = dispatch
export const DELETE = dispatch
