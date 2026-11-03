import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BUDGET, bytesOf, overBudget, textureMb } from './budget.js'

describe('frame budgets (GAME.md §10)', () => {
  it('a frame inside every budget passes; each one over is named', () => {
    expect(overBudget({ triangles: 1_400_000, drawCalls: 300, textureMb: 200 })).toEqual([])
    const over = overBudget({ triangles: 1_600_000, drawCalls: 301, textureMb: 600 })
    expect(over).toHaveLength(3)
    expect(over[0]).toMatch(/1\.60 M triangles/)
    expect(over[1]).toMatch(/301 draw calls/)
    expect(over[2]).toMatch(/600 MB/)
    expect(BUDGET).toEqual({ triangles: 1_500_000, drawCalls: 300, textureMb: 512 })
  })

  it('a 1K colour map with mipmaps takes four megabytes and a third; a mip-less float map takes its texels', () => {
    const map = new THREE.Texture({ width: 1024, height: 1024 })
    expect(bytesOf(map)).toBeCloseTo(1024 * 1024 * 4 * (4 / 3))
    const data = new THREE.DataTexture(new Float32Array(64 * 64 * 4), 64, 64, THREE.RGBAFormat, THREE.FloatType)
    expect(bytesOf(data)).toBe(64 * 64 * 16)
  })

  it('counts each texture in the scene once, however many materials share it', () => {
    const scene = new THREE.Scene()
    const map = new THREE.Texture({ width: 1024, height: 512 })
    map.generateMipmaps = false
    for (let i = 0; i < 3; i++) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map, normalMap: i ? map : null })))
    expect(textureMb(scene)).toBe(2)
  })
})
