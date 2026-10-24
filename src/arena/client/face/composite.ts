import * as THREE from 'three'
import { metaChannel } from '../character-look.js'
import type { FaceMeta } from './patch.js'

/**
 * A hero's own copy of its body's atlas, with its skin colour baked into every skin texel and its photo face painted
 * over the face. Each front-facing skin triangle inside the head frame is drawn from the face patch: its corners'
 * positions say where they sit in the patch (the frame is a front-on projection), its UVs where they sit in the atlas.
 * So this needs nothing from the atlas packer, however it split the face into islands.
 */

type Surface = HTMLCanvasElement | OffscreenCanvas
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Sized = CanvasImageSource & { width: number; height: number }

function surface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** The 2D affine taking triangle s onto triangle d, in canvas setTransform order (a, b, c, d, e, f). */
export function triangleTransform(s: number[], d: number[]): [number, number, number, number, number, number] | undefined {
  const [x0, y0, x1, y1, x2, y2] = s
  const [u0, v0, u1, v1, u2, v2] = d
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  if (Math.abs(det) < 1e-9) return undefined
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det
  const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det
  return [a, b, c, dd, u0 - a * x0 - c * y0, v0 - b * x0 - dd * y0]
}

/** Grow a triangle by `px` pixels about its centre, so neighbouring triangles overlap instead of leaving hairline gaps. */
function grow(t: number[], px: number): number[] {
  const cx = (t[0] + t[2] + t[4]) / 3
  const cy = (t[1] + t[3] + t[5]) / 3
  const out: number[] = []
  for (let i = 0; i < 6; i += 2) {
    const dx = t[i] - cx
    const dy = t[i + 1] - cy
    const len = Math.hypot(dx, dy) || 1
    out.push(t[i] + (dx / len) * px, t[i + 1] + (dy / len) * px)
  }
  return out
}

const path = (ctx: Ctx, t: number[]) => {
  ctx.moveTo(t[0], t[1])
  ctx.lineTo(t[2], t[3])
  ctx.lineTo(t[4], t[5])
  ctx.closePath()
}

export function compositeFace(geometry: THREE.BufferGeometry, atlas: Sized, frame: FaceMeta['frame'], patch: Sized, skin: THREE.Color): Surface {
  const W = atlas.width
  const H = atlas.height
  const out = surface(W, H)
  const ctx = out.getContext('2d') as Ctx
  ctx.drawImage(atlas, 0, 0)
  const pos = geometry.getAttribute('position')
  const nrm = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  const meta = geometry.getAttribute(metaChannel(geometry))
  const index = geometry.getIndex()
  const count = index ? index.count : pos.count
  const vertex = (k: number) => (index ? index.getX(k) : k)
  const isSkin = (i: number) => Math.floor(meta.getX(i)) === 0
  const half = frame.size / 2
  const inFace = (i: number) => nrm.getZ(i) > 0.15 && Math.abs(pos.getX(i) - frame.cx) < half && Math.abs(pos.getY(i) - frame.cz) < half
  const P = patch.width
  const toPatch = (i: number) => [((pos.getX(i) - frame.cx) / frame.size + 0.5) * P, (0.5 - (pos.getY(i) - frame.cz) / frame.size) * P]
  const toAtlas = (i: number) => [uv.getX(i) * W, uv.getY(i) * H]

  // 1. the skin colour, multiplied once into every skin texel (the skin region's vertex colour turns white for this
  // hero). Coverage is a mask first, the triangles filled and their edges stroked so the bake's edge padding is tinted
  // too (or mip levels show grey seams); multiplying the fill and the stroke straight onto the atlas would tint every
  // edge twice and draw the mesh's wireframe on the skin.
  const mask = surface(W, H)
  const m = mask.getContext('2d') as Ctx
  m.beginPath()
  const faces: number[][] = []
  for (let k = 0; k < count; k += 3) {
    const a = vertex(k)
    const b = vertex(k + 1)
    const c = vertex(k + 2)
    if (!isSkin(a) || !isSkin(b) || !isSkin(c)) continue
    path(m, [...toAtlas(a), ...toAtlas(b), ...toAtlas(c)])
    if (inFace(a) && inFace(b) && inFace(c)) faces.push([a, b, c])
  }
  m.fillStyle = m.strokeStyle = '#fff'
  m.lineWidth = 3
  m.lineJoin = 'round'
  m.fill()
  m.stroke()
  // the mask becomes a layer of skin colour, then multiplies into the atlas once
  m.globalCompositeOperation = 'source-in'
  m.fillStyle = `#${skin.getHexString(THREE.SRGBColorSpace)}`
  m.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(mask, 0, 0)
  ctx.globalCompositeOperation = 'source-over'

  // 2. the photo face, triangle by triangle, feathered by the patch's own alpha
  for (const [a, b, c] of faces) {
    const s = [...toPatch(a), ...toPatch(b), ...toPatch(c)]
    const d = [...toAtlas(a), ...toAtlas(b), ...toAtlas(c)]
    const m = triangleTransform(s, d)
    if (!m) continue
    ctx.save()
    ctx.beginPath()
    path(ctx, grow(d, 0.6))
    ctx.clip()
    ctx.setTransform(...m)
    ctx.drawImage(patch, 0, 0)
    ctx.restore()
  }
  return out
}
