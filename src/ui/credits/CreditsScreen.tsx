import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { AnimIndex } from '../../arena/client/anim-index'

type Licences = NonNullable<AnimIndex['licences']>

/** The sources whose terms ask to be credited: only these are named here (the others are used on terms that don't). */
export function creditsOf(licences: Licences): { key: string; title: string; licence: string; url: string; credit: string }[] {
  return Object.entries(licences)
    .filter(([, l]) => l.credit)
    .map(([key, l]) => ({ key, title: l.title, licence: l.licence, url: l.url, credit: l.credit! }))
}

/** `/credits`: the credit each motion source asks for (GAME.md §12), read from the animation library's own index. */
export function CreditsScreen({ load = loadLicences }: { load?: () => Promise<Licences> }) {
  const [licences, setLicences] = useState<Licences>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let gone = false
    load()
      .then((l) => !gone && setLicences(l))
      .catch(() => !gone && setFailed(true))
    return () => {
      gone = true
    }
  }, [load])
  return (
    <section className="credits">
      <h1>Credits</h1>
      <p>The heroes move with motion-captured animation. These sources ask to be credited:</p>
      {failed && <p role="alert">The credits couldn&apos;t be loaded right now.</p>}
      {licences === undefined && !failed && <p className="muted">Loading…</p>}
      {licences && (
        <ul>
          {creditsOf(licences).map((c) => (
            <li key={c.key}>
              <h2>
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.title}
                </a>
              </h2>
              <p>{c.credit}</p>
              <p className="muted">Licence: {c.licence}</p>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link to="/">Back to your heroes</Link>
      </p>
    </section>
  )
}

async function loadLicences(): Promise<Licences> {
  const r = await fetch('/anim/standard/index.json')
  if (!r.ok) throw new Error(`index ${r.status}`)
  return ((await r.json()) as AnimIndex).licences ?? {}
}
