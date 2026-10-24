import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fitItem, type FitReport, type RawItem, type RawSpec } from '../../src/kit/fit/fit.js'
import { readReference } from '../../src/kit/fit/reference.js'
import { evaluate } from '../../src/kit/wear/bind.js'
import { writeItem } from '../../src/kit/fit/write.js'
import type { BuiltInItem } from '../../src/kit/wear/library.js'

/**
 * The built-in wardrobe, fitted: every raw item tools/blender/wardrobe.py wrote (a mesh on the reference body, with its
 * channels and paints) bound to the shared surface and written as public/kit/wear/<id>.glb, beside its thumbnail, and
 * the list of them as src/kit/wear/library.gen.ts.
 *
 *   npm run wardrobe -- .scratch/wardrobe [--only tee,kimono]
 *
 * Every item in the catalogue with a raw file is fitted (--only narrows what's written, not what's listed), and the run
 * fails if any item fails its checks, so a broken built-in never ships quietly.
 */

interface Manifest {
  reference: string
  /** [welded vertex, x, y, z]: where Blender's reference body has some of its vertices. */
  check: [number, number, number, number][]
  /** Every item in the catalogue, in its order. */
  catalogue: string[]
}

interface RawFile {
  spec: RawSpec
  positions: number[]
  normals?: number[]
  uv?: number[]
  index: number[]
  channel?: number[]
  hang?: number[]
  len?: number[]
}

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--')) ?? '.scratch/wardrobe'
const onlyAt = args.indexOf('--only')
const only = onlyAt >= 0 ? new Set(args[onlyAt + 1].split(',')) : undefined
const whyAt = args.indexOf('--why')
const why = whyAt >= 0 ? args[whyAt + 1] : undefined
const OUT = 'public/kit/wear'

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest
const ref = await readReference(`public/heroes/${manifest.reference}.glb`, `public/heroes/${manifest.reference}.kit.json`)

// the raw items must sit on the body the game ships, or every binding is off by the difference (up to a millimetre is
// the body file's own position quantisation)
const drift = manifest.check.map(([v, x, y, z]) => ({ v, d: Math.hypot(ref.shape.positions[v * 3] - x, ref.shape.positions[v * 3 + 1] - y, ref.shape.positions[v * 3 + 2] - z) })).sort((a, b) => b.d - a.d)
if (drift[0].d > 1e-3) {
  console.log(`worst: ${drift.slice(0, 6).map((r) => `vertex ${r.v} ${(r.d * 1000).toFixed(2)} mm`).join(', ')}; median ${(drift[drift.length >> 1].d * 1000).toFixed(3)} mm`)
  throw new Error(`Blender's reference body is ${(drift[0].d * 1000).toFixed(2)} mm off public/heroes/${manifest.reference}.glb: rebuild the body or the wardrobe`)
}

const raw = (f: RawFile): RawItem => ({
  spec: f.spec,
  positions: Float32Array.from(f.positions),
  index: Uint32Array.from(f.index),
  ...(f.normals ? { normals: Float32Array.from(f.normals) } : {}),
  ...(f.uv ? { uv: Float32Array.from(f.uv) } : {}),
  ...(f.channel ? { channel: Uint8Array.from(f.channel) } : {}),
  ...(f.hang ? { hang: Float32Array.from(f.hang) } : {}),
  ...(f.len ? { len: Float32Array.from(f.len) } : {}),
})

/** Where an item goes wrong: its worst-bound vertices and those deepest under the skin, with the bone they ride. */
function explain(item: RawItem, fitted: ReturnType<typeof fitItem>['file']) {
  const { binding } = fitted.item
  const back = evaluate(binding, ref.skin)
  const P = item.positions
  const bone = (v: number) => ref.bones[ref.shape.joints[binding.tri[v * 3] * 4]]
  const at = (v: number) => `(${[0, 1, 2].map((d) => P[v * 3 + d].toFixed(3)).join(', ')}) on ${bone(v)}, lift ${(binding.lift[v] * 1000).toFixed(1)} mm`
  const err = Array.from({ length: P.length / 3 }, (_, v) => ({ v, e: Math.hypot(back[v * 3] - P[v * 3], back[v * 3 + 1] - P[v * 3 + 1], back[v * 3 + 2] - P[v * 3 + 2]) }))
  err.sort((a, b) => b.e - a.e)
  console.log(`${item.spec.id}, worst bound:`)
  for (const { v, e } of err.slice(0, 8)) console.log(`  ${v} off by ${(e * 1000).toFixed(1)} mm at ${at(v)}`)
  // facing out from under the skin, as the fit counts them (edges and the slot's dip aside)
  const under = err.map(({ v }) => v).filter((v) => binding.lift[v] < -0.004 && fitted.item.normal[v * 3 + 1] > 0).sort((a, b) => binding.lift[a] - binding.lift[b])
  console.log(`${item.spec.id}, deepest under the skin facing out (${under.length}):`)
  for (const v of under.slice(0, 8)) console.log(`  ${v} at ${at(v)}`)
}

const listed: BuiltInItem[] = []
const reports: FitReport[] = []
const missing: string[] = []
for (const id of manifest.catalogue) {
  const path = join(dir, `${id}.json`)
  if (!existsSync(path)) {
    missing.push(id)
    continue
  }
  const file = JSON.parse(readFileSync(path, 'utf8')) as RawFile
  let fit: ReturnType<typeof fitItem>
  try {
    fit = fitItem(raw(file), ref)
  } catch (e) {
    throw new Error(`${id}: ${(e as Error).message}`)
  }
  const { file: fitted, report } = fit
  if (why === id) explain(raw(file), fitted)
  reports.push(report)
  const { spec } = file
  listed.push({ id, name: spec.name, slot: spec.slot, tags: spec.tags ?? [], channels: spec.channels, knobs: spec.knobs ?? [], tris: report.triangles })
  if (only && !only.has(id)) continue
  writeFileSync(join(OUT, `${id}.glb`), await writeItem(fitted))
  const thumb = join(dir, `${id}.webp`)
  if (existsSync(thumb)) copyFileSync(thumb, join(OUT, `${id}.webp`))
}

const lines = listed.map((i) => `  ${JSON.stringify(i)},`).join('\n')
writeFileSync(
  'src/kit/wear/library.gen.ts',
  `// Generated by tools/wardrobe/fit.ts: the built-in wardrobe every player can wear for free. Edit the builders, not this file.\nimport type { BuiltInItem } from './library.js'\n\nexport const BUILT_IN_ITEMS: readonly BuiltInItem[] = [\n${lines}\n]\n`,
)

const pad = (s: string | number, n: number) => String(s).padEnd(n)
console.log(`${pad('item', 22)}${pad('slot', 7)}${pad('tris', 6)}${pad('buried', 7)}${pad('covers', 8)}${pad('hides', 7)}${pad('chain', 6)}${pad('bind mm', 9)}${pad('under', 7)}coverage`)
for (const r of reports) {
  console.log(`${pad(r.id, 22)}${pad(r.slot, 7)}${pad(r.triangles, 6)}${pad(r.buried, 7)}${pad(r.covered, 8)}${pad(r.hidden, 7)}${pad(r.particles, 6)}${pad((r.bindError * 1000).toFixed(2), 9)}${pad(`${(r.underSkin * 100).toFixed(1)}%`, 7)}${r.coverage.map((c) => `${(c * 100).toFixed(0)}%`).join(' ')}`)
}
if (missing.length) console.log(`not built yet: ${missing.join(', ')}`)
const failed = reports.filter((r) => r.problems.length)
for (const r of failed) console.log(`✗ ${r.id}: ${r.problems.join('; ')}`)
console.log(`${reports.length} items fitted, ${failed.length} failing; wrote ${only ? only.size : reports.length} to ${OUT}`)
process.exit(failed.length ? 1 : 0)
