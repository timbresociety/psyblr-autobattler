import { boneSet, girth, share, type Skeleton, type Skin } from './regions.js'

/**
 * The arm and leg spread a body needs (GAME.md §9.6 fix-ups): clips are made on a slim body, so on a bulky one an arm
 * hanging at the side runs through the ribs and the thighs through each other. Measured on the body at rest, in
 * radians: how far out from straight down the upper arm must swing for its elbow to clear the torso beside it, and
 * the thigh for its inner side to clear the middle. The runtime adds the difference from the body the clips were
 * made on (SPREAD_REF), so the reference body gets nothing and a slim one is never pinched in.
 */
export interface Spread {
  arm: number
  leg: number
}

/** The most a fix-up spreads, in radians: past this the pose reads as a different pose, not the same one on a wider body. */
export const SPREAD_MAX: Spread = { arm: (20 * Math.PI) / 180, leg: (8 * Math.PI) / 180 }

/**
 * What the medium bodies, which the clips are fitted to, measure (spread.test.ts checks these against the shipped
 * files). Rounded down a little, so the reference bodies stay at zero.
 */
export const SPREAD_REF: Readonly<Record<'m' | 'f', Spread>> = {
  m: { arm: 0, leg: 0 },
  f: { arm: 0.018, leg: 0 },
}

/** A little air between the limb and the body it clears, in metres. */
const GAP = 0.005
const TORSO = ['Hips', 'Spine', 'Spine1', 'Spine2']

const need = (clear: number, reach: number) => Math.asin(Math.min(1, Math.max(0, clear / Math.max(1e-3, reach))))

/** How far the torso reaches out to one side (+x for the left) at height `y`: the skin mostly on the torso within 3 cm of it. */
function torsoSide(skin: Skin, skeleton: Skeleton, y: number, sign: 1 | -1): number {
  const set = boneSet(skeleton, TORSO)
  const xs: number[] = []
  const n = skin.positions.length / 3
  for (let i = 0; i < n; i++) {
    if (skin.skin && !skin.skin[i]) continue
    if (Math.abs(skin.positions[i * 3 + 1] - y) > 0.03) continue
    const x = skin.positions[i * 3] * sign
    if (x <= 0 || share(skin, i, set) < 0.6) continue
    xs.push(x)
  }
  if (!xs.length) return 0
  xs.sort((a, b) => a - b)
  return xs[Math.floor(xs.length * 0.95)]
}

/** The spread this body needs at rest, averaged over its two sides. */
export function bodySpread(skin: Skin, skeleton: Skeleton): Spread {
  const r = skeleton.rest
  const side = (s: 'Left' | 'Right', sign: 1 | -1): Spread => {
    const shoulder = r[`${s}Arm`]
    const elbow = r[`${s}ForeArm`]
    const hip = r[`${s}UpLeg`]
    const knee = r[`${s}Leg`]
    // the arm hanging straight down from the shoulder: its elbow a whole upper arm below it
    const upper = Math.hypot(elbow[0] - shoulder[0], elbow[1] - shoulder[1], elbow[2] - shoulder[2])
    const armRadius = girth(skin, skeleton, `${s}Arm`, `${s}ForeArm`, 0.6)
    const torso = torsoSide(skin, skeleton, shoulder[1] - upper, sign)
    const arm = need(torso + armRadius + GAP - Math.abs(shoulder[0]), upper)
    // the thigh a third of the way down, where the inner thighs meet first
    const thigh = Math.hypot(knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2])
    const legRadius = girth(skin, skeleton, `${s}UpLeg`, `${s}Leg`, 0.35)
    const leg = need(legRadius + GAP - Math.abs(hip[0]), thigh * 0.35)
    return { arm, leg }
  }
  const l = side('Left', 1)
  const rr = side('Right', -1)
  return { arm: (l.arm + rr.arm) / 2, leg: (l.leg + rr.leg) / 2 }
}

/** The spread to add on this body: what it needs past the reference body, up to SPREAD_MAX. */
export function extraSpread(body: Spread, gender: 'm' | 'f'): Spread {
  const ref = SPREAD_REF[gender]
  return { arm: Math.min(SPREAD_MAX.arm, Math.max(0, body.arm - ref.arm)), leg: Math.min(SPREAD_MAX.leg, Math.max(0, body.leg - ref.leg)) }
}

/**
 * How much of the spread a limb takes as posed: all of it hanging straight down, none once it is level or raised (a
 * punch or a cast is the clip's own and already clear). `down` is the limb's direction's share straight down, -1..1.
 */
export const hangShare = (down: number) => Math.min(1, Math.max(0, down * 1.4 - 0.4))
