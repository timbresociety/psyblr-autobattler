import { describe, expect, it } from 'vitest'
import { chooseBackend, forceWebGLFlag } from './renderer'

describe('renderer boundary (U1)', () => {
  it('falls back to WebGL2 when WebGPU is unavailable', () => {
    expect(chooseBackend({ hasWebGPU: false, forceWebGL: false })).toBe('webgl2')
  })

  it('uses WebGPU when available', () => {
    expect(chooseBackend({ hasWebGPU: true, forceWebGL: false })).toBe('webgpu')
  })

  it('the force flag wins even when WebGPU is available', () => {
    expect(chooseBackend({ hasWebGPU: true, forceWebGL: true })).toBe('webgl2')
    expect(forceWebGLFlag('?bench&webgl')).toBe(true)
    expect(forceWebGLFlag('?bench')).toBe(false)
  })
})
