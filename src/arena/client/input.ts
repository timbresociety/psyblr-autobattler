import { BUILD_SLOTS } from '../../charter/build.js'
import type { BuildSlot } from '../../charter/types.js'
import { AIM_STEPS, MOVES, slotBit, type Command } from '../engine/state.js'

/**
 * Keyboard and mouse, as the canon binds them (docs/plans/2026-10-31-canon-psyblr-human.md). WASD moves relative to the
 * camera; V jumps (again in the air for the double jump); Z rolls along the facing; Shift tapped dashes and held
 * sprints; C crouches (at a run it slides) and Ctrl lies prone, each again to stand; Space strikes (tapped, chaining
 * into a combo) or charges a heavy blow (held, let go to land it); X guards; left click is Skill 1, Q Skill 2, E the
 * movement skill, F turns the passive on and off, R the ultimate; the right button held zooms to first person (the
 * camera's, not the engine's). Pointer lock holds the mouse in a fight, so Ctrl+click never reaches the page.
 */

export type Action = BuildSlot | 'jump' | 'dash' | 'crouch' | 'prone' | 'dodge' | 'block' | 'zoom' | 'forward' | 'back' | 'left' | 'right'

export const BINDINGS: Record<string, Action> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  KeyV: 'jump',
  KeyZ: 'dodge',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyC: 'crouch',
  ControlLeft: 'prone',
  Space: 'basic',
  KeyX: 'block',
  Mouse0: 'active1',
  KeyQ: 'active2',
  KeyE: 'movement',
  KeyF: 'passive',
  KeyR: 'ultimate',
  Mouse2: 'zoom',
}

export interface InputState {
  held: Set<string>
}

const TAU = Math.PI * 2
const steps = (a: number) => (((Math.round((a / TAU) * AIM_STEPS) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS)

/** The engine command for this tick from what is held and where the camera looks. The aim is the crosshair's, no assist (R16). */
export function commandFrom(input: InputState, cameraYaw: number, cameraPitch: number, aim?: { yaw: number; pitch: number }): Command {
  const held = (action: string) => Object.entries(BINDINGS).some(([code, a]) => a === action && input.held.has(code))
  const f = (held('forward') ? 1 : 0) - (held('back') ? 1 : 0)
  const r = (held('right') ? 1 : 0) - (held('left') ? 1 : 0)
  // forward is along the camera's yaw (0 = +z); right is a quarter turn clockwise from it
  const moveX = Math.sin(cameraYaw) * f - Math.cos(cameraYaw) * r
  const moveZ = Math.cos(cameraYaw) * f + Math.sin(cameraYaw) * r
  let buttons = 0
  for (const slot of BUILD_SLOTS) if (held(slot)) buttons |= slotBit(slot)
  const moves = (['jump', 'dash', 'crouch', 'prone', 'dodge', 'block'] as const).reduce((bits, move) => bits | (held(move) ? MOVES[move] : 0), 0)
  // the aim is where the crosshair points (aim.ts) when it's known, else straight along the camera
  return { moveX, moveZ, moves, aimYaw: steps(aim?.yaw ?? cameraYaw), aimPitch: steps(aim?.pitch ?? cameraPitch), buttons }
}
