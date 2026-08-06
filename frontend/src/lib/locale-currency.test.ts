import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectLocaleCurrency, initialCurrency } from '@/lib/locale-currency'

function stubLanguages(languages: string[]): void {
  vi.stubGlobal('navigator', {
    language: languages[0] ?? '',
    languages,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectLocaleCurrency', () => {
  it('maps region subtags to their currency', () => {
    stubLanguages(['en-IN'])
    expect(detectLocaleCurrency()).toBe('INR')
    stubLanguages(['de-DE'])
    expect(detectLocaleCurrency()).toBe('EUR')
    stubLanguages(['en-GB'])
    expect(detectLocaleCurrency()).toBe('GBP')
  })

  it('maximizes bare language tags to a likely region', () => {
    stubLanguages(['ja'])
    expect(detectLocaleCurrency()).toBe('JPY')
    stubLanguages(['hi'])
    expect(detectLocaleCurrency()).toBe('INR')
  })

  it('returns null when no language maps to a supported currency', () => {
    stubLanguages(['pt-BR'])
    expect(detectLocaleCurrency()).toBeNull()
  })

  it('keeps scanning past unmapped and malformed tags', () => {
    stubLanguages(['pt-BR', 'en-IN'])
    expect(detectLocaleCurrency()).toBe('INR')
    stubLanguages(['!!!', 'fr-FR'])
    expect(detectLocaleCurrency()).toBe('EUR')
  })

  it('falls back to navigator.language when languages is empty', () => {
    stubLanguages([])
    vi.stubGlobal('navigator', { language: 'en-AU', languages: [] })
    expect(detectLocaleCurrency()).toBe('AUD')
  })
})

describe('initialCurrency', () => {
  it('defaults to USD when nothing maps', () => {
    stubLanguages(['pt-BR'])
    expect(initialCurrency()).toBe('USD')
  })

  it('uses the detected currency when one maps', () => {
    stubLanguages(['en-SG'])
    expect(initialCurrency()).toBe('SGD')
  })
})
