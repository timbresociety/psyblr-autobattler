import { useState } from 'react'
import type { DirectorOutput } from '../../forge/director/schema'
import type { Forge } from '../../forge/types'

/** The director chat (R7-R10). Open while the spec is being shaped; read-only afterwards. */
export function ChatColumn({ forge, busy, onSend }: { forge: Forge; busy: boolean; onSend: (text: string, answers?: Record<string, string>) => void }) {
  const [text, setText] = useState('')
  const open = forge.current === 'spec'
  const director = forge.stages.spec.inputs.director as DirectorOutput | undefined
  const questions = director?.questions ?? []

  function send(event: React.FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    onSend(text.trim())
    setText('')
  }

  return (
    <aside className="panel chat forge-chat" aria-label="Director chat">
      <h2>Director</h2>
      <ol className="log">
        {forge.chat.map((turn, i) => (
          <li key={i} className={turn.from === 'player' ? 'you' : 'engine'}>
            {turn.text}
          </li>
        ))}
      </ol>
      {open && questions.length > 0 && (
        <div className="choices">
          {questions.map((q) =>
            q.options.map((option) => (
              <button key={`${q.id}-${option}`} disabled={busy} onClick={() => onSend(option, { [q.id]: option })}>
                {option}
              </button>
            )),
          )}
        </div>
      )}
      {open && (
        <form className="composer" onSubmit={send}>
          <textarea aria-label="Message the director" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell the director more…" />
          <button className="primary" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
      )}
    </aside>
  )
}
