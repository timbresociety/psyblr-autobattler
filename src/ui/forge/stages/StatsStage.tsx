import { useEffect, useState } from 'react'
import { setStatTarget, type Build } from '../../../charter/build'
import type { Forge } from '../../../forge/types'
import { StatSplit } from '../../creator/StatSplit'

/** The final stat split, then the balance gate and publish (R20, R21). */
export function StatsStage({ forge, busy, onCheck, onPublish }: { forge: Forge; busy: boolean; onCheck: (spread: Build['spread']) => void; onPublish: () => void }) {
  const [build, setBuild] = useState(forge.build!)
  useEffect(() => setBuild(forge.build!), [forge.build])
  const s = forge.stages.stats
  const changed = JSON.stringify(build.spread) !== JSON.stringify(forge.build!.spread)
  return (
    <div className="stage-body">
      <StatSplit
        build={build}
        onTarget={(stat, value) => {
          const result = setStatTarget(build, stat, value)
          if (result.ok) setBuild(result.build)
        }}
      />
      {s.failure && <p className="inline-error">{s.failure}</p>}
      <div className="row">
        <button disabled={busy || (s.status === 'ready' && !changed)} onClick={() => onCheck(build.spread)}>
          {s.status === 'ready' && !changed ? 'Split saved' : 'Save split'}
        </button>
        <button className="primary" disabled={busy || s.status !== 'ready' || changed} onClick={onPublish}>
          Publish hero
        </button>
      </div>
    </div>
  )
}
