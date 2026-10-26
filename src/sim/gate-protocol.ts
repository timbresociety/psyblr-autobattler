import type { Build } from '../charter/build.js'
import { runGate, scoreVsField, type GateOptions, type GateOutcome } from './gate.js'

/** The message the creator posts to the gate worker, and the pure handler both the worker and tests use. */
export interface GateRequest {
  build: Build
  options?: GateOptions
}

export function handleGateMessage(request: GateRequest): GateOutcome {
  return runGate(request.build, request.options)
}

/** One worker's share of a measurement: some turns of the field for one build. */
export interface SliceRequest {
  slice: number
  build: Build
  turns: number[]
  options?: GateOptions
}

export interface SliceResult {
  slice: number
  score: number
  fights: number
}

export function handleSliceMessage(request: SliceRequest): SliceResult {
  return { slice: request.slice, ...scoreVsField(request.build, request.options, request.turns) }
}
