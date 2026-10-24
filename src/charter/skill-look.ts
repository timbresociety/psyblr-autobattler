import { FINISHES, type Finish } from '../kit/wear/item.js'
import { BUILT_IN_ITEMS } from '../kit/wear/library.gen.js'
import type { Delivery } from './types.js'

/**
 * Skill looks: how a skill looks, beside what it does. The template owns the mechanic, its numbers and its hit area;
 * the look owns everything you see. A Kamehameha, a Galick Gun and a Special Beam Cannon can share one beam template,
 * its numbers and its hit area, and still look nothing alike: a wave, a crackle and a drill, in their own colours,
 * from their own pose. A look is cosmetic: no number reads it and the balance gate's key ignores it, so editing one
 * never re-runs the gate. It lives on the hero's look (HeroLook.skills); the arena builds an effect recipe from it
 * (src/arena/recipes/defaults.ts) in which the layer that shows the hit area is always drawn at its true size.
 */

export const ELEMENTS = ['energy', 'fire', 'ice', 'lightning', 'water', 'wind', 'earth', 'shadow', 'light', 'poison', 'nature', 'metal', 'tech', 'cosmic', 'money', 'sound'] as const
export type Element = (typeof ELEMENTS)[number]

/** Deliveries that look alike share a family of forms: every movement skill can streak, flash or leave afterimages. */
export type FormFamily = 'beam' | 'projectile' | 'melee' | 'cone' | 'zone' | 'aura' | 'self' | 'movement'

export const FAMILY_OF: Record<Delivery['kind'], FormFamily> = {
  melee: 'melee',
  projectile: 'projectile',
  beam: 'beam',
  cone: 'cone',
  zone: 'zone',
  aura: 'aura',
  self: 'self',
  dash: 'movement',
  blink: 'movement',
  leap: 'movement',
  grapple: 'movement',
}

/** The shapes a delivery can take, its family's plain one first. */
export const FORMS = {
  beam: ['wave', 'crackle', 'drill', 'laser', 'helix', 'pillar', 'stream'],
  projectile: ['orb', 'bolt', 'disc', 'crescent', 'shard', 'meteor', 'arrow'],
  melee: ['slash', 'punch', 'claw', 'thrust', 'smash', 'flurry'],
  cone: ['spray', 'breath', 'shards', 'gust', 'sonic'],
  zone: ['blast', 'rain', 'pillar', 'dome', 'quake', 'vortex', 'field'],
  aura: ['ring', 'flame', 'storm', 'mist'],
  self: ['glow', 'flare', 'shield', 'spiral'],
  movement: ['streak', 'afterimage', 'smoke', 'flash', 'rocket', 'chain'],
} as const satisfies Record<FormFamily, readonly string[]>
export type Form = (typeof FORMS)[FormFamily][number]

/**
 * How the caster delivers it. Each is a clip on every body (tools/blender/humanlib/clips.py): `hip` is `cast`, and a
 * sword swing and a shot are the basic attack's `slash` and `shoot`.
 */
export const CAST_POSES = ['hip', 'palms', 'palm', 'fingers', 'overhead', 'cross', 'clap', 'slam', 'summon', 'breath', 'spin', 'swing', 'shot'] as const
export type CastPose = (typeof CAST_POSES)[number]
const POSE_CLIP: Partial<Record<CastPose, string>> = { hip: 'cast', swing: 'slash', shot: 'shoot' }
export const poseClip = (pose: CastPose): string => POSE_CLIP[pose] ?? `cast_${pose}`
/**
 * Seconds into each pose's clip where the hands let go (tools/blender/humanlib/clips.py). The engine casts at once, so
 * the arena starts a pose just before this, and the thrust lands with the beam; a swing and a shot play from the start.
 */
export const POSE_RELEASE: Record<CastPose, number> = { hip: 0.28, palms: 0.3, palm: 0.24, fingers: 0.38, overhead: 0.46, cross: 0.3, clap: 0.24, slam: 0.3, summon: 0.44, breath: 0.34, spin: 0.1, swing: 0, shot: 0 }

/** What builds before it lands. The engine casts at once, so a charge plays as the skill fires. */
export const CHARGES = ['gather', 'sky', 'crackle', 'point'] as const
export type Charge = (typeof CHARGES)[number]

export const IMPACTS = ['burst', 'dome', 'pillar', 'shatter', 'splash', 'pierce'] as const
export type Impact = (typeof IMPACTS)[number]

export const TRAILS = ['ribbon', 'sparks', 'smoke', 'motif'] as const
export type Trail = (typeof TRAILS)[number]

/** What a motif trail sheds: little pictures, one per cell of the motif sheet (src/arena/client/effects/vfx.ts). */
export const MOTIFS = ['coin', 'note', 'leaf', 'petal', 'snowflake', 'feather', 'star', 'skull', 'heart', 'bolt', 'code', 'card', 'bubble', 'flame', 'rune', 'shuriken'] as const
export type Motif = (typeof MOTIFS)[number]

export interface SkillLook {
  element: Element
  /** Core, glow and accent, as hex. */
  palette: [string, string, string]
  /** Its shape. One that doesn't suit the skill's delivery (after a template swap) gives way to the element's own. */
  form?: Form
  pose?: CastPose
  charge?: Charge
  impact?: Impact
  trail?: Trail
  /** What a motif trail sheds; the element's own when absent. */
  motif?: Motif
  /** The move's name, called out over the caster as it fires. */
  callout?: boolean
  /** Brightness, 0.5 to 2. It never changes a size. */
  intensity?: number
  /** How a transformation looks, for a skill whose template transforms the hero. Its size is the template's. */
  transformation?: TransformationLook
}

// ------------------------------------------------------------------------------------------------ transformations

/**
 * A transformation's look. The template owns the size the hero takes (bigger, its own, or smaller), how long it lasts
 * and what it's worth; the look owns how it arrives, what surrounds the hero while it lasts, how a change of size
 * plays, what it leaves as it moves, anything it wears beyond its body, and the body's own changes. Body changes are
 * swaps from the wardrobe library, so the outfit stays bound to a surface every size shares. Titan, Ant-Man,
 * Nine-Tails and Super Saiyan differ here, and in the template each one takes.
 */
export const FORM_ENTRIES = ['burst', 'strike', 'implode', 'swirl', 'smoke', 'flash'] as const
export type FormEntry = (typeof FORM_ENTRIES)[number]
export const FORM_AURAS = ['flame', 'steam', 'chakra', 'storm', 'sparks'] as const
export type FormAura = (typeof FORM_AURAS)[number]
/** How a change of size plays: swelling into the new size, or all at once. */
export const FORM_GROWTHS = ['swell', 'snap'] as const
export type FormGrowth = (typeof FORM_GROWTHS)[number]
export const FORM_TRAILS = ['streak', 'afterimage'] as const
export type FormTrail = (typeof FORM_TRAILS)[number]
/** Tails of energy on physics chains, or a spirit body that fills the hitbox exactly. */
export const FORM_AVATARS = ['tails', 'spirit'] as const
export type FormAvatar = (typeof FORM_AVATARS)[number]
export const FORM_MARKS = ['whiskers'] as const
export type FormMark = (typeof FORM_MARKS)[number]

/** A built-in wardrobe item a form puts on, in its own colours and finishes per channel. */
export interface FormItem {
  id: string
  colors?: (string | null)[]
  finishes?: (Finish | null)[]
}

/** What changes about the body while the form lasts. */
export interface FormBody {
  /** A built-in hair item, and the colour it's dyed. */
  hair?: string
  hairColor?: string
  eyes?: string
  marks?: FormMark
  /** Built-in items worn over the hero's own, one per slot; a full-body item covers the upper and lower ones. */
  wear?: FormItem[]
}

export interface TransformationLook {
  entry?: FormEntry
  aura?: FormAura
  growth?: FormGrowth
  trail?: FormTrail
  avatar?: FormAvatar
  body?: FormBody
}

interface ElementLook {
  palette: [string, string, string]
  /** The element's own form where it has one; the family's plain form otherwise. */
  forms: Partial<Record<FormFamily, Form>>
  impact: Impact
  trail: Trail
  motif: Motif
}

export const ELEMENT_LOOKS: Record<Element, ElementLook> = {
  energy: { palette: ['#f4fdff', '#59c7ff', '#2a6cff'], forms: {}, impact: 'burst', trail: 'ribbon', motif: 'star' },
  fire: { palette: ['#fff1a8', '#ff7a1a', '#c21f00'], forms: { beam: 'stream', projectile: 'meteor', cone: 'breath', zone: 'pillar', aura: 'flame', self: 'flare', movement: 'rocket' }, impact: 'burst', trail: 'smoke', motif: 'flame' },
  ice: { palette: ['#f0fbff', '#7fd6ff', '#2a7fff'], forms: { beam: 'laser', projectile: 'shard', cone: 'shards', zone: 'field', aura: 'mist', self: 'shield' }, impact: 'shatter', trail: 'sparks', motif: 'snowflake' },
  lightning: { palette: ['#ffffff', '#fff27a', '#5ab4ff'], forms: { beam: 'crackle', projectile: 'bolt', zone: 'rain', aura: 'storm', movement: 'flash' }, impact: 'burst', trail: 'sparks', motif: 'bolt' },
  water: { palette: ['#e8fbff', '#3ab0ff', '#0a4aa8'], forms: { beam: 'stream', cone: 'spray', zone: 'vortex', aura: 'mist' }, impact: 'splash', trail: 'ribbon', motif: 'bubble' },
  wind: { palette: ['#ffffff', '#bfeee6', '#5ad6c0'], forms: { beam: 'helix', projectile: 'crescent', cone: 'gust', zone: 'vortex', self: 'spiral' }, impact: 'burst', trail: 'ribbon', motif: 'leaf' },
  earth: { palette: ['#e6d2b0', '#8a6a3c', '#4a3a2a'], forms: { beam: 'pillar', projectile: 'meteor', melee: 'smash', cone: 'shards', zone: 'quake', self: 'shield' }, impact: 'shatter', trail: 'smoke', motif: 'rune' },
  shadow: { palette: ['#d6b3ff', '#4b1d7a', '#120018'], forms: { zone: 'vortex', aura: 'mist', movement: 'smoke' }, impact: 'dome', trail: 'smoke', motif: 'skull' },
  light: { palette: ['#ffffff', '#ffe58a', '#ffd23d'], forms: { beam: 'laser', projectile: 'arrow', zone: 'pillar', self: 'flare', movement: 'flash' }, impact: 'pillar', trail: 'sparks', motif: 'feather' },
  poison: { palette: ['#e8ffb0', '#7ad13a', '#2a5a10'], forms: { beam: 'stream', cone: 'spray', zone: 'field', aura: 'mist' }, impact: 'splash', trail: 'smoke', motif: 'skull' },
  nature: { palette: ['#f2ffd6', '#5ccf5a', '#2f7a2a'], forms: { beam: 'helix', projectile: 'shard', zone: 'field', self: 'spiral' }, impact: 'burst', trail: 'motif', motif: 'petal' },
  metal: { palette: ['#ffffff', '#c8d2dc', '#6a7884'], forms: { beam: 'drill', projectile: 'disc', melee: 'thrust', cone: 'shards', zone: 'quake', self: 'shield' }, impact: 'pierce', trail: 'sparks', motif: 'shuriken' },
  tech: { palette: ['#e8fff2', '#3dff8a', '#00b3ff'], forms: { beam: 'laser', projectile: 'bolt', zone: 'field', self: 'shield', movement: 'rocket' }, impact: 'burst', trail: 'motif', motif: 'code' },
  cosmic: { palette: ['#f6e8ff', '#a66bff', '#2a1a6b'], forms: { projectile: 'meteor', zone: 'rain', aura: 'storm', self: 'spiral', movement: 'afterimage' }, impact: 'dome', trail: 'motif', motif: 'star' },
  money: { palette: ['#fff6b0', '#ffd23d', '#2fae4f'], forms: { beam: 'stream', projectile: 'disc', zone: 'rain' }, impact: 'burst', trail: 'motif', motif: 'coin' },
  sound: { palette: ['#ffffff', '#ff8ad8', '#7a5cff'], forms: { cone: 'sonic', zone: 'dome' }, impact: 'dome', trail: 'motif', motif: 'note' },
}

export const ELEMENT_LABEL: Record<Element, string> = {
  energy: 'Energy',
  fire: 'Fire',
  ice: 'Ice',
  lightning: 'Lightning',
  water: 'Water',
  wind: 'Wind',
  earth: 'Earth',
  shadow: 'Shadow',
  light: 'Light',
  poison: 'Poison',
  nature: 'Nature',
  metal: 'Metal',
  tech: 'Tech',
  cosmic: 'Cosmic',
  money: 'Money',
  sound: 'Sound',
}

export const FORM_LABEL: Record<Form, string> = {
  wave: 'Wave',
  crackle: 'Crackle',
  drill: 'Drill',
  laser: 'Laser',
  helix: 'Twin helix',
  pillar: 'Pillar',
  stream: 'Stream',
  orb: 'Orb',
  bolt: 'Bolt',
  disc: 'Disc',
  crescent: 'Crescent',
  shard: 'Shard',
  meteor: 'Meteor',
  arrow: 'Arrow',
  slash: 'Slash',
  punch: 'Punch',
  claw: 'Claw',
  thrust: 'Thrust',
  smash: 'Smash',
  flurry: 'Flurry',
  spray: 'Spray',
  breath: 'Breath',
  shards: 'Shards',
  gust: 'Gust',
  sonic: 'Sound waves',
  blast: 'Blast',
  rain: 'Rain',
  dome: 'Dome',
  quake: 'Quake',
  vortex: 'Vortex',
  field: 'Field',
  ring: 'Ring',
  flame: 'Flames',
  storm: 'Storm',
  mist: 'Mist',
  glow: 'Glow',
  flare: 'Flare',
  shield: 'Shield',
  spiral: 'Spiral',
  streak: 'Streak',
  afterimage: 'Afterimages',
  smoke: 'Smoke',
  flash: 'Flash',
  rocket: 'Rocket',
  chain: 'Chain',
}

export const POSE_LABEL: Record<CastPose, string> = {
  hip: 'Hip charge',
  palms: 'Palms forward',
  palm: 'One palm',
  fingers: 'Two fingers',
  overhead: 'Overhead',
  cross: 'Cross burst',
  clap: 'Clap',
  slam: 'Ground slam',
  summon: 'Summon',
  breath: 'Breath',
  spin: 'Spin',
  swing: 'Sword swing',
  shot: 'Shot',
}

export const FORM_ENTRY_LABEL: Record<FormEntry, string> = { burst: 'Burst of power', strike: 'Lightning strike', implode: 'Implode', swirl: 'Swirl', smoke: 'Puff of smoke', flash: 'Flash' }
export const FORM_AURA_LABEL: Record<FormAura, string> = { flame: 'Flame aura', steam: 'Steam', chakra: 'Chakra cloak', storm: 'Crackling storm', sparks: 'Sparks' }
export const FORM_GROWTH_LABEL: Record<FormGrowth, string> = { swell: 'Swell', snap: 'Snap' }
export const FORM_TRAIL_LABEL: Record<FormTrail, string> = { streak: 'Streak', afterimage: 'Afterimages' }
export const FORM_AVATAR_LABEL: Record<FormAvatar, string> = { tails: 'Tails', spirit: 'Spirit body' }
export const FORM_MARK_LABEL: Record<FormMark, string> = { whiskers: 'Whisker marks' }

/** Each element's own way to transform, for a transformation nobody gave a look. */
export const ELEMENT_FORM: Record<Element, { entry: FormEntry; aura?: FormAura }> = {
  energy: { entry: 'burst', aura: 'flame' },
  fire: { entry: 'burst', aura: 'flame' },
  ice: { entry: 'burst', aura: 'steam' },
  lightning: { entry: 'strike', aura: 'storm' },
  water: { entry: 'swirl', aura: 'steam' },
  wind: { entry: 'swirl' },
  earth: { entry: 'burst', aura: 'steam' },
  shadow: { entry: 'smoke' },
  light: { entry: 'flash', aura: 'sparks' },
  poison: { entry: 'smoke', aura: 'steam' },
  nature: { entry: 'swirl', aura: 'sparks' },
  metal: { entry: 'flash', aura: 'sparks' },
  tech: { entry: 'flash', aura: 'sparks' },
  cosmic: { entry: 'swirl', aura: 'storm' },
  money: { entry: 'burst', aura: 'sparks' },
  sound: { entry: 'burst' },
}

export const CHARGE_LABEL: Record<Charge, string> = { gather: 'Gather', sky: 'Darken the sky', crackle: 'Crackling aura', point: 'Glowing fingertip' }
export const IMPACT_LABEL: Record<Impact, string> = { burst: 'Burst', dome: 'Dome', pillar: 'Pillar', shatter: 'Shatter', splash: 'Splash', pierce: 'Pierce' }
export const TRAIL_LABEL: Record<Trail, string> = { ribbon: 'Ribbon', sparks: 'Sparks', smoke: 'Smoke', motif: 'Motif' }
export const MOTIF_LABEL: Record<Motif, string> = {
  coin: 'Coins',
  note: 'Notes',
  leaf: 'Leaves',
  petal: 'Petals',
  snowflake: 'Snowflakes',
  feather: 'Feathers',
  star: 'Stars',
  skull: 'Skulls',
  heart: 'Hearts',
  bolt: 'Bolts',
  code: 'Code',
  card: 'Cards',
  bubble: 'Bubbles',
  flame: 'Flames',
  rune: 'Runes',
  shuriken: 'Shuriken',
}

const includes = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
export const isElement = (v: unknown): v is Element => includes(ELEMENTS, v)
const HEX = /^#[0-9a-f]{6}$/i

export const formsFor = (kind: Delivery['kind']): readonly Form[] => FORMS[FAMILY_OF[kind]]

/** A blink is gone in a flash and a grapple is a line to its target, whatever the element. */
const KIND_FORM: Partial<Record<Delivery['kind'], Form>> = { blink: 'flash', grapple: 'chain' }

/**
 * The form a look takes on this delivery: its own when it suits it, else the delivery's own (a blink's flash), else
 * its element's, else the family's plain one.
 */
export function formOf(look: Pick<SkillLook, 'element' | 'form'> | undefined, kind: Delivery['kind']): Form {
  const family = FAMILY_OF[kind]
  const forms: readonly Form[] = FORMS[family]
  if (look?.form && forms.includes(look.form)) return look.form
  return KIND_FORM[kind] ?? ((look && ELEMENT_LOOKS[look.element].forms[family]) || forms[0])
}

/** An element's look with nothing chosen beyond it. */
export const elementLook = (element: Element): SkillLook => ({ element, palette: [...ELEMENT_LOOKS[element].palette] })

/** A stored look, kept field by field: anything unknown or malformed is dropped, and a bad palette takes the element's. */
export function hydrateSkillLook(raw: unknown): SkillLook | undefined {
  const l = raw as Record<string, unknown> | undefined
  if (!l || typeof l !== 'object' || !isElement(l.element)) return undefined
  const palette = Array.isArray(l.palette) && l.palette.length === 3 && l.palette.every((c) => typeof c === 'string' && HEX.test(c)) ? (l.palette.map((c: string) => c.toLowerCase()) as SkillLook['palette']) : [...ELEMENT_LOOKS[l.element].palette]
  const allForms = Object.values(FORMS).flat() as readonly Form[]
  const intensity = typeof l.intensity === 'number' && l.intensity >= 0.5 && l.intensity <= 2 ? l.intensity : undefined
  return {
    element: l.element,
    palette: palette as SkillLook['palette'],
    ...(includes(allForms, l.form) ? { form: l.form } : {}),
    ...(includes(CAST_POSES, l.pose) ? { pose: l.pose } : {}),
    ...(includes(CHARGES, l.charge) ? { charge: l.charge } : {}),
    ...(includes(IMPACTS, l.impact) ? { impact: l.impact } : {}),
    ...(includes(TRAILS, l.trail) ? { trail: l.trail } : {}),
    ...(includes(MOTIFS, l.motif) ? { motif: l.motif } : {}),
    ...(l.callout === true ? { callout: true } : {}),
    ...(intensity !== undefined ? { intensity } : {}),
    ...transformationField(l.transformation),
  }
}

/** Built-in items a form may put on, by id: hair, and anything for the six wardrobe slots. */
const FORM_SLOTS = new Map(BUILT_IN_ITEMS.filter((i) => ['hair', 'head', 'upper', 'lower', 'full', 'back', 'feet'].includes(i.slot)).map((i) => [i.id, i.slot]))

/** Up to four channels' worth of a list, each entry kept or nulled. */
const channels = <T>(raw: unknown, keep: (v: unknown) => v is T): (T | null)[] | undefined =>
  Array.isArray(raw) && raw.length && raw.length <= 4 ? raw.map((v) => (keep(v) ? v : null)) : undefined

function hydrateFormItem(raw: unknown): FormItem | undefined {
  const i = raw as Record<string, unknown> | undefined
  if (!i || typeof i !== 'object' || typeof i.id !== 'string') return undefined
  const slot = FORM_SLOTS.get(i.id)
  if (!slot || slot === 'hair') return undefined
  const colors = channels(i.colors, (v): v is string => typeof v === 'string' && HEX.test(v))
  const finishes = channels(i.finishes, (v): v is Finish => includes(FINISHES, v))
  return { id: i.id, ...(colors ? { colors: colors.map((c) => c?.toLowerCase() ?? null) } : {}), ...(finishes ? { finishes } : {}) }
}

function hydrateFormBody(raw: unknown): FormBody | undefined {
  const b = raw as Record<string, unknown> | undefined
  if (!b || typeof b !== 'object') return undefined
  const body: FormBody = {}
  if (typeof b.hair === 'string' && FORM_SLOTS.get(b.hair) === 'hair') body.hair = b.hair
  if (typeof b.hairColor === 'string' && HEX.test(b.hairColor)) body.hairColor = b.hairColor.toLowerCase()
  if (typeof b.eyes === 'string' && HEX.test(b.eyes)) body.eyes = b.eyes.toLowerCase()
  if (includes(FORM_MARKS, b.marks)) body.marks = b.marks
  if (Array.isArray(b.wear)) {
    // one item a slot: a later item in the same slot gives way to the first
    const bySlot = new Map<string, FormItem>()
    for (const item of b.wear.slice(0, 6).map(hydrateFormItem)) if (item && !bySlot.has(FORM_SLOTS.get(item.id)!)) bySlot.set(FORM_SLOTS.get(item.id)!, item)
    if (bySlot.size) body.wear = [...bySlot.values()]
  }
  return Object.keys(body).length ? body : undefined
}

function transformationField(raw: unknown): { transformation?: TransformationLook } {
  const t = raw as Record<string, unknown> | undefined
  if (!t || typeof t !== 'object') return {}
  const body = hydrateFormBody(t.body)
  const look: TransformationLook = {
    ...(includes(FORM_ENTRIES, t.entry) ? { entry: t.entry } : {}),
    ...(includes(FORM_AURAS, t.aura) ? { aura: t.aura } : {}),
    ...(includes(FORM_GROWTHS, t.growth) ? { growth: t.growth } : {}),
    ...(includes(FORM_TRAILS, t.trail) ? { trail: t.trail } : {}),
    ...(includes(FORM_AVATARS, t.avatar) ? { avatar: t.avatar } : {}),
    ...(body ? { body } : {}),
  }
  return Object.keys(look).length ? { transformation: look } : {}
}
