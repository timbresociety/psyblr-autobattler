import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ArmPiece } from '../../charter/look.js'
import { benchModel } from '../../kit/bench/model.js'
import { handFrames, hangArms, hangHands } from './arms.js'
import { GROW, HAND_RANGE, measureFit, MODELLED, pieceFit } from './fit.js'
import { hangSockets, type BodySockets } from './gear.js'
import type { LoadedKit } from './held.js'

const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'colossal'] as const

/**
 * A stick body with the modelled body's measures, its hands `hands` times as big and its frame `frame` times, skinned
 * so sockets can hang on it. `fingers: false` leaves the finger joints out, as a mesh with mitten hands might.
 */
function stick({ hands = 1, frame = 1, fingers = true, handScale = 1 } = {}) {
  const root = new THREE.Group()
  const bones: THREE.Bone[] = []
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const b = new THREE.Bone()
    b.name = name
    b.position.set(x, y, z)
    parent.add(b)
    bones.push(b)
    return b
  }
  // the back is 0.6 of the frame's length here and a leg 0.4
  const back = (MODELLED.frame * frame * 0.6) / 5
  const leg = (MODELLED.frame * frame * 0.4) / 2
  const hips = bone('Hips', root, 0, 1, 0)
  let up: THREE.Object3D = hips
  for (const name of ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head']) up = bone(name, up, 0, back)
  for (const side of ['Left', 'Right']) {
    const sign = side === 'Left' ? 1 : -1
    const thigh = bone(`${side}UpLeg`, hips, sign * 0.1, 0)
    bone(`${side}Foot`, bone(`${side}Leg`, thigh, 0, -leg), 0, -leg)
    const hand = bone(`${side}Hand`, hips, sign * 0.7, 0.4)
    hand.scale.setScalar(handScale)
    if (!fingers) continue
    const step = (MODELLED.hand * hands) / 4
    let finger: THREE.Object3D = hand
    for (let i = 1; i <= 4; i++) finger = bone(`${side}HandMiddle${i}`, finger, sign * step, 0)
    bone(`${side}HandIndex1`, hand, sign * step, 0, (MODELLED.palm * hands) / 2)
    bone(`${side}HandPinky1`, hand, sign * step, 0, (-MODELLED.palm * hands) / 2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial())
  root.add(mesh)
  root.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(bones))
  return root
}

const sockets: BodySockets = { hand_r: { bone: 'RightHand', pos: [-0.78, 1.4, 0] }, hand_l: { bone: 'LeftHand', pos: [0.78, 1.4, 0] } }
const worldScale = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false)
  return +o.getWorldScale(new THREE.Vector3()).x.toFixed(4)
}

describe('weapons sized to the hero (fit.ts)', () => {
  it('the modelled body is our medium body, and every body of ours has hands near it', async () => {
    const fits: Record<string, { hand: number; body: number }> = {}
    for (const g of ['m', 'f']) for (const size of SIZES) fits[`${g}-${size}`] = measureFit((await benchModel(`public/heroes/v2/${g}-${size}.glb`)).model)
    expect(fits['m-medium'].hand).toBeCloseTo(1, 2)
    expect(fits['m-medium'].body).toBeCloseTo(1, 2)
    for (const [name, fit] of Object.entries(fits)) {
      expect(fit.hand, name).toBeGreaterThan(0.8)
      expect(fit.hand, name).toBeLessThan(1.2)
    }
    // a small body's hands are big for it and a giant's small for it, so its pieces take a little more or less than its size
    expect(fits['m-tiny'].hand).toBeGreaterThan(fits['m-medium'].hand)
    expect(fits['m-colossal'].hand).toBeLessThan(fits['m-medium'].hand)
  })

  it('measures the hands by their length and breadth, whatever the pose or the scale it is drawn at', () => {
    expect(measureFit(stick()).hand).toBeCloseTo(1, 5)
    expect(measureFit(stick({ hands: 1.3, frame: 1.2 }))).toEqual({ hand: expect.closeTo(1.3, 5), body: expect.closeTo(1.2, 5) })
    const posed = stick({ hands: 1.3 })
    posed.scale.setScalar(1.6)
    posed.getObjectByName('RightHandMiddle2')!.rotation.z = 1.2
    posed.getObjectByName('Spine1')!.rotation.x = 0.6
    expect(measureFit(posed).hand).toBeCloseTo(1.3, 5)
    expect(measureFit(posed).body).toBeCloseTo(1, 5)
  })

  it("a physique's Hands dial scales the hand bone and its fingers with it, and what the hand holds follows", () => {
    // as proportions.ts leaves a body: the hand bone scaled, and the bind taken again with it
    const root = stick({ handScale: 1.25 })
    expect(measureFit(root).hand).toBeCloseTo(1.25, 5)
    expect(worldScale(hangSockets(root, sockets).hand_r!)).toBeCloseTo(1.25 ** GROW, 4)
  })

  it('falls back on the frame for hands with no fingers, and holds hands far off the frame to its range', () => {
    expect(measureFit(stick({ frame: 1.4, fingers: false })).hand).toBeCloseTo(1.4, 5)
    expect(measureFit(stick({ hands: 0.3 })).hand).toBeCloseTo(HAND_RANGE[0], 5)
    expect(measureFit(stick({ hands: 3, frame: 1.5 })).hand).toBeCloseTo(1.5 * HAND_RANGE[1], 5)
  })

  it("scales a body's hand sockets to its hands, about the grip", () => {
    const plain = hangSockets(stick(), sockets).hand_r!
    const big = hangSockets(stick({ hands: 1.3 }), sockets).hand_r!
    const small = hangSockets(stick({ hands: 0.8 }), sockets).hand_r!
    expect(worldScale(plain)).toBe(1)
    expect(worldScale(big)).toBeCloseTo(1.3 ** GROW, 4)
    expect(worldScale(small)).toBe(0.8)
    expect(big.position.toArray()).toEqual(plain.position.toArray())
  })

  it('grows a weapon less than a hand bigger than the modelled one, by the hand as it is drawn in the world', () => {
    // up to the modelled hand a piece is the hand's size; past it, the hand's to the power GROW
    expect(pieceFit(0.8)).toBeCloseTo(0.8, 6)
    expect(pieceFit(1)).toBe(1)
    expect(pieceFit(1.5)).toBeCloseTo(1.5 ** GROW, 6)
    expect(pieceFit(1.5)).toBeLessThan(1.5)
    // a body drawn at 1.6 with hands 0.955 of the modelled ones for its frame holds what a hero with hands 1.528 does
    expect(pieceFit(0.955, 1.6) * 1.6).toBeCloseTo(pieceFit(0.955 * 1.6), 6)
    // and a small body drawn at 0.8 is not grown for hands a little big for it
    expect(pieceFit(1.057, 0.8) * 0.8).toBeCloseTo(1.057 * 0.8, 6)
    const drawn = hangSockets(stick({ hands: 0.955 }), sockets, 1.6).hand_r!
    expect(worldScale(drawn) * 1.6).toBeCloseTo((0.955 * 1.6) ** GROW, 3)
  })

  it("puts a generated hero's hand sockets as deep in its palm as its own hands are, scaled as a piece is for them", () => {
    // the body the frames are read from has hands 0.9 of the modelled ones; the hero's are 1.35
    const kit = { pieces: new Map(), sockets, hands: handFrames(stick({ hands: 0.9 }), sockets) } as LoadedKit
    const hero = stick({ hands: 1.35 })
    hangHands(hero, kit)
    const socket = hero.getObjectByName('socket:hand_r')!
    expect(worldScale(socket)).toBeCloseTo(1.35 ** GROW, 4)
    // 0.08 m from the wrist on the body's hand, so 0.08 / 0.9 on the modelled one and 1.35 times that on the hero's
    expect(socket.position.length()).toBeCloseTo((0.08 / 0.9) * 1.35, 5)
  })

  it('keeps a weapon the size it is in the hand when it is put away, and sizes what no hand holds to the body', () => {
    const hero = stick({ hands: 1.3, frame: 1.2 })
    hero.scale.setScalar(1.6)
    hangSockets(hero, sockets)
    for (const slot of ['back', 'hip_l']) {
      const o = new THREE.Object3D()
      o.name = `socket:${slot}`
      hero.getObjectByName('Spine2')!.add(o)
    }
    const blade = new THREE.Group()
    blade.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.02).translate(0, 0.4, 0), new THREE.MeshBasicMaterial()))
    const quiver = new THREE.Group()
    quiver.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), new THREE.MeshBasicMaterial()))
    const kit = { pieces: new Map([['blade', { scene: blade, animations: [] }], ['quiver', { scene: quiver, animations: [] }]]), sockets } as unknown as LoadedKit
    const arms = [
      { piece: { id: 'blade', url: 'blade' }, use: 'melee', hand: 'hand_r', stow: 'back' },
      { piece: { id: 'quiver', url: 'quiver' }, use: 'ranged', stow: 'hip_l' },
    ] as unknown as ArmPiece[]
    const hung = hangArms(hero, arms, kit)!
    const piece = hero.getObjectByName('arm:blade')!
    expect(piece.parent?.name).toBe('socket:hand_r')
    const inHand = worldScale(piece)
    // the test body is scaled by hand, with no drawn scale given: the piece goes by its hands in its own space
    expect(inHand).toBeCloseTo(1.6 * 1.3 ** GROW, 4)
    hung.wield('ranged')
    expect(piece.parent?.name).toBe('socket:back')
    expect(worldScale(piece)).toBeCloseTo(inHand, 4)
    expect(worldScale(hero.getObjectByName('arm:quiver')!)).toBeCloseTo(1.6 * 1.2, 4)
  })
})
