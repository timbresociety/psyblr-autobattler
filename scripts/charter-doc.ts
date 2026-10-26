import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { charterDoc } from '../src/docs/charter-doc.js'

// Writes the master character charter from the code: npx tsx scripts/charter-doc.ts
const out = join(import.meta.dirname, '..', 'docs', 'charter', 'character-charter.html')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, charterDoc())
console.log(`wrote ${out}`)
