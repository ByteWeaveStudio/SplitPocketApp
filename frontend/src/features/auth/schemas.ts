import { z } from 'zod'

export const SignInSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})
export type SignInValues = z.infer<typeof SignInSchema>

export const SignUpSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name.').max(80, 'Keep it under 80 characters.'),
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
})
export type SignUpValues = z.infer<typeof SignUpSchema>

export const ForgotPasswordSchema = z.object({
  email: z.email('Enter a valid email address.'),
})
export type ForgotPasswordValues = z.infer<typeof ForgotPasswordSchema>

export const ResetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters.'),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Passwords don’t match.',
  })
export type ResetPasswordValues = z.infer<typeof ResetPasswordSchema>
