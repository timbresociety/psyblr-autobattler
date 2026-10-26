import { useId } from 'react'
import { ARCH, CHROME_STOPS, LETTERS, SHINE, TOKEN_SHINE, TOKEN_SHINE_AT } from './marks'

/**
 * A still chrome fill for the SVG marks (where the live 3D chrome can't run): a bright sky, a dark horizon band just
 * below the middle, a lighter floor, and a thin-film tint, the way polished chrome reflects a studio.
 */
function ChromeFill({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0.18" y2="1">
        {CHROME_STOPS.map(([offset, color]) => (
          <stop key={offset} offset={offset} stopColor={color} />
        ))}
      </linearGradient>
    </defs>
  )
}

/** "psyblr" in its italic logotype, with the shine in place of the y's teardrop, all in chrome. */
export function Wordmark({ className = '' }: { className?: string }) {
  const id = `chrome-${useId().replace(/:/g, '')}`
  return (
    <svg className={`wordmark ${className}`} viewBox="-112 -760 2313 990" role="img" aria-label="psyblr">
      <ChromeFill id={id} />
      <g fill={`url(#${id})`}>
        {LETTERS.map(([d, t]) => (
          <path key={t} d={d} transform={t} />
        ))}
        <path d={SHINE[0]} transform={SHINE[1]} />
      </g>
    </svg>
  )
}

/** psyblr's token: the arch with the shine inside it, in chrome. */
export function Token({ className = '' }: { className?: string }) {
  const id = `chrome-${useId().replace(/:/g, '')}`
  return (
    <svg className={`token ${className}`} viewBox="0 0 200 226" aria-hidden="true">
      <ChromeFill id={id} />
      <g fill={`url(#${id})`}>
        <path d={ARCH} />
        <path d={TOKEN_SHINE} transform={TOKEN_SHINE_AT} />
      </g>
    </svg>
  )
}
