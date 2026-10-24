import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve, sep } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'

/** The dev store (src/server/dev-store.ts). Kept here too, so Vite's config bundle pulls in no server code; a test checks they match. */
export const DEV_STORE_DIR = join(process.cwd(), '.dev-store')
export const DEV_STORE_PATH = '/dev-store/'

/**
 * Development only: serve /api through Vite, via the same router function Vercel runs (api/router.ts), so the
 * Forge runs end to end without Vercel (KTD3 offline path).
 * Forces fake providers, so no live or paid call can happen. The database is PGlite kept on disk in the dev store,
 * so heroes and device IDs survive a restart; uploads are stored there too and served from /dev-store/.
 */
export function devApi(): Plugin {
  return {
    name: 'psyblr-dev-api',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return
      process.env.FORGE_FAKE_PROVIDERS = '1'
      // the dev server never touches live storage, even when `vercel env pull` has put production credentials in .env.local
      delete process.env.BLOB_READ_WRITE_TOKEN
      delete process.env.DATABASE_URL
      let ready: Promise<void> | undefined
      const setup = () =>
        (ready ??= (async () => {
          const dbModule = (await server.ssrLoadModule('/src/server/db.ts')) as typeof import('../src/server/db')
          dbModule.useDevDb(devDatabase(dbModule.SCHEMA_SQL))
          await dbModule.getDb()
        })())
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith(DEV_STORE_PATH)) {
          serveStored(req, res).catch(() => {
            res.statusCode = 500
            res.end()
          })
          return
        }
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

type Db = import('../src/server/db').Db

/**
 * One database per process: Vite re-runs this plugin when its config changes, and two PGlite instances on the same
 * directory would corrupt it, so the instance lives on globalThis and every restart reuses it.
 */
function devDatabase(schema: string): Promise<Db> {
  const g = globalThis as { __psyblrDevDb?: Promise<Db> }
  g.__psyblrDevDb ??= (async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const dir = join(DEV_STORE_DIR, 'pglite')
    mkdirSync(dir, { recursive: true })
    const pg = new PGlite(dir)
    await pg.exec(schema)
    return pg as unknown as Db
  })()
  return g.__psyblrDevDb
}

const IMAGE_TYPES: [number[], string][] = [
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  [[0x52, 0x49, 0x46, 0x46], 'image/webp'],
  // a generated piece's model (src/server/pieces.ts)
  [[0x67, 0x6c, 0x54, 0x46], 'model/gltf-binary'],
]

/** A file from the dev store (a photo or a generated piece), typed by its bytes; nothing outside the store can be reached. */
async function serveStored(req: IncomingMessage, res: ServerResponse) {
  const path = decodeURIComponent(new URL(req.url!, 'http://dev').pathname.slice(DEV_STORE_PATH.length))
  const root = resolve(DEV_STORE_DIR)
  const file = resolve(root, path)
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !file.startsWith(root + sep) || file.startsWith(join(root, 'pglite') + sep)) {
    res.statusCode = 404
    res.end()
    return
  }
  const bytes = await readFile(file).catch(() => undefined)
  if (!bytes) {
    res.statusCode = 404
    res.end()
    return
  }
  const type = IMAGE_TYPES.find(([magic]) => magic.every((b, i) => bytes[i] === b))?.[1] ?? 'application/octet-stream'
  res.setHeader('content-type', type)
  res.setHeader('cache-control', 'no-cache')
  res.end(req.method === 'HEAD' ? undefined : bytes)
}

async function handle(server: ViteDevServer, setup: () => Promise<void>, req: IncomingMessage, res: ServerResponse) {
  await setup()
  const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`)
  // the same router function Vercel runs, so local requests take the production path
  const api = (await server.ssrLoadModule('/api/router.ts')) as { dispatch: (request: Request) => Promise<Response> }
  const method = req.method ?? 'GET'
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  headers.set('x-forwarded-for', '127.0.0.1')
  const response = await api.dispatch(new Request(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks) }))
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}
