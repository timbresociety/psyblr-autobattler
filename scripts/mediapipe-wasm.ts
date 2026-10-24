import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * MediaPipe's WASM runtime, served from our own origin at /mediapipe/ (the Forge finds face landmarks with it): straight
 * from node_modules in dev, copied into dist on build. Only the two builds MediaPipe chooses between ship, the SIMD one
 * and its fallback, about 25 MB that load only once someone adds a photo.
 */
const FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']

export function mediapipeWasm(): Plugin {
  const dir = join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
  return {
    name: 'psyblr-mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe/', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!FILES.includes(name) || !existsSync(join(dir, name))) return next()
        res.setHeader('content-type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        res.setHeader('cache-control', 'public, max-age=86400')
        res.end(readFileSync(join(dir, name)))
      })
    },
    generateBundle() {
      for (const name of FILES) this.emitFile({ type: 'asset', fileName: `mediapipe/${name}`, source: readFileSync(join(dir, name)) })
    },
  }
}
