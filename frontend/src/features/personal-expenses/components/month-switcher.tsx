import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { currentMonthKey, monthKeyLabel, shiftMonthKey } from '@/lib/dates'
import type { MonthKey } from '@/lib/dates'

export function MonthSwitcher({
  month,
  onChange,
}: {
  month: MonthKey
  onChange: (month: MonthKey) => void
}) {
  const isCurrent = month === currentMonthKey()

  return (
    <div className="flex items-center justify-between pb-4">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-10 md:size-8"
          aria-label="Previous month"
          onClick={() => onChange(shiftMonthKey(month, -1))}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium" aria-live="polite">
          {monthKeyLabel(month)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 md:size-8"
          aria-label="Next month"
          onClick={() => onChange(shiftMonthKey(month, 1))}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
      {!isCurrent && (
        <Button variant="outline" size="sm" onClick={() => onChange(currentMonthKey())}>
          This month
        </Button>
      )}
    </div>
  )
}
