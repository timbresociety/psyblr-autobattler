import { BUILD_SLOTS, SLOT_KIND, TEXT_LIMITS, inferRole, proposeBuild, setSize, type Build } from '../charter/build.js'
import { BEARD_STYLES, HAIR_STYLES, LOOK_COLORS, PIECE_KINDS, ROLE_GENDER, defaultLook, type BeardStyle, type Gender, type HairStyle, type LookColor, type PieceKind } from '../charter/look.js'
import { matchTemplate } from '../charter/match.js'
import { ROLES, ROLE_IDS, getRole, isRoleId } from '../charter/roles.js'
import { SIZE_CLASSES, SIZES, type SizeClass } from '../charter/sizes.js'
import { CATALOG, poolFor } from '../charter/templates/catalog.js'
import type { BuildSlot, Effect, RoleId, Template } from '../charter/types.js'
import { BUILT_IN } from '../kit/pieces.js'
import { keywordFlags } from './keywords.js'
import { resolveGear } from '../kit/resolve.js'
import { coloursFromPrompt, genderFromPrompt, nameFromPrompt, partsFromPrompt, sizeFromPrompt, skillsFromPrompt } from './prompt.js'

/**
 * The Forge reads before it builds. A reading is what the Forge understood from a prompt and its reference images: the
 * hero's look in the body kit's own words, the gear it wears, a name and a "does" for each kit slot, a role, and the
 * questions it couldn't settle. The player checks it, answers, corrects, and only then builds. An AI reader (the
 * player's own Claude Code locally, Claude Haiku in production) or the offline parser here produces it; either way the
 * engine still owns every mechanic and number, so a reading only picks templates from the catalogue.
 */

export type ReadingSource = 'claude-code' | 'claude' | 'offline'

export interface ReadingSkill {
  /** The name the player sees: theirs whenever they gave one; empty lets the template's own name stand. */
  name: string
  /** What it does, in the player's words or the reader's reading of them. */
  does: string
  /** The catalogue template that carries it, from the role's pool. */
  template: string
}

export type QuestionTopic = BuildSlot | 'face' | 'size' | 'role'

export interface ReadingOption {
  label: string
  /** A kit question's answer can name the template it means. */
  template?: string
  /** A face, size or role question's answer: yes or no, a size class, a role. */
  value?: string
}

export interface ReadingQuestion {
  about: QuestionTopic
  ask: string
  /** Two to four one-tap answers, the reader's best guess first. */
  options: ReadingOption[]
}

export interface ReadingLook {
  gender: Gender
  size: SizeClass
  hair: HairStyle
  beard: BeardStyle
  armour: boolean
  cape: boolean
  colors: Partial<Record<LookColor, string>>
  /** Wear the face the Forge found on a reference image. */
  wearFace: boolean
}

/** Something the hero wears or holds, as the prompt or the image put it: "wide straw hat", a head piece. */
export interface GearWish {
  phrase: string
  kind: PieceKind
}

export interface Reading {
  heroName: string
  /** One sentence that shows the player the character was understood. */
  summary: string
  realPerson: boolean
  roleId: RoleId
  look: ReadingLook
  gear: GearWish[]
  kit: Record<BuildSlot, ReadingSkill>
  questions: ReadingQuestion[]
  source: ReadingSource
}

export interface ReadInput {
  prompt: string
  /** The name the player typed, which wins over any the prompt suggests. */
  heroName?: string
  /** True when the Forge found a face on one of the reference images. */
  faceFound?: boolean
  /** A correction to the last reading, such as "no hat, give him a red jacket". */
  note?: string
  previous?: Reading
}

export const MAX_QUESTIONS = 3
export const MAX_GEAR = 5
const MAX_SUMMARY = 240
const HEX = /^#[0-9a-f]{6}$/
const TOPICS: readonly QuestionTopic[] = [...BUILD_SLOTS, 'face', 'size', 'role']
const BY_ID = new Map(CATALOG.map((t) => [t.id, t]))

/** The two transformation ultimates, the only templates a "transformation" can be, and the roles that own them. */
export const TRANSFORMS: Partial<Record<RoleId, string>> = { fighter: 'fighter-super-form', tank: 'tank-titan-form' }

// ------------------------------------------------------------------------------------------------ the AI readers' contract

/** The structured output an AI reader answers in. Every field is required, so a reader can't skip one silently. */
export function readingSchema(): Record<string, unknown> {
  const str = { type: 'string' }
  const skill = (slot: BuildSlot) => ({
    type: 'object',
    additionalProperties: false,
    required: ['name', 'does', 'template'],
    properties: { name: str, does: str, template: { type: 'string', enum: CATALOG.filter((t) => t.slot === SLOT_KIND[slot]).map((t) => t.id) } },
  })
  return {
    type: 'object',
    additionalProperties: false,
    required: ['heroName', 'summary', 'realPerson', 'roleId', 'look', 'gear', 'kit', 'questions'],
    properties: {
      heroName: str,
      summary: str,
      realPerson: { type: 'boolean' },
      roleId: { type: 'string', enum: [...ROLE_IDS] },
      look: {
        type: 'object',
        additionalProperties: false,
        required: ['gender', 'size', 'hair', 'beard', 'armour', 'cape', 'colors', 'wearFace'],
        properties: {
          gender: { type: 'string', enum: ['m', 'f'] },
          size: { type: 'string', enum: [...SIZE_CLASSES] },
          hair: { type: 'string', enum: [...HAIR_STYLES] },
          beard: { type: 'string', enum: [...BEARD_STYLES] },
          armour: { type: 'boolean' },
          cape: { type: 'boolean' },
          colors: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['region', 'hex'], properties: { region: { type: 'string', enum: [...LOOK_COLORS] }, hex: str } },
          },
          wearFace: { type: 'boolean' },
        },
      },
      gear: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['phrase', 'kind'], properties: { phrase: str, kind: { type: 'string', enum: [...PIECE_KINDS] } } },
      },
      kit: { type: 'object', additionalProperties: false, required: [...BUILD_SLOTS], properties: Object.fromEntries(BUILD_SLOTS.map((s) => [s, skill(s)])) },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['about', 'ask', 'options'],
          properties: { about: { type: 'string', enum: [...TOPICS] }, ask: str, options: { type: 'array', items: str } },
        },
      },
    },
  }
}

let system: string | undefined

/** What an AI reader is told once per request, built on first use: only the server ever needs it. */
export function readingSystem(): string {
  if (system) return system
  const catalog = CATALOG.map((t) => `${t.id} | ${t.slot} | ${t.roles.join(',')} | ${t.name}: ${t.tags.join(', ')}`).join('\n')
  return (system = `You read how a player imagines a hero for psyblr autobattler, a 3D arena brawler, from their words and any reference images, and say back how you will build it. The player owns the look and the names. The engine owns every number, so you never invent stats or power.

How to read:
- The player's words win. Keep every name they give exactly as they wrote it, in title case. A skill they name without saying what it does may be slang or another language: translate it if you can, give your best reading of what it does, and ask.
- A reference image shows how the hero looks. Read the outfit and its colours, the hair, facial hair, what is on the head and face, what they hold, and what they carry on the back. When the player says the hero looks the way they appear somewhere (a cover, a film, a scene), the image is that appearance.
- Ask at most ${MAX_QUESTIONS} questions, only where the answer changes the hero and you can't tell. Each has two to four short options, your best guess first. Don't ask what the player already said.

The look, in the body kit's own words:
- gender: m or f, the body.
- size: tiny, small, medium, large or huge. Colossal is reached only by a transformation ultimate, never as a size.
- hair: none (bald), buzz, crop, short, curly, swept (slicked back), spiky, bob, long, volume (an afro or big hair) or helmet. A hat piece sits over the hair.
- beard: none, goatee, full or chin_curtain.
- armour: true for plate armour or a mech suit. cape: true for a cape or cloak.
- colors: a '#rrggbb' for each region you can see or the player asks for: skin, suit (the jacket, robe, top or dress), trim (accents, belts, sashes, scarves), pants, glove, boot, hair, iris, brow, cape, metal (armour and metal parts). Leave out what you can't tell.
- wearFace: true when an image is a photo of a real face the hero should wear; false for an illustration, a mask, or when the player wants a stylised hero.
- gear: rigid pieces the hero wears or holds, each a phrase of one to four words with its kind: head (hats, helmets, crowns), face (glasses, masks, visors), hand (a weapon, a microphone, a staff), offhand (a shield or a bow) or back (wings, a jetpack, swords or a sheath on the back). At most ${MAX_GEAR}, such as "wide straw hat" or "katana".

The kit has six slots: basic (the basic attack, left click), active1 (Q), active2 (E), passive, ultimate (R) and movement (Shift). For each slot give:
- name: the player's, or two or three evocative words that fit the hero. Never a number.
- does: one short sentence of what it does, in the player's terms.
- template: the catalogue entry for that slot, from the chosen role's pool, whose mechanic best carries what it does. active1 and active2 are different templates.
A transformation ultimate exists only for a fighter (fighter-super-form: grows large and hits harder) or a tank (tank-titan-form: grows colossal and much tougher), so a hero whose ultimate is a transformation is one of those two roles.

Roles:
${ROLES.map((r) => `- ${r.id}: ${r.description}`).join('\n')}

realPerson: true when the hero is a real person. Describe real people with respect: nothing sexual, never a minor, never shown endorsing the game.
summary: one sentence that shows the player you understood the character, naming the look you will build.

Catalogue (id | slot | roles | name: tags):
${catalog}`)
}

/** What an AI reader is told about this request, beside the images. */
export function readingRequest(input: ReadInput): string {
  const lines = [`Prompt: ${input.prompt}`]
  if (input.heroName?.trim()) lines.push(`The player named the hero: ${input.heroName.trim()}`)
  lines.push(input.faceFound ? 'The Forge found a face on the reference image that the hero could wear.' : 'The Forge found no face it could put on the hero.')
  if (input.previous && input.note) {
    lines.push(`Your last reading: ${JSON.stringify(strip(input.previous))}`)
    lines.push(`The player's correction: ${input.note}`)
    lines.push('Read again. Change what the correction asks for and keep the rest.')
  }
  return lines.join('\n')
}

/** A reading as an AI reader answered it: the answer's own shape, without the source the server adds. */
function strip(reading: Reading) {
  const { source: _source, ...rest } = reading
  return { ...rest, look: { ...rest.look, colors: Object.entries(rest.look.colors).map(([region, hex]) => ({ region, hex })) }, questions: rest.questions.map((q) => ({ ...q, options: q.options.map((o) => o.label) })) }
}

// ------------------------------------------------------------------------------------------------ untrusted answers

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
/** A skill name is text players see: no number in it can read as a stat. */
const skillName = (v: unknown) => text(v, TEXT_LIMITS.name * 2).replace(/\d+/g, '').replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMITS.name)
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => ((list as readonly string[]).includes(v as string) ? (v as T) : fallback)

/** The template a slot can use: the one asked for when the role's pool has it, else the best match for what it does. */
function slotTemplate(roleId: RoleId, slot: BuildSlot, wanted: string | undefined, words: string, exclude: string[] = []): string {
  const pool = poolFor(roleId, SLOT_KIND[slot])
  if (wanted && pool.some((t) => t.id === wanted) && !exclude.includes(wanted)) return wanted
  return matchTemplate(roleId, SLOT_KIND[slot], words, exclude).template.id
}

/** The kit with every template from the role's pool and the two actives different. */
function settleKit(roleId: RoleId, kit: Record<BuildSlot, ReadingSkill>): Record<BuildSlot, ReadingSkill> {
  const out = {} as Record<BuildSlot, ReadingSkill>
  for (const slot of BUILD_SLOTS) {
    const skill = kit[slot]
    const exclude = slot === 'active2' ? [out.active1.template] : []
    out[slot] = { ...skill, template: slotTemplate(roleId, slot, skill.template, `${skill.name} ${skill.does}`, exclude) }
  }
  return out
}

/** A face, size or role question's answers carry the value they mean, read from their words. */
function optionValue(about: QuestionTopic, label: string): string | undefined {
  if (about === 'face') return /\b(no|not|don't|dont|keep|without|skip)\b/i.test(label) ? 'no' : 'yes'
  if (about === 'size') return SIZE_CLASSES.find((s) => new RegExp(`\\b${s}\\b`, 'i').test(label))
  if (about === 'role') return ROLE_IDS.find((r) => new RegExp(`\\b${r}\\b`, 'i').test(label)) ?? ROLES.find((r) => label.toLowerCase().includes(r.name.toLowerCase()))?.id
  return undefined
}

function readQuestions(raw: unknown): ReadingQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: ReadingQuestion[] = []
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue
    const value = q as Record<string, unknown>
    const about = TOPICS.find((t) => t === value.about)
    const ask = text(value.ask, 160)
    const options = (Array.isArray(value.options) ? value.options : [])
      .map((o) => text(typeof o === 'string' ? o : (o as { label?: unknown })?.label, 80))
      .filter(Boolean)
      .slice(0, 4)
      .map((label) => ({ label, ...(about && optionValue(about, label) ? { value: optionValue(about, label) } : {}) }))
    if (!about || !ask || options.length < 2 || out.some((o) => o.about === about)) continue
    out.push({ about, ask, options })
    if (out.length === MAX_QUESTIONS) break
  }
  return out
}

/**
 * Rebuild a reading from an AI reader's answer, keeping only what the vocabulary allows: names trimmed, colours checked,
 * templates from the role's pool. Anything missing comes from the offline reading of the same request.
 */
export function hydrateReading(raw: unknown, input: ReadInput, source: ReadingSource): Reading {
  const fallback = offlineReading(input)
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const roleId = isRoleId(value.roleId) ? value.roleId : fallback.roleId
  const lookIn = (value.look && typeof value.look === 'object' ? value.look : {}) as Record<string, unknown>
  const colors: Partial<Record<LookColor, string>> = {}
  // an AI reader lists colours; a reading sent back from the Forge keeps them by region
  const pairs = Array.isArray(lookIn.colors) ? lookIn.colors : Object.entries(lookIn.colors && typeof lookIn.colors === 'object' ? lookIn.colors : {}).map(([region, hex]) => ({ region, hex }))
  for (const c of pairs) {
    const region = LOOK_COLORS.find((r) => r === (c as { region?: unknown })?.region)
    const hex = text((c as { hex?: unknown })?.hex, 7).toLowerCase()
    if (region && HEX.test(hex)) colors[region] ??= hex
  }
  const look: ReadingLook = {
    gender: oneOf(lookIn.gender, ['m', 'f'] as const, fallback.look.gender),
    size: oneOf(lookIn.size, SIZE_CLASSES, fallback.look.size),
    hair: oneOf(lookIn.hair, HAIR_STYLES, fallback.look.hair),
    beard: oneOf(lookIn.beard, BEARD_STYLES, fallback.look.beard),
    armour: typeof lookIn.armour === 'boolean' ? lookIn.armour : fallback.look.armour,
    cape: typeof lookIn.cape === 'boolean' ? lookIn.cape : fallback.look.cape,
    colors,
    wearFace: !!input.faceFound && lookIn.wearFace !== false,
  }
  const gear: GearWish[] = []
  for (const g of Array.isArray(value.gear) ? value.gear : []) {
    const phrase = text((g as { phrase?: unknown })?.phrase, 40).toLowerCase()
    const kind = PIECE_KINDS.find((k) => k === (g as { kind?: unknown })?.kind)
    if (phrase && kind && !gear.some((w) => w.phrase === phrase)) gear.push({ phrase, kind })
  }
  const kitIn = (value.kit && typeof value.kit === 'object' ? value.kit : {}) as Record<string, Record<string, unknown> | undefined>
  const kit = {} as Record<BuildSlot, ReadingSkill>
  // on a first reading a name the player gave stays theirs, whatever the reader answered; a correction may rename
  const own = input.note ? {} : namedSkills(input.prompt)
  for (const slot of BUILD_SLOTS) {
    const s = kitIn[slot] ?? {}
    kit[slot] = { name: own[slot]?.name || skillName(s.name), does: text(s.does, TEXT_LIMITS.flavour) || own[slot]?.does || '', template: text(s.template, 64) }
  }
  return {
    heroName: input.heroName?.trim().slice(0, TEXT_LIMITS.heroName) || text(value.heroName, TEXT_LIMITS.heroName) || fallback.heroName,
    summary: text(value.summary, MAX_SUMMARY) || fallback.summary,
    realPerson: value.realPerson === true,
    roleId,
    look,
    gear: gear.slice(0, MAX_GEAR),
    kit: settleKit(roleId, kit),
    questions: readQuestions(value.questions).filter((q) => q.about !== 'face' || input.faceFound),
    source,
  }
}

// ------------------------------------------------------------------------------------------------ the offline reader

const titleCase = (s: string) => (s === s.toLowerCase() || s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase()) : s)

/** Words that say which kit slot a name belongs to. Q, E and R count only as capitals: "e" and "r" are too common. */
const MARKERS: [BuildSlot | 'skill', RegExp][] = [
  ['active1', /\b(?:skill|ability|power|move|active|spell)\s*(?:no\.?\s*|#\s*)?(?:1|one)\b|\bfirst\s+(?:skill|ability|power|move|spell)\b|\bQ\b/i],
  ['active2', /\b(?:skill|ability|power|move|active|spell)\s*(?:no\.?\s*|#\s*)?(?:2|two)\b|\bsecond\s+(?:skill|ability|power|move|spell)\b|\bE\b/i],
  ['ultimate', /\bult(?:imate|i)?\b|\bR\b/i],
  ['passive', /\bpassive\b/i],
  ['basic', /\b(?:basic|normal|auto|primary)(?:\s+attack)?\b|\bLMB\b/i],
  ['movement', /\b(?:movement|mobility|dash|shift)\b/i],
  ['skill', /\b(?:skill|ability|power|move|spell)s?\b/i],
]
// Q, E and R are markers only in capitals, so their regexes above are case-insensitive for the words and checked again here
const CAPITAL_ONLY = /^[QER]$/i

const FILLER = /\b(?:is|are|was|will be|be|a|an|the|its|his|her|their|called|named|which|that|and|as|it|like|should|would|could)\b|[:=–—-]/gi

/** Mechanic words in what a player says a skill is, and the sentence a reading gives them. */
const HINTS: [RegExp, string][] = [
  [/\btransform\w*|\bpower[- ]?up\b|\bawaken\w*|\bsuper form\b|\bevolv\w*|\bascen\w*|\bgoes? (?:giant|super)\b/i, 'Transforms into a bigger, stronger form for a while'],
  [/\bteleport\w*|\bblink\w*|\bwarp\w*/i, 'Teleports a short way across the field'],
  [/\bdash\w*|\bleap\w*|\bjump\w*|\bcharge\w*|\brush\w*/i, 'Dashes across the field'],
  [/\bheal\w*|\bcure\w*|\bmend\w*|\brestor\w*/i, 'Heals allies'],
  [/\bshield\w*|\bbarrier\w*|\bguard\w*|\bprotect\w*/i, 'Shields allies from damage'],
  [/\bstun\w*|\bfreez\w*|\bparaly\w*|\bpetrif\w*/i, 'Stuns an enemy'],
  [/\bsummon\w*|\bturret\w*|\bminion\w*|\bspawn\w*|\bclone\w*/i, 'Summons help onto the field'],
  [/\bpull\w*|\bhook\w*|\bgrab\w*|\byank\w*/i, 'Pulls an enemy in'],
  [/\btaunt\w*|\broar\w*|\bprovok\w*/i, 'Taunts nearby enemies'],
  [/\binvisib\w*|\bstealth\w*|\bvanish\w*|\bcloak\w*/i, 'Turns invisible'],
  [/\bexplo\w*|\bnuke\w*|\bmeteor\w*|\bstorm\w*|\bquake\w*|\baoe\b/i, 'Blasts an area'],
  [/\bbeam\w*|\blaser\w*|\bblast\w*|\bshot\w*|\bshoot\w*|\bfireball\w*|\bbolt\w*/i, 'Fires a blast at an enemy'],
  [/\bslash\w*|\bstrike\w*|\bpunch\w*|\bcombo\w*|\bflurry\w*|\bbarrage\w*|\bkick\w*/i, 'Hits with a flurry of strikes'],
]
const hintFor = (words: string) => HINTS.find(([re]) => re.test(words))?.[1]
export const isTransform = (words: string) => HINTS[0][0].test(words)

interface Named {
  name: string
  does: string
}

/** The first marker in a stretch of text, with where it ends. */
function firstMarker(context: string): { slot: BuildSlot | 'skill'; end: number } | undefined {
  let best: { slot: BuildSlot | 'skill'; at: number; end: number } | undefined
  for (const [slot, re] of MARKERS) {
    for (const m of context.matchAll(new RegExp(re.source, 'gi'))) {
      if (CAPITAL_ONLY.test(m[0]) && m[0] !== m[0].toUpperCase()) continue
      if (!best || m.index < best.at || (m.index === best.at && slot !== 'skill')) best = { slot, at: m.index, end: m.index + m[0].length }
      break
    }
  }
  return best && { slot: best.slot, end: best.end }
}

/**
 * The skills a prompt names, by slot: `Skill 1 "encore kha ja"`, `ultimate is a transformation "kendrick se bhi upar"`,
 * `Q "Moon Slash"`. A quoted name takes the first slot word before it in its sentence, and the words between become what
 * it does. A quote with no slot word near it is a nickname, as in Jeff "Prime" Bezos, unless the sentence is about skills.
 */
export function namedSkills(prompt: string): Partial<Record<BuildSlot, Named>> {
  const out: Partial<Record<BuildSlot, Named>> = {}
  const generic: Named[] = []
  let from = 0
  for (const m of prompt.matchAll(/["“”]([^"“”]{1,60})["“”]/g)) {
    const before = prompt.slice(from, m.index)
    from = m.index + m[0].length
    // the stretch that can describe this name: back to the last sentence break before it
    const context = before.slice(Math.max(0, before.search(/[.!?;](?=[^.!?;]*$)/) + 1))
    const marker = firstMarker(context)
    if (!marker) continue
    const between = context.slice(marker.end).replace(FILLER, ' ').replace(/\s+/g, ' ').trim()
    const named = { name: titleCase(m[1].trim()).slice(0, TEXT_LIMITS.name), does: between ? (hintFor(between) ?? between.charAt(0).toUpperCase() + between.slice(1)) : '' }
    if (marker.slot === 'skill') generic.push(named)
    else out[marker.slot] ??= named
  }
  for (const named of generic) {
    const slot = (['active1', 'active2', 'ultimate'] as const).find((s) => !out[s])
    if (slot) out[slot] = named
  }
  return out
}

const VERB: Partial<Record<Effect['kind'], string>> = {
  damage: 'hits', heal: 'heals', shield: 'shields', stun: 'stuns', slow: 'slows', displace: 'knocks back', mobility: 'moves', buff: 'powers up',
  execute: 'finishes the wounded', resize: 'changes size', control: 'locks down', knockup: 'knocks up', pull: 'pulls in', debuff: 'weakens',
  state: 'protects', refresh: 'resets cooldowns', field: 'leaves a zone', wall: 'raises a wall', trap: 'sets a trap', turret: 'builds a turret',
}
const WHERE: Partial<Record<Template['delivery']['kind'], string>> = { melee: 'up close', projectile: 'at range', beam: 'with a beam', cone: 'in a cone', zone: 'in an area', aura: 'around it', dash: 'on the move', blink: 'on the move', leap: 'on the move', grapple: 'on the move' }

/** A template in a few plain words: "Chain Hook: pulls in, stuns, hits at range". */
export function templateBlurb(template: Template): string {
  const verbs = [...new Set(template.effects.map((e) => VERB[e.kind]).filter(Boolean))].slice(0, 3)
  const where = WHERE[template.delivery.kind]
  return `${template.name}: ${verbs.join(', ')}${where ? ` ${where}` : ''}`
}

/** Answers to "what should this skill do?": the current match first, then the pool's most different mechanics. */
function skillOptions(roleId: RoleId, slot: BuildSlot, current: string, exclude: string[]): ReadingOption[] {
  const pool = poolFor(roleId, SLOT_KIND[slot]).filter((t) => !exclude.includes(t.id))
  const first = BY_ID.get(current)
  const picks: Template[] = first ? [first] : []
  const kindOf = (t: Template) => t.effects[0]?.kind
  for (const t of pool) {
    if (picks.length === 3) break
    if (picks.some((p) => p.id === t.id || kindOf(p) === kindOf(t))) continue
    picks.push(t)
  }
  for (const t of pool) if (picks.length < 3 && !picks.some((p) => p.id === t.id)) picks.push(t)
  return picks.map((t) => ({ label: templateBlurb(t), template: t.id }))
}

/** A gear phrase for a built-in piece that matched: the tag the prompt used reads better than its id. */
function gearWishes(text: string): GearWish[] {
  const found = resolveGear(text, BUILT_IN)
  const lower = text.toLowerCase()
  const matched = Object.values(found.gear).map((entry) => ({ phrase: entry!.tags.find((t) => lower.includes(t.toLowerCase())) ?? entry!.name.toLowerCase(), kind: entry!.kind }))
  const out: GearWish[] = []
  for (const w of [...matched, ...found.gaps]) if (!out.some((o) => o.phrase === w.phrase)) out.push(w)
  return out.slice(0, MAX_GEAR)
}

const TANK_WORDS = /\b(giant|colossal|titan|tank|tough|armou?r(?:ed)?|wall|unkillable|immovable|fortress)\b/i

function summaryOf(reading: Omit<Reading, 'summary'>): string {
  const role = getRole(reading.roleId).name.toLowerCase()
  const size = reading.look.size === 'medium' ? '' : `${SIZES[reading.look.size].label.toLowerCase()} `
  const named = BUILD_SLOTS.filter((s) => reading.kit[s].name)
  const skills = named.map((s) => (s === 'ultimate' && isTransform(reading.kit[s].does) ? `the transformation ${reading.kit[s].name}` : reading.kit[s].name))
  const list = skills.length > 1 ? `${skills.slice(0, -1).join(', ')} and ${skills.at(-1)}` : skills[0]
  const gear = reading.gear.length ? `, with ${reading.gear.map((g) => g.phrase).join(' and ')}` : ''
  return `${reading.heroName}, a ${size}${role}${gear}${list ? `. Skills: ${list}` : ''}.`
}

/**
 * The offline reading: the prompt's names, size, colours, hair and gear words, the skills it names by slot, and a role
 * that suits them. It asks what any skill named without a description does, and whether to wear a face it found.
 */
export function offlineReading(input: ReadInput): Reading {
  if (input.previous && input.note) return correctOffline(input.previous, input.note, input)
  const prompt = input.prompt
  const heroName = input.heroName?.trim().slice(0, TEXT_LIMITS.heroName) || nameFromPrompt(prompt)
  const named = namedSkills(prompt)
  // a prompt that names no skills by slot can still list themes ("skills around X, Y and Z") or a hero the culture table knows
  const skills: Partial<Record<BuildSlot, Named>> = Object.keys(named).length ? named : Object.fromEntries(Object.entries(skillsFromPrompt(prompt)).map(([s, t]) => [s, { name: t!.name, does: '' }]))
  const transform = !!skills.ultimate && isTransform(`${skills.ultimate.does}`)
  const asked = Object.fromEntries(Object.entries(skills).map(([s, k]) => [s, { name: k!.name, flavour: k!.does }]))
  // a transformation belongs to a fighter, or to a tank when the prompt's own words are a tank's ("a giant who transforms")
  const roleId = transform ? (TANK_WORDS.test(prompt) ? 'tank' : 'fighter') : inferRole(heroName, asked)
  const base = defaultLook(roleId, heroName, 0)
  const parts = partsFromPrompt(prompt)
  const look: ReadingLook = {
    gender: genderFromPrompt(prompt) ?? ROLE_GENDER[roleId] ?? 'm',
    size: sizeFromPrompt(prompt) ?? 'medium',
    hair: parts.hair ?? base.hair,
    beard: parts.beard ?? 'none',
    armour: parts.armour ?? base.armour,
    cape: parts.cape ?? base.cape,
    colors: coloursFromPrompt(prompt),
    wearFace: !!input.faceFound,
  }
  const kit = {} as Record<BuildSlot, ReadingSkill>
  for (const slot of BUILD_SLOTS) {
    const skill = skills[slot]
    const template = slot === 'ultimate' && transform ? TRANSFORMS[roleId] : undefined
    kit[slot] = { name: skill?.name ?? '', does: skill?.does ?? '', template: template ?? '' }
  }
  const settled = settleKit(roleId, kit)
  const reading = { heroName, realPerson: false, roleId, look, gear: gearWishes(prompt), kit: settled, questions: [] as ReadingQuestion[], source: 'offline' as const }
  return { ...reading, summary: summaryOf(reading), questions: offlineQuestions(reading, !!input.faceFound, transform) }
}

/** What the offline reader can't settle: skills named without a description, a face it found, which transformation. */
function offlineQuestions(reading: Omit<Reading, 'summary' | 'questions'>, faceFound: boolean, transform: boolean): ReadingQuestion[] {
  const out: ReadingQuestion[] = []
  for (const slot of BUILD_SLOTS) {
    const skill = reading.kit[slot]
    if (!skill.name || skill.does) continue
    out.push({ about: slot, ask: `What should ${skill.name} do?`, options: skillOptions(reading.roleId, slot, skill.template, slot === 'active2' ? [reading.kit.active1.template] : slot === 'active1' ? [reading.kit.active2.template] : []) })
  }
  if (faceFound) out.push({ about: 'face', ask: 'Wear the face from your image?', options: [{ label: 'Yes, wear it', value: 'yes' }, { label: "No, keep the body's own face", value: 'no' }] })
  if (transform) {
    const options = (['fighter', 'tank'] as const).map((r) => ({ label: `${templateBlurb(BY_ID.get(TRANSFORMS[r]!)!)} (${getRole(r).name.toLowerCase()})`, value: r }))
    if (reading.roleId === 'tank') options.reverse()
    out.push({ about: 'role', ask: `Which transformation is ${reading.kit.ultimate.name || 'the ultimate'}?`, options })
  }
  return out.slice(0, MAX_QUESTIONS)
}

/** An offline correction on top of the last reading: what the note says about the look, the gear and the skills. */
function correctOffline(previous: Reading, note: string, input: ReadInput): Reading {
  const parts = partsFromPrompt(note)
  const size = sizeFromPrompt(note)
  const look: ReadingLook = {
    ...previous.look,
    gender: genderFromPrompt(note) ?? previous.look.gender,
    ...(size ? { size } : {}),
    ...(parts.hair ? { hair: parts.hair } : {}),
    ...(parts.beard ? { beard: parts.beard } : {}),
    ...(parts.armour !== undefined ? { armour: parts.armour } : {}),
    ...(parts.cape !== undefined ? { cape: parts.cape } : {}),
    colors: { ...previous.look.colors, ...coloursFromPrompt(note) },
  }
  if (/\b(no|without|lose|drop)\s+(?:the\s+)?face\b/i.test(note)) look.wearFace = false
  // "no hat" or "without the sword" takes a piece off; new gear words put one on
  const dropped = [...note.toLowerCase().matchAll(/\b(?:no|without|remove|lose|drop)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+)?([a-z]+(?:\s[a-z]+)?)/g)].map((m) => m[1])
  const gear = previous.gear.filter((g) => !dropped.some((d) => g.phrase.includes(d) || d.split(' ').some((w) => w.length > 2 && g.phrase.split(' ').includes(w))))
  for (const w of gearWishes(note.replace(/\b(?:no|without|remove|lose|drop)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+)?[a-z]+(?:\s[a-z]+)?/gi, ''))) if (!gear.some((g) => g.phrase === w.phrase)) gear.push(w)
  const named = namedSkills(note)
  const kit = { ...previous.kit }
  for (const [slot, skill] of Object.entries(named) as [BuildSlot, Named][]) kit[slot] = { name: skill.name, does: skill.does || kit[slot].does, template: '' }
  const roleId = ROLE_IDS.find((r) => new RegExp(`\\b(?:a|as|make (?:him|her|it)(?: a)?)\\s+${r}\\b`, 'i').test(note)) ?? previous.roleId
  const reading = { ...previous, heroName: input.heroName?.trim() || previous.heroName, roleId, look, gear: gear.slice(0, MAX_GEAR), kit: settleKit(roleId, roleId === previous.roleId ? kit : Object.fromEntries(BUILD_SLOTS.map((s) => [s, { ...kit[s], template: '' }])) as Record<BuildSlot, ReadingSkill>), source: 'offline' as const }
  const transform = isTransform(reading.kit.ultimate.does)
  return { ...reading, summary: summaryOf(reading), questions: offlineQuestions(reading, !!input.faceFound && reading.look.wearFace, transform && !TRANSFORMS[roleId]) }
}

// ------------------------------------------------------------------------------------------------ the content floor

/** The content floor on a reading's words: nothing about children, and no real person sexualised or endorsing the game. */
export function floorBreach(text: string, realPerson: boolean): string | undefined {
  const flags = keywordFlags(text, realPerson)
  if (flags.minors) return "Heroes can't involve children."
  if (flags.realPerson && flags.sexual) return 'Real people stay out of anything sexual.'
  if (flags.realPerson && flags.endorsement) return "Real people can't be shown endorsing the game."
  return undefined
}

/** Every word a reading puts on a hero, for the floor. */
export const readingText = (r: Reading) => [r.heroName, r.summary, ...r.gear.map((g) => g.phrase), ...BUILD_SLOTS.flatMap((s) => [r.kit[s].name, r.kit[s].does])].join('\n')

// ------------------------------------------------------------------------------------------------ answering and building

/** A tapped answer applied to the reading; the question goes away. */
export function answerQuestion(reading: Reading, index: number, option: ReadingOption): Reading {
  const q = reading.questions[index]
  if (!q) return reading
  const questions = reading.questions.filter((_, i) => i !== index)
  if (q.about === 'face') return { ...reading, questions, look: { ...reading.look, wearFace: option.value !== 'no' } }
  if (q.about === 'size') return option.value && (SIZE_CLASSES as readonly string[]).includes(option.value) ? { ...reading, questions, look: { ...reading.look, size: option.value as SizeClass } } : { ...reading, questions }
  if (q.about === 'role') return isRoleId(option.value) ? withRole({ ...reading, questions }, option.value) : { ...reading, questions }
  const slot = q.about
  // a kit answer is what the skill does: the template it names, or the words matched to one
  const does = option.template ? option.label.replace(/^[^:]+:\s*/, '').replace(/^\w/, (c) => c.toUpperCase()) : option.label
  const kit = { ...reading.kit, [slot]: { ...reading.kit[slot], does, template: option.template ?? '' } }
  return { ...reading, questions, kit: settleKit(reading.roleId, kit) }
}

/** The reading for another role: its skills keep their names and what they do, matched again from the new pool. */
export function withRole(reading: Reading, roleId: RoleId): Reading {
  if (roleId === reading.roleId) return reading
  const kit = Object.fromEntries(BUILD_SLOTS.map((s) => [s, { ...reading.kit[s], template: s === 'ultimate' && isTransform(reading.kit[s].does) ? (TRANSFORMS[roleId] ?? '') : '' }])) as Record<BuildSlot, ReadingSkill>
  return { ...reading, roleId, kit: settleKit(roleId, kit) }
}

/** Edit one slot's name or description; what it does picks its template again. */
export function editReadingSkill(reading: Reading, slot: BuildSlot, patch: Partial<Pick<ReadingSkill, 'name' | 'does'>>): Reading {
  const skill = { ...reading.kit[slot], ...patch }
  const kit = { ...reading.kit, [slot]: patch.does !== undefined ? { ...skill, template: slot === 'ultimate' && isTransform(skill.does) ? (TRANSFORMS[reading.roleId] ?? '') : '' } : skill }
  return { ...reading, kit: settleKit(reading.roleId, kit) }
}

/** The hero a reading describes: its role, its named skills on the templates it chose, and its size. The look is the UI's. */
export function buildFromReading(reading: Reading): Build {
  const skills = Object.fromEntries(BUILD_SLOTS.map((s) => [s, { name: reading.kit[s].name, flavour: reading.kit[s].does }]))
  const base = proposeBuild({ heroName: reading.heroName, description: reading.summary, roleId: reading.roleId, skills }).build
  const slots = { ...base.slots }
  for (const slot of BUILD_SLOTS) {
    const id = reading.kit[slot].template
    const inPool = poolFor(base.roleId, SLOT_KIND[slot]).some((t) => t.id === id)
    const clash = slot === 'active2' && id === slots.active1.templateId
    if (inPool && !clash) slots[slot] = { ...slots[slot], templateId: id }
  }
  const build: Build = { ...base, slots }
  const sized = reading.look.size === (build.sizeClass ?? 'medium') ? undefined : setSize(build, reading.look.size)
  return sized?.ok ? sized.build : build
}
