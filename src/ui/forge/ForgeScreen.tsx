import { useCallback, useEffect, useRef, useState } from 'react'
import { stagePrice } from '../../forge/pricing'
import type { HeroResult } from '../api'
import { ChatColumn } from './ChatColumn'
import { Credits } from './Credits'
import { ApiError, liveForgeDeps, type ForgeAction, type ForgeDeps, type ForgeView, type SessionView } from './forge-api'
import { SignIn } from './SignIn'
import { StagePanel } from './StagePanel'
import './forge.css'

/** The suggested opening prompt (R7): shows the player how much the director can run with. */
export const EXAMPLE_PROMPT = 'Jensen Huang in a Raiden-like avatar as a GPU god, with skills around CUDA, Circle Jerk, Stonks and other memes'

const FORGE_KEY = 'psyblr.forgeId'
export const POLL_MS = 2_000

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

/** Loadout first; forge new only when nothing fits (R1, R2, KTD11). */
export function ForgeScreen({ deps = liveForgeDeps }: { deps?: ForgeDeps }) {
  const [session, setSession] = useState<SessionView>()
  const [mode, setMode] = useState<Mode>('entry')
  const [view, setView] = useState<ForgeView>()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<HeroResult[]>([])
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT)
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
        remember(next.forge.id)
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

  // sign-in links land here with ?signin=<token>; then reopen the forge the player left
  useEffect(() => {
    let live = true
    ;(async () => {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('signin')
      if (token) {
        params.delete('signin')
        window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
        try {
          await deps.verifySignIn(token)
        } catch (e) {
          if (live) setError(e instanceof Error ? e.message : 'that sign-in link did not work')
        }
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
      return
    }
    let live = true
    const timer = setTimeout(() => deps.search(q).then((r) => live && setResults(r), () => live && setResults([])), 250)
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

  async function begin() {
    await run(async () => {
      const created = await deps.create({ prompt })
      return deps.act(created.forge.id, { type: 'chat', text: prompt })
    })
  }

  if (view) {
    const stage = view.forge.current
    const need = stage === 'published' ? undefined : stagePrice(stage) || undefined
    return (
      <div className="forge">
        <header className="forge-head">
          <h1>{view.forge.spec?.heroName ?? 'New hero'}</h1>
          <button
            className="ghost"
            onClick={() => {
              remember(null)
              setView(undefined)
              setMode('entry')
            }}
          >
            Close forge
          </button>
        </header>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="forge-grid">
          <ChatColumn forge={view.forge} busy={busy} onSend={(text, answers) => act({ type: 'chat', text, answers })} />
          <div className="forge-main">
            <StagePanel forge={view.forge} balance={view.balance} busy={busy} act={act} sizeCost={(size) => deps.sizeCost(view.forge.build!, size)} />
            {need !== undefined && <Credits deps={deps} balance={view.balance} need={need} onBalance={(balance) => setView((v) => v && { ...v, balance })} />}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="forge forge-entry">
      <h1>Hero Forge</h1>
      <p className="muted">Look for your hero in the global loadout first. Forge a new one when nothing fits.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {mode === 'sign-in' ? (
        <SignIn deps={deps} onCancel={() => setMode('entry')} />
      ) : mode === 'prompt' ? (
        <section className="panel" aria-label="New hero">
          <label className="field">
            <span>Describe your hero</span>
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <div className="row">
            <button className="primary" disabled={busy || !prompt.trim()} onClick={begin}>
              Start forging
            </button>
            <button className="ghost" onClick={() => setMode('entry')}>
              Back
            </button>
          </div>
        </section>
      ) : (
        <section className="panel" aria-label="Global loadout">
          <label className="field">
            <span>Search the global loadout</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Goku, Jensen, Luffy…" />
          </label>
          {results.length > 0 && (
            <ul className="loadout-results">
              {results.map((hero) => (
                <li key={hero.id}>
                  <strong>{hero.name}</strong> <small>{hero.roleId}</small>
                  <button disabled={busy} onClick={() => run(async () => (await deps.addHero(hero.id), setNotice(`${hero.name} was added to your heroes in the Creator.`)))}>
                    Add free
                  </button>
                  <button className="ghost" disabled={busy} onClick={() => forgeNew(hero.id)}>
                    Remix in forge
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button className="primary" disabled={!session} onClick={() => forgeNew()}>
              Forge new
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
