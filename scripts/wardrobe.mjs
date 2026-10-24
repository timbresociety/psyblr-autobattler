#!/usr/bin/env node
// Bundles the wardrobe fit (tools/wardrobe/fit.ts) with esbuild and runs it on Node.
// Usage: npm run wardrobe -- .scratch/wardrobe [--only tee,kimono]
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const outdir = 'node_modules/.cache/wardrobe'
mkdirSync(outdir, { recursive: true })
const outfile = `${outdir}/fit.mjs`
await build({
  entryPoints: ['tools/wardrobe/fit.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  outfile,
  logLevel: 'warning',
})
const r = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(r.status ?? 1)
