import Anthropic from '@anthropic-ai/sdk'
import {
  BUILD_SLOTS,
  SLOT_KIND,
  MAX_CHAT,
  MAX_PHOTOS,
  TEXT_LIMITS,
  allocate,
  proposedSpread,
  changeRole,
  proposeBuild,
  requestStats,
  type Build,
  type ProposalInput,
  type StatGoal,
} from '../charter/build'
import { ROLES, ROLE_IDS, isRoleId } from '../charter/roles'
import { ATTRIBUTES, SECONDARY_STATS } from '../charter/stats'
import { CATALOG, poolFor } from '../charter/templates/catalog'
import type { BuildSlot, LimitHit, SecondaryStat, Spread } from '../charter/types'
import { RateLimiter } from './rate-limit'
import { parseStatWishes } from '../charter/chat'

/**
 * Claude proposes, the catalogue disposes (KTD5). Claude may only return a role ID, template IDs and a
 * spread (or stat wishes for chat edits). Everything is validated and clamped by the Charter core, and
 * the offline matcher answers whenever the model is unavailable, slow, or over the rate limit.
 */

export const MODEL = 'claude-opus-5-5'
const TIMEOUT_MS = 15_000

export class InputError extends Error {}

/** A model call returns parsed JSON; tests inject their own. */
export type ModelCall = (request: { system: string; content: Anthropic.Beta.BetaContentBlockParam[]; schema: Record<string, unknown> }) => Promise<unknown>

export interface ProposeDeps {
  callModel?: ModelCall
  limiter?: RateLimiter
  keys?: string[]
}

export interface HeroRequest extends ProposalInput {
  /** Public URLs of the hero's reference photos, sent to Claude as images. */
  photoUrls?: string[]
}

const defaultLimiter = new RateLimiter({ limit: 20, windowMs: 60 * 60 * 1000 })

let client: Anthropic | undefined

/** The real model call: structured JSON output, low effort, server-side refusal fallbacks. */
export const anthropicCall: ModelCall = async ({ system, content, schema }) => {
  client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 })
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  })
  if (response.stop_reason === 'refusal') throw new Error('model declined')
  const text = response.content.find((block) => block.type === 'text')
  if (!text || text.type !== 'text') throw new Error('no structured output')
  return JSON.parse(text.text)
}

function checkInput(input: HeroRequest) {
  const tooLong = (value: string | undefined, max: number) => (value ?? '').length > max
  if (!input.heroName?.trim() || tooLong(input.heroName, TEXT_LIMITS.heroName)) throw new InputError('hero name is missing or too long')
  for (const skill of Object.values(input.skills ?? {})) {
    if (!skill) continue
    if (tooLong(skill.name, TEXT_LIMITS.name) || tooLong(skill.flavour, TEXT_LIMITS.flavour) || tooLong(skill.visual, TEXT_LIMITS.visual)) {
      throw new InputError('a skill name, description or visual direction is too long')
    }
  }
  if (tooLong(input.description, MAX_CHAT)) throw new InputError('description too long')
  if ((input.photoUrls ?? []).length > MAX_PHOTOS) throw new InputError(`at most ${MAX_PHOTOS} photos`)
  if ((input.photoUrls ?? []).some((url) => !/^https:\/\//.test(url))) throw new InputError('photos must be https URLs')
}

const CATALOG_TEXT = CATALOG.map((t) => `${t.id} | ${t.slot} | ${t.roles.join(',')} | ${t.name}: ${t.tags.join(', ')}`).join('\n')

const PROPOSE_SYSTEM = `You set up heroes for a 3D arena brawler. A player describes a hero; you choose how it plays.
You never invent numbers or power. You only pick from the fixed catalogue below, and the engine balances everything.

Pick one role:
${ROLES.map((r) => `- ${r.id}: ${r.description}`).join('\n')}

Then pick one template ID per slot from that role's options (slot kinds: basic, active, passive, ultimate, movement; active1 and active2 are two different active templates). Choose the template whose mechanic best matches the player's description of that skill; when a slot has no description, pick what suits the hero.
Then split exactly 30 points across strength, agility and intellect to suit the hero.

Catalogue (id | slot | roles | name: tags):
${CATALOG_TEXT}`

const proposalSchema = (): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['roleId', 'templates', 'spread'],
  properties: {
    roleId: { type: 'string', enum: [...ROLE_IDS] },
    templates: {
      type: 'object',
      additionalProperties: false,
      required: [...BUILD_SLOTS],
      properties: Object.fromEntries(
        BUILD_SLOTS.map((slot) => [slot, { type: 'string', enum: CATALOG.filter((t) => t.slot === SLOT_KIND[slot]).map((t) => t.id) }]),
      ),
    },
    spread: {
      type: 'object',
      additionalProperties: false,
      required: [...ATTRIBUTES],
      properties: Object.fromEntries(ATTRIBUTES.map((a) => [a, { type: 'integer' }])),
    },
  },
})

function describeHero(input: HeroRequest): Anthropic.Beta.BetaContentBlockParam[] {
  const lines = [`Hero: ${input.heroName}`]
  if (input.description) lines.push(`Description: ${input.description}`)
  for (const slot of BUILD_SLOTS) {
    const skill = input.skills[slot]
    if (skill && (skill.name || skill.flavour)) lines.push(`${slot}: "${skill.name}" — ${skill.flavour}`)
  }
  const images: Anthropic.Beta.BetaContentBlockParam[] = (input.photoUrls ?? []).map((url) => ({ type: 'image', source: { type: 'url', url } }))
  return [...images, { type: 'text', text: lines.join('\n') }]
}

export interface ProposeResult {
  build: Build
  /** True when the offline matcher answered instead of Claude. */
  offline: boolean
  limits: LimitHit[]
}

/** Read only the fields the schema allows; anything else in the model's answer is ignored (R4). */
function readProposal(raw: unknown): { roleId?: string; templates: Partial<Record<BuildSlot, string>>; spread?: Spread } {
  const value = (raw ?? {}) as Record<string, unknown>
  const templates = (value.templates ?? {}) as Record<string, unknown>
  const spreadRaw = (value.spread ?? {}) as Record<string, unknown>
  const spread = ATTRIBUTES.every((a) => Number.isInteger(spreadRaw[a])) ? (Object.fromEntries(ATTRIBUTES.map((a) => [a, spreadRaw[a]])) as Spread) : undefined
  return {
    roleId: typeof value.roleId === 'string' ? value.roleId : undefined,
    templates: Object.fromEntries(BUILD_SLOTS.filter((s) => typeof templates[s] === 'string').map((s) => [s, templates[s] as string])),
    spread,
  }
}

/** Turn a name, photos and skill descriptions into a draft build (F1, R5, R9, R13). */
export async function proposeHero(input: HeroRequest, deps: ProposeDeps = {}): Promise<ProposeResult> {
  checkInput(input)
  const offline = () => {
    const result = proposeBuild(input)
    return { build: result.build, offline: true, limits: result.ok ? result.limits : [] }
  }
  const limiter = deps.limiter ?? defaultLimiter
  if (deps.keys && !limiter.take(deps.keys)) return offline()

  let raw: unknown
  try {
    raw = await (deps.callModel ?? anthropicCall)({ system: PROPOSE_SYSTEM, content: describeHero(input), schema: proposalSchema() })
  } catch {
    return offline()
  }
  const answer = readProposal(raw)
  const roleId = isRoleId(answer.roleId) ? answer.roleId : input.roleId
  const base = proposeBuild({ ...input, roleId }).build
  const slots = { ...base.slots }
  for (const slot of BUILD_SLOTS) {
    const id = answer.templates[slot]
    const inPool = id && poolFor(base.roleId, SLOT_KIND[slot]).some((t) => t.id === id)
    const clash = slot === 'active2' && id === slots.active1.templateId
    if (inPool && !clash) slots[slot] = { ...slots[slot], templateId: id }
  }
  const build: Build = { ...base, slots }
  if (answer.spread) {
    const allocated = allocate(build, answer.spread)
    if (allocated.ok) return { build: allocated.build, offline: false, limits: allocated.limits }
  }
  return { build, offline: false, limits: [] }
}

const CHAT_SYSTEM = `A player is adjusting a hero in a 3D arena brawler by chat. Translate their request into stat wishes.
You never set numbers. For each secondary stat they mention, answer "max", "more" or "less".
Stats: ${SECONDARY_STATS.join(', ')}.
If they ask to change how the hero takes part in fights, also answer a role (${ROLE_IDS.join(', ')}); otherwise null.`

const chatSchema = (): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  required: ['goals', 'roleId'],
  properties: {
    goals: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(SECONDARY_STATS.map((s) => [s, { type: 'string', enum: ['max', 'more', 'less'] }])),
    },
    roleId: { anyOf: [{ type: 'string', enum: [...ROLE_IDS] }, { type: 'null' }] },
  },
})

export interface ChatResult {
  build: Build
  offline: boolean
  /** False when nothing in the message could be turned into an edit; the build is unchanged. */
  understood: boolean
  limits: LimitHit[]
}

function readGoals(raw: unknown): { goals: Partial<Record<SecondaryStat, StatGoal>>; roleId?: string } {
  const value = (raw ?? {}) as Record<string, unknown>
  const goalsRaw = (value.goals ?? {}) as Record<string, unknown>
  const goals: Partial<Record<SecondaryStat, StatGoal>> = {}
  for (const stat of SECONDARY_STATS) {
    const g = goalsRaw[stat]
    if (g === 'max' || g === 'more' || g === 'less') goals[stat] = g
  }
  return { goals, roleId: typeof value.roleId === 'string' ? value.roleId : undefined }
}

/** Apply a chat request such as "more agile, less armor" (R13, AE2). */
export async function chatEdit(build: Build, message: string, deps: ProposeDeps = {}): Promise<ChatResult> {
  if (message.length > MAX_CHAT) throw new InputError('message too long')
  let offline = false
  let wishes: { goals: Partial<Record<SecondaryStat, StatGoal>>; roleId?: string }
  const limiter = deps.limiter ?? defaultLimiter
  try {
    if (deps.keys && !limiter.take(deps.keys)) throw new Error('rate limited')
    wishes = readGoals(await (deps.callModel ?? anthropicCall)({ system: CHAT_SYSTEM, content: [{ type: 'text', text: message }], schema: chatSchema() }))
  } catch {
    offline = true
    wishes = { goals: parseStatWishes(message) }
  }
  let current = build
  if (isRoleId(wishes.roleId) && wishes.roleId !== build.roleId) {
    const changed = changeRole(current, wishes.roleId)
    current = changed.ok ? allocateDefault(changed.build) : current
  }
  if (!Object.keys(wishes.goals).length) return { build: current, offline, understood: current !== build, limits: [] }
  const result = requestStats(current, wishes.goals)
  return result.ok ? { build: result.build, offline, understood: true, limits: result.limits } : { build, offline, understood: false, limits: [] }
}

function allocateDefault(build: Build): Build {
  const result = allocate(build, proposedSpread(build.roleId))
  return result.ok ? result.build : build
}
