import { proposeBuild, type Build } from '../charter/build.js'
import type { RoleId } from '../charter/types.js'

/** A build that uses each slot's role default, for tests and the reference field. */
export function defaultBuild(roleId: RoleId, heroName: string = roleId): Build {
  const result = proposeBuild({ heroName, roleId, skills: {} })
  if (!result.ok) throw new Error(`default build failed for ${roleId}`)
  return result.build
}
