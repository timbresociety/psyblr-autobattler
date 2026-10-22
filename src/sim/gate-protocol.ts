import type { Build } from '../charter/build'
import { runGate, type GateOptions, type GateOutcome } from './gate'

/** The message the creator posts to the gate worker, and the pure handler both the worker and tests use. */
export interface GateRequest {
  build: Build
  options?: GateOptions
}

export function handleGateMessage(request: GateRequest): GateOutcome {
  return runGate(request.build, request.options)
}
