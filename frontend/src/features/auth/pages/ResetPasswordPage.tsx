import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { confirmPasswordReset, verifyResetCode } from '@/features/auth/auth-service'
import { AuthShell } from '@/features/auth/components/auth-shell'
import { FormField } from '@/features/auth/components/form-field'
import { ResetPasswordSchema } from '@/features/auth/schemas'
import type { ResetPasswordValues } from '@/features/auth/schemas'

type CodeStatus = 'checking' | 'valid' | 'invalid'

/**
 * Handles a password-reset link when the Firebase project is configured with a
 * custom action URL pointing here. The link carries an `oobCode` in the query
 * string rather than signing anyone in, so this page verifies that code instead
 * of reading the auth store.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const code = params.get('oobCode')
  const [status, setStatus] = useState<CodeStatus>('checking')
  const navigate = useNavigate()
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  })

  useEffect(() => {
    if (!code) {
      setStatus('invalid')
      return
    }
    let cancelled = false
    verifyResetCode(code)
      .then(() => {
        if (!cancelled) setStatus('valid')
      })
      .catch(() => {
        if (!cancelled) setStatus('invalid')
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (status === 'checking') {
    return (
      <div className="flex min-h-svh items-center justify-center" aria-busy="true">
        <BrandMark withWordmark className="animate-pulse" />
      </div>
    )
  }

  if (status === 'invalid') {
    return (
      <AuthShell title="This link has expired">
        <p className="text-center text-sm text-muted-foreground">
          Password reset links only work once and expire after a while. Request a new one and try
          again.
        </p>
        <Button asChild>
          <Link to="/auth/forgot-password">Request a new link</Link>
        </Button>
      </AuthShell>
    )
  }

  async function onSubmit(values: ResetPasswordValues) {
    if (!code) return
    try {
      await confirmPasswordReset(code, values.password)
      toast.success('Password updated — sign in with your new password.')
      navigate('/auth/sign-in', { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong. Try again.')
    }
  }

  return (
    <AuthShell title="Choose a new password">
      <form className="flex flex-col gap-3" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FormField
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <FormField
          id="confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.confirm?.message}
          {...form.register('confirm')}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </AuthShell>
  )
}
