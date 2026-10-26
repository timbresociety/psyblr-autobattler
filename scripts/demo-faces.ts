import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { irisColour, skinColour } from '../src/arena/client/face/patch.js'
import type { Pt } from '../src/arena/client/face/warp.js'
import { toHex } from '../src/charter/look.js'

// The demo heroes' photo faces as their looks wear them: npx tsx scripts/demo-faces.ts
// Each portrait (public/kit/faces/<id>.webp) with the landmarks tools/textures/landmarks.py measured on it
// (tools/blender/portraits/<id>.lm.json) to the pixel, and the skin and eye colours read off it the way the Forge reads
// a player's photo (src/ui/forge/face/find.ts).
const root = join(import.meta.dirname, '..')
const faces = join(root, 'public', 'kit', 'faces')
const out: string[] = []
for (const file of readdirSync(faces).filter((f) => f.endsWith('.webp')).sort()) {
  const id = file.slice(0, -'.webp'.length)
  const lm = JSON.parse(readFileSync(join(root, 'tools', 'blender', 'portraits', `${id}.lm.json`), 'utf8')) as { width: number; height: number; points: number[][] }
  const { data, info } = await sharp(join(faces, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== lm.width || info.height !== lm.height) throw new Error(`${id}: the portrait is ${info.width}×${info.height}, its landmarks ${lm.width}×${lm.height}`)
  const img = { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) }
  const points: Pt[] = lm.points.map((p) => [p[0], p[1]])
  const iris = irisColour(img, points)
  const face = { width: lm.width, height: lm.height, skin: toHex(skinColour(img, points)), ...(iris ? { iris: toHex(iris) } : {}), points: points.flatMap(([x, y]) => [Math.round(x), Math.round(y)]) }
  out.push(`${JSON.stringify(id)}:${JSON.stringify(face)}`)
}
const path = join(root, 'src', 'arena', 'demo', 'faces.json')
writeFileSync(path, `{\n${out.join(',\n')}\n}\n`)
console.log(`wrote ${out.length} faces to ${path}`)
