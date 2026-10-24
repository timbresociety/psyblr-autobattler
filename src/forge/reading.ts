import { BUILD_SLOTS, SLOT_KIND, TEXT_LIMITS, inferRole, proposeBuild, setSize, type Build } from '../charter/build.js'
import { LOOK_SLOTS, ROLE_GENDER, type Gender } from '../charter/look.js'
import { matchTemplate } from '../charter/match.js'
import { ROLES, ROLE_IDS, getRole, isRoleId } from '../charter/roles.js'
import {
  CAST_POSES,
  CHARGES,
  ELEMENTS,
  FAMILY_OF,
  FORMS,
  FORM_AURAS,
  FORM_AVATARS,
  FORM_ENTRIES,
  FORM_GROWTHS,
  FORM_MARKS,
  FORM_TRAILS,
  IMPACTS,
  MOTIFS,
  TRAILS,
  formsFor,
  hydrateSkillLook,
  hydrateTransformation,
  type SkillLook,
  type TransformationLook,
} from '../charter/skill-look.js'
import { SIZE_CLASSES, SIZES, type SizeClass } from '../charter/sizes.js'
import { CATALOG, poolFor } from '../charter/templates/catalog.js'
import type { BuildSlot, Effect, RoleId, Template } from '../charter/types.js'
import { NEUTRAL_PHYSIQUE, type Physique } from '../kit/body/shape.js'
import { FINISHES, KNOBS, RUNGS } from '../kit/wear/item.js'
import { LIBRARY } from '../kit/wear/library.js'
import { BUILT_IN_ITEMS } from '../kit/wear/library.gen.js'
import { PRINTS } from '../kit/wear/prints.js'
import { FORM_TEMPLATES, formChange, formFromWords, transformOf } from './form.js'
import { keywordFlags } from './keywords.js'
import { coloursFromPrompt, genderFromPrompt, nameFromPrompt, sizeFromPrompt, skillsFromPrompt } from './prompt.js'
import { correctWear, physiqueFromPrompt, readWear, wearAnswer, wearFromPrompt, type WearWish } from './wardrobe-read.js'

/**
 * The Forge reads before it builds. A reading is what the Forge understood from a prompt and its reference images: the
 * hero's body, what it wears slot by slot in the library's words, a name, a "does" and a look for each kit slot, how
 * its transformation looks, a role, and the questions it couldn't settle. The player checks it, answers, corrects, and
 * only then builds. An AI reader (the player's own Claude Code locally, Claude Haiku in production) or the offline
 * parser here produces it; either way the engine still owns every mechanic and number, so a reading only picks
 * templates from the catalogue and items from the library.
 */

export type ReadingSource = 'claude-code' | 'claude' | 'offline'

export interface ReadingSkill {
  /** The name the player sees: theirs whenever they gave one; empty lets the template's own name stand. */
  name: string
  /** What it does, in the player's words or the reader's reading of them. */
  does: string
  /** The catalogue template that carries it, from the role's pool. */
  template: string
  /** How it looks, when the reader said. Without one its words give it a look, as they do for any skill. */
  look?: SkillLook
}

export type QuestionTopic = BuildSlot | 'face' | 'size' | 'role' | 'form'

export interface ReadingOption {
  label: string
  /** A kit or form question's answer can name the template it means. */
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

/** The colours a reading gives the body. What the hero wears takes its colours on its own channels. */
export const BODY_COLORS = ['skin', 'hair', 'iris', 'brow'] as const
export type BodyColor = (typeof BODY_COLORS)[number]

export interface ReadingLook {
  gender: Gender
  size: SizeClass
  /** Weight, muscle and age; the body as made when absent. */
  physique?: Physique
  /** Hair colours the beard too. */
  colors: Partial<Record<BodyColor, string>>
  /** Wear the face the Forge found on a reference image. */
  wearFace: boolean
  /** How much of the photo's shape the face takes, 0 to 1; all of it when absent. */
  faceStrength?: number
}

export interface Reading {
  heroName: string
  /** One sentence that shows the player the character was understood. */
  summary: string
  realPerson: boolean
  roleId: RoleId
  look: ReadingLook
  /** What the hero wears, a wish a slot; a slot without one is dressed by the role. */
  wear: WearWish[]
  kit: Record<BuildSlot, ReadingSkill>
  /** How the ultimate's transformation looks, when it is one. The size it takes is its template's. */
  form?: TransformationLook
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
const MAX_SUMMARY = 240
const HEX = /^#[0-9a-f]{6}$/
const TOPICS: readonly QuestionTopic[] = [...BUILD_SLOTS, 'face', 'size', 'role', 'form']
const BY_ID = new Map(CATALOG.map((t) => [t.id, t]))
const ALL_FORMS = [...new Set(Object.values(FORMS).flat())]
// what a form can change the body to: a built-in hair item, and built-in surface items over the outfit
const HAIR_IDS = BUILT_IN_ITEMS.filter((i) => i.slot === 'hair').map((i) => i.id)
const FORM_WEAR_IDS = BUILT_IN_ITEMS.filter((i) => ['head', 'upper', 'lower', 'full', 'back', 'feet'].includes(i.slot)).map((i) => i.id)

/**
 * The transformation each role takes when the words don't say which. A transformation's template sets the size it
 * takes: Super Form grows large, Titan Form colossal, Avatar Form huge, Ascended Form keeps the hero's size, Shrink Form
 * shrinks it to tiny. Support, controller and summoner have none.
 */
export const TRANSFORMS: Partial<Record<RoleId, string>> = {
  fighter: 'fighter-super-form',
  tank: 'tank-titan-form',
  assassin: 'assassin-shrink-form',
  mage: 'fighter-ascended-form',
  marksman: 'fighter-ascended-form',
}

const transforms = (id: string) => {
  const t = BY_ID.get(id)
  return !!t && !!transformOf(t)
}
const holds = (roleId: RoleId, id: string) => poolFor(roleId, 'ultimate').some((t) => t.id === id)

// ------------------------------------------------------------------------------------------------ the AI readers' contract

/** The structured output an AI reader answers in. Every field is required ('' for none), so a reader can't skip one. */
export function readingSchema(): Record<string, unknown> {
  const str = { type: 'string' }
  const num = { type: 'number' }
  const bool = { type: 'boolean' }
  const choice = (list: readonly string[], empty = true) => ({ type: 'string', enum: [...(empty ? [''] : []), ...list] })
  const list = (items: unknown) => ({ type: 'array', items })
  const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
  const look = object({ element: choice(ELEMENTS), form: choice(ALL_FORMS), palette: list(str), pose: choice(CAST_POSES), charge: choice(CHARGES), impact: choice(IMPACTS), trail: choice(TRAILS), motif: choice(MOTIFS), callout: bool })
  const skill = (slot: BuildSlot) => object({ name: str, does: str, template: choice(CATALOG.filter((t) => t.slot === SLOT_KIND[slot]).map((t) => t.id), false), look })
  return object({
    heroName: str,
    summary: str,
    realPerson: bool,
    roleId: choice(ROLE_IDS, false),
    look: object({
      gender: choice(['m', 'f'], false),
      size: choice(SIZE_CLASSES, false),
      physique: object({ weight: num, muscle: num, age: num }),
      colors: list(object({ region: choice(BODY_COLORS, false), hex: str })),
      wearFace: bool,
    }),
    wear: list(
      object({
        slot: choice(LOOK_SLOTS, false),
        phrase: str,
        item: choice(['none', ...LIBRARY.map((e) => e.id)]),
        rung: choice(RUNGS, false),
        colors: list(str),
        finishes: list(choice(FINISHES)),
        print: choice(PRINTS),
        knobs: list(object({ knob: choice(KNOBS, false), value: num })),
      }),
    ),
    kit: object(Object.fromEntries(BUILD_SLOTS.map((s) => [s, skill(s)]))),
    form: object({
      entry: choice(FORM_ENTRIES),
      aura: choice(FORM_AURAS),
      growth: choice(FORM_GROWTHS),
      trail: choice(FORM_TRAILS),
      avatar: choice(FORM_AVATARS),
      hair: choice(HAIR_IDS),
      hairColor: str,
      eyes: str,
      marks: choice(FORM_MARKS),
      wear: list(object({ item: choice(FORM_WEAR_IDS), color: str })),
    }),
    questions: list(object({ about: choice(TOPICS, false), ask: str, options: list(str) })),
  })
}

let system: string | undefined

/** What an AI reader is told once per request, built on first use: only the server ever needs it. */
export function readingSystem(): string {
  if (system) return system
  const catalog = CATALOG.map((t) => `${t.id} | ${t.slot} | ${FAMILY_OF[t.delivery.kind]} | ${t.roles.join(',')} | ${t.name}: ${t.tags.join(', ')}`).join('\n')
  const library = LIBRARY.map((e) => `${e.id} | ${e.slot} | ${e.name} | ${e.channels.map((c) => c.name).join(',') || '-'} | ${e.knobs.join(',') || '-'} | ${e.tags.join(', ')}`).join('\n')
  const forms = Object.entries(FORMS).map(([family, list]) => `${family}: ${list.join(', ')}`).join('; ')
  const transformations = FORM_TEMPLATES.map((t) => `- ${t.id} ${formChange(t, 'medium')} (${t.roles.join(', ')}).`).join('\n')
  return (system = `You read how a player imagines a hero for psyblr autobattler, a 3D arena brawler, from their words and any reference images, and say back how you will build it. The player owns the look and the names. The engine owns every number, so you never invent stats or power.

How to read:
- The player's words win. Keep every name they give exactly as they wrote it, in title case. A skill they name without saying what it does may be slang or another language: translate it if you can, give your best reading of what it does, and ask.
- A reference image shows how the hero looks. Read what they wear in every slot it shows and each item's colours, the hair and facial hair, and what they hold or carry. When the player says the hero looks the way they appear somewhere (a cover, a film, a scene), the image is that appearance.
- Ask at most ${MAX_QUESTIONS} questions, only where the answer changes the hero and you can't tell. Each has two to four short options, your best guess first. Don't ask what the player already said.

The body:
- gender: m or f.
- size: tiny, small, medium, large or huge. Colossal is reached only by a transformation ultimate, never as a size.
- physique: weight, muscle and age, each 0 to 1. The body as made is weight 0.5, muscle 0.5 and age 0; age 1 is 75.
- colors: a '#rrggbb' for each of skin, hair (it colours the beard too), iris and brow that you can see or the player asks for. Leave out what you can't tell.
- wearFace: true when an image is a photo of a real face the hero should wear; false for an illustration, a mask, or when the player wants a stylised hero.

The wardrobe. A hero wears one item a slot: hair, beard, head (hats, helmets, hoods, crowns), upper (torso and arms), lower (legs), full (torso, arms and legs, in place of upper and lower), back (capes, cloaks, scarves, wings, what's slung on the back), feet, face (glasses, masks), and hand_r and hand_l (what they hold). Give a wish for each slot you can see or the player names, and leave the rest out for the role to dress:
- phrase: the thing in one to five words, the way the player or the image would put it ("wide straw hat").
- item: the library item that answers it best. none when the slot is empty on purpose (bald, clean-shaven, shirtless, barefoot). '' when nothing in the library is close.
- rung: the cheapest that gets there. wear is the item as made. recolour puts your colours and finishes on its channels. restyle adds a print or a cut. generate makes a new item in 3D for credits, so pick it only when no item is close, and give the closest item as a stand-in when there is one.
- colors: a '#rrggbb' per channel, in the item's channel order, '' to keep a channel's own. finishes the same way: cotton, silk, denim, knit, leather, metal or glow.
- print: one of the prints, on the item's first channel, or ''. knobs: cuts the item allows, each 0 (shortest) to 1 (as made).

The kit has six slots: basic (the basic attack, left click), active1 (Q), active2 (E), passive, ultimate (R) and movement (Shift). For each slot give:
- name: the player's, or two or three evocative words that fit the hero. Never a number.
- does: one short sentence of what it does, in the player's terms.
- template: the catalogue entry for that slot, from the chosen role's pool, whose mechanic best carries what it does. active1 and active2 are different templates.
- look: how it looks, which never changes what it does or how big it is. element: one of the elements, '' to let its words choose. form: a shape its template's delivery family allows, '' for the element's own. palette: three '#rrggbb', core, glow and accent. pose, charge, impact, trail and motif from their lists, '' for none or the element's own. callout: true when the hero shouts the move's name. Two beams can share a template and look nothing alike: a Kamehameha is a wave in white and sky blue from the hip, with a gather charge and a dome; a Galick Gun is a crackle in pink-white and violet, palms forward, with a crackling aura and a burst.

Transformations. A transformation ultimate's template sets the size the hero takes, and so its role:
${transformations}
Titan is the colossal one, Nine-Tails an avatar, Super Saiyan keeps its size, Ant-Man shrinks. Pick a role that holds the template. When the player doesn't say how the form changes size, guess, and ask (about: form) with sizes as the options.
form: how the transformation looks, '' everywhere when the ultimate isn't one. entry, aura, growth (only when the size changes), trail and avatar from their lists. hair: a hair item it changes to; hairColor and eyes as '#rrggbb'; marks; and wear: built-in items it puts on over the outfit, each with a colour.

Roles:
${ROLES.map((r) => `- ${r.id}: ${r.description}`).join('\n')}

realPerson: true when the hero is a real person. Describe real people with respect: nothing sexual, never a minor, never shown endorsing the game.
summary: one sentence that shows the player you understood the character, naming the look you will build.

Catalogue (id | slot | delivery | roles | name: tags):
${catalog}

Library (id | slot | name | channels | knobs | tags):
${library}

Prints: ${PRINTS.join(', ')}.
Elements: ${ELEMENTS.join(', ')}.
Forms by delivery: ${forms}.
Cast poses: ${CAST_POSES.join(', ')}. Charges: ${CHARGES.join(', ')}. Impacts: ${IMPACTS.join(', ')}. Trails: ${TRAILS.join(', ')}. Motifs: ${MOTIFS.join(', ')}.
Form entries: ${FORM_ENTRIES.join(', ')}. Auras: ${FORM_AURAS.join(', ')}. Growths: ${FORM_GROWTHS.join(', ')}. Form trails: ${FORM_TRAILS.join(', ')}. Avatars: ${FORM_AVATARS.join(', ')}. Marks: ${FORM_MARKS.join(', ')}.`)
}

/** What an AI reader is told about this request, beside the images. */
export function readingRequest(input: ReadInput): string {
  const lines = [`Prompt: ${input.prompt}`]
  if (input.heroName?.trim()) lines.push(`The player named the hero: ${input.heroName.trim()}`)
  lines.push(input.faceFound ? 'The Forge found a face on the reference image that the hero could wear.' : 'The Forge found no face it could put on the hero.')
  if (input.previous && input.note) {
    lines.push(`Your last reading: ${JSON.stringify(answerOf(input.previous))}`)
    lines.push(`The player's correction: ${input.note}`)
    lines.push('Read again. Change what the correction asks for and keep the rest.')
  }
  return lines.join('\n')
}

/** A reading in an AI reader's own words, for showing it the last one it gave. */
function answerOf(reading: Reading) {
  const { source: _source, look, wear, questions, ...rest } = reading
  return {
    ...rest,
    look: { ...look, physique: look.physique ?? NEUTRAL_PHYSIQUE, colors: Object.entries(look.colors).map(([region, hex]) => ({ region, hex })) },
    wear: wearAnswer(wear),
    questions: questions.map((q) => ({ ...q, options: q.options.map((o) => o.label) })),
  }
}

// ------------------------------------------------------------------------------------------------ untrusted answers

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
/** A skill name is text players see: no number in it can read as a stat. */
const skillName = (v: unknown) => text(v, TEXT_LIMITS.name * 2).replace(/\d+/g, '').replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMITS.name)
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => ((list as readonly string[]).includes(v as string) ? (v as T) : fallback)
const record = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/** The template a slot can use: the one asked for when the role's pool has it, else the best match for what it does. */
function slotTemplate(roleId: RoleId, slot: BuildSlot, wanted: string | undefined, words: string, exclude: string[] = []): string {
  const pool = poolFor(roleId, SLOT_KIND[slot])
  if (wanted && pool.some((t) => t.id === wanted) && !exclude.includes(wanted)) return wanted
  return matchTemplate(roleId, SLOT_KIND[slot], words, exclude).template.id
}

/** A look's form only where its template's delivery can take it; the rest of the look stands. */
function fitLook(look: SkillLook | undefined, templateId: string): SkillLook | undefined {
  if (!look?.form) return look
  const t = BY_ID.get(templateId)
  if (t && formsFor(t.delivery.kind).includes(look.form)) return look
  const { form: _form, ...rest } = look
  return rest
}

/** The kit with every template from the role's pool, the two actives different, and every look fitting its template. */
function settleKit(roleId: RoleId, kit: Record<BuildSlot, ReadingSkill>): Record<BuildSlot, ReadingSkill> {
  const out = {} as Record<BuildSlot, ReadingSkill>
  for (const slot of BUILD_SLOTS) {
    const { look, ...skill } = kit[slot]
    const exclude = slot === 'active2' ? [out.active1.template] : []
    const template = slotTemplate(roleId, slot, skill.template, `${skill.name} ${skill.does}`, exclude)
    const fitted = fitLook(look, template)
    out[slot] = { ...skill, template, ...(fitted ? { look: fitted } : {}) }
  }
  return out
}

/** The transformation an answer means: a template it names, or the size change its words describe. */
function formOption(label: string): string | undefined {
  const lower = label.toLowerCase()
  return FORM_TEMPLATES.find((t) => lower.includes(t.name.toLowerCase()))?.id ?? formFromWords(label)
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
    const options: ReadingOption[] = []
    for (const o of Array.isArray(value.options) ? value.options : []) {
      const label = text(typeof o === 'string' ? o : (o as { label?: unknown })?.label, 80)
      if (!label || !about || options.length === 4) continue
      if (about === 'form') {
        // a form answer is the transformation it means, each once
        const template = formOption(label)
        if (template && !options.some((p) => p.template === template)) options.push({ label, template })
        continue
      }
      const own = (o as { template?: unknown })?.template
      const template = typeof own === 'string' && BY_ID.has(own) ? own : undefined
      const v = optionValue(about, label)
      options.push({ label, ...(template ? { template } : {}), ...(v ? { value: v } : {}) })
    }
    if (!about || !ask || options.length < 2 || out.some((o) => o.about === about)) continue
    out.push({ about, ask, options })
    if (out.length === MAX_QUESTIONS) break
  }
  return out
}

/** A physique held to 0 to 1 each; none when it's the body as made. */
function readPhysique(raw: unknown): Physique | undefined {
  const p = record(raw)
  const value = (k: keyof Physique) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? Math.round(Math.min(1, Math.max(0, p[k] as number)) * 100) / 100 : NEUTRAL_PHYSIQUE[k])
  const out = { weight: value('weight'), muscle: value('muscle'), age: value('age') }
  return out.weight === NEUTRAL_PHYSIQUE.weight && out.muscle === NEUTRAL_PHYSIQUE.muscle && out.age === NEUTRAL_PHYSIQUE.age ? undefined : out
}

/** A form look as a reader flattens it (hair, eyes and wear beside the entry) or as a reading keeps it. */
function readForm(raw: unknown): TransformationLook | undefined {
  const f = record(raw)
  if ('body' in f) return hydrateTransformation(f)
  const wear = Array.isArray(f.wear) ? f.wear.map((w) => record(w)).map((w) => ({ id: w.item ?? w.id, ...(typeof w.color === 'string' && w.color ? { colors: [w.color.toLowerCase()] } : {}) })) : undefined
  const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v)
  return hydrateTransformation({ entry: f.entry, aura: f.aura, growth: f.growth, trail: f.trail, avatar: f.avatar, body: { hair: f.hair, hairColor: lower(f.hairColor), eyes: lower(f.eyes), marks: f.marks, wear } })
}

/**
 * Rebuild a reading from an AI reader's answer, keeping only what the vocabulary allows: names trimmed, colours checked,
 * templates from the role's pool, items from the library, looks that fit their templates. Anything missing comes from
 * the offline reading of the same request.
 */
export function hydrateReading(raw: unknown, input: ReadInput, source: ReadingSource): Reading {
  const fallback = offlineReading(input)
  const value = record(raw)
  const roleId = isRoleId(value.roleId) ? value.roleId : fallback.roleId
  const lookIn = record(value.look)
  const colors: Partial<Record<BodyColor, string>> = {}
  // an AI reader lists colours; a reading sent back from the Forge keeps them by region
  const pairs = Array.isArray(lookIn.colors) ? lookIn.colors : Object.entries(record(lookIn.colors)).map(([region, hex]) => ({ region, hex }))
  for (const c of pairs) {
    const region = BODY_COLORS.find((r) => r === (c as { region?: unknown })?.region)
    const hex = text((c as { hex?: unknown })?.hex, 7).toLowerCase()
    if (region && HEX.test(hex)) colors[region] ??= hex
  }
  const physique = readPhysique(lookIn.physique)
  const wearFace = !!input.faceFound && lookIn.wearFace !== false
  const strength = lookIn.faceStrength
  const look: ReadingLook = {
    gender: oneOf(lookIn.gender, ['m', 'f'] as const, fallback.look.gender),
    size: oneOf(lookIn.size, SIZE_CLASSES, fallback.look.size),
    ...(physique ? { physique } : {}),
    colors,
    wearFace,
    ...(wearFace && typeof strength === 'number' && strength >= 0 && strength < 1 ? { faceStrength: strength } : {}),
  }
  const kitIn = record(value.kit)
  const kit = {} as Record<BuildSlot, ReadingSkill>
  // on a first reading a name the player gave stays theirs, whatever the reader answered; a correction may rename
  const own = input.note ? {} : namedSkills(input.prompt)
  for (const slot of BUILD_SLOTS) {
    const s = record(kitIn[slot])
    const skillLook = hydrateSkillLook(s.look)
    kit[slot] = { name: own[slot]?.name || skillName(s.name), does: text(s.does, TEXT_LIMITS.flavour) || own[slot]?.does || '', template: text(s.template, 64), ...(skillLook ? { look: skillLook } : {}) }
  }
  const settled = settleKit(roleId, kit)
  const transforming = transforms(settled.ultimate.template)
  const form = transforming ? readForm(value.form) : undefined
  return {
    heroName: input.heroName?.trim().slice(0, TEXT_LIMITS.heroName) || text(value.heroName, TEXT_LIMITS.heroName) || fallback.heroName,
    summary: text(value.summary, MAX_SUMMARY) || fallback.summary,
    realPerson: value.realPerson === true,
    roleId,
    look,
    wear: readWear(value.wear),
    kit: settled,
    ...(form ? { form } : {}),
    questions: readQuestions(value.questions).filter((q) => (q.about !== 'face' || input.faceFound) && (q.about !== 'form' || transforming)),
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
/** A stretch of the player's words without the filler, in single spaces. */
const plain = (words: string) => words.replace(FILLER, ' ').replace(/\s+/g, ' ').replace(/^[ ,]+|[ ,]+$/g, '')

/** Mechanic words in what a player says a skill is, and the sentence a reading gives them. */
const HINTS: [RegExp, string][] = [
  [/\btransform\w*|\bpower[- ]?up\b|\bawaken\w*|\bsuper form\b|\bevolv\w*|\bascen\w*|\bgoes? (?:giant|super)\b|\bshrinks?\b|\bgrows? (?:giant|huge|colossal|bigger|to)\b|\bnine[- ]?tails?\b|\bsuper saiyan\b|\bant[- ]?man\b|\btitan form\b|\bhulks? out\b/i, 'Transforms into a stronger form for a while'],
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
  /** The player's own words for it, before a hint replaced them: what a form question reads. */
  words: string
}

/** The first marker in a stretch of text, with where it starts and ends. */
function firstMarker(context: string): { slot: BuildSlot | 'skill'; at: number; end: number } | undefined {
  let best: { slot: BuildSlot | 'skill'; at: number; end: number } | undefined
  for (const [slot, re] of MARKERS) {
    for (const m of context.matchAll(new RegExp(re.source, 'gi'))) {
      if (CAPITAL_ONLY.test(m[0]) && m[0] !== m[0].toUpperCase()) continue
      if (!best || m.index < best.at || (m.index === best.at && slot !== 'skill')) best = { slot, at: m.index, end: m.index + m[0].length }
      break
    }
  }
  return best
}

/**
 * The skills a prompt names, by slot: `Skill 1 "encore kha ja"`, `ultimate is a transformation "kendrick se bhi upar"`,
 * `Q "Moon Slash"`. A quoted name takes the first slot word before it in its sentence, and the words between become what
 * it does. With none between, the words after the name do if they name a mechanic, up to the next sentence break, quote
 * or slot word (`ultimate "Moon Slash" goes super saiyan`). A quote with no slot word near it is a nickname, as in
 * Jeff "Prime" Bezos, unless the sentence is about skills.
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
    const tail = prompt.slice(from).split(/[.!?;"“”]/)[0]
    const next = firstMarker(tail)
    const after = plain(next ? tail.slice(0, next.at) : tail)
    // "and he wears a red cape" after a name is about the hero, so it still gets asked what the skill does
    const between = plain(context.slice(marker.end)) || (hintFor(after) ? after : '')
    const named = { name: titleCase(m[1].trim()).slice(0, TEXT_LIMITS.name), does: between ? (hintFor(between) ?? between.charAt(0).toUpperCase() + between.slice(1)).slice(0, TEXT_LIMITS.flavour) : '', words: between }
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
  execute: 'finishes the wounded', resize: 'changes size', form: 'transforms', control: 'locks down', knockup: 'knocks up', pull: 'pulls in', debuff: 'weakens',
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

/** A transformation as an answer: its name and how it changes this hero's size, and the role it moves to when it must. */
export function formAnswer(template: Template, reading: Pick<Reading, 'roleId' | 'look'>): ReadingOption {
  const role = template.roles.includes(reading.roleId) ? '' : ` (${getRole(template.roles[0]).name.toLowerCase()})`
  return { label: `${template.name}: ${formChange(template, reading.look.size)}${role}`, template: template.id }
}

/** Which way the transformation goes: the guess first, then keeping its size, shrinking, and the biggest other growth. */
function formQuestion(reading: Omit<Reading, 'summary' | 'questions'>): ReadingQuestion {
  const current = reading.kit.ultimate.template
  const biggest = current === 'tank-titan-form' ? 'fighter-avatar-form' : 'tank-titan-form'
  const ids = [...new Set([current, 'fighter-ascended-form', 'assassin-shrink-form', biggest, 'fighter-super-form'])].filter((id) => transforms(id)).slice(0, 4)
  const name = reading.kit.ultimate.name || 'the transformation'
  return { about: 'form', ask: `Does ${name} grow, shrink, or keep ${reading.look.gender === 'f' ? 'her' : 'his'} size?`, options: ids.map((id) => formAnswer(BY_ID.get(id)!, reading)) }
}

const TANK_WORDS = /\b(giant|colossal|titan|tank|tough|armou?r(?:ed)?|wall|unkillable|immovable|fortress)\b/i

/** The role a transformation goes with: the role the words suggest when it can take it, else the template's own. */
function formRole(template: string | undefined, prompt: string, suggested: RoleId): RoleId {
  const t = template ? BY_ID.get(template) : undefined
  if (!t) return TANK_WORDS.test(prompt) ? 'tank' : 'fighter'
  if (t.roles.includes(suggested)) return suggested
  return t.roles.includes('tank') && TANK_WORDS.test(prompt) ? 'tank' : t.roles[0]
}

const listed = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? ''))

function summaryOf(reading: Omit<Reading, 'summary' | 'questions'>): string {
  const role = getRole(reading.roleId).name.toLowerCase()
  const size = reading.look.size === 'medium' ? '' : `${SIZES[reading.look.size].label.toLowerCase()} `
  const named = BUILD_SLOTS.filter((s) => reading.kit[s].name)
  const skills = named.map((s) => (s === 'ultimate' && transforms(reading.kit[s].template) ? `the transformation ${reading.kit[s].name}` : reading.kit[s].name))
  const worn = reading.wear.filter((w) => !w.bare).map((w) => w.phrase).slice(0, 4)
  return `${reading.heroName}, a ${size}${role}${worn.length ? `, with ${listed(worn)}` : ''}${skills.length ? `. Skills: ${listed(skills)}` : ''}.`
}

/** The colours a prompt gives the body: "red hair", "blue eyes". */
function bodyColours(prompt: string): Partial<Record<BodyColor, string>> {
  const all = coloursFromPrompt(prompt)
  return Object.fromEntries(BODY_COLORS.flatMap((c) => (all[c] ? [[c, all[c]]] : [])))
}

/**
 * The offline reading: the prompt's names, size, build, colours and wardrobe words, the skills it names by slot, and a
 * role that suits them. It asks what any skill named without a description does, which way a transformation changes
 * size when the words don't say, and whether to wear a face it found.
 */
export function offlineReading(input: ReadInput): Reading {
  if (input.previous && input.note) return correctOffline(input.previous, input.note, input)
  const prompt = input.prompt
  const heroName = input.heroName?.trim().slice(0, TEXT_LIMITS.heroName) || nameFromPrompt(prompt)
  const named = namedSkills(prompt)
  // a prompt that names no skills by slot can still list themes ("skills around X, Y and Z") or a hero the culture table knows
  const skills: Partial<Record<BuildSlot, Named>> = Object.keys(named).length ? named : Object.fromEntries(Object.entries(skillsFromPrompt(prompt)).map(([s, t]) => [s, { name: t!.name, does: '', words: '' }]))
  const ultimate = skills.ultimate
  const transform = !!ultimate && isTransform(`${ultimate.words} ${ultimate.does}`)
  // how the form changes size, from the player's own words for it: "ultimate shrinks him like Ant-Man"
  const sized = transform ? formFromWords(`${ultimate.words} ${ultimate.name}`) : undefined
  const asked = Object.fromEntries(Object.entries(skills).map(([s, k]) => [s, { name: k!.name, flavour: k!.does }]))
  const suggested = inferRole(heroName, asked)
  const roleId = transform ? formRole(sized, prompt, suggested) : suggested
  const physique = physiqueFromPrompt(prompt)
  const look: ReadingLook = {
    gender: genderFromPrompt(prompt) ?? ROLE_GENDER[roleId] ?? 'm',
    size: sizeFromPrompt(prompt) ?? 'medium',
    ...(physique ? { physique } : {}),
    colors: bodyColours(prompt),
    wearFace: !!input.faceFound,
  }
  const kit = {} as Record<BuildSlot, ReadingSkill>
  for (const slot of BUILD_SLOTS) {
    const skill = skills[slot]
    const template = slot === 'ultimate' && transform ? (sized && holds(roleId, sized) ? sized : TRANSFORMS[roleId]) : undefined
    kit[slot] = { name: skill?.name ?? '', does: skill?.does ?? '', template: template ?? '' }
  }
  const reading = { heroName, realPerson: false, roleId, look, wear: wearFromPrompt(prompt), kit: settleKit(roleId, kit), source: 'offline' as const }
  return { ...reading, summary: summaryOf(reading), questions: offlineQuestions(reading, !!input.faceFound, transform && !sized) }
}

/** What the offline reader can't settle: skills named without a description, which way a form goes, a face it found. */
function offlineQuestions(reading: Omit<Reading, 'summary' | 'questions'>, faceFound: boolean, askForm: boolean): ReadingQuestion[] {
  const out: ReadingQuestion[] = []
  for (const slot of BUILD_SLOTS) {
    const skill = reading.kit[slot]
    if (!skill.name || skill.does) continue
    out.push({ about: slot, ask: `What should ${skill.name} do?`, options: skillOptions(reading.roleId, slot, skill.template, slot === 'active2' ? [reading.kit.active1.template] : slot === 'active1' ? [reading.kit.active2.template] : []) })
  }
  if (askForm && transforms(reading.kit.ultimate.template)) out.push(formQuestion(reading))
  if (faceFound) out.push({ about: 'face', ask: 'Wear the face from your image?', options: [{ label: 'Yes, wear it', value: 'yes' }, { label: "No, keep the body's own face", value: 'no' }] })
  return out.slice(0, MAX_QUESTIONS)
}

/** An offline correction on top of the last reading: what the note says about the body, the wardrobe and the skills. */
function correctOffline(previous: Reading, note: string, input: ReadInput): Reading {
  // size words about the ultimate size its form, not the hero: "make the ultimate shrink him to tiny"
  const aboutForm = /\b(?:ult\w*|transform\w*|form)\b/i.test(note)
  const size = aboutForm ? undefined : sizeFromPrompt(note)
  const physique = physiqueFromPrompt(note)
  const look: ReadingLook = {
    ...previous.look,
    gender: genderFromPrompt(note) ?? previous.look.gender,
    ...(size ? { size } : {}),
    ...(physique ? { physique } : {}),
    colors: { ...previous.look.colors, ...bodyColours(note) },
  }
  if (/\b(no|without|lose|drop)\s+(?:the\s+)?face\b/i.test(note)) look.wearFace = false
  const named = namedSkills(note)
  const kit = { ...previous.kit }
  for (const [slot, skill] of Object.entries(named) as [BuildSlot, Named][]) kit[slot] = { ...kit[slot], name: skill.name, does: skill.does || kit[slot].does, template: '' }
  const roleId = ROLE_IDS.find((r) => new RegExp(`\\b(?:a|as|make (?:him|her|it)(?: a)?)\\s+${r}\\b`, 'i').test(note)) ?? previous.roleId
  const fresh = roleId === previous.roleId ? kit : (Object.fromEntries(BUILD_SLOTS.map((s) => [s, { ...kit[s], template: '' }])) as Record<BuildSlot, ReadingSkill>)
  const base: Reading = { ...previous, heroName: input.heroName?.trim() || previous.heroName, roleId, look, wear: correctWear(previous.wear, note), kit: settleKit(roleId, fresh), source: 'offline' }
  // "make the ultimate shrink him" picks the form that does
  const said = aboutForm && (transforms(base.kit.ultimate.template) || isTransform(base.kit.ultimate.does)) ? formFromWords(note) : undefined
  const reading = said ? withForm(base, said) : base
  return { ...reading, summary: summaryOf(reading), questions: offlineQuestions(reading, !!input.faceFound && reading.look.wearFace, false) }
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
export const readingText = (r: Reading) => [r.heroName, r.summary, ...r.wear.map((w) => w.phrase), ...BUILD_SLOTS.flatMap((s) => [r.kit[s].name, r.kit[s].does])].join('\n')

// ------------------------------------------------------------------------------------------------ answering and building

/** A tapped answer applied to the reading; the question goes away. */
export function answerQuestion(reading: Reading, index: number, option: ReadingOption): Reading {
  const q = reading.questions[index]
  if (!q) return reading
  const questions = reading.questions.filter((_, i) => i !== index)
  if (q.about === 'face') return { ...reading, questions, look: { ...reading.look, wearFace: option.value !== 'no' } }
  if (q.about === 'size') return option.value && (SIZE_CLASSES as readonly string[]).includes(option.value) ? { ...reading, questions, look: { ...reading.look, size: option.value as SizeClass } } : { ...reading, questions }
  if (q.about === 'role') return isRoleId(option.value) ? withRole({ ...reading, questions }, option.value) : { ...reading, questions }
  if (q.about === 'form') return option.template ? withForm({ ...reading, questions }, option.template) : { ...reading, questions }
  const slot = q.about
  // a kit answer is what the skill does: the template it names, or the words matched to one
  const does = option.template ? option.label.replace(/^[^:]+:\s*/, '').replace(/^\w/, (c) => c.toUpperCase()) : option.label
  const kit = { ...reading.kit, [slot]: { ...reading.kit[slot], does, template: option.template ?? '' } }
  return { ...reading, questions, kit: settleKit(reading.roleId, kit) }
}

/** The reading for another role: its skills keep their names, what they do and their looks, matched again from the new pool. */
export function withRole(reading: Reading, roleId: RoleId): Reading {
  if (roleId === reading.roleId) return reading
  const ultimate = reading.kit.ultimate
  // a transformation stays one: the same one when the new role can take it, else the new role's own
  const form = transforms(ultimate.template) || isTransform(ultimate.does) ? (holds(roleId, ultimate.template) ? ultimate.template : (TRANSFORMS[roleId] ?? '')) : ''
  const kit = Object.fromEntries(BUILD_SLOTS.map((s) => [s, { ...reading.kit[s], template: s === 'ultimate' ? form : '' }])) as Record<BuildSlot, ReadingSkill>
  return { ...reading, roleId, kit: settleKit(roleId, kit) }
}

/** The reading with its ultimate on a transformation: the size it takes is the template's, moving role when it must. */
export function withForm(reading: Reading, templateId: string): Reading {
  const t = BY_ID.get(templateId)
  if (!t || !transformOf(t)) return reading
  const roleId = t.roles.includes(reading.roleId) ? reading.roleId : t.roles[0]
  const moved = withRole(reading, roleId)
  return { ...moved, kit: settleKit(roleId, { ...moved.kit, ultimate: { ...moved.kit.ultimate, template: templateId } }) }
}

/** Edit one slot's name or description; what it does picks its template again, and a transformation keeps its size. */
export function editReadingSkill(reading: Reading, slot: BuildSlot, patch: Partial<Pick<ReadingSkill, 'name' | 'does'>>): Reading {
  const skill = { ...reading.kit[slot], ...patch }
  if (patch.does === undefined) return { ...reading, kit: settleKit(reading.roleId, { ...reading.kit, [slot]: skill }) }
  let template = ''
  if (slot === 'ultimate' && isTransform(skill.does)) {
    const said = formFromWords(skill.does)
    template = said && holds(reading.roleId, said) ? said : transforms(reading.kit.ultimate.template) ? reading.kit.ultimate.template : (TRANSFORMS[reading.roleId] ?? '')
  }
  return { ...reading, kit: settleKit(reading.roleId, { ...reading.kit, [slot]: { ...skill, template } }) }
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
