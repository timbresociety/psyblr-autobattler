import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import { distanceScale, nearestToCentre, project, screenPoint, stickyTarget, type ScreenPoint } from './world'

// a 90° vertical field of view: at 10 m the screen spans 10 m up and down from centre, and twice that across at 2:1
const camera = () => {
  const c = new PerspectiveCamera(90, 2, 0.1, 400)
  c.updateMatrixWorld()
  return c
}
const W = 1000
const H = 500

describe('project (HUD world to screen)', () => {
  it('maps NDC to the layer’s pixels: centre, right, up', () => {
    const c = camera()
    const centre = project(c, 0, 0, -10, W, H, screenPoint())
    expect(centre).toMatchObject({ visible: true })
    expect(centre.x).toBeCloseTo(500)
    expect(centre.y).toBeCloseTo(250)
    expect(centre.depth).toBeCloseTo(10)
    // half of the half-width to the right, half of the half-height up
    const p = project(c, 10, 5, -10, W, H, screenPoint())
    expect(p.x).toBeCloseTo(750)
    expect(p.y).toBeCloseTo(125)
  })

  it('follows a moved camera: the arena’s opening view puts the centre spot mid-screen', () => {
    const c = new PerspectiveCamera(55, 1440 / 856, 0.1, 400)
    c.position.set(0, 13, -27)
    c.lookAt(0, 0, 0)
    c.updateMatrixWorld()
    const p = project(c, 0, 0, 0, 1440, 856, screenPoint())
    expect(p.visible).toBe(true)
    expect(p.x).toBeCloseTo(720)
    expect(p.y).toBeCloseTo(428)
    expect(p.depth).toBeCloseTo(Math.hypot(13, 27))
    // a hero's head 2.7 m up sits above the spot on screen, and a hero to the camera's right sits right of centre
    expect(project(c, 0, 2.7, 0, 1440, 856, screenPoint()).y).toBeLessThan(428)
    expect(project(c, -5, 0, 0, 1440, 856, screenPoint()).x).toBeGreaterThan(720)
  })

  it('hides points behind the camera, nearer than its near plane, or off screen', () => {
    const c = camera()
    expect(project(c, 0, 0, 10, W, H, screenPoint()).visible).toBe(false)
    expect(project(c, 0, 0, -0.05, W, H, screenPoint()).visible).toBe(false)
    expect(project(c, 30, 0, -10, W, H, screenPoint()).visible).toBe(false)
    expect(project(c, 0, -12, -10, W, H, screenPoint()).visible).toBe(false)
    // just past the edge still shows, so a bar slides off rather than popping
    expect(project(c, 20.5, 0, -10, W, H, screenPoint()).visible).toBe(true)
  })

  it('writes into the point it is given and allocates nothing new', () => {
    const out = screenPoint()
    expect(project(camera(), 0, 0, -5, W, H, out)).toBe(out)
  })

  it('shrinks with distance but keeps a floor', () => {
    expect(distanceScale(10)).toBeGreaterThan(distanceScale(30))
    expect(distanceScale(500)).toBe(0.62)
    expect(distanceScale(1)).toBe(1.05)
  })
})

describe('target under the crosshair', () => {
  const at = (x: number, y: number, visible = true): ScreenPoint => ({ x, y, depth: 10, visible })

  it('picks the visible point nearest the centre within 15% of the width', () => {
    const points = [at(530, 260), at(505, 255, false), at(900, 250), at(480, 240)]
    expect(nearestToCentre(points, [0, 1, 2, 3], W, H)).toBe(3)
    expect(nearestToCentre(points, [0, 2], W, H)).toBe(0)
    // 400 px out is past 150 px
    expect(nearestToCentre(points, [2], W, H)).toBeUndefined()
  })

  it('keeps its lock unless another enemy is clearly closer', () => {
    const points = [at(560, 250), at(550, 250)]
    // the held target stays: the other is closer, but not by enough
    expect(stickyTarget(points, [0, 1], 0, W, H)).toBe(0)
    points[1] = at(503, 250)
    expect(stickyTarget(points, [0, 1], 0, W, H)).toBe(1)
    // a target that leaves the screen lets go
    points[0] = at(560, 250, false)
    points[1] = at(600, 250)
    expect(stickyTarget(points, [0, 1], 0, W, H)).toBe(1)
  })
})
