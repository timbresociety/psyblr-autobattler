import { toHex, type LookColor } from '../../charter/look.js'
import type { FaceFinding } from './face/find.js'

type Rgb = readonly [number, number, number]
type Box = [number, number, number, number]

const SIDE = 160
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** A box's colours, commonest first: a coarse 8-level histogram, each bin averaged, skipping pixels close to `skip`. */
function bins(data: Uint8ClampedArray, width: number, [x0, y0, x1, y1]: Box, skip: Rgb[]): { rgb: Rgb; count: number }[] {
  const sums = new Map<number, [number, number, number, number]>()
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 200) continue
      const px: Rgb = [data[i], data[i + 1], data[i + 2]]
      if (skip.some((s) => dist(s, px) < 45)) continue
      const key = ((px[0] >> 5) << 6) | ((px[1] >> 5) << 3) | (px[2] >> 5)
      const sum = sums.get(key) ?? [0, 0, 0, 0]
      sum[0] += px[0]
      sum[1] += px[1]
      sum[2] += px[2]
      sum[3]++
      sums.set(key, sum)
    }
  }
  return [...sums.values()].map(([r, g, b, n]) => ({ rgb: [r / n, g / n, b / n] as Rgb, count: n })).sort((a, b) => b.count - a.count)
}

const clamp = ([x0, y0, x1, y1]: Box, w: number, h: number): Box => [Math.max(0, Math.round(x0)), Math.max(0, Math.round(y0)), Math.min(w, Math.round(x1)), Math.min(h, Math.round(y1))]
const area = ([x0, y0, x1, y1]: Box) => Math.max(0, x1 - x0) * Math.max(0, y1 - y0)

/**
 * The outfit's colours on a reference image, for the offline reading: below the face where there is one (the top, then
 * the trousers further down), the middle of the picture where there isn't. Skin and hair are left out, so a bare arm
 * never reads as a sleeve.
 */
export async function outfitColours(image: Blob, face?: FaceFinding): Promise<Partial<Record<LookColor, string>>> {
  const bitmap = await createImageBitmap(image)
  try {
    const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return {}
    ctx.drawImage(bitmap, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    let torso: Box = [w * 0.25, h * 0.38, w * 0.75, h * 0.68]
    let legs: Box = [w * 0.3, h * 0.72, w * 0.7, h * 0.95]
    if (face?.points.length) {
      const k = w / face.width
      const xs = face.points.map(([x]) => x * k)
      const ys = face.points.map(([, y]) => y * k)
      const [minX, maxX, maxY] = [Math.min(...xs), Math.max(...xs), Math.max(...ys)]
      const fw = maxX - minX
      const fh = maxY - Math.min(...ys)
      const cx = (minX + maxX) / 2
      torso = [cx - 1.6 * fw, maxY + 0.35 * fh, cx + 1.6 * fw, maxY + 2.8 * fh]
      legs = [cx - 1.2 * fw, maxY + 3.1 * fh, cx + 1.2 * fw, maxY + 5 * fh]
    }
    const skip: Rgb[] = []
    if (face?.skin) skip.push(face.skin)
    if (face?.hair) skip.push(face.hair)
    const out: Partial<Record<LookColor, string>> = {}
    const top = clamp(torso, w, h)
    if (area(top) >= 40) {
      const [suit, ...rest] = bins(data, w, top, skip)
      if (suit) {
        out.suit = toHex(suit.rgb.map(Math.round) as [number, number, number])
        const trim = rest.find((b) => b.count >= suit.count * 0.12 && dist(b.rgb, suit.rgb) >= 70)
        if (trim) out.trim = toHex(trim.rgb.map(Math.round) as [number, number, number])
      }
    }
    const bottom = clamp(legs, w, h)
    if (area(bottom) >= 40) {
      const [pants] = bins(data, w, bottom, skip)
      if (pants) out.pants = toHex(pants.rgb.map(Math.round) as [number, number, number])
    }
    return out
  } finally {
    bitmap.close()
  }
}
