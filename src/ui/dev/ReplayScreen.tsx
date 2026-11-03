import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { listRecordings, loadRecording } from '../../arena/client/recordings'
import type { Recording } from '../../arena/engine/replay'
import { Fight } from '../arena/ArenaScreen'
import type { StagingResult } from '../arena/staging/Staging'

/**
 * `/dev/replay` (development only): the matches played on this machine, newest first, each with its marks; one opens
 * as the match again, tick for tick, its player's inputs played back. In the page, `__arena.seat` steps it frame by
 * frame and `__arena.recording` is gone (a replay records nothing).
 */
export function ReplayScreen() {
  const { name } = useParams()
  const navigate = useNavigate()
  const [names, setNames] = useState<string[]>()
  const [rec, setRec] = useState<Recording>()
  const [error, setError] = useState<string>()
  const [round, setRound] = useState(0)

  useEffect(() => {
    setRec(undefined)
    setError(undefined)
    if (name) loadRecording(name).then(setRec, (e: unknown) => setError(String(e)))
    else listRecordings().then(setNames, (e: unknown) => setError(String(e)))
  }, [name])

  if (error)
    return (
      <section className="credits">
        <h1>Replays</h1>
        <p role="alert">{error}</p>
        <Link to="/dev/replay">All replays</Link>
      </section>
    )
  if (name && !rec) return <p className="screen-loading">Loading the recording…</p>
  if (rec) {
    if (!rec.view)
      return (
        <section className="credits">
          <h1>Replays</h1>
          <p>This recording has nothing to draw it with.</p>
        </section>
      )
    return <Fight key={round} staged={rec.view as StagingResult} replay={rec} onBack={() => navigate('/dev/replay')} onRestart={() => setRound((r) => r + 1)} back="All replays" />
  }
  return (
    <section className="credits">
      <h1>Replays</h1>
      {!names ? (
        <p>Loading…</p>
      ) : !names.length ? (
        <p>No matches recorded yet. Play one; F9 marks a moment.</p>
      ) : (
        <ul>
          {names.map((n) => (
            <li key={n}>
              <Link to={`/dev/replay/${encodeURIComponent(n)}`}>{n.replace(/\.json$/, '')}</Link>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link to="/dev">Dev tools</Link>
      </p>
    </section>
  )
}
