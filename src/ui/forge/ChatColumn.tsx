import { useEffect, useRef, useState } from 'react'
import type { DirectorOutput } from '../../forge/director/schema'
import type { Forge } from '../../forge/types'

/** The director chat (R7-R10). Open while the spec is being shaped; read-only afterwards. */
export function ChatColumn({ forge, busy, onSend }: { forge: Forge; busy: boolean; onSend: (text: string, answers?: Record<string, string>) => void }) {
  const [text, setText] = useState('')
  const log = useRef<HTMLOListElement>(null)
  const open = forge.current === 'spec'
  const director = forge.stages.spec.inputs.director as DirectorOutput | undefined
  const questions = director?.questions ?? []

  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [forge.chat.length, busy])

  function send(event: React.FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    onSend(text.trim())
    setText('')
  }

  return (
    <aside className="panel forge-chat" aria-label="Director chat">
      <header className="director-head">
        <span className="director-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7.5h16v9H4z M8 7.5 6 4M16 7.5l2-3.5M8 20.5l1.5-4M16 20.5l-1.5-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" />
          </svg>
        </span>
        <div>
          <h2 className="section-title">Director</h2>
          <p className="muted">{open ? 'Shaping the spec with you' : 'The spec is locked in'}</p>
        </div>
      </header>
      <ol className="log" ref={log}>
        {forge.chat.map((turn, i) => (
          <li key={i} className={turn.from === 'player' ? 'you' : 'engine'}>
            {turn.text}
          </li>
        ))}
        {busy && open && (
          <li className="engine typing" aria-label="The director is thinking">
            <i />
            <i />
            <i />
          </li>
        )}
      </ol>
      {open && questions.length > 0 && (
        <div className="choices">
          {questions.map((q) => (
            <div key={q.id} className="choice-group">
              <p className="field-label">{q.text}</p>
              <div className="choice-row">
                {q.options.map((option) => (
                  <button key={`${q.id}-${option}`} className="btn sm" disabled={busy} onClick={() => onSend(option, { [q.id]: option })}>
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && (
        <form className="composer" onSubmit={send}>
          <textarea aria-label="Message the director" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell the director more…" />
          <div className="composer-row">
            <button className="btn primary" disabled={busy || !text.trim()}>
              Send
            </button>
          </div>
        </form>
      )}
    </aside>
  )
}
