/**
 * The clip audit (docs/plans/2026-11-05-session-1-handoff.md, step 3): scores every clip the game can play, as the game
 * plays it, on the bodies the session named, and every other clip in the library on the medium bodies so a failing
 * clip's replacement can be named from numbers. Writes .scratch/clip-audit/scores.json.
 *
 *     npx tsx scripts/clip-audit.ts [--no-bench] [--also <names.json>]
 *
 * --no-bench leaves out joint limits and skin through itself; --also scores the clips a JSON list names on every body,
 * as if they were in use, so a replacement passes the same bar as the clip it replaces.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Gender } from '../src/charter/look.js'
import { libraryMoves } from '../src/arena/client/library-gait.js'
import { animIndex } from '../src/arena/client/anim-index.js'
import { auditBody, fileClip, kinematics, onBody, readIndex, type AuditBody, type Kinematics } from '../src/kit/bench/clip-audit.js'
import { clipManifest, isPlayed } from '../src/kit/bench/clip-manifest.js'
import { AUDIT_BODIES } from '../src/kit/bench/clips.js'
import { benchArchetype, type ClipScore } from '../src/kit/bench/physique-bench.js'

const OUT = '.scratch/clip-audit'
const withBench = !process.argv.includes('--no-bench')
const alsoAt = process.argv.indexOf('--also')
const also = new Set<string>(alsoAt < 0 ? [] : JSON.parse(readFileSync(process.argv[alsoAt + 1], 'utf8')))

// the library's fetches read the public folder: the moves below come out as the game cuts them
globalThis.fetch = (async (url: string) => {
  const body = readFileSync(`public${url}`, 'utf8')
  return { ok: true, status: 200, json: async () => JSON.parse(body) }
}) as unknown as typeof fetch

const BODIES = AUDIT_BODIES

const idx = readIndex()
await animIndex('standard')
const stances = Object.keys(idx.genders.m.sets.idle).concat(Object.keys(idx.genders.m.sets.fidget))
const manifest = clipManifest(stances)
const has = (g: Gender, clip: string) => !!idx.genders[g]?.tags?.[clip]
const library = Object.keys(idx.genders.m.tags!)

interface Row {
  clip: string
  source?: string
  loop: boolean
  uses: ReturnType<typeof clipManifest> extends Map<string, infer U> ? U : never
  played: boolean
  missing: Gender[]
  /** The file's numbers, body by body. */
  bodies: Record<string, Kinematics>
  bench: Record<string, Pick<ClipScore, 'raw' | 'fixed' | 'footSlide' | 'ground'>>
}
const rows = new Map<string, Row>()
for (const clip of new Set([...manifest.keys(), ...library])) {
  const uses = manifest.get(clip) ?? []
  rows.set(clip, { clip, source: idx.sources?.[clip], loop: idx.genders.m.tags?.[clip]?.loop ?? false, uses, played: isPlayed(uses), missing: (['m', 'f'] as const).filter((g) => !has(g, clip)), bodies: {}, bench: {} })
}

/** The engine's moves as they play, cut and turned, by engine name, with their numbers on the medium bodies. */
const moves: Record<string, Record<string, Kinematics>> = {}

const start = Date.now()
for (const spec of BODIES) {
  const body: AuditBody = await auditBody(spec.label, spec, idx)
  const stanceFile = fileClip('idle', spec.gender, idx)
  const stance = onBody(stanceFile, body, idx)
  const medium = spec.label.endsWith('medium')
  const clips = [...rows.values()].filter((row) => has(spec.gender, row.clip) && (medium || row.uses.length || also.has(row.clip)))
  for (const row of clips) {
    const tags = idx.genders[spec.gender]!.tags![row.clip]
    row.bodies[spec.label] = kinematics(onBody(fileClip(row.clip, spec.gender, idx), body, idx), body, idx, tags, stance)
  }
  if (medium) {
    const played = await libraryMoves(spec.gender, 'standard')
    for (const [move, clip] of played) {
      const k = kinematics(onBody(clip, body, idx), body, idx, undefined, stance)
      ;(moves[move] ??= {})[spec.label] = k
    }
  }
  console.log(`${spec.label}: ${clips.length} clips, ${((Date.now() - start) / 1000).toFixed(0)} s`)
  if (withBench) {
    const named = Object.fromEntries(clips.filter((row) => row.uses.length || also.has(row.clip)).map((row) => [row.clip, row.clip]))
    const scored = await benchArchetype(spec.id, named, spec)
    for (const [clip, score] of Object.entries(scored.clips)) if (score !== 'missing') rows.get(clip)!.bench[spec.label] = { raw: score.raw, fixed: score.fixed, footSlide: score.footSlide, ground: score.ground }
    console.log(`${spec.label}: bench, ${((Date.now() - start) / 1000).toFixed(0)} s`)
  }
}

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/scores.json`, JSON.stringify({ when: new Date().toISOString(), bodies: BODIES.map((b) => ({ label: b.label, preset: b.id })), rows: [...rows.values()], moves }))
console.log(`${rows.size} clips, ${[...rows.values()].filter((r) => r.played).length} played, ${[...rows.values()].filter((r) => r.uses.length).length} in the tables`)
