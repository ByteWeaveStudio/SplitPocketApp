import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-5xl font-semibold tabular-nums text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">This page doesn't exist</h1>
      <p className="text-sm text-muted-foreground">
        The address may be wrong, or the page may have moved.
      </p>
      <Button asChild className="mt-2">
        <Link to="/">Go to dashboard</Link>
      </Button>
    </main>
  )
}
