import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

import { env, isSupabaseConfigured } from '@/lib/env'
import type { Database } from '@/types/database.types'

let client: SupabaseClient<Database> | null = null

export { isSupabaseConfigured }

/**
 * Lazy singleton so the app still runs before Supabase is configured.
 * Callers should check `isSupabaseConfigured` before invoking.
 */
export function getSupabase(): SupabaseClient<Database> {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      'Supabase is not configured. Copy frontend/.env.example to frontend/.env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
    )
  }
  client ??= createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  return client
}
