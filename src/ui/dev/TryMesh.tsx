import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { STARTERS, starterBuild } from '../../arena/starters'
import { triedHeroes, type TriedHero } from '../../kit/bench/hero-file'
import { Fight, KitReel } from '../arena/ArenaScreen'
import type { StagingResult } from '../arena/staging/Staging'
import { tryItStaging } from '../arena/staging/try-it'

/** `/dev/try` (dev builds only): a generated test hero on a training dummy, with its own kit or a starter's. `?mesh=` picks it, `&kit=` the starter, `&reel=` plays a take of the kit reel. */
export function TryMesh() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [heroes, setHeroes] = useState<readonly TriedHero[]>()
  const [round, setRound] = useState(0)
  useEffect(() => void triedHeroes().then(setHeroes), [])
  const hero = heroes?.find((h) => h.label === params.get('mesh'))
  const starter = STARTERS.find((s) => s.id === params.get('kit')) ?? STARTERS[0]
  if (hero) {
    const build = hero.build ?? starterBuild(starter)
    if (build.look) build.look.gender = hero.gender
    else build.look = { gender: hero.gender, colors: {} }
    if (params.has('reel')) return <KitReel build={build} onClose={() => navigate('/dev/try')} start={params.get('reel') ?? undefined} />
    // the open floor at the blue muster, clear of the ramps the try-it lane now backs on to
    const staged: StagingResult = { ...tryItStaging(build), formation: [[{ hero: 0, x: 0, z: -36 }], [{ hero: 1, x: 0, z: -29 }]] }
    return <Fight key={round} staged={staged} onBack={() => navigate('/dev/try')} onRestart={() => setRound((r) => r + 1)} back="Back to the heroes" />
  }
  return (
    <section className="credits">
      <h1>Try a generated hero</h1>
      <p>One without a kit of its own fights with the first starter's. Add &kit= and a starter's id to change it.</p>
      <ul>
        {heroes?.map((h) => (
          <li key={h.label}>
            <a href={`/dev/try?mesh=${h.label}`}>{h.label}</a> · <a href={`/dev/try?mesh=${h.label}&reel=combo`}>kit reel</a>
          </li>
        ))}
      </ul>
      <p>
        <Link to="/dev">Back to the dev tools</Link>
      </p>
    </section>
  )
}
