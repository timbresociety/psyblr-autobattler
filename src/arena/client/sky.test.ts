import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FILL, skyProbe } from './sky.js'

/** What the hemisphere light and the bounce light gave a surface facing `n`, before the probe took their place. */
function lit(n: THREE.Vector3): THREE.Color {
  const sky = new THREE.Color(FILL.sky).multiplyScalar(FILL.hemisphere)
  const ground = new THREE.Color(FILL.ground).multiplyScalar(FILL.hemisphere)
  const bounce = new THREE.Color(FILL.bounce).multiplyScalar(FILL.bounceIntensity * Math.max(0, n.dot(FILL.bounceFrom)))
  return ground.lerp(sky, 0.5 * n.y + 0.5).add(bounce)
}

describe('the sky in a light probe (GAME.md §10)', () => {
  // nine harmonics hold the sky's top-to-bottom blend exactly; the bounce's cosine lobe they round off by a few percent
  it('lights every way a surface can face as the two fill lights did, to within 4% of the brightest', () => {
    const probe = skyProbe()
    const got = new THREE.Vector3()
    const top = lit(FILL.bounceFrom)
    const brightest = top.r + top.g + top.b
    const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 1], [-1, 0.3, 0.5]]
    dirs.push(FILL.bounceFrom.toArray(), FILL.bounceFrom.clone().negate().toArray())
    for (const d of dirs) {
      const n = new THREE.Vector3(...(d as [number, number, number])).normalize()
      probe.sh.getIrradianceAt(n, got)
      const want = lit(n)
      expect(Math.abs(got.x + got.y + got.z - (want.r + want.g + want.b))).toBeLessThan(0.04 * brightest)
    }
  })
})
