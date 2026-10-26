/**
 * Prints: patterns any cloth channel can wear (the third rung, Restyle). Each is a seamless tile drawn in two colours,
 * the channel's own as the ground and an ink, so one print reads in any colours. The tiles are drawn, not shipped:
 * a few lines of canvas each, the same every time (no randomness), and wrapped at the edges so they repeat without a
 * seam. Renderer-free: the client draws the tile on a canvas and lays it over the cloth (dress-model.ts).
 */

export const PRINTS = [
  'stripes',
  'pinstripe',
  'checks',
  'gingham',
  'tartan',
  'polka',
  'seigaiha',
  'asanoha',
  'kikko',
  'sakura',
  'stars',
  'chevron',
  'houndstooth',
  'camo',
  'leopard',
  'flames',
  'lightning',
  'circuit',
  'clouds',
  'argyle',
] as const
export type PrintId = (typeof PRINTS)[number]

export const PRINT_LABEL: Record<PrintId, string> = {
  stripes: 'Stripes',
  pinstripe: 'Pinstripe',
  checks: 'Checks',
  gingham: 'Gingham',
  tartan: 'Tartan',
  polka: 'Polka dots',
  seigaiha: 'Waves',
  asanoha: 'Hemp leaf',
  kikko: 'Tortoiseshell',
  sakura: 'Cherry blossom',
  stars: 'Stars',
  chevron: 'Chevron',
  houndstooth: 'Houndstooth',
  camo: 'Camouflage',
  leopard: 'Leopard',
  flames: 'Flames',
  lightning: 'Lightning',
  circuit: 'Circuit',
  clouds: 'Clouds',
  argyle: 'Argyle',
}

/** Words a prompt may use for each print, for the reader (forge/reading.ts). */
export const PRINT_WORDS: Record<PrintId, readonly string[]> = {
  stripes: ['stripes', 'striped', 'stripy', 'banded'],
  pinstripe: ['pinstripe', 'pinstriped', 'pin stripe'],
  checks: ['checks', 'checked', 'checkered', 'chequered', 'checkerboard', 'ichimatsu'],
  gingham: ['gingham', 'picnic'],
  tartan: ['tartan', 'plaid', 'flannel'],
  polka: ['polka dots', 'polka dot', 'polka', 'spotted', 'dotted'],
  seigaiha: ['seigaiha', 'waves', 'wave pattern', 'wavy'],
  asanoha: ['asanoha', 'hemp leaf', 'hemp'],
  kikko: ['kikko', 'tortoiseshell', 'hexagons', 'hexagonal', 'honeycomb'],
  sakura: ['cherry blossom', 'cherry blossoms', 'sakura', 'floral', 'flowers', 'flowery'],
  stars: ['stars', 'starry', 'star print'],
  chevron: ['chevron', 'zigzag', 'zig-zag'],
  houndstooth: ['houndstooth', 'dogtooth'],
  camo: ['camouflage', 'camo', 'military print'],
  leopard: ['leopard', 'leopard print', 'cheetah', 'animal print'],
  flames: ['flames', 'flame print', 'hot rod', 'fire print'],
  lightning: ['lightning bolts', 'lightning print', 'thunderbolts'],
  circuit: ['circuit', 'circuitry', 'circuit board', 'pcb'],
  clouds: ['clouds', 'cloud print', 'kumo', 'auspicious clouds', 'akatsuki'],
  argyle: ['argyle', 'diamonds', 'diamond pattern', 'harlequin'],
}

export const isPrintId = (v: unknown): v is PrintId => typeof v === 'string' && (PRINTS as readonly string[]).includes(v)

/** Repeats of the tile per metre of cloth: the print's size. */
export const PRINT_SCALE = { min: 1, max: 12, default: 4 } as const

/** A print's ink when the player hasn't picked one: the ground deepened, or lifted when the ground is already dark. */
export function inkFor(ground: string): string {
  const v = parseInt(ground.slice(1), 16)
  const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  const toward = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 > 0.2 ? 0 : 255
  return `#${rgb.map((c) => Math.round(c + (toward - c) * 0.55).toString(16).padStart(2, '0')).join('')}`
}

/** The slice of a 2D canvas context the prints draw with. */
export type PrintContext = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineCap' | 'lineJoin' | 'globalAlpha' | 'fillRect' | 'beginPath' | 'closePath' | 'moveTo' | 'lineTo' | 'arc' | 'ellipse' | 'quadraticCurveTo' | 'fill' | 'stroke' | 'save' | 'restore' | 'translate' | 'rotate'
>

/** A fixed sequence of numbers in [0, 1), so a scattered print comes out the same every time. */
function sequence(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Draw one print as a `size`-pixel tile on `ground`, inked in `ink`. Shapes near an edge are drawn again across it,
 * so the tile repeats without a seam.
 */
export function drawPrint(ctx: PrintContext, id: PrintId, size: number, ground: string, ink: string) {
  const s = size
  ctx.save()
  ctx.globalAlpha = 1
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, s, s)
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  /** Draw a shape at (x, y) and again wherever it crosses an edge. */
  const wrapped = (x: number, y: number, reach: number, draw: (x: number, y: number) => void) => {
    for (const dx of [-s, 0, s])
      for (const dy of [-s, 0, s]) {
        const px = x + dx
        const py = y + dy
        if (px + reach < 0 || px - reach > s || py + reach < 0 || py - reach > s) continue
        draw(px, py)
      }
  }
  const dot = (x: number, y: number, r: number) => wrapped(x, y, r, (px, py) => (ctx.beginPath(), ctx.arc(px, py, r, 0, Math.PI * 2), ctx.fill()))
  const line = (points: [number, number][], width: number) => {
    ctx.lineWidth = width
    ctx.beginPath()
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.stroke()
  }
  const polygon = (points: [number, number][]) => {
    ctx.beginPath()
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.fill()
  }
  const star = (x: number, y: number, r: number, points = 5, inner = 0.45) =>
    wrapped(x, y, r, (px, py) => polygon(Array.from({ length: points * 2 }, (_, k) => {
      const a = -Math.PI / 2 + (k * Math.PI) / points
      const d = k % 2 ? r * inner : r
      return [px + Math.cos(a) * d, py + Math.sin(a) * d] as [number, number]
    })))

  switch (id) {
    case 'stripes':
      for (let k = 0; k < 4; k++) ctx.fillRect(0, (k * s) / 4, s, s / 12)
      break
    case 'pinstripe':
      for (let k = 0; k < 8; k++) ctx.fillRect((k * s) / 8, 0, Math.max(1, s / 128), s)
      break
    case 'checks':
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) ctx.fillRect((i * s) / 4, (j * s) / 4, s / 4, s / 4)
      break
    case 'gingham':
      // bands across and down at half strength, darker where they cross
      ctx.globalAlpha = 0.5
      for (let k = 0; k < 4; k++) {
        ctx.fillRect(0, (k * s) / 4, s, s / 8)
        ctx.fillRect((k * s) / 4, 0, s / 8, s)
      }
      break
    case 'tartan':
      ctx.globalAlpha = 0.45
      for (const [at, w] of [[0, 0.25], [0.5, 0.25]] as const) {
        ctx.fillRect(0, at * s, s, w * s)
        ctx.fillRect(at * s, 0, w * s, s)
      }
      ctx.globalAlpha = 0.9
      for (const at of [0.125, 0.375, 0.625, 0.875]) {
        ctx.fillRect(0, at * s, s, s / 96)
        ctx.fillRect(at * s, 0, s / 96, s)
      }
      break
    case 'polka':
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) dot(((i + (j % 2) * 0.5) * s) / 4, (j * s) / 4, s / 22)
      break
    case 'seigaiha': {
      // rows of fans of rings, each row tucked half a fan over the one behind it. The rows are drawn top to bottom,
      // from above the tile to below it, so the overlaps at the seams come out as they do in the middle
      const r = s / 4
      ctx.lineWidth = s / 64
      for (let row = -1; row <= 10; row++)
        for (let col = -1; col <= 2; col++) {
          const x = col * 2 * r + (row % 2 ? r : 0)
          const y = (row * r) / 2
          ctx.fillStyle = ground
          ctx.beginPath()
          ctx.arc(x, y, r, Math.PI, 0)
          ctx.fill()
          for (const k of [1, 0.72, 0.44]) {
            ctx.beginPath()
            ctx.arc(x, y, r * k, Math.PI, 0)
            ctx.stroke()
          }
        }
      ctx.fillStyle = ink
      break
    }
    case 'asanoha': {
      // a triangle grid, each triangle split into three from its centre: the lines meet in six-pointed hemp leaves.
      // Five triangles across and six rows down, so the grid fits the tile within a few percent of equilateral
      const w = s / 5
      const h = s / 6
      ctx.lineWidth = s / 128
      const split = (tri: [number, number][]) => {
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3
        const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3
        line([...tri, tri[0]], s / 128)
        for (const p of tri) line([[cx, cy], p], s / 128)
      }
      for (let row = 0; row < 6; row++) {
        const o = (row % 2) * (w / 2)
        const y = row * h
        for (let i = -1; i <= 5; i++) {
          const x = o + i * w
          split([[x, y], [x + w, y], [x + w / 2, y + h]])
          split([[x + w / 2, y + h], [x + w * 1.5, y + h], [x + w, y]])
        }
      }
      break
    }
    case 'kikko': {
      // a honeycomb with a smaller hexagon inside each cell. Five cells across and six rows down, so it fits the tile
      // within a few percent of regular
      const sx = s / 5
      const sy = s / 6
      const hexagon = (x: number, y: number, k: number): [number, number][] => {
        const corners: [number, number][] = [[0, -2 / 3], [0.5, -1 / 3], [0.5, 1 / 3], [0, 2 / 3], [-0.5, 1 / 3], [-0.5, -1 / 3]]
        const pts = corners.map(([u, v]) => [x + u * sx * k, y + v * sy * k] as [number, number])
        return [...pts, pts[0]]
      }
      for (let row = -1; row <= 6; row++)
        for (let col = -1; col <= 5; col++) {
          const x = col * sx + (row % 2 ? sx / 2 : 0)
          const y = row * sy
          line(hexagon(x, y, 1), s / 80)
          line(hexagon(x, y, 0.62), s / 128)
        }
      break
    }
    case 'sakura': {
      const next = sequence(7)
      for (let k = 0; k < 7; k++) {
        const x = next() * s
        const y = next() * s
        const r = s * (0.05 + next() * 0.035)
        const turn = next() * Math.PI
        wrapped(x, y, r * 1.2, (px, py) => {
          for (let p = 0; p < 5; p++) {
            const a = turn + (p * Math.PI * 2) / 5
            ctx.beginPath()
            ctx.ellipse(px + Math.cos(a) * r * 0.55, py + Math.sin(a) * r * 0.55, r * 0.55, r * 0.34, a, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.fillStyle = ground
          ctx.beginPath()
          ctx.arc(px, py, r * 0.18, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = ink
        })
      }
      break
    }
    case 'stars':
      // an even number of rows, so the half-step offset of every other row comes round again at the seam
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) star(((i + (j % 2) * 0.5) * s) / 3, (j * s) / 4, s / 14)
      break
    case 'chevron':
      // from above the tile to below it, so the lines on the seams are drawn whole
      for (let k = -1; k <= 4; k++) {
        const y = (k * s) / 4
        const pts: [number, number][] = []
        for (let x = 0; x <= 4; x++) pts.push([(x * s) / 4, y + (x % 2 ? s / 8 : 0)])
        line(pts, s / 24)
      }
      break
    case 'houndstooth': {
      // woven, not drawn: four dark threads then four light, each way, in a two-over-two twill. The teeth come out of
      // the weave
      const c = s / 8
      for (let x = 0; x < 8; x++)
        for (let y = 0; y < 8; y++) {
          const dark = (x + y) % 4 < 2 ? x < 4 : y < 4
          if (dark) ctx.fillRect(x * c, y * c, c, c)
        }
      break
    }
    case 'camo': {
      const next = sequence(11)
      ctx.globalAlpha = 0.8
      for (let k = 0; k < 14; k++) {
        const x = next() * s
        const y = next() * s
        const r = s * (0.06 + next() * 0.08)
        for (let b = 0; b < 3; b++) dot(x + (next() - 0.5) * r * 1.6, y + (next() - 0.5) * r * 1.2, r * (0.6 + next() * 0.5))
      }
      break
    }
    case 'leopard': {
      const next = sequence(5)
      for (let k = 0; k < 10; k++) {
        const x = next() * s
        const y = next() * s
        const r = s * (0.035 + next() * 0.025)
        // a rosette: a ring of broken spots round an open middle
        for (let p = 0; p < 5; p++) {
          if (next() < 0.25) continue
          const a = (p * Math.PI * 2) / 5 + next()
          dot(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.42)
        }
      }
      break
    }
    case 'flames':
      for (let k = 0; k < 4; k++) {
        const x = (k * s) / 4
        wrapped(x, s, s / 2, (px, py) => {
          ctx.beginPath()
          ctx.moveTo(px - s / 8, py)
          ctx.quadraticCurveTo(px - s / 7, py - s * 0.35, px + s / 40, py - s * 0.55)
          ctx.quadraticCurveTo(px - s / 30, py - s * 0.3, px + s / 8, py)
          ctx.closePath()
          ctx.fill()
        })
      }
      break
    case 'lightning':
      for (let k = 0; k < 3; k++) {
        const x = (k * s) / 3 + s / 12
        wrapped(x, s / 2, s / 2, (px, py) =>
          polygon([[px, py - s * 0.42], [px + s * 0.07, py - s * 0.42], [px + s * 0.02, py - s * 0.06], [px + s * 0.09, py - s * 0.06], [px - s * 0.04, py + s * 0.42], [px, py + s * 0.04], [px - s * 0.07, py + s * 0.04]]),
        )
      }
      break
    case 'circuit': {
      // traces turning at right angles, each ending in a pad
      const next = sequence(3)
      const g = s / 8
      for (let k = 0; k < 9; k++) {
        let x = Math.round(next() * 8) * g
        let y = Math.round(next() * 8) * g
        const pts: [number, number][] = [[x, y]]
        for (let step = 0; step < 3; step++) {
          if (step % 2) y += (next() < 0.5 ? -1 : 1) * g * (1 + Math.floor(next() * 2))
          else x += (next() < 0.5 ? -1 : 1) * g * (1 + Math.floor(next() * 2))
          pts.push([x, y])
        }
        for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) line(pts.map(([px, py]) => [px + dx, py + dy]), s / 64)
        dot(x, y, s / 40)
        dot(pts[0][0], pts[0][1], s / 40)
      }
      break
    }
    case 'clouds': {
      // stylised clouds: a row of puffs over a flat base, with a curl
      for (const [x, y] of [[0.28, 0.3], [0.78, 0.78]] as const) {
        const r = s * 0.07
        wrapped(x * s, y * s, r * 4, (px, py) => {
          for (const [ox, oy, k] of [[-1.6, 0.3, 0.8], [-0.6, -0.4, 1.1], [0.6, -0.2, 1], [1.6, 0.35, 0.75]] as const) {
            ctx.beginPath()
            ctx.arc(px + ox * r, py + oy * r, r * k, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.fillRect(px - r * 2.3, py + r * 0.2, r * 4.6, r * 0.9)
          ctx.strokeStyle = ground
          ctx.lineWidth = s / 128
          ctx.beginPath()
          ctx.arc(px - r * 0.6, py - r * 0.4, r * 0.55, 0, Math.PI * 1.5)
          ctx.stroke()
          ctx.strokeStyle = ink
        })
      }
      break
    }
    case 'argyle': {
      const w = s / 2
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          if ((i + j) % 2) continue
          const x = i * w + w / 2
          const y = j * w + w / 2
          wrapped(x, y, w, (px, py) => polygon([[px, py - w / 2], [px + w / 2, py], [px, py + w / 2], [px - w / 2, py]]))
        }
      // the thin cross-lines over the diamonds, in the ground colour
      ctx.strokeStyle = ground
      for (const k of [-1, 0, 1]) {
        line([[k * s, 0], [k * s + s, s]], s / 96)
        line([[k * s + s, 0], [k * s, s]], s / 96)
      }
      break
    }
  }
  ctx.restore()
}
