import { GEAR_SLOTS, type HeroLook } from '../charter/look.js'
import { builtIn, fits, type PieceEntry } from '../kit/pieces.js'
import { visibleAssets } from './assets.js'
import type { Db } from './db.js'
import { isOwnPieceUrl } from './photo-url.js'

/**
 * What's wrong with a look's gear, if anything: every worn piece must be a built-in or a visible community piece, at
 * that piece's own URL, in a slot its kind fits. The look's hydration only checked the shapes of ids and URLs.
 */
export function gearProblem(look: HeroLook | undefined, community: Map<string, PieceEntry> = new Map()): string | undefined {
  for (const slot of GEAR_SLOTS) {
    const piece = look?.gear?.[slot]
    if (!piece) continue
    const known = builtIn(piece.id) ?? community.get(piece.id)
    if (!known) return `no piece ${piece.id} in the repository`
    if (piece.url !== known.url) return `${piece.id} must load from ${known.url}`
    if (!fits(known.kind, slot)) return `a ${known.kind} piece can't go in ${slot}`
  }
  return undefined
}

/** The community pieces a look wears: ids that aren't built-ins, whose URLs are this deployment's own pieces. */
export function communityIds(look: HeroLook | undefined): string[] {
  return GEAR_SLOTS.flatMap((slot) => {
    const piece = look?.gear?.[slot]
    return piece && !builtIn(piece.id) && isOwnPieceUrl(piece.url) ? [piece.id] : []
  })
}

/** gearProblem with the community pieces read from the repository. */
export async function checkGear(db: Db, look: HeroLook | undefined): Promise<string | undefined> {
  return gearProblem(look, await visibleAssets(db, communityIds(look)))
}
