import { useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * The SplitPocket mark: two figures leaning together, their bodies forming a
 * split pocket. Same geometry as public/logo-mark.svg and the app icons.
 *
 * The gradient stops come from --logo-1..4 rather than being hard-coded, so
 * the mark re-tints with the theme in the same paint as everything else — the
 * light ramp would go muddy against the dark surface. Gradient ids are scoped
 * with useId because more than one mark can be mounted at once (the sidebar
 * and the mobile header both render one), and duplicate ids would make every
 * instance resolve to whichever was defined last.
 */
export function BrandMark({
  withWordmark = false,
  className,
}: {
  withWordmark?: boolean
  className?: string
}) {
  const id = useId()
  const left = `${id}-l`
  const right = `${id}-r`

  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <svg
        viewBox="0 0 60 64"
        className="h-8 w-auto shrink-0"
        // The wordmark already names the brand; a second label would make a
        // screen reader announce "SplitPocket SplitPocket".
        {...(withWordmark ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'SplitPocket' })}
      >
        <defs>
          <linearGradient id={left} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="27.7" y2="64">
            <stop offset="0" stopColor="var(--logo-1)" />
            <stop offset="1" stopColor="var(--logo-2)" />
          </linearGradient>
          <linearGradient id={right} gradientUnits="userSpaceOnUse" x1="32.3" y1="0" x2="60" y2="64">
            <stop offset="0" stopColor="var(--logo-3)" />
            <stop offset="1" stopColor="var(--logo-4)" />
          </linearGradient>
        </defs>
        <g fill={`url(#${left})`}>
          <circle cx="10.72" cy="7" r="7" />
          <path d="M0 18 H8.2 C16.97 18 27.7 27.08 27.7 34.51 V64 C12.46 64 0 53.88 0 41.51 Z" />
        </g>
        <g fill={`url(#${right})`}>
          <circle cx="49.28" cy="7" r="7" />
          <path d="M60 18 H51.8 C43.03 18 32.3 27.08 32.3 34.51 V64 C47.53 64 60 53.88 60 41.51 Z" />
        </g>
      </svg>
      {withWordmark && (
        // Live text in the same font and weight the wordmark was outlined
        // from, so it matches public/logo.svg without shipping a second copy
        // of the glyphs. Lowercase is the logotype; prose still says
        // "SplitPocket".
        <span className="font-heading text-xl font-bold leading-none tracking-[-0.012em]">
          split<span className="text-primary">pocket</span>
        </span>
      )}
    </span>
  )
}
