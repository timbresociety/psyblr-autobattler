import { memo, type ReactNode } from 'react'
import type { Template } from '../../../charter/types'

/**
 * Ability icons drawn by hand on a 24 px grid, one per mechanic. The kit decides which: how the skill is delivered
 * (a shot, a beam, a swing, a dash) and what it does (stuns, heals, shields). Colour comes from the chip, never the art.
 */

export const ICON_KEYS = [
  'orb', 'burst', 'beam', 'slash', 'cone', 'nova', 'zone', 'shield', 'heal', 'stun', 'slow', 'dash', 'blink', 'grapple', 'buff', 'execute', 'resize', 'push', 'star',
  // the skill library's control, debuffs, states and constructs
  'leap', 'knockup', 'pull', 'root', 'silence', 'disarm', 'sleep', 'blind', 'ground', 'fear', 'taunt', 'mark', 'shred', 'wound', 'stealth', 'unstoppable', 'cleanse', 'refresh', 'turret', 'wall', 'trap', 'field',
] as const
export type IconKey = (typeof ICON_KEYS)[number]

/** What colour family a skill reads as: its damage type, or what it does for allies. */
export type Tone = 'phys' | 'spirit' | 'heal' | 'shield' | 'move' | 'cc' | 'buff'

type Kit = Pick<Template, 'slot' | 'delivery' | 'effects'>

const has = (t: Kit, kind: Template['effects'][number]['kind']) => t.effects.some((e) => e.kind === kind)

/** Which icon each kind of control takes. */
const CONTROL_ICON = { root: 'root', silence: 'silence', disarm: 'disarm', sleep: 'sleep', blind: 'blind', grounded: 'ground', fear: 'fear', taunt: 'taunt', break: 'silence' } as const

/**
 * The icon for a skill: what it is named for, in the skill library's order. Movement and transformations win, then
 * what it leaves in the world, the states it gives, the control it lands, debuffs, and last how its damage lands.
 */
export function iconFor(t: Kit): IconKey {
  const d = t.delivery.kind
  const find = <K extends Template['effects'][number]['kind']>(kind: K) => t.effects.find((e): e is Extract<Template['effects'][number], { kind: K }> => e.kind === kind)
  if (has(t, 'resize') || has(t, 'form')) return 'resize'
  if (d === 'grapple') return 'grapple'
  if (d === 'blink') return 'blink'
  if (d === 'dash') return 'dash'
  if (d === 'leap') return 'leap'
  if (has(t, 'turret')) return 'turret'
  if (has(t, 'wall')) return 'wall'
  if (has(t, 'trap')) return 'trap'
  const state = find('state')
  if (state) return state.type === 'stealth' ? 'stealth' : state.type === 'cleanse' ? 'cleanse' : 'unstoppable'
  if (has(t, 'field')) return 'field'
  if (has(t, 'stun')) return 'stun'
  if (has(t, 'knockup')) return 'knockup'
  if (has(t, 'pull')) return 'pull'
  const control = find('control')
  if (control) return CONTROL_ICON[control.type]
  if (has(t, 'execute')) return 'execute'
  const debuff = find('debuff')
  if (debuff) return debuff.type === 'mark' ? 'mark' : debuff.type === 'wound' ? 'wound' : 'shred'
  if (has(t, 'refresh')) return 'refresh'
  if (has(t, 'damage')) {
    if (has(t, 'displace') && (d === 'projectile' || d === 'aura')) return 'push'
    if (d === 'beam') return 'beam'
    if (d === 'melee') return 'slash'
    if (d === 'cone') return 'cone'
    if (d === 'aura') return 'nova'
    if (d === 'zone') return 'zone'
    if (d === 'projectile') return t.delivery.radius ? 'burst' : 'orb'
    return 'burst'
  }
  if (has(t, 'heal')) return 'heal'
  if (has(t, 'shield')) return 'shield'
  // a self-cast that moves the hero is a step out of sight
  if (has(t, 'mobility')) return 'blink'
  if (has(t, 'slow')) return 'slow'
  const buffs = t.effects.flatMap((e) => (e.kind === 'buff' ? [e] : []))
  if (buffs.length) {
    if (buffs.every((b) => b.stat === 'damageReduction')) return 'shield'
    if (buffs.every((b) => b.stat === 'moveSpeed')) return 'dash'
    return 'buff'
  }
  if (has(t, 'displace')) return 'push'
  return t.slot === 'ultimate' ? 'star' : 'orb'
}

const CONTROL_KINDS = new Set<Template['effects'][number]['kind']>(['stun', 'slow', 'knockup', 'pull', 'control', 'debuff'])

export function toneFor(t: Kit): Tone {
  const damage = t.effects.find((e) => e.kind === 'damage')
  if (damage) return damage.type === 'physical' ? 'phys' : 'spirit'
  if (has(t, 'heal')) return 'heal'
  if (has(t, 'shield') || has(t, 'state')) return 'shield'
  if (has(t, 'mobility') || ['dash', 'blink', 'grapple', 'leap'].includes(t.delivery.kind)) return 'move'
  if (t.effects.some((e) => CONTROL_KINDS.has(e.kind))) return 'cc'
  return 'buff'
}

const round = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none', stroke: 'currentColor' } as const

const ART: Record<IconKey, ReactNode> = {
  orb: (
    <>
      <path d="M11.4 6.2 17.8 12.6 3 21z" opacity=".45" />
      <circle cx="15.2" cy="8.8" r="5.2" />
      <circle cx="16.8" cy="7.2" r="1.7" fill="#fff" opacity=".55" />
    </>
  ),
  burst: (
    <>
      <path d="M12 1.5l1.76 6.25 4.32-1.83-1.83 4.32L22.5 12l-6.25 1.76 1.83 4.32-4.32-1.83L12 22.5l-1.76-6.25-4.32 1.83 1.83-4.32L1.5 12l6.25-1.76-1.83-4.32 4.32 1.83z" />
      <circle cx="12" cy="12" r="3" fill="#fff" opacity=".5" />
    </>
  ),
  beam: (
    <g transform="rotate(-35 12 12)">
      <path d="M7 8.8h13.6a3.2 3.2 0 0 1 0 6.4H7z" opacity=".5" />
      <path d="M8 12h14" {...round} strokeWidth="1.8" />
      <circle cx="6" cy="12" r="4.4" />
    </g>
  ),
  slash: (
    <g {...round}>
      <path d="M5 20C9 13 13 8.5 20 4" strokeWidth="2.8" />
      <path d="M3.5 14.5C6.5 10.5 9.5 7.5 14 5" strokeWidth="2" opacity=".7" />
      <path d="M10 21.5c3.5-4.5 6.5-8 11.5-11" strokeWidth="2" opacity=".7" />
    </g>
  ),
  cone: (
    <>
      <path d="M3 12 20.5 4.2a19.2 19.2 0 0 1 0 15.6z" opacity=".45" />
      <path d="M3 12 20.5 4.2M3 12l17.5 7.8M13.96 7.12a12 12 0 0 1 0 9.76" {...round} strokeWidth="2" />
      <circle cx="3.6" cy="12" r="2.2" />
    </>
  ),
  nova: (
    <>
      <circle cx="12" cy="12" r="3.4" />
      <circle cx="12" cy="12" r="7" {...round} strokeWidth="2" />
      <path d="M12 1.6v2.4M12 20v2.4M1.6 12H4M20 12h2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" {...round} strokeWidth="2" />
    </>
  ),
  zone: (
    <>
      <ellipse cx="12" cy="17.6" rx="9.5" ry="4" {...round} strokeWidth="2" />
      <ellipse cx="12" cy="17.6" rx="4.4" ry="1.7" opacity=".6" />
      <path d="M12 2.5v10M8 9l4 4.5L16 9" {...round} strokeWidth="2.6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2 20.5 5.2v6.1c0 5.3-3.6 9.2-8.5 10.7-4.9-1.5-8.5-5.4-8.5-10.7V5.2z" />
      <path d="M12 5.4v13.3c3-1.3 5.2-4 5.2-7.6V7.4z" fill="#fff" opacity=".35" />
    </>
  ),
  heal: (
    <>
      <path d="M9.2 3h5.6v6.2H21v5.6h-6.2V21H9.2v-6.2H3V9.2h6.2z" />
      <path d="M10.6 4.4h1.6v6.2H10.6z" fill="#fff" opacity=".4" />
    </>
  ),
  stun: <path d="M13.8 1.8 4.6 13.4h6.2l-1.4 8.8 10-12.4h-6.3z" />,
  slow: (
    <>
      <path d="M6 2.5h12M6 21.5h12" {...round} strokeWidth="2.4" />
      <path d="M7.5 2.5c0 4.8 4.5 6.2 4.5 9.5s-4.5 4.7-4.5 9.5M16.5 2.5c0 4.8-4.5 6.2-4.5 9.5s4.5 4.7 4.5 9.5" {...round} strokeWidth="2" />
      <path d="M9.2 19.8c.6-2 1.8-2.8 2.8-3.4 1 .6 2.2 1.4 2.8 3.4zM10 6.4h4c-.5 1-1.2 1.6-2 2.2-.8-.6-1.5-1.2-2-2.2z" />
    </>
  ),
  dash: (
    <>
      <path d="M2.5 7.5h5.5M1.5 12h7M2.5 16.5h5.5" {...round} strokeWidth="2.2" opacity=".7" />
      <path d="M10 4.5 21 12l-11 7.5 3-7.5z" />
    </>
  ),
  blink: (
    <>
      <circle cx="5" cy="18.5" r="2.4" opacity=".6" />
      <path d="M7 15.4C8.2 10.8 11 8.6 14.2 8" {...round} strokeWidth="2" strokeDasharray="1.6 2.6" />
      <path d="M18 2.5l1.4 4.1 4.1 1.4-4.1 1.4-1.4 4.1-1.4-4.1-4.1-1.4 4.1-1.4z" />
    </>
  ),
  grapple: (
    <>
      <path d="M2.8 2.8 9 9" {...round} strokeWidth="2" strokeDasharray="2 2.2" />
      <circle cx="10.6" cy="8.4" r="2.1" />
      <path d="M10.6 10.5v5a4.6 4.6 0 0 0 9.2 0v-1.6" {...round} strokeWidth="2.6" />
      <path d="M17 13.6 20.2 10.8l1.9 4z" />
    </>
  ),
  buff: (
    <g {...round} strokeWidth="2.8">
      <path d="M5 11.5l7-7 7 7" />
      <path d="M5 19l7-7 7 7" opacity=".6" />
    </g>
  ),
  execute: <path fillRule="evenodd" d="M12 2.5c-4.7 0-8.3 3.4-8.3 8 0 2.8 1.3 4.9 3.3 6.1V20c0 .8.6 1.5 1.5 1.5h7c.9 0 1.5-.7 1.5-1.5v-3.4c2-1.2 3.3-3.3 3.3-6.1 0-4.6-3.6-8-8.3-8zM8.6 9.4a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zm6.8 0a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zM12 14.3l-1.4 2.4h2.8z" />,
  resize: (
    <>
      <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6M3.5 3.5 8.5 8.5M20.5 3.5l-5 5M3.5 20.5l5-5M20.5 20.5l-5-5" {...round} strokeWidth="2.4" />
      <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="1" />
    </>
  ),
  push: (
    <>
      <path d="M2.5 12h10M9.5 7.5 14 12l-4.5 4.5" {...round} strokeWidth="2.6" />
      <path d="M17 4.5a10.5 10.5 0 0 1 0 15M20.5 2.5a13.5 13.5 0 0 1 0 19" {...round} strokeWidth="2" opacity=".75" />
    </>
  ),
  star: <path d="M12 1.8l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.6l-6.3 3.6 1.5-7.1-5.4-4.9 7.2-.8z" />,
  leap: (
    <>
      <path d="M3 19.5C5 9.5 14 5 21 9.5" {...round} strokeWidth="2.2" strokeDasharray="2 2.4" />
      <path d="M16.2 5.4 21.6 9.8l-6.4 2.4z" />
      <ellipse cx="4.5" cy="20.5" rx="3" ry="1.2" opacity=".6" />
    </>
  ),
  knockup: (
    <>
      <path d="M12 21V6M6.5 11.5 12 6l5.5 5.5" {...round} strokeWidth="2.8" />
      <path d="M4 21.5h16" {...round} strokeWidth="2" opacity=".6" />
      <path d="M7 3h10" {...round} strokeWidth="2" opacity=".6" />
    </>
  ),
  pull: (
    <>
      <path d="M5 4v7a7 7 0 0 0 14 0V4" {...round} strokeWidth="3" />
      <path d="M2.8 4h4.4M16.8 4h4.4" {...round} strokeWidth="3" />
      <path d="M12 21v-5M9.5 18.5 12 16l2.5 2.5" {...round} strokeWidth="1.8" opacity=".7" />
    </>
  ),
  root: (
    <g {...round} strokeWidth="2.4">
      <path d="M12 2.5v10M12 12.5c-2.5 2-5 2.2-8 4.5M12 12.5c2.5 2 5 2.2 8 4.5M12 12.5v9M8 16.5c-1 2-1 3.5-1 5M16 16.5c1 2 1 3.5 1 5" />
    </g>
  ),
  silence: (
    <>
      <path d="M4 8.5h4l5-4.5v16l-5-4.5H4z" />
      <path d="M16 8.5l5.5 7M21.5 8.5l-5.5 7" {...round} strokeWidth="2.4" />
    </>
  ),
  disarm: (
    <>
      <path d="M14.5 3.5 20.5 3.5 20.5 9.5 12 18 6 12z" opacity=".55" />
      <path d="M8.5 15.5 4 20M5.5 13l5.5 5.5" {...round} strokeWidth="2.4" />
      <path d="M3 3l18 18" {...round} strokeWidth="2.6" />
    </>
  ),
  sleep: (
    <g {...round} strokeWidth="2.4">
      <path d="M3.5 11h6l-6 7h6" />
      <path d="M13 4.5h4.5L13 9.5h4.5" strokeWidth="2" />
      <path d="M17.5 14h3.5l-3.5 4h3.5" strokeWidth="1.8" opacity=".75" />
    </g>
  ),
  blind: (
    <>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" opacity=".45" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M3.5 3.5l17 17" {...round} strokeWidth="2.6" />
    </>
  ),
  ground: (
    <>
      <path d="M12 2.5v12M6.5 9 12 14.5 17.5 9" {...round} strokeWidth="2.8" />
      <path d="M2.5 19h19" {...round} strokeWidth="2.6" />
      <path d="M5 22h3M10.5 22h3M16 22h3" {...round} strokeWidth="1.6" opacity=".6" />
    </>
  ),
  fear: (
    <>
      <path d="M12 2.5c-4.4 0-7.5 3.3-7.5 7.6v9.4l2.5-1.6 2.5 1.6L12 17.9l2.5 1.6 2.5-1.6 2.5 1.6v-9.4c0-4.3-3.1-7.6-7.5-7.6z" />
      <ellipse cx="9.2" cy="10" rx="1.4" ry="2" fill="#000" opacity=".55" />
      <ellipse cx="14.8" cy="10" rx="1.4" ry="2" fill="#000" opacity=".55" />
      <ellipse cx="12" cy="14.4" rx="1.4" ry="1.8" fill="#000" opacity=".55" />
    </>
  ),
  taunt: (
    <>
      <path d="M3 9h4.5l6-5v16l-6-5H3z" />
      <path d="M16.5 7.5a6.5 6.5 0 0 1 0 9M19.5 5a10 10 0 0 1 0 14" {...round} strokeWidth="2" />
    </>
  ),
  mark: (
    <>
      <circle cx="12" cy="12" r="7.6" {...round} strokeWidth="2.2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" {...round} strokeWidth="2.2" />
    </>
  ),
  shred: (
    <>
      <path d="M12 2 20.5 5.2v6.1c0 5.3-3.6 9.2-8.5 10.7-4.9-1.5-8.5-5.4-8.5-10.7V5.2z" opacity=".5" />
      <path d="M13.5 3.5 10 10.5h4l-3.5 8" {...round} strokeWidth="2.4" />
    </>
  ),
  wound: (
    <>
      <path d="M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z" />
      <path d="M4 20 20 6" {...round} strokeWidth="2.6" stroke="#000" opacity=".55" />
    </>
  ),
  stealth: (
    <>
      <path d="M2.5 9.5c2.5-2 5.5-2.8 9.5-2.8s7 .8 9.5 2.8c-.4 3.6-2.6 6.5-6 6.5-1.9 0-2.6-1.3-3.5-1.3s-1.6 1.3-3.5 1.3c-3.4 0-5.6-2.9-6-6.5z" />
      <ellipse cx="8" cy="10.6" rx="2" ry="1.2" fill="#000" opacity=".6" />
      <ellipse cx="16" cy="10.6" rx="2" ry="1.2" fill="#000" opacity=".6" />
    </>
  ),
  unstoppable: (
    <>
      <path d="M2.5 12h12M10.5 6.5 16 12l-5.5 5.5" {...round} strokeWidth="2.8" />
      <path d="M18.5 3.5v17" {...round} strokeWidth="2.2" strokeDasharray="2.4 2.4" opacity=".75" />
    </>
  ),
  cleanse: (
    <>
      <path d="M12 2.5l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
      <circle cx="19" cy="18.5" r="2" opacity=".7" />
      <circle cx="5" cy="19" r="1.4" opacity=".7" />
    </>
  ),
  refresh: (
    <g {...round} strokeWidth="2.4">
      <path d="M19.5 8.5A8 8 0 0 0 5 7.5M4.5 15.5A8 8 0 0 0 19 16.5" />
      <path d="M5 3v4.5h4.5M19 21v-4.5h-4.5" />
    </g>
  ),
  turret: (
    <>
      <path d="M8 13h8l1.5 8.5h-11z" />
      <path d="M7.5 7.5h9v5h-9z" opacity=".75" />
      <path d="M16.5 9.5h6" {...round} strokeWidth="2.6" />
      <path d="M12 2.5v5" {...round} strokeWidth="2" opacity=".6" />
    </>
  ),
  wall: (
    <>
      <path d="M2.5 6.5h8.5v5H2.5zM13 6.5h8.5v5H13zM2.5 13.5h4.5v5H2.5zM9 13.5h6v5H9zM17 13.5h4.5v5H17z" />
      <path d="M2 21h20" {...round} strokeWidth="2" opacity=".6" />
    </>
  ),
  trap: (
    <>
      <path d="M2.5 13.5h19l-2 4h-15z" />
      <path d="M4 13.5l2-6 2 6M9 13.5l2-6 2 6M14 13.5l2-6 2 6" opacity=".75" />
      <path d="M12 17.5v4" {...round} strokeWidth="2" />
    </>
  ),
  field: (
    <>
      <ellipse cx="12" cy="16" rx="9.5" ry="4.5" opacity=".45" />
      <ellipse cx="12" cy="16" rx="9.5" ry="4.5" {...round} strokeWidth="2" />
      <path d="M8 13.5c0-3 1.5-4 1.5-7M12 13.5c0-3.5 1.5-5 1.5-9M16 13.5c0-3 1.5-4 1.5-7" {...round} strokeWidth="1.8" />
    </>
  ),
}

/** One icon; the art never changes, so it renders once per key. */
export const AbilityIcon = memo(function AbilityIcon({ icon }: { icon: IconKey }) {
  return (
    <svg className="hud-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" data-icon={icon}>
      {ART[icon]}
    </svg>
  )
})
