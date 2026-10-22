import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

/**
 * Development only: serve api/*.ts through Vite so the Forge runs end to end without Vercel (KTD3 offline path).
 * Uses an in-memory PGlite database and forces fake providers, so no live or paid call can happen.
 */
export function devApi(): Plugin {
  return {
    name: 'psyblr-dev-api',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return
      process.env.FORGE_FAKE_PROVIDERS = '1'
      let ready: Promise<void> | undefined
      const setup = () =>
        (ready ??= (async () => {
          const { PGlite } = await import('@electric-sql/pglite')
          const dbModule = (await server.ssrLoadModule('/src/server/db.ts')) as typeof import('../src/server/db')
          const pg = new PGlite()
          await pg.exec(dbModule.SCHEMA_SQL)
          dbModule.useDevDb(Promise.resolve(pg as unknown as import('../src/server/db').Db))
        })())
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        handle(server, setup, req, res).catch((error) => {
          console.error(error)
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'dev api crashed' }))
        })
      })
    },
  }
}

async function handle(server: ViteDevServer, setup: () => Promise<void>, req: IncomingMessage, res: ServerResponse) {
  await setup()
  const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`)
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '')
  const fs = await import('node:fs')
  const file = [`/api/${route}.ts`, `/api/${route}/index.ts`].find((f) => fs.existsSync(`${server.config.root}${f}`))
  if (!file || route.includes('..')) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'no such route' }))
    return
  }
  const mod = (await server.ssrLoadModule(file)) as Record<string, (request: Request) => Promise<Response>>
  const method = req.method ?? 'GET'
  const fn = mod[method]
  if (!fn) {
    res.statusCode = 405
    res.end()
    return
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  headers.set('x-forwarded-for', '127.0.0.1')
  const response = await fn(new Request(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks) }))
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}
