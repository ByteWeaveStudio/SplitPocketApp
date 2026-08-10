import { env } from '@/lib/env'
import { OFFLINE_MESSAGE, UNREACHABLE_MESSAGE, isOffline, markOnline } from '@/services/offline/net'
import { getSupabase, isSupabaseConfigured } from '@/services/supabase'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  const { data } = await getSupabase().auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * Typed fetch wrapper for the SplitPocket Python API.
 * Attaches the Supabase access token when a session exists.
 */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = await getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  // Explicit join: new URL(path, base) would discard any path prefix on the base.
  const url = `${env.VITE_API_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  let response: Response
  try {
    // Attempted even when the browser claims to be offline. That claim is a
    // hint (see net.ts) and refusing here on the strength of it is what turns
    // one bad flag into an app that cannot recover: the request that would
    // have disproved it never gets made.
    response = await fetch(url, { ...options, headers })
  } catch {
    // fetch only rejects when the request never reached the server.
    throw new Error(isOffline() ? OFFLINE_MESSAGE : UNREACHABLE_MESSAGE)
  }
  // Any response at all — including a 401 — proves the network works.
  markOnline()

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, `Request to ${path} failed (${response.status})`, body)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
