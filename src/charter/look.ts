/**
 * A hero's look (cosmetic only: no number in the game reads it). The body comes from the hero's size and this look's
 * gender (public/heroes/<m|f>-<size>.glb); hair, a beard, armour, cape and a colour per region dress it; a photo face,
 * with the 478 landmarks the Forge found on it, is warped onto the body's own face wherever the hero is drawn; and
 * gear from the asset repository hangs in the body's sockets.
 */

export type Gender = 'm' | 'f'

export const HAIR_STYLES = ['none', 'buzz', 'crop', 'short', 'curly', 'swept', 'spiky', 'bob', 'long', 'volume', 'helmet'] as const
export type HairStyle = (typeof HAIR_STYLES)[number]

export const BEARD_STYLES = ['none', 'goatee', 'full', 'chin_curtain'] as const
export type BeardStyle = (typeof BEARD_STYLES)[number]

/** Regions the look can colour; each takes '#rrggbb'. */
export const LOOK_COLORS = ['skin', 'suit', 'trim', 'pants', 'glove', 'boot', 'hair', 'iris', 'brow', 'cape', 'metal'] as const
export type LookColor = (typeof LOOK_COLORS)[number]

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
  hair: HairStyle
  /** Facial hair; none when absent. */
  beard?: BeardStyle
  armour: boolean
  cape: boolean
  colors: Partial<Record<LookColor, string>>
  face?: FacePhoto
  /** Rigid pieces in the body's sockets: a hat, glasses, a weapon in each hand, something on the back. */
  gear?: Partial<Record<GearSlot, GearPiece>>
}

export const FACE_POINTS = 478

const HEX = /^#[0-9a-f]{6}$/
const PIECE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
// a built-in piece, one the dev server stored, or one in a Blob store; the server checks which (src/server/gear.ts)
const PIECE_URL = /^(\/kit\/pieces\/[a-z0-9_-]+\.glb|\/dev-store\/pieces\/[0-9a-f-]{36}\.glb|https:\/\/[a-z0-9.-]+\/pieces\/[0-9a-f-]{36}\.glb)$/
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
  return look
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
