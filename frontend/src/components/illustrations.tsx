/**
 * Empty-state illustrations, drawn in the app's own language: paper shapes,
 * emerald accents, the same rounded geometry as the UI. All are duotone —
 * `currentColor` strokes (set by the parent's text color) over primary-tinted
 * fills — so they read correctly in both themes without extra variants.
 */

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 88"
      width="120"
      height="88"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  )
}

/** A receipt with a coin — expenses live here. */
export function ReceiptIllustration({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      {/* receipt body with a torn zigzag bottom */}
      <path
        d="M38 12h44v56l-5.5-4-5.5 4-5.5-4-5.5 4-5.5-4-5.5 4-5.5-4-5.5 4V12Z"
        className="fill-primary/10"
        stroke="currentColor"
      />
      <path d="M46 24h28M46 32h28M46 40h18" stroke="currentColor" opacity="0.55" />
      <path d="M46 50h13" stroke="currentColor" />
      {/* coin */}
      <circle cx="86" cy="58" r="14" className="fill-primary/20" stroke="currentColor" />
      <circle cx="86" cy="58" r="9" stroke="currentColor" opacity="0.5" />
    </Frame>
  )
}

/** Two people and an open seat — groups split costs together. */
export function GroupIllustration({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      {/* left person */}
      <circle cx="38" cy="34" r="9" className="fill-primary/10" stroke="currentColor" />
      <path d="M22 66c1.5-11 8-17 16-17s14.5 6 16 17" stroke="currentColor" />
      {/* right person */}
      <circle cx="70" cy="30" r="8" className="fill-primary/20" stroke="currentColor" />
      <path d="M56 62c1.4-10 6.8-15 14-15s12.6 5 14 15" stroke="currentColor" />
      {/* the open seat */}
      <circle cx="97" cy="38" r="7" stroke="currentColor" strokeDasharray="3 3" opacity="0.5" />
      <path
        d="M86 64c1.2-8 5.6-12 11-12s9.8 4 11 12"
        stroke="currentColor"
        strokeDasharray="3 3"
        opacity="0.5"
      />
    </Frame>
  )
}

/** A magnifier finding nothing among ledger lines. */
export function SearchIllustration({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <path d="M24 26h34M24 36h26M24 46h30M24 56h20" stroke="currentColor" opacity="0.4" />
      <circle cx="76" cy="42" r="17" className="fill-primary/10" stroke="currentColor" />
      <path d="M89 55l10 10" stroke="currentColor" />
      <path d="M70 42h12" stroke="currentColor" opacity="0.6" />
    </Frame>
  )
}

/** Rising bars — where the monthly picture appears. */
export function ChartIllustration({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <path d="M22 70h76" stroke="currentColor" opacity="0.4" />
      <rect x="28" y="52" width="12" height="18" rx="3" className="fill-primary/10" stroke="currentColor" />
      <rect x="48" y="40" width="12" height="30" rx="3" className="fill-primary/20" stroke="currentColor" />
      <rect x="68" y="28" width="12" height="42" rx="3" className="fill-primary/30" stroke="currentColor" />
      <circle cx="90" cy="20" r="6" className="fill-primary/20" stroke="currentColor" />
    </Frame>
  )
}

/** A quiet pulse over a card — activity shows up here. */
export function ActivityIllustration({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x="24" y="24" width="72" height="40" rx="8" className="fill-primary/10" stroke="currentColor" />
      <path d="M32 44h14l6-10 8 20 6-10h22" stroke="currentColor" />
      <circle cx="60" cy="76" r="2" fill="currentColor" opacity="0.4" />
      <circle cx="70" cy="76" r="2" fill="currentColor" opacity="0.25" />
      <circle cx="50" cy="76" r="2" fill="currentColor" opacity="0.25" />
    </Frame>
  )
}
