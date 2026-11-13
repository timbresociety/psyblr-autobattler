/**
 * Stacks contact sheets one under another, each under its own name, so several clips can be read side by side:
 *
 *     node scripts/stack-sheets.mjs out.jpg a.jpg b.jpg ...
 */
import { basename } from 'node:path'
import sharp from 'sharp'

const [out, ...files] = process.argv.slice(2)
const BAR = 22
const parts = await Promise.all(files.map(async (file) => ({ file, meta: await sharp(file).metadata() })))
const width = Math.max(...parts.map((p) => p.meta.width))
let top = 0
const layers = []
for (const { file, meta } of parts) {
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR}"><rect width="${width}" height="${BAR}" fill="#2a3140"/><text x="8" y="16" font-family="Menlo, monospace" font-size="14" fill="#ffd27a">${basename(file).replace(/\.jpg$/, '')}</text></svg>`)
  layers.push({ input: label, left: 0, top }, { input: file, left: 0, top: top + BAR })
  top += BAR + meta.height
}
await sharp({ create: { width, height: top, channels: 3, background: '#10131a' } }).composite(layers).jpeg({ quality: 82 }).toFile(out)
