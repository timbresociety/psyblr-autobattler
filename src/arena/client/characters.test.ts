import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { getTemplate } from '../../charter/templates/catalog.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { DEMO_HEROES, demoBuild } from '../demo/roster.js'
import { BODIES, bodyFor, characterLook, classicCharacterMaterial, HERO_MODELS, modelFor, paintGeometry, paintModel } from './character-look.js'
import { castClip } from './characters.js'

describe('a hero’s look', () => {
  it('is the same wherever the hero fights: it follows the name, not the slot or side', () => {
    const a = characterLook(defaultBuild('fighter', 'Ada'), 0.3)
    const b = characterLook(defaultBuild('fighter', 'Ada'), 0.3)
    expect(b.hair).toBe(a.hair)
    expect(b.colors.skin.getHex()).toBe(a.colors.skin.getHex())
  })

  it('dresses by role when it has no look: tanks in a helmet and armour, fighters caped and armoured, marksmen bare-headed', () => {
    const tank = characterLook(defaultBuild('tank', 'T'), 0)
    expect(tank).toMatchObject({ build: 'm-medium', hair: 'helmet', armour: true, cape: true })
    expect(characterLook(defaultBuild('fighter', 'F'), 0)).toMatchObject({ build: 'm-medium', armour: true, cape: true })
    const marksman = characterLook(defaultBuild('marksman', 'M'), 0)
    expect(marksman).toMatchObject({ build: 'm-medium', armour: false, cape: false })
    expect(marksman.hair).not.toBe('helmet')
    expect(characterLook(defaultBuild('mage', 'Mi'), 0).build).toBe('f-medium')
  })

  it('wears the body for its size: a huge hero a huge body, not a medium one scaled up', () => {
    expect(characterLook({ ...defaultBuild('fighter', 'Big'), sizeClass: 'huge' }, 0).build).toBe('m-huge')
    expect(characterLook({ ...defaultBuild('mage', 'Small'), sizeClass: 'tiny' }, 0).build).toBe('f-tiny')
    expect(bodyFor(defaultBuild('tank', 'T'), 'colossal')).toBe('m-colossal')
    expect(BODIES).toHaveLength(12)
  })

  it('its look picks the gender, hair, parts and colours, and carries its photo face', () => {
    const face = { url: '/dev-store/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', width: 512, height: 512, points: new Array(956).fill(10) }
    const build = { ...defaultBuild('tank', 'Ada'), look: { gender: 'f' as const, hair: 'long' as const, armour: false, cape: true, colors: { suit: '#ff0000', skin: '#8a5a3c' }, face } }
    const look = characterLook(build, 0.2)
    expect(look).toMatchObject({ build: 'f-medium', hair: 'long', armour: false, cape: true, face })
    expect(look.colors.suit.getHexString()).toBe('ff0000')
    expect(look.colors.skin.getHexString()).toBe('8a5a3c')
  })
})

describe('the demo roster’s own models', () => {
  it('gives every demo hero its own model, and anyone else a generic body for the role', () => {
    for (const hero of DEMO_HEROES) expect(characterLook(demoBuild(hero), hero.hue).build).toBe(modelFor(hero.heroName))
    expect(new Set(Object.values(HERO_MODELS)).size).toBe(DEMO_HEROES.length)
    expect(characterLook(defaultBuild('marksman', 'Ada'), 0.2).build).toBe('m-medium')
    // a demo hero keeps its own model whatever look it is given
    const demo = DEMO_HEROES[0]
    expect(characterLook({ ...demoBuild(demo), look: { gender: 'f', hair: 'none', armour: false, cape: false, colors: { suit: '#00ff00' } } }, demo.hue).build).toBe(modelFor(demo.heroName))
  })
})

describe('painting a build for one hero', () => {
  // one triangle per (region, part); glTF flips v on export, so part p is stored as v = 1 - p - 0.5
  const triangle = (region: number, part: number) => {
    const v = 1 - part - 0.5
    return { uv: [region + 0.5, v, region + 0.5, v, region + 0.5, v] }
  }
  const source = () => {
    const tris = [triangle(0, 0), triangle(1, 0), triangle(6, 1), triangle(6, 4), triangle(7, 5), triangle(11, 6)]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(tris.length * 9).fill(0), 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(tris.flatMap((t) => t.uv), 2))
    g.setIndex(tris.flatMap((_, i) => [i * 3, i * 3 + 1, i * 3 + 2]))
    return g
  }

  it('with a photo face the skin is baked into the hero\'s own atlas, so its vertices stay untinted', () => {
    const face = { url: '/dev-store/heroes/x.webp', width: 1, height: 1, points: [] }
    const look = characterLook(defaultBuild('marksman', 'M'), 0.6)
    const g = paintGeometry(source(), { ...look, face, hair: 'crop', armour: false, cape: false })
    const color = g.getAttribute('color')
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual([1, 1, 1])
  })

  it('keeps only the parts the hero wears and colours each region', () => {
    const look = characterLook(defaultBuild('marksman', 'M'), 0.6)
    const g = paintGeometry(source(), { ...look, hair: 'crop', armour: false, cape: false })
    // base skin, base suit and the crop hair stay; the helmet, the armour and the cape go
    expect(Array.from(g.getIndex()!.array)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    const color = g.getAttribute('color')
    const at = (i: number) => new THREE.Color(color.getX(i), color.getY(i), color.getZ(i))
    // colours are stored as 32-bit floats
    expect(at(0).getHex()).toBe(look.colors.skin.getHex())
    expect(at(3).getHex()).toBe(look.colors.suit.getHex())
  })

  it('shows the helmet, armour and cape on a hero dressed for them', () => {
    const look = characterLook(defaultBuild('tank', 'T'), 0.1)
    const g = paintGeometry(source(), look)
    expect(g.getIndex()!.count / 3).toBe(5)
  })

  it('shows the hair style and beard it chose and none of the others', () => {
    // parts 7 to 15 came after the first seven, so older models keep their indices: 9 is curly hair, 13 a full beard, 14 a goatee
    const tris = [triangle(0, 0), triangle(6, 9), triangle(6, 11), triangle(6, 13), triangle(6, 14)]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(tris.length * 9).fill(0), 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(tris.flatMap((t) => t.uv), 2))
    g.setIndex(tris.flatMap((_, i) => [i * 3, i * 3 + 1, i * 3 + 2]))
    const look = characterLook(defaultBuild('marksman', 'M'), 0.6)
    const kept = (beard: typeof look.beard) => Array.from(paintGeometry(g, { ...look, hair: 'curly', beard, armour: false, cape: false }).getIndex()!.array)
    expect(kept('goatee')).toEqual([0, 1, 2, 3, 4, 5, 12, 13, 14])
    expect(kept('none')).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('which clip a cast plays', () => {
  it('swings for close skills, shoots a basic projectile, casts the rest, and plays the ultimate as its own', () => {
    const marksman = defaultBuild('marksman', 'M')
    const fighter = defaultBuild('fighter', 'F')
    expect(castClip(marksman, 'ultimate')).toBe('ultimate')
    const kindOf = (b: typeof marksman, slot: 'basic' | 'active1') => getTemplate(b.slots[slot].templateId).delivery.kind
    if (kindOf(marksman, 'basic') === 'projectile') expect(castClip(marksman, 'basic')).toBe('shoot')
    if (kindOf(fighter, 'basic') === 'melee') expect(castClip(fighter, 'basic')).toBe('slash')
    expect(['slash', 'shoot', 'cast']).toContain(castClip(fighter, 'active1'))
  })
})

describe('painting a textured model', () => {
  // the atlas rides the first UV set; regions and parts ride the second
  const source = () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(18).fill(0), 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0.25), 2))
    // a baked triangle (region 12) and an accent triangle in the hero's suit colour (region 1)
    const meta = [12.5, 0.5, 12.5, 0.5, 12.5, 0.5, 1.5, 0.5, 1.5, 0.5, 1.5, 0.5]
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(meta, 2))
    g.setIndex([0, 1, 2, 3, 4, 5])
    return g
  }

  it('keeps the texture’s own colour on baked regions and tints the accents', () => {
    const look = characterLook(defaultBuild('fighter', 'F'), 0.4)
    const g = paintGeometry(source(), look)
    const color = g.getAttribute('color')
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual([1, 1, 1])
    expect(new THREE.Color(color.getX(3), color.getY(3), color.getZ(3)).getHex()).toBe(look.colors.suit.getHex())
    expect(g.getIndex()!.count).toBe(6)
    // the atlas UVs pass through untouched
    expect(g.getAttribute('uv').getX(0)).toBeCloseTo(0.25)
  })
})

describe('repainting a loaded model', () => {
  it('keeps the atlas and the relief, with glTF’s normal convention', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(6).fill(0.5), 2))
    g.setAttribute('uv1', new THREE.Float32BufferAttribute([12.5, 0.5, 12.5, 0.5, 12.5, 0.5], 2))
    g.setIndex([0, 1, 2])
    const map = new THREE.Texture()
    const normalMap = new THREE.Texture()
    const source = new THREE.MeshStandardMaterial({ map, normalMap })
    source.normalScale.set(1, -1)
    const mesh = new THREE.SkinnedMesh(g, source)
    const root = new THREE.Group().add(mesh)
    paintModel(root, characterLook(defaultBuild('tank', 'T'), 0.1), classicCharacterMaterial)
    const painted = mesh.material as THREE.MeshStandardMaterial
    expect(painted).not.toBe(source)
    expect(painted.map).toBe(map)
    expect(painted.normalMap).toBe(normalMap)
    expect(painted.normalScale.y).toBe(-1)
  })
})
