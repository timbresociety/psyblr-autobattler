import type { NumericDial } from '../kit/body/physique.js'
import { GEAR_SLOTS, type GearPiece, type GearSlot, type HeroLook, type LookColor } from '../charter/look.js'
import { NEUTRAL_PHYSIQUE, type Physique } from '../kit/body/shape.js'
import { hydrateSculpt, type Sculpt } from '../kit/body/sculpt.js'
import { builtIn, wearing } from '../kit/pieces.js'
import { correctGear, type HeldWish } from './gear-read.js'
import { COLOUR_WORDS, coloursFromPrompt, physiqueFromPrompt } from './prompt.js'
import { sculptFromPrompt } from './sculpt-read.js'

/**
 * A change a player asks for in their own words, once the hero is built, as a patch to the named parts of its look
 * and nothing else (the creator goal, docs/plans/2026-10-31-canon-psyblr-human.md, phase 2): "stronger jaw", "a
 * bigger nose", "darker brows", "blue eyes", "darker skin", "a katana", "no shield", "older", "slimmer".
 * Each kind of change touches only its part, so a hero sculpted by hand keeps every other slider. Nothing here needs
 * the server: the words are read the way the offline reader reads a prompt, with nudges on top for comparatives.
 */
export interface LookPatch {
  look: HeroLook
  /** What was changed, in words to read back: "stronger jaw", "darker skin". */
  said: string[]
}

/** How far one "bigger" or "stronger" moves a feature; "much", "a lot" and "way" double it. */
const NUDGE = 0.25

/** A part the player names, and the feature each way of changing it moves. */
interface Part {
  words: RegExp
  name: string
  more: Record<string, number>
  wider?: Record<string, number>
  longer?: Record<string, number>
}

const PARTS: Part[] = [
  { words: /\bnose\b/, name: 'nose', more: { nose_length: 1, nose_width: 0.6, nose_projection: 0.4 }, wider: { nose_width: 1, nose_flare: 0.5 }, longer: { nose_length: 1 } },
  { words: /\beyes?\b/, name: 'eyes', more: { eye_size: 1, eye_opening: 0.5 }, wider: { eye_spacing: 1 }, longer: { eye_outer: 0.6 } },
  { words: /\b(?:mouth|lips?)\b/, name: 'mouth', more: { mouth_fullness: 1, lip_upper: 0.5, lip_lower: 0.6 }, wider: { mouth_width: 1 }, longer: { mouth_width: 0.6 } },
  { words: /\bchin\b/, name: 'chin', more: { chin_prominence: 1, chin_forward: 0.4 }, wider: { chin_width: 1 }, longer: { chin_height: 1 } },
  { words: /\bjaw(?:line)?\b/, name: 'jaw', more: { chin_width: 0.7, jaw_prognathism: 0.5, shape_square: 0.4 }, wider: { chin_width: 1, jaw_drop: 0.3 }, longer: { jaw_drop: 1 } },
  { words: /\bforehead\b/, name: 'forehead', more: { forehead_height: 1 }, wider: { forehead_temples: 1 }, longer: { forehead_height: 1 } },
  { words: /\bears?\b/, name: 'ears', more: { ear_size: 1 }, wider: { ear_flare: 1 }, longer: { ear_height: 1 } },
  { words: /\bcheek ?bones\b/, name: 'cheekbones', more: { cheekbones: 1 }, wider: { cheekbones: 0.8 }, longer: { cheek_height: 0.8 } },
  { words: /\bcheeks?\b/, name: 'cheeks', more: { cheek_volume: 1 }, wider: { cheek_volume: 0.8 }, longer: { cheek_height: 0.6 } },
  { words: /\b(?:eye)?brows?\b/, name: 'brows', more: { brow_ridge: 1 }, wider: { brow_angle: 0.6 }, longer: { brow_height: 1 } },
  { words: /\bneck\b/, name: 'neck', more: { neck_width: 1, neck_depth: 0.6 }, wider: { neck_width: 1 }, longer: { neck_length: 1 } },
  { words: /\b(?:head|skull|face)\b/, name: 'head', more: { head_fullness: 1 }, wider: { head_width: 1 }, longer: { head_length: 1 } },
]

const MORE = /\b(?:bigger|larger|stronger|fuller|thicker|heavier|more prominent|more pronounced|prominent|deeper|bolder|chunkier)\b/
const LESS = /\b(?:smaller|weaker|thinner|lighter|softer|finer|less prominent|less pronounced|subtler|slighter)\b/
const WIDER = /\b(?:wider|broader|squarer|flatter)\b/
const NARROWER = /\b(?:narrower|slimmer|pointier|sharper)\b/
const LONGER = /\b(?:longer|taller|higher)\b/
const SHORTER = /\b(?:shorter|lower)\b/
const MUCH = /\b(?:much|way|a lot|far|really|very)\b/

/** The nudges a message asks of the face: "a bigger nose", "stronger jaw", "narrower eyes", "much higher forehead". */
function nudges(text: string): { sculpt: Record<string, number>; said: string[] } {
  const sculpt: Record<string, number> = {}
  const said: string[] = []
  // each clause stands alone: "bigger nose and smaller ears" are two
  for (const clause of text.split(/[,;.]|\band\b|\bbut\b|\bwith\b/)) {
    const part = PARTS.find((p) => p.words.test(clause))
    if (!part) continue
    const scale = (MUCH.test(clause) ? 2 : 1) * NUDGE
    const apply = (table: Record<string, number> | undefined, sign: number, word: string) => {
      if (!table) return
      for (const [id, w] of Object.entries(table)) sculpt[id] = (sculpt[id] ?? 0) + sign * scale * w
      said.push(`${word} ${part.name}`)
    }
    if (MORE.test(clause)) apply(part.more, 1, clause.match(MORE)![0])
    else if (LESS.test(clause)) apply(part.more, -1, clause.match(LESS)![0])
    if (WIDER.test(clause)) apply(part.wider, 1, clause.match(WIDER)![0])
    else if (NARROWER.test(clause)) apply(part.wider, -1, clause.match(NARROWER)![0])
    if (LONGER.test(clause)) apply(part.longer, 1, clause.match(LONGER)![0])
    else if (SHORTER.test(clause)) apply(part.longer, -1, clause.match(SHORTER)![0])
  }
  return { sculpt, said }
}

// ------------------------------------------------------------------------------------------------ colours

const hex = (s: string): [number, number, number] | undefined => {
  const m = /^#([0-9a-f]{6})$/i.exec(s)
  if (!m) return undefined
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const toHex = (c: readonly number[]) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
/** A colour moved part of the way toward another. */
const toward = (from: string, to: string, t: number): string => {
  const a = hex(from) ?? [128, 128, 128]
  const b = hex(to) ?? a
  return toHex(a.map((v, i) => v + (b[i] - v) * t))
}

/** Where each named part's colour lives, and what it is when nothing set it. */
const COLOUR_PARTS: { words: RegExp; key: LookColor; name: string; own: string }[] = [
  { words: /\bskin\b|\bcomplexion\b/, key: 'skin', name: 'skin', own: '#c99d7a' },
  { words: /\beyes?\b/, key: 'iris', name: 'eyes', own: '#4a3220' },
  { words: /\b(?:eye)?brows?\b/, key: 'brow', name: 'brows', own: '#2a1d14' },
]
/** A shade asked for by comparison: "greyer brows", "lighter skin", "darker eyes". */
const SHADES: [RegExp, (from: string) => string, string][] = [
  [/\b(?:greyer|grayer|more grey|more gray|going grey|going gray|greying|graying)\b/, (c) => toward(c, '#8a8785', 0.55), 'greyer'],
  [/\b(?:whiter|white-haired|snow white|more white)\b/, (c) => toward(c, '#e4e2de', 0.6), 'whiter'],
  [/\b(?:lighter|paler|fairer|brighter)\b/, (c) => toward(c, '#ffffff', 0.22), 'lighter'],
  [/\b(?:darker|deeper|tanner|more tanned|duskier)\b/, (c) => toward(c, '#000000', 0.22), 'darker'],
  [/\b(?:warmer)\b/, (c) => toward(c, '#e0a060', 0.2), 'warmer'],
  [/\b(?:cooler|colder)\b/, (c) => toward(c, '#6080c0', 0.15), 'cooler'],
]

function colourChanges(text: string, colors: Partial<Record<LookColor, string>>): { colors: Partial<Record<LookColor, string>>; said: string[] } {
  const out: Partial<Record<LookColor, string>> = {}
  const said: string[] = []
  // named colours on named parts: "silver brows", "blue eyes", "olive skin"
  const named = coloursFromPrompt(text)
  for (const part of COLOUR_PARTS) {
    const c = named[part.key]
    if (!c) continue
    out[part.key] = c
    const word = Object.entries(COLOUR_WORDS).find(([, h]) => h === c)?.[0]
    said.push(`${word ?? c} ${part.name}`)
  }
  // shades by comparison, on the part named in the same clause
  for (const clause of text.split(/[,;.]|\band\b|\bbut\b/)) {
    const part = COLOUR_PARTS.find((p) => p.words.test(clause))
    if (!part || out[part.key]) continue
    const shade = SHADES.find(([re]) => re.test(clause))
    if (!shade) continue
    out[part.key] = shade[1](colors[part.key] ?? part.own)
    said.push(`${shade[2]} ${part.name}`)
  }
  return { colors: out, said }
}

// ------------------------------------------------------------------------------------------------ the build

const OLDER = /\b(?:older|age (?:him|her|them) up|more aged|elderly)\b/
const YOUNGER = /\b(?:younger|age (?:him|her|them) down|youthful)\b/
const HEAVIER = /\b(?:heavier|fatter|bulkier|stockier|broader build|chunkier build|bigger build)\b/
const SLIMMER = /\b(?:slimmer|thinner|leaner|skinnier|lighter build|slighter build)\b/
const STRONGER = /\b(?:more muscular|more muscle|more ripped|buffer|more buff|more jacked|more toned)\b/
const WEAKER = /\b(?:less muscular|less muscle|softer build|less toned|scrawnier)\b/

function physiqueChanges(text: string, physique: Physique | undefined): { physique?: Physique; said: string[] } {
  const said: string[] = []
  const base = { ...NEUTRAL_PHYSIQUE, ...physique }
  let next: Physique = base
  const step = MUCH.test(text) ? 0.3 : 0.15
  const move = (key: NumericDial, by: number, word: string) => {
    next = { ...next, [key]: Math.round(Math.min(1, Math.max(0, (next[key] ?? 0.5) + by)) * 100) / 100 }
    said.push(word)
  }
  if (OLDER.test(text)) move('age', step, 'older')
  else if (YOUNGER.test(text)) move('age', -step, 'younger')
  if (HEAVIER.test(text)) move('weight', step, 'heavier')
  else if (SLIMMER.test(text)) move('weight', -step, 'slimmer')
  if (STRONGER.test(text)) move('muscle', step, 'more muscular')
  else if (WEAKER.test(text)) move('muscle', -step, 'less muscular')
  if (!said.length) {
    // words for a whole build, as the reader hears them: "make him muscular", "old"
    const read = physiqueFromPrompt(text)
    if (read) return { physique: { ...base, ...Object.fromEntries(Object.entries(read).filter(([k, v]) => v !== NEUTRAL_PHYSIQUE[k as keyof Physique])) }, said: ['the build'] }
    return { said }
  }
  return { physique: next, said }
}

// ------------------------------------------------------------------------------------------------ the hands

/** "a katana", "twin daggers", "no shield", "unarmed": the hands the message fills or empties, from the built-in pieces. */
function gearChanges(text: string, gear: Partial<Record<GearSlot, GearPiece>>): { gear: Partial<Record<GearSlot, GearPiece>>; said: string[] } {
  const before: HeldWish = Object.fromEntries(GEAR_SLOTS.flatMap((s) => (gear[s] ? [[s, gear[s]!.id]] : [])))
  const after = correctGear(before, text)
  const out = { ...gear }
  const said: string[] = []
  for (const slot of GEAR_SLOTS) {
    if (after[slot] === before[slot]) continue
    const piece = after[slot] ? builtIn(after[slot]!) : undefined
    if (piece) {
      out[slot] = wearing(piece)
      said.push(piece.name.toLowerCase())
    } else {
      said.push(`no ${(builtIn(before[slot]!)?.name ?? 'piece').toLowerCase()}`)
      delete out[slot]
    }
  }
  return { gear: out, said }
}

/** The look a message patches, or undefined when it names nothing the patcher reads (a stat, say). */
export function patchLook(look: HeroLook, message: string): LookPatch | undefined {
  const text = message.toLowerCase()
  const said: string[] = []
  let next: HeroLook = { ...look }

  // the face: words for features, and nudges on named parts
  const nudged = nudges(text)
  const delta: Record<string, number> = {}
  for (const [id, v] of Object.entries(sculptFromPrompt(text) ?? {})) if (v) delta[id] = v
  for (const [id, v] of Object.entries(nudged.sculpt)) delta[id] = (delta[id] ?? 0) + v
  if (Object.keys(delta).length) {
    const sum: Record<string, number> = {}
    for (const [id, v] of Object.entries(look.sculpt ?? {})) if (v) sum[id] = v
    for (const [id, v] of Object.entries(delta)) sum[id] = (sum[id] ?? 0) + v
    const sculpt = hydrateSculpt(sum)
    next = { ...next, ...(sculpt ? { sculpt } : {}) }
    if (!sculpt) delete next.sculpt
    said.push(...(nudged.said.length ? nudged.said : ['the face']))
  }

  const colours = colourChanges(text, look.colors)
  if (colours.said.length) {
    next = { ...next, colors: { ...next.colors, ...colours.colors } }
    said.push(...colours.said)
  }

  const physique = physiqueChanges(text, look.physique)
  if (physique.physique) {
    next = { ...next, physique: physique.physique }
    said.push(...physique.said)
  }

  const gear = gearChanges(text, look.gear ?? {})
  if (gear.said.length) {
    next = Object.keys(gear.gear).length ? { ...next, gear: gear.gear } : { ...next }
    if (!Object.keys(gear.gear).length) delete next.gear
    said.push(...gear.said)
  }
  return said.length ? { look: next, said: [...new Set(said)] } : undefined
}
