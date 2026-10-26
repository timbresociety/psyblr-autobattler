import { useState, type FormEvent, type ReactNode } from 'react'
import { BUILD_SLOTS, MAX_CHAT, TEXT_LIMITS } from '../../charter/build'
import type { HeroLook, LookColor } from '../../charter/look'
import { ELEMENT_LABEL, FORM_LABEL, formOf } from '../../charter/skill-look'
import { SIZE_CLASSES, SIZES } from '../../charter/sizes'
import { getTemplate } from '../../charter/templates/catalog'
import { lookFromWords, templateWords } from '../../arena/recipes/looks'
import { FORM_TEMPLATES, formChange, transformOf } from '../../forge/form'
import { PIECE_PRICE } from '../../forge/pricing'
import { answerQuestion, editReadingSkill, formAnswer, templateBlurb, withForm, withRole, type Reading, type ReadingSource } from '../../forge/reading'
import { atRung, canReach, type WearWish } from '../../forge/wardrobe-read'
import type { LibraryEntry } from '../../kit/wear/library'
import { SkillIcon } from '../common/SkillIcon'
import { BodyPanel } from './BodyPanel'
import { SLOT_LABEL } from './labels'
import { bodyAfter, isGap, wishesAfter } from './look'
import { RoleSwitcher } from './RoleSwitcher'
import { LOOK_SLOT_LABEL, RUNGS, RUNG_LABEL } from './wardrobe'
import { WardrobePanel } from './WardrobePanel'

const SOURCE_LABEL: Record<ReadingSource, string> = { 'claude-code': 'Read by your Claude Code', claude: 'Read by Claude', offline: 'Read offline' }
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface Props {
  reading: Reading
  /** The plinth, previewing the look as the card changes it. */
  stage: ReactNode
  /** The look the reading dresses the hero in, as drawn: every colour filled in. */
  look: HeroLook & { colors: Record<LookColor, string> }
  /** Every item the card can offer: the library, then the community's items seen so far. */
  catalog: readonly LibraryEntry[]
  canFace: boolean
  onChange: (reading: Reading) => void
}

/**
 * The Forge's reading of a hero, before anything is built: what it understood, what it couldn't tell, and every part
 * of it to change. The body and wardrobe are the editor's own panels, writing back into the reading; the wishes show
 * what each answers and the rung it sits on; the kit shows each slot's name, what it does in the player's words, how
 * it looks, and the engine mechanic that will carry it. The plinth shows the look as it changes.
 */
export function ReadingCard({ reading, stage, look, catalog, canFace, onChange }: Props) {
  const asks = reading.questions.length
  const setWish = (wish: WearWish, next: WearWish | undefined) => onChange({ ...reading, wear: next ? reading.wear.map((w) => (w === wish ? next : w)) : reading.wear.filter((w) => w !== wish) })
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
      <BodyPanel look={look} canFace={canFace} onLook={(change) => onChange(bodyAfter(reading, look, change(look)))} onFace={(on) => onChange({ ...reading, look: { ...reading.look, wearFace: on } })} />
      <section className="look-panel reading-wear" aria-label="Wardrobe as read">
        <header className="look-head">
          <h2 className="section-title">Wardrobe as read</h2>
          <p className="muted">Anything in the library is free to wear, recolour and restyle. What it lacks, you generate once the hero is built, {PIECE_PRICE} credits each.</p>
        </header>
        {reading.wear.length === 0 ? (
          <p className="muted">Nothing named, so the role dresses the hero. Name a kimono, a hat or a sword in a correction, or pick below.</p>
        ) : (
          <ul className="wishes">
            {reading.wear.map((wish) => (
              <WishRow key={wish.slot} wish={wish} entry={wish.item ? catalog.find((e) => e.id === wish.item) : undefined} gap={isGap(wish, catalog)} onChange={(next) => setWish(wish, next)} />
            ))}
          </ul>
        )}
      </section>
      <WardrobePanel look={look} catalog={catalog} onLook={(change) => onChange({ ...reading, wear: wishesAfter(reading, look, change(look), catalog) })} />
      <section className="look-panel reading-kit" aria-label="Kit as read">
        <header className="look-head">
          <h2 className="section-title">Kit</h2>
          <p className="muted">Your names, what each skill does in your words, and how it looks. The engine carries each on one of its mechanics and sets every number.</p>
        </header>
        <ul className="read-skills">
          {BUILD_SLOTS.map((slot) => {
            const skill = reading.kit[slot]
            const template = getTemplate(skill.template)
            const kind = template.delivery.kind
            const seen = skill.look ?? lookFromWords({ own: [skill.name, skill.does].filter(Boolean).join(' '), ...templateWords(template), kind, slot })
            return (
              <li key={slot} className="read-skill">
                <SkillIcon template={template} slot={slot} size="sm" />
                <span className="kit-slot">{SLOT_LABEL[slot]}</span>
                <input className="read-name" aria-label={`${SLOT_LABEL[slot]} name`} value={skill.name} placeholder={template.name} maxLength={TEXT_LIMITS.name} onChange={(e) => onChange(editReadingSkill(reading, slot, { name: e.target.value }))} />
                <input className="read-does" aria-label={`What ${SLOT_LABEL[slot]} does`} value={skill.does} placeholder="What it does, in your words" maxLength={TEXT_LIMITS.flavour} onChange={(e) => onChange(editReadingSkill(reading, slot, { does: e.target.value }))} />
                <span className="read-mechanic" title={template.tags.join(', ')}>
                  Engine: {templateBlurb(template)}
                  {seen && (
                    <span className="read-look" aria-label={`${SLOT_LABEL[slot]} look`}>
                      {ELEMENT_LABEL[seen.element]} · {FORM_LABEL[formOf(seen, kind)]}
                    </span>
                  )}
                </span>
                {slot === 'ultimate' && transformOf(template) && (
                  <div className="seg read-form" role="radiogroup" aria-label="Transformation size">
                    {FORM_TEMPLATES.map((t) => (
                      <button key={t.id} type="button" role="radio" aria-checked={t.id === template.id} className={t.id === template.id ? 'on' : ''} title={formAnswer(t, reading).label} onClick={() => t.id !== template.id && onChange(withForm(reading, t.id))}>
                        {upper(formChange(t, reading.look.size))}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

/** One wish as read: where it goes, its words, what answers it, the rungs it can sit on, and a way to drop it. */
function WishRow({ wish, entry, gap, onChange }: { wish: WearWish; entry?: LibraryEntry; gap: boolean; onChange: (next: WearWish | undefined) => void }) {
  const status = wish.bare
    ? 'Nothing here, on purpose'
    : gap
      ? `Not in the library yet. Generate it once the hero is built.${entry ? ` ${entry.name} stands in until then.` : ''}`
      : `${entry!.name}${entry!.source === 'community' ? ', from the community' : ''}`
  return (
    <li className={`wish${wish.bare ? ' bare' : gap ? ' missing' : ' found'}`}>
      <span className="wish-kind">{LOOK_SLOT_LABEL[wish.slot]}</span>
      <span className="wish-words">
        <b className="wish-phrase">{wish.phrase}</b>
        <span className="wish-status">{status}</span>
      </span>
      {!wish.bare && (
        <div className="rungs" role="group" aria-label={`${wish.phrase} rungs`}>
          {RUNGS.map((r) => (
            <button key={r} type="button" aria-current={r === wish.rung ? 'step' : undefined} className={`rung${r === wish.rung ? ' on here' : ''}`} disabled={r !== wish.rung && !canReach(wish, r)} onClick={() => r !== wish.rung && onChange(atRung(wish, r))}>
              {RUNG_LABEL[r]}
              <small>{r === 'generate' ? `${PIECE_PRICE} credits` : 'Free'}</small>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="wish-remove" aria-label={`Remove ${wish.phrase}`} title="Let the role dress this slot" onClick={() => onChange(undefined)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </li>
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
