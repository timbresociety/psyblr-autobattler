import type { ReactNode } from 'react'
import type { Build } from '../../../charter/build'
import { COMMON_MOTIONS, type MotionSlot } from '../../../charter/motions'
import type { Gender } from '../../../charter/look'
import { elementLook } from '../../../charter/skill-look'
import { getTemplate } from '../../../charter/templates/catalog'
import type { BuildSlot } from '../../../charter/types'
import { skillLookOf } from '../../../arena/recipes/looks'
import { KIT_ROWS, MOTION_LABEL, SHARED_MOVES, type KitRow } from './kit-rows'
import { MotionPicker, StancePanel, useMotionLibrary, type MotionFit } from './MovesPanel'

interface Props {
  build: Build
  gender: Gender
  /** The idle the hero stands in, and the clip looping on the stage in its place. */
  idle?: string
  playing?: string
  onIdle: (clip: string) => void
  onPlay: (clip: string | undefined) => void
  /** Play a clip once on the hero on the stage. */
  onOnce: (clip: string) => void
  /** What fits each of the hero's own motions, its motions now, and a new one picked for one. */
  fits: Partial<Record<MotionSlot, MotionFit>>
  motions: Partial<Record<MotionSlot, string>>
  onMotion: (slot: MotionSlot, clip: string) => void
  /** Play a button's take on the training dummy, in the three-view reel. */
  onReel: (take?: string) => void
  /** The skill a row fires: its card, with the library picker (swap) and its look. */
  card: (slot: BuildSlot) => ReactNode
  /** The kit at a glance, above the rows. */
  glance: ReactNode
}

/**
 * The kit as one element (GAME.md §11): a row per button, V X LMB Q E F R. Each row has its skill from the library, its
 * animation (V's combo 1, 2, 3 and heavy), the colour of its effect, and a play button that runs it on the dummy in
 * the three-view reel. The moves every hero shares sit beneath the rows, and the stance under those.
 */
export function KitPanel({ build, gender, idle, playing, onIdle, onPlay, onOnce, fits, motions, onMotion, onReel, card, glance }: Props) {
  const index = useMotionLibrary()
  const combat = index && index !== 'failed' ? index.genders[gender].sets.combat : undefined
  return (
    <section className="kit" aria-label="Kit">
      <button className="btn ghost try-it-open" onClick={() => onReel()}>
        Watch the kit on a dummy
      </button>
      {glance}
      <div className="kit-rows">
        {KIT_ROWS.map((row) => (
          <Row key={row.key} row={row} build={build} combat={combat} fits={fits} motions={motions} onMotion={onMotion} onOnce={onOnce} onPlay={onPlay} onReel={onReel} card={card} />
        ))}
      </div>
      <div className="maker-group">
        <span className="field-label">Shared by every hero</span>
        <div className="chip-grid">
          {SHARED_MOVES.map((k) => (
            <button key={k} type="button" className="chip" onClick={() => (onPlay(undefined), onOnce(COMMON_MOTIONS[k].clip))}>
              {COMMON_MOTIONS[k].label}
            </button>
          ))}
        </div>
      </div>
      {index === 'failed' && <p className="muted">The move library didn&apos;t load. The hero keeps its own moves; try again in a moment.</p>}
      {index === undefined && <p className="muted">Loading moves…</p>}
      {index && index !== 'failed' && <StancePanel index={index} gender={gender} idle={idle} playing={playing} onIdle={onIdle} onPlay={onPlay} />}
    </section>
  )
}

function Row({ row, build, combat, fits, motions, onMotion, onOnce, onPlay, onReel, card }: { row: KitRow; build: Build; combat: Record<string, number> | undefined } & Pick<Props, 'fits' | 'motions' | 'onMotion' | 'onOnce' | 'onPlay' | 'onReel' | 'card'>) {
  const spec = row.slot ? build.slots[row.slot] : undefined
  const name = spec ? spec.name.trim() || getTemplate(spec.templateId).name : undefined
  // the effect's colours: core, glow and accent of the skill's look
  const look = row.slot ? (skillLookOf(build, row.slot) ?? elementLook('energy')) : undefined
  const play = () => {
    // the hero on the stage does the move, and the reel plays the button on the dummy
    const clip = row.motions.length ? motions[row.motions[0]] : row.shared && COMMON_MOTIONS[row.shared].clip
    onPlay(undefined)
    if (clip) onOnce(clip)
    onReel(row.take)
  }
  return (
    <section className="kit-row" aria-label={`${row.key}: ${row.title}`}>
      <header className="kit-row-head">
        <kbd>{row.key}</kbd>
        <span className="kit-row-title">
          {row.title}
          {name ? <span className="muted"> · {name}</span> : null}
        </span>
        {look && (
          <span className="kit-swatch" role="img" aria-label={`${row.title} effect colours`} title="Effect colours (change them in the look below)">
            {look.palette.map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </span>
        )}
        <button type="button" className="btn sm" onClick={play} aria-label={`Play ${row.title} on the dummy`}>
          ▶ Play
        </button>
      </header>
      <div className="kit-row-moves">
        {row.motions.map((slot) => (
          <label key={slot} className="kit-motion">
            <span>{MOTION_LABEL[slot]}</span>
            <MotionPicker slot={slot} label={`${row.key} ${MOTION_LABEL[slot]}`} combat={combat} fit={fits[slot]} clip={motions[slot]} onMotion={onMotion} />
            <button type="button" className="chip" disabled={!motions[slot]} onClick={() => motions[slot] && (onPlay(undefined), onOnce(motions[slot]!))} aria-label={`Play ${MOTION_LABEL[slot]} on the hero`}>
              ▶
            </button>
          </label>
        ))}
        {row.shared && (
          <p className="muted kit-motion">
            Moves with the shared {COMMON_MOTIONS[row.shared].label.toLowerCase()}.
          </p>
        )}
      </div>
      {row.slot && card(row.slot)}
    </section>
  )
}
