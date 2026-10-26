import type { Template } from '../../charter/types'

/**
 * The motion library (R16, R17, KTD7). Every mechanic maps to 1-3 motion variants that work on any humanoid rig.
 * A motion is either a Tripo preset (retargeted by Tripo onto the hero's rig) or a clip on a Mixamo-named
 * skeleton applied by the client. Clips not yet licensed fall back to their nearest preset.
 */
export const TRIPO_PRESETS = ['idle', 'walk', 'run', 'jump', 'dive', 'climb', 'slash', 'shoot', 'hurt', 'fall', 'turn'] as const
export type Preset = (typeof TRIPO_PRESETS)[number]

export interface Motion {
  id: string
  label: string
  source: 'tripo-preset' | 'clip'
  preset?: Preset
  /** Set once a licensed clip exists; until then the motion plays its fallback preset. */
  clipUrl?: string
  fallbackPreset: Preset
}

const preset = (p: Preset, label: string): Motion => ({ id: `preset-${p}`, label, source: 'tripo-preset', preset: p, fallbackPreset: p })
const clip = (id: string, label: string, fallbackPreset: Preset): Motion => ({ id: `clip-${id}`, label, source: 'clip', fallbackPreset })

/** Locomotion every hero gets (the movement stage). */
export const MOVEMENT_SET: Motion[] = [preset('idle', 'Idle'), preset('walk', 'Walk'), preset('run', 'Run'), preset('jump', 'Jump'), preset('fall', 'Fall'), preset('turn', 'Turn')]

const BY_DELIVERY: Record<Template['delivery']['kind'], Motion[]> = {
  melee: [preset('slash', 'Slash'), clip('uppercut', 'Rising uppercut', 'slash'), clip('spin-strike', 'Spin strike', 'slash')],
  projectile: [preset('shoot', 'Shoot'), clip('cast-forward', 'One-hand cast', 'shoot'), clip('two-hand-blast', 'Two-hand blast', 'shoot')],
  beam: [clip('channel-beam', 'Channelled beam', 'shoot'), clip('two-hand-blast', 'Two-hand blast', 'shoot'), preset('shoot', 'Shoot')],
  cone: [clip('sweep-blast', 'Sweeping blast', 'shoot'), preset('slash', 'Wide slash')],
  zone: [clip('ground-slam', 'Ground slam', 'jump'), clip('raise-arms', 'Raise the storm', 'idle'), preset('slash', 'Slash')],
  aura: [clip('power-burst', 'Power burst', 'idle'), clip('spin-strike', 'Spin strike', 'slash')],
  self: [clip('power-up', 'Power up', 'idle'), clip('guard-stance', 'Guard stance', 'idle')],
  dash: [preset('dive', 'Dive'), clip('dash-strike', 'Dash strike', 'run'), preset('run', 'Sprint')],
  blink: [clip('vanish', 'Vanish and reappear', 'dive'), preset('dive', 'Dive')],
  grapple: [clip('grapple-pull', 'Grapple pull', 'climb'), preset('climb', 'Climb')],
}

const ULTIMATE_LEAD = clip('ultimate-charge', 'Charged ultimate', 'jump')

/** The 1-3 motion variants a template offers at its confirm (R17). */
export function motionsFor(template: Template): Motion[] {
  const base = BY_DELIVERY[template.delivery.kind]
  const variants = template.slot === 'ultimate' ? [ULTIMATE_LEAD, ...base] : base
  return variants.slice(0, 3)
}

/** Basic attacks follow the spec's melee or ranged style. */
export function basicMotions(style: 'melee' | 'ranged'): Motion[] {
  return style === 'ranged' ? BY_DELIVERY.projectile : BY_DELIVERY.melee
}

/** The Tripo presets a set of motions needs retargeted (clips without a licensed file use their fallback). */
export function presetsNeeded(motions: Motion[]): Preset[] {
  return [...new Set(motions.map((m) => (m.source === 'tripo-preset' ? m.preset! : m.fallbackPreset)))]
}

/** Which clip or preset the client should play for a motion. */
export function playable(motion: Motion): { kind: 'clip'; url: string } | { kind: 'preset'; preset: Preset } {
  return motion.source === 'clip' && motion.clipUrl ? { kind: 'clip', url: motion.clipUrl } : { kind: 'preset', preset: motion.source === 'tripo-preset' ? motion.preset! : motion.fallbackPreset }
}
