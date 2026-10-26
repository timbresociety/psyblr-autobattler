import { useState, type FormEvent, type ReactNode } from 'react'
import { BUILD_SLOTS, MAX_CHAT, TEXT_LIMITS } from '../../charter/build'
import type { HeroLook, LookColor, PieceKind } from '../../charter/look'
import { SIZE_CLASSES, SIZES } from '../../charter/sizes'
import { getTemplate } from '../../charter/templates/catalog'
import { PIECE_PRICE } from '../../forge/pricing'
import { answerQuestion, editReadingSkill, templateBlurb, withRole, type Reading, type ReadingSource } from '../../forge/reading'
import { SkillIcon } from '../common/SkillIcon'
import { SLOT_LABEL } from './labels'
import type { GearChoice } from './look'
import { LookPanel } from './LookPanel'
import { RoleSwitcher } from './RoleSwitcher'

const SOURCE_LABEL: Record<ReadingSource, string> = { 'claude-code': 'Read by your Claude Code', claude: 'Read by Claude', offline: 'Read offline' }
const KIND_LABEL: Record<PieceKind, string> = { head: 'Head', face: 'Face', hand: 'Hand', offhand: 'Off-hand', back: 'Back' }

interface Props {
  reading: Reading
  /** The plinth, previewing the look as the card changes it. */
  stage: ReactNode
  gear: GearChoice[]
  /** The look as drawn, every colour filled in. */
  look: HeroLook & { colors: Record<LookColor, string> }
  canFace: boolean
  onChange: (reading: Reading) => void
  onGear: (index: number, wear: boolean) => void
}

/**
 * The Forge's reading of a hero, before anything is built: what it understood, what it couldn't tell, and every part
 * of it to change. The look rows are the Look panel's own; the kit shows each slot's name and what it does in the
 * player's words, beside the engine mechanic that will carry it. The plinth shows the look as it changes.
 */
export function ReadingCard({ reading, stage, gear, look, canFace, onChange, onGear }: Props) {
  const asks = reading.questions.length
  return (
    <>
      <section className="showcase reading" aria-label="Reading">
        {stage}
        <div className="hero-info reading-info">
          <header className="reading-head">
            <p className="reading-kicker">
              Here’s how I read <span className={`reading-source src-${reading.source}`}>{SOURCE_LABEL[reading.source]}</span>
            </p>
            <h1 className={`hero-name${reading.heroName.length > 16 ? ' long' : ''}`}>{reading.heroName}</h1>
            <p className="reading-summary">{reading.summary}</p>
          </header>
          {asks > 0 && (
            <section className="reading-questions" aria-label="Questions">
              <h2 className="section-title">{asks === 1 ? 'One question' : `${asks} questions`} before I build</h2>
              {reading.questions.map((q, i) => (
                <div key={q.about} className="question" role="group" aria-label={q.ask}>
                  <p className="question-ask">{q.ask}</p>
                  <div className="answers">
                    {q.options.map((o, k) => (
                      <button key={o.label} type="button" className={`answer${k === 0 ? ' best' : ''}`} onClick={() => onChange(answerQuestion(reading, i, o))}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
          <RoleSwitcher roleId={reading.roleId} onChange={(role) => onChange(withRole(reading, role))} />
          <div className="look-row reading-size">
            <span className="field-label">Size</span>
            <div className="seg" role="radiogroup" aria-label="Size">
              {SIZE_CLASSES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={reading.look.size === s} className={reading.look.size === s ? 'on' : ''} onClick={() => onChange({ ...reading, look: { ...reading.look, size: s } })}>
                  {SIZES[s].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <LookPanel
        look={look}
        canFace={canFace}
        onChange={({ colors, beard, ...rest }) => onChange({ ...reading, look: { ...reading.look, ...rest, ...(beard ? { beard } : {}), colors: { ...reading.look.colors, ...(colors ?? {}) } } })}
        onFace={(on) => onChange({ ...reading, look: { ...reading.look, wearFace: on } })}
      />
      <section className="look-panel reading-gear" aria-label="Gear as read">
        <header className="look-head">
          <h2 className="section-title">Gear</h2>
          <p className="muted">Everything in the repository is free to wear. What it lacks, you can generate once the hero is built.</p>
        </header>
        {gear.length === 0 ? (
          <p className="muted">Nothing to wear yet. Name a hat, a weapon or wings in a correction, or pick pieces after you build.</p>
        ) : (
          <ul className="wishes">
            {gear.map((c, i) => (
              <li key={c.wish.phrase} className={`wish${c.wear ? ' on' : ''}${c.entry ? ' found' : ' missing'}`}>
                <span className="wish-kind">{KIND_LABEL[c.wish.kind]}</span>
                <b className="wish-phrase">{c.wish.phrase}</b>
                <span className="wish-status">{c.entry ? `${c.entry.name}, free from the repository` : `Not in the repository yet. Generate it after you build, ${PIECE_PRICE} credits.`}</span>
                <label className="wish-toggle">
                  <input type="checkbox" checked={c.wear} onChange={(e) => onGear(i, e.target.checked)} />
                  {c.entry ? 'Wear' : 'Generate later'}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="look-panel reading-kit" aria-label="Kit as read">
        <header className="look-head">
          <h2 className="section-title">Kit</h2>
          <p className="muted">Your names and what each skill does, in your words. The engine carries each on one of its mechanics and sets every number.</p>
        </header>
        <ul className="read-skills">
          {BUILD_SLOTS.map((slot) => {
            const skill = reading.kit[slot]
            const template = getTemplate(skill.template)
            return (
              <li key={slot} className="read-skill">
                <SkillIcon template={template} slot={slot} size="sm" />
                <span className="kit-slot">{SLOT_LABEL[slot]}</span>
                <input className="read-name" aria-label={`${SLOT_LABEL[slot]} name`} value={skill.name} placeholder={template.name} maxLength={TEXT_LIMITS.name} onChange={(e) => onChange(editReadingSkill(reading, slot, { name: e.target.value }))} />
                <input className="read-does" aria-label={`What ${SLOT_LABEL[slot]} does`} value={skill.does} placeholder="What it does, in your words" maxLength={TEXT_LIMITS.flavour} onChange={(e) => onChange(editReadingSkill(reading, slot, { does: e.target.value }))} />
                <span className="read-mechanic" title={template.tags.join(', ')}>
                  Engine: {templateBlurb(template)}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

/** The reading's bar, where the balance check sits once a hero exists: a correction to read again with, and Build. */
export function ReadingBar({ busy, questions, onCorrect, onBuild }: { busy: boolean; questions: number; onCorrect: (note: string) => void; onBuild: () => void }) {
  const [note, setNote] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!note.trim() || busy) return
    onCorrect(note.trim())
    setNote('')
  }
  return (
    <section className="gate reading-bar" aria-label="Build">
      <form className="correct" onSubmit={submit}>
        <input aria-label="Correction" value={note} maxLength={MAX_CHAT} placeholder="Anything I got wrong? “no hat, give him a red jacket”" onChange={(e) => setNote(e.target.value)} />
        <button type="submit" className="btn ghost" disabled={busy || !note.trim()}>
          Read again
        </button>
      </form>
      <button type="button" className="btn primary big build" disabled={busy} onClick={onBuild} title={questions ? 'Unanswered questions keep my best guess' : undefined}>
        Build hero
      </button>
    </section>
  )
}
