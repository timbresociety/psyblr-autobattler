import { useCallback, useEffect, useRef, useState } from 'react'
import { stagePrice } from '../../forge/pricing'
import type { RoleId } from '../../charter/types'
import type { HeroResult } from '../api'
import { HeroPortrait } from '../common/portrait'
import { RoleBadge } from '../common/RoleIcon'
import { ChatColumn } from './ChatColumn'
import { CreditChip, Credits } from './Credits'
import { ApiError, liveForgeDeps, type ForgeAction, type ForgeDeps, type ForgeView, type SessionView } from './forge-api'
import { SignIn } from './SignIn'
import { StagePanel, StageTrack } from './StagePanel'
import './forge.css'

/** The suggested opening prompt (R7): shows the player how much the director can run with. */
export const EXAMPLE_PROMPT = 'Jensen Huang in a Raiden-like avatar as a GPU god, with skills around CUDA, Circle Jerk, Stonks and other memes'

const FORGE_KEY = 'psyblr.forgeId'
export const POLL_MS = 2_000
const MAX_REFERENCES = 3

const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(FORGE_KEY, id)
    else localStorage.removeItem(FORGE_KEY)
  } catch {
    // storage blocked: reload just won't reopen the forge
  }
}
const remembered = () => {
  try {
    return localStorage.getItem(FORGE_KEY)
  } catch {
    return null
  }
}

type Mode = 'entry' | 'sign-in' | 'prompt'

/**
 * Sign-in links land here with ?signin=<token>. The token is single-use, so it is verified once per page load and
 * every mount (StrictMode mounts twice) awaits the same verification before asking for the session.
 */
let verifying: Promise<void> | undefined
function verifyFromUrl(deps: ForgeDeps): Promise<void> {
  if (!verifying) {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('signin')
    if (token) {
      params.delete('signin')
      const search = params.toString().replace(/=(?=&|$)/g, '')
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? `?${search}` : ''}`)
    }
    verifying = token ? deps.verifySignIn(token) : Promise.resolve()
  }
  return verifying
}

const STEPS = [
  ['Describe it', 'A prompt and up to three reference images.'],
  ['Confirm the spec', 'The director drafts it; change anything first.'],
  ['Generate it', 'Sheet, mesh, motion and skills, each one confirmed before it is paid for.'],
  ['Publish it', 'Set the stat split; the balance check signs it off.'],
] as const

/** Loadout first; forge new only when nothing fits (R1, R2, KTD11). */
export function ForgeScreen({ deps = liveForgeDeps }: { deps?: ForgeDeps }) {
  const [session, setSession] = useState<SessionView>()
  const [mode, setMode] = useState<Mode>('entry')
  const [view, setView] = useState<ForgeView>()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HeroResult[]>([])
  const [searched, setSearched] = useState('')
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT)
  const [refs, setRefs] = useState<{ preview: string; url?: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // only the latest request may update the screen (the creator's stale-result guard)
  const seq = useRef(0)

  const run = useCallback(async (work: () => Promise<ForgeView | void>) => {
    const mine = ++seq.current
    setBusy(true)
    setError('')
    try {
      const next = await work()
      if (mine !== seq.current) return
      if (next) {
        setView(next)
        // a published forge is finished: the next visit opens on the loadout again
        remember(next.forge.current === 'published' ? null : next.forge.id)
      }
    } catch (e) {
      if (mine !== seq.current) return
      if (e instanceof ApiError && e.status === 401) setSession({ signedIn: false })
      if (e instanceof ApiError && e.status === 404) remember(null)
      setError(e instanceof Error ? e.message : 'something went wrong')
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }, [])

  // finish any sign-in link, then reopen the forge the player left
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        await verifyFromUrl(deps)
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'that sign-in link did not work')
      }
      const s = await deps.session().catch(() => ({ signedIn: false }))
      if (!live) return
      setSession(s)
      const id = remembered()
      if (s.signedIn && id) run(() => deps.get(id))
    })()
    return () => {
      live = false
    }
  }, [deps, run])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearched('')
      return
    }
    let live = true
    const timer = setTimeout(
      () =>
        deps.search(q).then(
          (r) => live && (setResults(r), setSearched(q)),
          () => live && (setResults([]), setSearched(q)),
        ),
      250,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, deps])

  // while a stage generates, poll; each poll also advances the provider work (KTD1)
  const generating = view && view.forge.current !== 'published' && view.forge.stages[view.forge.current].status === 'generating'
  const [pollTick, setPollTick] = useState(0)
  const forgeId = view?.forge.id
  useEffect(() => {
    if (!generating || !forgeId) return
    const timer = setTimeout(() => {
      const next = () => setPollTick((t) => t + 1)
      // a hidden tab waits; the forge keeps going server-side and catches up on the next visible poll
      if (document.hidden) return next()
      const mine = seq.current
      deps
        .get(forgeId)
        .then(
          (fresh) => mine === seq.current && setView((prev) => (prev && prev.forge.version === fresh.forge.version && prev.balance === fresh.balance ? prev : fresh)),
          () => undefined,
        )
        .finally(next)
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [generating, forgeId, pollTick, deps])

  const act = (action: ForgeAction) => view && run(() => deps.act(view.forge.id, action))

  function forgeNew(referenceHeroId?: string) {
    if (!session?.signedIn) return setMode('sign-in')
    if (referenceHeroId) return run(() => deps.create({ referenceHeroId }))
    setMode('prompt')
  }

  async function signedIn() {
    const s = await deps.session().catch(() => ({ signedIn: false }))
    setSession(s)
    setMode(s.signedIn ? 'prompt' : 'sign-in')
  }

  async function signOut() {
    await deps.signOut().catch(() => undefined)
    remember(null)
    setSession({ signedIn: false })
    setMode('entry')
  }

  async function addRef(file: File) {
    if (!deps.uploadPhoto || refs.length >= MAX_REFERENCES) return
    const preview = URL.createObjectURL(file)
    setRefs((r) => [...r, { preview }])
    const url = await deps.uploadPhoto(file)
    if (url) return setRefs((r) => r.map((x) => (x.preview === preview ? { preview, url } : x)))
    setRefs((r) => r.filter((x) => x.preview !== preview))
    URL.revokeObjectURL(preview)
    setError("Couldn't upload that image. Try again in a moment.")
  }

  async function begin() {
    const referenceUrls = refs.flatMap((r) => (r.url ? [r.url] : []))
    await run(async () => {
      const created = await deps.create(referenceUrls.length ? { prompt, referenceUrls } : { prompt })
      return deps.act(created.forge.id, { type: 'chat', text: prompt })
    })
  }

  const closeForge = () => {
    remember(null)
    setView(undefined)
    setMode('entry')
  }

  if (view) {
    const stage = view.forge.current
    const need = stage === 'published' ? undefined : stagePrice(stage) || undefined
    return (
      <div className="forge forge-run">
        <header className="run-head">
          <div className="run-title">
            <p className="kicker">{stage === 'published' ? 'Forged' : 'Forging'}</p>
            <h1 className="title">{view.forge.spec?.heroName ?? 'New hero'}</h1>
          </div>
          <CreditChip balance={view.balance} />
          <button className="btn ghost" onClick={closeForge}>
            Close forge
          </button>
        </header>
        <StageTrack forge={view.forge} />
        {error && (
          <p className="inline-error banner" role="alert">
            {error}
          </p>
        )}
        <div className="run-grid">
          <ChatColumn forge={view.forge} busy={busy} onSend={(text, answers) => act({ type: 'chat', text, answers })} />
          <div className="run-main">
            {stage !== 'published' && <Credits deps={deps} balance={view.balance} need={need} onBalance={(balance) => setView((v) => v && { ...v, balance })} />}
            <StagePanel forge={view.forge} balance={view.balance} busy={busy} act={act} sizeCost={(size) => deps.sizeCost(view.forge.build!, size)} onDone={closeForge} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="forge forge-entry">
      <header className="lobby-head">
        <div>
          <h1 className="title">Hero Forge</h1>
          <p className="lead">Look for your hero in the global loadout first. Forge a new one when nothing fits.</p>
        </div>
        {session?.signedIn && (
          <div className="account">
            <span className="muted">Signed in{session.email ? ` as ${session.email}` : ''}</span>
            <button className="btn quiet sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </header>
      {error && (
        <p className="inline-error banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      {mode === 'sign-in' ? (
        <div className="lobby-center">
          <SignIn deps={deps} onCancel={() => setMode('entry')} onSignedIn={signedIn} />
        </div>
      ) : mode === 'prompt' ? (
        <section className="panel prompt-card" aria-label="New hero">
          <h2 className="section-title">New hero</h2>
          <label className="field">
            <span>Describe your hero</span>
            <textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          {deps.uploadPhoto && (
            <div className="refs">
              <span className="field-label">
                Reference images <span className="count">{refs.length}/{MAX_REFERENCES}</span>
              </span>
              <div className="photo-slots">
                {refs.map((r) => (
                  <img key={r.preview} src={r.preview} alt="" className={r.url ? '' : 'uploading'} />
                ))}
                {refs.length < MAX_REFERENCES && (
                  <label className="photo-add" title="Add a reference image">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <input className="sr-only" aria-label="Reference images" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && addRef(e.target.files[0])} />
                  </label>
                )}
              </div>
            </div>
          )}
          <p className="muted">The director reads your prompt, asks what it needs and drafts a spec sheet. Nothing is generated or charged until you confirm it.</p>
          <div className="row">
            <button className="btn primary big" disabled={busy || !prompt.trim() || refs.some((r) => !r.url)} onClick={begin}>
              Start forging
            </button>
            <button className="btn quiet" onClick={() => setMode('entry')}>
              Back
            </button>
          </div>
        </section>
      ) : (
        <div className="lobby-grid">
          <section className="panel search-panel" aria-label="Global loadout">
            <label className="field search-field">
              <span>Search the global loadout</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Goku, Jensen, Luffy…" />
            </label>
            {results.length > 0 ? (
              <ul className="loadout-results">
                {results.map((hero) => (
                  <li key={hero.id} className="result-card">
                    <HeroPortrait hero={{ key: `hero:${hero.id}`, heroName: hero.name, roleId: hero.roleId as RoleId }} photo={hero.photo} />
                    <span className="result-who">
                      <strong>{hero.name}</strong>
                      <span className="result-meta">
                        <RoleBadge role={hero.roleId as RoleId} />
                        <small>used {hero.useCount}×</small>
                      </span>
                    </span>
                    <span className="result-actions">
                      <button className="btn sm primary" disabled={busy} onClick={() => run(async () => (await deps.addHero(hero.id), setNotice(`${hero.name} was added to your heroes in the Creator.`)))}>
                        Add free
                      </button>
                      <button className="btn sm ghost" disabled={busy} onClick={() => forgeNew(hero.id)}>
                        Remix in forge
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="search-empty muted">{searched ? `No hero called “${searched}” yet. Forge it.` : 'Type a name to see who is already here. Adding a hero is free.'}</p>
            )}
          </section>
          <aside className="panel forge-new-card">
            <h2 className="section-title">Forge a new hero</h2>
            <ol className="steps">
              {STEPS.map(([title, text]) => (
                <li key={title}>
                  <b>{title}</b>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
            <p className="muted">Your first hero is free, retries included.</p>
            <button className="btn primary big" disabled={!session} onClick={() => forgeNew()}>
              Forge new
            </button>
          </aside>
        </div>
      )}
    </div>
  )
}
