import type { WebGPURenderer } from 'three/webgpu'

/**
 * The renderer boundary (KTD8). three.js `WebGPURenderer` uses WebGPU where the browser has it and falls back to
 * WebGL2 by itself; this module is the only place that knows, so forcing a backend touches one file.
 */

export type Backend = 'webgpu' | 'webgl2'

export interface BackendEnv {
  hasWebGPU: boolean
  forceWebGL: boolean
}

export function chooseBackend(env: BackendEnv): Backend {
  return env.hasWebGPU && !env.forceWebGL ? 'webgpu' : 'webgl2'
}

/** `?webgl` in the URL forces the WebGL2 backend. */
export const forceWebGLFlag = (search: string) => new URLSearchParams(search).has('webgl')

/**
 * `?gputime` in a dev build times every render pass on the GPU (`renderer.resolveTimestampsAsync()`), so a script can
 * read what a frame costs even when the browser caps the frame rate (Chrome's energy saver holds a laptop on low
 * battery to 30 FPS) or vsync rounds it.
 */
export const gpuTimeFlag = (search: string) => import.meta.env.DEV && new URLSearchParams(search).has('gputime')

export async function createRenderer(canvas: HTMLCanvasElement, options: { forceWebGL: boolean; trackTimestamp?: boolean }): Promise<{ renderer: WebGPURenderer; backend: Backend }> {
  const { WebGPURenderer } = await import('three/webgpu')
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: options.forceWebGL, trackTimestamp: options.trackTimestamp === true })
  await renderer.init()
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2'
  return { renderer, backend }
}
