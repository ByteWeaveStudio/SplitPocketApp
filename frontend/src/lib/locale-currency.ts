import { DEFAULT_CURRENCY, isSupportedCurrency } from '@/lib/currencies'
import type { CurrencyCode } from '@/types'

/**
 * Guess a default currency from the device's language settings — the
 * privacy-friendly notion of "rough location". No geolocation permission,
 * no IP lookup: `navigator.languages` region subtags (maximized via CLDR
 * likely-subtags when a tag like "ja" carries none) map to a currency the
 * picker offers. Works the same inside the Capacitor shells, whose WebView
 * reflects the OS language.
 */

/** Regions of the currencies in `CURRENCIES`. Values must stay supported. */
const REGION_CURRENCY: Record<string, CurrencyCode> = {
  // US dollar (incl. territories and full adopters)
  US: 'USD', AS: 'USD', GU: 'USD', MP: 'USD', PR: 'USD', VI: 'USD',
  EC: 'USD', SV: 'USD', TL: 'USD', FM: 'USD', MH: 'USD', PW: 'USD',
  // Euro area (incl. micro-states and unilateral adopters)
  AT: 'EUR', BE: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR',
  FR: 'EUR', DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR',
  LT: 'EUR', LU: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR',
  SI: 'EUR', ES: 'EUR', AD: 'EUR', MC: 'EUR', SM: 'EUR', VA: 'EUR',
  ME: 'EUR', XK: 'EUR',
  // Pound sterling (incl. crown dependencies)
  GB: 'GBP', GG: 'GBP', IM: 'GBP', JE: 'GBP',
  IN: 'INR',
  JP: 'JPY',
  CN: 'CNY',
  // Australian dollar (incl. external territories and adopters)
  AU: 'AUD', CX: 'AUD', CC: 'AUD', NF: 'AUD', KI: 'AUD', NR: 'AUD', TV: 'AUD',
  CA: 'CAD',
  SG: 'SGD',
  AE: 'AED',
}

/** The currency implied by the device languages, or null when none maps. */
export function detectLocaleCurrency(): CurrencyCode | null {
  if (typeof navigator === 'undefined') return null
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of tags) {
    if (!tag) continue
    try {
      const locale = new Intl.Locale(tag)
      const region = locale.region ?? locale.maximize().region
      const currency = region ? REGION_CURRENCY[region] : undefined
      if (isSupportedCurrency(currency)) return currency
    } catch {
      // Malformed tag — try the next one.
    }
  }
  return null
}

/** First-run default: the detected currency, or USD when nothing maps. */
export function initialCurrency(): CurrencyCode {
  return detectLocaleCurrency() ?? DEFAULT_CURRENCY
}
