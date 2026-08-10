import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isNetworkError,
  isOffline,
  markOnline,
  OFFLINE_MESSAGE,
  UNREACHABLE_MESSAGE,
} from '@/services/offline/net'
import { useNetworkStore } from '@/stores/network-store'

afterEach(() => {
  vi.unstubAllGlobals()
  useNetworkStore.getState().setOnline(true)
})

describe('isOffline', () => {
  // Reads the network store rather than navigator directly. initSync feeds
  // the store from navigator's events; markOnline corrects it from evidence.
  it('follows the tracked connectivity state', () => {
    useNetworkStore.getState().setOnline(false)
    expect(isOffline()).toBe(true)
    useNetworkStore.getState().setOnline(true)
    expect(isOffline()).toBe(false)
  })
})

describe('markOnline', () => {
  it('clears a false offline state, so one good request is the way back', () => {
    useNetworkStore.getState().setOnline(false)
    markOnline()
    expect(isOffline()).toBe(false)
  })

  it('is a no-op when already online', () => {
    const before = useNetworkStore.getState()
    markOnline()
    expect(useNetworkStore.getState().online).toBe(true)
    expect(useNetworkStore.getState()).toBe(before)
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
