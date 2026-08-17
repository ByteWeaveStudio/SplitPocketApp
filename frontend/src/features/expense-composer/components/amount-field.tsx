import type { ReactNode } from 'react'

import { currencySymbol } from '@/lib/currencies'
import { cn } from '@/lib/utils'
import type { CurrencyCode } from '@/types'

/** Wide enough for a five-figure sum; past that the field scrolls rather than
 * pushing the symbol off the edge of a phone. */
const MAX_CH = 11
/** An empty field still has to read as somewhere to type. At 1ch the caret
 * sits flush against the currency symbol; much wider and the placeholder
 * drifts visibly left of centre, because the symbol only occupies one side. */
const MIN_CH = 2

/**
 * The amount, given the weight of the one thing the composer can never guess.
 *
 * Every other field in the sheet has a defensible default — today's date, an
 * equal split, you as the payer — so they can sit in the ordinary row rhythm
 * and be corrected when wrong. This one cannot, so it gets the size and the
 * focus instead of a label and a box like everything else.
 *
 * The input measures itself in `ch` against its own monospaced face, where one
 * ch is exactly one glyph, so the symbol stays tucked against the number as it
 * grows. Centring a full-width input instead would strand the symbol at the
 * left edge, reading as two unrelated controls.
 */
export function AmountField({
  id,
  value,
  onChange,
  currency,
  autoFocus = false,
  invalid = false,
  children,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  currency: CurrencyCode
  autoFocus?: boolean
  invalid?: boolean
  /** Rendered under the rule — the currency picker, where there is a choice. */
  children?: ReactNode
}) {
  const width = Math.min(Math.max(value.length, MIN_CH), MAX_CH)

  return (
    <div className="flex flex-col items-center gap-2 pt-1">
      {/* The label is the sheet's whole purpose, so it is announced rather
          than drawn; a visible "Amount" here would compete with the number. */}
      <label htmlFor={id} className="sr-only">
        Amount in {currency}
      </label>
      {/* The rule hugs the value rather than sitting at a fixed width, so it
          reads as this number's baseline instead of a stray divider. */}
      <div
        className={cn(
          'flex min-w-32 max-w-full items-baseline justify-center gap-1.5 border-b px-4 pb-2',
          invalid && 'border-destructive',
        )}
      >
        <span aria-hidden className="money text-xl font-medium text-muted-foreground">
          {currencySymbol(currency)}
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the sheet exists
          // to capture this number; opening it and waiting for a tap on the
          // only field that matters is the friction this composer is fixing.
          autoFocus={autoFocus}
          placeholder="0"
          aria-invalid={invalid || undefined}
          className={cn(
            'money min-w-0 border-0 bg-transparent p-0 text-center text-[2.5rem] leading-none font-semibold tracking-tight',
            'outline-none placeholder:text-muted-foreground/45 focus-visible:outline-none',
            invalid && 'text-destructive',
          )}
          style={{ width: `${width}ch` }}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {children}
    </div>
  )
}
