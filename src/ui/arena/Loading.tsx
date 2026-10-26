/** The loading overlay (R40): progress while heroes load, so a stream never shows pop-in or a blank arena. */
export function Loading({ done, total, label = 'Loading heroes' }: { done: number; total: number; label?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="arena-overlay" role="status" aria-live="polite">
      <p>
        {label}… {done} of {total}
      </p>
      <div className="arena-progress" aria-hidden="true">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Unsupported() {
  return (
    <div className="arena-overlay" role="alert">
      <p>This browser can’t run the arena: it needs WebGPU or WebGL2. Try a current Chrome, Safari or Firefox.</p>
    </div>
  )
}
