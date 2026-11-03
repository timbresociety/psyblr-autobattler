import { useEffect, useState } from 'react'
import type { Gender } from '../../../charter/look.js'
import { animIndex, type AnimIndex, type AnimSet } from '../../../arena/client/anim-index.js'
import { MOTIONS, MOTION_SLOT_KINDS, type Motion, type MotionKind, type MotionSlot } from '../../../charter/motions.js'

/** The combat set as the menu groups it, by what each motion is for. */
const KIND_TITLE: [MotionKind, string][] = [
  ['light', 'Melee'],
  ['heavy', 'Heavy melee'],
  ['ranged', 'Shots and throws'],
  ['spell', 'Spells'],
  ['movement', 'Movement skills'],
  ['ultimate', 'Ultimates'],
  ['passive', 'Flourishes'],
  ['dodge', 'Dodges and rolls'],
  ['block', 'Blocks'],
  ['react', 'Hit reactions'],
  ['knockdown', 'Knockdowns and getting up'],
  ['jump', 'Jumps'],
  ['move', 'Sprint, crouch and prone'],
]

const WORDS: Record<string, string> = { back: 'backwards', left: 'left', right: 'right', jump: 'jump', v: '' }

/** A clip's name as the menu shows it: "walk_left" is "Walk left", stances and idle moments go by number. */
export function clipLabel(set: AnimSet, name: string, order: number): string {
  if (set === 'idle') return `Stance ${order + 1}`
  if (set === 'fidget') return `Moment ${order + 1}`
  const [first, ...rest] = name.split('_')
  const words = [first, ...rest.map((w) => WORDS[w] ?? w)].filter(Boolean)
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const SET_TITLE: Record<AnimSet, string> = { idle: 'Stance', fidget: 'Idle moments', move: 'Move', dance: 'Dance', talk: 'Talk and gesture', combat: 'Combat' }

/** The motion library for the Forge: the Psyblr Human's, with its combat set, where it loads; the first rig's otherwise. */
export function useMotionLibrary(): AnimIndex | 'failed' | undefined {
  const [index, setIndex] = useState<AnimIndex | 'failed'>()
  useEffect(() => {
    let live = true
    animIndex('standard')
      .then((i) => i ?? animIndex())
      .then((i) => live && setIndex(i ?? 'failed'))
    return () => {
      live = false
    }
  }, [])
  return index
}

/** What fits one of the hero's own motions: the clips its skill's words name and its kinds, and the skill's name. */
export interface MotionFit {
  name?: string
  clips: readonly string[]
  kinds: readonly MotionKind[]
}

/** The library picker for one of the hero's own motions: what fits first, then every combat clip by kind. */
export function MotionPicker({ slot, label, combat, fit, clip, onMotion }: { slot: MotionSlot; label: string; combat: Record<string, number> | undefined; fit: MotionFit | undefined; clip?: string; onMotion: (slot: MotionSlot, clip: string) => void }) {
  const f = fit ?? { clips: [], kinds: MOTION_SLOT_KINDS[slot] }
  const all = MOTIONS.filter((m) => combat && m.id in combat)
  const best = [...f.clips.flatMap((id) => all.filter((m) => m.id === id)), ...f.kinds.slice(0, 2).flatMap((k) => all.filter((m) => m.kind === k && !f.clips.includes(m.id)))]
  const groups: [string, Motion[]][] = [['Fits this move', best], ...KIND_TITLE.map(([k, title]): [string, Motion[]] => [title, all.filter((m) => m.kind === k && !best.includes(m))])]
  return (
    <select aria-label={`${label} motion`} value={clip ?? ''} onChange={(e) => onMotion(slot, e.target.value)}>
      {!clip && <option value="">Choose a motion</option>}
      {groups.map(([group, ms]) =>
        ms.length ? (
          <optgroup key={group} label={group}>
            {ms.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </select>
  )
}

/**
 * How the hero stands, as an avatar creator shows it: the stance it stands in everywhere (motion-captured, saved with
 * the look), and walks, runs, dances and talk to try on it, each looping on the stage until another is picked.
 */
export function StancePanel({ index, gender, idle, playing, onIdle, onPlay }: { index: AnimIndex; gender: Gender; idle?: string; playing?: string; onIdle: (clip: string) => void; onPlay: (clip: string | undefined) => void }) {
  const sets = index.genders[gender].sets
  const stance = idle && idle in sets.idle ? idle : Object.keys(sets.idle)[0]
  return (
    <div className="moves">
      <div className="maker-group">
        <span className="field-label">{SET_TITLE.idle}</span>
        <p className="muted look-hint">How the hero stands in the Loadout and between fights. Saved with the look.</p>
        <div className="chip-grid" role="radiogroup" aria-label="Stance">
          {Object.keys(sets.idle).map((name, i) => (
            <button key={name} type="button" role="radio" aria-checked={stance === name} className={`chip${stance === name ? ' on' : ''}`} onClick={() => (onIdle(name), onPlay(undefined))}>
              {clipLabel('idle', name, i)}
            </button>
          ))}
        </div>
      </div>
      {(['fidget', 'move', 'dance', 'talk'] as const).map((set) => (
        <div key={set} className="maker-group">
          <span className="field-label">{SET_TITLE[set]}</span>
          <div className="chip-grid">
            {Object.keys(sets[set]).map((name, i) => (
              <button key={name} type="button" aria-pressed={playing === name} className={`chip${playing === name ? ' on' : ''}`} onClick={() => onPlay(playing === name ? undefined : name)}>
                {clipLabel(set, name, i)}
              </button>
            ))}
          </div>
        </div>
      ))}
      {playing && (
        <div className="maker-actions">
          <button type="button" className="btn sm" onClick={() => onPlay(undefined)}>
            Back to the stance
          </button>
        </div>
      )}
      <p className="muted credit">Motion-captured moves.</p>
    </div>
  )
}
