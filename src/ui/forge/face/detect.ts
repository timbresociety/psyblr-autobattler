import type { Pt } from '../../../arena/client/face/warp.js'

/**
 * Face landmarks in the browser: MediaPipe's Face Landmarker, its WASM and model served from our own origin
 * (scripts/mediapipe-wasm.ts, public/models). Loaded the first time a photo comes in, then kept. The photo never leaves
 * the browser for this step.
 */

export interface FoundFace {
  /** 478 landmarks (irises included) in the image's own pixels. */
  points: Pt[]
  width: number
  height: number
}

type Image = ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas
type Landmarker = { detect(image: Image): { faceLandmarks: { x: number; y: number }[][] } }

let landmarker: Promise<Landmarker> | undefined

function load(): Promise<Landmarker> {
  landmarker ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe')
    const make = (delegate: 'GPU' | 'CPU') =>
      FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate }, runningMode: 'IMAGE', numFaces: 1 })
    try {
      return (await make('GPU')) as unknown as Landmarker
    } catch {
      // no WebGL for MediaPipe here: the CPU path is slower but finds the same points
      return (await make('CPU')) as unknown as Landmarker
    }
  })().catch((error: unknown) => {
    landmarker = undefined
    throw error
  })
  return landmarker
}

const sizeOf = (image: Image) => ('naturalWidth' in image ? { width: image.naturalWidth, height: image.naturalHeight } : { width: image.width, height: image.height })

/** The face in an image, or undefined when there is none: a drawing, a mask, a car. Throws only if MediaPipe can't load. */
export async function detectFace(image: Image): Promise<FoundFace | undefined> {
  const found = (await load()).detect(image).faceLandmarks[0]
  if (!found || found.length < 478) return undefined
  const { width, height } = sizeOf(image)
  return { width, height, points: found.map((p) => [p.x * width, p.y * height] as const) }
}
