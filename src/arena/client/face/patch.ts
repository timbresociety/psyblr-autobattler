import { FACE_OVAL, IRISES, SKIN_SAMPLES, WARP } from './landmarks.js'
import { applySimilarity, similarity, tpsFit, type Pt } from './warp.js'

/**
 * A player's photo turned into a face patch for one body, the way tools/blender/humanlib/face.py `face_texture` turns a
 * portrait into the demo heroes' faces: the photo is bent so its landmarks land on the body's own, cut to a feathered
 * oval, and evened out so its studio lighting doesn't fight the arena's. Plain pixel arrays in and out, so it runs in a
 * worker, a test or the main thread alike.
 */

/** RGBA pixels, rows top-down, the layout of an ImageData. */
export interface Rgba {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type Rgb = [number, number, number]

/** A body's face data, from its kit sidecar (public/heroes/<body>.kit.json), written by the Blender pipeline. */
export interface FaceMeta {
  version: 1 | 2
  atlas: number
  /** The front-on head frame: centre (x, z) and width in metres, landmarks in pixels of a res-square patch. */
  frame: { cx: number; cz: number; size: number; res: number }
  landmarks: (Pt | null)[]
}

export interface FacePatch {
  /** res×res, alpha the feathered face oval. */
  patch: Rgba
  /** sRGB 0 to 1, measured on the photo. */
  skin: Rgb
  hair?: Rgb
  iris?: Rgb
}

const LUM: Rgb = [0.3, 0.59, 0.11]
const lum = (r: number, g: number, b: number) => r * LUM[0] + g * LUM[1] + b * LUM[2]
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** One channel triple of the photo at a fractional pixel, 0 to 1. */
function sample(img: Rgba, x: number, y: number, out: Float32Array, at = 0) {
  const w = img.width
  const h = img.height
  const cx = clamp(x, 0, w - 1.001)
  const cy = clamp(y, 0, h - 1.001)
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const fx = cx - x0
  const fy = cy - y0
  const d = img.data
  const i00 = (y0 * w + x0) * 4
  const i10 = i00 + 4
  const i01 = i00 + w * 4
  const i11 = i01 + 4
  for (let c = 0; c < 3; c++) {
    const top = d[i00 + c] * (1 - fx) + d[i10 + c] * fx
    const bottom = d[i01 + c] * (1 - fx) + d[i11 + c] * fx
    out[at + c] = (top * (1 - fy) + bottom * fy) / 255
  }
}

/** Three passes of a separable box blur (close to a gaussian), in place on a res×res field. */
export function blur(field: Float32Array, res: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius))
  const tmp = new Float32Array(field.length)
  for (let pass = 0; pass < 3; pass++) {
    for (const horizontal of [true, false]) {
      for (let line = 0; line < res; line++) {
        let acc = 0
        const at = (k: number) => {
          const kk = clamp(k, 0, res - 1)
          return horizontal ? field[line * res + kk] : field[kk * res + line]
        }
        for (let k = -r; k <= r; k++) acc += at(k)
        for (let k = 0; k < res; k++) {
          const idx = horizontal ? line * res + k : k * res + line
          tmp[idx] = acc / (2 * r + 1)
          acc += at(k + r + 1) - at(k - r)
        }
      }
      field.set(tmp)
    }
  }
  return field
}

/** A filled polygon on a res×res field (even-odd scanlines), 1 inside. */
export function polygonMask(points: readonly Pt[], res: number): Float32Array {
  const mask = new Float32Array(res * res)
  const n = points.length
  for (let j = 0; j < res; j++) {
    const y = j + 0.5
    const xs: number[] = []
    for (let i = 0; i < n; i++) {
      const [x0, y0] = points[i]
      const [x1, y1] = points[(i + 1) % n]
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.floor(xs[k])); x <= Math.min(res - 1, Math.floor(xs[k + 1])); x++) mask[j * res + x] = 1
    }
  }
  return mask
}

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const medianRgb = (pixels: Rgb[]): Rgb => [median(pixels.map((p) => p[0])), median(pixels.map((p) => p[1])), median(pixels.map((p) => p[2]))]

function pixelsIn(img: Rgba, cx: number, cy: number, r: number): Rgb[] {
  const out: Rgb[] = []
  const buf = new Float32Array(3)
  for (let y = Math.floor(cy - r); y < cy + r; y++) {
    for (let x = Math.floor(cx - r); x < cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue
      sample(img, x, y, buf)
      out.push([buf[0], buf[1], buf[2]])
    }
  }
  return out
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** The photo's skin: the median over cheek and forehead patches (face.py `skin_sample`). */
export function skinColour(img: Rgba, lm: readonly Pt[]): Rgb {
  const r = Math.max(1.5, dist(lm[234], lm[454]) * 0.035)
  return medianRgb(SKIN_SAMPLES.flatMap((i) => pixelsIn(img, lm[i][0], lm[i][1], r)))
}

/** The irises' colour, when the photo shows them: the median inside each iris, both eyes together. */
export function irisColour(img: Rgba, lm: readonly Pt[]): Rgb | undefined {
  const pixels = IRISES.flatMap(({ centre, rim }) => {
    if (!lm[centre]) return []
    const r = rim.reduce((s, i) => s + dist(lm[centre], lm[i]), 0) / rim.length
    return r >= 1.5 ? pixelsIn(img, lm[centre][0], lm[centre][1], r * 0.7) : []
  })
  return pixels.length >= 8 ? medianRgb(pixels) : undefined
}

/**
 * The photo's hair, when it shows any: pixels in a band above the brows that are neither skin nor the background (read
 * round the photo's border), their darker majority's median. Undefined for a bald head or a cropped photo.
 */
export function hairColour(img: Rgba, lm: readonly Pt[], skin: Rgb): Rgb | undefined {
  const border: Rgb[] = []
  const buf = new Float32Array(3)
  for (let x = 0; x < img.width; x += 4) {
    sample(img, x, 2, buf)
    border.push([buf[0], buf[1], buf[2]])
  }
  for (let y = 0; y < img.height; y += 4) {
    for (const x of [2, img.width - 3]) {
      sample(img, x, y, buf)
      border.push([buf[0], buf[1], buf[2]])
    }
  }
  const bg = medianRgb(border)
  const left = lm[234][0]
  const right = lm[454][0]
  const browY = Math.min(lm[105][1], lm[334][1])
  const faceH = dist(lm[10], lm[152])
  const found: Rgb[] = []
  for (let y = Math.max(0, browY - faceH * 0.55); y < browY - faceH * 0.08; y += 1) {
    for (let x = left; x < right; x += 1) {
      sample(img, x, y, buf)
      const p: Rgb = [buf[0], buf[1], buf[2]]
      const dBg = Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2])
      const dSkin = Math.hypot(p[0] - skin[0], p[1] - skin[1], p[2] - skin[2])
      if (dBg > 0.12 && dSkin > 0.2) found.push(p)
    }
  }
  if (found.length < (right - left) * faceH * 0.02) return undefined
  const sorted = found.sort((a, b) => lum(...a) - lum(...b))
  return medianRgb(sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.6))))
}

/**
 * Bend `photo` (with its 478 MediaPipe landmarks, in photo pixels) onto a body's face (its sidecar) as a res-square
 * patch: a similarity sets the scale, a thin-plate spline through every warp landmark does the rest, eight anchors far
 * outside keep the edges calm, and the oval through the body's own landmarks, feathered and pulled in at the rim,
 * becomes the patch's alpha.
 */
export function buildFacePatch(photo: Rgba, photoLm: readonly Pt[], meta: FaceMeta, res = 512, delight = 0.5): FacePatch {
  const k = res / meta.frame.res
  const mesh = meta.landmarks.map((p) => (p ? ([p[0] * k, p[1] * k] as const) : null))
  const ids = WARP.filter((i) => mesh[i] && photoLm[i])
  const src = ids.map((i) => mesh[i]!)
  const dst = ids.map((i) => photoLm[i])
  const sim = similarity(src, dst)
  const ring: Pt[] = []
  for (const x of [-0.5 * res, 0.5 * res, 1.5 * res]) for (const y of [-0.5 * res, 0.5 * res, 1.5 * res]) if (x !== 0.5 * res || y !== 0.5 * res) ring.push([x, y])
  const norm = (p: Pt): Pt => [p[0] / res, p[1] / res]
  const tps = tpsFit([...src, ...ring].map(norm), [...dst, ...ring.map((p) => applySimilarity(sim, p))].map(norm), 2e-4)
  // the mapping on a coarse grid, then upsampled: the spline is smooth, so 64 steps across is plenty
  const g = 64
  const map = new Float32Array(g * g * 2)
  for (let gy = 0; gy < g; gy++) {
    for (let gx = 0; gx < g; gx++) {
      const [x, y] = tps([(gx + 0.5) / g, (gy + 0.5) / g])
      map[(gy * g + gx) * 2] = x * res
      map[(gy * g + gx) * 2 + 1] = y * res
    }
  }
  const rgb = new Float32Array(res * res * 3)
  for (let y = 0; y < res; y++) {
    const gyf = clamp(((y + 0.5) / res) * g - 0.5, 0, g - 1.001)
    const gy0 = Math.floor(gyf)
    const fy = gyf - gy0
    for (let x = 0; x < res; x++) {
      const gxf = clamp(((x + 0.5) / res) * g - 0.5, 0, g - 1.001)
      const gx0 = Math.floor(gxf)
      const fx = gxf - gx0
      const i00 = (gy0 * g + gx0) * 2
      const i10 = i00 + 2
      const i01 = i00 + g * 2
      const i11 = i01 + 2
      const px = (map[i00] * (1 - fx) + map[i10] * fx) * (1 - fy) + (map[i01] * (1 - fx) + map[i11] * fx) * fy
      const py = (map[i00 + 1] * (1 - fx) + map[i10 + 1] * fx) * (1 - fy) + (map[i01 + 1] * (1 - fx) + map[i11 + 1] * fx) * fy
      sample(photo, px, py, rgb, (y * res + x) * 3)
    }
  }
  const oval = FACE_OVAL.flatMap((i) => (mesh[i] ? [mesh[i]!] : []))
  const mask = blur(polygonMask(oval, res), res, res * 0.012)
  for (let i = 0; i < mask.length; i++) mask[i] = clamp((mask[i] - 0.25) / 0.75, 0, 1)
  const skin = skinColour(photo, photoLm)
  if (delight > 0) {
    // even out the photo's broad lighting: divide by its blurred luminance, keeping features and colour
    const target = lum(...skin)
    const base = new Float32Array(res * res)
    for (let i = 0; i < base.length; i++) base[i] = mask[i] > 0.5 ? lum(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) : target
    blur(base, res, res * 0.06)
    for (let i = 0; i < base.length; i++) {
      const gain = 1 + delight * (clamp(target / Math.max(base[i], 1e-3), 0.6, 1.6) - 1)
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] *= gain
    }
  }
  const data = new Uint8ClampedArray(res * res * 4)
  for (let i = 0; i < res * res; i++) {
    data[i * 4] = rgb[i * 3] * 255
    data[i * 4 + 1] = rgb[i * 3 + 1] * 255
    data[i * 4 + 2] = rgb[i * 3 + 2] * 255
    data[i * 4 + 3] = mask[i] * 255
  }
  return { patch: { width: res, height: res, data }, skin, hair: hairColour(photo, photoLm, skin), iris: irisColour(photo, photoLm) }
}
