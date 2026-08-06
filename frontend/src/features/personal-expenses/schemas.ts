import { z } from 'zod'

import { currencyDecimalDigits } from '@/lib/currencies'
import { parseMoney } from '@/lib/format'

export const ExpenseFormSchema = z
  .object({
    kind: z.enum(['expense', 'income']),
    amount: z.string().trim().min(1, 'Enter an amount.'),
    currency: z.string().length(3),
    description: z
      .string()
      .trim()
      .min(1, 'What was it for?')
      .max(200, 'Keep it under 200 characters.'),
    /** 'none' = uncategorized — Radix Select items can't have empty values. */
    categoryId: z.string(),
    date: z.string().min(1, 'Pick a date.'),
    notes: z.string().trim().max(500, 'Keep notes under 500 characters.'),
  })
  .superRefine((values, ctx) => {
    const minor = parseMoney(values.amount, values.currency)
    if (minor === null) {
      const digits = currencyDecimalDigits(values.currency)
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message:
          digits === 0
            ? `${values.currency} doesn't use decimals — enter a whole number.`
            : `Enter a valid amount (up to ${digits} decimals).`,
      })
    } else if (minor === 0) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'The amount must be above zero.' })
    }
  })

export type ExpenseFormValues = z.infer<typeof ExpenseFormSchema>
