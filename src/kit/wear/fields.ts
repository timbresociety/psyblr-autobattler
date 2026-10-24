/**
 * Where each point of the body sits, as the knobs measure it: how far down the arm (0 at the shoulder, 0.5 at the
 * elbow, 1 at the wrist), down the leg (hip, knee, ankle) and up the torso (0 at the crotch, 1 at the base of the
 * neck). A bound vertex reads them through its triangle, so "sleeves to the elbow" cuts any item, built in or
 * generated, at the same place on every body.
 */

type V3 = [number, number, number]

export interface BodyFields {
  arm: Float32Array
  leg: Float32Array
  hem: Float32Array
}

/** The rig's bones the fields follow (tools/blender/humanlib's rig). */
const ARM = { L: ['upper_arm_L', 'forearm_L', 'hand_L'], R: ['upper_arm_R', 'forearm_R', 'hand_R'] } as const
const LEG = { L: ['thigh_L', 'shin_L', 'foot_L'], R: ['thigh_R', 'shin_R', 'foot_R'] } as const

/** Where p falls along the chain a → b → c: 0 at a, 0.5 at b, 1 at c, past 1 beyond c; never below 0. */
export function chainParam(p: V3, a: V3, b: V3, c: V3): number {
  const along = (from: V3, to: V3) => {
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1
    const t = ((p[0] - from[0]) * d[0] + (p[1] - from[1]) * d[1] + (p[2] - from[2]) * d[2]) / len2
    const q = [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t]
    return { t, dist: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) }
  }
  const upper = along(a, b)
  const lower = along(b, c)
  const first = Math.min(1, Math.max(0, upper.t))
  const second = Math.max(0, lower.t)
  // the nearer segment wins, but only where its projection lands on it (or past the end of the chain)
  if (upper.t <= 1 && (lower.t < 0 || upper.dist <= lower.dist)) return 0.5 * first
  return 0.5 + 0.5 * second
}

export interface FieldInput {
  positions: ArrayLike<number>
  joints: ArrayLike<number>
  weights: ArrayLike<number>
  /** Bone names in the skin's joint order. */
  bones: readonly string[]
  /** Each bone's rest position, by name. */
  rest: (bone: string) => V3 | undefined
}

export function bodyFields(input: FieldInput): BodyFields {
  const n = input.positions.length / 3
  const arm = new Float32Array(n)
  const leg = new Float32Array(n)
  const hem = new Float32Array(n)
  const at = (name: string) => {
    const r = input.rest(name)
    if (!r) throw new Error(`the rig has no ${name}`)
    return r
  }
  const chains = (set: Record<'L' | 'R', readonly string[]>) =>
    (['L', 'R'] as const).map((side) => ({ points: set[side].map(at) as [V3, V3, V3], bones: new Set(set[side].map((b) => input.bones.indexOf(b))) }))
  const arms = chains(ARM)
  const legs = chains(LEG)
  const crotch = (at('thigh_L')[1] + at('thigh_R')[1]) / 2
  const neck = at('neck')[1]
  for (let v = 0; v < n; v++) {
    const p: V3 = [input.positions[v * 3], input.positions[v * 3 + 1], input.positions[v * 3 + 2]]
    const weightOn = (bones: Set<number>) => {
      let w = 0
      for (let k = 0; k < 4; k++) if (bones.has(input.joints[v * 4 + k])) w += input.weights[v * 4 + k]
      return w
    }
    let armWeight = 0
    for (const side of arms) {
      const w = weightOn(side.bones)
      armWeight += w
      if (w > 0) arm[v] = Math.max(arm[v], chainParam(p, ...side.points) * w)
    }
    for (const side of legs) {
      const w = weightOn(side.bones)
      if (w > 0) leg[v] = Math.max(leg[v], chainParam(p, ...side.points) * w)
    }
    // the arms never end a top's hem: they read as the top of the torso
    const h = (p[1] - crotch) / (neck - crotch)
    hem[v] = h * (1 - armWeight) + armWeight
  }
  return { arm, leg, hem }
}

/** A field read at bound points: each through its triangle and (s, t). */
export function fieldAt(field: ArrayLike<number>, tri: ArrayLike<number>, st: ArrayLike<number>, out = new Float32Array(st.length / 2)): Float32Array {
  for (let i = 0; i < out.length; i++) {
    const s = st[i * 2]
    const t = st[i * 2 + 1]
    out[i] = field[tri[i * 3]] * (1 - s - t) + field[tri[i * 3 + 1]] * s + field[tri[i * 3 + 2]] * t
  }
  return out
}
