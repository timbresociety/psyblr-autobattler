import { lazy, Suspense } from 'react'
import { getTemplate } from '../../../charter/templates/catalog'
import { playable } from '../../../forge/motion/library'
import { effectShape, motionOptions, numbered, type EffectShape } from '../../../forge/package'
import { stagePrice } from '../../../forge/pricing'
import { EFFECT_SLOT, STAGE_TABLE, formSize, stageOf } from '../../../forge/stages'
import { SIZES } from '../../../charter/sizes'
import type { Forge, StageId } from '../../../forge/types'

const HeroViewer = lazy(() => import('../HeroViewer').then((m) => ({ default: m.HeroViewer })))

export const STAGE_TITLE: Record<StageId, string> = {
  spec: 'Spec sheet',
  concept: '2D concept sheet',
  mesh: '3D quad mesh',
  motion: 'Movement and basic attack',
  active1: 'Active 1',
  active2: 'Active 2',
  ultimate: 'Passive and ultimate',
  form: 'Transformation form',
  stats: 'Stat split',
}

interface Props {
  forge: Forge
  stage: StageId
  balance: number
  busy: boolean
  onStart: () => void
  onRetry: () => void
  onConfirm: () => void
  onChoose: (choice: Record<string, unknown>) => void
  /** Optional stages (the form) can be skipped at no charge. */
  onSkip?: () => void
}

function Picks({ label, urls, chosen, onPick, busy }: { label: string; urls: string[]; chosen: number; onPick: (i: number) => void; busy: boolean }) {
  return (
    <div className="picks" role="radiogroup" aria-label={label}>
      {urls.map((url, i) => (
        <button key={url} role="radio" aria-checked={chosen === i} className={chosen === i ? 'on' : ''} disabled={busy} onClick={() => onPick(i)}>
          <img src={url} alt={`${label} option ${i + 1}`} />
        </button>
      ))}
    </div>
  )
}

/** A paid generation stage: generate, look, pick, retry within the cap, confirm (R4, R11-R18). */
export function GenerateStage({ forge, stage, balance, busy, onStart, onRetry, onConfirm, onChoose, onSkip }: Props) {
  const s = stageOf(forge, stage)
  const price = stagePrice(stage)
  const left = STAGE_TABLE[stage].retryCap - s.retriesUsed
  const choice = (s.inputs.choice ?? {}) as Record<string, number>
  const slot = EFFECT_SLOT[stage]
  const motionArtifacts = forge.stages.motion.artifacts
  const rig = motionArtifacts.rig
  const motions = numbered(motionArtifacts, 'retarget')

  const preview = (() => {
    if (s.status !== 'ready') return null
    if (stage === 'concept') return <Picks label="Concept sheet" urls={numbered(s.artifacts, 'sheet')} chosen={choice.sheet ?? 0} onPick={(i) => onChoose({ sheet: i })} busy={busy} />
    if (stage === 'mesh') return <Suspense fallback={<p className="muted">Loading 3D…</p>}><HeroViewer label={forge.spec!.heroName} meshUrl={s.artifacts.mesh} /></Suspense>
    if (stage === 'form') return <Suspense fallback={<p className="muted">Loading 3D…</p>}><HeroViewer label={`${forge.spec!.heroName} transformed`} meshUrl={s.artifacts['form-mesh']} /></Suspense>
    if (stage === 'motion') {
      const options = motionOptions(forge, 'basic')
      const chosen = options[choice.basic ?? 0] ?? options[0]
      return (
        <>
          <div className="segmented" role="radiogroup" aria-label="Basic attack motion">
            {options.map((m, i) => (
              <button key={m.id} role="radio" aria-checked={(choice.basic ?? 0) === i} className={(choice.basic ?? 0) === i ? 'on' : ''} disabled={busy} onClick={() => onChoose({ basic: i })}>
                {m.label}
              </button>
            ))}
          </div>
          <Suspense fallback={<p className="muted">Loading 3D…</p>}><HeroViewer label={forge.spec!.heroName} meshUrl={rig} motionUrls={motions} motion={playable(chosen)} /></Suspense>
        </>
      )
    }
    if (slot) {
      const options = motionOptions(forge, slot)
      const chosen = options[choice.motion ?? 0] ?? options[0]
      const effects = numbered(s.artifacts, 'effect')
      const passive = numbered(s.artifacts, 'passive')
      const template = getTemplate(forge.build!.slots[slot].templateId)
      const shape = (s.inputs.effect as { shape: EffectShape } | undefined)?.shape ?? effectShape(template.id)
      return (
        <>
          <Picks label="Effect" urls={effects} chosen={choice.effect ?? 0} onPick={(i) => onChoose({ effect: i })} busy={busy} />
          <div className="segmented" role="radiogroup" aria-label="Motion">
            {options.map((m, i) => (
              <button key={m.id} role="radio" aria-checked={(choice.motion ?? 0) === i} className={(choice.motion ?? 0) === i ? 'on' : ''} disabled={busy} onClick={() => onChoose({ motion: i })}>
                {m.label}
              </button>
            ))}
          </div>
          {passive.length > 0 && <Picks label={forge.spec!.passiveVisual === 'aura' ? 'Passive aura' : 'Passive body element'} urls={passive} chosen={choice.passive ?? 0} onPick={(i) => onChoose({ passive: i })} busy={busy} />}
          <Suspense fallback={<p className="muted">Loading 3D…</p>}>
            <HeroViewer label={forge.spec!.heroName} meshUrl={rig} motionUrls={motions} motion={playable(chosen)} effect={effects[choice.effect ?? 0] ? { url: effects[choice.effect ?? 0], delivery: template.delivery, shape } : undefined} />
          </Suspense>
        </>
      )
    }
    return null
  })()

  return (
    <div className="stage-body">
      {stage === 'form' && (
        <p className="muted">
          The form your hero takes when its ultimate transforms it, shown at {SIZES[formSize(forge.build) ?? 'colossal'].label} size, the same size as its hitbox in the arena.
        </p>
      )}
      {slot && <p className="muted">{forge.build!.slots[slot].name || getTemplate(forge.build!.slots[slot].templateId).name}: {getTemplate(forge.build!.slots[slot].templateId).name}</p>}
      {(s.status === 'draft' || s.status === 'failed') && (
        <>
          {s.status === 'failed' && <p className="inline-error">That didn’t work: {s.failure}. Nothing was charged.</p>}
          <button className="primary" disabled={busy || balance < price} onClick={s.status === 'failed' ? onRetry : onStart}>
            {s.status === 'failed' ? 'Try again' : 'Generate'} · {price} credits
          </button>
          {onSkip && (
            <button disabled={busy} onClick={onSkip}>
              Skip, no form
            </button>
          )}
        </>
      )}
      {s.status === 'generating' && (
        <p className="notice" aria-live="polite">
          Generating… you can leave; it keeps going and picks up here.
        </p>
      )}
      {preview}
      {s.status === 'ready' && (
        <div className="row">
          <button disabled={busy || left <= 0 || balance < price} onClick={onRetry}>
            {left > 0 ? `Retry · ${left} left` : 'No retries left'}
          </button>
          <button className="primary" disabled={busy} onClick={onConfirm}>
            Confirm
          </button>
        </div>
      )}
    </div>
  )
}
