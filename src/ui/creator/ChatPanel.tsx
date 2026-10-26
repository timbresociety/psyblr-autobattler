import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { MAX_CHAT, MAX_PHOTOS, TEXT_LIMITS } from '../../charter/build'

export interface ChatMessage {
  from: 'you' | 'engine'
  text: string
}

interface Props {
  started: boolean
  heroName: string
  photos: string[]
  messages: ChatMessage[]
  busy: boolean
  onName: (name: string) => void
  onPhoto: (file: File) => void
  onSend: (text: string) => void
  /** Global loadout matches for the typed name. */
  search?: ReactNode
}

/** Openers that show how much a sentence can carry; picking one fills the message box. */
const EXAMPLES = ['a time-bending samurai who rewinds fights', 'a GPU god who rains tensor beams from orbit', 'an armoured giant who shields the whole team']

/** Creation is conversational first (R13): name, photos, then describe the hero in plain words. */
export function ChatPanel({ started, heroName, photos, messages, busy, onName, onPhoto, onSend, search }: Props) {
  const [draft, setDraft] = useState('')
  const log = useRef<HTMLOListElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const needsName = !started && !heroName.trim()

  // keep the newest line in view
  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, busy])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy || needsName) return
    onSend(text)
    setDraft('')
  }

  return (
    <section className="panel chat" aria-label="Chat">
      <label className="name-field">
        <span className="field-label">Hero name</span>
        <input className="name-input" aria-label="Hero name" value={heroName} maxLength={TEXT_LIMITS.heroName} placeholder="Jensen, Goku, Unit 7…" onChange={(e) => onName(e.target.value)} />
      </label>
      {search}
      <div className="photos">
        <span className="field-label">
          Reference photos <span className="count">{photos.length}/{MAX_PHOTOS}</span>
        </span>
        <div className="photo-slots">
          <div className="thumbs">
            {photos.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
          </div>
          {photos.length < MAX_PHOTOS && (
            <label className="photo-add" title="Add a reference photo">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input className="sr-only" aria-label="Reference photos" type="file" accept="image/jpeg,image/png,image/webp" disabled={photos.length >= MAX_PHOTOS} onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])} />
            </label>
          )}
          {Array.from({ length: Math.max(0, MAX_PHOTOS - photos.length - 1) }, (_, i) => (
            <span key={i} className="photo-empty" aria-hidden="true" />
          ))}
        </div>
      </div>
      <ol className="log" ref={log} aria-live="polite">
        {!started && messages.length === 0 && <li className="engine greeting">Tell me who your hero is. A sentence is enough: I draft the role, the kit and the stats, and you change anything you like.</li>}
        {messages.map((m, i) => (
          <li key={i} className={m.from}>
            {m.text}
          </li>
        ))}
        {busy && (
          <li className="engine typing" aria-label="The engine is thinking">
            <i />
            <i />
            <i />
          </li>
        )}
      </ol>
      {!started && messages.length === 0 && (
        <div className="examples">
          <p className="field-label">Describe your hero in a sentence, or start from one of these:</p>
          <ul>
            {EXAMPLES.map((text) => (
              <li key={text}>
                <button type="button" className="example" onClick={() => (setDraft(text), box.current?.focus())}>
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={submit} className="composer">
        <textarea
          ref={box}
          aria-label="Message"
          value={draft}
          rows={3}
          maxLength={MAX_CHAT}
          placeholder={started ? 'Ask for changes: "more agile, less armor"' : 'Describe your hero: "a time-bending samurai who rewinds fights"'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter while an input method is composing confirms the candidate; it must not send
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
          }}
        />
        <div className="composer-row">
          {needsName && <span className="composer-hint">Name your hero to start.</span>}
          <button type="submit" className={`btn primary${started ? '' : ' big'}`} disabled={busy || needsName}>
            {started ? 'Send' : 'Forge hero'}
          </button>
        </div>
      </form>
    </section>
  )
}
