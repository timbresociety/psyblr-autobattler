import { useState, type FormEvent, type ReactNode } from 'react'

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

/** Creation is conversational first (R13): name, photos, then describe the hero in plain words. */
export function ChatPanel({ started, heroName, photos, messages, busy, onName, onPhoto, onSend, search }: Props) {
  const [draft, setDraft] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy || (!started && !heroName.trim())) return
    onSend(text)
    setDraft('')
  }
  return (
    <section className="panel chat" aria-label="Chat">
      <label className="field">
        <span>Hero name</span>
        <input aria-label="Hero name" value={heroName} maxLength={60} placeholder="Jensen, Goku, Superintelligence Unit 7…" onChange={(e) => onName(e.target.value)} />
      </label>
      {search}
      <label className="field photos">
        <span>Reference photos</span>
        <input aria-label="Reference photos" type="file" accept="image/jpeg,image/png,image/webp" disabled={photos.length >= 3} onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])} />
        <div className="thumbs">
          {photos.map((src) => (
            <img key={src} src={src} alt="" />
          ))}
        </div>
      </label>
      <ol className="log" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i} className={m.from}>
            {m.text}
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="composer">
        <textarea
          aria-label="Message"
          value={draft}
          rows={3}
          maxLength={500}
          placeholder={started ? 'Ask for changes: "more agile, less armor"' : 'Describe your hero: "a time-bending samurai who rewinds fights"'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e)
          }}
        />
        <button type="submit" className="primary" disabled={busy}>
          {started ? 'Send' : 'Forge hero'}
        </button>
      </form>
    </section>
  )
}
