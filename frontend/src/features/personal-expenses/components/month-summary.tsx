import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { CurrencySummary } from '@/features/personal-expenses/expenses-store'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * Month totals per currency as one divided "statement" card. The user's
 * default currency is listed first; totals are never converted across
 * currencies — each is shown as-is.
 */
export function MonthSummary({
  summaries,
  loading,
}: {
  summaries: CurrencySummary[]
  loading: boolean
}) {
  const defaultCurrency = useSettingsStore((state) => state.currency)
  const ordered = [...summaries].sort((a, b) =>
    a.currency === defaultCurrency ? -1 : b.currency === defaultCurrency ? 1 : 0,
  )
  const display = ordered.length
    ? ordered
    : [{ currency: defaultCurrency, spentMinor: 0, incomeMinor: 0 }]

  return (
    <Card className="mb-4 grid grid-cols-3 gap-0 divide-x divide-border py-0">
      <SummaryCell label="Spent" loading={loading}>
        {display.map(({ currency, spentMinor }) => (
          <Amount key={currency} value={formatMoney(spentMinor, currency)} />
        ))}
      </SummaryCell>
      <SummaryCell label="Income" loading={loading}>
        {display.map(({ currency, incomeMinor }) => (
          <Amount
            key={currency}
            value={formatMoney(incomeMinor, currency)}
            className={incomeMinor > 0 ? 'text-positive' : undefined}
          />
        ))}
      </SummaryCell>
      <SummaryCell label="Net" loading={loading}>
        {display.map(({ currency, spentMinor, incomeMinor }) => {
          const net = incomeMinor - spentMinor
          return (
            <Amount
              key={currency}
              value={`${net > 0 ? '+' : ''}${formatMoney(net, currency)}`}
              className={cn(net > 0 && 'text-positive', net < 0 && 'text-negative')}
            />
          )
        })}
      </SummaryCell>
    </Card>
  )
}

function SummaryCell({
  label,
  loading,
  children,
}: {
  label: string
  loading: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-4 sm:px-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      {loading ? <Skeleton className="h-6 w-full max-w-20" /> : children}
    </div>
  )
}

function Amount({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        'money truncate font-semibold',
        // Long amounts step down instead of truncating on narrow phones.
        value.length > 10 ? 'text-sm sm:text-lg' : 'text-[15px] sm:text-lg',
        className,
      )}
      title={value}
    >
      {value}
    </span>
  )
}
