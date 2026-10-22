import * as THREE from 'three'

/**
 * Procedural material textures for the ruins (R25): colour, a normal map from a height field, and roughness, drawn on
 * canvases at load. Seeded, so every visit draws the same stone, and nothing is downloaded. Sizes stay at 512 or
 * less, inside the 1K budget for scenery (R24).
 */

export interface StoneSet {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
}

function seeded(seed: number) {
  let s = seed % 2147483647 || 1
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/** Tileable value noise over a size×size grid, summed over a few octaves; values 0..1. */
function noiseField(size: number, seed: number, octaves = 4, base = 8): Float32Array {
  const out = new Float32Array(size * size)
  const rnd = seeded(seed)
  let amp = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const cells = base << o
    const grid = new Float32Array(cells * cells).map(() => rnd())
    const at = (x: number, y: number) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)]
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const fy = (y / size) * cells
        const ix = Math.floor(fx)
        const iy = Math.floor(fy)
        const tx = fx - ix
        const ty = fy - iy
        const sx = tx * tx * (3 - 2 * tx)
        const sy = ty * ty * (3 - 2 * ty)
        const top = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx
        const bottom = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx
        out[y * size + x] += (top * (1 - sy) + bottom * sy) * amp
      }
    total += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

function canvasTexture(size: number, paint: (img: ImageData) => void, color: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  paint(img)
  ctx.putImageData(img, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  if (color) texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** A normal map from a height field: steeper height, stronger bumps. */
function normalFrom(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  return canvasTexture(
    size,
    (img) => {
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const h = (xx: number, yy: number) => height[((yy + size) % size) * size + ((xx + size) % size)]
          const dx = (h(x + 1, y) - h(x - 1, y)) * strength
          const dy = (h(x, y + 1) - h(x, y - 1)) * strength
          const len = Math.sqrt(dx * dx + dy * dy + 1)
          const i = (y * size + x) * 4
          img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
          img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255
          img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
          img.data[i + 3] = 255
        }
    },
    false,
  )
}

/** Warm travertine for walls, columns and the floor: pitted, layered, with darker veins. */
export function travertine(seed: number, tint: [number, number, number] = [222, 206, 178], size = 256): StoneSet {
  const coarse = noiseField(size, seed, 5, 4)
  const fine = noiseField(size, seed + 17, 3, 32)
  const height = new Float32Array(size * size)
  for (let i = 0; i < height.length; i++) {
    const y = Math.floor(i / size)
    // horizontal bedding layers, the look of travertine, plus pits
    const layers = Math.sin((y / size) * Math.PI * 18 + coarse[i] * 6) * 0.5 + 0.5
    const pit = fine[i] < 0.28 ? -0.6 : 0
    height[i] = coarse[i] * 0.6 + layers * 0.25 + fine[i] * 0.3 + pit
  }
  const map = canvasTexture(
    size,
    (img) => {
      for (let i = 0; i < height.length; i++) {
        const shade = 0.78 + height[i] * 0.3
        const vein = Math.abs(coarse[i] - 0.5) < 0.012 ? 0.75 : 1
        img.data[i * 4] = Math.min(255, tint[0] * shade * vein)
        img.data[i * 4 + 1] = Math.min(255, tint[1] * shade * vein)
        img.data[i * 4 + 2] = Math.min(255, tint[2] * shade * vein)
        img.data[i * 4 + 3] = 255
      }
    },
    true,
  )
  const roughnessMap = canvasTexture(
    size,
    (img) => {
      for (let i = 0; i < height.length; i++) {
        const r = 170 + (1 - height[i]) * 80
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.min(255, r)
        img.data[i * 4 + 3] = 255
      }
    },
    false,
  )
  return { map, normalMap: normalFrom(height, size, 3.2), roughnessMap }
}

/** Weathered timber planks for barricades. */
export function timber(seed: number, size = 256): StoneSet {
  const grain = noiseField(size, seed, 4, 4)
  const height = new Float32Array(size * size)
  for (let i = 0; i < height.length; i++) {
    const x = i % size
    const plank = Math.floor((x / size) * 4)
    const edge = (x % (size / 4)) < 3 ? -0.7 : 0
    height[i] = Math.sin((Math.floor(i / size) / size) * 40 + grain[i] * 9 + plank) * 0.3 + grain[i] * 0.5 + edge
  }
  const map = canvasTexture(
    size,
    (img) => {
      for (let i = 0; i < height.length; i++) {
        const s = 0.55 + height[i] * 0.35
        img.data[i * 4] = 150 * s
        img.data[i * 4 + 1] = 100 * s
        img.data[i * 4 + 2] = 62 * s
        img.data[i * 4 + 3] = 255
      }
    },
    true,
  )
  const roughnessMap = canvasTexture(
    size,
    (img) => {
      for (let i = 0; i < height.length; i++) {
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 215
        img.data[i * 4 + 3] = 255
      }
    },
    false,
  )
  return { map, normalMap: normalFrom(height, size, 2.4), roughnessMap }
}

/** Large paving stones with mossy joints for the arena floor. */
export function paving(seed: number, size = 512): StoneSet {
  const rnd = seeded(seed)
  const stone = noiseField(size, seed + 3, 4, 8)
  const moss = noiseField(size, seed + 9, 3, 6)
  const height = new Float32Array(size * size)
  const tone = new Float32Array(size * size)
  // a running-bond pattern: rows of slabs of varying width
  const rows = 4
  const rowH = size / rows
  const cuts: number[][] = []
  for (let r = 0; r < rows; r++) {
    const row = [0]
    let x = 0
    while (x < size) {
      x += size / 4 + (rnd() - 0.5) * (size / 6)
      row.push(Math.min(size, x))
    }
    row[row.length - 1] = size
    cuts.push(row)
  }
  const slabTone = cuts.map((row) => row.map(() => 0.92 + rnd() * 0.12))
  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / rowH)
    const inRowY = y - r * rowH
    for (let x = 0; x < size; x++) {
      const row = cuts[r]
      let k = 0
      while (k < row.length - 1 && x >= row[k + 1]) k++
      const edge = Math.min(inRowY, rowH - inRowY, x - row[k], row[k + 1] - x)
      const joint = edge < 4 ? 1 - edge / 4 : 0
      const i = y * size + x
      height[i] = stone[i] * 0.5 - joint * 0.9
      tone[i] = slabTone[r][k] * (0.85 + stone[i] * 0.3)
    }
  }
  const map = canvasTexture(
    size,
    (img) => {
      for (let i = 0; i < height.length; i++) {
        const joint = height[i] < -0.2
        // moss lives in the joints and fades out onto the stone, never in big blotches
        const mossy = joint && moss[i] > 0.5
        const creep = !joint && moss[i] > 0.66 ? (moss[i] - 0.66) * 2.2 : 0
        const t = tone[i]
        const stoneC = [214 * t, 200 * t, 176 * t]
        const mossC = [110, 132, 78]
        const c = mossy ? mossC : joint ? [128, 118, 102] : stoneC.map((v, k) => v * (1 - creep) + mossC[k] * creep)
        img.data[i * 4] = Math.min(255, c[0])
        img.data[i * 4 + 1] = Math.min(255, c[1])
        img.data[i * 4 + 2] = Math.min(255, c[2])
        img.data[i * 4 + 3] = 255
      }
    },
    true,
  )
  const roughnessMap = canvasTexture(
    size,
    (img) => {
      for (let i = 0; i < height.length; i++) {
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = height[i] < -0.2 ? 250 : 190
        img.data[i * 4 + 3] = 255
      }
    },
    false,
  )
  return { map, normalMap: normalFrom(height, size, 4), roughnessMap }
}

/** A soft vertical gradient for grass blades and tufts: dark at the root, sunlit at the tip, alpha at the edges. */
export function grassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const rnd = seeded(5)
  for (let i = 0; i < 16; i++) {
    const x = 4 + rnd() * 56
    const h = 60 + rnd() * 64
    const g = ctx.createLinearGradient(0, 128, 0, 128 - h)
    g.addColorStop(0, '#2f4a22')
    g.addColorStop(1, '#a8c95a')
    ctx.strokeStyle = g
    ctx.lineWidth = 3 + rnd() * 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, 128)
    ctx.quadraticCurveTo(x + (rnd() - 0.5) * 20, 128 - h * 0.6, x + (rnd() - 0.5) * 30, 128 - h)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
