import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES, dispatch, routeKey } from '../api/[...path].js'

/** Every route module under routes/, keyed the way its URL reads: routes/builds/index.ts serves /api/builds. */
function routeModules(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return routeModules(path, root)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return [relative(root, path).replace(/\.ts$/, '').replace(/\/index$/, '')]
  })
}

describe('one function serves every route', () => {
  it('every route module is reachable, and nothing else is', () => {
    expect(Object.keys(ROUTES).sort()).toEqual(routeModules(join(import.meta.dirname, '.')).sort())
  })

  it('reads the route from the path', () => {
    expect(routeKey('https://x.test/api/heroes/search?q=jen')).toBe('heroes/search')
    expect(routeKey('https://x.test/api/builds/')).toBe('builds')
    expect(routeKey('https://x.test/api/device')).toBe('device')
  })

  it('an unknown route is a 404 and a method the route lacks is a 405', async () => {
    expect((await dispatch(new Request('https://x.test/api/nope'))).status).toBe(404)
    expect((await dispatch(new Request('https://x.test/api/device', { method: 'GET' }))).status).toBe(405)
  })
})
