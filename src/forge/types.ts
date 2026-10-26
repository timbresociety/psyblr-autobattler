import type { Build } from '../charter/build'
import type { SizeClass } from '../charter/sizes'
import type { BuildSlot } from '../charter/types'

/** The stages of a forge, in order (R11). */
export type StageId = 'spec' | 'concept' | 'mesh' | 'motion' | 'active1' | 'active2' | 'ultimate' | 'stats'

export type StageStatus = 'draft' | 'generating' | 'ready' | 'approved' | 'failed'

/** One provider call inside a stage; the motion stage chains a rig step and retarget batches (KTD1). */
export interface StepState {
  name: string
  provider?: string
  taskId?: string
  status: 'pending' | 'running' | 'done' | 'failed'
  /** When a request claimed the step (ms); a claim older than the step timeout is taken over (KTD1). */
  claimedAt?: number
  outputs?: Record<string, string>
}

export interface StageState {
  id: StageId
  status: StageStatus
  /** Successful generations after the first; capped per stage (R4). */
  retriesUsed: number
  /** Successful generations so far; once there is one, every new generation spends a retry. */
  generations: number
  /** Increments on every generation start; with forge and stage it keys charges and holds. */
  attempt: number
  inputs: Record<string, unknown>
  steps: StepState[]
  /** Our own Blob URLs for this stage's outputs (KTD1). */
  artifacts: Record<string, string>
  /** Which provider served each step, for the record. */
  servedBy?: string[]
  failure?: string
}

export type Tone = 'heroic' | 'meme' | 'mixed' | 'unsure'

export interface Suggestion {
  id: string
  kind: 'outfit' | 'prop' | 'catchphrase' | 'reference' | 'skill-theme' | 'aura' | 'color'
  text: string
  reason: string
  accepted: boolean
}

export interface SkillTheme {
  slot: BuildSlot
  name: string
  theme: string
  /** The Charter template the theme maps to, so only buildable choices are offered (R10, R20). */
  templateId: string
}

export interface ContentFlags {
  realPerson: boolean
  sexual: boolean
  minors: boolean
  endorsement: boolean
}

/** What the player confirms before any visual is generated (R9). */
export interface SpecSheet {
  heroName: string
  description: string
  tone: Tone
  sizeClass: SizeClass
  silhouette: string
  signatureElements: string[]
  basicStyle: 'melee' | 'ranged'
  skills: SkillTheme[]
  passiveVisual: 'aura' | 'body-element'
  passiveElement?: string
  flags: ContentFlags
  /** Elements the content floor removed, with why (KTD10). */
  removed: { element: string; reason: string }[]
}

export interface ChatTurn {
  from: 'player' | 'director'
  text: string
}

export interface Forge {
  id: string
  accountId: string
  deviceId?: string
  version: number
  current: StageId | 'published'
  prompt: string
  referenceUrls: string[]
  referenceHeroId?: string
  spec?: SpecSheet
  build?: Build
  stages: Record<StageId, StageState>
  chat: ChatTurn[]
  publishedHeroId?: string
}

export type Transition = { ok: true; forge: Forge } | { ok: false; reason: 'retry-cap' | 'out-of-order' | 'frozen' | 'bad-status' }
