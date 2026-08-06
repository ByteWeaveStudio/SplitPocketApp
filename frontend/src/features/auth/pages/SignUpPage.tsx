import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { signUpWithEmail } from '@/features/auth/auth-service'
import { AuthShell } from '@/features/auth/components/auth-shell'
import { FormField } from '@/features/auth/components/form-field'
import { OAuthButtons } from '@/features/auth/components/oauth-buttons'
import { SignUpSchema } from '@/features/auth/schemas'
import type { SignUpValues } from '@/features/auth/schemas'

export function SignUpPage() {
  const [confirmEmailSentTo, setConfirmEmailSentTo] = useState<string | null>(null)
  const form = useForm<SignUpValues>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: { fullName: '', email: '', password: '' },
  })

  async function onSubmit(values: SignUpValues) {
    try {
      const result = await signUpWithEmail(values.fullName, values.email, values.password)
      if (result === 'confirmEmail') setConfirmEmailSentTo(values.email)
      // 'signedIn' is handled by RedirectIfSignedIn once the store updates.
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign-up failed. Try again.')
    }
  }

  if (confirmEmailSentTo) {
    return (
      <AuthShell title="Check your inbox">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <MailCheck className="size-6 text-primary" aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to{' '}
            <span className="font-medium text-foreground">{confirmEmailSentTo}</span>. Open it to
            activate your account, then sign in.
          </p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your account"
      description="Track personal spending and split shared costs."
      footer={
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/auth/sign-in" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <OAuthButtons />
      <form className="flex flex-col gap-3" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FormField
          id="fullName"
          label="Name"
          autoComplete="name"
          placeholder="Your name"
          error={form.formState.errors.fullName?.message}
          {...form.register('fullName')}
        />
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
          autoComplete="new-password"
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  )
}
