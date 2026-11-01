import { useEffect, useState } from 'react'
import type { Gender } from '../../../charter/look.js'
import { animIndex, type AnimIndex, type AnimSet } from '../../../arena/client/anim-index.js'

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

const SET_TITLE: Record<AnimSet, string> = { idle: 'Stance', fidget: 'Idle moments', move: 'Move', dance: 'Dance', talk: 'Talk and gesture' }

interface Props {
  gender: Gender
  /** The idle the hero stands in (saved with it); its gender's first when absent. */
  idle?: string
  /** The clip playing on the stage in place of the idle. */
  playing?: string
  onIdle: (clip: string) => void
  onPlay: (clip: string | undefined) => void
  /** The kit's skills, each played once on the hero. */
  skills: { slot: string; name: string }[]
  onSkill: (slot: string) => void
}

/**
 * Moves, as an avatar creator shows them: the stance the hero stands in everywhere (motion-captured, saved with the
 * look), and walks, runs, dances and talk to try on it, each looping on the stage until another is picked or stopped.
 */
export function MovesPanel({ gender, idle, playing, onIdle, onPlay, skills, onSkill }: Props) {
  const [index, setIndex] = useState<AnimIndex>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    animIndex().then((i) => live && (i ? setIndex(i) : setFailed(true)))
    return () => {
      live = false
    }
  }, [])
  if (failed) return <p className="muted">The move library didn't load. The hero keeps its own idle; try again in a moment.</p>
  if (!index) return <p className="muted">Loading moves…</p>
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
      {skills.length > 0 && (
        <div className="maker-group">
          <span className="field-label">Skills</span>
          <div className="chip-grid">
            {skills.map((s) => (
              <button key={s.slot} type="button" className="chip" onClick={() => (onPlay(undefined), onSkill(s.slot))}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
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
