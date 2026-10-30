import { BUILD_SLOTS } from '../../charter/build.js'
import type { BuildSlot } from '../../charter/types.js'
import { AIM_STEPS, MOVES, slotBit, type Command } from '../engine/state.js'

/**
 * Keyboard and mouse (U17, KTD16; Forge goal, phase 2). WASD moves relative to the camera, Space jumps (and again in
 * the air), Shift dashes, C slides at a run, F fires the movement skill; the mouse aims; left click is the basic
 * attack, Q and E the actives, R the ultimate. No binding uses Ctrl or Alt, which browsers reserve (Ctrl+W closes the
 * tab; Ctrl+click is a right-click on a Mac).
 */

export const BINDINGS: Record<string, BuildSlot | 'jump' | 'dash' | 'crouch' | 'forward' | 'back' | 'left' | 'right'> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyC: 'crouch',
  KeyF: 'movement',
  KeyQ: 'active1',
  KeyE: 'active2',
  KeyR: 'ultimate',
  Mouse0: 'basic',
}

export interface InputState {
  held: Set<string>
}

const TAU = Math.PI * 2
const steps = (a: number) => (((Math.round((a / TAU) * AIM_STEPS) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS)

/** The engine command for this tick from what is held and where the camera looks. The aim is the camera's, no assist (R16). */
export function commandFrom(input: InputState, cameraYaw: number, cameraPitch: number): Command {
  const held = (action: string) => Object.entries(BINDINGS).some(([code, a]) => a === action && input.held.has(code))
  const f = (held('forward') ? 1 : 0) - (held('back') ? 1 : 0)
  const r = (held('right') ? 1 : 0) - (held('left') ? 1 : 0)
  // forward is along the camera's yaw (0 = +z); right is a quarter turn clockwise from it
  const moveX = Math.sin(cameraYaw) * f - Math.cos(cameraYaw) * r
  const moveZ = Math.cos(cameraYaw) * f + Math.sin(cameraYaw) * r
  let buttons = 0
  for (const slot of BUILD_SLOTS) if (slot !== 'passive' && held(slot)) buttons |= slotBit(slot)
  const moves = (held('jump') ? MOVES.jump : 0) | (held('dash') ? MOVES.dash : 0) | (held('crouch') ? MOVES.crouch : 0)
  return { moveX, moveZ, moves, aimYaw: steps(cameraYaw), aimPitch: steps(cameraPitch), buttons }
}
