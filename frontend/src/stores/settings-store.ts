import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { isSupportedCurrency } from '@/lib/currencies'
import { initialCurrency } from '@/lib/locale-currency'
import type { CurrencyCode } from '@/types'

interface SettingsState {
  currency: CurrencyCode
  /**
   * 'detected' = guessed from the device language; it may change with the
   * device settings. 'chosen' = the user picked it, so it sticks.
   */
  currencySource: 'detected' | 'chosen'
  setCurrency: (currency: CurrencyCode) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      currency: initialCurrency(),
      currencySource: 'detected',
      setCurrency: (currency) => set({ currency, currencySource: 'chosen' }),
    }),
    {
      name: 'splitpocket-settings',
      version: 1,
      // Validate rehydrated localStorage so a corrupted value can't crash
      // formatting. A stored currency only exists after setCurrency ran, so
      // records from before `currencySource` existed count as chosen.
      merge: (persisted, current) => {
        const incoming = persisted as Partial<SettingsState> | undefined
        if (!isSupportedCurrency(incoming?.currency)) return current
        return { ...current, currency: incoming.currency, currencySource: 'chosen' }
      },
    },
  ),
)
