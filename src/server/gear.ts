import { GEAR_SLOTS, LOOK_SLOTS, type HeroLook } from '../charter/look.js'
import { builtIn, fits } from '../kit/pieces.js'
import { libraryItem, slotsFor } from '../kit/wear/library.js'
import { visibleAssets, type SharedAsset } from './assets.js'
import type { Db } from './db.js'
import { isOwnPieceUrl } from './photo-url.js'

/**
 * What's wrong with a look's gear, if anything: every worn piece must be a built-in or a visible community piece, at
 * that piece's own URL, in a slot its kind fits. A generated garment is a wardrobe item, never gear. The look's
 * hydration only checked the shapes of ids and URLs.
 */
export function gearProblem(look: HeroLook | undefined, community: ReadonlyMap<string, SharedAsset> = new Map()): string | undefined {
  for (const slot of GEAR_SLOTS) {
    const piece = look?.gear?.[slot]
    if (!piece) continue
    const shared = community.get(piece.id)
    const known = builtIn(piece.id) ?? (shared && 'kind' in shared ? shared : undefined)
    if (!known) return `no piece ${piece.id} in the repository`
    if (piece.url !== known.url) return `${piece.id} must load from ${known.url}`
    if (!fits(known.kind, slot)) return `a ${known.kind} piece can't go in ${slot}`
  }
  return wearProblem(look, community)
}

/**
 * What's wrong with a look's wardrobe, if anything: every worn item must be in the library (built in, or a community
 * garment or piece the repository still shows) at its own URL, in a slot it can be worn in.
 */
export function wearProblem(look: HeroLook | undefined, community: ReadonlyMap<string, SharedAsset> = new Map()): string | undefined {
  for (const slot of LOOK_SLOTS) {
    const worn = look?.wear?.[slot]
    if (!worn) continue
    const known = libraryItem(worn.id) ?? community.get(worn.id)
    if (!known) return `no item ${worn.id} in the library`
    if (worn.url !== known.url) return `${worn.id} must load from ${known.url}`
    // a piece is worn in the slot of its kind
    const itemSlot = 'slot' in known ? known.slot : known.kind
    if (!slotsFor(itemSlot).includes(slot)) return `a ${itemSlot} item can't go in ${slot}`
  }
  return undefined
}

/** The community assets a look wears: ids that aren't built-ins, whose URLs are this deployment's own generated files. */
export function communityIds(look: HeroLook | undefined): string[] {
  const gear = GEAR_SLOTS.flatMap((slot) => {
    const piece = look?.gear?.[slot]
    return piece && !builtIn(piece.id) && isOwnPieceUrl(piece.url) ? [piece.id] : []
  })
  const wear = LOOK_SLOTS.flatMap((slot) => {
    const item = look?.wear?.[slot]
    return item && !libraryItem(item.id) && isOwnPieceUrl(item.url) ? [item.id] : []
  })
  return [...new Set([...gear, ...wear])]
}

/** gearProblem with the community pieces read from the repository. */
export async function checkGear(db: Db, look: HeroLook | undefined): Promise<string | undefined> {
  return gearProblem(look, await visibleAssets(db, communityIds(look)))
}
