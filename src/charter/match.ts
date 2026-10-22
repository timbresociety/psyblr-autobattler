import { defaultTemplate, poolFor } from './templates/catalog'
import type { RoleId, SlotKind, Template } from './types'

/**
 * Offline matcher (KTD5): maps a player's skill description to a mechanic template by tag overlap.
 * Claude does the same job online; this gives the same output shape with no network, and in tests.
 */

const STOP_WORDS = new Set(
  'a an the of and or to in on at for with from by into onto his her their its them they he she it is are be that this who which then than so as up out over all any'.split(' '),
)

/** Fantasy wording to the catalogue's mechanic tags. */
const SYNONYMS: Record<string, string[]> = {
  rewind: ['return-to-past', 'rewind'],
  undo: ['return-to-past'],
  past: ['return-to-past'],
  seconds: ['time'],
  recall: ['return-to-past', 'recall'],
  chrono: ['time'],
  freeze: ['freeze', 'stun', 'ice'],
  frozen: ['freeze', 'ice'],
  invisible: ['stealth', 'invisible'],
  invisibility: ['stealth'],
  disappears: ['vanish'],
  slips: ['escape'],
  hide: ['stealth'],
  teleports: ['teleport', 'blink'],
  warp: ['teleport', 'blink'],
  drags: ['pull', 'drag'],
  pulls: ['pull'],
  yanks: ['pull'],
  hook: ['hook', 'grapple'],
  chain: ['chain', 'hook'],
  saiyan: ['saiyan', 'transform', 'super'],
  transforms: ['transform'],
  transformation: ['transform'],
  powers: ['power-up'],
  kamehameha: ['kamehameha', 'beam', 'wave'],
  laser: ['laser', 'beam'],
  lasers: ['laser', 'beam'],
  fire: ['fire'],
  flames: ['flame', 'fire'],
  burns: ['burn', 'fire'],
  burning: ['burn', 'fire'],
  lightning: ['lightning'],
  thunder: ['thunder', 'lightning'],
  electricity: ['electric', 'lightning'],
  heals: ['heal'],
  healing: ['heal'],
  cures: ['heal', 'cure'],
  shields: ['shield'],
  protects: ['protect', 'shield'],
  guards: ['guard', 'shield'],
  stuns: ['stun'],
  knocks: ['knockback'],
  pushes: ['push', 'knockback'],
  charges: ['charge', 'rush'],
  rushes: ['rush'],
  dashes: ['dash'],
  flies: ['flight', 'fly'],
  flying: ['flight', 'fly'],
  jumps: ['jump', 'leap'],
  leaps: ['leap'],
  punches: ['punch'],
  punch: ['punch'],
  kicks: ['kick'],
  sword: ['sword', 'blade'],
  slashes: ['slash'],
  shoots: ['shot', 'gun'],
  bullets: ['bullet', 'bullets'],
  rifle: ['rifle', 'gun'],
  arrows: ['arrow'],
  explodes: ['explosion'],
  bomb: ['bomb', 'explosion'],
  poisons: ['poison'],
  ground: ['ground', 'earth'],
  shake: ['quake', 'earthquake'],
  shakes: ['quake', 'earthquake'],
  speed: ['speed', 'haste'],
  faster: ['speed', 'haste'],
  angry: ['rage'],
  kills: ['execute', 'kill'],
  finish: ['finisher'],
  revive: ['revive'],
  resurrects: ['resurrect', 'revive'],
  stop: ['stop'],
  time: ['time'],
  gravity: ['gravity'],
  storm: ['storm'],
  meteors: ['meteor'],
}

/** Two-word phrases are joined, so "black hole" matches the `black-hole` tag. */
export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w))
  const pairs = words.slice(1).map((w, i) => `${words[i]}-${w}`)
  return [...words, ...pairs]
}

function wantedTags(description: string): Map<string, number> {
  const wanted = new Map<string, number>()
  const add = (tag: string, weight: number) => wanted.set(tag, Math.max(wanted.get(tag) ?? 0, weight))
  for (const token of tokenize(description)) {
    add(token, 2)
    for (const tag of SYNONYMS[token] ?? []) add(tag, 2)
    // crude stemming: "punches" -> "punch", "slams" -> "slam"
    const stem = token.replace(/(es|s|ing|ed)$/, '')
    if (stem.length >= 4 && stem !== token) add(stem, 1.5)
  }
  return wanted
}

function scoreAgainst(template: Template, wanted: Map<string, number>): number {
  let score = 0
  for (const tag of template.tags) {
    const weight = wanted.get(tag)
    if (weight) score += weight
    else if (tag.length >= 5) {
      for (const [word, w] of wanted) if (word.length >= 5 && (tag.startsWith(word) || word.startsWith(tag))) score += w * 0.5
    }
  }
  return score
}

export interface MatchResult {
  template: Template
  score: number
  /** True when nothing in the description matched and the role default was used. */
  fallback: boolean
}

/** Pick the template in this role's pool for this slot that best fits the description. */
export function matchTemplate(role: RoleId, slot: SlotKind, description: string, exclude: string[] = []): MatchResult {
  const pool = poolFor(role, slot).filter((t) => !exclude.includes(t.id))
  const wanted = wantedTags(description)
  let best: MatchResult | undefined
  for (const template of pool) {
    const score = scoreAgainst(template, wanted)
    // ties keep catalogue order, which lists the role's own templates first
    if (score > 0 && (!best || score > best.score)) best = { template, score, fallback: false }
  }
  if (best) return best
  const fallback = pool[0] ?? defaultTemplate(role, slot)
  return { template: fallback, score: 0, fallback: true }
}

/** The 2 to 3 swap options for a slot (R7): same role pool and slot, ranked by closeness to the pick and the words. */
export function nearestAlternatives(role: RoleId, slot: SlotKind, chosenId: string, description: string, exclude: string[] = []): Template[] {
  const pool = poolFor(role, slot).filter((t) => t.id !== chosenId && !exclude.includes(t.id))
  const chosen = poolFor(role, slot).find((t) => t.id === chosenId)
  const wanted = wantedTags(description)
  const chosenTags = new Set(chosen?.tags ?? [])
  return pool
    .map((template, index) => ({
      template,
      index,
      score: scoreAgainst(template, wanted) + template.tags.filter((tag) => chosenTags.has(tag)).length + (template.delivery.kind === chosen?.delivery.kind ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .map((entry) => entry.template)
}
