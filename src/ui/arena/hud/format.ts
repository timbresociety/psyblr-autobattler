/** Small formatting helpers the HUD shares. Framework-free so they test on their own. */

/** Team colours, the same as the arena's rings and markers (map.ts TEAM_COLORS). */
export const TEAM_HEX = ['#4fa3ff', '#ff6a4a'] as const
export const TEAM_NAME = ['Blue', 'Red'] as const

/** m:ss for the match timer. */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Whole seconds left on a cooldown, or '' once it is ready. */
export const cdLabel = (left: number) => (left > 0.05 ? String(Math.ceil(left)) : '')

const plain = (name: string) => name.replace(/["“”][^"“”]*["“”]/g, ' ').split(/\s+/).filter(Boolean)

/** The word a crowd knows a hero by: the surname, nickname dropped ('Elon "Starship" Musk' → 'Musk'). */
export function shortName(name: string): string {
  const words = plain(name)
  if (words.length) return words[words.length - 1]
  const bare = name.replace(/["“”]/g, '').trim().split(/\s+/)
  return bare[bare.length - 1] || name
}

/** Up to two initials, for a portrait that has no picture yet. */
export function initials(name: string): string {
  const words = plain(name)
  return (words.length ? words : [name]).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase()
}

/** Health per bar segment: 250 for every role today, 500 for anything past 5000 so a bar never turns to noise. */
export const segmentSize = (maxHp: number) => (maxHp > 5000 ? 500 : 250)

/** Width of one segment as a share of the bar, for a CSS custom property. */
export const segmentPct = (maxHp: number) => `${Math.min(100, (segmentSize(maxHp) / Math.max(1, maxHp)) * 100).toFixed(3)}%`

export const pct = (value: number, max: number) => `${Math.max(0, Math.min(100, (value / Math.max(1e-6, max)) * 100)).toFixed(2)}%`

/** Fraction of a cooldown already served, 1 when ready (drives the conic sweep). */
export const served = (left: number, total: number) => (total > 0 && left > 0.05 ? Math.max(0, Math.min(1, 1 - left / total)) : 1)

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
