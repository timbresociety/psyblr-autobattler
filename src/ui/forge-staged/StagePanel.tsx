import type { SizeClass } from '../../charter/sizes'
import { stagePrice } from '../../forge/pricing'
import type { SizeCost } from '../../forge/sizes'
import { STAGE_ORDER, formAvailable } from '../../forge/stages'
import type { Forge, StageId } from '../../forge/types'
import type { ForgeAction } from './forge-api'
import { GenerateStage, STAGE_TITLE } from './stages/GenerateStage'
import { SpecStage } from './stages/SpecStage'
import { StatsStage } from './stages/StatsStage'

interface Props {
  forge: Forge
  balance: number
  busy: boolean
  act: (action: ForgeAction) => void
  sizeCost: (size: SizeClass) => Promise<SizeCost>
  /** Start another forge once this hero is published. */
  onDone?: () => void
}

const SHORT: Record<StageId, string> = { spec: 'Spec', concept: 'Concept', mesh: 'Mesh', motion: 'Motion', active1: 'Active 1', active2: 'Active 2', ultimate: 'Ultimate', form: 'Form', stats: 'Stats' }

/** What each stage makes, in a line, so the player knows what a confirm pays for. */
export const STAGE_BLURB: Record<StageId, string> = {
  spec: 'Check what the director drafted. Nothing is generated or charged until you confirm it.',
  concept: 'Front and turnaround sheets of your hero. Pick the one the 3D model is built from.',
  mesh: 'A 3D quad mesh built from the sheet you picked.',
  motion: 'A rig, movement and the basic attack, retargeted onto your hero.',
  active1: 'The first active skill: its motion and its effect.',
  active2: 'The second active skill: its motion and its effect.',
  ultimate: 'The passive’s look, and the ultimate’s motion and effect.',
  form: 'The form your hero takes when its ultimate transforms it. Optional.',
  stats: 'The Charter’s stat split and balance check, then publish.',
}

/** The stages in order along the top: done, now, still to come (R11). */
export function StageTrack({ forge }: { forge: Forge }) {
  const published = forge.current === 'published'
  // the form stage only exists for a hero whose ultimate transforms it
  const stages = STAGE_ORDER.filter((id) => id !== 'form' || formAvailable(forge.build) || forge.current === 'form')
  return (
    <ol className="track" aria-label="Forge progress">
      {stages.map((id, i) => {
        const s = forge.stages[id]
        const state = published || s?.status === 'approved' ? (s?.inputs?.skipped ? 'skipped' : 'done') : id === forge.current ? 'now' : 'todo'
        const price = stagePrice(id)
        return (
          <li key={id} className={state} aria-current={id === forge.current ? 'step' : undefined}>
            <span className="track-num" aria-hidden="true">
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className="track-text">
              <span className="track-name">{SHORT[id]}</span>
              <small>{state === 'skipped' ? 'Skipped' : price ? `${price} credits` : 'Free'}</small>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** The plan-mode stage: one open at a time, earlier ones frozen (R11, R12). */
export function StagePanel({ forge, balance, busy, act, sizeCost, onDone }: Props) {
  const stage = forge.current
  if (stage === 'published')
    return (
      <section className="panel stage-panel published" aria-label="Forge stages">
        <h2 className="title published-title">Published</h2>
        <p className="notice">
          {forge.spec?.heroName} is published to the global loadout. Anyone can add it for free, and you can remix it in a new forge.
        </p>
        <p className="muted">It is in your heroes in the Creator, and ready to place on the board in the Arena.</p>
        {onDone && (
          <div className="row">
            <button className="btn primary big" onClick={onDone}>
              Forge another
            </button>
          </div>
        )}
      </section>
    )
  return (
    <section className="panel stage-panel" aria-label="Forge stages">
      <header className="stage-head">
        <h2 className="section-title">{STAGE_TITLE[stage]}</h2>
        <p className="muted">{STAGE_BLURB[stage]}</p>
      </header>
      {stage === 'spec' && <SpecStage forge={forge} busy={busy} sizeCost={sizeCost} onEdit={(inputs) => act({ type: 'edit', stage: 'spec', inputs })} onConfirm={() => act({ type: 'confirm', stage: 'spec' })} />}
      {stage === 'stats' && <StatsStage forge={forge} busy={busy} onCheck={(spread) => act({ type: 'edit', stage: 'stats', inputs: { spread } })} onPublish={() => act({ type: 'confirm', stage: 'stats' })} />}
      {stage !== 'spec' && stage !== 'stats' && (
        <GenerateStage
          forge={forge}
          stage={stage}
          balance={balance}
          busy={busy}
          onStart={() => act({ type: 'start', stage })}
          onRetry={() => act({ type: 'retry', stage })}
          onConfirm={() => act({ type: 'confirm', stage })}
          onChoose={(choice) => act({ type: 'choose', stage, choice })}
          {...(stage === 'form' ? { onSkip: () => act({ type: 'skip', stage }) } : {})}
        />
      )}
    </section>
  )
}
