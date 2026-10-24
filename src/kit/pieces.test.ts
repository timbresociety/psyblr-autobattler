import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GEAR_SLOTS } from '../charter/look.js'
import { BODIES } from '../arena/client/character-look.js'
import { BUILT_IN, fits, slotFor } from './pieces.js'

const pub = (path: string) => new URL(`../../public${path}`, import.meta.url)

/** The node names in a GLB's JSON chunk. */
function nodeNames(path: URL): string[] {
  const buf = readFileSync(path)
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { nodes: { name?: string }[] }
  return json.nodes.map((n) => n.name ?? '')
}

describe('the kit', () => {
  it('ships every built-in piece with its model and thumbnail', () => {
    expect(BUILT_IN.length).toBeGreaterThanOrEqual(20)
    for (const p of BUILT_IN) {
      expect(existsSync(pub(p.url)), p.url).toBe(true)
      expect(existsSync(pub(p.thumb)), p.thumb).toBe(true)
      expect(fits(p.kind, slotFor(p.kind))).toBe(true)
    }
    expect(new Set(BUILT_IN.map((p) => p.id)).size).toBe(BUILT_IN.length)
  })

  it('gives every body all five sockets, each on a bone the body has', () => {
    for (const body of BODIES) {
      const kit = JSON.parse(readFileSync(pub(`/heroes/${body}.kit.json`), 'utf8')) as { sockets: Record<string, { bone: string; pos: number[] }>; landmarks: unknown[] }
      expect(Object.keys(kit.sockets).sort(), body).toEqual([...GEAR_SLOTS].sort())
      const bones = new Set(nodeNames(pub(`/heroes/${body}.glb`)))
      for (const s of Object.values(kit.sockets)) {
        expect(bones.has(s.bone), `${body} ${s.bone}`).toBe(true)
        expect(s.pos).toHaveLength(3)
      }
      expect(kit.landmarks).toHaveLength(478)
    }
  })
})
