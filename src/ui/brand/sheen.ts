/**
 * The chrome pills' sheen follows the pointer: one listener for the page sets --mx and --my (percent of the button) on
 * whichever primary button the pointer is over, and theme.css draws the highlight there.
 */
export function followSheen(doc: Document = document) {
  const move = (e: PointerEvent) => {
    const button = (e.target as Element | null)?.closest?.('.btn.primary') as HTMLElement | null
    if (!button) return
    const r = button.getBoundingClientRect()
    button.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`)
    button.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
  }
  doc.addEventListener('pointermove', move, { passive: true })
  return () => doc.removeEventListener('pointermove', move)
}
