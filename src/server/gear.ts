import { GEAR_SLOTS, type HeroLook } from '../charter/look.js'
import { builtIn, fits } from '../kit/pieces.js'

/**
 * What's wrong with a look's gear, if anything: every worn piece must be a known piece at its own URL, in a slot its
 * kind fits. The look's own hydration only checked the shapes of the ids and URLs.
 */
export function gearProblem(look: HeroLook | undefined): string | undefined {
  for (const slot of GEAR_SLOTS) {
    const piece = look?.gear?.[slot]
    if (!piece) continue
    const known = builtIn(piece.id)
    if (!known) return `no piece ${piece.id} in the repository`
    if (piece.url !== known.url) return `${piece.id} must load from ${known.url}`
    if (!fits(known.kind, slot)) return `a ${known.kind} piece can't go in ${slot}`
  }
  return undefined
}
