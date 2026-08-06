import { z } from 'zod'

/** Treats empty strings in .env files as "not set" so defaults/optionals apply. */
const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema)

const EnvSchema = z.object({
  VITE_SUPABASE_URL: emptyAsUndefined(z.url().optional()),
  VITE_SUPABASE_PUBLISHABLE_KEY: emptyAsUndefined(z.string().min(1).optional()),
  VITE_API_URL: emptyAsUndefined(z.url().default('http://localhost:8000')),
})

const parsed = EnvSchema.safeParse(import.meta.env)

if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`)
}

export const env = parsed.data

export const isSupabaseConfigured = Boolean(
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
