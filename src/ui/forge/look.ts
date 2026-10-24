import { defaultLook, toHex, type FacePhoto, type GearSlot, type HeroLook, type LookColor } from '../../charter/look.js'
import type { GearWish, Reading } from '../../forge/reading.js'
import { slotFor, wearing, type PieceEntry } from '../../kit/pieces.js'
import { resolveGear, type GearGap } from '../../kit/resolve.js'
import type { FaceFinding } from './face/find.js'

/** A face found on an uploaded reference image, ready to wear. */
export interface FaceCandidate {
  url: string
  finding: FaceFinding
}

/** The stored form of a face: the upload's URL, the image's size and its landmarks as flat x, y pairs. */
export function facePhoto({ url, finding }: FaceCandidate): FacePhoto {
  return { url, width: finding.width, height: finding.height, points: finding.points.flatMap(([x, y]) => [x, y]) }
}

/** The colours a photo gives a hero: its skin, and its hair and eyes when the photo shows them. */
export function photoColours(finding: FaceFinding): Partial<Record<LookColor, string>> {
  return { skin: toHex(finding.skin), ...(finding.hair ? { hair: toHex(finding.hair) } : {}), ...(finding.iris ? { iris: toHex(finding.iris) } : {}) }
}

/** The look as drawn: the hero's own choices over its role's defaults, every colour filled in. */
export function resolvedLook(look: HeroLook | undefined, roleId: string, heroName: string, hue: number): HeroLook & { colors: Record<LookColor, string> } {
  const base = defaultLook(roleId, heroName, hue)
  if (!look) return base
  return { ...base, ...look, colors: { ...base.colors, ...look.colors } }
}

/** A gear wish from a reading, and the repository piece that answers it, if any. */
export interface GearChoice {
  wish: GearWish
  entry?: PieceEntry
  /** Worn when it has a piece; generated after the build when it hasn't. Off skips it. */
  wear: boolean
}

/** Each wish against the repository: the piece whose tags its words name, keeping what the player already switched off. */
export function matchWishes(wishes: readonly GearWish[], catalog: readonly PieceEntry[], before: readonly GearChoice[] = []): GearChoice[] {
  return wishes.map((wish) => {
    const fits = catalog.filter((e) => e.kind === wish.kind || (wish.kind === 'hand' && e.kind === 'offhand') || (wish.kind === 'offhand' && e.kind === 'hand'))
    const entry = Object.values(resolveGear(wish.phrase, fits).gear)[0]
    return { wish, ...(entry ? { entry } : {}), wear: before.find((c) => c.wish.phrase === wish.phrase)?.wear ?? true }
  })
}

/** The pieces the chosen wishes put on, one per socket: a hand piece takes the right hand, then the left. */
export function wornGear(choices: readonly GearChoice[]): Partial<Record<GearSlot, PieceEntry>> {
  const gear: Partial<Record<GearSlot, PieceEntry>> = {}
  for (const c of choices) {
    if (!c.wear || !c.entry) continue
    const slot = c.entry.kind === 'hand' ? (['hand_r', 'hand_l'] as const).find((s) => !gear[s]) : slotFor(c.entry.kind)
    if (slot && !gear[slot]) gear[slot] = c.entry
  }
  return gear
}

/** The chosen wishes nothing in the repository answers: what the Gear panel offers to generate after the build. */
export const gapsOf = (choices: readonly GearChoice[]): GearGap[] => choices.filter((c) => c.wear && !c.entry).map((c) => ({ phrase: c.wish.phrase, kind: c.wish.kind }))

/**
 * The look a reading describes, as the plinth draws it: the photo's face and colours when the reading wears them, the
 * outfit sampled off the image under an offline reading, then every colour the reading names, and the gear chosen.
 */
export function readingLook(reading: Reading, face?: FaceCandidate, outfit: Partial<Record<LookColor, string>> = {}, gear: Partial<Record<GearSlot, PieceEntry>> = {}): HeroLook {
  const l = reading.look
  const wornFace = l.wearFace && face ? face : undefined
  const pieces = Object.entries(gear).map(([slot, entry]) => [slot, wearing(entry!)] as const)
  return {
    gender: l.gender,
    hair: l.hair,
    ...(l.beard !== 'none' ? { beard: l.beard } : {}),
    armour: l.armour,
    cape: l.cape,
    colors: { ...(wornFace ? photoColours(wornFace.finding) : {}), ...(reading.source === 'offline' ? outfit : {}), ...l.colors },
    ...(wornFace ? { face: facePhoto(wornFace) } : {}),
    ...(pieces.length ? { gear: Object.fromEntries(pieces) } : {}),
  }
}
