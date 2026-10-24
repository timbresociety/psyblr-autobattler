import { FINISHES, KNOBS, type Finish, type Knob } from '../kit/wear/item.js'
import type { Physique } from '../kit/body/shape.js'
import { hydrateSkillLook, type SkillLook } from './skill-look.js'
import type { BuildSlot } from './types.js'

/**
 * A hero's look (cosmetic only: no number in the game reads it). The body comes from the hero's size and this look's
 * gender (public/heroes/<m|f>-<size>.glb), shaped by its physique; a photo face, with the 478 landmarks the Forge
 * found on it, is warped onto the body's own face wherever the hero is drawn; and what it wears comes from the
 * wardrobe: hair, a beard, one item in each of six slots, and gear on the face and in the hands, each in its own
 * colours and cuts.
 *
 * Looks saved before the wardrobe (hair style, armour and cape switches, a colour per body region, gear in sockets)
 * still load: `outfitOf` reads them into wardrobe items.
 */

export type Gender = 'm' | 'f'

export const HAIR_STYLES = ['none', 'buzz', 'crop', 'short', 'curly', 'swept', 'spiky', 'bob', 'long', 'volume', 'helmet'] as const
export type HairStyle = (typeof HAIR_STYLES)[number]

export const BEARD_STYLES = ['none', 'goatee', 'full', 'chin_curtain'] as const
export type BeardStyle = (typeof BEARD_STYLES)[number]

export const HAIR_LABEL: Record<HairStyle, string> = { none: 'Bald', buzz: 'Buzz', crop: 'Crop', short: 'Short', curly: 'Curly', swept: 'Swept', spiky: 'Spiky', bob: 'Bob', long: 'Long', volume: 'Volume', helmet: 'Helmet' }
export const BEARD_LABEL: Record<BeardStyle, string> = { none: 'None', goatee: 'Goatee', full: 'Full', chin_curtain: 'Chin curtain' }
export const GENDER_LABEL: Record<Gender, string> = { m: 'Man', f: 'Woman' }

/** Regions the look can colour; each takes '#rrggbb'. */
export const LOOK_COLORS = ['skin', 'suit', 'trim', 'pants', 'glove', 'boot', 'hair', 'iris', 'brow', 'cape', 'metal'] as const
export type LookColor = (typeof LOOK_COLORS)[number]
export const LOOK_COLOR_LABEL: Record<LookColor, string> = { skin: 'Skin', suit: 'Suit', trim: 'Trim', pants: 'Trousers', glove: 'Gloves', boot: 'Boots', hair: 'Hair', iris: 'Eyes', brow: 'Brows', cape: 'Cape', metal: 'Armour' }

/** Where a piece of gear hangs on a body (each body's sockets come from tools/blender/humanlib/sockets.py). */
export const GEAR_SLOTS = ['head', 'face', 'hand_r', 'hand_l', 'back'] as const
export type GearSlot = (typeof GEAR_SLOTS)[number]

/** What a piece is made for. A hand piece fits either hand; an off-hand piece (a shield, a bow) only the left. */
export const PIECE_KINDS = ['head', 'face', 'hand', 'offhand', 'back'] as const
export type PieceKind = (typeof PIECE_KINDS)[number]

export const SLOT_KINDS: Record<GearSlot, readonly PieceKind[]> = { head: ['head'], face: ['face'], hand_r: ['hand'], hand_l: ['hand', 'offhand'], back: ['back'] }

/** A piece of gear a hero wears: its id in the asset repository, where its model lives, and the colour it takes. */
export interface GearPiece {
  id: string
  url: string
  /** The colour of the piece's 'primary' material; the piece's own when absent. */
  color?: string
}

/** A photo face: where it is stored, its size, and its landmarks as x, y pairs in its own pixels. */
export interface FacePhoto {
  url: string
  width: number
  height: number
  points: number[]
}

export interface HeroLook {
  gender: Gender
  /** Weight, muscle and age (each 0 to 1); the body as made when absent. */
  physique?: Physique
  /** What the hero wears, slot by slot. When absent, the fields below dress it (looks from before the wardrobe). */
  wear?: Partial<Record<LookSlot, Worn>>
  hair: HairStyle
  /** Facial hair; none when absent. */
  beard?: BeardStyle
  armour: boolean
  cape: boolean
  colors: Partial<Record<LookColor, string>>
  face?: FacePhoto
  /** Rigid pieces in the body's sockets: a hat, glasses, a weapon in each hand, something on the back. */
  gear?: Partial<Record<GearSlot, GearPiece>>
  /** How each skill looks (skill-look.ts); a skill without one takes a look from its words. */
  skills?: Partial<Record<BuildSlot, SkillLook>>
}

export const FACE_POINTS = 478

// ------------------------------------------------------------------------------------------------ the wardrobe

/** Where something is worn: hair and beard, the six wardrobe slots, and gear on the face and in either hand. */
export const LOOK_SLOTS = ['hair', 'beard', 'head', 'upper', 'lower', 'full', 'back', 'feet', 'face', 'hand_r', 'hand_l'] as const
export type LookSlot = (typeof LOOK_SLOTS)[number]

/** The six wardrobe slots. A full-body item replaces the upper and lower ones. */
export const WEAR_SLOTS = ['head', 'upper', 'lower', 'full', 'back', 'feet'] as const satisfies readonly LookSlot[]
export type WearSlot = (typeof WEAR_SLOTS)[number]

/** One item as this hero wears it: which item, and the colours, finishes and cuts that make it theirs. */
export interface Worn {
  id: string
  /** Where its file lives: a built-in item, a built-in piece, or one a player generated. */
  url: string
  /** '#rrggbb' per channel; the item's own where absent or null. */
  colors?: (string | null)[]
  finishes?: (Finish | null)[]
  /** 0 (shortest) to 1 (as made), for the knobs the item allows. */
  knobs?: Partial<Record<Knob, number>>
}

export const wearUrl = (id: string) => `/kit/wear/${id}.glb`
export const pieceUrl = (id: string) => `/kit/pieces/${id}.glb`

const HEX = /^#[0-9a-f]{6}$/
const PIECE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
// a built-in piece, one the dev server stored, or one in a Blob store; the server checks which (src/server/gear.ts)
const PIECE_URL = /^(\/kit\/pieces\/[a-z0-9_-]+\.glb|\/dev-store\/pieces\/[0-9a-f-]{36}\.glb|https:\/\/[a-z0-9.-]+\/pieces\/[0-9a-f-]{36}\.glb)$/
// a wardrobe item: built in, a built-in piece, or one a player generated (the dev server's or a Blob store's)
const ITEM_URL = /^(\/kit\/(wear|pieces)\/[a-z0-9_-]+\.glb|\/dev-store\/(wear|pieces)\/[0-9a-f-]{36}\.glb|https:\/\/[a-z0-9.-]+\/(wear|pieces)\/[0-9a-f-]{36}\.glb)$/
const isFiniteIn = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max

/** Rebuild a look from untrusted input, keeping only what it knows; an invalid face is dropped, not the whole look. */
export function hydrateLook(raw: unknown): HeroLook | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Record<string, unknown>
  if (input.gender !== 'm' && input.gender !== 'f') return undefined
  const hair = (HAIR_STYLES as readonly string[]).includes(input.hair as string) ? (input.hair as HairStyle) : 'crop'
  const colorsIn = (input.colors ?? {}) as Record<string, unknown>
  const colors: HeroLook['colors'] = {}
  for (const key of LOOK_COLORS) {
    const v = colorsIn[key]
    if (typeof v === 'string' && HEX.test(v.toLowerCase())) colors[key] = v.toLowerCase()
  }
  const look: HeroLook = { gender: input.gender, hair, armour: input.armour === true, cape: input.cape === true, colors }
  if ((BEARD_STYLES as readonly string[]).includes(input.beard as string) && input.beard !== 'none') look.beard = input.beard as BeardStyle
  const face = input.face as Record<string, unknown> | undefined
  if (face && typeof face.url === 'string' && face.url.length <= 300 && isFiniteIn(face.width, 4096) && isFiniteIn(face.height, 4096) && Array.isArray(face.points) && face.points.length === FACE_POINTS * 2) {
    const limit = Math.max(face.width, face.height)
    if (face.points.every((p) => isFiniteIn(p, limit))) {
      look.face = { url: face.url, width: face.width, height: face.height, points: face.points.map((p) => Math.round((p as number) * 10) / 10) }
    }
  }
  const physique = input.physique as Record<string, unknown> | undefined
  if (physique && typeof physique === 'object' && isFiniteIn(physique.weight, 1) && isFiniteIn(physique.muscle, 1) && isFiniteIn(physique.age, 1)) {
    look.physique = { weight: physique.weight, muscle: physique.muscle, age: physique.age }
  }
  const wear = hydrateWear(input.wear)
  if (wear) look.wear = wear
  const gearIn = input.gear as Record<string, Record<string, unknown> | undefined> | undefined
  if (gearIn && typeof gearIn === 'object') {
    const gear: NonNullable<HeroLook['gear']> = {}
    for (const slot of GEAR_SLOTS) {
      const g = gearIn[slot]
      if (!g || typeof g.id !== 'string' || !PIECE_ID.test(g.id) || typeof g.url !== 'string' || !PIECE_URL.test(g.url)) continue
      gear[slot] = { id: g.id, url: g.url, ...(typeof g.color === 'string' && HEX.test(g.color.toLowerCase()) ? { color: g.color.toLowerCase() } : {}) }
    }
    if (Object.keys(gear).length) look.gear = gear
  }
  const skillsIn = input.skills as Record<string, unknown> | undefined
  if (skillsIn && typeof skillsIn === 'object') {
    const skills: NonNullable<HeroLook['skills']> = {}
    for (const slot of SKILL_SLOTS) {
      const kept = hydrateSkillLook(skillsIn[slot])
      if (kept) skills[slot] = kept
    }
    if (Object.keys(skills).length) look.skills = skills
  }
  return look
}

// the build's slots (build.ts imports this module, so they're listed here)
const SKILL_SLOTS: readonly BuildSlot[] = ['basic', 'active1', 'active2', 'passive', 'ultimate', 'movement']

/** A wardrobe from untrusted input: well-formed items in known slots (the server checks they exist). */
function hydrateWear(raw: unknown): HeroLook['wear'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Record<string, Record<string, unknown> | undefined>
  const wear: NonNullable<HeroLook['wear']> = {}
  for (const slot of LOOK_SLOTS) {
    const w = input[slot]
    if (!w || typeof w.id !== 'string' || !PIECE_ID.test(w.id) || typeof w.url !== 'string' || !ITEM_URL.test(w.url)) continue
    const item: Worn = { id: w.id, url: w.url }
    if (Array.isArray(w.colors) && w.colors.length <= 4) item.colors = w.colors.map((c) => (typeof c === 'string' && HEX.test(c.toLowerCase()) ? c.toLowerCase() : null))
    if (Array.isArray(w.finishes) && w.finishes.length <= 4) item.finishes = w.finishes.map((f) => ((FINISHES as readonly unknown[]).includes(f) ? (f as Finish) : null))
    const knobs = w.knobs as Record<string, unknown> | undefined
    if (knobs && typeof knobs === 'object') {
      const kept: Partial<Record<Knob, number>> = {}
      for (const k of KNOBS) if (isFiniteIn(knobs[k], 1)) kept[k] = Math.round((knobs[k] as number) * 1000) / 1000
      if (Object.keys(kept).length) item.knobs = kept
    }
    wear[slot] = item
  }
  // a full-body item replaces the upper and lower ones
  if (wear.full) {
    delete wear.upper
    delete wear.lower
  }
  return Object.keys(wear).length ? wear : undefined
}

/**
 * What a look wears, slot by slot. A wardrobe look wears its own; a look from before the wardrobe is read into
 * wardrobe items: its hair style and beard, a long-sleeve top, trousers and boots in its suit, trim, trouser and boot
 * colours (armour becomes a breastplate over the top), its cape, and its gear in the matching slots.
 */
export function outfitOf(look: HeroLook): Partial<Record<LookSlot, Worn>> {
  if (look.wear) return look.wear
  const c = look.colors
  const tinted = (id: string, ...colors: (string | undefined)[]): Worn => ({ id, url: wearUrl(id), colors: colors.map((x) => x ?? null) })
  const out: Partial<Record<LookSlot, Worn>> = {}
  if (look.hair === 'helmet') out.head = tinted('legion_helm', c.metal, c.trim)
  else if (look.hair !== 'none') out.hair = tinted(`hair_${look.hair}`, c.hair)
  if (look.beard) out.beard = tinted(`beard_${look.beard}`, c.hair)
  out.upper = look.armour ? tinted('breastplate', c.metal, c.suit) : tinted('longsleeve', c.suit, c.trim)
  out.lower = tinted('trousers', c.pants)
  out.feet = tinted('boots', c.boot)
  if (look.cape) out.back = tinted('cape', c.cape)
  for (const [slot, piece] of Object.entries(look.gear ?? {}) as [GearSlot, GearPiece][]) {
    out[slot] = { id: piece.id, url: piece.url, ...(piece.color ? { colors: [piece.color] } : {}) }
  }
  return out
}

/** '#rrggbb' from 0 to 1 sRGB channels. */
export function toHex([r, g, b]: readonly [number, number, number]): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

// ------------------------------------------------------------------------------------------------ defaults

/** A small stable number from a hero's name, so its default hair and skin never depend on which slot it fights in. */
export function nameSeed(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return h >>> 0
}

/** '#rrggbb' of an HSL colour in sRGB (hue wraps; saturation and lightness 0 to 1), the way THREE.Color.setHSL reads it. */
export function hslHex(h: number, s: number, l: number): string {
  const hue = ((h % 1) + 1) % 1
  const q = l <= 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const tt = ((t % 1) + 1) % 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * 6 * (2 / 3 - tt)
    return p
  }
  return toHex([channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)])
}

/** Before looks, a hero's body came from its role; a hero without a look keeps the gender that body had. */
export const ROLE_GENDER: Record<string, Gender> = { tank: 'm', fighter: 'm', assassin: 'm', mage: 'f', marksman: 'm', support: 'f', controller: 'f', summoner: 'm' }

/**
 * The look a hero has before anyone dresses it, from its role, name and suit hue: tanks in a helmet and armour, fighters
 * caped and armoured, a hair style and skin tone that follow the name, and a palette around the hue.
 */
export function defaultLook(roleId: string, heroName: string, hue: number): HeroLook & { colors: Record<LookColor, string> } {
  const seed = nameSeed(heroName || roleId)
  const styles: HairStyle[] = ['spiky', 'crop', 'long']
  const skins = [hslHex(0.07, 0.45, 0.72), hslHex(0.06, 0.4, 0.55), hslHex(0.07, 0.35, 0.4), hslHex(0.08, 0.5, 0.82)]
  return {
    gender: ROLE_GENDER[roleId] ?? 'm',
    hair: roleId === 'tank' ? 'helmet' : styles[seed % styles.length],
    armour: roleId === 'tank' || roleId === 'fighter' || roleId === 'support',
    cape: roleId === 'fighter' || roleId === 'mage' || roleId === 'tank',
    colors: {
      skin: skins[seed % skins.length],
      suit: hslHex(hue, 0.72, 0.5),
      trim: hslHex(hue + 0.09, 0.8, 0.66),
      pants: hslHex(hue, 0.3, 0.16),
      glove: hslHex(0.12, 0.12, 0.9),
      boot: hslHex(hue + 0.03, 0.25, 0.12),
      hair: [hslHex(0.08, 0.5, 0.12), hslHex(0.1, 0.65, 0.55), hslHex(0, 0, 0.08), hslHex(hue + 0.5, 0.6, 0.45)][seed % 4],
      metal: hslHex(0.1, 0.55, 0.55),
      iris: hslHex(hue + 0.45, 0.6, 0.35),
      brow: hslHex(0.08, 0.4, 0.1),
      // a deep, dusty cloth tone: a bright cape reads as a board behind the hero
      cape: hslHex(hue + 0.5, 0.42, 0.24),
    },
  }
}
