import { useEffect, useState } from 'react'
import type { Gender } from '../../../charter/look.js'
import { animIndex, type AnimIndex, type AnimSet } from '../../../arena/client/anim-index.js'
import { COMMON_MOTIONS, MOTIONS, MOTION_SLOTS, MOTION_SLOT_KINDS, MOTION_SLOT_TITLE, motionOf, type Motion, type MotionKind, type MotionSlot } from '../../../charter/motions.js'

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

interface Props {
  gender: Gender
  /** The idle the hero stands in (saved with it); its gender's first when absent. */
  idle?: string
  /** The clip playing on the stage in place of the idle. */
  playing?: string
  onIdle: (clip: string) => void
  onPlay: (clip: string | undefined) => void
  /** The clips and kinds of motion that fit each of the hero's own motions (a skill's fit what it does), and its skill's name. */
  fits: Partial<Record<MotionSlot, { name?: string; clips: readonly string[]; kinds: readonly MotionKind[] }>>
  /** Play a clip once on the hero. */
  onOnce: (clip: string) => void
  /** The hero's own motions now (the look's own or the catalogue's pick), and a new one chosen for one. */
  motions?: Partial<Record<MotionSlot, string>>
  onMotion?: (slot: MotionSlot, clip: string) => void
  /** Watch the whole kit on a training dummy in the arena. */
  onReel?: () => void
}

/**
 * Moves, as an avatar creator shows them: the stance the hero stands in everywhere (motion-captured, saved with the
 * look), and walks, runs, dances and talk to try on it, each looping on the stage until another is picked or stopped.
 */
export function MovesPanel({ gender, idle, playing, onIdle, onPlay, fits, onOnce, motions = {}, onMotion, onReel }: Props) {
  const [index, setIndex] = useState<AnimIndex>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    // the Psyblr Human's library, with its combat set, where it loads; the first rig's otherwise
    animIndex('standard')
      .then((i) => i ?? animIndex())
      .then((i) => live && (i ? setIndex(i) : setFailed(true)))
    return () => {
      live = false
    }
  }, [])
  if (failed) return <p className="muted">The move library didn't load. The hero keeps its own idle; try again in a moment.</p>
  if (!index) return <p className="muted">Loading moves…</p>
  const sets = index.genders[gender].sets
  const combat = sets.combat
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
      <div className="maker-group">
        <span className="field-label">The kit's moves</span>
        <p className="muted look-hint">Eight moves are the hero's own: play one, or pick another (what fits comes first). The rest every hero shares.</p>
        {onReel && (
          <button type="button" className="btn ghost" onClick={onReel}>
            Watch them on a dummy
          </button>
        )}
        <div className="skill-motions">
          {MOTION_SLOTS.map((slot) => {
            const fit = fits[slot] ?? { clips: [], kinds: MOTION_SLOT_KINDS[slot] }
            const all = MOTIONS.filter((m) => combat && m.id in combat)
            // what fits first: the clips its words name, then its kinds' clips in order; then the rest by kind
            const best = [...fit.clips.flatMap((id) => all.filter((m) => m.id === id)), ...fit.kinds.slice(0, 2).flatMap((k) => all.filter((m) => m.kind === k && !fit.clips.includes(m.id)))]
            const groups: [string, Motion[]][] = [['Fits this move', best], ...KIND_TITLE.map(([k, title]): [string, Motion[]] => [title, all.filter((m) => m.kind === k && !best.includes(m))])]
            const clip = motions[slot]
            const title = fit.name ? `${MOTION_SLOT_TITLE[slot]}: ${fit.name}` : MOTION_SLOT_TITLE[slot]
            return (
              <div key={slot} className="skill-motion">
                <button type="button" className="chip" disabled={!clip} onClick={() => clip && (onPlay(undefined), onOnce(clip))}>
                  {title}
                </button>
                {onMotion && (
                  <select aria-label={`${MOTION_SLOT_TITLE[slot]} motion`} value={clip ?? ''} onChange={(e) => onMotion(slot, e.target.value)}>
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
                )}
              </div>
            )
          })}
        </div>
        <span className="field-label">Shared by every hero</span>
        <div className="chip-grid">
          {Object.values(COMMON_MOTIONS).map((c) => (
            <button key={c.label} type="button" className="chip" onClick={() => (onPlay(undefined), onOnce(c.clip))}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {combat &&
        KIND_TITLE.map(([kind, title]) => {
          const clips = Object.keys(combat).filter((id) => (motionOf(id)?.kind ?? (kind === 'move' ? 'move' : undefined)) === kind)
          if (!clips.length) return null
          return (
            <div key={kind} className="maker-group">
              <span className="field-label">{title}</span>
              <div className="chip-grid">
                {clips.map((name) => (
                  <button key={name} type="button" aria-pressed={playing === name} className={`chip${playing === name ? ' on' : ''}`} onClick={() => onPlay(playing === name ? undefined : name)}>
                    {motionOf(name)?.label ?? clipLabel('combat', name, 0)}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
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
