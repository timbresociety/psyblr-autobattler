import { ENGINE } from '../../../arena/engine/calibration'
import { AIM_STEPS, IDLE, MOVES, slotBit, type Command } from '../../../arena/engine/state'
import type { BuildSlot } from '../../../charter/types'

/**
 * The Forge's kit reel (the canon, 2026-11-02): each of the hero's moves played on a training dummy in the arena, one
 * take at a time and over again, so a player sees what it looks like on the battlefield. A take stands the hero `gap`
 * metres from the dummy, facing it, and presses what a player would press, second by second.
 */
export interface Take {
  key: string
  label: string
  /** What a player presses for it. */
  keys: string
  /** Metres between the hero and the dummy. */
  gap: number
  /** Seconds before it plays again. */
  seconds: number
  /** What is pressed `t` seconds in: slots held, and movement buttons held. */
  press: (t: number) => { slots?: readonly BuildSlot[]; moves?: number }
}

const within = (t: number, from: number, to: number) => t >= from && t < to
const tap = (t: number, at: number) => within(t, at, at + 0.06)

export const TAKES: readonly Take[] = [
  { key: 'combo', label: 'Melee combo', keys: 'Tap Space ×3', gap: 1.7, seconds: 3.2, press: (t) => ({ slots: [0.2, 0.75, 1.3].some((at) => tap(t, at)) ? ['basic'] : [] }) },
  { key: 'heavy', label: 'Heavy blow', keys: 'Hold Space, let go', gap: 1.7, seconds: 3.4, press: (t) => ({ slots: within(t, 0.2, 0.2 + ENGINE.melee.heavyHold + ENGINE.melee.chargeFull) ? ['basic'] : [] }) },
  { key: 'ranged', label: 'Ranged shots', keys: 'Hold left click', gap: 10, seconds: 3.2, press: (t) => ({ slots: within(t, 0.3, 2.6) ? ['active1'] : [] }) },
  { key: 'block', label: 'Block', keys: 'Hold X', gap: 2.5, seconds: 2.8, press: (t) => ({ moves: within(t, 0.3, 2.3) ? MOVES.block : 0 }) },
  { key: 'active2', label: 'Skill 2', keys: 'Q', gap: 7, seconds: 3.2, press: (t) => ({ slots: tap(t, 0.3) ? ['active2'] : [] }) },
  { key: 'ultimate', label: 'Ultimate', keys: 'R', gap: 6, seconds: 4.2, press: (t) => ({ slots: tap(t, 0.3) ? ['ultimate'] : [] }) },
  { key: 'passive', label: 'Passive on and off', keys: 'F', gap: 4, seconds: 3.2, press: (t) => ({ slots: tap(t, 0.3) || tap(t, 1.8) ? ['passive'] : [] }) },
  { key: 'movement', label: 'Movement skill', keys: 'E', gap: 10, seconds: 2.6, press: (t) => ({ slots: tap(t, 0.4) ? ['movement'] : [] }) },
]

/** Where the camera watches a take from: over the hero's shoulder, side on, and from behind the dummy. */
export const POVS = [
  { key: 'shoulder', label: 'Over the shoulder' },
  { key: 'side', label: 'Side on' },
  { key: 'facing', label: "The dummy's view" },
] as const
export type Pov = (typeof POVS)[number]['key']

const steps = (a: number) => (((Math.round((a / (Math.PI * 2)) * AIM_STEPS) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS)

/** The command a take gives `t` seconds in, aimed `yaw` (radians) at the dummy. */
export function takeCommand(take: Take, t: number, yaw: number): Command {
  const { slots = [], moves = 0 } = take.press(t)
  return { ...IDLE, moves, aimYaw: steps(yaw), aimPitch: 0, buttons: slots.reduce((bits, s) => bits | slotBit(s), 0) }
}
