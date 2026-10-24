import { describe, expect, it } from 'vitest'
import { proposeBuild, hydrateBuild, setLook } from './build.js'
import { FACE_POINTS, defaultLook, hslHex, hydrateLook, outfitOf, toHex } from './look.js'

const face = { url: '/dev-store/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', width: 512, height: 512, points: new Array(FACE_POINTS * 2).fill(100.04) }

describe('a hero’s look', () => {
  it('keeps only what it knows: a known gender, hair and colours, and a well-formed face', () => {
    const look = hydrateLook({ gender: 'f', hair: 'long', armour: true, cape: 'yes', colors: { suit: '#FF0000', skin: 'red', boot: '#00ff00', wings: '#123456' }, face, power: 9000 })
    expect(look).toEqual({ gender: 'f', hair: 'long', armour: true, cape: false, colors: { suit: '#ff0000', boot: '#00ff00' }, face: { ...face, points: face.points.map(() => 100) } })
    expect(hydrateLook({ gender: 'x' })).toBeUndefined()
    expect(hydrateLook({ gender: 'm', hair: 'mullet', colors: {} })?.hair).toBe('crop')
    // a beard is kept when it's one the bodies carry; none and unknown beards leave the field off
    expect(hydrateLook({ gender: 'm', hair: 'curly', beard: 'goatee', colors: {} })).toMatchObject({ hair: 'curly', beard: 'goatee' })
    expect(hydrateLook({ gender: 'm', beard: 'none', colors: {} })).not.toHaveProperty('beard')
    expect(hydrateLook({ gender: 'm', beard: 'handlebar', colors: {} })).not.toHaveProperty('beard')
    // gear keeps well-formed pieces in known slots; the server checks they exist (src/server/gear.ts)
    const gear = { hand_r: { id: 'katana', url: '/kit/pieces/katana.glb', color: '#00FF00' }, tail: { id: 'x', url: '/kit/pieces/x.glb' }, head: { id: 'crown', url: 'javascript:alert(1)' }, back: { id: 'Bad Id', url: '/kit/pieces/wings.glb' } }
    expect(hydrateLook({ gender: 'm', colors: {}, gear })?.gear).toEqual({ hand_r: { id: 'katana', url: '/kit/pieces/katana.glb', color: '#00ff00' } })
    expect(hydrateLook({ gender: 'm', colors: {}, gear: { head: { id: 'crown', url: 'https://evil.example/x.glb' } } })).not.toHaveProperty('gear')
    // a face with the wrong number of points, or points off the photo, is dropped; the rest of the look stays
    expect(hydrateLook({ gender: 'm', colors: {}, face: { ...face, points: [1, 2] } })?.face).toBeUndefined()
    expect(hydrateLook({ gender: 'm', colors: {}, face: { ...face, points: face.points.map(() => 9999) } })?.face).toBeUndefined()
  })

  it('rides on the build through storage, and changing it keeps the balance check', () => {
    const build = { ...proposeBuild({ heroName: 'Ada', roleId: 'mage', skills: {} }).build, gate: { state: 'ready' as const, winRate: 0.5 } }
    const dressed = setLook(build, { gender: 'f', hair: 'none', armour: false, cape: true, colors: { cape: '#123456' } })
    expect(dressed.gate.state).toBe('ready')
    const back = hydrateBuild(JSON.parse(JSON.stringify(dressed)))
    expect(back.ok && back.build.look).toEqual(dressed.look)
  })

  it('defaults follow the role and name, with colours that match three.js HSL', () => {
    expect(defaultLook('tank', 'T', 0)).toMatchObject({ gender: 'm', hair: 'helmet', armour: true, cape: true })
    expect(defaultLook('mage', 'M', 0).gender).toBe('f')
    expect(hslHex(0, 1, 0.5)).toBe('#ff0000')
    expect(hslHex(1 / 3, 1, 0.5)).toBe('#00ff00')
    expect(hslHex(0, 0, 0.5)).toBe('#808080')
    expect(toHex([1, 0.5, 0])).toBe('#ff8000')
  })

  it('reads the wardrobe: a physique, and well-formed items in known slots with their colours, finishes and cuts', () => {
    const look = hydrateLook({
      gender: 'f',
      colors: {},
      physique: { weight: 0.7, muscle: 0.2, age: 0.1 },
      wear: {
        full: { id: 'kimono', url: '/kit/wear/kimono.glb', colors: ['#AA0000', 'gold', null], finishes: ['silk', 'velvet'], knobs: { sleeve: 0.5, hem: 2, wings: 1 } },
        upper: { id: 'tee', url: '/kit/wear/tee.glb' },
        head: { id: 'kasa', url: 'https://evil.example/x.glb' },
        tail: { id: 'x', url: '/kit/wear/x.glb' },
        hand_r: { id: 'katana', url: '/kit/pieces/katana.glb' },
      },
    })
    expect(look?.physique).toEqual({ weight: 0.7, muscle: 0.2, age: 0.1 })
    // a full-body item replaces the upper one; bad colours and finishes become the item's own (null); bad knobs go
    expect(look?.wear).toEqual({
      full: { id: 'kimono', url: '/kit/wear/kimono.glb', colors: ['#aa0000', null, null], finishes: ['silk', null], knobs: { sleeve: 0.5 } },
      hand_r: { id: 'katana', url: '/kit/pieces/katana.glb' },
    })
    expect(hydrateLook({ gender: 'm', colors: {}, physique: { weight: 2, muscle: 0, age: 0 } })).not.toHaveProperty('physique')
  })

  it('dresses a look from before the wardrobe in wardrobe items, in its old colours', () => {
    const old = { gender: 'm' as const, hair: 'curly' as const, beard: 'goatee' as const, armour: true, cape: true, colors: { suit: '#112233', metal: '#c0a060', cape: '#330000', hair: '#221100', pants: '#000011', boot: '#100000' }, gear: { hand_r: { id: 'katana', url: '/kit/pieces/katana.glb', color: '#00ff00' } } }
    expect(outfitOf(old)).toEqual({
      hair: { id: 'hair_curly', url: '/kit/wear/hair_curly.glb', colors: ['#221100'] },
      beard: { id: 'beard_goatee', url: '/kit/wear/beard_goatee.glb', colors: ['#221100'] },
      upper: { id: 'breastplate', url: '/kit/wear/breastplate.glb', colors: ['#c0a060', '#112233'] },
      lower: { id: 'trousers', url: '/kit/wear/trousers.glb', colors: ['#000011'] },
      feet: { id: 'boots', url: '/kit/wear/boots.glb', colors: ['#100000'] },
      back: { id: 'cape', url: '/kit/wear/cape.glb', colors: ['#330000'] },
      hand_r: { id: 'katana', url: '/kit/pieces/katana.glb', colors: ['#00ff00'] },
    })
    // a wardrobe look wears its own
    const wear = { upper: { id: 'tee', url: '/kit/wear/tee.glb' } }
    expect(outfitOf({ ...old, wear })).toBe(wear)
  })
})
