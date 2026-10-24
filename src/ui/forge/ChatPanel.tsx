import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { MAX_CHAT, TEXT_LIMITS } from '../../charter/build'

export interface ChatMessage {
  from: 'you' | 'engine'
  text: string
}

interface Props {
  started: boolean
  /** True while the Forge's reading of the hero is open: a message corrects it. */
  reading?: boolean
  heroName: string
  messages: ChatMessage[]
  busy: boolean
  onName: (name: string) => void
  onSend: (text: string) => void
  /** The reference image drop zone. */
  refs?: ReactNode
}

/** Openers that show how much a sentence can carry; picking one fills the message box. */
const EXAMPLES = ['a time-bending samurai who rewinds fights', 'a GPU god who rains tensor beams from orbit', 'an armoured giant who shields the whole team']

/**
 * Making a hero is conversational first (R13): reference images, a name if you have one, then the hero in plain words.
 * The prompt names the hero when the name is left blank.
 */
export function ChatPanel({ started, reading = false, heroName, messages, busy, onName, onSend, refs }: Props) {
  const [draft, setDraft] = useState('')
  const log = useRef<HTMLOListElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // keep the newest line in view
  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, busy])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    onSend(text)
    setDraft('')
  }

  return (
    <section className="panel chat" aria-label="Chat">
      <label className="name-field">
        <span className="field-label">Hero name</span>
        <input className="name-input" aria-label="Hero name" value={heroName} maxLength={TEXT_LIMITS.heroName} placeholder={started ? 'Jensen, Goku, Unit 7…' : 'Optional: Jensen, Goku…'} onChange={(e) => onName(e.target.value)} />
      </label>
      {refs}
      <ol className="log" ref={log} aria-live="polite">
        {!started && messages.length === 0 && <li className="engine greeting">Tell me who your hero is: who they are, how they look, what their skills are called and what they do. I read it back to you, ask what I can't tell, and build only when you say so.</li>}
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
      {!started && !reading && messages.length === 0 && (
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
          placeholder={started ? 'Ask for changes: "more agile, less armor"' : reading ? 'Tell me what I got wrong: "no hat, give him a red jacket"' : 'Describe your hero: "a time-bending samurai who rewinds fights"'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter while an input method is composing confirms the candidate; it must not send
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
          }}
        />
        <div className="composer-row">
          {!started && !reading && !heroName.trim() && <span className="composer-hint">The prompt can name it.</span>}
          <button type="submit" className={`btn primary${started || reading ? '' : ' big'}`} disabled={busy || !draft.trim()}>
            {started ? 'Send' : reading ? 'Correct' : 'Read my hero'}
          </button>
        </div>
      </form>
    </section>
  )
}
