import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'

/**
 * One tap, two states. There is no "system" — see lib/theme.ts.
 *
 * The icons swap on the `dark:` class rather than on React state, so the
 * button shows the right one from the first paint, before next-themes has
 * read localStorage. The label stays constant for the same reason: a name
 * that depends on resolved state would read "Switch to dark" for a frame on
 * a dark-themed load, and a screen reader can catch that frame.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label="Toggle dark mode"
      aria-pressed={resolvedTheme === 'dark'}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="size-5 dark:hidden" aria-hidden />
      <Moon className="hidden size-5 dark:block" aria-hidden />
    </Button>
  )
}
