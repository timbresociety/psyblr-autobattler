import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FORM_ENTRIES, type TransformationLook } from '../../../charter/skill-look.js'
import { composeRecipe } from '../../recipes/defaults.js'
import { formLookOf, lookFor } from '../../recipes/looks.js'
import type { MeshKind } from './draw.js'
import { createForms, formColor, type FormBodyAt, type FormKit } from './forms.js'
import type { Ribbon } from './vfx.js'

/** A kit that draws nothing and remembers what it was asked for. Meshes keep their update, to run it later. */
function recorder() {
  const seen = {
    meshes: [] as { kind: MeshKind; mesh: THREE.Mesh; update: (p: number, m: THREE.Mesh) => void }[],
    ribbons: 0,
    tails: [] as Ribbon[],
    ended: [] as Ribbon[],
    sprites: 0,
    flashes: 0,
    darken: 0,
    shake: 0,
    ghosts: 0,
  }
  const kit: FormKit = {
    camera: () => new THREE.PerspectiveCamera(),
    show: (kind, _c, _duration, place, update) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true }))
      place(mesh)
      seen.meshes.push({ kind, mesh, update })
    },
    sparkle: (spec) => void (seen.sprites += spec.count),
    puff: (spec) => void (seen.sprites += spec.count),
    motif: () => {},
    ribbon: () => void seen.ribbons++,
    later: (_seconds, fn) => fn(),
    shake: (amount) => void (seen.shake = Math.max(seen.shake, amount)),
    darken: () => void seen.darken++,
    ghost: () => void seen.ghosts++,
    flash: () => void seen.flashes++,
    sparks: () => {},
    tail: (path, color, width, life) => {
      const ribbon: Ribbon = { path, color, width, born: 0, life, points: path.points ?? 16, taper: true, flicker: false, steady: true, live: true }
      seen.tails.push(ribbon)
      return ribbon
    },
    endTail: (ribbon) => void seen.ended.push(ribbon),
  }
  return { seen, forms: createForms(kit) }
}

/** A hero standing at the origin facing +z, its capsule changeable as a transformation would change it. */
function hero() {
  const state = { at: new THREE.Vector3(), cap: { radius: 0.5, height: 2 }, yaw: 0 }
  const body: FormBodyAt = { feet: () => state.at.clone(), capsule: () => state.cap, yaw: () => state.yaw }
  return { state, body }
}

const recipe = composeRecipe('self', lookFor('Fire aura', 'self'))
const run = (forms: ReturnType<typeof createForms>, seconds: number, each?: () => void) => {
  for (let k = 0; k < Math.round(seconds * 60); k++) {
    each?.()
    forms.frame(1 / 60)
  }
}
const point = (ribbon: Ribbon, i: number) => {
  const out = new THREE.Vector3()
  ribbon.path(i, ribbon.points, 0, out)
  return out
}

describe('transformations as the audience sees them (R23)', () => {
  it('arrives six different ways', () => {
    const drawn = FORM_ENTRIES.map((entry) => {
      const { seen, forms } = recorder()
      forms.start(0, { entry }, recipe, 8, hero().body)
      return { entry, seen, signature: `${seen.meshes.map((m) => m.kind).join(',')}|${seen.ribbons}|${seen.darken}|${seen.flashes}` }
    })
    expect(new Set(drawn.map((d) => d.signature)).size).toBe(FORM_ENTRIES.length)
    const of = (entry: string) => drawn.find((d) => d.entry === entry)!.seen
    // a strike comes down from a darkened sky; a burst blows a shell out past the body and an implosion shrinks one onto it
    expect(of('strike').darken).toBe(1)
    expect(of('strike').ribbons).toBeGreaterThanOrEqual(2)
    const shell = (entry: string) => {
      const m = of(entry).meshes.find((x) => x.kind === 'shell')!
      m.update(0, m.mesh)
      const start = m.mesh.scale.x
      m.update(0.9, m.mesh)
      return m.mesh.scale.x / start
    }
    expect(shell('burst')).toBeGreaterThan(2)
    expect(shell('implode')).toBeLessThan(0.5)
  })

  it('surrounds the hero at its aura rate while the form lasts, and nothing at all without one', () => {
    const aura = (look: TransformationLook) => {
      const { seen, forms } = recorder()
      forms.start(0, look, recipe, 8, hero().body)
      const arrival = seen.sprites
      run(forms, 1)
      return seen.sprites - arrival
    }
    const flame = aura({ entry: 'burst', aura: 'flame' })
    expect(flame).toBeGreaterThanOrEqual(45)
    expect(aura({ entry: 'burst', aura: 'steam' })).toBeLessThan(flame / 3)
    expect(aura(formLookOf(lookFor('Ant-Man')))).toBe(0)
  })

  it("streaks behind a moving Ant-Man and leaves nothing while he stands", () => {
    const { seen, forms } = recorder()
    const { state, body } = hero()
    state.cap = { radius: 0.3, height: 1.1 }
    forms.start(0, formLookOf(lookFor('Ant-Man')), recipe, 8, body)
    const arrival = seen.ribbons
    run(forms, 0.5)
    expect(seen.ribbons).toBe(arrival)
    run(forms, 0.5, () => (state.at.z += 0.15))
    expect(seen.ribbons - arrival).toBeGreaterThan(20)
  })

  it('grows nine tails from the small of the back that sweep behind a running hero, and fade when the form ends', () => {
    const { seen, forms } = recorder()
    const { state, body } = hero()
    forms.start(3, formLookOf(lookFor('Nine-Tails')), recipe, 8, body)
    expect(seen.tails).toHaveLength(9)
    for (const tail of seen.tails) {
      const root = point(tail, 0)
      // behind the body (it faces +z), at the small of the back, and no wider than the body itself
      expect(root.z).toBeLessThan(0)
      expect(root.y).toBeCloseTo(state.cap.height * 0.48, 5)
      expect(tail.width).toBeLessThanOrEqual(state.cap.radius)
    }
    run(forms, 1, () => (state.at.z += 0.12))
    for (const tail of seen.tails) expect(point(tail, tail.points - 1).z).toBeLessThan(point(tail, 0).z)
    forms.end(3)
    expect(seen.ended).toEqual(seen.tails)
    expect(forms.has(3)).toBe(false)
  })

  it('fills the hitbox exactly with a spirit body as the capsule changes, and lets it go when the form ends', () => {
    const { seen, forms } = recorder()
    const { state, body } = hero()
    forms.start(1, formLookOf(lookFor('Susanoo')), recipe, 8, body)
    const spirit = seen.meshes.find((m) => m.kind === 'form')!
    state.at.set(2, 0, -1)
    state.cap = { radius: 0.9, height: 3.4 }
    spirit.update(0.5, spirit.mesh)
    expect(spirit.mesh.scale.toArray()).toEqual([0.9, 1.7, 0.9])
    expect(spirit.mesh.position.toArray()).toEqual([2, 1.7, -1])
    expect((spirit.mesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.3)
    forms.end(1)
    spirit.update(0.6, spirit.mesh)
    expect((spirit.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0)
  })

  it('draws a form in the richest colour of its palette, never in its pale core', () => {
    const hex = (move: string) => formColor(composeRecipe('self', lookFor(move, 'self'))).getHexString(THREE.SRGBColorSpace)
    expect(hex('Nine-Tails')).toBe('ff4a00')
    expect(hex('Super Saiyan')).toBe('ffb300')
    expect(hex('Titan')).toBe('ff7a1a')
  })

  it('replaces a form that is still running, quietly, so a hero never wears two', () => {
    const { seen, forms } = recorder()
    const { body } = hero()
    forms.start(0, formLookOf(lookFor('Nine-Tails')), recipe, 8, body)
    const flashes = seen.flashes
    forms.start(0, formLookOf(lookFor('Nine-Tails')), recipe, 8, body)
    expect(seen.ended).toHaveLength(9)
    expect(forms.live()).toBe(1)
    // the second arrival flashes; the first form's end does not
    expect(seen.flashes - flashes).toBe(1)
  })
})
