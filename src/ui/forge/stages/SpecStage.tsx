import { useState } from 'react'
import { SIZE_CLASSES, SIZES, type SizeClass } from '../../../charter/sizes'
import { getTemplate } from '../../../charter/templates/catalog'
import type { DirectorOutput } from '../../../forge/director/schema'
import type { SizeCost } from '../../../forge/sizes'
import type { Forge } from '../../../forge/types'
import { SLOT_LABEL } from '../../creator/labels'

interface Props {
  forge: Forge
  busy: boolean
  onEdit: (inputs: Record<string, unknown>) => void
  onConfirm: () => void
  sizeCost: (size: SizeClass) => Promise<SizeCost>
}

/** The spec sheet the player confirms before anything visual is generated (R9, AE1, AE3, AE4). */
export function SpecStage({ forge, busy, onEdit, onConfirm, sizeCost }: Props) {
  const spec = forge.spec
  const [cost, setCost] = useState<SizeCost>()
  const [costing, setCosting] = useState<SizeClass>()
  const [element, setElement] = useState(spec?.passiveElement ?? '')
  if (!spec) return <p className="muted">Describe your hero in the chat. The director drafts a spec you can change before anything is generated.</p>
  const director = forge.stages.spec.inputs.director as DirectorOutput | undefined
  const unused = (director?.suggestions ?? []).filter((s) => !spec.signatureElements.includes(s.text) && s.kind !== 'skill-theme')

  async function pickSize(size: SizeClass) {
    onEdit({ sizeClass: size })
    setCosting(size)
    try {
      const c = await sizeCost(size)
      setCost((prev) => (c.sizeClass === size ? c : prev))
    } finally {
      setCosting((s) => (s === size ? undefined : s))
    }
  }

  return (
    <div className="stage-body spec-stage">
      <label className="field">
        <span>Hero name</span>
        <input defaultValue={spec.heroName} onBlur={(e) => e.target.value.trim() && e.target.value !== spec.heroName && onEdit({ heroName: e.target.value })} />
      </label>
      <p className="muted">{spec.description}</p>

      <section aria-label="Signature elements">
        <h3>Signature elements</h3>
        <ul className="chips">
          {spec.signatureElements.map((el) => (
            <li key={el}>
              {el}
              <button className="ghost" aria-label={`Drop ${el}`} disabled={busy} onClick={() => onEdit({ signatureElements: spec.signatureElements.filter((x) => x !== el) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
        {unused.length > 0 && (
          <ul className="suggestions" aria-label="Director suggestions">
            {unused.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.text}</strong> <small>{s.reason}</small>
                </span>
                <button disabled={busy} onClick={() => onEdit({ signatureElements: [...spec.signatureElements, s.text] })}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Size class">
        <h3>Size</h3>
        <div className="segmented" role="radiogroup" aria-label="Size class">
          {SIZE_CLASSES.map((size) => (
            <button key={size} role="radio" aria-checked={spec.sizeClass === size} className={spec.sizeClass === size ? 'on' : ''} disabled={busy} onClick={() => pickSize(size)}>
              {size}
            </button>
          ))}
        </div>
        <p className="muted size-cost" aria-live="polite">
          Hitbox {SIZES[spec.sizeClass].hitRadius >= 0 ? '+' : ''}
          {SIZES[spec.sizeClass].hitRadius} m
          {costing === spec.sizeClass && ' · pricing…'}
          {cost && cost.sizeClass === spec.sizeClass && ` · health ${cost.healthDelta >= 0 ? '+' : ''}${cost.healthDelta} · speed ${cost.speedDelta >= 0 ? '+' : ''}${cost.speedDelta} · ${Math.round(cost.winRate * 100)}% vs field`}
        </p>
      </section>

      <section aria-label="Skills">
        <h3>Skills</h3>
        <ul className="skill-list">
          {spec.skills.map((s) => (
            <li key={s.slot}>
              <span className="slot">{SLOT_LABEL[s.slot]}</span> <strong>{s.name}</strong> <small>{getTemplate(s.templateId).name}</small>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Passive visual">
        <h3>Passive shows as</h3>
        <div className="segmented" role="radiogroup" aria-label="Passive visual">
          {(['aura', 'body-element'] as const).map((v) => (
            <button key={v} role="radio" aria-checked={spec.passiveVisual === v} className={spec.passiveVisual === v ? 'on' : ''} disabled={busy} onClick={() => onEdit({ passiveVisual: v })}>
              {v === 'aura' ? 'Aura' : 'Body element'}
            </button>
          ))}
        </div>
        {spec.passiveVisual === 'body-element' && (
          <label className="field">
            <span>Which element</span>
            <input value={element} placeholder="glowing circuit tattoos" onChange={(e) => setElement(e.target.value)} onBlur={() => element !== (spec.passiveElement ?? '') && onEdit({ passiveElement: element })} />
          </label>
        )}
      </section>

      {spec.removed.length > 0 && (
        <p className="notice">
          Removed: {spec.removed.map((r) => `${r.element} (${r.reason})`).join('; ')}
        </p>
      )}
      <div className="row">
        <button className="primary" disabled={busy || forge.stages.spec.status !== 'ready'} onClick={onConfirm}>
          Confirm spec
        </button>
      </div>
    </div>
  )
}
