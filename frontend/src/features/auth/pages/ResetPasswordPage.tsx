import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { updatePassword } from '@/features/auth/auth-service'
import { AuthShell } from '@/features/auth/components/auth-shell'
import { FormField } from '@/features/auth/components/form-field'
import { ResetPasswordSchema } from '@/features/auth/schemas'
import type { ResetPasswordValues } from '@/features/auth/schemas'
import { useAuthStore } from '@/stores/auth-store'

export function ResetPasswordPage() {
  const status = useAuthStore((state) => state.status)
  const navigate = useNavigate()
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  })

  // The recovery link signs the user in via the URL token; while supabase-js
  // processes it the store reports "loading".
  if (status === 'loading') {
    return (
      <div className="flex min-h-svh items-center justify-center" aria-busy="true">
        <BrandMark withWordmark className="animate-pulse" />
      </div>
    )
  }

  if (status === 'signedOut') {
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
    try {
      await updatePassword(values.password)
      toast.success('Password updated')
      navigate('/', { replace: true })
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
