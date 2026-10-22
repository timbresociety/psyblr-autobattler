import type { SizeClass } from '../../charter/sizes'
import type { SizeCost } from '../../forge/sizes'
import { STAGE_ORDER } from '../../forge/stages'
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
}

/** The plan-mode stepper: one stage open at a time, earlier ones frozen (R11, R12). */
export function StagePanel({ forge, balance, busy, act, sizeCost }: Props) {
  const stage = forge.current
  return (
    <section className="panel stage-panel" aria-label="Forge stages">
      <ol className="stepper">
        {STAGE_ORDER.map((id) => (
          <li key={id} className={id === stage ? 'now' : forge.stages[id].status === 'approved' ? 'done' : ''} aria-current={id === stage ? 'step' : undefined}>
            {STAGE_TITLE[id]}
          </li>
        ))}
      </ol>
      {stage === 'published' ? (
        <p className="notice">
          {forge.spec?.heroName} is published to the global loadout. Anyone can add it for free, and you can remix it in a new forge.
        </p>
      ) : (
        <>
          <h2>{STAGE_TITLE[stage]}</h2>
          {stage === 'spec' && <SpecStage forge={forge} busy={busy} sizeCost={sizeCost} onEdit={(inputs) => act({ type: 'edit', stage: 'spec', inputs })} onConfirm={() => act({ type: 'confirm', stage: 'spec' })} />}
          {stage === 'stats' && <StatsStage forge={forge} busy={busy} onCheck={(spread) => act({ type: 'edit', stage: 'stats', inputs: { spread } })} onPublish={() => act({ type: 'confirm', stage: 'stats' })} />}
          {stage !== 'spec' && stage !== 'stats' && (
            <GenerateStage
              forge={forge}
              stage={stage as StageId}
              balance={balance}
              busy={busy}
              onStart={() => act({ type: 'start', stage })}
              onRetry={() => act({ type: 'retry', stage })}
              onConfirm={() => act({ type: 'confirm', stage })}
              onChoose={(choice) => act({ type: 'choose', stage, choice })}
            />
          )}
        </>
      )}
    </section>
  )
}
