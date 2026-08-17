import { ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SplitEditor } from '@/features/expense-composer/components/split-editor'
import { describeSplit } from '@/features/expense-composer/split-draft'
import type { SplitDraft, SplitSummary as Summary } from '@/features/expense-composer/split-draft'
import { memberDisplayName } from '@/features/groups/display'
import type { GroupMemberProfile, SplitPreset } from '@/features/groups/types'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CurrencyCode, Id } from '@/types'

/**
 * The split, stated when it is right and editable when it is not.
 *
 * Collapsed, this is one row of prose covering what used to be seven controls:
 * the method, the preset chips, the sharing counter, the select-all, a
 * checkbox per member, the running remainder, and the payer. All of them have
 * defaults that are correct for nearly every expense, and a form that asks for
 * an answer it already has is the thing that made this sheet long.
 *
 * The row opens in place rather than pushing a second screen: the amount and
 * description stay visible above it, so adjusting who is in never costs the
 * context of what is being split.
 */
export function SplitSummary({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  members,
  currency,
  myUserId,
  paidBy,
  onPaidByChange,
  amountMinor,
  summary,
  presets,
  onApplyPreset,
  onSavePreset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: SplitDraft
  onDraftChange: (draft: SplitDraft) => void
  members: GroupMemberProfile[]
  currency: CurrencyCode
  myUserId: Id
  paidBy: Id
  onPaidByChange: (userId: Id) => void
  amountMinor: number | null
  summary: Summary
  presets: SplitPreset[]
  onApplyPreset: (preset: SplitPreset) => void
  onSavePreset: () => void
}) {
  const { headline, detail } = describeSplit({
    draft,
    summary,
    members,
    currency,
    amountMinor,
    paidBy,
    myUserId,
    formatMoney,
  })

  if (!open) {
    return (
      <button
        type="button"
        data-slot="split-summary"
        onClick={() => onOpenChange(true)}
        aria-expanded={false}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
          'hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          summary.error ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/25',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{headline}</span>
          {/* A split that can't be saved has to say so here — the reason it is
              blocked lives inside a panel the user has not opened. */}
          <span
            className={cn(
              'block truncate text-xs',
              summary.error ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {summary.error ?? detail}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b bg-muted/40 py-1.5 pr-1.5 pl-3.5">
        <span className="text-sm font-medium">Split</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="gx-paid-by" className="shrink-0">
            Paid by
          </Label>
          <Select value={paidBy} onValueChange={onPaidByChange}>
            <SelectTrigger id="gx-paid-by" className="w-auto min-w-0 max-w-[60%]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {memberDisplayName(member, myUserId)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <SplitEditor
          draft={draft}
          onChange={onDraftChange}
          members={members}
          currency={currency}
          myUserId={myUserId}
          summary={summary}
          presets={presets}
          onApplyPreset={onApplyPreset}
          onSavePreset={onSavePreset}
        />
      </div>
    </div>
  )
}
