import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * A note, offered rather than asked for.
 *
 * Unlike the date or the split, a note has no default worth stating — the
 * honest resting value is "there isn't one". So it collapses to an affordance
 * instead of a summary line, and costs a row of chrome rather than a labelled
 * textarea nobody fills in. An expense being edited that already has one opens
 * expanded, because there the note is content, not an invitation.
 */
export function NoteField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(() => value.trim().length > 0)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-fit items-center gap-1.5 rounded-full border border-dashed px-3.5 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Plus className="size-4" aria-hidden />
        Add a note
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        Notes <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Textarea
        id={id}
        rows={2}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by a
        // deliberate tap; landing anywhere else would waste the interaction.
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
