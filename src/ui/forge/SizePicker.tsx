import type { CSSProperties } from 'react'
import type { Build } from '../../charter/build'
import { SIZE_CLASSES, SIZES, sizeHealth, type SizeClass } from '../../charter/sizes'

/** "+12%", "−0.25 m", "±0%": trailing zeros after the point go, the digits before it never do. */
export const signed = (n: number, unit = '') => {
  const digits = Math.abs(n).toFixed(unit === ' m' ? 2 : 0).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${digits}${unit}`
}

/**
 * The five sizes a player can choose (R14). A bigger hero reaches further and is easier to hit, a smaller one the
 * reverse; the health price is the role's own, and the balance check prices the rest. Colossal is only reached by
 * transforming, so it isn't offered here.
 */
export function SizePicker({ build, onChange }: { build: Build; onChange: (size: SizeClass) => void }) {
  const current = build.sizeClass ?? 'medium'
  return (
    <div className="size-picker" role="radiogroup" aria-label="Size">
      {SIZE_CLASSES.map((size) => {
        const p = SIZES[size]
        const health = Math.round((sizeHealth(build.roleId, size) - 1) * 100)
        const speed = Math.round((p.speedMul - 1) * 100)
        const detail = `${Math.round(p.scale * 100)}% tall, health ${signed(health, '%')}, speed ${signed(speed, '%')}, reach ${signed(p.reachBonus, ' m')}`
        return (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={size === current}
            aria-label={`${p.label}: ${detail}`}
            title={detail}
            className={`size-tile${size === current ? ' on' : ''}`}
            onClick={() => size !== current && onChange(size)}
          >
            <span className="size-figure" style={{ '--s': p.scale } as CSSProperties} aria-hidden="true" />
            <b>{p.label}</b>
            <small>{size === 'medium' ? 'baseline' : `health ${signed(health, '%')}`}</small>
          </button>
        )
      })}
    </div>
  )
}
