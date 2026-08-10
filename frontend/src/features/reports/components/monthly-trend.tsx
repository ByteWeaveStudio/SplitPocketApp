import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MonthPoint } from '@/features/reports/reports-data'
import { monthKeyLabel } from '@/lib/dates'
import { formatMoney } from '@/lib/format'
import type { CurrencyCode } from '@/types'

/**
 * Spent and income per month, as grouped columns.
 *
 * Columns rather than a line: these are a dozen discrete buckets, not a
 * continuous signal, and a line between two months implies values in between
 * that don't exist. One y-scale for both series — they are the same measure in
 * the same currency, and a second axis would let the eye compare two different
 * rulers (the single most common charting mistake).
 *
 * Colours are --chart-1 and --chart-2, which are validated for the lightness
 * band, chroma floor, CVD separation, normal-vision separation and 3:1
 * contrast in both themes. Identity is never colour alone: there is a legend,
 * every column is labelled on hover, and the table below carries the numbers.
 */
export function MonthlyTrend({
  points,
  currency,
  title,
}: {
  points: MonthPoint[]
  currency: CurrencyCode
  title: string
}) {
  const peak = Math.max(
    1,
    ...points.map((point) => Math.max(point.spentMinor, point.incomeMinor)),
  )
  const anyIncome = points.some((point) => point.incomeMinor > 0)

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <ul className="flex items-center gap-3 text-xs text-muted-foreground">
          <LegendKey className="bg-chart-1" label="Spent" />
          {anyIncome && <LegendKey className="bg-chart-2" label="Income" />}
        </ul>
      </CardHeader>
      <CardContent>
        <div className="flex h-40 items-end gap-1.5" role="presentation">
          {points.map((point) => (
            <MonthColumn
              key={point.month}
              point={point}
              peak={peak}
              currency={currency}
              showIncome={anyIncome}
            />
          ))}
        </div>
        {/* The numbers themselves, for screen readers, print, and anyone who
            would rather read than measure a bar. */}
        <details className="pt-4">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Show these figures as a table
          </summary>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1 font-medium">
                  Month
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Spent
                </th>
                {anyIncome && (
                  <th scope="col" className="py-1 text-right font-medium">
                    Income
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.month} className="border-t">
                  <th scope="row" className="py-1 text-left font-normal">
                    {monthKeyLabel(point.month)}
                  </th>
                  <td className="money py-1 text-right">
                    {formatMoney(point.spentMinor, currency)}
                  </td>
                  {anyIncome && (
                    <td className="money py-1 text-right">
                      {formatMoney(point.incomeMinor, currency)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </CardContent>
    </Card>
  )
}

function LegendKey({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-[2px] ${className}`} aria-hidden />
      {label}
    </li>
  )
}

function MonthColumn({
  point,
  peak,
  currency,
  showIncome,
}: {
  point: MonthPoint
  peak: number
  currency: CurrencyCode
  showIncome: boolean
}) {
  const label = monthKeyLabel(point.month)
  // A bar for a real but tiny amount must still be visible; a true zero must
  // still read as zero, so the floor only applies above it.
  const height = (value: number) => (value === 0 ? 0 : Math.max((value / peak) * 100, 2))

  return (
    <div className="group relative flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <div className="flex h-full w-full items-end justify-center gap-0.5">
        <Bar heightPercent={height(point.spentMinor)} className="bg-chart-1" />
        {showIncome && (
          <Bar heightPercent={height(point.incomeMinor)} className="bg-chart-2" />
        )}
      </div>
      <span className="w-full truncate text-center text-[10px] text-muted-foreground">
        {label.slice(0, 3)}
      </span>
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border bg-popover px-2 py-1 text-xs shadow-md group-hover:block"
      >
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">
          Spent <span className="money">{formatMoney(point.spentMinor, currency)}</span>
        </p>
        {showIncome && (
          <p className="text-muted-foreground">
            Income <span className="money">{formatMoney(point.incomeMinor, currency)}</span>
          </p>
        )}
      </div>
    </div>
  )
}

function Bar({ heightPercent, className }: { heightPercent: number; className: string }) {
  return (
    <div
      className={`bar-rise w-full max-w-5 rounded-t-[4px] ${className}`}
      style={{ height: `${heightPercent}%` }}
    />
  )
}
