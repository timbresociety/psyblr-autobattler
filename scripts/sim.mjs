#!/usr/bin/env node
// Bundles the balance CLI (src/sim/cli.ts) with esbuild and runs it on Node.
// Usage: npm run sim -- --samples 60 --army-seeds 10 --seed 7
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const outdir = 'node_modules/.cache/sim'
mkdirSync(outdir, { recursive: true })
const outfile = `${outdir}/cli.mjs`
await build({
  entryPoints: ['src/sim/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'warning',
})
const r = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(r.status ?? 1)
