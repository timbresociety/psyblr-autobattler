import { BUILD_SLOTS } from '../../charter/build.js'
import { LOOK_SLOTS, defaultLook, outfitOf, toHex, type FacePhoto, type HeroLook, type LookColor, type LookSlot, type Worn } from '../../charter/look.js'
import { elementLook, type SkillLook } from '../../charter/skill-look.js'
import { getTemplate, hasTemplate } from '../../charter/templates/catalog.js'
import type { BuildSlot } from '../../charter/types.js'
import { lookFromWords, templateWords } from '../../arena/recipes/looks.js'
import type { Reading } from '../../forge/reading.js'
import { barePhrase, rungOfWish, type WearGap, type WearWish, type WishPrint } from '../../forge/wardrobe-read.js'
import type { LibraryEntry } from '../../kit/wear/library.js'
import type { FaceFinding } from './face/find.js'
import type { OutfitColours } from './outfit.js'

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

/** What a reading is dressed from: the items it can wear, the hero's suit hue, the face it may wear, the image's outfit colours. */
export interface Dressing {
  catalog: readonly LibraryEntry[]
  hue: number
  face?: FaceCandidate
  outfit?: OutfitColours
}

const GARMENTS: readonly LookSlot[] = ['upper', 'lower', 'full']
const find = (catalog: readonly LibraryEntry[], id: string | undefined) => (id ? catalog.find((e) => e.id === id) : undefined)

/**
 * What the role dresses a reading in before its wishes: helmet, armour and cape as the role wears them, or once the
 * reading names a garment, the plain outfit (hair, a long-sleeve top, trousers and boots) with no cape.
 */
function baseWear(reading: Reading, hue: number): Partial<Record<LookSlot, Worn>> {
  const wished = new Set(reading.wear.map((w) => w.slot))
  const dressed = GARMENTS.some((s) => wished.has(s))
  const base = defaultLook(reading.roleId, reading.heroName, hue)
  // a helmet is the role's hat: a hat or hair the reading names takes its place
  const helmet = base.hair === 'helmet' && (dressed || wished.has('head') || wished.has('hair'))
  return outfitOf({ ...base, ...(dressed ? { armour: false, cape: false } : {}), ...(helmet ? { hair: 'crop' as const } : {}) })
}

/** Colours over an item's own: each one set replaces its channel, and the rest stay. */
function over(colors: Worn['colors'], mine: WearWish['colors']): Worn['colors'] {
  if (!mine?.some(Boolean)) return colors
  return Array.from({ length: Math.max(colors?.length ?? 0, mine.length) }, (_, i) => mine[i] ?? colors?.[i] ?? null)
}

/** The image's outfit colours a slot takes: the top's two on an upper or full-body item, the legs' on a lower one. */
const outfitFor = (slot: LookSlot, o: OutfitColours): (string | null)[] | undefined =>
  slot === 'lower' ? [o.legs ?? null] : slot === 'upper' || slot === 'full' ? [o.top ?? null, o.accent ?? null] : undefined

/** A wish as worn: its item in the wish's colours, finishes, print and cuts, or, until it's generated, what stands in for it. */
function wornFor(wish: WearWish, entry: LibraryEntry | undefined, standIn: Worn | undefined): Worn | undefined {
  if (entry) {
    const { colors, finishes, knobs, print } = wish
    return { id: entry.id, url: entry.url, ...(colors ? { colors } : {}), ...(finishes ? { finishes } : {}), ...(knobs ? { knobs } : {}), ...(print ? { print } : {}) }
  }
  if (!standIn) return undefined
  const colors = over(standIn.colors, wish.colors)
  return { ...standIn, ...(colors ? { colors } : {}) }
}

/** Whether a wish waits on generating: the reader picked that rung, or nothing in the catalog answers it yet. */
export const isGap = (wish: WearWish, catalog: readonly LibraryEntry[]) => !wish.bare && (wish.rung === 'generate' || !find(catalog, wish.item))

/**
 * The look a reading describes, as the plinth draws it. The role dresses the hero first, each wish then puts its item
 * on in its colours (a full-body item over the upper and lower ones), and a wish the library can't answer yet wears
 * what the role gave that slot until it's generated. Then the photo's face and colours when the reading wears them,
 * the image's outfit colours on garments an offline reading left uncoloured, the hair colour on hair and beard, and
 * each skill's look, the ultimate's transformation with it.
 */
export function readingLook(reading: Reading, { catalog, hue, face, outfit = {} }: Dressing): HeroLook {
  const l = reading.look
  const wornFace = l.wearFace && face ? face : undefined
  const photo = wornFace ? photoColours(wornFace.finding) : {}
  const base = baseWear(reading, hue)
  const wear = { ...base }
  const wishOf = (slot: LookSlot) => reading.wear.find((w) => w.slot === slot)
  for (const wish of reading.wear) {
    if (wish.bare) {
      delete wear[wish.slot]
      continue
    }
    const worn = wornFor(wish, find(catalog, wish.item), base[wish.slot])
    if (!worn) continue
    wear[wish.slot] = worn
    if (wish.slot === 'full') {
      delete wear.upper
      delete wear.lower
    } else if (wish.slot === 'upper' || wish.slot === 'lower') delete wear.full
  }
  if (reading.source === 'offline') {
    for (const slot of GARMENTS) {
      const worn = wear[slot]
      const mine = outfitFor(slot, outfit)
      if (!worn || !mine?.some(Boolean) || wishOf(slot)?.colors?.some(Boolean)) continue
      const colors = over(worn.colors, mine.slice(0, find(catalog, worn.id)?.channels.length ?? mine.length))
      wear[slot] = { ...worn, ...(colors ? { colors } : {}) }
    }
  }
  // the hair colour the reading names, or the photo's, on the hair and the beard unless their own wishes colour them
  const hair = l.colors.hair ?? photo.hair
  for (const slot of ['hair', 'beard'] as const) {
    const worn = wear[slot]
    if (hair && worn && !wishOf(slot)?.colors?.some(Boolean)) wear[slot] = { ...worn, colors: [hair, ...(worn.colors?.slice(1) ?? [])] }
  }
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
    wear,
    // the fields from before the wardrobe: a look with one never reads them
    hair: 'none',
    armour: false,
    cape: false,
    colors: { ...photo, ...l.colors },
    ...(wornFace ? { face: { ...facePhoto(wornFace), ...(l.faceStrength !== undefined ? { strength: l.faceStrength } : {}) } } : {}),
    ...(Object.keys(skills).length ? { skills } : {}),
  }
}

/** An offline reading's garments in the colours sampled off the image, where its words named none: the card shows them recoloured. */
export function withOutfit(reading: Reading, outfit: OutfitColours, catalog: readonly LibraryEntry[]): Reading {
  if (reading.source !== 'offline') return reading
  let changed = false
  const wear = reading.wear.map((w) => {
    const entry = find(catalog, w.item)
    const mine = outfitFor(w.slot, outfit)
    if (w.bare || !entry || !mine || w.colors?.some(Boolean)) return w
    const colors = mine.slice(0, entry.channels.length)
    while (colors.length && !colors.at(-1)) colors.pop()
    if (!colors.length) return w
    changed = true
    const next = { ...w, colors }
    return { ...next, rung: w.rung === 'generate' ? w.rung : rungOfWish(next) }
  })
  return changed ? { ...reading, wear } : reading
}

/** The reading's wishes the library can't answer yet: what the Wardrobe offers to generate, and what stands in meanwhile. */
export function gapsOf(reading: Reading, look: HeroLook, catalog: readonly LibraryEntry[]): WearGap[] {
  const wear = outfitOf(look)
  return reading.wear.filter((w) => isGap(w, catalog)).map((w) => ({ phrase: w.phrase, slot: w.slot, ...(wear[w.slot] ? { under: wear[w.slot]!.id } : {}) }))
}

const same = (a: Worn | undefined, b: Worn | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const printOf = ({ id, ink, scale, channel }: NonNullable<Worn['print']>): WishPrint | undefined =>
  id ? { id, ...(ink ? { ink } : {}), ...(scale ? { scale } : {}), ...(channel ? { channel } : {}) } : undefined

/**
 * The reading's wishes after the player changed its look by hand. A slot they changed becomes a wish for what they put
 * there (the same item restyled keeps its words, and a gap's stand-in recoloured is still the gap), a slot they emptied
 * a wish for nothing, and every other wish stays as read. An upper or lower item a full-body one took off, or the
 * other way round, asks for nothing. A picture print stays on the built hero's wardrobe, so the card doesn't offer it.
 */
export function wishesAfter(reading: Reading, before: HeroLook, after: HeroLook, catalog: readonly LibraryEntry[]): WearWish[] {
  const [was, now] = [outfitOf(before), outfitOf(after)]
  const out: WearWish[] = []
  for (const slot of LOOK_SLOTS) {
    const old = reading.wear.find((w) => w.slot === slot)
    const [b, a] = [was[slot], now[slot]]
    if (same(b, a)) {
      if (old) out.push(old)
      continue
    }
    if (!a) {
      const covered = slot === 'full' ? !!(now.upper || now.lower) : (slot === 'upper' || slot === 'lower') && !!now.full
      if (!covered) out.push({ slot, phrase: barePhrase(slot), bare: true, rung: 'wear' })
      continue
    }
    const print = a.print && printOf(a.print)
    const styled = {
      ...(a.colors?.some(Boolean) ? { colors: a.colors } : {}),
      ...(a.finishes?.some(Boolean) ? { finishes: a.finishes } : {}),
      ...(a.knobs && Object.keys(a.knobs).length ? { knobs: a.knobs } : {}),
      ...(print ? { print } : {}),
    }
    if (old && !old.bare && b?.id === a.id) {
      const { colors: _colors, finishes: _finishes, knobs: _knobs, print: _print, ...words } = old
      const next = { ...words, ...styled }
      out.push({ ...next, rung: old.rung === 'generate' ? 'generate' : rungOfWish(next) })
      continue
    }
    const next = { slot, phrase: find(catalog, a.id)?.name.toLowerCase() ?? 'community item', item: a.id, ...styled }
    out.push({ ...next, rung: rungOfWish(next) })
  }
  return out
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
