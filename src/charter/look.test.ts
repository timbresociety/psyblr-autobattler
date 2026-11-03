import { describe, expect, it } from 'vitest'
import { proposeBuild, hydrateBuild, setLook } from './build.js'
import { FACE_POINTS, defaultLook, hslHex, hydrateLook, toHex } from './look.js'

const face = { url: '/dev-store/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', width: 512, height: 512, points: new Array(FACE_POINTS * 2).fill(100.04) }

describe('a hero’s look', () => {
  it('keeps only what it knows: a known gender, body colours, and a well-formed face', () => {
    const look = hydrateLook({ gender: 'f', hair: 'long', armour: true, cape: 'yes', colors: { suit: '#FF0000', skin: 'red', iris: '#00FF00', brow: '#123456' }, face, power: 9000 })
    expect(look).toEqual({ gender: 'f', colors: { iris: '#00ff00', brow: '#123456' }, face: { ...face, points: face.points.map(() => 100) } })
    expect(hydrateLook({ gender: 'x' })).toBeUndefined()
    // gear keeps well-formed pieces in the hands; the server checks they exist (src/server/gear.ts)
    const gear = { hand_r: { id: 'katana', url: '/kit/pieces/katana.glb', color: '#00FF00' }, tail: { id: 'x', url: '/kit/pieces/x.glb' }, head: { id: 'crown', url: '/kit/pieces/crown.glb' }, hand_l: { id: 'Bad Id', url: '/kit/pieces/shield.glb' } }
    expect(hydrateLook({ gender: 'm', colors: {}, gear })?.gear).toEqual({ hand_r: { id: 'katana', url: '/kit/pieces/katana.glb', color: '#00ff00' } })
    expect(hydrateLook({ gender: 'm', colors: {}, gear: { hand_r: { id: 'katana', url: 'https://evil.example/x.glb' } } })).not.toHaveProperty('gear')
    // a face with the wrong number of points, or points off the photo, is dropped; the rest of the look stays
    expect(hydrateLook({ gender: 'm', colors: {}, face: { ...face, points: [1, 2] } })?.face).toBeUndefined()
    expect(hydrateLook({ gender: 'm', colors: {}, face: { ...face, points: face.points.map(() => 9999) } })?.face).toBeUndefined()
  })

  it('rides on the build through storage, and changing it keeps the balance check', () => {
    const build = { ...proposeBuild({ heroName: 'Ada', roleId: 'mage', skills: {} }).build, gate: { state: 'ready' as const, winRate: 0.5 } }
    const dressed = setLook(build, { gender: 'f', colors: { skin: '#123456' } })
    expect(dressed.gate.state).toBe('ready')
    const back = hydrateBuild(JSON.parse(JSON.stringify(dressed)))
    expect(back.ok && back.build.look).toEqual(dressed.look)
  })

  it('defaults follow the role and name, bare, with colours that match three.js HSL', () => {
    const tank = defaultLook('tank', 'T', 0)
    expect(tank.gender).toBe('m')
    expect(Object.keys(tank).sort()).toEqual(['colors', 'gender'])
    expect(defaultLook('mage', 'M', 0).gender).toBe('f')
    expect(hslHex(0, 1, 0.5)).toBe('#ff0000')
    expect(hslHex(1 / 3, 1, 0.5)).toBe('#00ff00')
    expect(hslHex(0, 0, 0.5)).toBe('#808080')
    expect(toHex([1, 0.5, 0])).toBe('#ff8000')
  })

  it('loads a look saved with a wardrobe bare: its physique and the weapons in its hands, nothing worn', () => {
    const look = hydrateLook({
      gender: 'f',
      hair: 'curly',
      beard: 'goatee',
      armour: true,
      cape: true,
      colors: { hair: '#221100', cape: '#330000' },
      physique: { weight: 0.7, muscle: 0.2, age: 0.1 },
      wear: {
        full: { id: 'kimono', url: '/kit/wear/kimono.glb', colors: ['#AA0000'] },
        hair: { id: 'hair_long', url: '/kit/wear/hair_long.glb' },
        head: { id: 'top_hat', url: '/kit/pieces/top_hat.glb' },
        hand_r: { id: 'katana', url: '/kit/pieces/katana.glb', colors: ['#00FF00'] },
      },
    })
    expect(look).toEqual({ gender: 'f', colors: {}, physique: { weight: 0.7, muscle: 0.2, age: 0.1 }, gear: { hand_r: { id: 'katana', url: '/kit/pieces/katana.glb', color: '#00ff00' } } })
    expect(hydrateLook({ gender: 'm', colors: {}, physique: { weight: 2, muscle: 0, age: 0 } })).not.toHaveProperty('physique')
  })

  it('keeps how much of the photo the face takes', () => {
    expect(hydrateLook({ gender: 'm', colors: {}, face: { ...face, strength: 0.456 } })?.face?.strength).toBe(0.46)
    // all of the photo is the default, so it isn't written down
    expect(hydrateLook({ gender: 'm', colors: {}, face: { ...face, strength: 1 } })?.face).not.toHaveProperty('strength')
    expect(hydrateLook({ gender: 'm', colors: {}, face: { ...face, strength: -1 } })?.face).not.toHaveProperty('strength')
  })
})
