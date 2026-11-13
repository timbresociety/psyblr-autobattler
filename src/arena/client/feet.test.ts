import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PLANT, hipYaw, legReach, levelToes, planter } from './feet.js'

/** A leg hanging from a hip a metre up: a 0.45 m thigh, a 0.45 m shin with the knee bent a little forward (+z), a foot. */
function leg() {
  const body = new THREE.Group()
  const thigh = new THREE.Object3D()
  thigh.position.set(0.1, 1, 0)
  const shin = new THREE.Object3D()
  shin.position.set(0, -0.45, 0.02)
  const foot = new THREE.Object3D()
  foot.position.set(0, -0.45, -0.02)
  body.add(thigh)
  thigh.add(shin)
  shin.add(foot)
  body.updateMatrixWorld(true)
  return { body, thigh, shin, foot }
}
const at = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
const ahead = new THREE.Vector3(0, 0, 1)

describe('a leg reaching for where its foot is pinned (Forge goal, phase 2)', () => {
  it('puts the ankle on the target, keeping both bones their length and the knee bent forward', () => {
    const { thigh, shin, foot } = leg()
    const target = new THREE.Vector3(0.18, 0.25, -0.12)
    legReach(thigh, shin, foot, target, ahead)
    expect(at(foot).distanceTo(target)).toBeLessThan(1e-4)
    expect(at(thigh).distanceTo(at(shin))).toBeCloseTo(Math.hypot(0.45, 0.02), 5)
    expect(at(shin).distanceTo(at(foot))).toBeCloseTo(Math.hypot(0.45, 0.02), 5)
    // the knee sits in front of the line from hip to ankle
    const hip = at(thigh)
    const line = at(foot).sub(hip).normalize()
    const knee = at(shin).sub(hip)
    expect(knee.addScaledVector(line, -knee.dot(line)).z).toBeGreaterThan(0)
  })

  it('straightens toward a target out of reach', () => {
    const { thigh, shin, foot } = leg()
    legReach(thigh, shin, foot, new THREE.Vector3(0.1, -1, 0), ahead)
    expect(at(foot).y).toBeCloseTo(1 - 2 * Math.hypot(0.45, 0.02), 3)
  })

  it('reads which way hips face from where the legs join them: the right leg on the -x side, facing +z', () => {
    expect(hipYaw(new THREE.Vector3(0.1, 1, 0), new THREE.Vector3(-0.1, 1, 0))).toBeCloseTo(0)
    expect(hipYaw(new THREE.Vector3(0, 1, -0.1), new THREE.Vector3(0, 1, 0.1))).toBeCloseTo(Math.PI / 2)
  })
})

describe('feet that stay where they land (Forge goal, phase 2)', () => {
  const frame = 1 / 60
  const run = (seconds: number, step: (out: THREE.Vector3[]) => void) => {
    const out = [new THREE.Vector3(), new THREE.Vector3()]
    for (let t = 0; t < seconds; t += frame) step(out)
    return out
  }

  it('pins each foot where it was as the pose leans over it, and lets go as the hero moves off', () => {
    const feet = planter()
    const wants = [new THREE.Vector3(0.1, 0.07, 0), new THREE.Vector3(-0.1, 0.07, 0)]
    run(PLANT.blend, (out) => feet.place(wants, 0, frame, true, out))
    // a cast's stance pulls one foot 30 cm back: within reach, so it stays put, at the height the pose gives it
    wants[1].set(-0.1, 0.05, -0.3)
    const out = run(0.5, (o) => feet.place(wants, 0, frame, true, o))
    expect(out[1].x).toBeCloseTo(-0.1)
    expect(out[1].z).toBeCloseTo(0)
    expect(out[1].y).toBeCloseTo(0.05)
    // moving off, the feet ease back to the pose over the blend, and then it stands as it is
    const off = [new THREE.Vector3(), new THREE.Vector3()]
    expect(feet.place(wants, 0, frame, false, off)).toBe(true)
    expect(off[1].z).toBeLessThan(0)
    expect(off[1].z).toBeGreaterThan(-0.3)
    let frames = 1
    while (feet.place(wants, 0, frame, false, off)) frames++
    expect(frames).toBeLessThanOrEqual(Math.ceil(PLANT.blend / frame) + 1)
  })

  it("follows a tagged clip's plants: a lifted foot goes with the clip and plants where it comes down (GAME.md §12)", () => {
    const feet = planter()
    const wants = [new THREE.Vector3(0.1, 0.07, 0), new THREE.Vector3(-0.1, 0.07, 0)]
    run(PLANT.blend, (out) => feet.place(wants, 0, frame, true, out, [true, true]))
    // a kick: the right foot leaves the floor and swings 60 cm ahead, far past a step's reach, and goes where the clip puts it
    wants[1].set(-0.1, 0.6, 0.6)
    let out = run(0.2, (o) => feet.place(wants, 0, frame, true, o, [true, false]))
    expect(out[1].z).toBeCloseTo(0.6)
    expect(out[1].y).toBeCloseTo(0.6)
    // the left foot, still down, held where it stood though the pose drifts it
    wants[0].set(0.1, 0.07, 0.15)
    out = run(0.1, (o) => feet.place(wants, 0, frame, true, o, [true, false]))
    expect(out[0].z).toBeCloseTo(0)
    // the kick comes down 40 cm ahead and stays there as the pose pulls the leg back
    wants[1].set(-0.1, 0.07, 0.4)
    run(frame, (o) => feet.place(wants, 0, frame, true, o, [true, true]))
    wants[1].set(-0.1, 0.07, 0.2)
    out = run(0.3, (o) => feet.place(wants, 0, frame, true, o, [true, true]))
    expect(out[1].z).toBeCloseTo(0.4)
  })

  it('steps a foot pulled out of reach, lifting it on the way, and one foot at a time', () => {
    const feet = planter()
    const wants = [new THREE.Vector3(0.1, 0.07, 0), new THREE.Vector3(-0.1, 0.07, 0)]
    run(PLANT.blend, (out) => feet.place(wants, 0, frame, true, out))
    // a lunge: both feet wanted half a metre ahead
    wants[0].z = 0.5
    wants[1].z = 0.5
    const heights: number[] = []
    const moved: boolean[] = []
    const out = run(PLANT.step / 2, (o) => {
      feet.place(wants, 0, frame, true, o)
      heights.push(o[0].y)
      moved.push(o[1].z > 0)
    })
    expect(Math.max(...heights)).toBeGreaterThan(0.07 + 0.02)
    expect(moved.some(Boolean)).toBe(false)
    // the first lands, then the second goes
    run(PLANT.step * 2.2, (o) => feet.place(wants, 0, frame, true, o))
    expect(out[0].z).toBeGreaterThan(0)
    const done = run(frame, (o) => feet.place(wants, 0, frame, true, o))
    expect(done[0].z).toBeCloseTo(0.5)
    expect(done[1].z).toBeCloseTo(0.5)
    expect(done[1].y).toBeCloseTo(0.07)
  })

  it('steps round as the hips turn over a pinned foot', () => {
    const feet = planter()
    const wants = [new THREE.Vector3(0.1, 0.07, 0), new THREE.Vector3(-0.1, 0.07, 0)]
    run(PLANT.blend, (out) => feet.place(wants, 0, frame, true, out))
    // turned 45 degrees on the spot: the feet are wanted only a few centimetres away, but the hips are past the limit
    const yaw = Math.PI / 4
    wants[0].set(0.1 * Math.cos(yaw), 0.07, -0.1 * Math.sin(yaw))
    wants[1].set(-0.1 * Math.cos(yaw), 0.07, 0.1 * Math.sin(yaw))
    const done = run(PLANT.step * 2 + 4 * frame, (o) => feet.place(wants, yaw, frame, true, o))
    expect(done[0].distanceTo(wants[0])).toBeLessThan(1e-6)
    expect(done[1].distanceTo(wants[1])).toBeLessThan(1e-6)
  })

  it('plants afresh where a hero lands after jumping across the ground', () => {
    const feet = planter()
    const wants = [new THREE.Vector3(0.1, 0.07, 0), new THREE.Vector3(-0.1, 0.07, 0)]
    run(PLANT.blend, (out) => feet.place(wants, 0, frame, true, out))
    wants.forEach((w) => (w.x += 5))
    const out = run(frame, (o) => feet.place(wants, 0, frame, true, o))
    expect(out[0].x).toBeCloseTo(5.1)
  })
})

describe('toes kept out of the floor (clip audit 2026-11-05, fault 2)', () => {
  /** A long foot on a grown body: the ankle 9 cm up, the ball 18 cm ahead, the tip 8 cm further, tipped toe down. */
  function foot(tip: number) {
    const ground = new THREE.Group()
    ground.position.set(3, 0.5, -2)
    ground.scale.setScalar(2)
    ground.rotation.y = 0.7
    const ankle = new THREE.Object3D()
    ankle.position.set(0, 0.09, 0)
    const ball = new THREE.Object3D()
    ball.position.set(0, -0.06, 0.17)
    const end = new THREE.Object3D()
    end.position.set(0, -0.005, 0.08)
    ground.add(ankle)
    ankle.add(ball)
    ball.add(end)
    ankle.rotation.x = tip
    ground.updateMatrixWorld(true)
    const height = (o: THREE.Object3D) => ground.worldToLocal(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)).y
    return { ground, ankle, ball, end, height }
  }
  const rest = [0.03, 0.025]

  it('turns a foot whose toes go under the floor up about its ankle, until the lower joint stands at its rest height', () => {
    // the heel up: the toes 6 to 9 cm under the floor
    const f = foot(0.6)
    expect(Math.min(f.height(f.ball), f.height(f.end))).toBeLessThan(0)
    const ankle = f.ankle.getWorldPosition(new THREE.Vector3())
    expect(levelToes(f.ankle, [f.ball, f.end], rest, f.ground)).toBe(true)
    expect(Math.min(f.height(f.ball) - rest[0], f.height(f.end) - rest[1])).toBeCloseTo(0, 4)
    // the ankle stays where it was
    expect(f.ankle.getWorldPosition(new THREE.Vector3()).distanceTo(ankle)).toBeLessThan(1e-6)
  })

  it('leaves a foot alone whose toes are clear of the floor', () => {
    const f = foot(-0.2)
    const before = f.ankle.quaternion.clone()
    expect(levelToes(f.ankle, [f.ball, f.end], rest, f.ground)).toBe(false)
    expect(f.ankle.quaternion.equals(before)).toBe(true)
  })
})
