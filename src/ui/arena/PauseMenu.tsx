import { useEffect, useState, type CSSProperties } from 'react'
import { loadAudio, saveAudio, type AudioSettings } from '../../arena/client/settings'

function Speaker({ muted }: { muted: boolean }) {
  return (
    <svg className="hud-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.5 9.2h3.8L12.5 5v14l-5.2-4.2H3.5z" fill="currentColor" />
      {muted ? (
        <path d="M16 9.5l5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      ) : (
        <path d="M15.6 9a4.2 4.2 0 0 1 0 6M18.4 6.4a8 8 0 0 1 0 11.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  )
}

/** Volume and mute (R41): one slider and one toggle, remembered between visits. */
export function VolumeControl({ compact = false }: { compact?: boolean }) {
  const [audio, setAudio] = useState<AudioSettings>(loadAudio)
  const change = (next: AudioSettings) => (setAudio(next), saveAudio(next))
  useEffect(() => saveAudio(audio), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className={`volume${compact ? ' compact' : ''}`}>
      <button className="hud-btn hud-mute" aria-pressed={audio.muted} onClick={() => change({ ...audio, muted: !audio.muted })}>
        <Speaker muted={audio.muted} />
        <span className={compact ? 'hud-sr' : undefined}>{audio.muted ? 'Unmute' : 'Mute'}</span>
      </button>
      {!compact && (
        <input
          type="range"
          className="hud-range"
          min={0}
          max={1}
          step={0.05}
          value={audio.volume}
          aria-label="Volume"
          style={{ '--v': `${Math.round(audio.volume * 100)}%` } as CSSProperties}
          onChange={(e) => change({ ...audio, volume: Number(e.target.value) })}
        />
      )}
    </span>
  )
}

/** P pauses the match (U18, AE9): the engine freezes until Resume. */
export function PauseMenu({ onResume, onRestart, onBack, back = 'Back to staging' }: { onResume: () => void; onRestart: () => void; onBack: () => void; back?: string }) {
  return (
    <div className="arena-overlay pause-menu hud-screen" role="dialog" aria-label="Paused">
      <div className="hud-menu">
        <p className="hud-kicker" aria-hidden="true">
          Match on hold
        </p>
        <h2>Paused</h2>
        <div className="column">
          <button className="hud-btn primary big" onClick={onResume}>
            Resume
          </button>
          <button className="hud-btn big" onClick={onRestart}>
            Restart with this setup
          </button>
          <button className="hud-btn big" onClick={onBack}>
            {back}
          </button>
        </div>
        <VolumeControl />
        <p className="hud-foot">
          <kbd>P</kbd> pauses and resumes
        </p>
      </div>
    </div>
  )
}
