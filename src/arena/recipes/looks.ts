import type { Primitive, RecipeLook } from './schema'

/**
 * Looks from words (R33): the offline director and any skill the live director left plain get a look from its theme.
 * The first matching entry wins, so the specific fantasies sit above the generic elements.
 */
const LOOKS: { words: RegExp; look: RecipeLook }[] = [
  { words: /spirit bomb|genki|kamehameha|ki ball|energy ball/i, look: { palette: ['#e8fbff', '#59c7ff', '#ffffff'], feature: ['gather', 'sky', 'burst', 'ring'], intensity: 1.8, charged: true } },
  { words: /nine[- ]?tails|kurama|fox|kitsune/i, look: { palette: ['#ffb347', '#ff5a1f', '#fff2c2'], feature: ['aura', 'form', 'sparks'], intensity: 1.5 } },
  { words: /titan|colossus|giant|kaiju/i, look: { palette: ['#d8c4a8', '#8a5a3c', '#ff9a5a'], feature: ['form', 'crack', 'burst'], intensity: 1.4 } },
  { words: /susanoo|avatar|spirit form|stand\b/i, look: { palette: ['#c9a6ff', '#6b3dff', '#ffffff'], feature: ['form', 'aura', 'sparks'], intensity: 1.5 } },
  { words: /fire|flame|blaze|inferno|ember|burn/i, look: { palette: ['#fff1a8', '#ff7a1a', '#c21f00'], feature: ['sparks', 'trail', 'burst'] } },
  { words: /ice|frost|freeze|cold|snow/i, look: { palette: ['#f0fbff', '#7fd6ff', '#2a7fff'], feature: ['crack', 'sparks'] } },
  { words: /lightning|thunder|electric|volt|spark|chidori/i, look: { palette: ['#ffffff', '#fff27a', '#5ab4ff'], feature: ['sparks', 'trail'], intensity: 1.3 } },
  { words: /shadow|dark|void|abyss|death/i, look: { palette: ['#d6b3ff', '#4b1d7a', '#120018'], feature: ['aura', 'trail'] } },
  { words: /holy|light|divine|angel|heal/i, look: { palette: ['#ffffff', '#ffe58a', '#ffd23d'], feature: ['ring', 'sparks'] } },
  { words: /earth|rock|stone|quake|ground/i, look: { palette: ['#e6d2b0', '#8a6a3c', '#4a3a2a'], feature: ['crack', 'burst'] } },
  { words: /water|wave|tide|ocean/i, look: { palette: ['#e8fbff', '#3ab0ff', '#0a4aa8'], feature: ['ring', 'trail'] } },
  { words: /wind|storm|tornado|cyclone|air/i, look: { palette: ['#ffffff', '#bfeee6', '#5ad6c0'], feature: ['ring', 'trail'] } },
  { words: /poison|venom|toxic|acid/i, look: { palette: ['#e8ffb0', '#7ad13a', '#2a5a10'], feature: ['sparks', 'crack'] } },
  { words: /money|cash|stonks|gold|coin/i, look: { palette: ['#fff6b0', '#ffd23d', '#2fae4f'], feature: ['sparks', 'burst'] } },
  { words: /gpu|cuda|chip|cyber|laser|tech|ai\b/i, look: { palette: ['#e8fff2', '#3dff8a', '#00b3ff'], feature: ['trail', 'sparks'], intensity: 1.2 } },
]

export function lookFor(text: string | undefined): RecipeLook | undefined {
  if (!text) return undefined
  return LOOKS.find((l) => l.words.test(text))?.look
}

export const LOOK_PRIMITIVES: readonly Primitive[] = ['gather', 'sky', 'burst', 'ring', 'aura', 'form', 'sparks', 'crack', 'trail']
