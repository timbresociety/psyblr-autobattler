import { useEffect, useRef, useState } from 'react'

/** How long FIGHT! stays up once the match is running, ms. */
export const FIGHT_SPLASH_MS = 900

/**
 * 3, 2, 1 before the first tick (U18, R39), then FIGHT!. The engine stays paused until `onDone`; `onFinished` comes
 * once the FIGHT! splash has played over the running match.
 */
export function Countdown({ from = 3, onDone, onFinished }: { from?: number; onDone: () => void; onFinished?: () => void }) {
  const [left, setLeft] = useState(from)
  const fired = useRef(false)
  useEffect(() => {
    if (left > 0) {
      const t = window.setTimeout(() => setLeft(left - 1), 1000)
      return () => window.clearTimeout(t)
    }
    if (!fired.current) {
      fired.current = true
      onDone()
    }
    if (!onFinished) return
    const t = window.setTimeout(onFinished, FIGHT_SPLASH_MS)
    return () => window.clearTimeout(t)
  }, [left, onDone, onFinished])
  return (
    <div className={`countdown-stage${left > 0 ? '' : ' is-fight'}`}>
      <p className="countdown-kicker" aria-hidden="true">
        {left > 0 ? 'Get ready' : 'Round start'}
      </p>
      <div className="countdown" role="status" aria-live="assertive">
        <span key={left} className="countdown-num">
          {left > 0 ? left : 'Fight!'}
        </span>
      </div>
      <i key={`ring-${left}`} className="countdown-ring" aria-hidden="true" />
    </div>
  )
}
