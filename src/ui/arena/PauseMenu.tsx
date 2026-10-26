import { useEffect, useState } from 'react'
import { loadAudio, saveAudio, type AudioSettings } from '../../arena/client/settings'

/** Volume and mute (R41): one slider and one toggle, remembered between visits. */
export function VolumeControl({ compact = false }: { compact?: boolean }) {
  const [audio, setAudio] = useState<AudioSettings>(loadAudio)
  const change = (next: AudioSettings) => (setAudio(next), saveAudio(next))
  useEffect(() => saveAudio(audio), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="volume">
      <button aria-pressed={audio.muted} onClick={() => change({ ...audio, muted: !audio.muted })}>
        {audio.muted ? 'Unmute' : 'Mute'}
      </button>
      {!compact && (
        <input type="range" min={0} max={1} step={0.05} value={audio.volume} aria-label="Volume" onChange={(e) => change({ ...audio, volume: Number(e.target.value) })} />
      )}
    </span>
  )
}

/** P pauses the match (U18, AE9): the engine freezes until Resume. */
export function PauseMenu({ onResume, onRestart, onBack }: { onResume: () => void; onRestart: () => void; onBack: () => void }) {
  return (
    <div className="arena-overlay pause-menu" role="dialog" aria-label="Paused">
      <h2>Paused</h2>
      <div className="column">
        <button className="primary" onClick={onResume}>
          Resume
        </button>
        <button onClick={onRestart}>Restart with this setup</button>
        <button onClick={onBack}>Back to staging</button>
      </div>
      <VolumeControl />
      <p className="muted">P pauses and resumes</p>
    </div>
  )
}
