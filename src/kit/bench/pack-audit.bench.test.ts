import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditBody, readIndex } from './clip-audit.js'
import { PACK_DIR, measure, packBench, readPack, verdict, type PackNumbers } from './pack-audit.js'

/**
 * The whole motion pack measured, clip by clip (pack-audit.ts). It runs only when asked and only where the pack is:
 *
 *     PACK_AUDIT=1 npx vitest run src/kit/bench/pack-audit.bench.test.ts
 *
 * and writes `.scratch/motion-pack-audit/clips.json`, local like the pack itself.
 */
const OUT = '.scratch/motion-pack-audit'
const asked = !!process.env.PACK_AUDIT && existsSync(`${PACK_DIR}/animation-index.json`)

describe.runIf(asked)('the motion pack, every clip', () => {
  it('opens, fits the medium body and plays through', async () => {
    const idx = readIndex()
    const bench = packBench(await auditBody('m-medium', { gender: 'm', body: 'medium', dials: { weight: 0.5, muscle: 0.5, age: 0 } }, idx), idx)
    const pack = readPack()
    const only = process.env.PACK_ONLY ? new RegExp(process.env.PACK_ONLY) : undefined
    const out: (PackNumbers & { caught: string[] })[] = []
    const failed: string[] = []
    for (const entry of pack.clips) {
      if (only && !only.test(entry.id)) continue
      try {
        const n = measure(bench, entry)
        out.push({ ...n, caught: verdict(n) })
      } catch (e) {
        failed.push(`${entry.id}: ${String((e as Error)?.message ?? e)}`)
      }
    }
    mkdirSync(OUT, { recursive: true })
    writeFileSync(`${OUT}/${only ? 'clips-part' : 'clips'}.json`, JSON.stringify({ stand: Object.fromEntries(Object.entries(bench.stand).map(([k, v]) => [k, v.toArray().map((x) => +x.toFixed(3))])), failed, clips: out }))
    console.log(`${out.length} clips measured, ${failed.length} could not be read, ${out.filter((c) => c.caught.length).length} with something caught`)
    expect(out.length + failed.length).toBe(only ? out.length + failed.length : pack.clips.length)
  }, 1_800_000)
})
