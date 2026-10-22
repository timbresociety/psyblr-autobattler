import type { Build } from '../../charter/build'
import type { BuildSlot, Template } from '../../charter/types'
import { SLOT_LABEL } from './labels'

interface Props {
  build: Build
  checking: boolean
  alternatives?: Template[]
  onReady: () => void
  onSwap: (slot: BuildSlot, templateId: string) => void
}

/** The balance gate (R15): no build enters battle above the ceiling; a blocked build gets its strongest slot and options. */
export function GateStatus({ build, checking, alternatives, onReady, onSwap }: Props) {
  const { gate } = build
  const pct = gate.winRate !== undefined ? `${Math.round(gate.winRate * 100)}%` : ''
  const retuned = Object.entries(build.slots).filter(([, s]) => s.retuneSteps > 0)
  return (
    <section className="panel gate" aria-label="Balance check">
      {checking && <p role="status">Checking balance against the field…</p>}
      {!checking && gate.state === 'ready' && (
        <p role="status" className="ok">
          Ready for battle · wins {pct} against the field
          {retuned.length > 0 && ` · numbers retuned ${retuned[0][1].retuneSteps} step${retuned[0][1].retuneSteps > 1 ? 's' : ''} to stay fair`}
        </p>
      )}
      {!checking && gate.state === 'blocked' && gate.strongestSlot && (
        <div role="alert" className="blocked">
          <p>
            Too strong to battle ({pct} against the field). {SLOT_LABEL[gate.strongestSlot]} is carrying it. Pick another mechanic:
          </p>
          <div className="alts">
            {(alternatives ?? []).map((alt) => (
              <button key={alt.id} onClick={() => onSwap(gate.strongestSlot as BuildSlot, alt.id)}>
                {alt.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className="primary" onClick={onReady} disabled={checking || gate.state === 'blocked' || gate.state === 'ready'}>
        Ready
      </button>
    </section>
  )
}
