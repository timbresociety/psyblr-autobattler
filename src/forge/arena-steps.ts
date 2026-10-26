/**
 * The arena hero's step and artifact names (U11), shared by the runner that plans and runs the steps and the package
 * that reads their output. Each step stores its output under its own name; packing stores the two texture tiers.
 */
export const ARENA_STEP = { mesh: 'arena-mesh', rig: 'arena-rig', pack: 'arena-pack' } as const
export const ARENA_ARTIFACT = { focus: 'arena-focus', other: 'arena-other' } as const

const RETARGET = 'arena-retarget'
export const arenaRetargetStep = (batch: number) => `${RETARGET}-${batch}`
/** The batch a step name retargets, or undefined when it is not an arena retarget step. */
export const arenaRetargetBatch = (name: string): number | undefined => {
  const m = new RegExp(`^${RETARGET}-(\\d+)$`).exec(name)
  return m ? Number(m[1]) : undefined
}
export const ARENA_RETARGET_PREFIX = RETARGET
