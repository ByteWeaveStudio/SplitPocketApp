import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Invitation-or-status panel. Pass `illustration` for empty states (an
 * invitation to act); the plain `icon` circle suits error states.
 */
export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  illustration?: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rise-in flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
      {illustration ? (
        <div className="text-muted-foreground">{illustration}</div>
      ) : (
        Icon && (
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Icon className="size-6 text-muted-foreground" aria-hidden />
          </div>
        )
      )}
      <h2 className="mt-4 text-lg font-medium">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
