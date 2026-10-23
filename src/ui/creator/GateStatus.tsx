import type { ReactNode } from 'react'
import type { Build } from '../../charter/build'
import { RETUNE_STEP } from '../../charter/budget'
import type { BuildSlot, Template } from '../../charter/types'
import { SLOT_LABEL } from './labels'

interface Props {
  build: Build
  checking: boolean
  alternatives?: Template[]
  onReady: () => void
  onSwap: (slot: BuildSlot, templateId: string) => void
  /** Actions that follow a passed check (saving). */
  children?: ReactNode
}

function Mark({ state }: { state: 'draft' | 'checking' | 'ready' | 'blocked' }) {
  return (
    <span className={`gate-mark ${state}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        {state === 'ready' ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        ) : state === 'blocked' ? (
          <path d="M12 6v7M12 17.2v.3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        ) : (
          <path d="M12 2.5 20.5 5.7v6c0 5.1-3.5 8.9-8.5 10.3-5-1.4-8.5-5.2-8.5-10.3v-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  )
}

/**
 * The balance gate (R15) as the bar under the kit: no build enters battle above the ceiling; a blocked build gets its
 * strongest slot and options. It has its own row, so it never covers a skill.
 */
export function GateStatus({ build, checking, alternatives, onReady, onSwap, children }: Props) {
  const { gate } = build
  const pct = gate.winRate !== undefined ? `${Math.round(gate.winRate * 100)}%` : ''
  // the gate moves every slot by the same step: down to stay under the ceiling, or up to hold its own
  const steps = Object.values(build.slots)[0]?.retuneSteps ?? 0
  const shift = Math.round(Math.abs(steps) * RETUNE_STEP * 100)
  const weak = gate.blockedFor === 'weak'
  const state = checking ? 'checking' : gate.state === 'checking' ? 'draft' : gate.state
  return (
    <section className={`gate gate-${state}`} aria-label="Balance check">
      <Mark state={state} />
      <div className="gate-status">
        {checking && (
          <>
            <p role="status">Checking balance against the field…</p>
            <div className="busy-bar" aria-hidden="true" />
          </>
        )}
        {!checking && gate.state === 'ready' && (
          <p role="status" className="ok">
            Ready for battle · wins {pct} against the field
            {steps > 0 && ` · numbers down ${shift}% to stay fair`}
            {steps < 0 && ` · numbers up ${shift}% so its kit can hold its own`}
          </p>
        )}
        {!checking && gate.state === 'blocked' && gate.strongestSlot && (
          <div role="alert" className="blocked">
            <p>
              {weak
                ? `Too weak to hold its own (${pct} against the field, even with every number lifted). ${SLOT_LABEL[gate.strongestSlot]} is holding it back. Pick another mechanic:`
                : `Too strong to battle (${pct} against the field). ${SLOT_LABEL[gate.strongestSlot]} is carrying it. Pick another mechanic:`}
            </p>
            <div className="alts">
              {(alternatives ?? []).map((alt) => (
                <button key={alt.id} className="btn sm" onClick={() => onSwap(gate.strongestSlot as BuildSlot, alt.id)}>
                  {alt.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {!checking && gate.state !== 'ready' && gate.state !== 'blocked' && <p className="gate-hint">A quick simulated tournament checks this hero against the field before it can fight.</p>}
      </div>
      <div className="gate-actions">
        <button className={`btn big${gate.state === 'ready' ? ' ghost' : ' primary'}`} onClick={onReady} disabled={checking || gate.state === 'blocked' || gate.state === 'ready'}>
          Ready
        </button>
        {children}
      </div>
    </section>
  )
}
