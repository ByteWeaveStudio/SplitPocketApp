import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { signInWithEmail } from '@/features/auth/auth-service'
import { AuthShell } from '@/features/auth/components/auth-shell'
import { FormField } from '@/features/auth/components/form-field'
import { OAuthButtons } from '@/features/auth/components/oauth-buttons'
import { SignInSchema } from '@/features/auth/schemas'
import type { SignInValues } from '@/features/auth/schemas'

export function SignInPage() {
  const form = useForm<SignInValues>({
    resolver: zodResolver(SignInSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: SignInValues) {
    try {
      await signInWithEmail(values.email, values.password)
      // RedirectIfSignedIn navigates once the session lands in the store.
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign-in failed. Try again.')
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Track personal spending and split shared costs."
      footer={
        <p className="text-sm text-muted-foreground">
          New to SplitPocket?{' '}
          <Link to="/auth/sign-up" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      }
    >
      <OAuthButtons />
      <form
        className="flex flex-col gap-3"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
      >
        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <div className="text-right">
          <Link
            to="/auth/forgot-password"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  )
}
