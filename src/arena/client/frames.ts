/** Frame-time summary for the bench and the quality guard: median and 1% low, both in milliseconds. */
export interface FrameSummary {
  medianMs: number
  /** The 99th-percentile frame time: the slowest 1% of frames are at least this long. */
  onePercentLowMs: number
  fps: number
}

export function summarizeFrames(frameMs: readonly number[]): FrameSummary {
  if (!frameMs.length) return { medianMs: 0, onePercentLowMs: 0, fps: 0 }
  const sorted = [...frameMs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const medianMs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const onePercentLowMs = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)]
  return { medianMs, onePercentLowMs, fps: medianMs > 0 ? 1000 / medianMs : 0 }
}
