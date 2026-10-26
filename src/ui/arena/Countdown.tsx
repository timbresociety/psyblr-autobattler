import { useEffect, useState } from 'react'

/** 3, 2, 1 before the first tick (U18, R39). The engine stays paused until `onDone`. */
export function Countdown({ from = 3, onDone }: { from?: number; onDone: () => void }) {
  const [left, setLeft] = useState(from)
  useEffect(() => {
    if (left <= 0) return void onDone()
    const t = window.setTimeout(() => setLeft(left - 1), 1000)
    return () => window.clearTimeout(t)
  }, [left, onDone])
  return (
    <div className="countdown" role="status" aria-live="assertive">
      {left > 0 ? left : 'Fight'}
    </div>
  )
}
