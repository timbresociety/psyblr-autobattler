import type { HeroState } from '../../../arena/engine/state.js'

/**
 * What is on a hero right now, worst first, read straight from the engine state (no events to miss). The overhead
 * bars show the top two, the controlled hero's HUD shows its own. Tones: `hard` takes the hero out of the fight, `soft`
 * hampers it, `debuff` weakens it, `state` is something it is protected by.
 */
export type StatusTone = 'hard' | 'soft' | 'debuff' | 'state'

export interface HeroStatus {
  key: string
  label: string
  tone: StatusTone
  /** Ticks until it ends. */
  until: number
}

const CC: { key: keyof HeroState['cc']; label: string; tone: StatusTone }[] = [
  { key: 'sleep', label: 'Asleep', tone: 'hard' },
  { key: 'fear', label: 'Feared', tone: 'hard' },
  { key: 'taunt', label: 'Taunted', tone: 'hard' },
  { key: 'silence', label: 'Silenced', tone: 'soft' },
  { key: 'root', label: 'Rooted', tone: 'soft' },
  { key: 'disarm', label: 'Disarmed', tone: 'soft' },
  { key: 'grounded', label: 'Grounded', tone: 'soft' },
  { key: 'blind', label: 'Blinded', tone: 'soft' },
  { key: 'break', label: 'Broken', tone: 'soft' },
]

const DEBUFF_LABEL: Record<HeroState['debuffs'][number]['type'], string> = {
  mark: 'Marked',
  vulnerable: 'Exposed',
  armorShred: 'Armor shred',
  spiritShred: 'Spirit shred',
  wound: 'Wounded',
}

export function statusesOf(h: HeroState, now: number): HeroStatus[] {
  if (!h.alive) return []
  const out: HeroStatus[] = []
  // older snapshots and hand-built test heroes may lack the newer status fields
  const cc = h.cc ?? ({} as Partial<HeroState['cc']>)
  const slows = h.slows ?? []
  if (h.invulnerableUntil > now) out.push({ key: 'invulnerable', label: 'Untouchable', tone: 'state', until: h.invulnerableUntil })
  if (h.launch && h.launch.until > now) out.push({ key: 'knockup', label: 'Airborne', tone: 'hard', until: h.launch.until })
  else if (h.stunnedUntil > now) out.push({ key: 'stun', label: 'Stunned', tone: 'hard', until: h.stunnedUntil })
  for (const c of CC) {
    const until = cc[c.key] ?? 0
    if (until > now) out.push({ key: c.key, label: c.label, tone: c.tone, until })
  }
  const slow = slows.filter((s) => s.until > now && s.stat !== 'attack')
  if (slow.length) out.push({ key: 'slow', label: 'Slowed', tone: 'soft', until: Math.max(...slow.map((s) => s.until)) })
  const cripple = slows.filter((s) => s.until > now && s.stat === 'attack')
  if (cripple.length) out.push({ key: 'cripple', label: 'Crippled', tone: 'soft', until: Math.max(...cripple.map((s) => s.until)) })
  if ((h.unstoppableUntil ?? 0) > now) out.push({ key: 'unstoppable', label: 'Unstoppable', tone: 'state', until: h.unstoppableUntil })
  if ((h.stealthUntil ?? 0) > now) out.push({ key: 'stealth', label: 'Stealthed', tone: 'state', until: h.stealthUntil })
  const seen = new Set<string>()
  for (const d of h.debuffs ?? []) {
    if (d.until <= now || seen.has(d.type)) continue
    seen.add(d.type)
    out.push({ key: d.type, label: DEBUFF_LABEL[d.type], tone: 'debuff', until: d.until })
  }
  return out
}

/** A short stable key for the statuses shown, so the DOM is only touched when what it shows changes. */
export const statusKey = (list: readonly HeroStatus[], count: number) => list.slice(0, count).map((s) => s.key).join('|')
