/**
 * How far each keyed joint turns across the clip library (public/anim/standard), as swing-twist from each gender's
 * rest (src/kit/rig/swing-twist.ts). The joint-limit table (src/kit/rig/limits.ts) is checked against this: no clean
 * motion-capture clip may break a limit. A gated source's clips (CMU) are held to the table instead of measured into it.
 *
 *   npx tsx scripts/joint-ranges.ts [--clips]     (--clips: the clips that reach each extreme)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { Quaternion } from 'three'
import { swingTwist } from '../src/kit/rig/swing-twist.js'
import { SOURCES } from '../src/kit/anim/sources.js'

const DIR = 'public/anim/standard'
const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')) as { bones: string[]; rot: number; genders: Record<string, { rest: number[][] }>; sources?: Record<string, string> }
// a gated source's clips are held to the limits (src/kit/anim/sources.ts), so they don't set them
const gated = new Set(Object.entries(SOURCES).filter(([, s]) => s.gate !== undefined).map(([id]) => id))
const bones = index.bones
type Range = { min: number; max: number; minClip: string; maxClip: string; values: number[] }
const ranges = new Map<string, Record<'twist' | 'x' | 'z', Range>>()
const fresh = (): Range => ({ min: Infinity, max: -Infinity, minClip: '', maxClip: '', values: [] })

for (const g of Object.keys(index.genders)) {
  const rest = index.genders[g].rest.map((r) => new Quaternion().fromArray(r).invert())
  for (const file of readdirSync(`${DIR}/${g}`)) {
    if (gated.has(index.sources?.[file.replace(/\.json$/, '')] ?? '')) continue
    const clip = JSON.parse(readFileSync(`${DIR}/${g}/${file}`, 'utf8')) as { frames: number; rot: number[] }
    const n = clip.frames
    const tracks = clip.rot.length / (n * 4)
    // undo the per-track frame-to-frame deltas
    const vals = new Float32Array(clip.rot.length)
    let at = 0
    for (let k = 0; k < tracks; k++)
      for (let c = 0; c < 4; c++) {
        let v = 0
        for (let f = 0; f < n; f++) {
          v += clip.rot[at++]
          vals[(f * tracks + k) * 4 + c] = v / index.rot
        }
      }
    const q = new Quaternion()
    for (let k = 0; k < tracks; k++) {
      const name = bones[k]
      let r = ranges.get(name)
      if (!r) ranges.set(name, (r = { twist: fresh(), x: fresh(), z: fresh() }))
      for (let f = 0; f < n; f++) {
        q.fromArray(vals, (f * tracks + k) * 4).normalize()
        const st = swingTwist(rest[k].clone().multiply(q))
        for (const axis of ['twist', 'x', 'z'] as const) {
          const v = st[axis]
          const a = r[axis]
          a.values.push(v)
          if (v < a.min) (a.min = v), (a.minClip = `${g}/${file}`)
          if (v > a.max) (a.max = v), (a.maxClip = `${g}/${file}`)
        }
      }
    }
  }
}

const pct = (vs: number[], p: number) => {
  const s = [...vs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]
}
const out: Record<string, Record<string, [number, number, number, number]>> = {}
for (const [name, r] of ranges) {
  out[name] = {}
  for (const axis of ['twist', 'x', 'z'] as const) {
    const a = r[axis]
    out[name][axis] = [Math.round(a.min), Math.round(pct(a.values, 0.5)), Math.round(pct(a.values, 99.5)), Math.round(a.max)]
    if (process.argv.includes('--clips')) console.log(`${name.padEnd(18)} ${axis.padEnd(5)} min ${a.min.toFixed(0).padStart(5)} (${a.minClip})  max ${a.max.toFixed(0).padStart(5)} (${a.maxClip})`)
  }
}
console.log(JSON.stringify(out))

// --write: the joint-limit table (src/kit/rig/limits.json). Each side takes the union of both sides' ranges, mirrored
// (the right side's twist and Z swing run the other way), widened by MARGIN and rounded out to 5°. The hips are free
// (they carry the whole body) and the eyes are the look code's, so neither is limited here.
if (process.argv.includes('--write')) {
  const MARGIN = 10
  const mirror = (n: string) => (n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n)
  const flip = (axis: string) => axis !== 'x'
  const table: Record<string, Record<string, [number, number]>> = {}
  for (const name of bones) {
    if (name === 'Hips' || name.endsWith('Eye')) continue
    const own = ranges.get(name)!
    const other = ranges.get(mirror(name))!
    table[name] = {}
    for (const axis of ['twist', 'x', 'z'] as const) {
      const o = other[axis]
      const [omin, omax] = mirror(name) === name || !flip(axis) ? [o.min, o.max] : [-o.max, -o.min]
      const lo = Math.max(-180, Math.floor((Math.min(own[axis].min, omin) - MARGIN) / 5) * 5)
      const hi = Math.min(180, Math.ceil((Math.max(own[axis].max, omax) + MARGIN) / 5) * 5)
      table[name][axis] = [lo, hi]
    }
  }
  const { writeFileSync } = await import('node:fs')
  writeFileSync('src/kit/rig/limits.json', JSON.stringify({ margin: MARGIN, source: 'scripts/joint-ranges.ts over public/anim/standard', limits: table }, null, 0).replace(/\],"/g, '],\n"'))
  console.error(`wrote ${Object.keys(table).length} joints`)
}
