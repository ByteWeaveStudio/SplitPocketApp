import { afterEach, describe, expect, it, vi } from 'vitest'

import { isNetworkError, isOffline, OFFLINE_MESSAGE, UNREACHABLE_MESSAGE } from '@/services/offline/net'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isOffline', () => {
  it('is true only when the browser reports offline', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(isOffline()).toBe(true)
    vi.stubGlobal('navigator', { onLine: true })
    expect(isOffline()).toBe(false)
  })
})

describe('isNetworkError', () => {
  it('treats fetch TypeErrors as network errors', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('recognizes browser-specific network messages', () => {
    for (const message of [
      'Failed to fetch', // Chromium
      'Load failed', // WebKit
      'NetworkError when attempting to fetch resource.', // Firefox
      'Network request failed',
      'fetch failed', // Node/undici
    ]) {
      expect(isNetworkError(new Error(message))).toBe(true)
    }
  })

  it('recognizes supabase-style error objects and our rewrapped messages', () => {
    expect(isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true)
    expect(isNetworkError(new Error(OFFLINE_MESSAGE))).toBe(true)
    expect(isNetworkError(new Error(UNREACHABLE_MESSAGE))).toBe(true)
  })

  it('leaves real server errors alone', () => {
    expect(isNetworkError(new Error('duplicate key value violates unique constraint'))).toBe(false)
    expect(isNetworkError(new Error('Percentages must add up to exactly 100%.'))).toBe(false)
    expect(isNetworkError('some string')).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})
