import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router'

const BenchScreen = lazy(() => import('../arena/BenchScreen').then((m) => ({ default: m.BenchScreen })))
const SoakScreen = lazy(() => import('../arena/SoakScreen').then((m) => ({ default: m.SoakScreen })))
// John's lab, his moves and the generated heroes ship: they read only what is in public/
const TryMesh = lazy(() => import('./TryMesh').then((m) => ({ default: m.TryMesh })))
const JohnLab = lazy(() => import('./JohnLab').then((m) => ({ default: m.JohnLab })))
const JohnMoves = lazy(() => import('./JohnMoves').then((m) => ({ default: m.JohnMoves })))
// the physique bench, the clip sheets and the replays are development tools only, never in a production build
const PhysiqueBench = import.meta.env.DEV ? lazy(() => import('./PhysiqueBench').then((m) => ({ default: m.PhysiqueBench }))) : undefined
const ClipSheet = import.meta.env.DEV ? lazy(() => import('./ClipSheet').then((m) => ({ default: m.ClipSheet }))) : undefined
const ReplayScreen = import.meta.env.DEV ? lazy(() => import('./ReplayScreen').then((m) => ({ default: m.ReplayScreen }))) : undefined

const TOOLS: readonly { path: string; label: string; hint: string; dev?: boolean }[] = [
  { path: 'bench', label: 'Bench', hint: 'Twenty heroes under load: frame time, draws, triangles' },
  { path: 'soak', label: 'Soak', hint: 'Real 10 v 10s back to back for ten minutes, graded on frame time and memory' },
  { path: 'physique', label: 'Physique bench', hint: 'Twelve archetypes, face close-up and jiggle', dev: true },
  { path: 'clips', label: 'Clip sheets', hint: 'One clip on six bodies, frame by frame (the clip audit)', dev: true },
  { path: 'try', label: 'Try a generated hero', hint: 'A generated mesh on our skeleton, in the arena against a dummy' },
  { path: 'john', label: "John's lab", hint: 'Every kit interaction on John, every size and attitude, with the checklist' },
  { path: 'moves', label: "John's moves", hint: 'John alone, the camera circling him, a button for every move he plays' },
  { path: 'replay', label: 'Replays', hint: 'Matches played here, tick for tick, with their F9 marks', dev: true },
  { path: 'probe', label: 'Probe', hint: 'Scene rays and sound recording from a script, in any match', dev: true },
]

const wait = (what: string) => <p className="screen-loading">Loading {what}…</p>

/** `/dev/*` (GAME.md §11): the bench, soak, probe, physique bench and replays. */
export function DevRoutes() {
  return (
    <Routes>
      <Route index element={<DevIndex />} />
      <Route path="bench" element={<Suspense fallback={wait('the bench')}>{<BenchScreen />}</Suspense>} />
      <Route path="soak" element={<Suspense fallback={wait('the soak test')}>{<SoakScreen />}</Suspense>} />
      {PhysiqueBench && <Route path="physique" element={<Suspense fallback={wait('the physique bench')}>{<PhysiqueBench />}</Suspense>} />}
      {ClipSheet && <Route path="clips" element={<Suspense fallback={wait('the clip sheets')}>{<ClipSheet />}</Suspense>} />}
      <Route path="try" element={<Suspense fallback={wait('the hero')}>{<TryMesh />}</Suspense>} />
      <Route path="john" element={<Suspense fallback={wait("John's lab")}>{<JohnLab />}</Suspense>} />
      <Route path="moves" element={<Suspense fallback={wait("John's moves")}>{<JohnMoves />}</Suspense>} />
      {ReplayScreen && <Route path="replay/:name?" element={<Suspense fallback={wait('the replays')}>{<ReplayScreen />}</Suspense>} />}
      <Route path="probe" element={<ProbeHelp />} />
      <Route path="*" element={<DevIndex />} />
    </Routes>
  )
}

function DevIndex() {
  return (
    <section className="credits">
      <h1>Dev tools</h1>
      <ul>
        {TOOLS.filter((t) => import.meta.env.DEV || !t.dev).map((t) => (
          <li key={t.path}>
            <Link to={`/dev/${t.path}`}>{t.label}</Link> <span className="muted">{t.hint}</span>
          </li>
        ))}
      </ul>
      <p>
        <Link to="/">Back to the game</Link>
      </p>
    </section>
  )
}

/** The probe has no screen of its own: it rides along on every 3D screen in development. */
function ProbeHelp() {
  return (
    <section className="credits">
      <h1>Probe</h1>
      <p>
        In development every match, the range and the Forge stage install <code>window.__probe</code> (rays into the scene, what is on screen) and <code>window.__listen</code> (records what the game plays). Open a{' '}
        <Link to="/lobby">match</Link> or the <Link to="/range">range</Link> and drive it from a script.
      </p>
      <p>
        <Link to="/dev">All dev tools</Link>
      </p>
    </section>
  )
}
