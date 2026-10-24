import { BEARD_STYLES, pieceUrl, wearUrl, type BeardStyle, type Gender, type HairStyle, type HeroLook, type LookSlot, type Worn } from '../../charter/look.js'
import type { Finish, Knob } from '../../kit/wear/item.js'
import type { Physique } from '../../kit/body/shape.js'
import faces from './faces.json'

/**
 * The demo roster's looks, each made from the charter the way a player's hero is: a body in the person's gender, a
 * physique for their build, their portrait as a photo face (its shape fitted in the browser, face/shape.ts), library
 * hair and a beard, a signature outfit of library items in their colours, and their gear. Nothing about them is
 * bespoke, so a remix wears the same look, and anyone can dress like them.
 *
 * The builds, outfits and colours come from the Blender specs that made their old models (tools/blender/humanlib,
 * before the wardrobe). A physique is relative to the hero's size class's body: 0.5 is that body as made, and each
 * value reproduces the person's MakeHuman weight and muscle on it; age runs from 28 (0) to 75 (1). The photo faces,
 * and the skin and eye colours read off them, come from scripts/demo-faces.ts. One thing the old models had is gone
 * on purpose: each person's own height. A hero's size class sets its height, so the hitbox stays the truth.
 */

const FACES: Record<string, { width: number; height: number; skin: string; iris?: string; points: number[] }> = faces

interface Recipe {
  gender: Gender
  physique: Physique
  /** Hair and beard items, in the hair colour. */
  hair?: string
  beard?: string
  color: string
  /** The beard's own colour, where it isn't the hair's. */
  beardColor?: string
  /** The nearest pre-wardrobe hair style, for the Forge's look panel. */
  style: HairStyle
  wear: Partial<Record<LookSlot, Worn>>
}

interface Cut {
  finishes?: (Finish | null)[]
  knobs?: Partial<Record<Knob, number>>
}

/** A library item in this hero's colours (null, or none, keeps the item's own), finishes and cuts. */
function item(id: string, colors: (string | null)[] = [], cut: Cut = {}): Worn {
  return { id, url: wearUrl(id), ...(colors.length ? { colors } : {}), ...cut }
}

/** A rigid piece of gear in this hero's colour, or its own. */
function piece(id: string, color?: string): Worn {
  return { id, url: pieceUrl(id), ...(color ? { colors: [color] } : {}) }
}

// shirt white, and the black of shoes and dark suits
const WHITE = '#e6e6eb'
const BLACK = '#0d0d0e'
const DRESS_SHOES = item('dress_shoes', [BLACK])

const RECIPES: Record<string, Recipe> = {
  musk: {
    gender: 'm', physique: { weight: 0.46, muscle: 0.26, age: 0.55 }, hair: 'hair_short', color: '#3c2819', style: 'short',
    // a fabric jacket over a black tee
    wear: { upper: item('leather_jacket', ['#1a1a1f', BLACK], { finishes: ['cotton', null] }), lower: item('jeans', ['#17171c', null]), feet: item('boots', [BLACK]) },
  },
  huang: {
    gender: 'm', physique: { weight: 0.5, muscle: 0.33, age: 0.7 }, hair: 'hair_swept', color: '#4a4a4e', style: 'swept',
    wear: { upper: item('leather_jacket', ['#111112', BLACK]), lower: item('jeans', ['#121214', null]), feet: item('boots', ['#0b0b0c']) },
  },
  bezos: {
    gender: 'm', physique: { weight: 0.33, muscle: 0.4, age: 0.7 }, color: '#3b291b', style: 'none',
    wear: { upper: item('shirt', ['#9ebde0'], { knobs: { sleeve: 0.8 } }), lower: item('trousers', ['#171c33']), feet: item('dress_shoes', ['#4c2e1a']) },
  },
  zuckerberg: {
    gender: 'm', physique: { weight: 0.53, muscle: 0.5, age: 0.28 }, hair: 'hair_curly', color: '#563720', style: 'curly',
    wear: { upper: item('tee', ['#757880']), lower: item('jeans', ['#2b3d61', null]), feet: item('sneakers', ['#bfbfc2', null]) },
  },
  nadella: {
    gender: 'm', physique: { weight: 0.5, muscle: 0.27, age: 0.64 }, hair: 'hair_thin', color: '#636160', style: 'short',
    // an open-necked shirt under the jacket: the blazer over a top, in cotton
    wear: { upper: item('blazer_silk', ['#171c33', '#9ebde0'], { finishes: [null, 'cotton'] }), lower: item('trousers', ['#29292e']), feet: DRESS_SHOES, face: piece('square_glasses', '#8c8d93') },
  },
  altman: {
    gender: 'm', physique: { weight: 0.48, muscle: 0.33, age: 0.26 }, hair: 'hair_short', color: '#3b291b', style: 'short',
    wear: { upper: item('sweater', ['#5c616b']), lower: item('jeans', ['#2b3d61', null]), feet: item('sneakers', ['#d1d1cc', null]) },
  },
  buffett: {
    gender: 'm', physique: { weight: 0.58, muscle: 0.25, age: 1 }, hair: 'hair_fringe_white', color: '#cfcfcb', style: 'short',
    wear: { upper: item('suit_jacket', ['#54575e', WHITE, '#801a1f']), lower: item('trousers', ['#4c4f57']), feet: DRESS_SHOES, face: piece('glasses', '#141416') },
  },
  winfrey: {
    gender: 'f', physique: { weight: 0.66, muscle: 0.27, age: 0.91 }, hair: 'hair_volume', color: '#291810', style: 'volume',
    wear: { upper: item('blazer_silk', ['#5c1a5c', '#1f0d1f']), lower: item('trousers', ['#1f0f1f']), feet: DRESS_SHOES },
  },
  ambani: {
    gender: 'm', physique: { weight: 0.62, muscle: 0.2, age: 0.83 }, hair: 'hair_swept', color: '#131111', style: 'swept',
    wear: { upper: item('blazer_silk', ['#1c1f2b', WHITE], { finishes: [null, 'cotton'] }), lower: item('trousers', ['#141416']), feet: DRESS_SHOES },
  },
  su: {
    gender: 'f', physique: { weight: 0.41, muscle: 0.38, age: 0.57 }, hair: 'hair_swept', color: '#161617', style: 'swept',
    wear: { upper: item('blazer_silk', ['#8c141a', '#0f0f10']), lower: item('trousers', ['#121213']), feet: DRESS_SHOES, face: piece('square_glasses', '#8a8580') },
  },
  lincoln: {
    gender: 'm', physique: { weight: 0.18, muscle: 0.23, age: 0.6 }, hair: 'hair_unkempt', beard: 'beard_chin_curtain', color: '#1a130f', style: 'long',
    wear: { upper: item('frock_coat', ['#0f0f10', WHITE, '#0a0a0b']), lower: item('trousers', ['#121213']), feet: DRESS_SHOES, head: piece('top_hat', BLACK) },
  },
  churchill: {
    gender: 'm', physique: { weight: 0.81, muscle: 0.2, age: 0.85 }, hair: 'hair_thin', color: '#ae967b', style: 'short',
    wear: { full: item('three_piece', ['#1a1a1f', WHITE, '#121a4c']), feet: DRESS_SHOES, face: item('cigar') },
  },
  obama: {
    gender: 'm', physique: { weight: 0.4, muscle: 0.33, age: 0.77 }, hair: 'hair_buzz', color: '#343232', style: 'buzz',
    wear: { upper: item('suit_jacket', ['#141a2e', WHITE, '#5280bf']), lower: item('trousers', ['#141a2e']), feet: DRESS_SHOES },
  },
  trump: {
    gender: 'm', physique: { weight: 0.56, muscle: 0.23, age: 1 }, hair: 'hair_quiff', color: '#e2c279', style: 'swept',
    wear: { upper: item('suit_jacket', ['#12172b', WHITE, '#b80f14']), lower: item('trousers', ['#12172b']), feet: DRESS_SHOES },
  },
  modi: {
    gender: 'm', physique: { weight: 0.6, muscle: 0.23, age: 1 }, hair: 'hair_fringe_white', beard: 'beard_full', color: '#dadad6', style: 'short',
    // the kurta's cream under the vest's own saffron
    wear: { upper: item('kurta_vest', ['#ede6d6', null]), lower: item('trousers', ['#ebe6d9']), feet: item('dress_shoes', ['#4c2e1a']), face: piece('square_glasses', '#c7a866') },
  },
  merkel: {
    gender: 'f', physique: { weight: 0.62, muscle: 0.23, age: 0.91 }, hair: 'hair_bob', color: '#cfb382', style: 'bob',
    wear: { upper: item('blazer_silk', ['#db245b', '#0f0f10']), lower: item('trousers', ['#121213']), feet: DRESS_SHOES },
  },
  macron: {
    gender: 'm', physique: { weight: 0.48, muscle: 0.38, age: 0.4 }, hair: 'hair_side_part', color: '#3b2f27', style: 'short',
    wear: { upper: item('suit_jacket', ['#0f1429', WHITE, '#0d1224']), lower: item('trousers', ['#0f1429']), feet: DRESS_SHOES },
  },
  zelenskyy: {
    // a thin full beard: the stubble, a shade lighter than the hair so the skin seems to show through
    gender: 'm', physique: { weight: 0.55, muscle: 0.41, age: 0.4 }, hair: 'hair_crop', beard: 'beard_stubble', color: '#32271d', beardColor: '#5a4030', style: 'crop',
    wear: { upper: item('longsleeve', ['#454c33']), lower: item('cargo', ['#3b402e']), feet: item('combat_boots', ['#261f17', null]) },
  },
  ardern: {
    gender: 'f', physique: { weight: 0.57, muscle: 0.38, age: 0.36 }, hair: 'hair_long', color: '#462d1b', style: 'long',
    wear: { full: item('long_coat', ['#14171f', '#d9d4cc', '#121213'], { finishes: [null, 'silk', null] }), feet: DRESS_SHOES },
  },
  yew: {
    gender: 'm', physique: { weight: 0.38, muscle: 0.38, age: 0.51 }, hair: 'hair_side_part', color: '#252525', style: 'short',
    wear: { upper: item('shirt', ['#f0f0f2'], { knobs: { sleeve: 0.3 } }), lower: item('trousers', ['#ebebed']), feet: DRESS_SHOES },
  },
}

/** The demo heroes' ids, in roster order: each is its portrait's name too (public/kit/faces/<id>.webp). */
export const DEMO_IDS = Object.keys(RECIPES)

/** A demo hero's look, made fresh each call so nothing that edits one can reach another. */
export function demoLook(id: string): HeroLook {
  const r = RECIPES[id]
  const f = FACES[id]
  if (!r || !f) throw new Error(`no demo look called ${id}`)
  const wear: Partial<Record<LookSlot, Worn>> = structuredClone(r.wear)
  if (r.hair) wear.hair = item(r.hair, [r.color])
  if (r.beard) wear.beard = item(r.beard, [r.beardColor ?? r.color])
  // the panel's beard, where the item is one of its styles
  const beard = r.beard?.slice('beard_'.length) as BeardStyle | undefined
  return {
    gender: r.gender,
    physique: { ...r.physique },
    hair: r.style,
    ...(beard && (BEARD_STYLES as readonly string[]).includes(beard) ? { beard } : {}),
    armour: false,
    cape: false,
    colors: { skin: f.skin, hair: r.color, ...(f.iris ? { iris: f.iris } : {}) },
    face: { url: `/kit/faces/${id}.webp`, width: f.width, height: f.height, points: [...f.points] },
    wear,
  }
}
