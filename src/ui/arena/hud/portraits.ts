import { bust } from '../staging/loadout.js'
import type { StagingResult } from '../staging/Staging'

/**
 * Each hero's portrait by engine hero id. The match lists side 0's formation then side 1's (matchSetup), and every
 * placement points into the loadout, so the bust rendered in staging is reused from its cache. Undefined without
 * WebGL; the HUD shows initials instead.
 */
export function stagedPortraits(staged: StagingResult): (string | undefined)[] {
  return [...staged.formation[0], ...staged.formation[1]].map((p) => {
    const entry = staged.loadout[p.hero]
    if (!entry) return undefined
    try {
      return bust(entry, p.hero)
    } catch {
      return undefined
    }
  })
}
