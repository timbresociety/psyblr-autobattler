import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PALETTE, paintKey, traversal } from '../../src/arena/client/greybox.js'
import { INDOOR } from '../../src/arena/client/sky.js'
import { HALL } from '../../src/arena/client/hall.js'
import { arenaExtent } from '../../src/arena/engine/cover.js'
import { MAPS } from '../../src/arena/engine/maps.js'

/**
 * The House of Instinct's pieces, as the engine has them, for tools/blender/house.py to dress and bake (docs/ENGINE.md,
 * the Blender pipeline). Collision stays the engine's; the art is built from the same numbers so the two can't drift.
 *
 *     npx tsx tools/blender/house-export.ts [out.json]
 */
const out = process.argv[2] ?? join(import.meta.dirname, 'build', 'house.json')
const pieces = MAPS.house.pieces.map((p, index) => ({
  index,
  shape: p.shape,
  base: p.base,
  top: p.top,
  slope: p.slope,
  look: p.look,
  breakable: !!p.health,
  trim: traversal(p) && !p.health,
  paint: paintKey(p, index).key,
  // how far the grey box lowers that colour, so the bake keeps its tones
  tone: paintKey(p, index).k,
}))
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`
mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  JSON.stringify({
    pieces,
    palette: Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, hex(v)])),
    extent: arenaExtent(MAPS.house.pieces),
    floor: HALL.floor,
    // the live lights the bake must agree with (client/sky.ts INDOOR): the key stays live, the fill is baked
    light: { key: hex(INDOOR.key), keyIntensity: INDOOR.keyIntensity, from: INDOOR.from.toArray(), above: hex(INDOOR.above), below: hex(INDOOR.below), fill: INDOOR.fill },
  }),
)
console.log(`wrote ${pieces.length} pieces to ${out}`)
