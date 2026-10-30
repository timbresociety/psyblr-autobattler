import { hydrateSculpt, type Sculpt } from '../kit/body/sculpt.js'

/**
 * The face and head a prompt describes, for the offline reader: "a square jaw", "big anime eyes", "a broad nose",
 * "high cheekbones" sculpt the matching features (src/kit/body/sculpt.ts). Words that stack add up, held to each
 * feature's range.
 */
const FACE_WORDS: [RegExp, Sculpt][] = [
  [/\b(?:square|strong|chiseled|chiselled)[- ]jaw(?:ed)?\b|\bsquare face\b|\bchis[e]?ll?ed\b/i, { shape_square: 0.6, chin_width: 0.4, chin_prominence: 0.3 }],
  [/\bround face\b|\bbaby[- ]?face\b|\bmoon face\b/i, { shape_round: 0.6, cheek_volume: 0.4 }],
  [/\b(?:long|narrow|horse) face\b/i, { shape_rectangular: 0.6, head_width: -0.3 }],
  [/\bheart[- ]shaped face\b|\bpointed chin\b|\bv[- ]shaped (?:face|jaw)\b/i, { shape_invertedtriangular: 0.6, chin_width: -0.4 }],
  [/\bdiamond[- ]shaped face\b|\bdiamond face\b/i, { shape_diamond: 0.6 }],
  [/\boval face\b/i, { shape_oval: 0.6 }],
  [/\b(?:big|large|huge|wide|anime|doe|round) eyes\b/i, { eye_size: 0.7, eye_opening: 0.4 }],
  [/\b(?:small|narrow|squinty|squinting|beady|tired) eyes\b/i, { eye_size: -0.5, eye_opening: -0.4 }],
  [/\b(?:almond|cat|feline|fox|sharp|upturned) eyes\b/i, { eye_outer: 0.5, eye_opening: -0.2 }],
  [/\b(?:droopy|sad|puppy|downturned) eyes\b/i, { eye_outer: -0.5 }],
  [/\bwide[- ]set eyes\b/i, { eye_spacing: 0.5 }],
  [/\bclose[- ]set eyes\b/i, { eye_spacing: -0.5 }],
  [/\b(?:big|large|long|roman|hooked|aquiline|crooked) nose\b/i, { nose_length: 0.5, nose_width: 0.3 }],
  [/\b(?:small|button|tiny|cute|upturned|snub) nose\b/i, { nose_length: -0.5, nose_width: -0.3 }],
  [/\b(?:wide|broad|flat) nose\b/i, { nose_width: 0.6, nose_flare: 0.4 }],
  [/\b(?:narrow|thin|pointed|sharp) nose\b/i, { nose_width: -0.6, nose_flare: -0.3 }],
  [/\b(?:full|thick|plump|big|pouty) lips\b/i, { mouth_fullness: 0.6, lip_upper: 0.4, lip_lower: 0.5 }],
  [/\bthin lips\b/i, { mouth_fullness: -0.6, lip_upper: -0.4, lip_lower: -0.4 }],
  [/\b(?:wide|big) (?:mouth|smile|grin)\b/i, { mouth_width: 0.6 }],
  [/\bsmall mouth\b/i, { mouth_width: -0.5 }],
  [/\b(?:high|sharp|prominent) cheek ?bones\b/i, { cheekbones: 0.7, cheek_volume: -0.3 }],
  [/\b(?:hollow|gaunt|sunken) cheeks\b|\bgaunt\b/i, { cheek_volume: -0.7, head_fullness: -0.4 }],
  [/\b(?:chubby|full|round|puffy) cheeks\b/i, { cheek_volume: 0.7 }],
  [/\b(?:strong|prominent|cleft|big|jutting) chin\b/i, { chin_prominence: 0.6, chin_height: 0.3 }],
  [/\b(?:weak|small|receding) chin\b/i, { chin_prominence: -0.6 }],
  [/\b(?:high|big|large) forehead\b/i, { forehead: 0.6 }],
  [/\blow forehead\b/i, { forehead: -0.5 }],
]

export function sculptFromPrompt(prompt: string): Sculpt | undefined {
  const out: Record<string, number> = {}
  for (const [words, sculpt] of FACE_WORDS) {
    if (!words.test(prompt)) continue
    for (const [id, v] of Object.entries(sculpt)) out[id] = (out[id] ?? 0) + (v ?? 0)
  }
  return hydrateSculpt(out)
}
