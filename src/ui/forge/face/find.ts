import { hairColour, irisColour, skinColour, type Rgb } from '../../../arena/client/face/patch.js'
import type { Pt } from '../../../arena/client/face/warp.js'
import { detectFace } from './detect.js'

/** A face found on a reference image: its landmarks, and the skin, hair and eye colours read off the photo. */
export interface FaceFinding {
  points: Pt[]
  width: number
  height: number
  skin: Rgb
  hair?: Rgb
  iris?: Rgb
}

/** Look for a face on an image the Forge has already shrunk; undefined when there is none. */
export async function findFace(image: Blob): Promise<FaceFinding | undefined> {
  const bitmap = await createImageBitmap(image)
  try {
    const found = await detectFace(bitmap)
    if (!found) return undefined
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return undefined
    ctx.drawImage(bitmap, 0, 0)
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    const photo = { width: pixels.width, height: pixels.height, data: pixels.data }
    const skin = skinColour(photo, found.points)
    return { ...found, skin, hair: hairColour(photo, found.points, skin), iris: irisColour(photo, found.points) }
  } finally {
    bitmap.close()
  }
}
