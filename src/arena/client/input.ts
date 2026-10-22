import { BUILD_SLOTS } from '../../charter/build'
import type { BuildSlot } from '../../charter/types'
import { AIM_STEPS, slotBit, type Command } from '../engine/state'

/**
 * Keyboard and mouse (U17, KTD16). WASD moves relative to the camera, Space flies up, Z flies down, Shift fires the
 * movement skill; the mouse aims; left click is the basic attack, Q and E the actives, R the ultimate. No binding uses
 * Ctrl or Alt, which browsers reserve (Ctrl+W closes the tab; Ctrl+click is a right-click on a Mac).
 */

export const BINDINGS: Record<string, BuildSlot | 'up' | 'down' | 'forward' | 'back' | 'left' | 'right'> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'up',
  KeyZ: 'down',
  ShiftLeft: 'movement',
  ShiftRight: 'movement',
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
  return { moveX, moveZ, vertical: held('up') ? 1 : held('down') ? -1 : 0, aimYaw: steps(cameraYaw), aimPitch: steps(cameraPitch), buttons }
}
