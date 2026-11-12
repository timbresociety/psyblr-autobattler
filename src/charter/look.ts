import type { Physique } from '../kit/body/shape.js'
import type { CarrySlot } from '../kit/rig/metarig.js'
import { isAttitude, type AttitudeId } from '../kit/anim/attitude.js'
import { hydratePhysique } from '../kit/body/physique.js'
import { hydrateSculpt, type Sculpt } from '../kit/body/sculpt.js'
import { hydrateSkillLook, type SkillLook } from './skill-look.js'
import { coverageOf } from '../kit/anim/coverage.js'
import { MOTION_SLOTS, STYLES, type MotionSlot, type Style } from './motions.js'
import type { BuildSlot } from './types.js'

const BUILD_SLOTS: readonly BuildSlot[] = ['basic', 'active1', 'active2', 'movement', 'passive', 'ultimate']

/**
 * A hero's look (cosmetic only: no number in the game reads it). The body comes from the hero's size and this look's
 * gender (public/heroes/<m|f>-<size>.glb), shaped by its physique; a photo face, with the 478 landmarks the Forge
 * found on it, is warped onto the body's own face wherever the hero is drawn; and it holds a weapon in either hand.
 *
 * Heroes are drawn bare: no clothes, hair or beard (owner, 2026-11-04). What a hero wears will come with the hero's
 * own generated mesh in the Forge rework. Looks saved with a wardrobe, hair or a beard still load, without them.
 */

export type Gender = 'm' | 'f'

export const GENDER_LABEL: Record<Gender, string> = { m: 'Man', f: 'Woman' }

/** Regions the look can colour; each takes '#rrggbb'. */
export const LOOK_COLORS = ['skin', 'iris', 'brow'] as const
export type LookColor = (typeof LOOK_COLORS)[number]
export const LOOK_COLOR_LABEL: Record<LookColor, string> = { skin: 'Skin', iris: 'Eyes', brow: 'Brows' }

/** Where a piece of gear hangs on a body: a weapon in either hand (each body's sockets come from tools/blender/humanlib/sockets.py). */
export const GEAR_SLOTS = ['hand_r', 'hand_l'] as const
export type GearSlot = (typeof GEAR_SLOTS)[number]

/** What a piece is made for. A hand piece fits either hand; an off-hand piece (a shield, a bow) only the left. */
export const PIECE_KINDS = ['hand', 'offhand'] as const
export type PieceKind = (typeof PIECE_KINDS)[number]

export const SLOT_KINDS: Record<GearSlot, readonly PieceKind[]> = { hand_r: ['hand'], hand_l: ['hand', 'offhand'] }

/** A piece of gear a hero holds: its id in the asset repository, where its model lives, and the colour it takes. */
export interface GearPiece {
  id: string
  url: string
  /** The colour of the piece's 'primary' material; the piece's own when absent. */
  color?: string
}

/**
 * A weapon a hero swaps between a hand and a carry slot (kit/body/carry.ts): out for the attacks of its `use`, waiting
 * on `stow` while the other set is out. One without a hand (a quiver) only ever waits.
 */
export interface ArmPiece {
  piece: GearPiece
  use: 'melee' | 'ranged'
  hand?: GearSlot
  stow: CarrySlot
}

/** A photo face: where it is stored, its size, and its landmarks as x, y pairs in its own pixels. */
export interface FacePhoto {
  url: string
  width: number
  height: number
  points: number[]
  /** Per landmark, MediaPipe's depth in the photo's pixels (positive away from the camera); the fit uses it when present. */
  depth?: number[]
  /** 0 to 1: how much of the photo's shape the face takes (the picture itself is always laid on whole); all of it when absent. */
  strength?: number
}

export interface HeroLook {
  gender: Gender
  /** Weight, muscle and age (each 0 to 1); the body as made when absent. */
  physique?: Physique
  colors: Partial<Record<LookColor, string>>
  face?: FacePhoto
  /** The head and face sculpted by hand (src/kit/body/sculpt.ts), on top of the photo face when there is one. */
  sculpt?: Sculpt
  /** The idle the hero stands in, from the motion library (public/anim/index.json); its gender's first when absent. */
  idle?: string
  /** How the hero carries itself moving and fighting (kit/anim/attitude.ts); neutral when absent. */
  attitude?: AttitudeId
  /** Rigid pieces in the body's hand sockets: a weapon in each hand. */
  gear?: Partial<Record<GearSlot, GearPiece>>
  /** Weapons swapped in and out of the hands by what the hero does (the dev lab's John); not saved with a hero. */
  arms?: readonly ArmPiece[]
  /** How each skill looks (skill-look.ts); a skill without one takes a look from its words. */
  skills?: Partial<Record<BuildSlot, SkillLook>>
  /** How the hero fights (motions.ts): what its melee and skills are picked from; its role's style when absent. */
  style?: Style
  /**
   * The hero's own motions by clip (MOTION_SLOTS, motions.ts); the catalogue's pick for each in its style when absent.
   * The movement skill's and the passive's come from a dev lab only: a saved look drops them (their kinds pick them).
   */
  motions?: Partial<Record<MotionSlot | 'movement' | 'passive', string>>
}

export const FACE_POINTS = 478

export const pieceUrl = (id: string) => `/kit/pieces/${id}.glb`

const HEX = /^#[0-9a-f]{6}$/
const PIECE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
// a clip in the motion library; one it doesn't have plays its gender's first idle
const CLIP_ID = /^[a-z][a-z0-9_]{0,63}$/
// a built-in piece, one the dev server stored, or one in a Blob store; the server checks which (src/server/gear.ts)
const PIECE_URL = /^(\/kit\/pieces\/[a-z0-9_-]+\.glb|\/dev-store\/pieces\/[0-9a-f-]{36}\.glb|https:\/\/[a-z0-9.-]+\/pieces\/[0-9a-f-]{36}\.glb)$/
const isFiniteIn = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max

/** Rebuild a look from untrusted input, keeping only what it knows; an invalid face is dropped, not the whole look. */
export function hydrateLook(raw: unknown): HeroLook | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Record<string, unknown>
  if (input.gender !== 'm' && input.gender !== 'f') return undefined
  const colorsIn = (input.colors ?? {}) as Record<string, unknown>
  const colors: HeroLook['colors'] = {}
  for (const key of LOOK_COLORS) {
    const v = colorsIn[key]
    if (typeof v === 'string' && HEX.test(v.toLowerCase())) colors[key] = v.toLowerCase()
  }
  const look: HeroLook = { gender: input.gender, colors }
  const face = input.face as Record<string, unknown> | undefined
  if (face && typeof face.url === 'string' && face.url.length <= 300 && isFiniteIn(face.width, 4096) && isFiniteIn(face.height, 4096) && Array.isArray(face.points) && face.points.length === FACE_POINTS * 2) {
    const limit = Math.max(face.width, face.height)
    if (face.points.every((p) => isFiniteIn(p, limit))) {
      look.face = { url: face.url, width: face.width, height: face.height, points: face.points.map((p) => Math.round((p as number) * 10) / 10) }
      if (isFiniteIn(face.strength, 1) && face.strength < 1) look.face.strength = Math.round(face.strength * 100) / 100
      const depth = face.depth
      if (Array.isArray(depth) && depth.length === FACE_POINTS && depth.every((d) => typeof d === 'number' && Number.isFinite(d) && Math.abs(d) <= limit)) look.face.depth = depth.map((d) => Math.round((d as number) * 10) / 10)
    }
  }
  // every Structure and Volume dial (GAME.md §9.3), the six proportions among them
  const physique = hydratePhysique(input.physique)
  if (physique) look.physique = physique
  const sculpt = hydrateSculpt(input.sculpt)
  if (sculpt) look.sculpt = sculpt
  if (typeof input.idle === 'string' && CLIP_ID.test(input.idle)) look.idle = input.idle
  if (isAttitude(input.attitude) && input.attitude !== 'neutral') look.attitude = input.attitude
  // only a style the library animates in full (GAME.md §12; coverage.test.ts holds the library to it)
  if (typeof input.style === 'string' && (STYLES as readonly string[]).includes(input.style) && coverageOf(input.style)?.offered !== false) look.style = input.style as Style
  if (input.motions && typeof input.motions === 'object') {
    // a look saved before the kit's motions were split keeps its basic attack's as the combo's opener, and drops the
    // passive's and the movement skill's, which every hero now shares
    const motions = Object.fromEntries(
      Object.entries(input.motions as Record<string, unknown>)
        .map(([slot, clip]) => [slot === 'basic' ? 'combo1' : slot, clip])
        .filter(([slot, clip]) => (MOTION_SLOTS as readonly string[]).includes(slot as string) && typeof clip === 'string' && CLIP_ID.test(clip)),
    )
    if (Object.keys(motions).length) look.motions = motions as Partial<Record<MotionSlot, string>>
  }
  // a weapon in either hand, as gear or, from a look saved with a wardrobe, as a worn piece; hair, a beard, clothes and
  // pieces worn anywhere else are dropped
  const wornIn = (input.wear ?? {}) as Record<string, Record<string, unknown> | undefined>
  const gearIn = (input.gear ?? {}) as Record<string, Record<string, unknown> | undefined>
  const gear: NonNullable<HeroLook['gear']> = {}
  for (const slot of GEAR_SLOTS) {
    const g = gearIn[slot] ?? wornIn[slot]
    if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !PIECE_ID.test(g.id) || typeof g.url !== 'string' || !PIECE_URL.test(g.url)) continue
    const color = typeof g.color === 'string' ? g.color : Array.isArray(g.colors) ? g.colors[0] : undefined
    gear[slot] = { id: g.id, url: g.url, ...(typeof color === 'string' && HEX.test(color.toLowerCase()) ? { color: color.toLowerCase() } : {}) }
  }
  if (Object.keys(gear).length) look.gear = gear
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

/** The weapons a look holds, by hand. */
export function heldOf(look: HeroLook): Partial<Record<GearSlot, GearPiece>> {
  return look.gear ?? {}
}

/** '#rrggbb' from 0 to 1 sRGB channels. */
export function toHex([r, g, b]: readonly [number, number, number]): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

// ------------------------------------------------------------------------------------------------ defaults

/** A small stable number from a hero's name, so its default skin never depends on which slot it fights in. */
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

/** The look a hero has before anyone changes it: a body in its role's gender, and a skin tone and eyes from its name and hue. */
export function defaultLook(roleId: string, heroName: string, hue: number): HeroLook & { colors: Record<LookColor, string> } {
  const seed = nameSeed(heroName || roleId)
  const skins = [hslHex(0.07, 0.45, 0.72), hslHex(0.06, 0.4, 0.55), hslHex(0.07, 0.35, 0.4), hslHex(0.08, 0.5, 0.82)]
  return {
    gender: ROLE_GENDER[roleId] ?? 'm',
    colors: {
      skin: skins[seed % skins.length],
      iris: hslHex(hue + 0.45, 0.6, 0.35),
      brow: hslHex(0.08, 0.4, 0.1),
    },
  }
}
