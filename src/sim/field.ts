import { BUILD_SLOTS, SLOT_KIND, otherActive, type Build } from '../charter/build'
import { ROLE_IDS, getRole } from '../charter/roles'
import { ATTRIBUTES } from '../charter/stats'
import { poolFor } from '../charter/templates/catalog'
import type { RoleId } from '../charter/types'
import { defaultBuild } from './fixtures'
import { createRng, type Rng } from './rng'

/** A seeded random legal build for a role: templates from its pools and a spread that spends the pool within caps. */
export function randomBuild(roleId: RoleId, rng: Rng, heroName = `${roleId}-random`): Build {
  const build = defaultBuild(roleId, heroName)
  const slots = { ...build.slots }
  for (const slot of BUILD_SLOTS) {
    const exclude = slot === 'active2' ? otherActive(slots, slot) : []
    const pool = poolFor(roleId, SLOT_KIND[slot]).filter((t) => !exclude.includes(t.id))
    slots[slot] = { ...slots[slot], templateId: pool[Math.floor(rng() * pool.length)].id }
  }
  // players start from the engine's proposed spread and nudge it, so samples do too
  const caps = getRole(roleId).attributeCaps
  const spread = { ...build.spread }
  const moves = Math.floor(rng() * 7)
  for (let i = 0; i < moves; i++) {
    const from = ATTRIBUTES[Math.floor(rng() * 3)]
    const to = ATTRIBUTES[Math.floor(rng() * 3)]
    if (from !== to && spread[from] > 0 && spread[to] < caps[to]) {
      spread[from]--
      spread[to]++
    }
  }
  return { ...build, slots, spread }
}

let field: Build[] | undefined

/** The reference field every build is gated against: each role's default build. Built once; read-only. */
export function referenceField(): Build[] {
  field ??= ROLE_IDS.map((role) => defaultBuild(role, `field-${role}`))
  return field
}

/** Seeded sample of random legal builds, for the catalogue-wide report. */
export function sampleBuilds(count: number, seed: number): Build[] {
  const rng = createRng(seed)
  return Array.from({ length: count }, (_, i) => randomBuild(ROLE_IDS[i % ROLE_IDS.length], rng, `sample-${i}`))
}

/** The reference army: a balanced composition of default builds. */
export function referenceArmy(): Build[] {
  const roles: RoleId[] = ['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support', 'tank', 'fighter', 'mage', 'marksman']
  return roles.map((r, i) => defaultBuild(r, `ref-${r}-${i}`))
}
