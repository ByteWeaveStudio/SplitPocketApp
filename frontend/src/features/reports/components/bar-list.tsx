import { categoryIcon } from '@/features/categories/category-icons'
import type { BarSlice } from '@/features/reports/reports-data'
import { formatMoney } from '@/lib/format'
import type { CurrencyCode } from '@/types'

/**
 * A ranked list of magnitudes. One measure, one hue — the bar length carries
 * the comparison and the label carries the identity, so there is nothing for a
 * second colour to say.
 */
export function BarList({
  slices,
  currency,
  emptyLabel = 'Nothing here yet.',
}: {
  slices: BarSlice[]
  currency: CurrencyCode
  emptyLabel?: string
}) {
  if (slices.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {slices.map((slice, index) => {
        const Icon = slice.icon === undefined ? null : categoryIcon(slice.icon)
        return (
          <li key={slice.key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="truncate">{slice.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.round(slice.share * 100)}%
                </span>
              </span>
              <span className="money shrink-0 font-medium">
                {formatMoney(slice.valueMinor, currency)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
              <div
                className="bar-grow h-full rounded-full bg-primary"
                style={
                  {
                    // A real but tiny slice still needs to be visible.
                    width: `${Math.max(slice.share * 100, 1.5)}%`,
                    '--stagger': Math.min(index, 8),
                  } as React.CSSProperties
                }
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
