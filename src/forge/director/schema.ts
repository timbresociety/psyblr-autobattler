import { BUILD_SLOTS } from '../../charter/build'
import { ROLE_IDS, isRoleId } from '../../charter/roles'
import { SIZE_CLASSES, isSizeClass, type SizeClass } from '../../charter/sizes'
import type { BuildSlot, RoleId } from '../../charter/types'
import { LOOK_PRIMITIVES } from '../../arena/recipes/looks'
import type { RecipeLook } from '../../arena/recipes/schema'
import type { ChatTurn, ContentFlags, Suggestion, Tone } from '../types'

export interface DirectorInput {
  prompt: string
  heroName?: string
  referenceCaptions: string[]
  chat: ChatTurn[]
  /** Answers to the director's earlier questions, by question id. */
  answers?: Record<string, string>
}

export interface DraftSkill {
  slot: BuildSlot
  name: string
  theme: string
  /** Colours and effect primitives for the skill's visual (R33); the Forge sizes them to the real hit area. */
  look?: RecipeLook
}

export interface DraftSpec {
  heroName: string
  roleId: RoleId
  description: string
  sizeClass: SizeClass
  silhouette: string
  signatureElements: string[]
  basicStyle: 'melee' | 'ranged'
  skills: DraftSkill[]
  passiveVisual: 'aura' | 'body-element'
  passiveElement?: string
  flags: ContentFlags
}

export interface DirectorOutput {
  tone: Tone
  confidence: number
  questions: { id: string; text: string; options: string[] }[]
  suggestions: Suggestion[]
  spec?: DraftSpec
}

const str = { type: 'string' }

/** The structured-output schema the live director must follow (KTD4). */
export const DIRECTOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['tone', 'confidence', 'questions', 'suggestions'],
  properties: {
    tone: { type: 'string', enum: ['heroic', 'meme', 'mixed', 'unsure'] },
    confidence: { type: 'number' },
    questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text', 'options'], properties: { id: str, text: str, options: { type: 'array', items: str } } } },
    suggestions: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'kind', 'text', 'reason', 'accepted'], properties: { id: str, kind: { type: 'string', enum: ['outfit', 'prop', 'catchphrase', 'reference', 'skill-theme', 'aura', 'color'] }, text: str, reason: str, accepted: { type: 'boolean' } } },
    },
    spec: {
      type: 'object',
      additionalProperties: false,
      required: ['heroName', 'roleId', 'description', 'sizeClass', 'silhouette', 'signatureElements', 'basicStyle', 'skills', 'passiveVisual', 'flags'],
      properties: {
        heroName: str,
        roleId: { type: 'string', enum: [...ROLE_IDS] },
        description: str,
        sizeClass: { type: 'string', enum: [...SIZE_CLASSES] },
        silhouette: str,
        signatureElements: { type: 'array', items: str },
        basicStyle: { type: 'string', enum: ['melee', 'ranged'] },
        skills: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['slot', 'name', 'theme'],
            properties: {
              slot: { type: 'string', enum: [...BUILD_SLOTS] },
              name: str,
              theme: str,
              look: {
                type: 'object',
                additionalProperties: false,
                required: ['palette', 'feature'],
                properties: { palette: { type: 'array', items: str }, feature: { type: 'array', items: { type: 'string', enum: [...LOOK_PRIMITIVES] } }, intensity: { type: 'number' }, charged: { type: 'boolean' } },
              },
            },
          },
        },
        passiveVisual: { type: 'string', enum: ['aura', 'body-element'] },
        passiveElement: str,
        flags: { type: 'object', additionalProperties: false, required: ['realPerson', 'sexual', 'minors', 'endorsement'], properties: { realPerson: { type: 'boolean' }, sexual: { type: 'boolean' }, minors: { type: 'boolean' }, endorsement: { type: 'boolean' } } },
      },
    },
  },
}

const isStr = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max

/** A look from the model is kept only when its colours are hex and its primitives are known. */
function parseLook(raw: unknown): RecipeLook | undefined {
  const l = raw as Record<string, unknown> | undefined
  if (!l || typeof l !== 'object' || !Array.isArray(l.palette) || !Array.isArray(l.feature)) return undefined
  const palette = (l.palette as unknown[]).filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
  if (palette.length !== 3) return undefined
  const feature = (l.feature as unknown[]).filter((p): p is RecipeLook['feature'][number] => (LOOK_PRIMITIVES as readonly unknown[]).includes(p)).slice(0, 4)
  const intensity = typeof l.intensity === 'number' && l.intensity > 0 && l.intensity <= 2 ? l.intensity : undefined
  return { palette: palette as RecipeLook['palette'], feature, ...(intensity ? { intensity } : {}), ...(l.charged === true ? { charged: true } : {}) }
}

/** Accept a model's answer only when it fits the contract; anything else falls back to the offline brain. */
export function parseDirectorOutput(raw: unknown): DirectorOutput | undefined {
  const v = raw as Record<string, unknown>
  if (!v || typeof v !== 'object') return undefined
  if (!['heroic', 'meme', 'mixed', 'unsure'].includes(v.tone as string)) return undefined
  if (!Array.isArray(v.questions) || !Array.isArray(v.suggestions)) return undefined
  const suggestions = (v.suggestions as Record<string, unknown>[]).filter((s) => isStr(s.id, 40) && isStr(s.text) && isStr(s.reason)).slice(0, 20) as unknown as Suggestion[]
  const questions = (v.questions as Record<string, unknown>[]).filter((q) => isStr(q.id, 40) && isStr(q.text) && Array.isArray(q.options)).slice(0, 5) as unknown as DirectorOutput['questions']
  let spec: DraftSpec | undefined
  if (v.spec) {
    const s = v.spec as Record<string, unknown>
    const skills = Array.isArray(s.skills)
      ? (s.skills as Record<string, unknown>[]).filter((k) => BUILD_SLOTS.includes(k.slot as BuildSlot) && isStr(k.name, 40) && isStr(k.theme, 280)).map((k) => ({ slot: k.slot, name: k.name, theme: k.theme, ...(parseLook(k.look) ? { look: parseLook(k.look) } : {}) }))
      : []
    if (!isStr(s.heroName, 60) || !isRoleId(s.roleId) || !isSizeClass(s.sizeClass) || !isStr(s.description, 1000) || skills.length < 3) return undefined
    spec = {
      heroName: s.heroName,
      roleId: s.roleId,
      description: s.description,
      sizeClass: s.sizeClass,
      silhouette: isStr(s.silhouette) ? s.silhouette : '',
      signatureElements: Array.isArray(s.signatureElements) ? (s.signatureElements as unknown[]).filter((e): e is string => isStr(e, 120)).slice(0, 8) : [],
      basicStyle: s.basicStyle === 'ranged' ? 'ranged' : 'melee',
      skills: skills as unknown as DraftSkill[],
      passiveVisual: s.passiveVisual === 'body-element' ? 'body-element' : 'aura',
      ...(isStr(s.passiveElement, 120) ? { passiveElement: s.passiveElement } : {}),
      flags: (() => {
        const f = (s.flags ?? {}) as Partial<ContentFlags>
        return { realPerson: f.realPerson === true, sexual: f.sexual === true, minors: f.minors === true, endorsement: f.endorsement === true }
      })(),
    }
  }
  return { tone: v.tone as Tone, confidence: Number(v.confidence) || 0.5, questions, suggestions, ...(spec ? { spec } : {}) }
}
