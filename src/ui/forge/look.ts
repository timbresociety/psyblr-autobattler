import { defaultLook, toHex, type FacePhoto, type HeroLook, type LookColor } from '../../charter/look.js'
import { coloursFromPrompt, genderFromPrompt, partsFromPrompt } from '../../forge/prompt.js'
import { BUILT_IN, wearing } from '../../kit/pieces.js'
import { resolveGear } from '../../kit/resolve.js'
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

/**
 * A new hero's first look. The prompt wins where it says something ("a queen in gold armour with a red cape"), and its
 * gear words pick pieces from the kit ("a samurai with a katana" carries one). The photo gives the face and its
 * colours, and the role fills the rest the way heroes looked before looks existed.
 */
export function firstLook(prompt: string, roleId: string, heroName: string, hue: number, face?: FaceCandidate): HeroLook {
  const base = defaultLook(roleId, heroName, hue)
  const parts = partsFromPrompt(prompt)
  const matched = Object.entries(resolveGear(prompt, BUILT_IN).gear).map(([slot, entry]) => [slot, wearing(entry!)] as const)
  return {
    gender: genderFromPrompt(prompt) ?? base.gender,
    hair: parts.hair ?? base.hair,
    ...(parts.beard && parts.beard !== 'none' ? { beard: parts.beard } : {}),
    armour: parts.armour ?? base.armour,
    // a cape cuts through wings or a jetpack, so a hero wearing something on its back goes without unless asked
    cape: parts.cape ?? (matched.some(([slot]) => slot === 'back') ? false : base.cape),
    colors: { ...(face ? photoColours(face.finding) : {}), ...coloursFromPrompt(prompt) },
    ...(face ? { face: facePhoto(face) } : {}),
    ...(matched.length ? { gear: Object.fromEntries(matched) } : {}),
  }
}

/** The look as drawn: the hero's own choices over its role's defaults, every colour filled in. */
export function resolvedLook(look: HeroLook | undefined, roleId: string, heroName: string, hue: number): HeroLook & { colors: Record<LookColor, string> } {
  const base = defaultLook(roleId, heroName, hue)
  if (!look) return base
  return { ...base, ...look, colors: { ...base.colors, ...look.colors } }
}
