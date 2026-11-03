import { BUILD_SLOTS } from '../../charter/build.js'
import { GEAR_SLOTS, defaultLook, toHex, type FacePhoto, type GearPiece, type GearSlot, type HeroLook, type LookColor } from '../../charter/look.js'
import { elementLook, type SkillLook } from '../../charter/skill-look.js'
import { getTemplate, hasTemplate } from '../../charter/templates/catalog.js'
import type { BuildSlot } from '../../charter/types.js'
import { lookFromWords, templateWords } from '../../arena/recipes/looks.js'
import type { HeldWish } from '../../forge/gear-read.js'
import type { Reading } from '../../forge/reading.js'
import { builtIn, wearing } from '../../kit/pieces.js'
import type { FaceFinding } from './face/find.js'

/** A face found on an uploaded reference image, ready to wear. */
export interface FaceCandidate {
  url: string
  finding: FaceFinding
}

/** The stored form of a face: the upload's URL, the image's size and its landmarks as flat x, y pairs. */
export function facePhoto({ url, finding }: FaceCandidate): FacePhoto {
  return { url, width: finding.width, height: finding.height, points: finding.points.flatMap(([x, y]) => [x, y]), ...(finding.depth ? { depth: [...finding.depth] } : {}) }
}

/** The colours a photo gives a hero: its skin, and its eyes when the photo shows them. Heroes are drawn bare, so its hair is no one's. */
export function photoColours(finding: FaceFinding): Partial<Record<LookColor, string>> {
  return { skin: toHex(finding.skin), ...(finding.iris ? { iris: toHex(finding.iris) } : {}) }
}

/** The look as drawn: the hero's own choices over its role's defaults, every colour filled in. */
export function resolvedLook(look: HeroLook | undefined, roleId: string, heroName: string, hue: number): HeroLook & { colors: Record<LookColor, string> } {
  const base = defaultLook(roleId, heroName, hue)
  if (!look) return base
  return { ...base, ...look, colors: { ...base.colors, ...look.colors } }
}

/** What a reading is drawn with: the face it may wear. */
export interface Dressing {
  face?: FaceCandidate
}

/** What each hand holds, as the look stores it: the reading's built-in pieces. */
export function heldFor(gear: HeldWish): Partial<Record<GearSlot, GearPiece>> {
  return Object.fromEntries(GEAR_SLOTS.flatMap((slot) => {
    const piece = gear[slot] ? builtIn(gear[slot]!) : undefined
    return piece ? [[slot, wearing(piece)]] : []
  }))
}

/**
 * The look a reading describes, as the plinth draws it: the body bare (2026-11-04), a piece in each hand the reading
 * names, the photo's face and colours when the reading wears them, and each skill's look, the ultimate's
 * transformation with it.
 */
export function readingLook(reading: Reading, { face }: Dressing = {}): HeroLook {
  const l = reading.look
  const wornFace = l.wearFace && face ? face : undefined
  const photo = wornFace ? photoColours(wornFace.finding) : {}
  const gear = heldFor(reading.gear)
  const skills: Partial<Record<BuildSlot, SkillLook>> = {}
  for (const slot of BUILD_SLOTS) {
    const own = reading.kit[slot].look
    if (own) skills[slot] = own
  }
  if (reading.form) {
    const ult = reading.kit.ultimate
    const t = hasTemplate(ult.template) ? getTemplate(ult.template) : undefined
    const own = ult.look ?? (t && lookFromWords({ own: [ult.name, ult.does].filter(Boolean).join(' '), ...templateWords(t), kind: t.delivery.kind, slot: 'ultimate' })) ?? elementLook('energy')
    skills.ultimate = { ...own, transformation: reading.form }
  }
  return {
    gender: l.gender,
    ...(l.physique ? { physique: l.physique } : {}),
    ...(l.sculpt ? { sculpt: l.sculpt } : {}),
    colors: { ...photo, ...l.colors },
    ...(wornFace ? { face: { ...facePhoto(wornFace), ...(l.faceStrength !== undefined ? { strength: l.faceStrength } : {}) } } : {}),
    ...(Object.keys(gear).length ? { gear } : {}),
    ...(Object.keys(skills).length ? { skills } : {}),
  }
}

/** The reading after the player changed what the hands hold on the card: the built-in pieces they hold now. */
export function gearAfter(reading: Reading, after: HeroLook): Reading {
  const gear: HeldWish = Object.fromEntries(GEAR_SLOTS.flatMap((slot) => {
    const piece = after.gear?.[slot]
    return piece && builtIn(piece.id) ? [[slot, piece.id]] : []
  }))
  return { ...reading, gear }
}

/** The reading after the player changed the body on the card: its gender, build, skin, eyes and brows, and the face's likeness. */
export function bodyAfter(reading: Reading, before: HeroLook, after: HeroLook): Reading {
  const { faceStrength, physique: _physique, ...look } = reading.look
  const colors = { ...look.colors }
  for (const c of ['skin', 'iris', 'brow'] as const) {
    const v = after.colors[c]
    if (v && v !== before.colors[c]) colors[c] = v
  }
  const strength = after.face ? (after.face.strength ?? 1) : faceStrength
  const physique = after.physique ?? reading.look.physique
  return {
    ...reading,
    look: { ...look, gender: after.gender, ...(physique ? { physique } : {}), colors, ...(strength !== undefined && strength < 1 ? { faceStrength: strength } : {}) },
  }
}
