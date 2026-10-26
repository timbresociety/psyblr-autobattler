import type { Finish } from './item.js'

/**
 * How each finish shades, renderer-free: both the arena's node material and the classic one read these from vertex
 * attributes (roughness, metalness, sheen, glow, then the weave the cloth's relief draws).
 */
export interface FinishLook {
  roughness: number
  metalness: number
  /** A soft brightening toward the silhouette, the way cloth catches light at grazing angles. */
  sheen: number
  /** 1 for a channel that glows in its own colour. */
  glow: number
  /** The relief: 0 none, 1 plain weave, 2 twill, 3 rib knit, 4 leather grain. */
  weave: number
}

export const FINISH_LOOK: Record<Finish, FinishLook> = {
  cotton: { roughness: 0.86, metalness: 0, sheen: 0.35, glow: 0, weave: 1 },
  silk: { roughness: 0.32, metalness: 0, sheen: 0.85, glow: 0, weave: 0 },
  denim: { roughness: 0.9, metalness: 0, sheen: 0.2, glow: 0, weave: 2 },
  knit: { roughness: 0.95, metalness: 0, sheen: 0.45, glow: 0, weave: 3 },
  leather: { roughness: 0.42, metalness: 0, sheen: 0.1, glow: 0, weave: 4 },
  metal: { roughness: 0.28, metalness: 0.92, sheen: 0, glow: 0, weave: 0 },
  glow: { roughness: 0.5, metalness: 0, sheen: 0, glow: 1, weave: 0 },
}

/** '#rrggbb' (sRGB) to linear 0 to 1 channels, the space vertex colours are shaded in. */
export function linearRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)]
}
