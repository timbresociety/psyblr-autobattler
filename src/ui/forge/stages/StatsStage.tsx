import { useState } from 'react'
import { setStatTarget, type Build } from '../../../charter/build'
import type { Forge } from '../../../forge/types'
import { StatSplit } from '../../creator/StatSplit'

/** The final stat split, then the balance gate and publish (R20, R21). */
export function StatsStage({ forge, busy, onCheck, onPublish }: { forge: Forge; busy: boolean; onCheck: (spread: Build['spread']) => void; onPublish: () => void }) {
  // the player's unsaved split; once saved, the server's build is the truth again
  const [draft, setDraft] = useState<{ base: Build; build: Build }>()
  const build = draft && draft.base === forge.build ? draft.build : forge.build!
  const s = forge.stages.stats
  const changed = JSON.stringify(build.spread) !== JSON.stringify(forge.build!.spread)
  const saved = s.status === 'ready' && !changed
  return (
    <div className="stage-body">
      <StatSplit
        build={build}
        onTarget={(stat, value) => {
          const result = setStatTarget(build, stat, value)
          if (result.ok) setDraft({ base: forge.build!, build: result.build })
        }}
      />
      {s.failure && <p className="inline-error" role="alert">{s.failure}</p>}
      <p className="muted">{saved ? 'Split saved. Publishing runs the balance check one last time and puts your hero in the global loadout.' : 'Save the split first; publishing checks it against the field.'}</p>
      <div className="stage-actions">
        <button className={`btn${saved ? ' ghost' : ' primary'}`} disabled={busy || saved} onClick={() => onCheck(build.spread)}>
          {saved ? 'Split saved' : 'Save split'}
        </button>
        <button className="btn primary big" disabled={busy || s.status !== 'ready' || changed} onClick={onPublish}>
          Publish hero
        </button>
      </div>
    </div>
  )
}
