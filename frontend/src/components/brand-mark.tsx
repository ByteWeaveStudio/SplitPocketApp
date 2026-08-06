import { cn } from '@/lib/utils'

export function BrandMark({
  withWordmark = false,
  className,
}: {
  withWordmark?: boolean
  className?: string
}) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-lg bg-primary font-heading text-lg font-bold text-primary-foreground"
      >
        S
      </span>
      {withWordmark && (
        <span className="font-heading text-lg font-semibold tracking-tight">SplitPocket</span>
      )}
    </span>
  )
}
