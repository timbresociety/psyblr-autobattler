/**
 * Generated heroes for the game: each rigged mesh the owner made (the list and files under .scratch/tripo-in, where
 * the generator's exports are kept) is copied to public/heroes/generated with its textures shrunk to 2K webp, and
 * index.json lists them for the game to find (src/kit/bench/hero-file.ts `triedHeroes`). The mesh and its rig are
 * left as they are: only the pictures change, which are most of a generated file's weight.
 *
 *     node scripts/generated-heroes.mjs [--only john,large-john] [--size 2048]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const SRC = '.scratch/tripo-in'
const OUT = 'public/heroes/generated'
const SIZE = Number(arg('size', '2048'))
const ONLY = arg('only', '')?.split(',').filter(Boolean)
const WEBP = 'EXT_texture_webp'

/** A .glb's JSON and its binary chunk. */
function read(path) {
  const file = readFileSync(path)
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a .glb`)
  const jsonLength = file.readUInt32LE(12)
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'))
  const binAt = 20 + jsonLength
  const bin = binAt < file.length ? file.subarray(binAt + 8, binAt + 8 + file.readUInt32LE(binAt)) : Buffer.alloc(0)
  return { json, bin }
}

/** The same file with each embedded picture as a webp no larger than SIZE on a side. */
async function shrunk(path) {
  const { json, bin } = read(path)
  const views = json.bufferViews ?? []
  const bytes = views.map((v) => bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength))
  for (const image of json.images ?? []) {
    if (image.bufferView === undefined) continue
    bytes[image.bufferView] = await sharp(bytes[image.bufferView]).resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer()
    image.mimeType = 'image/webp'
  }
  for (const texture of json.textures ?? []) {
    if (texture.source === undefined) continue
    texture.extensions = { ...texture.extensions, [WEBP]: { source: texture.source } }
    delete texture.source
  }
  for (const list of ['extensionsUsed', 'extensionsRequired']) json[list] = [...new Set([...(json[list] ?? []), WEBP])]
  // every view laid down again, each on a four-byte boundary
  const parts = []
  let at = 0
  views.forEach((v, k) => {
    const pad = (4 - (at % 4)) % 4
    if (pad) parts.push(Buffer.alloc(pad))
    at += pad
    v.byteOffset = at
    v.byteLength = bytes[k].length
    parts.push(bytes[k])
    at += bytes[k].length
  })
  const tail = (4 - (at % 4)) % 4
  if (tail) parts.push(Buffer.alloc(tail))
  const body = Buffer.concat(parts)
  json.buffers = [{ byteLength: body.length }]
  let text = Buffer.from(JSON.stringify(json), 'utf8')
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)])
  const head = Buffer.alloc(12)
  head.writeUInt32LE(0x46546c67, 0)
  head.writeUInt32LE(2, 4)
  head.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8)
  const chunk = (length, type) => {
    const b = Buffer.alloc(8)
    b.writeUInt32LE(length, 0)
    b.writeUInt32LE(type, 4)
    return b
  }
  return Buffer.concat([head, chunk(text.length, 0x4e4f534a), text, chunk(body.length, 0x004e4942), body])
}

const list = (name) => (existsSync(join(SRC, name)) ? JSON.parse(readFileSync(join(SRC, name), 'utf8')) : [])
// a hero with a kit of its own first, as the game lists them
const local = list('try.json')
const heroes = [...local, ...list('audit.json').filter((h) => !local.some((l) => l.label === h.label))].filter((h) => h.file && (!ONLY?.length || ONLY.includes(h.label)))
mkdirSync(OUT, { recursive: true })
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : []
for (const hero of heroes) {
  const put = async (file, name) => {
    const out = await shrunk(join(SRC, file))
    writeFileSync(join(OUT, name), out)
    console.log(`${name}: ${(readFileSync(join(SRC, file)).length / 1048576).toFixed(1)} MB -> ${(out.length / 1048576).toFixed(1)} MB`)
    return name
  }
  const entry = { ...hero, file: await put(hero.file, `${hero.label}.glb`) }
  if (hero.form) entry.form = { ...hero.form, file: await put(hero.form.file, `${hero.label}-form.glb`) }
  const k = index.findIndex((h) => h.label === hero.label)
  if (k >= 0) index[k] = entry
  else index.push(entry)
}
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 1)}\n`)
console.log(`${index.length} heroes in ${OUT}/index.json`)
