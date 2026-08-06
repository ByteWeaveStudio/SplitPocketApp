import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <BrandMark withWordmark />
      <Card className="page-enter w-full max-w-sm">
        <CardHeader className="text-center">
          <h1 className="text-xl font-semibold leading-none">{title}</h1>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
      {footer ?? (
        <Button asChild variant="ghost" size="sm">
          <Link to="/auth/sign-in">Back to sign-in</Link>
        </Button>
      )}
    </main>
  )
}
