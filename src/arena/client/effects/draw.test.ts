import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { composeRecipe } from '../../recipes/defaults.js'
import { lookFor } from '../../recipes/looks.js'
import { createDraw, type Kit, type MeshKind } from './draw.js'

/** A kit that draws nothing and remembers what it was asked for. */
function recorder() {
  const seen = { meshes: [] as { kind: MeshKind; scale: THREE.Vector3 }[], ribbons: 0, ghosts: 0, motifs: 0, darken: 0 }
  const kit: Kit = {
    camera: () => new THREE.PerspectiveCamera(),
    show: (kind, _c, _duration, place, update) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      place(m)
      seen.meshes.push({ kind, scale: m.scale.clone() })
      update(0.5, m)
    },
    sparkle: () => {},
    puff: () => {},
    motif: () => void seen.motifs++,
    ribbon: () => void seen.ribbons++,
    later: (_seconds, fn) => fn(),
    shake: () => {},
    darken: () => void seen.darken++,
    ghost: () => void seen.ghosts++,
  }
  return { seen, draw: createDraw(kit) }
}

const from = new THREE.Vector3(0, 1, 0)
const dir = new THREE.Vector3(0, 0, 1)

/** Draw a skill's landing the way the effect player does for an impact event. */
function land(name: string, kind: Parameters<typeof composeRecipe>[0], base: number, range = 10) {
  const { seen, draw } = recorder()
  const r = composeRecipe(kind, lookFor(name, kind))
  for (const l of r.layers) {
    if (l.phase === 'travel') draw.along(l, r, from, dir, range, base)
    else if (l.phase === 'impact' || l.phase === 'linger') draw.layer(l, r, from, base, { dir, range, caster: from })
  }
  return seen
}

describe('drawing a skill look', () => {
  it('draws the three beams as three different beams', () => {
    const kame = land('Kamehameha', 'beam', 0.7)
    const galick = land('Galick Gun', 'beam', 0.7)
    const cannon = land('Special Beam Cannon', 'beam', 0.7)
    // a wave swells into a head where it hits; a crackle is wrapped in lightning; a drill has a spiral round its core
    expect(kame.meshes.map((m) => m.kind)).toContain('orb')
    expect(kame.ribbons).toBe(0)
    expect(galick.ribbons).toBeGreaterThanOrEqual(8)
    expect(cannon.meshes.map((m) => m.kind)).toContain('core')
    expect(cannon.ribbons).toBeGreaterThanOrEqual(2)
    expect(galick.meshes.map((m) => m.kind)).not.toContain('orb')
  })

  it("rings a zone at exactly its radius, whatever it's made of", () => {
    for (const name of ['Earthquake', 'Meteor rain', 'Gravity vortex', 'Holy sanctuary']) {
      const seen = land(name, 'zone', 3.5)
      const ring = seen.meshes.find((m) => m.kind === 'shock')!
      expect(ring.scale.x, name).toBeCloseTo(3.5)
    }
  })

  it('sheds a money trail of coins along a beam', () => {
    const seen = land('Gold cash beam', 'beam', 0.6)
    expect(seen.motifs).toBeGreaterThan(0)
  })

  it('darkens the sky while a spirit bomb gathers', () => {
    const { seen, draw } = recorder()
    const r = composeRecipe('projectile', lookFor('Spirit Bomb', 'projectile'))
    for (const l of r.layers) if (l.phase === 'charge') draw.layer(l, r, from, 1, { dir })
    expect(seen.darken).toBe(1)
  })

  it('leaves afterimages, a streak or a chain along a movement skill’s way', () => {
    const way = (name: string, kind: Parameters<typeof composeRecipe>[0]) => {
      const { seen, draw } = recorder()
      const r = composeRecipe(kind, lookFor(name, kind))
      for (const l of r.layers) if (l.phase === 'travel') draw.path(l, r, 0, new THREE.Vector3(), new THREE.Vector3(0, 0, 6), 1.1)
      return seen
    }
    expect(way('Shadow clone dash', 'dash').ghosts).toBe(4)
    expect(way('Energy dash', 'dash').ribbons).toBe(1)
    expect(way('Chain hook', 'grapple').meshes.map((m) => m.kind)).toContain('chain')
  })
})
