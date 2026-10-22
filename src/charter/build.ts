import { matchTemplate, nearestAlternatives } from './match'
import { ROLE_IDS, getRole, isRoleId } from './roles'
import { ATTRIBUTES, ATTRIBUTE_GAINS, POOL_SIZE, deriveSheet, spentPoints, validateSpread } from './stats'
import { hasTemplate, poolFor } from './templates/catalog'
import type { Attribute, BuildSlot, LimitHit, RoleId, SecondaryStat, SlotKind, Spread, Template } from './types'

/**
 * Build operations (U5). Every edit goes through these functions and returns a new valid Build or a typed
 * rejection that names the limit. Player input never carries a power number (R4); only the gate writes
 * retune steps (KTD7).
 */

export const BUILD_SLOTS: readonly BuildSlot[] = ['basic', 'active1', 'active2', 'passive', 'ultimate', 'movement']

export const SLOT_KIND: Record<BuildSlot, SlotKind> = {
  basic: 'basic',
  active1: 'active',
  active2: 'active',
  passive: 'passive',
  ultimate: 'ultimate',
  movement: 'movement',
}

export const TEXT_LIMITS = { heroName: 60, name: 40, flavour: 280, visual: 200 } as const

export interface SkillSpec {
  /** The player's skill name (R3). */
  name: string
  /** The player's description; the matcher reads it (R5). */
  flavour: string
  /** The player's visual direction: animation, aura, VFX (R3). */
  visual: string
  templateId: string
  /** True once the player picked this template by hand (R7). */
  swapped: boolean
  /** Written only by the balance gate (KTD7). */
  retuneSteps: number
}

export type GateState = 'draft' | 'checking' | 'ready' | 'blocked'

export interface GateResult {
  state: GateState
  winRate?: number
  catalogVersion?: number
  calibrationVersion?: number
  strongestSlot?: BuildSlot
}

export interface Build {
  heroId?: string
  heroName: string
  roleId: RoleId
  slots: Record<BuildSlot, SkillSpec>
  spread: Spread
  gate: GateResult
}

export type SkillText = Partial<Pick<SkillSpec, 'name' | 'flavour' | 'visual'>>

export type OpResult = { ok: true; build: Build; limits: LimitHit[]; needsConfirm?: boolean } | { ok: false; build: Build; errors: LimitHit[] }

const DRAFT: GateResult = { state: 'draft' }

const ok = (build: Build, limits: LimitHit[] = []): OpResult => ({ ok: true, build: { ...build, gate: DRAFT }, limits })
const reject = (build: Build, errors: LimitHit[]): OpResult => ({ ok: false, build, errors })

const describe = (spec: Pick<SkillSpec, 'name' | 'flavour'>) => `${spec.name} ${spec.flavour}`.trim()

function pickTemplates(roleId: RoleId, skills: Partial<Record<BuildSlot, Pick<SkillSpec, 'name' | 'flavour'>>>): Record<BuildSlot, Template> {
  const picks = {} as Record<BuildSlot, Template>
  for (const slot of BUILD_SLOTS) {
    const exclude = slot === 'active2' ? [picks.active1.id] : []
    picks[slot] = matchTemplate(roleId, SLOT_KIND[slot], describe(skills[slot] ?? { name: '', flavour: '' }), exclude).template
  }
  return picks
}

const ROLE_WORDS: Record<RoleId, string[]> = {
  tank: ['tank', 'armor', 'armored', 'defend', 'giant', 'wall', 'fortress', 'tough', 'guardian'],
  fighter: ['fighter', 'martial', 'brawler', 'warrior', 'punch', 'sword', 'saiyan', 'pirate'],
  assassin: ['assassin', 'ninja', 'stealth', 'shadow', 'dagger', 'rogue', 'kill'],
  mage: ['mage', 'wizard', 'magic', 'spell', 'sorcerer', 'witch', 'genius', 'scientist'],
  marksman: ['marksman', 'sniper', 'gun', 'rifle', 'archer', 'bow', 'shooter'],
  support: ['support', 'healer', 'heal', 'medic', 'priest', 'protect', 'allies', 'team'],
}

/** Offline role assignment (R9): the role whose pools best fit all the descriptions. Claude does this online. */
export function inferRole(heroName: string, skills: Partial<Record<BuildSlot, Pick<SkillSpec, 'name' | 'flavour'>>>): RoleId {
  const text = [heroName, ...Object.values(skills).map((s) => (s ? describe(s) : ''))].join(' ').toLowerCase()
  let best: { role: RoleId; score: number } = { role: 'fighter', score: 0 }
  for (const role of ROLE_IDS) {
    let score = ROLE_WORDS[role].filter((w) => text.includes(w)).length * 2
    for (const slot of BUILD_SLOTS) {
      const skill = skills[slot]
      if (skill) score += matchTemplate(role, SLOT_KIND[slot], describe(skill)).score
    }
    if (score > best.score) best = { role, score }
  }
  return best.role
}

export interface ProposalInput {
  heroName: string
  roleId?: RoleId
  skills: Partial<Record<BuildSlot, { name: string; flavour: string; visual?: string }>>
  spread?: Spread
}

/** The engine's first proposal for a new hero (F1): role, a template per slot and the role's default spread. */
export function proposeBuild(input: ProposalInput): OpResult {
  const roleId = input.roleId ?? inferRole(input.heroName, input.skills)
  const role = getRole(roleId)
  const picks = pickTemplates(roleId, input.skills)
  const slots = {} as Record<BuildSlot, SkillSpec>
  for (const slot of BUILD_SLOTS) {
    const skill = input.skills[slot]
    slots[slot] = {
      name: (skill?.name ?? '').slice(0, TEXT_LIMITS.name),
      flavour: (skill?.flavour ?? '').slice(0, TEXT_LIMITS.flavour),
      visual: (skill?.visual ?? '').slice(0, TEXT_LIMITS.visual),
      templateId: picks[slot].id,
      swapped: false,
      retuneSteps: 0,
    }
  }
  const build: Build = { heroName: input.heroName.slice(0, TEXT_LIMITS.heroName), roleId, slots, spread: { ...role.defaultSpread }, gate: DRAFT }
  if (input.spread) return allocate(build, input.spread)
  return ok(build)
}

/** Stat-cap notes for secondary stats that sit at their ceiling under this spread. */
function statCaps(build: Build, spread: Spread): LimitHit[] {
  const role = getRole(build.roleId)
  const { sheet, capped } = deriveSheet(role, spread)
  return capped.map((stat) => ({ reason: 'stat-cap' as const, field: stat, requested: sheet[stat], allowed: role.caps[stat] }))
}

/** Replace the whole spread. Over the pool or a cap is rejected; the build stays as it was (AE4). */
export function allocate(build: Build, spread: Spread): OpResult {
  const check = validateSpread(getRole(build.roleId), spread)
  if (!check.ok) return reject(build, check.errors)
  return ok({ ...build, spread: { ...spread } }, statCaps(build, spread))
}

/** Set one attribute, clamped to its cap and to the points left in the pool (the drag path, R14). */
export function setAttribute(build: Build, attr: Attribute, value: number): OpResult {
  const role = getRole(build.roleId)
  const limits: LimitHit[] = []
  let next = Math.max(0, Math.round(value))
  if (next > role.attributeCaps[attr]) {
    limits.push({ reason: 'attribute-cap', field: attr, requested: next, allowed: role.attributeCaps[attr] })
    next = role.attributeCaps[attr]
  }
  const others = spentPoints(build.spread) - build.spread[attr]
  if (others + next > POOL_SIZE) {
    limits.push({ reason: 'pool-exceeded', field: 'pool', requested: others + next, allowed: POOL_SIZE })
    next = POOL_SIZE - others
  }
  const spread = { ...build.spread, [attr]: next }
  return ok({ ...build, spread }, [...limits, ...statCaps(build, spread)])
}

/**
 * Drag one detailed stat toward a value (R14, AE4). Points are still spent on core attributes (KTD3), so this
 * searches every legal spread (a few hundred) for the one closest to the target that changes the other stats
 * least. If the target is out of reach, the closest reachable value is used and the limit is named.
 */
export function setStatTarget(build: Build, stat: SecondaryStat, target: number): OpResult {
  const role = getRole(build.roleId)
  const current = deriveSheet(role, build.spread).sheet
  const caps = role.attributeCaps
  let best: { spread: Spread; score: number; value: number } | undefined
  for (let s = 0; s <= Math.min(caps.strength, POOL_SIZE); s++) {
    for (let a = 0; a <= Math.min(caps.agility, POOL_SIZE - s); a++) {
      const i = Math.min(caps.intellect, POOL_SIZE - s - a)
      const spread = { strength: s, agility: a, intellect: i }
      const sheet = deriveSheet(role, spread).sheet
      const miss = Math.abs(sheet[stat] - target) / role.caps[stat]
      let drift = 0
      for (const other of Object.keys(sheet) as SecondaryStat[]) if (other !== stat) drift += Math.abs(sheet[other] - current[other]) / role.caps[other]
      const score = miss * 100 + drift
      if (!best || score < best.score - 1e-9) best = { spread, score, value: sheet[stat] }
    }
  }
  if (!best) return ok(build)
  const limits: LimitHit[] = []
  if (Math.abs(best.value - target) > Math.max(0.01, role.caps[stat] * 0.01)) {
    limits.push({ reason: target > role.caps[stat] ? 'stat-cap' : 'pool-exceeded', field: stat, requested: target, allowed: best.value })
  }
  return ok({ ...build, spread: best.spread }, limits)
}

export type StatGoal = 'max' | 'more' | 'less'

/** How much one point in each attribute moves a stat for this role, relative to the stat's cap. */
function affinity(roleId: RoleId, stat: SecondaryStat, attr: Attribute): number {
  const role = getRole(roleId)
  return ((ATTRIBUTE_GAINS[attr][stat] ?? 0) * role.weights[attr]) / role.caps[stat]
}

const MOVE_STEP = 4

/**
 * Turn stat wishes into a spread (the chat path, AE2). "max" refills the pool toward those stats,
 * "more"/"less" shift a few points. Points stay inside caps and the pool, and every limit hit is reported.
 */
export function requestStats(build: Build, goals: Partial<Record<SecondaryStat, StatGoal>>): OpResult {
  const role = getRole(build.roleId)
  const entries = Object.entries(goals) as [SecondaryStat, StatGoal][]
  const score = (attr: Attribute, want: StatGoal[]) =>
    entries.filter(([, g]) => want.includes(g)).reduce((sum, [stat]) => sum + affinity(build.roleId, stat, attr), 0)
  const limits: LimitHit[] = []
  let spread: Spread

  if (entries.some(([, g]) => g === 'max')) {
    spread = { strength: 0, agility: 0, intellect: 0 }
    const order = [...ATTRIBUTES].sort((a, b) => score(b, ['max', 'more']) - score(a, ['max', 'more']))
    let left = POOL_SIZE
    for (const attr of order) {
      const give = Math.min(role.attributeCaps[attr], left)
      spread[attr] = give
      left -= give
      if (give === role.attributeCaps[attr] && score(attr, ['max']) > 0) {
        limits.push({ reason: 'attribute-cap', field: attr, requested: POOL_SIZE, allowed: role.attributeCaps[attr] })
      }
    }
  } else {
    spread = { ...build.spread }
    const net = (attr: Attribute) => score(attr, ['more']) - score(attr, ['less'])
    const to = [...ATTRIBUTES].sort((a, b) => net(b) - net(a))[0]
    const from = [...ATTRIBUTES].sort((a, b) => net(a) - net(b) || spread[b] - spread[a])[0]
    if (to !== from) {
      const room = role.attributeCaps[to] - spread[to]
      const moved = Math.min(MOVE_STEP, spread[from], room)
      if (room < MOVE_STEP) limits.push({ reason: 'attribute-cap', field: to, requested: spread[to] + MOVE_STEP, allowed: role.attributeCaps[to] })
      spread[from] -= moved
      spread[to] += moved
    }
  }
  return ok({ ...build, spread }, [...limits, ...statCaps(build, spread)])
}

/** The swap options offered for a slot (R7). */
export function swapAlternatives(build: Build, slot: BuildSlot): Template[] {
  const other = slot === 'active1' ? [build.slots.active2.templateId] : slot === 'active2' ? [build.slots.active1.templateId] : []
  return nearestAlternatives(build.roleId, SLOT_KIND[slot], build.slots[slot].templateId, describe(build.slots[slot]), other)
}

/** Swap a slot to one of its offered alternatives. Anything else is rejected (R7). */
export function swapTemplate(build: Build, slot: BuildSlot, templateId: string): OpResult {
  const offered = swapAlternatives(build, slot).map((t) => t.id)
  if (!offered.includes(templateId)) return reject(build, [{ reason: 'stat-cap', field: `${slot}.templateId`, requested: 0, allowed: 0 }])
  const slots = { ...build.slots, [slot]: { ...build.slots[slot], templateId, swapped: true, retuneSteps: 0 } }
  return ok({ ...build, slots })
}

/**
 * Change role (R10, F3, AE3): every slot re-maps into the new role's pools from its own description,
 * names and visuals stay, and all points return to the pool.
 */
export function changeRole(build: Build, roleId: RoleId): OpResult {
  if (roleId === build.roleId) return ok(build)
  const picks = pickTemplates(roleId, build.slots)
  const slots = {} as Record<BuildSlot, SkillSpec>
  for (const slot of BUILD_SLOTS) slots[slot] = { ...build.slots[slot], templateId: picks[slot].id, swapped: false, retuneSteps: 0 }
  return ok({ ...build, roleId, slots, spread: { strength: 0, agility: 0, intellect: 0 } })
}

/** The spread the engine proposes for a role. */
export function proposedSpread(roleId: RoleId): Spread {
  return { ...getRole(roleId).defaultSpread }
}

/**
 * Edit a skill's name, flavour or visual direction (R3). A new flavour re-matches an unswapped slot. For a slot the
 * player swapped by hand, the template is kept and `needsConfirm` asks before replacing it, unless `replace` is set.
 */
export function editSkillText(build: Build, slot: BuildSlot, text: SkillText, replace = false): OpResult {
  const current = build.slots[slot]
  const next: SkillSpec = {
    ...current,
    name: (text.name ?? current.name).slice(0, TEXT_LIMITS.name),
    flavour: (text.flavour ?? current.flavour).slice(0, TEXT_LIMITS.flavour),
    visual: (text.visual ?? current.visual).slice(0, TEXT_LIMITS.visual),
  }
  const flavourChanged = text.flavour !== undefined && text.flavour !== current.flavour
  let needsConfirm = false
  if (flavourChanged) {
    if (current.swapped && !replace) needsConfirm = true
    else {
      const other = slot === 'active1' ? [build.slots.active2.templateId] : slot === 'active2' ? [build.slots.active1.templateId] : []
      next.templateId = matchTemplate(build.roleId, SLOT_KIND[slot], describe(next), other).template.id
      next.swapped = false
      next.retuneSteps = 0
    }
  }
  const result = ok({ ...build, slots: { ...build.slots, [slot]: next } })
  return result.ok ? { ...result, needsConfirm } : result
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '')

/**
 * Rebuild a Build from untrusted input (API bodies, storage). Only known fields survive, templates must sit in the
 * role's pool for their slot, the spread must be valid, and gate state and retune steps reset (R4).
 */
export function hydrateBuild(raw: unknown): OpResult {
  const input = (raw ?? {}) as Record<string, unknown>
  const roleId = input.roleId
  const empty = proposeBuild({ heroName: 'invalid', roleId: 'fighter', skills: {} }).build
  const fail = (field: string) => reject(empty, [{ reason: 'stat-cap', field, requested: 0, allowed: 0 }])
  if (!isRoleId(roleId)) return fail('roleId')
  const rawSlots = (input.slots ?? {}) as Record<string, Record<string, unknown> | undefined>
  const slots = {} as Record<BuildSlot, SkillSpec>
  for (const slot of BUILD_SLOTS) {
    const s = rawSlots[slot] ?? {}
    const templateId = s.templateId
    if (typeof templateId !== 'string' || !hasTemplate(templateId)) return fail(`${slot}.templateId`)
    if (!poolFor(roleId, SLOT_KIND[slot]).some((t) => t.id === templateId)) return fail(`${slot}.templateId`)
    slots[slot] = {
      name: str(s.name, TEXT_LIMITS.name),
      flavour: str(s.flavour, TEXT_LIMITS.flavour),
      visual: str(s.visual, TEXT_LIMITS.visual),
      templateId,
      swapped: s.swapped === true,
      retuneSteps: 0,
    }
  }
  if (slots.active1.templateId === slots.active2.templateId) return fail('active2.templateId')
  const rawSpread = (input.spread ?? {}) as Record<string, unknown>
  const spread = {} as Spread
  for (const attr of ATTRIBUTES) spread[attr] = typeof rawSpread[attr] === 'number' ? (rawSpread[attr] as number) : NaN
  const check = validateSpread(getRole(roleId), spread)
  if (!check.ok || ATTRIBUTES.some((a) => Number.isNaN(spread[a]))) return reject(empty, check.ok ? [{ reason: 'not-integer', field: 'spread', requested: 0, allowed: 0 }] : check.errors)
  const build: Build = {
    ...(typeof input.heroId === 'string' ? { heroId: input.heroId.slice(0, 64) } : {}),
    heroName: str(input.heroName, TEXT_LIMITS.heroName),
    roleId,
    slots,
    spread,
    gate: DRAFT,
  }
  return ok(build)
}
